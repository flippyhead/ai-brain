"use node";

import { action } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { v, type Infer } from "convex/values";
import { requireMcpUserId } from "../../lib/mcpAuth";
import type { MemoryStatus } from "./memoryLifecycle";
import { memoryStatus, thoughtMetadata } from "./validators";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

const SNIPPET_CHARS = 240;

function truncateSnippet(content: string): string {
  const chars: string[] = [];
  for (const ch of content) {
    if (chars.length >= SNIPPET_CHARS) {
      return chars.join("") + "…";
    }
    chars.push(ch);
  }
  return content;
}

export const capture = action({
  args: {
    content: v.string(),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    isCore: v.optional(v.boolean()),
  },
  returns: v.object({
    thoughtId: v.id("thoughts"),
    metadata: thoughtMetadata,
    operationSummary: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    return await ctx.runAction(
      internal.models.thoughts.actions.captureThought,
      {
        userId,
        content: args.content,
        validFrom: args.validFrom,
        validTo: args.validTo,
        isCore: args.isCore,
      },
    );
  },
});

export const search = action({
  args: {
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
    includeHistorical: v.optional(v.boolean()),
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
      memoryStatus,
      isCore: v.optional(v.boolean()),
      validFrom: v.optional(v.number()),
      validTo: v.optional(v.number()),
      supersededAt: v.optional(v.number()),
      changeReason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    const hits: Array<{
      _id: Id<"thoughts">;
      content: string;
      metadata: Infer<typeof thoughtMetadata>;
      score: number;
      createdAt: number;
      memoryStatus: MemoryStatus;
      isCore?: boolean;
      validFrom?: number;
      validTo?: number;
      supersededAt?: number;
      changeReason?: string;
    }> = await ctx.runAction(internal.models.thoughts.actions.hybridSearch, {
      userId,
      query: args.query,
      type: args.type,
      limit: args.limit,
      includeHistorical: args.includeHistorical,
    });

    return hits.map((h) => ({
      _id: h._id,
      summary: h.metadata.summary,
      snippet: truncateSnippet(h.content),
      type: h.metadata.type,
      topics: h.metadata.topics,
      score: h.score,
      createdAt: h.createdAt,
      memoryStatus: h.memoryStatus,
      isCore: h.isCore,
      validFrom: h.validFrom,
      validTo: h.validTo,
      supersededAt: h.supersededAt,
      changeReason: h.changeReason,
    }));
  },
});

export const getByIds = action({
  args: {
    ids: v.array(v.id("thoughts")),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      content: v.string(),
      metadata: thoughtMetadata,
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
      memoryStatus,
      isCore: v.optional(v.boolean()),
      validFrom: v.optional(v.number()),
      validTo: v.optional(v.number()),
      supersededAt: v.optional(v.number()),
      supersededBy: v.optional(v.id("thoughts")),
      supersedes: v.optional(v.array(v.id("thoughts"))),
      changeReason: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    const docs: Array<{
      _id: Id<"thoughts">;
      _creationTime: number;
      content: string;
      metadata: Infer<typeof thoughtMetadata>;
      userId: string;
      updatedAt?: number;
      memoryStatus?: MemoryStatus;
      isCore?: boolean;
      validFrom?: number;
      validTo?: number;
      supersededAt?: number;
      supersededBy?: Id<"thoughts">;
      supersedes?: Array<Id<"thoughts">>;
      changeReason?: string;
    }> = await ctx.runQuery(internal.models.thoughts.private.getByIds, {
      ids: args.ids,
    });

    // Enforce ownership — drop any doc that doesn't belong to caller
    return docs
      .filter((d) => d.userId === userId)
      .map((d) => ({
        _id: d._id,
        content: d.content,
        metadata: d.metadata,
        createdAt: d._creationTime,
        updatedAt: d.updatedAt,
        memoryStatus: d.memoryStatus ?? "current",
        isCore: d.isCore,
        validFrom: d.validFrom,
        validTo: d.validTo,
        supersededAt: d.supersededAt,
        supersededBy: d.supersededBy,
        supersedes: d.supersedes,
        changeReason: d.changeReason,
      }));
  },
});

export const timeline = action({
  args: {
    seedId: v.optional(v.id("thoughts")),
    aroundMs: v.optional(v.number()),
    before: v.optional(v.number()),
    after: v.optional(v.number()),
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
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      summary: v.string(),
      snippet: v.string(),
      type: v.string(),
      topics: v.array(v.string()),
      createdAt: v.number(),
      memoryStatus,
      isCore: v.optional(v.boolean()),
      validFrom: v.optional(v.number()),
      validTo: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireMcpUserId(ctx);
    const MAX_WINDOW = 50;
    const before = Math.min(args.before ?? 5, MAX_WINDOW);
    const after = Math.min(args.after ?? 5, MAX_WINDOW);

    if (args.seedId !== undefined && args.aroundMs !== undefined) {
      throw new Error("Provide only one of seedId or aroundMs, not both");
    }

    // Resolve pivot timestamp. If seedId is provided, also keep the seed
    // doc so we can splice it into the result (listAroundTime uses strict
    // < / > bounds and excludes the anchor).
    let aroundMs = args.aroundMs;
    let seedDoc: {
      _id: Id<"thoughts">;
      _creationTime: number;
      content: string;
      metadata: Infer<typeof thoughtMetadata>;
      memoryStatus?: MemoryStatus;
      isCore?: boolean;
      validFrom?: number;
      validTo?: number;
    } | null = null;
    if (args.seedId) {
      const seed = await ctx.runQuery(
        internal.models.thoughts.private.getById,
        { id: args.seedId },
      );
      if (!seed || seed.userId !== userId) {
        throw new Error("Seed thought not found");
      }
      seedDoc = {
        _id: seed._id,
        _creationTime: seed._creationTime,
        content: seed.content,
        metadata: seed.metadata,
        memoryStatus: seed.memoryStatus,
        isCore: seed.isCore,
        validFrom: seed.validFrom,
        validTo: seed.validTo,
      };
      if (aroundMs === undefined) {
        aroundMs = seed._creationTime;
      }
    }
    if (aroundMs === undefined) {
      throw new Error("Either seedId or aroundMs is required");
    }

    const docs: Array<{
      _id: Id<"thoughts">;
      _creationTime: number;
      content: string;
      metadata: Infer<typeof thoughtMetadata>;
      memoryStatus?: MemoryStatus;
      isCore?: boolean;
      validFrom?: number;
      validTo?: number;
    }> = await ctx.runQuery(internal.models.thoughts.private.listAroundTime, {
      userId,
      aroundMs,
      before,
      after,
      type: args.type,
    });

    const mapped = docs.map((d) => ({
      _id: d._id,
      summary: d.metadata.summary,
      snippet: truncateSnippet(d.content),
      type: d.metadata.type,
      topics: d.metadata.topics,
      createdAt: d._creationTime,
      memoryStatus: d.memoryStatus ?? "current",
      isCore: d.isCore,
      validFrom: d.validFrom,
      validTo: d.validTo,
    }));

    // Splice the seed into its chronological position. listAroundTime
    // returns results sorted ascending by _creationTime with strict < / >
    // bounds, so the seed goes at the first index whose createdAt is
    // greater than the seed's. If none, append.
    if (seedDoc) {
      const seedRow = {
        _id: seedDoc._id,
        summary: seedDoc.metadata.summary,
        snippet: truncateSnippet(seedDoc.content),
        type: seedDoc.metadata.type,
        topics: seedDoc.metadata.topics,
        createdAt: seedDoc._creationTime,
        memoryStatus: seedDoc.memoryStatus ?? "current",
        isCore: seedDoc.isCore,
        validFrom: seedDoc.validFrom,
        validTo: seedDoc.validTo,
      };
      let insertAt = mapped.length;
      for (let i = 0; i < mapped.length; i++) {
        if (mapped[i]!.createdAt > seedRow.createdAt) {
          insertAt = i;
          break;
        }
      }
      mapped.splice(insertAt, 0, seedRow);
    }

    return mapped;
  },
});
