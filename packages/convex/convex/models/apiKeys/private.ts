import { internalQuery, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { _findByHash } from "./model";

export const findByHash = internalQuery({
  args: { keyHash: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("apiKeys"),
      _creationTime: v.number(),
      userId: v.id("users"),
      keyHash: v.string(),
      keyPrefix: v.string(),
      name: v.string(),
      lastUsedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await _findByHash(ctx, args.keyHash);
  },
});

export const updateLastUsed = internalMutation({
  args: { id: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { lastUsedAt: Date.now() });
    return null;
  },
});
