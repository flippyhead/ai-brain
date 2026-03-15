import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { listItemStatus } from "./validators";
import {
  _findListById,
  _listsByUser,
  _insertList,
  _updateList,
  _findItemById,
  _itemsByList,
  _openItemsByUser,
  _insertItem,
  _updateItem,
  _countItemsByList,
} from "./model";

// --- List Queries ---

export const getListById = internalQuery({
  args: { id: v.id("lists") },
  handler: async (ctx, args) => {
    return await _findListById(ctx, args.id);
  },
});

export const getListsByUser = internalQuery({
  args: {
    userId: v.id("users"),
    pinned: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await _listsByUser(ctx, args.userId, {
      pinned: args.pinned,
      includeArchived: args.includeArchived,
    });
  },
});

// --- List Mutations ---

export const insertList = internalMutation({
  args: {
    name: v.string(),
    pinned: v.boolean(),
    userId: v.id("users"),
  },
  returns: v.id("lists"),
  handler: async (ctx, args) => {
    return await _insertList(ctx, args);
  },
});

export const updateList = internalMutation({
  args: {
    id: v.id("lists"),
    name: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const update: Record<string, unknown> = {};
    if (fields.name !== undefined) update.name = fields.name;
    if (fields.pinned !== undefined) update.pinned = fields.pinned;
    if (fields.archivedAt !== undefined) update.archivedAt = fields.archivedAt;
    await _updateList(ctx, id, update);
  },
});

// --- Item Queries ---

export const getItemById = internalQuery({
  args: { id: v.id("listItems") },
  handler: async (ctx, args) => {
    return await _findItemById(ctx, args.id);
  },
});

export const getItemsByList = internalQuery({
  args: {
    listId: v.id("lists"),
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await _itemsByList(ctx, args.listId, {
      includeCompleted: args.includeCompleted,
    });
  },
});

export const getOpenItemsByUser = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await _openItemsByUser(ctx, args.userId, args.limit ?? 50);
  },
});

export const getItemCountsByList = internalQuery({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    return await _countItemsByList(ctx, args.listId);
  },
});

// --- Item Mutations ---

export const insertItem = internalMutation({
  args: {
    title: v.string(),
    status: listItemStatus,
    position: v.number(),
    listId: v.id("lists"),
    userId: v.id("users"),
  },
  returns: v.id("listItems"),
  handler: async (ctx, args) => {
    return await _insertItem(ctx, args);
  },
});

export const updateItem = internalMutation({
  args: {
    id: v.id("listItems"),
    title: v.optional(v.string()),
    status: v.optional(listItemStatus),
    position: v.optional(v.number()),
    completedAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const update: Record<string, unknown> = {};
    if (fields.title !== undefined) update.title = fields.title;
    if (fields.status !== undefined) update.status = fields.status;
    if (fields.position !== undefined) update.position = fields.position;
    if (fields.completedAt !== undefined) {
      update.completedAt =
        fields.completedAt === null ? undefined : fields.completedAt;
    }
    await _updateItem(ctx, id, update);
  },
});
