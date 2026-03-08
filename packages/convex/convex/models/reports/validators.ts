import { v } from "convex/values";

export const insightCategory = v.union(
  v.literal("feature-discovery"),
  v.literal("anti-pattern"),
  v.literal("productivity"),
  v.literal("automation"),
);

export const insightStatus = v.union(
  v.literal("new"),
  v.literal("noted"),
  v.literal("done"),
  v.literal("dismissed"),
);

export const dismissTag = v.union(
  v.literal("already-fixed"),
  v.literal("not-relevant"),
  v.literal("already-knew"),
  v.literal("incorrect"),
);

export const projectActive = v.object({
  path: v.string(),
  sessions: v.number(),
});

export const reportFields = {
  userId: v.id("users"),
  startDate: v.string(),
  endDate: v.string(),
  sessionsAnalyzed: v.number(),
  totalPrompts: v.number(),
  totalToolCalls: v.number(),
  projectsActive: v.array(projectActive),
  modelUsage: v.any(),
};

export const insightFields = {
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
};
