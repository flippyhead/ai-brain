import { v } from "convex/values";

import { mutation } from "../../_generated/server";
import { requireMcpUserId } from "../../lib/mcpAuth";

const MAX_AUTHORIZATION_CODE_LIFETIME_MS = 10 * 60 * 1000;

export const consumeAuthorizationCode = mutation({
  args: {
    codeHash: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    const now = Date.now();

    if (
      !/^[a-f0-9]{64}$/.test(args.codeHash) ||
      args.expiresAt <= now ||
      args.expiresAt > now + MAX_AUTHORIZATION_CODE_LIFETIME_MS
    ) {
      throw new Error("Invalid authorization code");
    }

    const existing = await ctx.db
      .query("consumedOAuthCodes")
      .withIndex("by_codeHash", (q) => q.eq("codeHash", args.codeHash))
      .unique();
    if (existing) {
      throw new Error("Authorization code already used");
    }

    const expired = await ctx.db
      .query("consumedOAuthCodes")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(50);
    await Promise.all(expired.map((code) => ctx.db.delete(code._id)));

    await ctx.db.insert("consumedOAuthCodes", {
      userId,
      codeHash: args.codeHash,
      expiresAt: args.expiresAt,
    });
    return null;
  },
});
