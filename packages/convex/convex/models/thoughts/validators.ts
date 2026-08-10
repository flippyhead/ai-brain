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

export const memoryStatus = v.union(
  v.literal("current"),
  v.literal("superseded"),
  v.literal("retracted"),
);

export const thoughtLifecycleFields = {
  // Business-time validity is distinct from when the memory was recorded or
  // superseded. Values are Unix timestamps in milliseconds.
  validFrom: v.optional(v.number()),
  validTo: v.optional(v.number()),
  memoryStatus: v.optional(memoryStatus),
  supersededAt: v.optional(v.number()),
  supersededBy: v.optional(v.id("thoughts")),
  supersedes: v.optional(v.array(v.id("thoughts"))),
  changeReason: v.optional(v.string()),
};

export const thoughtFields = {
  content: v.string(),
  embedding: v.array(v.float64()),
  metadata: thoughtMetadata,
  userId: v.id("users"),
  updatedAt: v.optional(v.number()),
  ...thoughtLifecycleFields,
};
