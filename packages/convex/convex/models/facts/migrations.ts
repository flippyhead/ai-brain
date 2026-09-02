import { v } from "convex/values";

import { internalAction, internalQuery } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { attachFactEmbedding } from "./actions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 20;

type MissingEmbeddingPage = {
  scanned: number;
  candidates: Array<{ factId: Id<"facts">; searchText: string }>;
  isDone: boolean;
  cursor: string | null;
};

/** One page of facts that carry no embedding. */
export const pageFactsMissingEmbedding = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    candidates: v.array(
      v.object({ factId: v.id("facts"), searchText: v.string() }),
    ),
    isDone: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<MissingEmbeddingPage> => {
    const batchSize = Math.min(
      Math.max(args.batchSize ?? DEFAULT_BATCH_SIZE, 1),
      MAX_BATCH_SIZE,
    );
    const page = await ctx.db.query("facts").paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });
    return {
      scanned: page.page.length,
      candidates: page.page
        .filter((fact) => fact.embedding === undefined)
        .map((fact) => ({ factId: fact._id, searchText: fact.searchText })),
      isDone: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/**
 * Backfills `embedding` onto facts written before semantic recall existed, or
 * stored while the embedding provider was down.
 *
 * Idempotent — only facts without an embedding are touched, so re-running is
 * a no-op once complete. Resumable — the returned `cursor` can be passed back
 * to continue where a run stopped, and `maxBatches` bounds how much one
 * invocation does. A fact whose embedding call fails is counted in `failed`
 * and left for the next run rather than aborting the batch. Pass `dryRun` to
 * count without writing.
 *
 * Run against a deployment (drop `--prod` for dev):
 *   pnpm --filter @repo/db exec convex run models/facts/migrations:backfillFactEmbeddings '{}' --prod
 * Audit before and after:
 *   pnpm --filter @repo/db exec convex run models/facts/migrations:countMissingFactEmbeddings '{}' --prod
 */
export const backfillFactEmbeddings = internalAction({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    needingBackfill: v.number(),
    patched: v.number(),
    failed: v.number(),
    isDone: v.boolean(),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const maxBatches = Math.max(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1);
    const dryRun = args.dryRun ?? false;

    let cursor: string | null = args.cursor ?? null;
    let scanned = 0;
    let needingBackfill = 0;
    let patched = 0;
    let failed = 0;
    let isDone = false;

    for (let batch = 0; batch < maxBatches && !isDone; batch += 1) {
      const page: MissingEmbeddingPage = await ctx.runQuery(
        internal.models.facts.migrations.pageFactsMissingEmbedding,
        { cursor: cursor ?? undefined, batchSize: args.batchSize },
      );
      scanned += page.scanned;
      needingBackfill += page.candidates.length;
      isDone = page.isDone;
      cursor = page.cursor;

      if (dryRun) continue;
      for (const candidate of page.candidates) {
        const outcome = await attachFactEmbedding(
          ctx,
          candidate.factId,
          candidate.searchText,
        );
        if (outcome === "embedded") patched += 1;
        else if (outcome === "unavailable") failed += 1;
        // "stale": the fact was rewritten meanwhile and the write path
        // embedded the new text itself.
      }
    }

    return {
      scanned,
      needingBackfill,
      patched,
      failed,
      isDone,
      cursor: isDone ? null : cursor,
    };
  },
});

/** Pages one audit run may read before it stops and hands back a cursor. */
const AUDIT_MAX_BATCHES = 1_000;

/**
 * Read-only audit: how many facts still lack an embedding, across the whole
 * table. Run before and after the backfill; a completed migration reports
 * zero. Writes nothing.
 *
 * Loops `pageFactsMissingEmbedding` until the table is exhausted, so one call
 * with `{}` is a complete count rather than the first page of one. The loop is
 * bounded at `AUDIT_MAX_BATCHES` pages (200,000 facts at the default page
 * size); a run that stops early returns `isDone: false` and a `cursor` to pass
 * back, and `missing` then covers only what was scanned.
 */
export const countMissingFactEmbeddings = internalAction({
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
    let cursor: string | null = args.cursor ?? null;
    let scanned = 0;
    let missing = 0;
    let isDone = false;

    for (let batch = 0; batch < AUDIT_MAX_BATCHES && !isDone; batch += 1) {
      const page: MissingEmbeddingPage = await ctx.runQuery(
        internal.models.facts.migrations.pageFactsMissingEmbedding,
        {
          cursor: cursor ?? undefined,
          batchSize: args.batchSize ?? MAX_BATCH_SIZE,
        },
      );
      scanned += page.scanned;
      missing += page.candidates.length;
      isDone = page.isDone;
      cursor = page.cursor;
    }

    return { scanned, missing, isDone, cursor: isDone ? null : cursor };
  },
});
