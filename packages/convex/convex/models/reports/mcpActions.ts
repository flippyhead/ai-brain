"use node";

import { action } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import { v } from "convex/values";
import { insightCategory, projectActive } from "./validators";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

export const createReport = action({
  args: {
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    sessionsAnalyzed: v.number(),
    totalPrompts: v.number(),
    totalToolCalls: v.number(),
    projectsActive: v.array(projectActive),
    modelUsage: v.any(),
    insights: v.array(
      v.object({
        category: insightCategory,
        observation: v.string(),
        recommendation: v.string(),
        evidence: v.string(),
      }),
    ),
  },
  returns: v.object({
    reportId: v.id("reports"),
    insightIds: v.array(v.id("insights")),
  }),
  handler: async (ctx, args) => {
    const { insights, ...reportFields } = args;

    const reportId = await ctx.runMutation(
      internal.models.reports.private.insertReport,
      reportFields,
    );

    const insightIds = [];
    for (const insight of insights) {
      const insightId = await ctx.runMutation(
        internal.models.reports.private.insertInsight,
        {
          reportId,
          userId: args.userId,
          ...insight,
        },
      );
      insightIds.push(insightId);
    }

    return { reportId, insightIds };
  },
});
