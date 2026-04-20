# Memory Retrieval Upgrades Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade thought retrieval with (1) progressive disclosure, (2) hybrid keyword + semantic search, (3) timeline navigation, and (4) stable citation IDs — so Claude can search cheaply, fetch selectively, and ground recommendations in verifiable sources.

**Architecture:** Add a full-text `searchIndex` to the `thoughts` table. Split the current `search_thoughts` MCP tool into a lightweight index tool (snippets only) plus a new `get_thoughts` batch-detail tool. Merge vector and text results via Reciprocal Rank Fusion (RRF, k=60). Add a `timeline_thoughts` tool that navigates by creation time around a seed. Surface `id` in every response and update tool descriptions to instruct Claude to cite `thought:<id>` when referencing memory.

**Tech Stack:** Convex (DB + vector + search indexes), Next.js (MCP server), `@modelcontextprotocol/sdk`, Zod, TypeScript.

**Conventions:** This monorepo has no test framework installed. Following existing plan style (`2026-03-15-lists-implementation.md`), tasks include structural changes + manual verification via the MCP endpoint or Convex dashboard, not unit tests. If a test harness is added later, the schema and RRF logic are the first things worth covering.

**Commit style:** `feat(mcp): <short>` or `feat(convex): <short>` to match recent history.

---

## Chunk 1: Backend Foundation

### Task 1: Add full-text search index to thoughts table

**Files:**
- Modify: `packages/convex/convex/schema.ts`

- [ ] **Step 1: Add `searchIndex` after the vectorIndex**

Replace the `thoughts: defineTable(...)` block with:

```typescript
thoughts: defineTable(thoughtFields)
  .index("by_userId", ["userId"])
  .index("by_userId_and_type", ["userId", "metadata.type"])
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["userId"],
  })
  .searchIndex("by_content", {
    searchField: "content",
    filterFields: ["userId", "metadata.type"],
  }),
```

- [ ] **Step 2: Deploy to dev and verify index builds**

Run: `pnpm --filter @repo/db deploy:dev`
Expected: Command exits without errors. In the Convex dashboard, table `thoughts` now lists the `by_content` search index and reports a row count matching existing data.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/schema.ts
git commit -m "feat(convex): add full-text search index to thoughts"
```

---

### Task 2: Internal query for keyword-only search

**Files:**
- Modify: `packages/convex/convex/models/thoughts/private.ts`

- [ ] **Step 1: Import `thoughtType`**

At the top of `private.ts`, change:

```typescript
import { thoughtMetadata } from "./validators";
```

to:

```typescript
import { thoughtMetadata, thoughtType } from "./validators";
```

- [ ] **Step 2: Append `searchByText` internalQuery to `private.ts`**

```typescript
export const searchByText = internalQuery({
  args: {
    userId: v.id("users"),
    query: v.string(),
    type: v.optional(thoughtType),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const results = await ctx.db
      .query("thoughts")
      .withSearchIndex("by_content", (q) => {
        const base = q.search("content", args.query).eq("userId", args.userId);
        return args.type ? base.eq("metadata.type", args.type) : base;
      })
      .take(limit);
    return results.map(({ embedding: _embedding, ...rest }) => rest);
  },
});
```

- [ ] **Step 3: Deploy and verify via Convex dashboard**

Run: `pnpm --filter @repo/db deploy:dev`

In the Convex dashboard → Functions, invoke `models/thoughts/private:searchByText` with a real `userId` and a query containing an exact token you know exists (e.g. a proper noun from an existing thought). Expected: non-empty array with matching `_id`s, creation time, and `metadata`.

- [ ] **Step 4: Commit**

```bash
git add packages/convex/convex/models/thoughts/private.ts
git commit -m "feat(convex): add searchByText internal query"
```

---

### Task 3: Hybrid search internal action (vector + text via RRF)

**Files:**
- Modify: `packages/convex/convex/models/thoughts/actions.ts`

- [ ] **Step 1: Add imports**

Ensure these imports exist at the top of `actions.ts`:

```typescript
import { internalAction } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import { v } from "convex/values";
import { thoughtMetadata, thoughtType } from "./validators";
```

(`thoughtType` is new; `internalAction` and `internal` already exist.)

- [ ] **Step 2: Append `hybridSearch` internalAction to `actions.ts`**

```typescript
export const hybridSearch = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
    type: v.optional(thoughtType),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      content: v.string(),
      metadata: thoughtMetadata,
      score: v.float64(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const candidateCap = 50;
    const K = 60; // RRF constant

    // Generate embedding once; run vector + text in parallel
    const embedding = await ctx.runAction(
      internal.models.thoughts.helpers.generateEmbedding,
      { text: args.query },
    );

    const [vectorHits, textHits] = await Promise.all([
      ctx.vectorSearch("thoughts", "by_embedding", {
        vector: embedding,
        limit: candidateCap,
        filter: (q) => q.eq("userId", args.userId),
      }),
      ctx.runQuery(internal.models.thoughts.private.searchByText, {
        userId: args.userId,
        query: args.query,
        type: args.type,
        limit: candidateCap,
      }),
    ]);

    // If type filter is set, we need vector hits' types too. Fetch docs for
    // type-unknown vector hits now (one query each). Convex vectorSearch does
    // not support filtering on object fields like metadata.type, so we
    // post-filter. Text hits already respect the type filter.
    let filteredVectorHits = vectorHits;
    if (args.type) {
      const docs = await Promise.all(
        vectorHits.map((h) =>
          ctx.runQuery(internal.models.thoughts.private.getById, { id: h._id }),
        ),
      );
      filteredVectorHits = vectorHits.filter(
        (_h, i) => docs[i]?.metadata.type === args.type,
      );
    }

    // Reciprocal Rank Fusion: score = Σ 1 / (K + rank) across result lists
    const rrf = new Map<string, number>();
    filteredVectorHits.forEach((h, rank) => {
      rrf.set(h._id, (rrf.get(h._id) ?? 0) + 1 / (K + rank));
    });
    textHits.forEach((h, rank) => {
      rrf.set(h._id, (rrf.get(h._id) ?? 0) + 1 / (K + rank));
    });

    const rankedIds = [...rrf.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

    const docs = await Promise.all(
      rankedIds.map(async (id) => {
        const doc = await ctx.runQuery(
          internal.models.thoughts.private.getById,
          { id: id as any },
        );
        return doc
          ? {
              _id: doc._id,
              content: doc.content,
              metadata: doc.metadata,
              score: rrf.get(id)!,
              createdAt: doc._creationTime,
            }
          : null;
      }),
    );

    return docs.filter((d): d is NonNullable<typeof d> => d !== null);
  },
});
```

- [ ] **Step 3: Deploy and verify via Convex dashboard**

Run: `pnpm --filter @repo/db deploy:dev`

Invoke `models/thoughts/actions:hybridSearch` with a `userId` and a query containing both a semantic concept and an exact token (e.g. `"COPA Commander meeting"` — a proper noun + a common word). Expected: results include at least one thought that mentions the proper noun literally (would be missed by vector-only search). `score` values are small positive numbers (~0.01–0.03 range from RRF).

- [ ] **Step 4: Commit**

```bash
git add packages/convex/convex/models/thoughts/actions.ts
git commit -m "feat(convex): hybrid vector+text search with RRF merge"
```

---

## Chunk 2: Progressive Disclosure

### Task 4: Add internal `getByIds` batch query

**Files:**
- Modify: `packages/convex/convex/models/thoughts/private.ts`

- [ ] **Step 1: Append `getByIds` internalQuery**

```typescript
export const getByIds = internalQuery({
  args: { ids: v.array(v.id("thoughts")) },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return docs
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map(({ embedding: _embedding, ...rest }) => rest);
  },
});
```

- [ ] **Step 2: Deploy**

Run: `pnpm --filter @repo/db deploy:dev`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/models/thoughts/private.ts
git commit -m "feat(convex): add getByIds batch internal query"
```

---

### Task 5: Public `getByIds` action for MCP

**Files:**
- Modify: `packages/convex/convex/models/thoughts/mcpActions.ts`

- [ ] **Step 1: Append `getByIds` public action**

```typescript
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
      _id: string;
      _creationTime: number;
      content: string;
      metadata: {
        type: "decision" | "person_note" | "idea" | "meeting_note" | "task" | "reference";
        topics: string[];
        people: string[];
        actionItems: string[];
        summary: string;
      };
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
        _id: d._id as any,
        content: d.content,
        metadata: d.metadata,
        createdAt: d._creationTime,
        updatedAt: d.updatedAt,
      }));
  },
});
```

- [ ] **Step 2: Deploy and verify**

Run: `pnpm --filter @repo/db deploy:dev`

From the Convex dashboard invoke `models/thoughts/mcpActions:getByIds` with a valid `userId` and an array containing 2 thought IDs from that user plus 1 from a different user. Expected: array of length 2 (the foreign ID is filtered out).

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/models/thoughts/mcpActions.ts
git commit -m "feat(convex): add getByIds public action for MCP"
```

---

### Task 6: Add `get_thoughts` MCP tool (new, non-breaking)

**Files:**
- Modify: `apps/web/src/lib/mcp/tools.ts`
- Modify: `apps/web/src/lib/mcp/server.ts`

- [ ] **Step 1: Add new tool name**

In `tools.ts`, inside `MCP_TOOL_NAMES`, insert after `browseRecent: "browse_recent"`:

```typescript
  getThoughts: "get_thoughts",
```

- [ ] **Step 2: Register the tool in `server.ts`**

After the `browseRecent` tool block (ending near line 165), append:

```typescript
  server.tool(
    MCP_TOOL_NAMES.getThoughts,
    "Fetch full content for specific thought IDs. Use after `search_thoughts` to hydrate only the results that matter. Always batch multiple IDs in a single call.",
    {
      ids: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe("Thought IDs (from a prior search_thoughts call)"),
    },
    async ({ ids }) => {
      type Thought = {
        _id: string;
        content: string;
        metadata: {
          type: string;
          topics: string[];
          people: string[];
          actionItems: string[];
          summary: string;
        };
        createdAt: number;
        updatedAt?: number;
      };
      const results: Thought[] = await convex.action(
        api.models.thoughts.mcpActions.getByIds,
        { userId: userId as never, ids: ids as never },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No thoughts found for the provided IDs.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r._id,
                content: r.content,
                metadata: r.metadata,
                createdAt: new Date(r.createdAt).toISOString(),
                updatedAt: r.updatedAt
                  ? new Date(r.updatedAt).toISOString()
                  : undefined,
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 200000 },
      };
    },
  );
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/web check-types`
Expected: exits clean.

- [ ] **Step 4: Manual smoke test**

Run the dev server: `pnpm --filter @repo/web dev`
Using an MCP client (Claude Code with the plugin), call `get_thoughts` with IDs from a recent `search_thoughts` response. Expected: JSON array with `id`, `content`, `metadata`, `createdAt`. (If MCP client not wired, `curl -X POST` the `/api/mcp` endpoint with a valid bearer token; deferred to execution.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/mcp/tools.ts apps/web/src/lib/mcp/server.ts
git commit -m "feat(mcp): add get_thoughts tool for batch detail fetch"
```

---

### Task 7: Convert `search_thoughts` to index-only shape + hybrid source

**Files:**
- Modify: `packages/convex/convex/models/thoughts/mcpActions.ts`
- Modify: `apps/web/src/lib/mcp/server.ts`

This task changes the public `search` action's return shape and switches its source to `hybridSearch`. Index rows contain `id`, `summary`, `snippet`, `type`, `topics`, `score`, `createdAt` — roughly 10× smaller than full content.

- [ ] **Step 1: Replace the `search` action in `mcpActions.ts`**

Replace the existing `export const search = action({ ... })` block with:

```typescript
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
      _id: string;
      content: string;
      metadata: {
        type: string;
        topics: string[];
        people: string[];
        actionItems: string[];
        summary: string;
      };
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
      _id: h._id as any,
      summary: h.metadata.summary,
      snippet:
        h.content.length > SNIPPET_CHARS
          ? h.content.slice(0, SNIPPET_CHARS) + "…"
          : h.content,
      type: h.metadata.type,
      topics: h.metadata.topics,
      score: h.score,
      createdAt: h.createdAt,
    }));
  },
});
```

Note: the old `threshold` arg is dropped — RRF scores aren't comparable to cosine similarity. `type` is new; `limit` is unchanged.

- [ ] **Step 2: Update the `searchThoughts` MCP tool in `server.ts`**

Replace the existing `server.tool(MCP_TOOL_NAMES.searchThoughts, ...)` block with:

```typescript
  server.tool(
    MCP_TOOL_NAMES.searchThoughts,
    "Search stored thoughts by meaning AND keyword (hybrid). Returns a compact index — `id`, summary, short snippet, type, topics, score. Use `get_thoughts` to fetch full content for the IDs you care about. Cite sources as `thought:<id>` when referencing them in your response.",
    {
      query: z.string().describe("Natural language or keyword query"),
      type: z
        .enum([
          "decision",
          "person_note",
          "idea",
          "meeting_note",
          "task",
          "reference",
        ])
        .optional()
        .describe("Optional type filter"),
      limit: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max results to return"),
    },
    async ({ query, type, limit }) => {
      type IndexRow = {
        _id: string;
        summary: string;
        snippet: string;
        type: string;
        topics: string[];
        score: number;
        createdAt: number;
      };
      const results: IndexRow[] = await convex.action(
        api.models.thoughts.mcpActions.search,
        {
          userId: userId as never,
          query,
          type,
          limit,
        },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No matching thoughts found.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r._id,
                summary: r.summary,
                snippet: r.snippet,
                type: r.type,
                topics: r.topics,
                score: r.score,
                createdAt: new Date(r.createdAt).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 50000 },
      };
    },
  );
```

- [ ] **Step 3: Deploy and type-check**

Run in parallel:
- `pnpm --filter @repo/db deploy:dev`
- `pnpm --filter @repo/web check-types`

Expected: both succeed. (If `check-types` fails on the `mcpQueries` import or return type, resolve before committing.)

- [ ] **Step 4: Manual smoke test**

Call `search_thoughts` via MCP with a mixed query. Expected: JSON array where each row has `id`, `summary`, `snippet` (≤ 241 chars w/ trailing ellipsis when truncated), `type`, `topics`, `score`, `createdAt`. No `content` field present.

Then call `get_thoughts` with 2–3 IDs from that response. Expected: full content returned for those IDs only.

- [ ] **Step 5: Commit**

```bash
git add packages/convex/convex/models/thoughts/mcpActions.ts apps/web/src/lib/mcp/server.ts
git commit -m "feat(mcp): progressive disclosure — search_thoughts returns compact index, hybrid source"
```

---

## Chunk 3: Timeline Retrieval

### Task 8: Internal query for time-window neighbors

**Files:**
- Modify: `packages/convex/convex/models/thoughts/private.ts`

- [ ] **Step 1: Append `listAroundTime` internalQuery**

```typescript
export const listAroundTime = internalQuery({
  args: {
    userId: v.id("users"),
    aroundMs: v.number(),
    before: v.number(),
    after: v.number(),
    type: v.optional(thoughtType),
  },
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const indexName = args.type ? "by_userId_and_type" : "by_userId";

    const buildIndex = (q: any) => {
      if (args.type) {
        return q.eq("userId", args.userId).eq("metadata.type", args.type);
      }
      return q.eq("userId", args.userId);
    };

    // Older-than-or-equal-to aroundMs, most recent first, take `before`
    const earlier = await ctx.db
      .query("thoughts")
      .withIndex(indexName, buildIndex)
      .filter((q) => q.lte(q.field("_creationTime"), args.aroundMs))
      .order("desc")
      .take(args.before);

    // Strictly newer than aroundMs, oldest first, take `after`
    const later = await ctx.db
      .query("thoughts")
      .withIndex(indexName, buildIndex)
      .filter((q) => q.gt(q.field("_creationTime"), args.aroundMs))
      .order("asc")
      .take(args.after);

    const combined = [...earlier.reverse(), ...later];
    return combined.map(({ embedding: _embedding, ...rest }) => rest);
  },
});
```

- [ ] **Step 2: Deploy and verify**

Run: `pnpm --filter @repo/db deploy:dev`

In the Convex dashboard invoke `models/thoughts/private:listAroundTime` with a `userId`, `aroundMs` = some known thought's `_creationTime`, `before=3`, `after=3`. Expected: up to 7 thoughts in chronological order spanning before/after the pivot.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/models/thoughts/private.ts
git commit -m "feat(convex): listAroundTime internal query for timeline"
```

---

### Task 9: Public `timeline` action

**Files:**
- Modify: `packages/convex/convex/models/thoughts/mcpActions.ts`

- [ ] **Step 1: Append `timeline` public action**

```typescript
export const timeline = action({
  args: {
    userId: v.id("users"),
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
    }),
  ),
  handler: async (ctx, args) => {
    const SNIPPET_CHARS = 240;
    const before = args.before ?? 5;
    const after = args.after ?? 5;

    // Resolve pivot timestamp
    let aroundMs = args.aroundMs;
    if (!aroundMs) {
      if (!args.seedId) {
        throw new Error("Either seedId or aroundMs is required");
      }
      const seed = await ctx.runQuery(
        internal.models.thoughts.private.getById,
        { id: args.seedId },
      );
      if (!seed || seed.userId !== args.userId) {
        throw new Error("Seed thought not found");
      }
      aroundMs = seed._creationTime;
    }

    const docs: Array<{
      _id: string;
      _creationTime: number;
      content: string;
      metadata: {
        type: string;
        topics: string[];
        people: string[];
        actionItems: string[];
        summary: string;
      };
    }> = await ctx.runQuery(
      internal.models.thoughts.private.listAroundTime,
      {
        userId: args.userId,
        aroundMs,
        before,
        after,
        type: args.type,
      },
    );

    return docs.map((d) => ({
      _id: d._id as any,
      summary: d.metadata.summary,
      snippet:
        d.content.length > SNIPPET_CHARS
          ? d.content.slice(0, SNIPPET_CHARS) + "…"
          : d.content,
      type: d.metadata.type,
      topics: d.metadata.topics,
      createdAt: d._creationTime,
    }));
  },
});
```

- [ ] **Step 2: Deploy and verify**

Run: `pnpm --filter @repo/db deploy:dev`

Invoke `models/thoughts/mcpActions:timeline` with a valid `userId` and a `seedId` from a recent thought. Expected: up to 11 rows (5 before + seed + 5 after by default), ordered oldest→newest, each with `id`, `summary`, `snippet`, `type`, `topics`, `createdAt`.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/models/thoughts/mcpActions.ts
git commit -m "feat(convex): timeline public action for temporal neighbors"
```

---

### Task 10: `timeline_thoughts` MCP tool

**Files:**
- Modify: `apps/web/src/lib/mcp/tools.ts`
- Modify: `apps/web/src/lib/mcp/server.ts`

- [ ] **Step 1: Add tool name**

In `tools.ts`, inside `MCP_TOOL_NAMES`, insert after `getThoughts: "get_thoughts"`:

```typescript
  timelineThoughts: "timeline_thoughts",
```

- [ ] **Step 2: Register the tool in `server.ts`**

After the `get_thoughts` tool block, append:

```typescript
  server.tool(
    MCP_TOOL_NAMES.timelineThoughts,
    "Fetch thoughts captured around a specific point in time. Provide either `seedId` (anchor on another thought) or `aroundMs` (epoch ms). Returns compact index rows ordered oldest→newest — use `get_thoughts` for full content. Cite sources as `thought:<id>`.",
    {
      seedId: z
        .string()
        .optional()
        .describe("Thought ID to anchor the window around"),
      aroundMs: z
        .number()
        .optional()
        .describe("Epoch milliseconds to anchor the window around"),
      before: z
        .number()
        .min(0)
        .max(50)
        .default(5)
        .describe("How many thoughts from before the anchor"),
      after: z
        .number()
        .min(0)
        .max(50)
        .default(5)
        .describe("How many thoughts from after the anchor"),
      type: z
        .enum([
          "decision",
          "person_note",
          "idea",
          "meeting_note",
          "task",
          "reference",
        ])
        .optional()
        .describe("Optional type filter"),
    },
    async ({ seedId, aroundMs, before, after, type }) => {
      if (!seedId && aroundMs === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: provide either `seedId` or `aroundMs`.",
            },
          ],
          isError: true,
        };
      }

      type IndexRow = {
        _id: string;
        summary: string;
        snippet: string;
        type: string;
        topics: string[];
        createdAt: number;
      };
      const results: IndexRow[] = await convex.action(
        api.models.thoughts.mcpActions.timeline,
        {
          userId: userId as never,
          seedId: seedId as never,
          aroundMs,
          before,
          after,
          type,
        },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No thoughts found in the requested window.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              results.map((r) => ({
                id: r._id,
                summary: r.summary,
                snippet: r.snippet,
                type: r.type,
                topics: r.topics,
                createdAt: new Date(r.createdAt).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
        _meta: { "anthropic/maxResultSizeChars": 50000 },
      };
    },
  );
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/web check-types`
Expected: exits clean.

- [ ] **Step 4: Manual smoke test**

Call `timeline_thoughts` via MCP with `seedId` = a recent thought's ID. Expected: JSON array, chronological, each row has `id`, `summary`, `snippet`, `type`, `topics`, `createdAt`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/mcp/tools.ts apps/web/src/lib/mcp/server.ts
git commit -m "feat(mcp): add timeline_thoughts tool for temporal navigation"
```

---

## Chunk 4: Citation IDs

### Task 11: Surface IDs and cite-guidance in remaining tools

The `search_thoughts`, `get_thoughts`, and `timeline_thoughts` tools already include `id` and cite guidance from earlier tasks. This task updates the remaining thought-returning tools (`browse_recent`, `get_insights`) for consistency.

**Files:**
- Modify: `apps/web/src/lib/mcp/server.ts`

- [ ] **Step 1: Update `browse_recent` description and response**

Find the `server.tool(MCP_TOOL_NAMES.browseRecent, ...)` block.

Change the description string from:
```
"Browse most recent thoughts, optionally filtered by type or topic"
```
to:
```
"Browse most recent thoughts, optionally filtered by type or topic. Cite sources as `thought:<id>` when referencing them in your response."
```

In the response mapping, change:
```typescript
filtered.map((t) => ({
  content: t.content,
  metadata: t.metadata,
  createdAt: new Date(t._creationTime).toISOString(),
})),
```
to:
```typescript
filtered.map((t) => ({
  id: t._id,
  content: t.content,
  metadata: t.metadata,
  createdAt: new Date(t._creationTime).toISOString(),
})),
```

- [ ] **Step 2: Update `get_insights` description**

Find the `server.tool(MCP_TOOL_NAMES.getInsights, ...)` block. The response already returns `id: i._id`, so only the description needs updating.

Change:
```
"Get workflow insights, optionally filtered by status or category"
```
to:
```
"Get workflow insights, optionally filtered by status or category. Cite insights as `insight:<id>` when referencing them in your response."
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @repo/web check-types`
Expected: exits clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/mcp/server.ts
git commit -m "feat(mcp): include IDs and cite-guidance in browse/insights tools"
```

---

## Chunk 5: Cleanup & Documentation

### Task 12: Remove dead `searchByVector` (now unused)

After Task 7, the public `search` action goes through `hybridSearch`. The older `searchByVector` internal action in `actions.ts` is no longer referenced. Verify and remove.

**Files:**
- Modify: `packages/convex/convex/models/thoughts/actions.ts`

- [ ] **Step 1: Confirm it's unused**

Run this Grep to confirm no remaining callers:

```bash
grep -rn "searchByVector" packages/ apps/ --include='*.ts' --exclude-dir=node_modules --exclude-dir=_generated
```

Expected: the only hit is the definition itself in `actions.ts`. If anything else references it, do not remove — resolve the reference first.

- [ ] **Step 2: Delete the `searchByVector` export block**

Remove the `export const searchByVector = internalAction({ ... })` block from `actions.ts` (the block starting around line 268 in the pre-change file).

- [ ] **Step 3: Deploy and type-check**

Run in parallel:
- `pnpm --filter @repo/db deploy:dev`
- `pnpm --filter @repo/web check-types`

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add packages/convex/convex/models/thoughts/actions.ts
git commit -m "chore(convex): remove unused searchByVector after hybrid migration"
```

---

### Task 13: Update CLAUDE.md usage guidance (optional but recommended)

The new 3-layer retrieval pattern (search → timeline → get) works best when Claude knows to use it. The user's global `~/.claude/CLAUDE.md` references AI Brain usage. A short note in the project's own root — if one exists — is safer than modifying user-level config.

**Files:**
- Check: `/Users/peterbrown/Development/ai-brain/CLAUDE.md` (create or modify)

- [ ] **Step 1: Check whether `CLAUDE.md` exists at project root**

```bash
ls /Users/peterbrown/Development/ai-brain/CLAUDE.md 2>&1
```

- [ ] **Step 2a: If the file does not exist, skip this task.**

The user's global CLAUDE.md already covers AI Brain usage. Leave it to them to decide whether to update it.

- [ ] **Step 2b: If it exists, append a short retrieval-pattern note**

Append this section at the end of `CLAUDE.md`:

```markdown
## Memory retrieval pattern

When using AI Brain MCP tools, prefer:

1. `search_thoughts(query, type?)` → compact index rows (id, summary, snippet, score)
2. `timeline_thoughts(seedId)` → neighbors around an interesting hit
3. `get_thoughts(ids)` → full content for IDs that warrant it

Cite sources as `thought:<id>` or `insight:<id>` when grounding recommendations in stored memory.
```

- [ ] **Step 3: Commit (only if 2b was applicable)**

```bash
git add CLAUDE.md
git commit -m "docs: document memory retrieval pattern"
```

---

## Post-implementation verification

After all tasks land:

- [ ] Run `pnpm --filter @repo/web check-types` — passes.
- [ ] Run `pnpm --filter @repo/web lint` — passes.
- [ ] In an interactive MCP session:
  - `search_thoughts("COPA Commander remodel")` returns compact index, score ordering reflects both lexical and semantic matches.
  - `get_thoughts(ids=[...])` returns full content for chosen IDs.
  - `timeline_thoughts(seedId=<recent>)` returns chronological neighbors.
  - Response IDs are strings usable as `thought:<id>` citations.

---

## Scope / non-goals

- No UI changes in this plan. The web app's browse/search views still work as-is; they call Convex queries directly, not MCP.
- No test harness introduced. Adding `convex-test` + Vitest is a worthwhile follow-up but out of scope.
- No changes to `capture_thought`, Lists tools, or Reports tools.
- No change to embedding model, dimensions, or vector index.
