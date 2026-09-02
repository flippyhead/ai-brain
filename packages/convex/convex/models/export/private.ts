import { internalQuery } from "../../_generated/server";
import { v } from "convex/values";

import {
  boundedCount,
  exportCollectionPage,
  exportCountPage,
  EXPORT_COLLECTIONS,
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
  ...EXPORT_COLLECTIONS.map((name) => v.literal(name)),
);

/** Accounts returned per `listAccounts` call. */
export const ACCOUNT_PAGE_SIZE = 25;
/** Per-table row cap in the account listing; beyond it the count reads "N+". */
export const ACCOUNT_COUNT_CAP = 100;

function rejectOversizedPage(pageSize: number | undefined) {
  if (pageSize !== undefined && pageSize > MAX_EXPORT_PAGE_SIZE) {
    throw new Error(`Export page size cannot exceed ${MAX_EXPORT_PAGE_SIZE}`);
  }
}

/**
 * Accounts on this deployment, with enough detail to pick one.
 *
 * An export needs a `userId` and the operator generally does not have one
 * memorised. Returns identifiers only — no memory content — so listing accounts
 * never discloses what is in them. Reads are bounded on both axes: a page of
 * users at a time, and at most `ACCOUNT_COUNT_CAP + 1` rows per table per user,
 * so the listing cannot exceed a query read limit on a populated deployment.
 */
export const listAccounts = internalQuery({
  args: { after: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const after = args.after;
    const users = await ctx.db
      .query("users")
      .withIndex("by_creation_time", (q) =>
        after === undefined ? q : q.gt("_creationTime", after),
      )
      .order("asc")
      .take(ACCOUNT_PAGE_SIZE);

    const accounts = await Promise.all(
      users.map(async (user) => {
        const [thoughts, facts] = await Promise.all([
          boundedCount(ctx, "thoughts", user._id, ACCOUNT_COUNT_CAP),
          boundedCount(ctx, "facts", user._id, ACCOUNT_COUNT_CAP),
        ]);
        return {
          userId: user._id,
          name: user.name,
          email: user.email,
          thoughts,
          facts,
        };
      }),
    );

    const exhausted = users.length < ACCOUNT_PAGE_SIZE;
    return {
      accounts,
      cursor: exhausted ? null : (users.at(-1)?._creationTime ?? null),
      isDone: exhausted,
    };
  },
});

export const countPage = internalQuery({
  args: {
    userId: v.id("users"),
    collection,
    after: v.optional(v.number()),
    pageSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    rejectOversizedPage(args.pageSize);
    return await exportCountPage(ctx, args.userId, args);
  },
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
    rejectOversizedPage(args.pageSize);
    return await exportCollectionPage(ctx, args.userId, args);
  },
});
