import { query, mutation } from "../../_generated/server";
import { v } from "convex/values";
import { _findByHash } from "./model";

// Public query for MCP API key validation.
// Takes a SHA-256 hash (not the raw key) so it's safe to expose.
export const validateKeyHash = query({
  args: { keyHash: v.string() },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      keyId: v.id("apiKeys"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const apiKey = await _findByHash(ctx, args.keyHash);
    if (!apiKey) return null;
    return { userId: apiKey.userId, keyId: apiKey._id };
  },
});

// Public mutation for updating last-used timestamp.
export const touchKey = mutation({
  args: { keyId: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.keyId);
    if (key) {
      await ctx.db.patch(args.keyId, { lastUsedAt: Date.now() });
    }
    return null;
  },
});
