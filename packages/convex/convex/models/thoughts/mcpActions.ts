"use node";

import { action } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import { v } from "convex/values";
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
