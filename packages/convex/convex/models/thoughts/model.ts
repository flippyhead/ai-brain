import type { Infer } from "convex/values";

import type { Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  assertValidMemoryValidity,
  isCurrentMemory,
  safeSupersededValidTo,
  type MemoryStatus,
  type MemoryValidity,
} from "./memoryLifecycle";
import { thoughtMetadata } from "./validators";

type ThoughtMetadata = Infer<typeof thoughtMetadata>;

export async function _findById(ctx: QueryCtx, id: Id<"thoughts">) {
  return await ctx.db.get(id);
}

export async function _listByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number = 20,
  includeHistorical = false,
) {
  const fetchLimit = includeHistorical ? limit : Math.min(limit * 5, 500);
  const memories = await ctx.db
    .query("thoughts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .take(fetchLimit);
  return (
    includeHistorical
      ? memories
      : memories.filter((memory) => isCurrentMemory(memory.memoryStatus))
  ).slice(0, limit);
}

export async function _insertOne(
  ctx: MutationCtx,
  fields: {
    content: string;
    embedding: number[];
    metadata: ThoughtMetadata;
    userId: Id<"users">;
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

  const newId = await ctx.db.insert("thoughts", {
    ...fields,
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
      ...(validTo === undefined ? {} : { validTo }),
    });
  }

  return newId;
}
