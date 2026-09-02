import { mutation } from "../../_generated/server";
import { v } from "convex/values";

import { requireMcpUserId } from "../../lib/mcpAuth";
import { forgetEntity, forgetFact, rememberFact } from "./model";
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

export const forget = mutation({
  args: {
    factId: v.id("facts"),
    reason: v.string(),
  },
  returns: v.object({
    factId: v.id("facts"),
    reason: v.string(),
    detachedPredecessors: v.array(v.id("facts")),
    detachedSuccessor: v.optional(v.id("facts")),
  }),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    return await forgetFact(ctx, userId, args.factId, args.reason);
  },
});

export const forgetEntityWithFacts = mutation({
  args: {
    entityId: v.id("entities"),
    reason: v.string(),
  },
  returns: v.object({
    entityId: v.id("entities"),
    key: v.string(),
    reason: v.string(),
    deletedSubjectFactIds: v.array(v.id("facts")),
    deletedReferencingFacts: v.array(
      v.object({
        factId: v.id("facts"),
        subjectEntityId: v.id("entities"),
        predicate: v.string(),
      }),
    ),
    detachedPredecessors: v.array(v.id("facts")),
    detachedSuccessors: v.array(v.id("facts")),
  }),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    return await forgetEntity(ctx, userId, args.entityId, args.reason);
  },
});
