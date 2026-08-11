import { v } from "convex/values";

import { internalMutation } from "../../_generated/server";

/**
 * Backfills `memoryStatus: "current"` onto memories written before the
 * temporal-memory change.
 *
 * Those rows have no `memoryStatus` at all, and read paths treat `undefined`
 * as current. That is why lifecycle filtering still runs after the read rather
 * than at an index: an index filter on `"current"` would silently drop every
 * legacy memory. Once every row carries an explicit status, the filter can
 * move to an index.
 *
 * Idempotent — only rows missing the field are touched, so re-running is a
 * no-op. Paginated so a large table cannot exceed a single mutation's limits.
 * Pass `dryRun` to count without writing.
 */
export const backfillMemoryStatus = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    needingBackfill: v.number(),
    patched: v.number(),
    isDone: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const batchSize = Math.min(Math.max(args.batchSize ?? 200, 1), 500);
    const dryRun = args.dryRun ?? false;

    const page = await ctx.db.query("thoughts").paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });

    let needingBackfill = 0;
    let patched = 0;
    for (const memory of page.page) {
      if (memory.memoryStatus !== undefined) continue;
      needingBackfill += 1;
      if (!dryRun) {
        await ctx.db.patch(memory._id, { memoryStatus: "current" });
        patched += 1;
      }
    }

    return {
      scanned: page.page.length,
      needingBackfill,
      patched,
      isDone: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/**
 * Read-only audit: how many memories still lack an explicit `memoryStatus`.
 * Run before and after the backfill; a completed migration reports zero.
 */
export const countMissingMemoryStatus = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    missing: v.number(),
    isDone: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const batchSize = Math.min(Math.max(args.batchSize ?? 500, 1), 1000);
    const page = await ctx.db.query("thoughts").paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });

    return {
      scanned: page.page.length,
      missing: page.page.filter((m) => m.memoryStatus === undefined).length,
      isDone: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});
