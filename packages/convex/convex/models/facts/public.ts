import { query } from "../../_generated/server";
import { v } from "convex/values";

import { requireWebUserId } from "../../lib/webAuth";
import { listFacts } from "./model";

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
    includeHistorical: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireWebUserId(ctx);
    return await listFacts(ctx, userId, args);
  },
});
