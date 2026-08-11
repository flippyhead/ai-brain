import { query } from "../../_generated/server";
import { v } from "convex/values";

import { requireMcpUserId } from "../../lib/mcpAuth";
import { listFacts, searchFacts } from "./model";

export const search = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    includeHistorical: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    return await searchFacts(ctx, userId, args.query, args);
  },
});

export const listCore = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    return await listFacts(ctx, userId, { ...args, coreOnly: true });
  },
});
