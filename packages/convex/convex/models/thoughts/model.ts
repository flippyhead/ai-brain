import type { Infer } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  assertValidMemoryValidity,
  isCurrentMemory,
  isMemoryActive,
  isMemoryRetrievable,
  safeSupersededValidTo,
  type MemoryStatus,
  type MemoryValidity,
} from "./memoryLifecycle";
import { memorySourceType, thoughtMetadata } from "./validators";

type ThoughtMetadata = Infer<typeof thoughtMetadata>;
type MemorySourceType = Infer<typeof memorySourceType>;

type ThoughtProvenance = {
  sourceType?: MemorySourceType;
  sourceRef?: string;
  observedAt?: number;
  batchId?: string;
  confidence?: number;
};

export const DEFAULT_CORE_MEMORY_LIMIT = 10;
export const MAX_CORE_MEMORY_LIMIT = 25;
const MAX_CORE_MEMORY_CANDIDATES = 250;

export async function _findById(ctx: QueryCtx, id: Id<"thoughts">) {
  return await ctx.db.get(id);
}

/**
 * Pages through an ordered query, keeping only rows that pass `predicate`,
 * until `limit` rows are collected or the source is exhausted.
 *
 * Lifecycle status cannot be filtered at the index: memories written before
 * the temporal-memory change have no `memoryStatus` at all, and `undefined`
 * means "current". Filtering on the stored value would silently drop every
 * legacy memory, so the filter has to run after the read. A fixed over-fetch
 * multiplier would instead under-fill the page once an account accumulates
 * enough superseded memories, with no signal that anything was dropped —
 * paging until the quota is met keeps the result honest either way.
 */
/**
 * Streams an ordered query, keeping rows that pass `predicate`, and stops as
 * soon as `limit` of them are collected.
 *
 * `collectFiltered` cannot serve callers that need two windows: Convex permits
 * a single `.paginate()` per function execution, so paging both sides of a
 * timeline fails at runtime in a deployed backend. Async iteration has no such
 * limit. Taking the window first and filtering after is not an option either —
 * dropped rows would spend slots the caller asked for and silently shorten the
 * result.
 */
export async function takeFiltered<T>(
  rows: AsyncIterable<T>,
  predicate: (row: T) => boolean,
  limit: number,
): Promise<T[]> {
  if (limit <= 0) return [];
  const collected: T[] = [];
  for await (const row of rows) {
    if (!predicate(row)) continue;
    collected.push(row);
    if (collected.length === limit) break;
  }
  return collected;
}

export async function collectFiltered<T>(
  fetchPage: (
    cursor: string | null,
    numItems: number,
  ) => Promise<{ page: T[]; isDone: boolean; continueCursor: string }>,
  predicate: (row: T) => boolean,
  limit: number,
  maxPages = 20,
): Promise<T[]> {
  const collected: T[] = [];
  const pageSize = Math.min(Math.max(limit * 2, 50), 500);
  let cursor: string | null = null;

  for (let page = 0; page < maxPages && collected.length < limit; page += 1) {
    const result = await fetchPage(cursor, pageSize);
    for (const row of result.page) {
      if (predicate(row)) {
        collected.push(row);
        if (collected.length === limit) break;
      }
    }
    if (result.isDone) break;
    cursor = result.continueCursor;
  }

  return collected;
}

export async function _listByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number = 20,
  includeHistorical = false,
) {
  const query = () =>
    ctx.db
      .query("thoughts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc");

  const activeAt = Date.now();
  return await collectFiltered(
    (cursor, numItems) => query().paginate({ cursor, numItems }),
    (memory) => isMemoryRetrievable(memory, includeHistorical, activeAt),
    limit,
  );
}

export async function _listCoreByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  requestedLimit: number = DEFAULT_CORE_MEMORY_LIMIT,
) {
  if (
    !Number.isFinite(requestedLimit) ||
    !Number.isInteger(requestedLimit) ||
    requestedLimit < 1
  ) {
    throw new Error("Core memory limit must be a positive integer");
  }
  const limit = Math.min(requestedLimit, MAX_CORE_MEMORY_LIMIT);
  const candidates = await ctx.db
    .query("thoughts")
    .withIndex("by_userId_and_isCore", (q) =>
      q.eq("userId", userId).eq("isCore", true),
    )
    .order("desc")
    .take(MAX_CORE_MEMORY_CANDIDATES);

  const activeAt = Date.now();
  return candidates
    .filter((memory) => isMemoryActive(memory, activeAt))
    .slice(0, limit);
}

export async function _insertOne(
  ctx: MutationCtx,
  fields: {
    content: string;
    embedding: number[];
    metadata: ThoughtMetadata;
    userId: Id<"users">;
    isCore?: boolean;
  } & MemoryValidity &
    ThoughtProvenance,
) {
  assertValidMemoryValidity(fields);
  return await ctx.db.insert("thoughts", {
    ...fields,
    memoryStatus: "current",
  });
}

export async function _transitionMemory(
  ctx: MutationCtx,
  fields: {
    content: string;
    embedding: number[];
    metadata: ThoughtMetadata;
    userId: Id<"users">;
    isCore?: boolean;
  } & MemoryValidity &
    ThoughtProvenance,
  previousIds: Array<Id<"thoughts">>,
  previousStatus: Exclude<MemoryStatus, "current">,
  reason: string,
  transitionedAt: number,
) {
  assertValidMemoryValidity(fields);
  const uniquePreviousIds = [...new Set(previousIds)];
  if (uniquePreviousIds.length === 0 || uniquePreviousIds.length > 10) {
    throw new Error("A memory transition requires 1-10 previous memories");
  }
  if (
    !reason.trim() ||
    reason.length > 500 ||
    !Number.isFinite(transitionedAt) ||
    transitionedAt <= 0
  ) {
    throw new Error("Invalid memory transition metadata");
  }

  const previousMemories = await Promise.all(
    uniquePreviousIds.map((id) => ctx.db.get(id)),
  );
  for (const previous of previousMemories) {
    if (
      !previous ||
      previous.userId !== fields.userId ||
      (previous.memoryStatus !== undefined &&
        previous.memoryStatus !== "current")
    ) {
      throw new Error("Previous memory is unavailable");
    }
  }

  const isCore =
    fields.isCore ?? previousMemories.some((previous) => previous!.isCore);

  const newId = await ctx.db.insert("thoughts", {
    ...fields,
    isCore,
    memoryStatus: "current",
    supersedes: uniquePreviousIds,
  });

  for (const previous of previousMemories) {
    const validTo =
      previousStatus === "superseded"
        ? safeSupersededValidTo(previous!, fields.validFrom)
        : undefined;
    await ctx.db.patch(previous!._id, {
      memoryStatus: previousStatus,
      supersededAt: transitionedAt,
      supersededBy: newId,
      changeReason: reason,
      ...(previousStatus === "retracted"
        ? { validFrom: undefined, validTo: undefined }
        : {}),
      ...(validTo === undefined ? {} : { validTo }),
    });
  }

  return newId;
}

/**
 * Caller-declared retraction: the user asserts this memory should never have
 * been stored. Unlike the RETRACT branch of `_transitionMemory`, no replacement
 * is written and no classifier has to agree — this mirrors the `changeKind:
 * "corrected"` argument the structured fact path already accepts.
 *
 * `supersededBy` stays unset, which is what makes the memory restorable: a
 * memory retracted as part of a supersession has a current successor, and
 * reviving it would put two contradicting memories back in play.
 *
 * Validity is deliberately preserved, where `_transitionMemory` clears it. That
 * path is one-way; this one is reversible, and discarding the interval would
 * make the undo lossy. A retracted memory is withheld by `isMemoryRetrievable`
 * before validity is ever consulted, so keeping it changes no read.
 */
export async function _setRetracted(
  ctx: MutationCtx,
  userId: Id<"users">,
  id: Id<"thoughts">,
  retracted: boolean,
  reason: string | undefined,
  at: number,
) {
  const memory = await ctx.db.get(id);
  if (!memory || memory.userId !== userId) {
    throw new Error("Memory not found");
  }

  if (retracted) {
    if (!isCurrentMemory(memory.memoryStatus)) {
      throw new Error("Only a current memory can be retracted");
    }
    if (!reason?.trim() || reason.length > 500) {
      throw new Error("A retraction requires a reason of 1-500 characters");
    }
    await ctx.db.patch(id, {
      memoryStatus: "retracted",
      supersededAt: at,
      changeReason: reason,
    });
    return;
  }

  if (memory.memoryStatus !== "retracted") {
    throw new Error("Only a retracted memory can be restored");
  }
  if (memory.supersededBy !== undefined) {
    throw new Error(
      "This memory was retracted by a replacement and cannot be restored directly",
    );
  }
  await ctx.db.patch(id, {
    memoryStatus: "current",
    supersededAt: undefined,
    changeReason: undefined,
  });
}

export async function _setCoreStatus(
  ctx: MutationCtx,
  userId: Id<"users">,
  id: Id<"thoughts">,
  isCore: boolean,
) {
  const memory = await ctx.db.get(id);
  if (
    !memory ||
    memory.userId !== userId ||
    !isCurrentMemory(memory.memoryStatus)
  ) {
    throw new Error("Current memory not found");
  }
  await ctx.db.patch(id, { isCore });
}
