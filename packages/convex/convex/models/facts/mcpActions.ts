import { action, mutation } from "../../_generated/server";
import { v } from "convex/values";

import { requireMcpUserId } from "../../lib/mcpAuth";
import { hybridSearchFacts, rememberFactWithEmbedding } from "./actions";
import { forgetEntity, forgetFact, type HydratedFact } from "./model";
import { factOperation, rememberFactArgs } from "./validators";

/**
 * `remember_fact`. An action rather than a mutation because the fact's search
 * text is embedded after it is stored, and embedding needs the network. The
 * fact commits even when the embedding provider does not answer.
 */
export const remember = action({
  args: rememberFactArgs,
  returns: v.object({
    factId: v.id("facts"),
    statement: v.string(),
    operation: factOperation,
  }),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    return await rememberFactWithEmbedding(ctx, userId, args);
  },
});

/**
 * `search_facts` and the fact half of `recall_context`: vector and keyword
 * hits fused by rank. `mcpQueries.search` remains the keyword-only path.
 */
export const search = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    includeHistorical: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<HydratedFact[]> => {
    const userId = await requireMcpUserId(ctx);
    return await hybridSearchFacts(ctx, {
      userId,
      query: args.query,
      limit: args.limit,
      includeHistorical: args.includeHistorical,
    });
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

/**
 * One batch of an entity forget. Returns `done: false` while facts remain;
 * call again with the same arguments until `done` is true, at which point the
 * entity row is gone and a further call reports not found.
 */
export const forgetEntityWithFacts = mutation({
  args: {
    entityId: v.id("entities"),
    reason: v.string(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    done: v.boolean(),
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
    return await forgetEntity(
      ctx,
      userId,
      args.entityId,
      args.reason,
      args.batchSize,
    );
  },
});
