import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

import {
  exportCollectionPage,
  exportCounts,
  MAX_EXPORT_PAGE_SIZE,
} from "./model";

/**
 * Admin-invoked export surface, reached with a deployment key through
 * `convex run` — the same path `models/thoughts/evalRecall` uses.
 *
 * These are internal functions on purpose. They take a `userId` argument, which
 * no client-facing function in this codebase is allowed to do: MCP and web
 * functions derive the account from a verified identity precisely so a caller
 * cannot name someone else's account. Exposing that argument is only safe
 * behind a deployment key, where the caller already controls the deployment.
 */

const collection = v.union(
  v.literal("thoughts"),
  v.literal("facts"),
  v.literal("entities"),
  v.literal("lists"),
  v.literal("listItems"),
);

/**
 * Accounts on this deployment, with enough detail to pick one.
 *
 * An export needs a `userId` and the operator generally does not have one
 * memorised. Returns identifiers only — no memory content — so listing accounts
 * never discloses what is in them.
 */
export const listAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return await Promise.all(
      users.map(async (user) => {
        const thoughts = await ctx.db
          .query("thoughts")
          .withIndex("by_userId", (q) => q.eq("userId", user._id))
          .collect();
        const facts = await ctx.db
          .query("facts")
          .withIndex("by_userId", (q) => q.eq("userId", user._id))
          .collect();
        return {
          userId: user._id,
          name: user.name,
          email: user.email,
          thoughts: thoughts.length,
          facts: facts.length,
        };
      }),
    );
  },
});

export const counts = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => await exportCounts(ctx, args.userId),
});

export const collectionPage = internalQuery({
  args: {
    userId: v.id("users"),
    collection,
    after: v.optional(v.number()),
    pageSize: v.optional(v.number()),
    includeHistorical: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.pageSize !== undefined && args.pageSize > MAX_EXPORT_PAGE_SIZE) {
      throw new Error(`Export page size cannot exceed ${MAX_EXPORT_PAGE_SIZE}`);
    }
    return await exportCollectionPage(ctx, args.userId, args);
  },
});
