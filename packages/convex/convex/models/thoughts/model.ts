import type { Infer } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  assertValidMemoryValidity,
  isCurrentMemory,
  isMemoryActive,
  safeSupersededValidTo,
  type MemoryStatus,
  type MemoryValidity,
} from "./memoryLifecycle";
import { thoughtMetadata } from "./validators";

type ThoughtMetadata = Infer<typeof thoughtMetadata>;

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

  if (includeHistorical) {
    return await query().take(limit);
  }

  const activeAt = Date.now();
  return await collectFiltered(
    (cursor, numItems) => query().paginate({ cursor, numItems }),
    (memory) => isMemoryActive(memory, activeAt),
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
  } & MemoryValidity,
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
  } & MemoryValidity,
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
