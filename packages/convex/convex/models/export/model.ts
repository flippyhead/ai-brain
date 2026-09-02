import type { Doc, Id, TableNames } from "../../_generated/dataModel";
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
 *
 * Every read here is bounded by a page size. Convex caps what one query may
 * read, so an unbounded `.collect()` on any account-sized table is a latent
 * failure that only shows up once the account is large enough to matter — which
 * is exactly when an export matters most.
 */

/** Rows read per page. Bounded so one call cannot exceed a Convex read limit. */
export const EXPORT_PAGE_SIZE = 100;
export const MAX_EXPORT_PAGE_SIZE = 500;

/**
 * Every account-owned table, keyed by the name the export uses for it. Each
 * one has a `by_userId` index, which is what makes a single paging contract
 * possible: `(userId, _creationTime)` is a total order per account.
 */
export const EXPORT_COLLECTIONS = [
  "thoughts",
  "facts",
  "entities",
  "lists",
  "listItems",
  "reports",
  "insights",
] as const;

export type ExportCollection = (typeof EXPORT_COLLECTIONS)[number] & TableNames;

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

export type ExportCountPage = {
  collection: ExportCollection;
  /** Rows read on this page, before lifecycle filtering. */
  total: number;
  /** Rows on this page that are current (equal to `total` for tables without lifecycle). */
  current: number;
  cursor: number | null;
  isDone: boolean;
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

/** Whether a row is current, for the two tables that carry a lifecycle. */
function isCurrent(collection: ExportCollection, doc: Doc<ExportCollection>) {
  switch (collection) {
    case "thoughts":
      return ((doc as Doc<"thoughts">).memoryStatus ?? "current") === "current";
    case "facts":
      return (doc as Doc<"facts">).status === "current";
    default:
      return true;
  }
}

/**
 * One page of an account's rows from one table, oldest first, read through its
 * `by_userId` index so the read is bounded by `pageSize` regardless of how
 * large the account is.
 */
async function readPage<T extends ExportCollection>(
  ctx: QueryCtx,
  table: T,
  userId: Id<"users">,
  after: number | undefined,
  pageSize: number,
): Promise<Doc<T>[]> {
  // Every table in EXPORT_COLLECTIONS declares `by_userId` on `["userId"]`
  // (schema.ts), so the range builder is identical for all of them. Convex's
  // types cannot express "an index that exists on every member of this union",
  // so the query is typed against one member and the rows cast back to `T`.
  const docs = await ctx.db
    .query(table as "thoughts")
    .withIndex("by_userId", (q) =>
      after === undefined
        ? q.eq("userId", userId)
        : q.eq("userId", userId).gt("_creationTime", after),
    )
    .order("asc")
    .take(pageSize);
  return docs as unknown as Doc<T>[];
}

function pageEnd(
  scannedDocs: { _creationTime: number }[],
  pageSize: number,
): Pick<ExportPage, "cursor" | "isDone"> {
  const exhausted = scannedDocs.length < pageSize;
  return {
    cursor: exhausted ? null : (scannedDocs.at(-1)?._creationTime ?? null),
    isDone: exhausted,
  };
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
  const includeHistorical = args.includeHistorical ?? false;
  const { collection } = args;

  const docs = await readPage(ctx, collection, userId, args.after, pageSize);
  const kept = docs.filter(
    (doc) => includeHistorical || isCurrent(collection, doc),
  );
  const rows =
    collection === "thoughts"
      ? (kept as Doc<"thoughts">[]).map(scrubThought)
      : kept.map(scrubRow);

  return {
    collection,
    rows,
    ...pageEnd(docs, pageSize),
    scanned: docs.length,
  };
}

/**
 * One page of row counts, for verifying an export is complete. Counting reads
 * the same rows the export does, so it is paged the same way; a caller sums the
 * pages. There is no cheaper way to count in Convex without maintaining an
 * aggregate, and an aggregate that can drift is worse than a slow exact count
 * for a verification step.
 */
export async function exportCountPage(
  ctx: QueryCtx,
  userId: Id<"users">,
  args: { collection: ExportCollection; after?: number; pageSize?: number },
): Promise<ExportCountPage> {
  const pageSize = clampPageSize(args.pageSize);
  const { collection } = args;
  const docs = await readPage(ctx, collection, userId, args.after, pageSize);
  return {
    collection,
    total: docs.length,
    current: docs.filter((doc) => isCurrent(collection, doc)).length,
    ...pageEnd(docs, pageSize),
  };
}

/**
 * Bounded presence check for the account listing: how many rows a table holds
 * for this account, up to `cap`, and whether the cap was hit. Enough to tell an
 * empty account from a populated one, which is all picking an account needs,
 * without reading the account to do it.
 */
export async function boundedCount(
  ctx: QueryCtx,
  table: ExportCollection,
  userId: Id<"users">,
  cap: number,
): Promise<{ count: number; capped: boolean }> {
  const docs = await readPage(ctx, table, userId, undefined, cap + 1);
  return docs.length > cap
    ? { count: cap, capped: true }
    : { count: docs.length, capped: false };
}
