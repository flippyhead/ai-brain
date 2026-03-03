"use node";

import { action } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { thoughtMetadata } from "./validators";

export const capture = action({
  args: { content: v.string() },
  returns: v.object({
    thoughtId: v.id("thoughts"),
    metadata: thoughtMetadata,
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.runAction(
      internal.models.thoughts.actions.captureThought,
      { userId, content: args.content },
    );
  },
});

export const search = action({
  args: {
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.runAction(
      internal.models.thoughts.actions.searchByVector,
      {
        userId,
        query: args.query,
        threshold: args.threshold,
        limit: args.limit,
      },
    );
  },
});
