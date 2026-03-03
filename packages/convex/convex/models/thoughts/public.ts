import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { thoughtMetadata, thoughtType } from "./validators";
import { _listByUser } from "./model";

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
    type: v.optional(thoughtType),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      metadata: thoughtMetadata,
      userId: v.id("users"),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    if (args.type) {
      return await ctx.db
        .query("thoughts")
        .withIndex("by_userId_and_type", (q) =>
          q.eq("userId", userId).eq("metadata.type", args.type!),
        )
        .order("desc")
        .take(args.limit ?? 20);
    }

    return await _listByUser(ctx, userId, args.limit ?? 20);
  },
});

export const getStats = query({
  args: {},
  returns: v.object({
    totalThoughts: v.number(),
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const allThoughts = await ctx.db
      .query("thoughts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const typeCounts = new Map<string, number>();
    const topicCounts = new Map<string, number>();
    const peopleCounts = new Map<string, number>();

    for (const thought of allThoughts) {
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
      allThoughts.length > 0
        ? {
            earliest: allThoughts[allThoughts.length - 1]!._creationTime,
            latest: allThoughts[0]!._creationTime,
          }
        : undefined;

    return {
      totalThoughts: allThoughts.length,
      byType,
      topTopics,
      topPeople,
      dateRange,
    };
  },
});
