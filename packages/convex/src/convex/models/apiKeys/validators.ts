import { v } from "convex/values";

export const apiKeyFields = {
  userId: v.id("users"),
  keyHash: v.string(),
  keyPrefix: v.string(),
  name: v.string(),
  lastUsedAt: v.optional(v.number()),
};
