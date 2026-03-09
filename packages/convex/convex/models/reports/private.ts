import { internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import {
  insightCategory,
  projectActive,
} from "./validators";
import { _insertReport, _insertInsight } from "./model";

export const insertReport = internalMutation({
  args: {
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    sessionsAnalyzed: v.number(),
    totalPrompts: v.number(),
    totalToolCalls: v.number(),
    projectsActive: v.array(projectActive),
    modelUsage: v.any(),
  },
  returns: v.id("reports"),
  handler: async (ctx, args) => {
    return await _insertReport(ctx, args);
  },
});

export const insertInsight = internalMutation({
  args: {
    reportId: v.id("reports"),
    userId: v.id("users"),
    category: insightCategory,
    observation: v.string(),
    recommendation: v.string(),
    evidence: v.string(),
  },
  returns: v.id("insights"),
  handler: async (ctx, args) => {
    return await _insertInsight(ctx, {
      ...args,
      status: "new",
      dismissTag: undefined,
      dismissText: undefined,
      updatedAt: undefined,
    });
  },
});

