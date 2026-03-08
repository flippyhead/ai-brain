import { query } from "../../_generated/server";
import { v } from "convex/values";
import {
  insightCategory,
  insightStatus,
  dismissTag,
} from "./validators";
import { _listInsightsByUserAndStatus } from "./model";

const insightReturn = v.object({
  _id: v.id("insights"),
  _creationTime: v.number(),
  reportId: v.id("reports"),
  userId: v.id("users"),
  category: insightCategory,
  observation: v.string(),
  recommendation: v.string(),
  evidence: v.string(),
  status: insightStatus,
  dismissTag: v.optional(dismissTag),
  dismissText: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
});

export const listInsights = query({
  args: {
    userId: v.id("users"),
    status: v.optional(insightStatus),
    category: v.optional(insightCategory),
    limit: v.optional(v.number()),
  },
  returns: v.array(insightReturn),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    let results;

    if (args.status) {
      results = await _listInsightsByUserAndStatus(
        ctx,
        args.userId,
        args.status,
        limit,
      );
    } else {
      const [newInsights, notedInsights, doneInsights, dismissedInsights] =
        await Promise.all([
          _listInsightsByUserAndStatus(ctx, args.userId, "new"),
          _listInsightsByUserAndStatus(ctx, args.userId, "noted"),
          _listInsightsByUserAndStatus(ctx, args.userId, "done"),
          _listInsightsByUserAndStatus(ctx, args.userId, "dismissed"),
        ]);

      const combined = [
        ...newInsights,
        ...notedInsights,
        ...doneInsights,
        ...dismissedInsights,
      ];
      combined.sort((a, b) => b._creationTime - a._creationTime);
      results = combined.slice(0, limit);
    }

    if (args.category) {
      results = results.filter((i) => i.category === args.category);
    }

    return results;
  },
});
