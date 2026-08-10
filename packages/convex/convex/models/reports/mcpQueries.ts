import { query } from "../../_generated/server";
import { v } from "convex/values";
import { requireMcpUserId } from "../../lib/mcpAuth";
import { insightCategory, insightStatus, dismissTag } from "./validators";
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
  links: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
  status: insightStatus,
  dismissTag: v.optional(dismissTag),
  dismissText: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
});

export const listInsights = query({
  args: {
    status: v.optional(insightStatus),
    category: v.optional(insightCategory),
    limit: v.optional(v.number()),
  },
  returns: v.array(insightReturn),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    const limit = args.limit ?? 50;

    let results;

    if (args.status) {
      results = await _listInsightsByUserAndStatus(
        ctx,
        userId,
        args.status,
        limit,
        args.category,
      );
    } else {
      const [newInsights, notedInsights, doneInsights, dismissedInsights] =
        await Promise.all([
          _listInsightsByUserAndStatus(
            ctx,
            userId,
            "new",
            limit,
            args.category,
          ),
          _listInsightsByUserAndStatus(
            ctx,
            userId,
            "noted",
            limit,
            args.category,
          ),
          _listInsightsByUserAndStatus(
            ctx,
            userId,
            "done",
            limit,
            args.category,
          ),
          _listInsightsByUserAndStatus(
            ctx,
            userId,
            "dismissed",
            limit,
            args.category,
          ),
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

    return results;
  },
});
