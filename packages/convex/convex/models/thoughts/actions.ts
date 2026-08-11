"use node";

import { internalAction } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { v, type Infer } from "convex/values";
import { SIMILARITY_THRESHOLD, MAX_CANDIDATES } from "./classify";
import {
  isCurrentMemory,
  type MemoryClassification,
  type MemoryStatus,
} from "./memoryLifecycle";
import { memoryStatus, thoughtMetadata, thoughtType } from "./validators";

// Break circular type inference — actions.ts exports are part of `internal`'s type,
// so referencing `internal` here creates a cycle. Runtime behavior is unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

export const captureThought = internalAction({
  args: {
    userId: v.id("users"),
    content: v.string(),
  },
  returns: v.object({
    thoughtId: v.id("thoughts"),
    metadata: thoughtMetadata,
    operationSummary: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const embedding = await ctx.runAction(
      internal.models.thoughts.helpers.generateEmbedding,
      { text: args.content },
    );

    const similarResults = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 256,
      filter: (q) => q.eq("userId", args.userId),
    });

    const candidates = similarResults
      .filter((r) => r._score >= SIMILARITY_THRESHOLD)
      .slice(0, MAX_CANDIDATES * 5);

    let classification: MemoryClassification | null = null;
    if (candidates.length > 0) {
      const candidateDocs = await Promise.all(
        candidates.map(async (r) => {
          const doc = await ctx.runQuery(
            internal.models.thoughts.private.getById,
            { id: r._id },
          );
          return doc &&
            doc.userId === args.userId &&
            isCurrentMemory(doc.memoryStatus)
            ? {
                _id: r._id as string,
                content: doc.content,
                metadata: {
                  type: doc.metadata.type,
                  topics: doc.metadata.topics,
                  people: doc.metadata.people,
                  summary: doc.metadata.summary,
                },
                createdAt: doc._creationTime,
              }
            : null;
        }),
      );

      const validCandidates = candidateDocs
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .slice(0, MAX_CANDIDATES);

      if (validCandidates.length > 0) {
        try {
          classification = await ctx.runAction(
            internal.models.thoughts.classify.classifyThought,
            { newContent: args.content, candidates: validCandidates },
          );
        } catch (error) {
          console.error(
            "[Smart Save] Classification failed, falling back to ADD:",
            error,
          );
          classification = null;
        }
      }
    }

    if (classification?.action === "NOOP") {
      const existingId = classification.relatedThoughtIds[0] as
        Id<"thoughts"> | undefined;
      const existing = existingId
        ? await ctx.runQuery(internal.models.thoughts.private.getById, {
            id: existingId,
          })
        : null;
      if (
        existing &&
        existing.userId === args.userId &&
        isCurrentMemory(existing.memoryStatus)
      ) {
        return {
          thoughtId: existing._id,
          metadata: existing.metadata,
          operationSummary: "Thought already captured — no changes made",
        };
      }
      classification = null;
    }

    if (
      classification?.action === "SUPERSEDE" ||
      classification?.action === "RETRACT"
    ) {
      const replacementContent = classification.replacementContent;
      if (replacementContent) {
        try {
          const [replacementEmbedding, replacementMetadata] = await Promise.all(
            [
              ctx.runAction(
                internal.models.thoughts.helpers.generateEmbedding,
                { text: replacementContent },
              ),
              ctx.runAction(internal.models.thoughts.helpers.extractMetadata, {
                text: replacementContent,
              }),
            ],
          );

          const thoughtId: Id<"thoughts"> = await ctx.runMutation(
            internal.models.thoughts.private.transitionMemory,
            {
              content: replacementContent,
              embedding: replacementEmbedding,
              metadata: replacementMetadata,
              userId: args.userId,
              previousIds: classification.relatedThoughtIds as Array<
                Id<"thoughts">
              >,
              previousStatus:
                classification.action === "SUPERSEDE"
                  ? "superseded"
                  : "retracted",
              reason: classification.reason,
              transitionedAt: Date.now(),
            },
          );
          const count = classification.relatedThoughtIds.length;
          const operationSummary =
            classification.action === "SUPERSEDE"
              ? "Stored the new current memory and preserved " +
                count +
                (count === 1
                  ? " previous memory as historical"
                  : " previous memories as historical")
              : "Stored the correction and marked " +
                count +
                (count === 1
                  ? " previous memory as inaccurate"
                  : " previous memories as inaccurate");

          return {
            thoughtId,
            metadata: replacementMetadata,
            operationSummary,
          };
        } catch (error) {
          console.error(
            "[Smart Save] Memory transition failed; falling back to ADD",
            error,
          );
        }
      }
    }

    const metadata: Infer<typeof thoughtMetadata> = await ctx.runAction(
      internal.models.thoughts.helpers.extractMetadata,
      { text: args.content },
    );
    const thoughtId: Id<"thoughts"> = await ctx.runMutation(
      internal.models.thoughts.private.insertOne,
      {
        content: args.content,
        embedding,
        metadata,
        userId: args.userId,
      },
    );

    return { thoughtId, metadata };
  },
});

export const hybridSearch = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
    type: v.optional(thoughtType),
    limit: v.optional(v.number()),
    includeHistorical: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      content: v.string(),
      metadata: thoughtMetadata,
      score: v.float64(),
      createdAt: v.number(),
      memoryStatus,
      supersededAt: v.optional(v.number()),
      changeReason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const candidateCap = 50;
    const K = 60; // RRF constant

    // Generate embedding once; run vector + text in parallel
    const embedding = await ctx.runAction(
      internal.models.thoughts.helpers.generateEmbedding,
      { text: args.query },
    );

    const [vectorHits, textHits] = await Promise.all([
      ctx.vectorSearch("thoughts", "by_embedding", {
        vector: embedding,
        limit: args.includeHistorical ? candidateCap : candidateCap * 4,
        filter: (q) => q.eq("userId", args.userId),
      }),
      ctx.runQuery(internal.models.thoughts.private.searchByText, {
        userId: args.userId,
        query: args.query,
        type: args.type,
        limit: candidateCap,
        includeHistorical: args.includeHistorical,
      }),
    ]);

    // Vector indexes cannot filter optional lifecycle fields, so hydrate once
    // and post-filter historical results. Text hits are filtered in their query.
    const vectorIds = vectorHits.map((hit) => hit._id);
    const fetchedDocs: Array<{
      _id: Id<"thoughts">;
      _creationTime: number;
      content: string;
      metadata: Infer<typeof thoughtMetadata>;
      userId: string;
      updatedAt?: number;
      memoryStatus?: MemoryStatus;
      supersededAt?: number;
      changeReason?: string;
    }> = await ctx.runQuery(internal.models.thoughts.private.getByIds, {
      ids: vectorIds,
    });
    const docById = new Map(fetchedDocs.map((doc) => [doc._id as string, doc]));
    const filteredVectorHits = vectorHits.filter((hit) => {
      const doc = docById.get(hit._id);
      return (
        doc !== undefined &&
        (args.type === undefined || doc.metadata.type === args.type) &&
        (args.includeHistorical || isCurrentMemory(doc.memoryStatus))
      );
    });

    // Reciprocal Rank Fusion: score = Σ 1 / (K + rank) across result lists
    const rrf = new Map<string, number>();
    filteredVectorHits.forEach((h, rank) => {
      rrf.set(h._id, (rrf.get(h._id) ?? 0) + 1 / (K + rank));
    });
    // Cast narrows textHits to _id only; upstream `internal as any` collapses the runQuery return type.
    (textHits as Array<{ _id: string }>).forEach((h, rank) => {
      rrf.set(h._id, (rrf.get(h._id) ?? 0) + 1 / (K + rank));
    });

    const rankedIds = [...rrf.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

    // Hydrate final ranked results with a single batch query.
    const hydrated: Array<{
      _id: Id<"thoughts">;
      _creationTime: number;
      content: string;
      metadata: Infer<typeof thoughtMetadata>;
      userId: string;
      updatedAt?: number;
      memoryStatus?: MemoryStatus;
      supersededAt?: number;
      changeReason?: string;
    }> = await ctx.runQuery(internal.models.thoughts.private.getByIds, {
      ids: rankedIds as Array<Id<"thoughts">>,
    });
    const hydratedById = new Map(hydrated.map((d) => [d._id as string, d]));

    return rankedIds
      .map((id) => {
        const doc = hydratedById.get(id);
        return doc
          ? {
              _id: doc._id,
              content: doc.content,
              metadata: doc.metadata,
              score: rrf.get(id)!,
              createdAt: doc._creationTime,
              memoryStatus: doc.memoryStatus ?? "current",
              supersededAt: doc.supersededAt,
              changeReason: doc.changeReason,
            }
          : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  },
});
