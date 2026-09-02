import { internalAction, type ActionCtx } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { v } from "convex/values";

import {
  MAX_FACT_SEARCH_LIMIT,
  normalizeFactSearch,
  type HydratedFact,
  type RememberFactArgs,
  type RememberFactResult,
} from "./model";

// Matches the pattern in thoughts/actions.ts: the generated API type collapses
// under action-to-action recursion. Runtime behavior is unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

/**
 * Reciprocal Rank Fusion constant. Facts and thoughts fuse with the same K and
 * the same one-based ranks (`thoughts/actions.ts`), so their scores are
 * comparable when `recallBlend.ts` interleaves the two stores. Change one and
 * the blend silently weights noise.
 */
const RRF_K = 60;

/** Candidates drawn from each retriever before fusion. */
const CANDIDATE_CAP = MAX_FACT_SEARCH_LIMIT;

/** How many facts each half of `recallFacts` contributes by default. */
const DEFAULT_RECALL_CANDIDATES = 5;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function embedText(ctx: ActionCtx, text: string): Promise<number[]> {
  const embedding: number[] = await ctx.runAction(
    internal.models.thoughts.helpers.generateEmbedding,
    { text },
  );
  return embedding;
}

export type AttachEmbeddingOutcome = "embedded" | "unavailable" | "stale";

/**
 * Embeds a fact's search text and stores it. Never throws: when the provider
 * is unreachable (`OPENAI_API_KEY` unset, provider down) the fact stays stored
 * without an embedding, keyword search still finds it, and
 * `models/facts/migrations:backfillFactEmbeddings` fills it in later. This is
 * deliberately looser than the thoughts path, which embeds before it writes
 * and lets a provider failure fail the capture: a fact is the precise half of
 * the memory model, and losing it costs more than serving it by keyword until
 * the backfill runs.
 */
export async function attachFactEmbedding(
  ctx: ActionCtx,
  factId: Id<"facts">,
  searchText: string,
): Promise<AttachEmbeddingOutcome> {
  let embedding: number[];
  try {
    embedding = await embedText(ctx, searchText);
  } catch (error) {
    console.warn(
      `[facts] embedding unavailable for fact ${factId}; stored without one until backfillFactEmbeddings runs (${describeError(error)})`,
    );
    return "unavailable";
  }
  const applied: boolean = await ctx.runMutation(
    internal.models.facts.private.setEmbedding,
    { factId, searchText, embedding },
  );
  return applied ? "embedded" : "stale";
}

/**
 * The fact write path: commit the fact, then embed the `searchText` the
 * mutation produced. `searchText` is derived from the resolved subject entity
 * (canonical name, accumulated aliases), so it only exists once the mutation
 * has run; embedding afterwards keeps the vector faithful to what is stored.
 */
export async function rememberFactWithEmbedding(
  ctx: ActionCtx,
  userId: Id<"users">,
  args: RememberFactArgs,
): Promise<{
  factId: Id<"facts">;
  statement: string;
  operation: RememberFactResult["operation"];
}> {
  const result: RememberFactResult = await ctx.runMutation(
    internal.models.facts.private.rememberFact,
    { userId, ...args },
  );
  if (result.needsEmbedding) {
    await attachFactEmbedding(ctx, result.factId, result.searchText);
  }
  return {
    factId: result.factId,
    statement: result.statement,
    operation: result.operation,
  };
}

/**
 * Fact search that ranks by meaning as well as by keyword.
 *
 * The query is embedded once; the vector index and the keyword index are
 * consulted; the two rankings are fused with Reciprocal Rank Fusion. A fact is
 * therefore reachable by a paraphrase of its predicate ("who do I see for
 * mental health" reaches a `therapist` fact) and still reachable by an exact
 * name the embedding might blur.
 *
 * Lifecycle is enforced on both halves: the keyword query filters at the index,
 * and vector candidates are hydrated through `getRetrievableByIds`, which drops
 * superseded, retracted, and out-of-window facts. The vector side over-fetches
 * (bounded) so the limit can still be filled after that post-filter.
 *
 * When the embedding provider is unavailable the keyword ranking is served
 * alone rather than failing the recall.
 */
export async function hybridSearchFacts(
  ctx: ActionCtx,
  args: {
    userId: Id<"users">;
    query: string;
    limit?: number;
    includeHistorical?: boolean;
  },
): Promise<HydratedFact[]> {
  const { query, limit } = normalizeFactSearch(args.query, args.limit);
  const activeAt = Date.now();

  const [embedding, textHits]: [number[] | null, HydratedFact[]] =
    await Promise.all([
      embedText(ctx, query).catch((error: unknown) => {
        console.warn(
          `[facts] semantic search unavailable, serving keyword results only (${describeError(error)})`,
        );
        return null;
      }),
      ctx.runQuery(internal.models.facts.private.searchByText, {
        userId: args.userId,
        query,
        limit: CANDIDATE_CAP,
        includeHistorical: args.includeHistorical,
        activeAt,
      }),
    ]);

  if (embedding === null) {
    return textHits.slice(0, limit);
  }

  const vectorHits = await ctx.vectorSearch("facts", "by_embedding", {
    vector: embedding,
    // Current-only reads discard superseded and out-of-window candidates
    // after hydration, so they draw a deeper pool to keep the limit filled.
    limit: args.includeHistorical ? CANDIDATE_CAP : CANDIDATE_CAP * 4,
    filter: (q) => q.eq("userId", args.userId),
  });

  const vectorRows: HydratedFact[] = await ctx.runQuery(
    internal.models.facts.private.getRetrievableByIds,
    {
      userId: args.userId,
      ids: vectorHits.map((hit) => hit._id),
      includeHistorical: args.includeHistorical,
      activeAt,
    },
  );

  const rowById = new Map<string, HydratedFact>();
  for (const row of vectorRows) rowById.set(row.id as string, row);
  for (const row of textHits) rowById.set(row.id as string, row);
  const retrievableVectorIds = new Set(
    vectorRows.map((row) => row.id as string),
  );

  // Reciprocal Rank Fusion uses one-based ranks: score = Σ 1 / (K + rank).
  const rrf = new Map<string, number>();
  const retrievableVectorHits = vectorHits.filter((hit) =>
    retrievableVectorIds.has(hit._id as string),
  );
  retrievableVectorHits.forEach((hit, rank) => {
    const id = hit._id as string;
    rrf.set(id, (rrf.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  });
  textHits.forEach((row, rank) => {
    const id = row.id as string;
    rrf.set(id, (rrf.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
  });

  return [...rrf.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => rowById.get(id))
    .filter((row): row is HydratedFact => row !== undefined);
}

export type RecalledFact = {
  id: string;
  statement: string;
  status: string;
  source: "exact" | "core" | "relevant";
};

/**
 * The fact half of the blend `recall_context` serves: facts about entities the
 * query names, core facts, and facts relevant to the query, fetched the way
 * the tool fetches them — three independent reads, `exactLimit` exact hits
 * best match first, `coreLimit` core facts newest first and `limit` fused
 * hits in rank order. A limit of zero skips that read, as the tool does when
 * the window has no slot for the tier.
 *
 * Rows are deliberately not deduplicated across the sources. The tool hands
 * all three lists to `blendRecallContext`, which drops a core or relevant hit
 * only when it duplicates a fact the blend actually selected from an earlier
 * tier. Deduplicating here against every fact fetched would drop a fact that
 * ranked in a later tier but was not selected in the earlier one, and the
 * harness would then score a window no client receives.
 */
export async function recallFacts(
  ctx: ActionCtx,
  args: {
    userId: Id<"users">;
    query: string;
    limit?: number;
    coreLimit?: number;
    exactLimit?: number;
    includeHistorical?: boolean;
  },
): Promise<RecalledFact[]> {
  const coreLimit = args.coreLimit ?? DEFAULT_RECALL_CANDIDATES;
  const exactLimit = args.exactLimit ?? DEFAULT_RECALL_CANDIDATES;
  const [exact, core, relevant]: [
    HydratedFact[],
    HydratedFact[],
    HydratedFact[],
  ] = await Promise.all([
    exactLimit === 0
      ? Promise.resolve([])
      : ctx.runQuery(internal.models.facts.private.recallExactByUser, {
          userId: args.userId,
          query: args.query,
          limit: exactLimit,
        }),
    coreLimit === 0
      ? Promise.resolve([])
      : ctx.runQuery(internal.models.facts.private.listCoreByUser, {
          userId: args.userId,
          limit: coreLimit,
        }),
    hybridSearchFacts(ctx, {
      userId: args.userId,
      query: args.query,
      limit: args.limit ?? DEFAULT_RECALL_CANDIDATES,
      includeHistorical: args.includeHistorical,
    }),
  ]);

  const row =
    (source: RecalledFact["source"]) =>
    (fact: HydratedFact): RecalledFact => ({
      id: fact.id as string,
      statement: fact.statement,
      status: fact.status,
      source,
    });
  return [
    ...exact.map(row("exact")),
    ...core.map(row("core")),
    ...relevant.map(row("relevant")),
  ];
}

/** `recallFacts` as a runnable function, for tests and operator inspection. */
export const recall = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
    limit: v.optional(v.number()),
    coreLimit: v.optional(v.number()),
    exactLimit: v.optional(v.number()),
    includeHistorical: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      statement: v.string(),
      status: v.string(),
      source: v.union(
        v.literal("exact"),
        v.literal("core"),
        v.literal("relevant"),
      ),
    }),
  ),
  handler: async (ctx, args): Promise<RecalledFact[]> => {
    return await recallFacts(ctx, args);
  },
});
