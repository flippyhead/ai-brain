import { query, mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { _listByUser, _insertOne, _deleteOne } from "./model";

export const list = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("apiKeys"),
      _creationTime: v.number(),
      keyPrefix: v.string(),
      name: v.string(),
      lastUsedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const keys = await _listByUser(ctx, userId);
    return keys.map((k) => ({
      _id: k._id,
      _creationTime: k._creationTime,
      keyPrefix: k.keyPrefix,
      name: k.name,
      lastUsedAt: k.lastUsedAt,
    }));
  },
});

export const create = mutation({
  args: { name: v.string() },
  returns: v.object({
    id: v.id("apiKeys"),
    rawKey: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Generate a random API key
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const rawKey =
      "ob_" +
      Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    // Hash it for storage
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const keyPrefix = rawKey.slice(0, 11); // "ob_" + first 8 hex chars

    const id = await _insertOne(ctx, {
      userId,
      keyHash,
      keyPrefix,
      name: args.name,
    });

    // rawKey is returned ONCE — never stored or retrievable again
    return { id, rawKey };
  },
});

export const revoke = mutation({
  args: { id: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const key = await ctx.db.get(args.id);
    if (!key || key.userId !== userId) {
      throw new Error("API key not found");
    }

    await _deleteOne(ctx, args.id);
    return null;
  },
});
