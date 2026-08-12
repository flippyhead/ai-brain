import type { Infer } from "convex/values";
import type { Expression, FilterBuilder, NamedTableInfo } from "convex/server";

import type { DataModel, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  assertValidMemoryValidity,
  isCurrentMemory,
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
