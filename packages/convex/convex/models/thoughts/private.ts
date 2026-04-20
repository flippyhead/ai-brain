import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { thoughtMetadata, thoughtType } from "./validators";
import { _findById, _insertOne, _listByUser, _updateOne, _deleteOne } from "./model";

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

export const updateOne = internalMutation({
  args: {
    id: v.id("thoughts"),
    content: v.string(),
    embedding: v.array(v.float64()),
    metadata: thoughtMetadata,
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await _updateOne(ctx, args.id, {
      content: args.content,
      embedding: args.embedding,
      metadata: args.metadata,
      updatedAt: args.updatedAt,
    });
    return null;
  },
});

export const deleteOne = internalMutation({
  args: {
    id: v.id("thoughts"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await _deleteOne(ctx, args.id);
    return null;
  },
});

export const searchByText = internalQuery({
  args: {
    userId: v.id("users"),
    query: v.string(),
    type: v.optional(thoughtType),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const results = await ctx.db
      .query("thoughts")
      .withSearchIndex("by_content", (q) => {
        const base = q.search("content", args.query).eq("userId", args.userId);
        return args.type ? base.eq("metadata.type", args.type) : base;
      })
      .take(limit);
    return results.map(({ embedding: _embedding, ...rest }) => rest);
  },
});
