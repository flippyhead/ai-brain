import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireWebUserId } from "../../lib/webAuth";
import { isCurrentMemory } from "./memoryLifecycle";
import {
  thoughtLifecycleFields,
  thoughtMetadata,
  thoughtType,
} from "./validators";
import { _listByUser, _listCoreByUser, collectFiltered } from "./model";

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
    type: v.optional(thoughtType),
    includeHistorical: v.optional(v.boolean()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
      ...thoughtLifecycleFields,
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireWebUserId(ctx);

    let results;
    if (args.type) {
      const limit = args.limit ?? 20;
      const query = () =>
        ctx.db
          .query("thoughts")
          .withIndex("by_userId_and_type", (q) =>
            q.eq("userId", userId).eq("metadata.type", args.type!),
          )
          .order("desc");

      results = args.includeHistorical
        ? await query().take(limit)
        : await collectFiltered(
            (cursor, numItems) => query().paginate({ cursor, numItems }),
            (memory) => isCurrentMemory(memory.memoryStatus),
            limit,
          );
    } else {
      results = await _listByUser(
        ctx,
        userId,
        args.limit ?? 20,
        args.includeHistorical,
      );
    }

    return results.map(({ embedding: _, ...rest }) => rest);
  },
});

export const listCore = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
      ...thoughtLifecycleFields,
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireWebUserId(ctx);

    const results = await _listCoreByUser(ctx, userId, args.limit);
    return results.map(({ embedding: _, ...rest }) => rest);
  },
});

export const getStats = query({
  args: {},
  returns: v.object({
    totalThoughts: v.number(),
    historicalThoughts: v.number(),
    retractedThoughts: v.number(),
    byType: v.array(v.object({ type: v.string(), count: v.number() })),
    topTopics: v.array(v.object({ topic: v.string(), count: v.number() })),
    topPeople: v.array(v.object({ person: v.string(), count: v.number() })),
    dateRange: v.optional(
      v.object({
        earliest: v.number(),
        latest: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const userId = await requireWebUserId(ctx);

    const allThoughts = await ctx.db
      .query("thoughts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const currentThoughts = allThoughts.filter((thought) =>
      isCurrentMemory(thought.memoryStatus),
    );

    const typeCounts = new Map<string, number>();
    const topicCounts = new Map<string, number>();
    const peopleCounts = new Map<string, number>();

    for (const thought of currentThoughts) {
      typeCounts.set(
        thought.metadata.type,
        (typeCounts.get(thought.metadata.type) ?? 0) + 1,
      );
      for (const topic of thought.metadata.topics) {
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      }
      for (const person of thought.metadata.people) {
        peopleCounts.set(person, (peopleCounts.get(person) ?? 0) + 1);
      }
    }

    const byType = [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const topTopics = [...topicCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topPeople = [...peopleCounts.entries()]
      .map(([person, count]) => ({ person, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const dateRange =
      currentThoughts.length > 0
        ? {
            earliest: currentThoughts[0]!._creationTime,
            latest: currentThoughts[currentThoughts.length - 1]!._creationTime,
          }
        : undefined;

    return {
      totalThoughts: currentThoughts.length,
      historicalThoughts: allThoughts.filter(
        (thought) => thought.memoryStatus === "superseded",
      ).length,
      retractedThoughts: allThoughts.filter(
        (thought) => thought.memoryStatus === "retracted",
      ).length,
      byType,
      topTopics,
      topPeople,
      dateRange,
    };
  },
});
