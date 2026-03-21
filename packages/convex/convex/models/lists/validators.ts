import { v } from "convex/values";

export const listItemStatus = v.union(
  v.literal("open"),
  v.literal("done"),
);

export const listFields = {
  name: v.string(),
  pinned: v.boolean(),
  userId: v.id("users"),
  archivedAt: v.optional(v.number()),
};

export const listItemFields = {
  title: v.string(),
  status: listItemStatus,
  position: v.number(),
  listId: v.id("lists"),
  userId: v.id("users"),
  completedAt: v.optional(v.number()),
  url: v.optional(v.string()),
  description: v.optional(v.string()),
  properties: v.optional(v.record(v.string(), v.any())),
};
