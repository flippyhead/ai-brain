"use node";

import { internalAction } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import { v } from "convex/values";
import { thoughtMetadata } from "./validators";

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
  }),
  handler: async (ctx, args) => {
    // Run embedding and metadata extraction in parallel
    const [embedding, metadata] = await Promise.all([
      ctx.runAction(internal.models.thoughts.helpers.generateEmbedding, {
        text: args.content,
      }),
      ctx.runAction(internal.models.thoughts.helpers.extractMetadata, {
        text: args.content,
      }),
    ]);

    const thoughtId = await ctx.runMutation(
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
