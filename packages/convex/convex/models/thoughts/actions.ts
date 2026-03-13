"use node";

import { internalAction } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import { v } from "convex/values";
import { thoughtMetadata } from "./validators";
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
        classification = await ctx.runAction(
          internal.models.thoughts.classify.classifyThought,
          { newContent: args.content, candidates: validCandidates },
        );
      }
    }

    // Step 4: Execute operations
    const summaryParts: string[] = [];

    if (classification && classification.operations.length > 0) {
      for (const op of classification.operations) {
        if (op.action === "UPDATE") {
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
          summaryParts.push(`Updated 1 existing thought (${op.reason})`);
        } else if (op.action === "DELETE") {
          console.log(
            `[Smart Save] Deleting thought ${op.thoughtId}. Reason: ${op.reason}`,
          );
          await ctx.runMutation(
            internal.models.thoughts.private.deleteOne,
            { id: op.thoughtId as any },
          );
          summaryParts.push(`Removed 1 redundant thought (${op.reason})`);
        }
      }
    }

    // Step 5: Add new thought if needed
    let thoughtId: any;
    let metadata: any;

    if (!classification || classification.addNew !== false) {
      metadata = await ctx.runAction(
        internal.models.thoughts.helpers.extractMetadata,
        { text: args.content },
      );

      thoughtId = await ctx.runMutation(
        internal.models.thoughts.private.insertOne,
        {
          content: args.content,
          embedding,
          metadata,
          userId: args.userId,
        },
      );
    } else {
      // addNew is false — content was merged into an existing thought
      // Return the first updated thought's ID and re-fetch its metadata
      const updatedId = classification.operations.find(
        (op) => op.action === "UPDATE",
      )?.thoughtId;

      if (updatedId) {
        const updated = await ctx.runQuery(
          internal.models.thoughts.private.getById,
          { id: updatedId as any },
        );
        thoughtId = updatedId;
        metadata = updated?.metadata ?? {
          type: "reference" as const,
          topics: [],
          people: [],
          actionItems: [],
          summary: args.content.slice(0, 100),
        };
      } else {
        // Shouldn't happen, but fallback: just add it
        metadata = await ctx.runAction(
          internal.models.thoughts.helpers.extractMetadata,
          { text: args.content },
        );

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

export const searchByVector = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
    threshold: v.optional(v.number()),
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
    const threshold = args.threshold ?? 0.5;
    const limit = args.limit ?? 10;

    const embedding = await ctx.runAction(
      internal.models.thoughts.helpers.generateEmbedding,
      { text: args.query },
    );

    const results = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 256,
      filter: (q) => q.eq("userId", args.userId),
    });

    // Post-filter by threshold and limit
    const filtered = results
      .filter((r) => r._score >= threshold)
      .slice(0, limit);

    // Fetch full documents
    const docs = await Promise.all(
      filtered.map(async (r) => {
        const doc = await ctx.runQuery(
          internal.models.thoughts.private.getById,
          { id: r._id },
        );
        return doc
          ? {
              _id: r._id,
              content: doc.content,
              metadata: doc.metadata,
              score: r._score,
              createdAt: doc._creationTime,
            }
          : null;
      }),
    );

    return docs.filter((d): d is NonNullable<typeof d> => d !== null);
  },
});
