import { query, mutation } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  insightCategory,
  insightStatus,
  dismissTag,
  reportFields,
  insightFields,
  projectActive,
} from "./validators";
import {
  _listReportsByUser,
  _listInsightsByReport,
  _listInsightsByUserAndStatus,
  _findReportById,
  _findInsightById,
  _updateInsightStatus,
} from "./model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

const reportReturn = v.object({
  _id: v.id("reports"),
  _creationTime: v.number(),
  userId: v.id("users"),
  startDate: v.string(),
  endDate: v.string(),
  sessionsAnalyzed: v.number(),
  totalPrompts: v.number(),
  totalToolCalls: v.number(),
  projectsActive: v.array(projectActive),
  modelUsage: v.any(),
});

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

export const listReports = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(reportReturn),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await _listReportsByUser(ctx, userId, args.limit ?? 20);
  },
});

export const getLatestReport = query({
  args: {},
  returns: v.union(reportReturn, v.null()),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const results = await _listReportsByUser(ctx, userId, 1);
    return results[0] ?? null;
  },
});

export const listInsightsByReport = query({
  args: {
    reportId: v.id("reports"),
  },
  returns: v.array(insightReturn),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const report = await _findReportById(ctx, args.reportId);
    if (!report) throw new Error("Report not found");
    if (report.userId !== userId) throw new Error("Not authorized");

    return await _listInsightsByReport(ctx, args.reportId);
  },
});

export const listUnresolvedInsights = query({
  args: {},
  returns: v.array(insightReturn),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const [newInsights, notedInsights] = await Promise.all([
      _listInsightsByUserAndStatus(ctx, userId, "new"),
      _listInsightsByUserAndStatus(ctx, userId, "noted"),
    ]);

    const combined = [...newInsights, ...notedInsights];
    combined.sort((a, b) => b._creationTime - a._creationTime);

    return combined;
  },
});

export const updateInsightStatus = mutation({
  args: {
    insightId: v.id("insights"),
    status: v.union(
      v.literal("noted"),
      v.literal("done"),
      v.literal("dismissed"),
    ),
    dismissTag: v.optional(dismissTag),
    dismissText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const insight = await _findInsightById(ctx, args.insightId);
    if (!insight) throw new Error("Insight not found");
    if (insight.userId !== userId) throw new Error("Not authorized");

    await _updateInsightStatus(ctx, insight, {
      status: args.status,
      dismissTag: args.dismissTag,
      dismissText: args.dismissText,
      updatedAt: Date.now(),
    });

    if (args.dismissText) {
      await ctx.scheduler.runAfter(
        0,
        internal.models.thoughts.actions.captureThought,
        {
          userId,
          content: `[User Preference] User dismissed workflow insight about ${insight.category}. Reason: '${args.dismissText}'. Consider excluding similar recommendations from future workflow reports.`,
        },
      );
    }

    return null;
  },
});
