import { action } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import { v } from "convex/values";
import { requireWebUserId } from "../../lib/webAuth";
import { memoryStatus, thoughtMetadata } from "./validators";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

export const capture = action({
  args: {
    content: v.string(),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    isCore: v.optional(v.boolean()),
  },
  returns: v.object({
    thoughtId: v.optional(v.id("thoughts")),
    metadata: thoughtMetadata,
    disposition: v.union(
      v.literal("stored"),
      v.literal("duplicate"),
      v.literal("superseded"),
      v.literal("corrected"),
      v.literal("needs_confirmation"),
      v.literal("skipped"),
    ),
    operationSummary: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const userId = await requireWebUserId(ctx);

    return await ctx.runAction(
      internal.models.thoughts.actions.captureThought,
      {
        userId,
        content: args.content,
        validFrom: args.validFrom,
        validTo: args.validTo,
        isCore: args.isCore,
        sourceType: "user_confirmed",
      },
    );
  },
});

export const search = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      content: v.string(),
      metadata: thoughtMetadata,
      score: v.float64(),
      createdAt: v.number(),
      memoryStatus,
      isCore: v.optional(v.boolean()),
      validFrom: v.optional(v.number()),
      validTo: v.optional(v.number()),
      supersededAt: v.optional(v.number()),
      changeReason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireWebUserId(ctx);

    return await ctx.runAction(internal.models.thoughts.actions.hybridSearch, {
      userId,
      query: args.query,
      limit: args.limit,
    });
  },
});
