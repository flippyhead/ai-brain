import { QueryCtx, MutationCtx } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

export async function _findById(ctx: QueryCtx, id: Id<"thoughts">) {
  return await ctx.db.get(id);
}

export async function _listByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number = 20,
) {
  return await ctx.db
    .query("thoughts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .take(limit);
}

export async function _insertOne(
  ctx: MutationCtx,
  fields: {
    content: string;
    embedding: number[];
    metadata: {
      type:
        | "decision"
        | "person_note"
        | "idea"
        | "meeting_note"
        | "task"
        | "reference";
      topics: string[];
      people: string[];
      actionItems: string[];
      summary: string;
    };
    userId: Id<"users">;
  },
) {
  return await ctx.db.insert("thoughts", fields);
}

export async function _updateOne(
  ctx: MutationCtx,
  id: Id<"thoughts">,
  fields: {
    content: string;
    embedding: number[];
    metadata: {
      type:
        | "decision"
        | "person_note"
        | "idea"
        | "meeting_note"
        | "task"
        | "reference";
      topics: string[];
      people: string[];
      actionItems: string[];
      summary: string;
    };
    updatedAt: number;
  },
) {
  await ctx.db.patch(id, fields);
}

export async function _deleteOne(ctx: MutationCtx, id: Id<"thoughts">) {
  await ctx.db.delete(id);
}
