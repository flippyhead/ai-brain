"use node";

import { action } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { v, type Infer } from "convex/values";
import { thoughtMetadata } from "./validators";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

// Public actions for MCP endpoint — accept userId as parameter
// (auth is handled by API key validation in the Next.js API route)

export const capture = action({
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
    return await ctx.runAction(
      internal.models.thoughts.actions.captureThought,
      { userId: args.userId, content: args.content },
    );
  },
});

export const search = action({
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
    return await ctx.runAction(
      internal.models.thoughts.actions.searchByVector,
      {
        userId: args.userId,
        query: args.query,
        threshold: args.threshold,
        limit: args.limit,
      },
    );
  },
});

export const getByIds = action({
  args: {
    userId: v.id("users"),
    ids: v.array(v.id("thoughts")),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      content: v.string(),
      metadata: thoughtMetadata,
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const docs: Array<{
      _id: Id<"thoughts">;
      _creationTime: number;
      content: string;
      metadata: Infer<typeof thoughtMetadata>;
      userId: string;
      updatedAt?: number;
    }> = await ctx.runQuery(
      internal.models.thoughts.private.getByIds,
      { ids: args.ids },
    );

    // Enforce ownership — drop any doc that doesn't belong to caller
    return docs
      .filter((d) => d.userId === args.userId)
      .map((d) => ({
        _id: d._id,
        content: d.content,
        metadata: d.metadata,
        createdAt: d._creationTime,
        updatedAt: d.updatedAt,
      }));
  },
});
