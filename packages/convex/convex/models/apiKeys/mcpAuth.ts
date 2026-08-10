import { v } from "convex/values";

import { internal as _internal } from "../../_generated/api";
import { action } from "../../_generated/server";

// Avoid a generated API inference cycle: this public action calls internal
// functions from the same module tree.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

// This is the only unauthenticated Convex function exposed to the MCP gateway.
// It accepts a one-way key hash, resolves it through internal functions, and
// returns the user identity that the gateway will bind into a short-lived JWT.
export const authenticateKeyHash = action({
  args: { keyHash: v.string() },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      keyId: v.id("apiKeys"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const apiKey = await ctx.runQuery(
      internal.models.apiKeys.private.findByHash,
      { keyHash: args.keyHash },
    );
    if (!apiKey) return null;

    await ctx.runMutation(internal.models.apiKeys.private.updateLastUsed, {
      id: apiKey._id,
    });

    return { userId: apiKey.userId, keyId: apiKey._id };
  },
});
