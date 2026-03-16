import { query, mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { listItemStatus } from "./validators";
import {
  _listsByUser,
  _countItemsByList,
  _findListById,
  _itemsByList,
  _insertList,
  _updateList,
  _insertItem,
  _findItemById,
  _updateItem,
  _deleteItem,
} from "./model";

// --- Queries ---

export const getLists = query({
  args: {
    pinned: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const lists = await _listsByUser(ctx, userId, { pinned: args.pinned, includeArchived: args.includeArchived });
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

    const listId = await _insertList(ctx, {
      name: args.name,
      pinned: args.pinned,
      userId,
    });
    return { listId, name: args.name, pinned: args.pinned };
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

    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }

    const update: Partial<{ name: string; pinned: boolean }> = {};
    if (args.name !== undefined) update.name = args.name;
    if (args.pinned !== undefined) update.pinned = args.pinned;
    await _updateList(ctx, args.listId, update);
  },
});

export const archiveList = mutation({
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }
    await _updateList(ctx, args.listId, { archivedAt: Date.now() });
  },
});

export const unarchiveList = mutation({
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }
    await ctx.db.patch(args.listId, { archivedAt: undefined });
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

    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }

    const items = await _itemsByList(ctx, args.listId, { includeCompleted: true });
    const maxPosition = items.length > 0
      ? Math.max(...items.map((i) => i.position))
      : 0;

    const itemId = await _insertItem(ctx, {
      title: args.title,
      status: "open",
      position: maxPosition + 1,
      listId: args.listId,
      userId,
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

    const item = await _findItemById(ctx, args.itemId);
    if (!item || item.userId !== userId) {
      throw new Error("Item not found");
    }

    const update: Partial<{
      title: string;
      status: "open" | "done";
      completedAt: number | undefined;
    }> = {};
    if (args.title !== undefined) update.title = args.title;
    if (args.status !== undefined) {
      update.status = args.status;
      if (args.status === "done") {
        update.completedAt = Date.now();
      } else {
        update.completedAt = undefined;
      }
    }

    await _updateItem(ctx, args.itemId, update);
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
