import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";

import {
  getRetrievableFacts,
  listFacts,
  rememberFact as rememberFactModel,
  searchFacts,
  setFactEmbedding,
} from "./model";
import { rememberFactArgs } from "./validators";

/** How many current facts are offered to the narrative admission gate. */
const COVERAGE_CANDIDATES = 5;

/**
 * Current facts whose text overlaps a narrative capture.
 *
 * Structured storage owns the predicates it records, so the admission gate
 * needs to see them before deciding whether narrative content is new. Without
 * this the two stores can each hold a current value for the same predicate and
 * blended recall has to arbitrate between them at query time.
 */
export const searchCoveringFacts = internalQuery({
  args: {
    userId: v.id("users"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({ id: v.string(), statement: v.string() })),
  handler: async (ctx, args) => {
    const facts = await searchFacts(ctx, args.userId, args.query, {
      limit: args.limit ?? COVERAGE_CANDIDATES,
    });
    return facts.map((fact) => ({
      id: fact.id as string,
      statement: fact.statement,
    }));
  },
});

/**
 * The keyword half of fused fact search. Lifecycle filtering happens inside
 * the query, so every row returned is one the caller may serve.
 */
export const searchByText = internalQuery({
  args: {
    userId: v.id("users"),
    query: v.string(),
    limit: v.optional(v.number()),
    includeHistorical: v.optional(v.boolean()),
    activeAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await searchFacts(ctx, args.userId, args.query, {
      limit: args.limit,
      includeHistorical: args.includeHistorical,
      activeAt: args.activeAt,
    });
  },
});

/**
 * Hydrates vector-search candidates, dropping any the read may not return.
 * The vector index filters on account, but ownership is re-checked here as
 * defence in depth, and the optional lifecycle fields can only be applied
 * after the row is in hand.
 */
export const getRetrievableByIds = internalQuery({
  args: {
    userId: v.id("users"),
    ids: v.array(v.id("facts")),
    includeHistorical: v.optional(v.boolean()),
    activeAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await getRetrievableFacts(ctx, args.userId, args.ids, {
      includeHistorical: args.includeHistorical,
      activeAt: args.activeAt,
    });
  },
});

export const listCoreByUser = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await listFacts(ctx, args.userId, {
      limit: args.limit,
      coreOnly: true,
    });
  },
});

/**
 * Commits a fact for a known account. The embedding is attached afterwards by
 * `actions.ts`, so the write itself never depends on the embedding provider.
 */
export const rememberFact = internalMutation({
  args: { userId: v.id("users"), ...rememberFactArgs },
  handler: async (ctx, args) => {
    const { userId, ...fact } = args;
    return await rememberFactModel(ctx, userId, fact);
  },
});

export const setEmbedding = internalMutation({
  args: {
    factId: v.id("facts"),
    searchText: v.string(),
    embedding: v.array(v.float64()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await setFactEmbedding(
      ctx,
      args.factId,
      args.searchText,
      args.embedding,
    );
  },
});
