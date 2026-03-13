import { v } from "convex/values";

export const thoughtType = v.union(
  v.literal("decision"),
  v.literal("person_note"),
  v.literal("idea"),
  v.literal("meeting_note"),
  v.literal("task"),
  v.literal("reference"),
);

export const thoughtMetadata = v.object({
  type: thoughtType,
  topics: v.array(v.string()),
  people: v.array(v.string()),
  actionItems: v.array(v.string()),
  summary: v.string(),
});

export const thoughtFields = {
  content: v.string(),
  embedding: v.array(v.float64()),
  metadata: thoughtMetadata,
  userId: v.id("users"),
  updatedAt: v.optional(v.number()),
};
