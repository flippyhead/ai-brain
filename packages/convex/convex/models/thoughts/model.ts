import type { Infer } from "convex/values";
import type { Expression, FilterBuilder, NamedTableInfo } from "convex/server";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  assertValidMemoryValidity,
  isCurrentMemory,
  normalizeForgetReason,
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

export async function _findById(ctx: QueryCtx, id: Id<"thoughts">) {
  return await ctx.db.get(id);
}

type ThoughtFilterBuilder = FilterBuilder<
  NamedTableInfo<DataModel, "thoughts">
>;

/**
 * Express memory lifecycle and business-time validity inside a Convex query.
 * Legacy rows omit `memoryStatus`, so undefined remains equivalent to current.
 * Applying this before `take` fills the requested result window without trying
 * to issue a second `.paginate()` call in the same function execution.
 */
export function memoryRetrievabilityFilter(
  q: ThoughtFilterBuilder,
  includeHistorical: boolean | undefined,
  activeAt: number,
): Expression<boolean> {
  const memoryStatus = q.field("memoryStatus");
  if (includeHistorical) {
    return q.neq(memoryStatus, "retracted");
  }

  const validFrom = q.field("validFrom");
  const validTo = q.field("validTo");
  return q.and(
    q.or(q.eq(memoryStatus, undefined), q.eq(memoryStatus, "current")),
    q.or(
      q.eq(validFrom, undefined),
      q.lte(validFrom as Expression<number>, activeAt),
    ),
    q.or(
      q.eq(validTo, undefined),
      q.gt(validTo as Expression<number>, activeAt),
    ),
  );
}

export async function _listByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number = 20,
  includeHistorical = false,
) {
  const activeAt = Date.now();
  return await ctx.db
    .query("thoughts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .filter((q) => memoryRetrievabilityFilter(q, includeHistorical, activeAt))
    .take(limit);
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
  const activeAt = Date.now();
  return await ctx.db
    .query("thoughts")
    .withIndex("by_userId_and_isCore", (q) =>
      q.eq("userId", userId).eq("isCore", true),
    )
    .order("desc")
    .filter((q) => memoryRetrievabilityFilter(q, false, activeAt))
    .take(limit);
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
 * make the undo lossy. A retracted memory is withheld by
 * `memoryRetrievabilityFilter` (and `isMemoryRetrievable` on the vector path)
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

/**
 * Hard delete. Retraction keeps the row and marks it never-true; forgetting is
 * for content that should not exist in storage at all — a mis-captured
 * credential, a third party's private detail — so there is nothing to mark
 * and nowhere to write a tombstone. The reason is validated so the caller has
 * to say why, but no row survives to record it on; it is echoed back instead.
 *
 * Any status can be forgotten. A retracted or superseded memory still holds
 * its content, and the point of forgetting is that the content goes.
 *
 * Supersession links are bidirectional, so both sides are repaired rather
 * than left pointing at a missing id:
 *
 * - A predecessor whose `supersededBy` is the forgotten memory has that
 *   pointer cleared but keeps its `superseded` or `retracted` status.
 *   Forgetting the successor is not an undo of the change it recorded — the
 *   user said the successor should never have existed, not that the earlier
 *   memory is true again — and a retracted predecessor was never true
 *   regardless. The ids are returned so a caller can re-state the earlier
 *   memory deliberately if that is what the user wants.
 * - A successor listing the forgotten memory in `supersedes` drops it from
 *   the list; an emptied list is removed.
 */
export async function _forgetThought(
  ctx: MutationCtx,
  userId: Id<"users">,
  id: Id<"thoughts">,
  reason: string,
) {
  const memory = await ctx.db.get(id);
  if (!memory || memory.userId !== userId) {
    throw new Error("Memory not found");
  }
  const normalizedReason = normalizeForgetReason(reason);

  const detachedPredecessors: Array<Id<"thoughts">> = [];
  for (const previousId of memory.supersedes ?? []) {
    const previous = await ctx.db.get(previousId);
    if (
      previous &&
      previous.userId === userId &&
      previous.supersededBy === id
    ) {
      await ctx.db.patch(previousId, { supersededBy: undefined });
      detachedPredecessors.push(previousId);
    }
  }

  let detachedSuccessor: Id<"thoughts"> | undefined;
  if (memory.supersededBy !== undefined) {
    const successor = await ctx.db.get(memory.supersededBy);
    if (
      successor &&
      successor.userId === userId &&
      successor.supersedes?.includes(id)
    ) {
      const remaining = successor.supersedes.filter((other) => other !== id);
      await ctx.db.patch(successor._id, {
        supersedes: remaining.length > 0 ? remaining : undefined,
      });
      detachedSuccessor = successor._id;
    }
  }

  await ctx.db.delete(id);
  return {
    thoughtId: id,
    reason: normalizedReason,
    detachedPredecessors,
    detachedSuccessor,
  };
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
