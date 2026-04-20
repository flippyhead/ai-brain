"use node";

import { action } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { v, type Infer } from "convex/values";
import { thoughtMetadata } from "./validators";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

// Public actions for MCP endpoint — accept userId as parameter
// (auth is handled by API key validation in the Next.js API route)

export const capture = action({
  args: {
    userId: v.id("users"),
    content: v.string(),
  },
  returns: v.object({
    thoughtId: v.id("thoughts"),
    metadata: thoughtMetadata,
    operationSummary: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    return await ctx.runAction(
      internal.models.thoughts.actions.captureThought,
      { userId: args.userId, content: args.content },
    );
  },
});

export const search = action({
  args: {
    userId: v.id("users"),
    query: v.string(),
    type: v.optional(
      v.union(
        v.literal("decision"),
        v.literal("person_note"),
        v.literal("idea"),
        v.literal("meeting_note"),
        v.literal("task"),
        v.literal("reference"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      summary: v.string(),
      snippet: v.string(),
      type: v.string(),
      topics: v.array(v.string()),
      score: v.float64(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const SNIPPET_CHARS = 240;
    const hits: Array<{
      _id: Id<"thoughts">;
      content: string;
      metadata: Infer<typeof thoughtMetadata>;
      score: number;
      createdAt: number;
    }> = await ctx.runAction(
      internal.models.thoughts.actions.hybridSearch,
      {
        userId: args.userId,
        query: args.query,
        type: args.type,
        limit: args.limit,
      },
    );

    return hits.map((h) => ({
      _id: h._id,
      summary: h.metadata.summary,
      snippet: (() => {
        const chars = Array.from(h.content);
        return chars.length > SNIPPET_CHARS
          ? chars.slice(0, SNIPPET_CHARS).join("") + "…"
          : h.content;
      })(),
      type: h.metadata.type,
      topics: h.metadata.topics,
      score: h.score,
      createdAt: h.createdAt,
    }));
  },
});

export const getByIds = action({
  args: {
    userId: v.id("users"),
    ids: v.array(v.id("thoughts")),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      content: v.string(),
      metadata: thoughtMetadata,
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const docs: Array<{
      _id: Id<"thoughts">;
      _creationTime: number;
      content: string;
      metadata: Infer<typeof thoughtMetadata>;
      userId: string;
      updatedAt?: number;
    }> = await ctx.runQuery(
      internal.models.thoughts.private.getByIds,
      { ids: args.ids },
    );

    // Enforce ownership — drop any doc that doesn't belong to caller
    return docs
      .filter((d) => d.userId === args.userId)
      .map((d) => ({
        _id: d._id,
        content: d.content,
        metadata: d.metadata,
        createdAt: d._creationTime,
        updatedAt: d.updatedAt,
      }));
  },
});
