import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { _listsByUser, _countItemsByList } from "./model";

export const listRecent = query({
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
