import { v } from "convex/values";

import { mutation } from "../../_generated/server";
import { requireMcpUserId } from "../../lib/mcpAuth";
import { _setRetracted } from "./model";

export const retractThought = mutation({
  args: {
    thoughtId: v.id("thoughts"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    await _setRetracted(
      ctx,
      userId,
      args.thoughtId,
      true,
      args.reason,
      Date.now(),
    );
    return null;
  },
});

export const restoreThought = mutation({
  args: { thoughtId: v.id("thoughts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    await _setRetracted(
      ctx,
      userId,
      args.thoughtId,
      false,
      undefined,
      Date.now(),
    );
    return null;
  },
});
