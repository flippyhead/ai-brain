import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";

import {
  listFacts,
  recallExactFacts,
  rememberFact,
  searchFacts,
} from "./model";
import { entitySelector, factSourceType, factValueInput } from "./validators";

/** How many current facts are offered to the narrative admission gate. */
const COVERAGE_CANDIDATES = 5;

/**
 * Current facts whose text overlaps a narrative capture.
 *
 * Structured storage owns the predicates it records, so the admission gate
 * needs to see them before deciding whether narrative content is new. Without
 * this the two stores can each hold a current value for the same predicate and
 * blended recall has to arbitrate between them at query time.
 */
export const searchCoveringFacts = internalQuery({
  args: {
    userId: v.id("users"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({ id: v.string(), statement: v.string() })),
  handler: async (ctx, args) => {
    const facts = await searchFacts(ctx, args.userId, args.query, {
      limit: args.limit ?? COVERAGE_CANDIDATES,
    });
    return facts.map((fact) => ({
      id: fact.id as string,
      statement: fact.statement,
    }));
  },
});

/**
 * The fact half of the blend `recall_context` serves: facts about entities
 * the query names, core facts, and facts relevant to the query, fetched the
 * way the tool fetches them — three independent reads, `exactLimit` exact
 * hits best match first, `coreLimit` core facts newest first and `limit`
 * keyword hits in index order.
 *
 * Rows are deliberately not deduplicated across the sources. The tool hands
 * all three lists to `blendRecallContext`, which drops a core or relevant hit
 * only when it duplicates a fact the blend actually selected from an earlier
 * tier. Deduplicating here against every fact fetched would drop a fact that
 * ranked in a later tier but was not selected in the earlier one, and the
 * harness would then score a window no client receives.
 */
export const recallFacts = internalQuery({
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
  handler: async (ctx, args) => {
    const [exact, core, relevant] = await Promise.all([
      recallExactFacts(ctx, args.userId, args.query, {
        limit: args.exactLimit ?? COVERAGE_CANDIDATES,
      }),
      listFacts(ctx, args.userId, {
        limit: args.coreLimit ?? COVERAGE_CANDIDATES,
        coreOnly: true,
      }),
      searchFacts(ctx, args.userId, args.query, {
        limit: args.limit ?? COVERAGE_CANDIDATES,
        includeHistorical: args.includeHistorical,
      }),
    ]);

    const row =
      (source: "exact" | "core" | "relevant") =>
      (fact: (typeof core)[number]) => ({
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
  },
});

/** Seeds a fact for the evaluation harness without going through MCP auth. */
export const seedFact = internalMutation({
  args: {
    userId: v.id("users"),
    subject: entitySelector,
    predicate: v.string(),
    value: factValueInput,
    sourceType: factSourceType,
    isCore: v.optional(v.boolean()),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    changeKind: v.optional(
      v.union(v.literal("changed"), v.literal("corrected")),
    ),
    changeReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, ...fact } = args;
    return await rememberFact(ctx, userId, fact);
  },
});
