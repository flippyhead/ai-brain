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

export const getByIds = internalQuery({
  args: { ids: v.array(v.id("thoughts")) },
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
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return docs
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map(({ embedding: _embedding, ...rest }) => rest);
  },
});

export const listAroundTime = internalQuery({
  args: {
    userId: v.id("users"),
    aroundMs: v.number(),
    before: v.number(),
    after: v.number(),
    type: v.optional(thoughtType),
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
    const type = args.type;

    // Strictly older than aroundMs, most recent first, take `before`.
    // _creationTime is the implicit suffix of every Convex index, so the
    // bound can be pushed into the index builder directly.
    const earlier = type
      ? await ctx.db
          .query("thoughts")
          .withIndex("by_userId_and_type", (q) =>
            q
              .eq("userId", args.userId)
              .eq("metadata.type", type)
              .lt("_creationTime", args.aroundMs),
          )
          .order("desc")
          .take(args.before)
      : await ctx.db
          .query("thoughts")
          .withIndex("by_userId", (q) =>
            q.eq("userId", args.userId).lt("_creationTime", args.aroundMs),
          )
          .order("desc")
          .take(args.before);

    // Strictly newer than aroundMs, oldest first, take `after`
    const later = type
      ? await ctx.db
          .query("thoughts")
          .withIndex("by_userId_and_type", (q) =>
            q
              .eq("userId", args.userId)
              .eq("metadata.type", type)
              .gt("_creationTime", args.aroundMs),
          )
          .order("asc")
          .take(args.after)
      : await ctx.db
          .query("thoughts")
          .withIndex("by_userId", (q) =>
            q.eq("userId", args.userId).gt("_creationTime", args.aroundMs),
          )
          .order("asc")
          .take(args.after);

    const combined = [...earlier.reverse(), ...later];
    return combined.map(({ embedding: _embedding, ...rest }) => rest);
  },
});
