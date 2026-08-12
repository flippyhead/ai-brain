import { mutation } from "../../_generated/server";
import { v } from "convex/values";

import { requireMcpUserId } from "../../lib/mcpAuth";
import { rememberFact } from "./model";
import { entitySelector, factSourceType, factValueInput } from "./validators";

export const remember = mutation({
  args: {
    subject: entitySelector,
    predicate: v.string(),
    value: factValueInput,
    sourceType: factSourceType,
    sourceRef: v.optional(v.string()),
    observedAt: v.optional(v.number()),
    batchId: v.optional(v.string()),
    isCore: v.optional(v.boolean()),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    cardinality: v.optional(
      v.union(v.literal("single"), v.literal("multiple")),
    ),
    changeKind: v.optional(
      v.union(v.literal("changed"), v.literal("corrected")),
    ),
    changeReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    return await rememberFact(ctx, userId, args);
  },
});
