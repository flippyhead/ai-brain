import { query, mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { listItemStatus } from "./validators";
import {
  _listsByUser,
  _countItemsByList,
  _findListById,
  _itemsByList,
  _findItemById,
  _deleteItem,
  _createListForUser,
  _updateListForUser,
  _archiveListForUser,
  _createListItemForUser,
  _updateListItemForUser,
} from "./model";

// --- Queries ---

export const getLists = query({
  args: {
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const lists = await _listsByUser(ctx, userId, { pinned: args.pinned });
    const listsWithCounts = await Promise.all(
      lists.map(async (list) => {
        const counts = await _countItemsByList(ctx, list._id);
        return {
          _id: list._id,
          _creationTime: list._creationTime,
          name: list.name,
          pinned: list.pinned,
          archivedAt: list.archivedAt,
          counts,
        };
      }),
    );
    return listsWithCounts;
  },
});

export const getList = query({
  args: {
    listId: v.id("lists"),
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }

    const items = await _itemsByList(ctx, args.listId, {
      includeCompleted: args.includeCompleted,
    });

    return {
      _id: list._id,
      name: list.name,
      pinned: list.pinned,
      items: items.map((item) => ({
        _id: item._id,
        title: item.title,
        status: item.status,
        position: item.position,
        completedAt: item.completedAt,
      })),
    };
  },
});

// --- Mutations ---

export const createList = mutation({
  args: {
    name: v.string(),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await _createListForUser(ctx, {
      userId,
      name: args.name,
      pinned: args.pinned,
    });
  },
});

export const updateList = mutation({
  args: {
    listId: v.id("lists"),
    name: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    await _updateListForUser(ctx, {
      userId,
      listId: args.listId,
      name: args.name,
      pinned: args.pinned,
    });
  },
});

export const archiveList = mutation({
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    await _archiveListForUser(ctx, { userId, listId: args.listId });
  },
});

export const createListItem = mutation({
  args: {
    listId: v.id("lists"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const { itemId } = await _createListItemForUser(ctx, {
      userId,
      listId: args.listId,
      title: args.title,
    });
    return { itemId };
  },
});

export const updateListItem = mutation({
  args: {
    itemId: v.id("listItems"),
    title: v.optional(v.string()),
    status: v.optional(listItemStatus),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    await _updateListItemForUser(ctx, {
      userId,
      itemId: args.itemId,
      title: args.title,
      status: args.status,
    });
  },
});

export const deleteListItem = mutation({
  args: {
    itemId: v.id("listItems"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const item = await _findItemById(ctx, args.itemId);
    if (!item || item.userId !== userId) {
      throw new Error("Item not found");
    }

    await _deleteItem(ctx, args.itemId);
  },
});
