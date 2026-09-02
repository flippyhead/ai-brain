import { action } from "../../_generated/server";
import { v } from "convex/values";

import { requireMcpUserId } from "../../lib/mcpAuth";
import { hybridSearchFacts, rememberFactWithEmbedding } from "./actions";
import type { HydratedFact } from "./model";
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
