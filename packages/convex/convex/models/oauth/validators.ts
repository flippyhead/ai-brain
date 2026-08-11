import { v } from "convex/values";

export const consumedOAuthCodeFields = {
  userId: v.id("users"),
  codeHash: v.string(),
  expiresAt: v.number(),
};
