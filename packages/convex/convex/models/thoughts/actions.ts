"use node";

import { internalAction } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { v, type Infer } from "convex/values";
import { thoughtMetadata, thoughtType } from "./validators";
import {
  SIMILARITY_THRESHOLD,
  MAX_CANDIDATES,
} from "./classify";

type ClassificationResponse = {
  operations: Array<{
    action: "UPDATE" | "DELETE";
    thoughtId: string;
    reason: string;
    mergedContent?: string;
  }>;
  addNew: boolean;
};

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
    // Step 1: Generate embedding for the new content
    const embedding = await ctx.runAction(
      internal.models.thoughts.helpers.generateEmbedding,
      { text: args.content },
    );

    // Start metadata extraction in parallel with vector search
    const metadataPromise = ctx.runAction(
      internal.models.thoughts.helpers.extractMetadata,
      { text: args.content },
    );
    void metadataPromise.catch(() => undefined);

    // Step 2: Search for similar existing thoughts
    const similarResults = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 256,
      filter: (q) => q.eq("userId", args.userId),
    });

    const candidates = similarResults
      .filter((r) => r._score >= SIMILARITY_THRESHOLD)
      .slice(0, MAX_CANDIDATES);

    // Step 3: If similar thoughts found, classify
    let classification: ClassificationResponse | null = null;
    if (candidates.length > 0) {
      // Fetch full documents for candidates
      const candidateDocs = await Promise.all(
        candidates.map(async (r) => {
          const doc = await ctx.runQuery(
            internal.models.thoughts.private.getById,
            { id: r._id },
          );
          return doc
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

      const validCandidates = candidateDocs.filter(
        (d): d is NonNullable<typeof d> => d !== null,
      );

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

    // Step 4: Execute operations
    const summaryParts: string[] = [];
    let forceAddNew = false;
    let updatedThoughtId: string | undefined;

    if (classification && classification.operations.length > 0) {
      for (const op of classification.operations) {
        if (op.action === "UPDATE") {
          try {
            const contentToStore = op.mergedContent ?? args.content;

            // Log previous content for safety during rollout
            const existing = await ctx.runQuery(
              internal.models.thoughts.private.getById,
              { id: op.thoughtId as any },
            );
            if (existing) {
              console.log(
                `[Smart Save] Overwriting thought ${op.thoughtId}. Previous content: ${existing.content}`,
              );
            }

            // Re-embed and re-extract metadata for the updated content
            const [newEmbedding, newMetadata] = await Promise.all([
              ctx.runAction(
                internal.models.thoughts.helpers.generateEmbedding,
                { text: contentToStore },
              ),
              ctx.runAction(
                internal.models.thoughts.helpers.extractMetadata,
                { text: contentToStore },
              ),
            ]);

            await ctx.runMutation(
              internal.models.thoughts.private.updateOne,
              {
                id: op.thoughtId as any,
                content: contentToStore,
                embedding: newEmbedding,
                metadata: newMetadata,
                updatedAt: Date.now(),
              },
            );
            updatedThoughtId = op.thoughtId;
            summaryParts.push(`Updated 1 existing thought (${op.reason})`);
          } catch (error) {
            // Per spec: if UPDATE fails, keep old thought unchanged
            // and force-add the new content as a separate thought
            console.error(
              `[Smart Save] UPDATE failed for thought ${op.thoughtId}, will ADD instead:`,
              error,
            );
            forceAddNew = true;
          }
        } else if (op.action === "DELETE") {
          try {
            console.log(
              `[Smart Save] Deleting thought ${op.thoughtId}. Reason: ${op.reason}`,
            );
            await ctx.runMutation(
              internal.models.thoughts.private.deleteOne,
              { id: op.thoughtId as any },
            );
            summaryParts.push(`Removed 1 redundant thought (${op.reason})`);
          } catch (error) {
            // DELETE failure is non-fatal — log and continue
            console.error(
              `[Smart Save] DELETE failed for thought ${op.thoughtId}, skipping:`,
              error,
            );
          }
        }
      }
    }

    // Step 5: Add new thought if needed
    let thoughtId: any;
    let metadata: any;

    const shouldAddNew =
      !classification ||
      classification.addNew !== false ||
      forceAddNew;

    if (shouldAddNew) {
      metadata = await metadataPromise;

      thoughtId = await ctx.runMutation(
        internal.models.thoughts.private.insertOne,
        {
          content: args.content,
          embedding,
          metadata,
          userId: args.userId,
        },
      );
    } else if (updatedThoughtId) {
      // addNew is false and UPDATE succeeded — return the updated thought
      const updated = await ctx.runQuery(
        internal.models.thoughts.private.getById,
        { id: updatedThoughtId as any },
      );
      thoughtId = updatedThoughtId;
      metadata = updated?.metadata ?? {
        type: "reference" as const,
        topics: [],
        people: [],
        actionItems: [],
        summary: args.content.slice(0, 100),
      };
    } else {
      // NOOP: addNew is false, no UPDATE ops (content already captured)
      // Return the top similarity candidate
      const topCandidate = candidates[0];
      if (topCandidate) {
        const existing = await ctx.runQuery(
          internal.models.thoughts.private.getById,
          { id: topCandidate._id },
        );
        if (existing) {
          thoughtId = topCandidate._id;
          metadata = existing.metadata;
          summaryParts.push("Thought already captured — no changes made");
        } else {
          // Candidate no longer exists (e.g. just deleted); add as new.
          metadata = await metadataPromise;
          thoughtId = await ctx.runMutation(
            internal.models.thoughts.private.insertOne,
            {
              content: args.content,
              embedding,
              metadata,
              userId: args.userId,
            },
          );
        }
      } else {
        // Safety fallback: no candidates available, add as new
        metadata = await metadataPromise;

        thoughtId = await ctx.runMutation(
          internal.models.thoughts.private.insertOne,
          {
            content: args.content,
            embedding,
            metadata,
            userId: args.userId,
          },
        );
      }
    }

    const operationSummary =
      summaryParts.length > 0 ? summaryParts.join(". ") : undefined;

    return { thoughtId, metadata, operationSummary };
  },
});

export const hybridSearch = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
    type: v.optional(thoughtType),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      content: v.string(),
      metadata: thoughtMetadata,
      score: v.float64(),
      createdAt: v.number(),
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
        limit: candidateCap,
        filter: (q) => q.eq("userId", args.userId),
      }),
      ctx.runQuery(internal.models.thoughts.private.searchByText, {
        userId: args.userId,
        query: args.query,
        type: args.type,
        limit: candidateCap,
      }),
    ]);

    // If type filter is set, we need vector hits' types too. Convex
    // vectorSearch does not support filtering on object fields like
    // metadata.type, so we post-filter. Text hits already respect the
    // type filter. Batch-fetch via getByIds to avoid N+1 round-trips.
    let filteredVectorHits = vectorHits;
    if (args.type) {
      const vectorIds = vectorHits.map((h) => h._id);
      const fetchedDocs: Array<{
        _id: Id<"thoughts">;
        _creationTime: number;
        content: string;
        metadata: Infer<typeof thoughtMetadata>;
        userId: string;
        updatedAt?: number;
      }> = await ctx.runQuery(
        internal.models.thoughts.private.getByIds,
        { ids: vectorIds },
      );
      const docById = new Map(fetchedDocs.map((d) => [d._id as string, d]));
      filteredVectorHits = vectorHits.filter(
        (h) => docById.get(h._id)?.metadata.type === args.type,
      );
    }

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
    }> = await ctx.runQuery(
      internal.models.thoughts.private.getByIds,
      { ids: rankedIds as Array<Id<"thoughts">> },
    );
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
            }
          : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
  },
});
