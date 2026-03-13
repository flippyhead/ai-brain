import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { thoughtMetadata } from "./validators";
import { _findById, _insertOne, _listByUser } from "./model";

export const getById = internalQuery({
  args: { id: v.id("thoughts") },
  returns: v.union(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      embedding: v.array(v.float64()),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await _findById(ctx, args.id);
  },
});

export const listByUser = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      embedding: v.array(v.float64()),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    return await _listByUser(ctx, args.userId, args.limit ?? 20);
  },
});

export const insertOne = internalMutation({
  args: {
    content: v.string(),
    embedding: v.array(v.float64()),
    metadata: thoughtMetadata,
    userId: v.id("users"),
  },
  returns: v.id("thoughts"),
  handler: async (ctx, args) => {
    return await _insertOne(ctx, args);
  },
});
