import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { requireMcpUserId } from "../../lib/mcpAuth";
import { listItemStatus } from "./validators";
import {
  _insertList,
  _findListById,
  _updateList,
  _insertItem,
  _findItemById,
  _updateItem,
  _itemsByList,
} from "./model";

export const createList = mutation({
  args: {
    name: v.string(),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
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
    const userId = await requireMcpUserId(ctx);
    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }

    const update: Partial<{ name: string; pinned: boolean }> = {};
    if (args.name !== undefined) update.name = args.name;
    if (args.pinned !== undefined) update.pinned = args.pinned;
    await _updateList(ctx, args.listId, update);

    return {
      listId: args.listId,
      name: args.name ?? list.name,
      pinned: args.pinned ?? list.pinned,
    };
  },
});

export const archiveList = mutation({
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }
    await _updateList(ctx, args.listId, { archivedAt: Date.now() });
    return { success: true };
  },
});

export const createListItem = mutation({
  args: {
    listId: v.id("lists"),
    title: v.string(),
    url: v.optional(v.string()),
    description: v.optional(v.string()),
    properties: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }

    // Get max position in list
    const items = await _itemsByList(ctx, args.listId, {
      includeCompleted: true,
    });
    const maxPosition =
      items.length > 0 ? Math.max(...items.map((i) => i.position)) : 0;

    const itemId = await _insertItem(ctx, {
      title: args.title,
      status: "open",
      position: maxPosition + 1,
      listId: args.listId,
      userId,
      url: args.url,
      description: args.description,
      properties: args.properties,
    });

    return {
      itemId,
      title: args.title,
      status: "open" as const,
      position: maxPosition + 1,
      url: args.url,
      description: args.description,
      properties: args.properties,
    };
  },
});

export const updateListItem = mutation({
  args: {
    itemId: v.id("listItems"),
    title: v.optional(v.string()),
    status: v.optional(listItemStatus),
    position: v.optional(v.number()),
    url: v.optional(v.string()),
    description: v.optional(v.string()),
    properties: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    const item = await _findItemById(ctx, args.itemId);
    if (!item || item.userId !== userId) {
      throw new Error("Item not found");
    }

    const update: Record<string, unknown> = {};
    if (args.title !== undefined) update.title = args.title;
    if (args.position !== undefined) update.position = args.position;
    if (args.url !== undefined) update.url = args.url;
    if (args.description !== undefined) update.description = args.description;
    if (args.properties !== undefined) update.properties = args.properties;

    if (args.status !== undefined) {
      update.status = args.status;
      if (args.status === "done") {
        update.completedAt = Date.now();
      } else {
        update.completedAt = undefined;
      }
    }

    await _updateItem(ctx, args.itemId, update);

    return {
      itemId: args.itemId,
      title: args.title ?? item.title,
      status: args.status ?? item.status,
      position: args.position ?? item.position,
      completedAt:
        args.status !== undefined ? update.completedAt : item.completedAt,
      url: args.url ?? item.url,
      description: args.description ?? item.description,
      properties: args.properties ?? item.properties,
    };
  },
});
