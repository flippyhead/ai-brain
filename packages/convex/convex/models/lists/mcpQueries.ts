import { query } from "../../_generated/server";
import { v } from "convex/values";
import {
  _listsByUser,
  _itemsByList,
  _openItemsByUser,
  _countItemsByList,
  _findListById,
} from "./model";

export const getLists = query({
  args: {
    userId: v.id("users"),
    pinned: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const lists = await _listsByUser(ctx, args.userId, {
      pinned: args.pinned,
      includeArchived: args.includeArchived,
    });

    const listsWithCounts = await Promise.all(
      lists.map(async (list) => {
        const counts = await _countItemsByList(ctx, list._id);
        return {
          listId: list._id,
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
    userId: v.id("users"),
    listId: v.id("lists"),
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== args.userId) {
      throw new Error("List not found");
    }

    const items = await _itemsByList(ctx, args.listId, {
      includeCompleted: args.includeCompleted,
    });

    return {
      listId: list._id,
      name: list.name,
      pinned: list.pinned,
      items: items.map((item) => ({
        itemId: item._id,
        title: item.title,
        status: item.status,
        position: item.position,
        completedAt: item.completedAt,
        url: item.url,
        description: item.description,
        properties: item.properties,
      })),
    };
  },
});

export const getOpenItems = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const items = await _openItemsByUser(ctx, args.userId);

    // Fetch list names and filter out items from archived lists
    const listCache = new Map<string, { name: string; archived: boolean }>();
    const results = [];

    for (const item of items) {
      let listInfo = listCache.get(item.listId);
      if (!listInfo) {
        const list = await _findListById(ctx, item.listId);
        listInfo = {
          name: list?.name ?? "Unknown",
          archived: list?.archivedAt !== undefined,
        };
        listCache.set(item.listId, listInfo);
      }

      if (!listInfo.archived) {
        results.push({
          itemId: item._id,
          title: item.title,
          position: item.position,
          listId: item.listId,
          listName: listInfo.name,
          url: item.url,
          description: item.description,
          properties: item.properties,
        });
      }
    }

    // Sort by list name, then position
    results.sort((a, b) => {
      const nameCompare = a.listName.localeCompare(b.listName);
      if (nameCompare !== 0) return nameCompare;
      return a.position - b.position;
    });

    return results.slice(0, limit);
  },
});
