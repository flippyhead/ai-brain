import { query } from "../../_generated/server";
import { v } from "convex/values";
import { thoughtMetadata } from "./validators";
import { _listByUser } from "./model";

// Public queries for MCP endpoint — accept userId as parameter
// (auth is handled by API key validation in the Next.js API route)

export const listByUser = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
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
    const results = await _listByUser(ctx, args.userId, args.limit ?? 20);
    return results.map(({ embedding: _, ...rest }) => rest);
  },
});

export const getStats = query({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    totalThoughts: v.number(),
    byType: v.array(v.object({ type: v.string(), count: v.number() })),
    topTopics: v.array(v.object({ topic: v.string(), count: v.number() })),
    topPeople: v.array(v.object({ person: v.string(), count: v.number() })),
  }),
  handler: async (ctx, args) => {
    const allThoughts = await ctx.db
      .query("thoughts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
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

    return {
      totalThoughts: allThoughts.length,
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
