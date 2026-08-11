import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireMcpUserId } from "../../lib/mcpAuth";
import { isMemoryActive } from "./memoryLifecycle";
import { thoughtLifecycleFields, thoughtMetadata } from "./validators";
import { _listByUser, _listCoreByUser } from "./model";

export const listByUser = query({
  args: {
    limit: v.optional(v.number()),
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
    const userId = await requireMcpUserId(ctx);
    const results = await _listByUser(
      ctx,
      userId,
      args.limit ?? 20,
      args.includeHistorical,
    );
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
    const userId = await requireMcpUserId(ctx);
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
  }),
  handler: async (ctx) => {
    const userId = await requireMcpUserId(ctx);
    const allThoughts = await ctx.db
      .query("thoughts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const activeAt = Date.now();
    const currentThoughts = allThoughts.filter((thought) =>
      isMemoryActive(thought, activeAt),
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

    return {
      totalThoughts: currentThoughts.length,
      historicalThoughts: allThoughts.filter(
        (thought) => thought.memoryStatus === "superseded",
      ).length,
      retractedThoughts: allThoughts.filter(
        (thought) => thought.memoryStatus === "retracted",
      ).length,
      byType: [...typeCounts.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      topTopics: [...topicCounts.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topPeople: [...peopleCounts.entries()]
        .map(([person, count]) => ({ person, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  },
});
