import { QueryCtx, MutationCtx } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

// --- Lists ---

export async function _findListById(ctx: QueryCtx, id: Id<"lists">) {
  return await ctx.db.get(id);
}

export async function _listsByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  opts?: { pinned?: boolean; includeArchived?: boolean },
) {
  let query;
  if (opts?.pinned !== undefined) {
    query = ctx.db
      .query("lists")
      .withIndex("by_userId_and_pinned", (q) =>
        q.eq("userId", userId).eq("pinned", opts.pinned!),
      );
  } else {
    query = ctx.db
      .query("lists")
      .withIndex("by_userId", (q) => q.eq("userId", userId));
  }

  const results = await query.collect();

  // Archived lists are always excluded from pinned queries
  if (opts?.pinned) {
    return results.filter((l) => l.archivedAt === undefined);
  }
  if (!opts?.includeArchived) {
    return results.filter((l) => l.archivedAt === undefined);
  }
  return results;
}

export async function _insertList(
  ctx: MutationCtx,
  fields: { name: string; pinned: boolean; userId: Id<"users"> },
) {
  return await ctx.db.insert("lists", fields);
}

export async function _updateList(
  ctx: MutationCtx,
  id: Id<"lists">,
  fields: Partial<{ name: string; pinned: boolean; archivedAt: number }>,
) {
  await ctx.db.patch(id, fields);
}

// --- List Items ---

export async function _findItemById(ctx: QueryCtx, id: Id<"listItems">) {
  return await ctx.db.get(id);
}

export async function _itemsByList(
  ctx: QueryCtx,
  listId: Id<"lists">,
  opts?: { includeCompleted?: boolean },
) {
  const items = await ctx.db
    .query("listItems")
    .withIndex("by_listId", (q) => q.eq("listId", listId))
    .collect();

  const filtered = opts?.includeCompleted
    ? items
    : items.filter((i) => i.status === "open");

  return filtered.sort((a, b) => a.position - b.position);
}

export async function _openItemsByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit?: number,
) {
  const query = ctx.db
    .query("listItems")
    .withIndex("by_userId_and_status", (q) =>
      q.eq("userId", userId).eq("status", "open"),
    );

  return limit === undefined ? await query.collect() : await query.take(limit);
}

export async function _insertItem(
  ctx: MutationCtx,
  fields: {
    title: string;
    status: "open" | "done";
    position: number;
    listId: Id<"lists">;
    userId: Id<"users">;
  },
) {
  return await ctx.db.insert("listItems", fields);
}

export async function _updateItem(
  ctx: MutationCtx,
  id: Id<"listItems">,
  fields: Partial<{
    title: string;
    status: "open" | "done";
    position: number;
    completedAt: number | undefined;
  }>,
) {
  await ctx.db.patch(id, fields);
}

export async function _deleteItem(ctx: MutationCtx, id: Id<"listItems">) {
  await ctx.db.delete(id);
}

export async function _countItemsByList(
  ctx: QueryCtx,
  listId: Id<"lists">,
) {
  const items = await ctx.db
    .query("listItems")
    .withIndex("by_listId", (q) => q.eq("listId", listId))
    .collect();

  const open = items.filter((i) => i.status === "open").length;
  const done = items.filter((i) => i.status === "done").length;
  return { total: items.length, open, done };
}
