import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { listItemStatus } from "./validators";
import {
  _createListForUser,
  _updateListForUser,
  _archiveListForUser,
  _createListItemForUser,
  _updateListItemForUser,
} from "./model";

export const createList = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await _createListForUser(ctx, {
      userId: args.userId,
      name: args.name,
      pinned: args.pinned,
    });
  },
});

export const updateList = mutation({
  args: {
    userId: v.id("users"),
    listId: v.id("lists"),
    name: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { resolved } = await _updateListForUser(ctx, {
      userId: args.userId,
      listId: args.listId,
      name: args.name,
      pinned: args.pinned,
    });
    return {
      listId: args.listId,
      name: resolved.name,
      pinned: resolved.pinned,
    };
  },
});

export const archiveList = mutation({
  args: {
    userId: v.id("users"),
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    await _archiveListForUser(ctx, { userId: args.userId, listId: args.listId });
    return { success: true };
  },
});

export const createListItem = mutation({
  args: {
    userId: v.id("users"),
    listId: v.id("lists"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const { itemId, title, status, position } = await _createListItemForUser(
      ctx,
      {
        userId: args.userId,
        listId: args.listId,
        title: args.title,
      },
    );
    return {
      itemId,
      title,
      status,
      position,
    };
  },
});

export const updateListItem = mutation({
  args: {
    userId: v.id("users"),
    itemId: v.id("listItems"),
    title: v.optional(v.string()),
    status: v.optional(listItemStatus),
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { resolved } = await _updateListItemForUser(ctx, {
      userId: args.userId,
      itemId: args.itemId,
      title: args.title,
      status: args.status,
      position: args.position,
    });
    return {
      itemId: args.itemId,
      title: resolved.title,
      status: resolved.status,
      position: resolved.position,
      completedAt: resolved.completedAt,
    };
  },
});
