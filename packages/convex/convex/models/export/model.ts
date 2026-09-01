import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";

/**
 * Account export readers.
 *
 * Export exists so the account's memories can leave this deployment in a form
 * something else can read — a backup, a migration, or a side-by-side evaluation
 * against another memory system. It is deliberately read-only and deliberately
 * boring: no filtering beyond lifecycle status, no summarising, no model calls.
 * A backup that reinterprets what it copies is not a backup.
 *
 * Embeddings are never exported. They are 1536 floats per memory, they are
 * derived from content the export already carries in full, and every consumer
 * that needs them can regenerate them. Including them would multiply the
 * archive size by roughly an order of magnitude to carry nothing new.
 */

/** Rows read per page. Bounded so one call cannot exceed a Convex read limit. */
export const EXPORT_PAGE_SIZE = 100;
export const MAX_EXPORT_PAGE_SIZE = 500;

export type ExportCollection =
  "thoughts" | "facts" | "entities" | "lists" | "listItems";

export type ExportPage = {
  collection: ExportCollection;
  /**
   * The rows that survived lifecycle filtering. MAY BE SHORTER than the page
   * size, or empty, while `isDone` is still false — a page of entirely
   * superseded memories filters down to nothing but is not the end of the
   * collection. Callers must loop on `isDone`, never on `rows.length`.
   */
  rows: Record<string, unknown>[];
  /**
   * Creation time of the last row READ (not the last row returned), or null at
   * the end. Callers pass it back as `after` to continue. Creation time is the
   * cursor because it is monotonic per table and stable across pages, unlike an
   * offset, which shifts under a concurrent write. It tracks rows read rather
   * than rows returned so that filtered-out rows are not silently re-read or
   * skipped.
   */
  cursor: number | null;
  isDone: boolean;
  /** Rows read before filtering, so a caller can see filtering happening. */
  scanned: number;
};

function clampPageSize(requested: number | undefined): number {
  if (requested === undefined) return EXPORT_PAGE_SIZE;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error("Export page size must be a positive integer");
  }
  return Math.min(requested, MAX_EXPORT_PAGE_SIZE);
}

/**
 * Strip fields that must not leave the deployment or that carry no information
 * the rest of the row lacks. `embedding` is dropped for size; `userId` is
 * dropped because an export belongs to exactly one account, and repeating its
 * id on every row invites a re-import into the wrong one.
 */
function scrubThought(doc: Doc<"thoughts">) {
  const { embedding: _embedding, userId: _userId, ...rest } = doc;
  return rest;
}

function scrubRow<T extends { userId: Id<"users"> }>(doc: T) {
  const { userId: _userId, ...rest } = doc;
  return rest;
}

/**
 * One page of an account's rows from a single collection, oldest first.
 *
 * Ordering is oldest-first on purpose: an export read in file order replays the
 * account's history in the order it happened, and a resumed export continues
 * forward rather than re-reading rows it already wrote.
 */
export async function exportCollectionPage(
  ctx: QueryCtx,
  userId: Id<"users">,
  args: {
    collection: ExportCollection;
    after?: number;
    pageSize?: number;
    includeHistorical?: boolean;
  },
): Promise<ExportPage> {
  const pageSize = clampPageSize(args.pageSize);
  const after = args.after;
  const includeHistorical = args.includeHistorical ?? false;

  switch (args.collection) {
    case "thoughts": {
      const docs = await ctx.db
        .query("thoughts")
        .withIndex("by_userId", (q) =>
          after === undefined
            ? q.eq("userId", userId)
            : q.eq("userId", userId).gt("_creationTime", after),
        )
        .order("asc")
        .take(pageSize);
      const rows = docs
        .filter(
          (doc) =>
            includeHistorical || (doc.memoryStatus ?? "current") === "current",
        )
        .map(scrubThought);
      return page(args.collection, rows, docs, pageSize);
    }
    case "facts": {
      const docs = await ctx.db
        .query("facts")
        .withIndex("by_userId", (q) =>
          after === undefined
            ? q.eq("userId", userId)
            : q.eq("userId", userId).gt("_creationTime", after),
        )
        .order("asc")
        .take(pageSize);
      const rows = docs
        .filter((doc) => includeHistorical || doc.status === "current")
        .map(scrubRow);
      return page(args.collection, rows, docs, pageSize);
    }
    case "entities": {
      const docs = await ctx.db
        .query("entities")
        .withIndex("by_userId", (q) =>
          after === undefined
            ? q.eq("userId", userId)
            : q.eq("userId", userId).gt("_creationTime", after),
        )
        .order("asc")
        .take(pageSize);
      return page(args.collection, docs.map(scrubRow), docs, pageSize);
    }
    case "lists": {
      const docs = await ctx.db
        .query("lists")
        .withIndex("by_userId", (q) =>
          after === undefined
            ? q.eq("userId", userId)
            : q.eq("userId", userId).gt("_creationTime", after),
        )
        .order("asc")
        .take(pageSize);
      return page(args.collection, docs.map(scrubRow), docs, pageSize);
    }
    case "listItems": {
      // `by_userId_and_status` puts status ahead of the implicit creation-time
      // field, so a creation-time range would have to pin one status and run
      // once per status value. List items are bounded by the number of items
      // across an account's lists, so this collection returns in a single page
      // instead. Add a `by_userId` index here if that assumption ever breaks.
      const docs = await ctx.db
        .query("listItems")
        .withIndex("by_userId_and_status", (q) => q.eq("userId", userId))
        .collect();
      const sorted = [...docs].sort(
        (a, b) => a._creationTime - b._creationTime,
      );
      return {
        collection: args.collection,
        rows: sorted.map(scrubRow),
        cursor: null,
        isDone: true,
        scanned: sorted.length,
      };
    }
  }
}

function page(
  collection: ExportCollection,
  rows: Record<string, unknown>[],
  scannedDocs: { _creationTime: number }[],
  pageSize: number,
): ExportPage {
  const exhausted = scannedDocs.length < pageSize;
  return {
    collection,
    rows,
    cursor: exhausted ? null : (scannedDocs.at(-1)?._creationTime ?? null),
    isDone: exhausted,
    scanned: scannedDocs.length,
  };
}

/** Row counts per collection, for verifying an export is complete. */
export async function exportCounts(ctx: QueryCtx, userId: Id<"users">) {
  const [thoughts, facts, entities, lists, listItems] = await Promise.all([
    ctx.db
      .query("thoughts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect(),
    ctx.db
      .query("facts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect(),
    ctx.db
      .query("entities")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect(),
    ctx.db
      .query("lists")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect(),
    ctx.db
      .query("listItems")
      .withIndex("by_userId_and_status", (q) => q.eq("userId", userId))
      .collect(),
  ]);

  return {
    thoughts: {
      total: thoughts.length,
      current: thoughts.filter(
        (doc) => (doc.memoryStatus ?? "current") === "current",
      ).length,
    },
    facts: {
      total: facts.length,
      current: facts.filter((doc) => doc.status === "current").length,
    },
    entities: { total: entities.length },
    lists: { total: lists.length },
    listItems: { total: listItems.length },
  };
}
