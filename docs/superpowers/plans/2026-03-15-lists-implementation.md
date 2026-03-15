# Lists & Pinned Goals Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add named, ordered todo lists with pinned goals to the AI Brain, accessible via MCP tools.

**Architecture:** Two new Convex tables (`lists`, `listItems`) with a model layer (validators, model, private, mcpQueries, mcpActions) following the existing `thoughts` pattern. Eight new MCP tools wired into the Next.js MCP server.

**Tech Stack:** Convex (database + backend), Next.js (MCP server), Zod (MCP tool arg validation), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-15-lists-design.md`

---

## Chunk 1: Data Model & Backend

### Task 1: Validators

**Files:**
- Create: `packages/convex/convex/models/lists/validators.ts`

- [ ] **Step 1: Create validators file**

```typescript
import { v } from "convex/values";

export const listItemStatus = v.union(
  v.literal("open"),
  v.literal("done"),
);

export const listFields = {
  name: v.string(),
  pinned: v.boolean(),
  userId: v.id("users"),
  archivedAt: v.optional(v.number()),
};

export const listItemFields = {
  title: v.string(),
  status: listItemStatus,
  position: v.number(),
  listId: v.id("lists"),
  userId: v.id("users"),
  completedAt: v.optional(v.number()),
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/convex/convex/models/lists/validators.ts
git commit -m "feat(lists): add validators for lists and listItems"
```

### Task 2: Schema

**Files:**
- Modify: `packages/convex/convex/schema.ts`

- [ ] **Step 1: Add lists and listItems tables to schema**

Add imports at top of file:

```typescript
import { listFields, listItemFields } from "./models/lists/validators";
```

Add tables inside `defineSchema({})` after the `insights` table:

```typescript
  lists: defineTable(listFields)
    .index("by_userId", ["userId"])
    .index("by_userId_and_pinned", ["userId", "pinned"]),
  listItems: defineTable(listItemFields)
    .index("by_listId", ["listId"])
    .index("by_userId_and_status", ["userId", "status"]),
```

- [ ] **Step 2: Verify Convex accepts the schema**

Run: `cd packages/convex && npx convex dev --once`
Expected: Schema pushed successfully, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/schema.ts
git commit -m "feat(lists): add lists and listItems tables to schema"
```

### Task 3: Model Layer

**Files:**
- Create: `packages/convex/convex/models/lists/model.ts`

- [ ] **Step 1: Create model file with CRUD operations**

```typescript
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

  // Spec: archived lists are always excluded from pinned queries
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
  limit: number = 50,
) {
  return await ctx.db
    .query("listItems")
    .withIndex("by_userId_and_status", (q) =>
      q.eq("userId", userId).eq("status", "open"),
    )
    .take(limit);
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/convex/convex/models/lists/model.ts
git commit -m "feat(lists): add model layer with CRUD operations"
```

### Task 4: Private (Internal) Mutations & Queries

**Files:**
- Create: `packages/convex/convex/models/lists/private.ts`

- [ ] **Step 1: Create private.ts with internal mutations and queries**

```typescript
import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { listItemStatus } from "./validators";
import {
  _findListById,
  _listsByUser,
  _insertList,
  _updateList,
  _findItemById,
  _itemsByList,
  _openItemsByUser,
  _insertItem,
  _updateItem,
  _countItemsByList,
} from "./model";

// --- List Queries ---

export const getListById = internalQuery({
  args: { id: v.id("lists") },
  handler: async (ctx, args) => {
    return await _findListById(ctx, args.id);
  },
});

export const getListsByUser = internalQuery({
  args: {
    userId: v.id("users"),
    pinned: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await _listsByUser(ctx, args.userId, {
      pinned: args.pinned,
      includeArchived: args.includeArchived,
    });
  },
});

// --- List Mutations ---

export const insertList = internalMutation({
  args: {
    name: v.string(),
    pinned: v.boolean(),
    userId: v.id("users"),
  },
  returns: v.id("lists"),
  handler: async (ctx, args) => {
    return await _insertList(ctx, args);
  },
});

export const updateList = internalMutation({
  args: {
    id: v.id("lists"),
    name: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
    archivedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const update: Record<string, unknown> = {};
    if (fields.name !== undefined) update.name = fields.name;
    if (fields.pinned !== undefined) update.pinned = fields.pinned;
    if (fields.archivedAt !== undefined) update.archivedAt = fields.archivedAt;
    await _updateList(ctx, id, update);
  },
});

// --- Item Queries ---

export const getItemById = internalQuery({
  args: { id: v.id("listItems") },
  handler: async (ctx, args) => {
    return await _findItemById(ctx, args.id);
  },
});

export const getItemsByList = internalQuery({
  args: {
    listId: v.id("lists"),
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    return await _itemsByList(ctx, args.listId, {
      includeCompleted: args.includeCompleted,
    });
  },
});

export const getOpenItemsByUser = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await _openItemsByUser(ctx, args.userId, args.limit ?? 50);
  },
});

export const getItemCountsByList = internalQuery({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    return await _countItemsByList(ctx, args.listId);
  },
});

// --- Item Mutations ---

export const insertItem = internalMutation({
  args: {
    title: v.string(),
    status: listItemStatus,
    position: v.number(),
    listId: v.id("lists"),
    userId: v.id("users"),
  },
  returns: v.id("listItems"),
  handler: async (ctx, args) => {
    return await _insertItem(ctx, args);
  },
});

export const updateItem = internalMutation({
  args: {
    id: v.id("listItems"),
    title: v.optional(v.string()),
    status: v.optional(listItemStatus),
    position: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const update: Record<string, unknown> = {};
    if (fields.title !== undefined) update.title = fields.title;
    if (fields.status !== undefined) update.status = fields.status;
    if (fields.position !== undefined) update.position = fields.position;
    if (fields.completedAt !== undefined) update.completedAt = fields.completedAt;
    await _updateItem(ctx, id, update);
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/convex/convex/models/lists/private.ts
git commit -m "feat(lists): add internal mutations and queries"
```

### Task 5: Public Queries (Web UI / Authenticated)

**Files:**
- Create: `packages/convex/convex/models/lists/public.ts`

- [ ] **Step 1: Create public.ts with auth-gated queries for future web UI use**

Following the pattern in `thoughts/public.ts`, these use `getAuthUserId` for session-based auth (web UI) rather than accepting `userId` as a parameter (MCP pattern).

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/convex/convex/models/lists/public.ts
git commit -m "feat(lists): add auth-gated public queries for web UI"
```

### Task 6: MCP Queries

**Files:**
- Create: `packages/convex/convex/models/lists/mcpQueries.ts`

- [ ] **Step 1: Create MCP-facing queries**

```typescript
import { query } from "../../_generated/server";
import { v } from "convex/values";
import {
  _listsByUser,
  _itemsByList,
  _openItemsByUser,
  _countItemsByList,
  _findListById,
} from "./model";

export const getLists = query({
  args: {
    userId: v.id("users"),
    pinned: v.optional(v.boolean()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const lists = await _listsByUser(ctx, args.userId, {
      pinned: args.pinned,
      includeArchived: args.includeArchived,
    });

    const listsWithCounts = await Promise.all(
      lists.map(async (list) => {
        const counts = await _countItemsByList(ctx, list._id);
        return {
          listId: list._id,
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

export const getList = query({
  args: {
    userId: v.id("users"),
    listId: v.id("lists"),
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== args.userId) {
      throw new Error("List not found");
    }

    const items = await _itemsByList(ctx, args.listId, {
      includeCompleted: args.includeCompleted,
    });

    return {
      listId: list._id,
      name: list.name,
      pinned: list.pinned,
      items: items.map((item) => ({
        itemId: item._id,
        title: item.title,
        status: item.status,
        position: item.position,
        completedAt: item.completedAt,
      })),
    };
  },
});

export const getOpenItems = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const items = await _openItemsByUser(ctx, args.userId, args.limit ?? 50);

    // Fetch list names and filter out items from archived lists
    const listCache = new Map<string, { name: string; archived: boolean }>();
    const results = [];

    for (const item of items) {
      let listInfo = listCache.get(item.listId);
      if (!listInfo) {
        const list = await _findListById(ctx, item.listId);
        listInfo = {
          name: list?.name ?? "Unknown",
          archived: list?.archivedAt !== undefined,
        };
        listCache.set(item.listId, listInfo);
      }

      if (!listInfo.archived) {
        results.push({
          itemId: item._id,
          title: item.title,
          position: item.position,
          listId: item.listId,
          listName: listInfo.name,
        });
      }
    }

    // Sort by list name, then position
    results.sort((a, b) => {
      const nameCompare = a.listName.localeCompare(b.listName);
      if (nameCompare !== 0) return nameCompare;
      return a.position - b.position;
    });

    return results;
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/convex/convex/models/lists/mcpQueries.ts
git commit -m "feat(lists): add MCP-facing queries"
```

### Task 7: MCP Actions

**Files:**
- Create: `packages/convex/convex/models/lists/mcpActions.ts`

- [ ] **Step 1: Create MCP-facing actions**

These are mutations exposed as public (not internal) since MCP calls them directly via `ConvexHttpClient`. Following the pattern in `thoughts/mcpActions.ts` but using mutations instead of actions since no external API calls are needed.

```typescript
import { mutation } from "../../_generated/server";
import { v } from "convex/values";
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
    userId: v.id("users"),
    name: v.string(),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const listId = await _insertList(ctx, {
      name: args.name,
      pinned: args.pinned,
      userId: args.userId,
    });
    return { listId, name: args.name, pinned: args.pinned };
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
    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== args.userId) {
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
    userId: v.id("users"),
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== args.userId) {
      throw new Error("List not found");
    }
    await _updateList(ctx, args.listId, { archivedAt: Date.now() });
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
    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== args.userId) {
      throw new Error("List not found");
    }

    // Get max position in list
    const items = await _itemsByList(ctx, args.listId, { includeCompleted: true });
    const maxPosition = items.length > 0
      ? Math.max(...items.map((i) => i.position))
      : 0;

    const itemId = await _insertItem(ctx, {
      title: args.title,
      status: "open",
      position: maxPosition + 1,
      listId: args.listId,
      userId: args.userId,
    });

    return {
      itemId,
      title: args.title,
      status: "open" as const,
      position: maxPosition + 1,
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
    const item = await _findItemById(ctx, args.itemId);
    if (!item || item.userId !== args.userId) {
      throw new Error("Item not found");
    }

    const update: Record<string, unknown> = {};
    if (args.title !== undefined) update.title = args.title;
    if (args.position !== undefined) update.position = args.position;

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
      completedAt: args.status === "done" ? update.completedAt : item.completedAt,
    };
  },
});
```

- [ ] **Step 2: Verify Convex compiles all new files**

Run: `cd packages/convex && npx convex dev --once`
Expected: All functions registered, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/models/lists/mcpActions.ts
git commit -m "feat(lists): add MCP-facing mutations"
```

---

## Chunk 2: MCP Server Integration

**Prerequisite:** Chunk 1 must be complete and `npx convex dev --once` must have run successfully so that `api.models.lists.*` types are generated in `packages/convex/convex/_generated/api.ts`.

### Task 8: Tool Name Constants

**Files:**
- Modify: `apps/web/src/lib/mcp/tools.ts`

- [ ] **Step 1: Add list tool names**

Replace the entire file content with:

```typescript
export const MCP_TOOL_NAMES = {
  searchThoughts: "search_thoughts",
  browseRecent: "browse_recent",
  getStats: "get_stats",
  captureThought: "capture_thought",
  createReport: "create_report",
  getInsights: "get_insights",
  // Lists
  createList: "create_list",
  updateList: "update_list",
  getLists: "get_lists",
  getList: "get_list",
  archiveList: "archive_list",
  createListItem: "create_list_item",
  updateListItem: "update_list_item",
  getOpenItems: "get_open_items",
} as const;

export const MCP_TOOL_NAME_LIST = Object.values(MCP_TOOL_NAMES);
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/mcp/tools.ts
git commit -m "feat(lists): add list MCP tool name constants"
```

### Task 9: MCP Server Tool Definitions

**Files:**
- Modify: `apps/web/src/lib/mcp/server.ts`

- [ ] **Step 1: Add all 8 list tools to the MCP server**

Add the following tool definitions before the `return server;` line at the end of `createMcpServer()`:

```typescript
  // --- Lists ---

  server.tool(
    MCP_TOOL_NAMES.createList,
    "Create a new named list for tracking items (todos, goals, etc.)",
    {
      name: z.string().describe("Name for the list (e.g., 'This Week', 'Q2 Goals')"),
      pinned: z
        .boolean()
        .default(false)
        .describe("If true, this list is loaded proactively by AI tools at session start"),
    },
    async ({ name, pinned }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.createList,
        { userId: userId as never, name, pinned },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `List created: "${result.name}"${result.pinned ? " (pinned)" : ""}\nList ID: ${result.listId}`,
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.updateList,
    "Update a list's name or pinned status",
    {
      listId: z.string().describe("The list ID to update"),
      name: z.string().optional().describe("New name for the list"),
      pinned: z.boolean().optional().describe("Set pinned status"),
    },
    async ({ listId, name, pinned }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.updateList,
        { userId: userId as never, listId: listId as never, name, pinned },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `List updated: "${result.name}"${result.pinned ? " (pinned)" : ""}`,
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.getLists,
    "Get all lists with item counts, optionally filtered to pinned only",
    {
      pinned: z
        .boolean()
        .optional()
        .describe("Filter to pinned lists only"),
      includeArchived: z
        .boolean()
        .default(false)
        .describe("Include archived lists"),
    },
    async ({ pinned, includeArchived }) => {
      type ListResult = {
        listId: string;
        name: string;
        pinned: boolean;
        archivedAt?: number;
        counts: { total: number; open: number; done: number };
      };
      const results: ListResult[] = await convex.query(
        api.models.lists.mcpQueries.getLists,
        { userId: userId as never, pinned, includeArchived },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No lists found.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.getList,
    "Get a single list with its ordered items",
    {
      listId: z.string().describe("The list ID to fetch"),
      includeCompleted: z
        .boolean()
        .default(false)
        .describe("Include completed items (excluded by default)"),
    },
    async ({ listId, includeCompleted }) => {
      type ListDetail = {
        listId: string;
        name: string;
        pinned: boolean;
        items: Array<{
          itemId: string;
          title: string;
          status: string;
          position: number;
          completedAt?: number;
        }>;
      };
      const result: ListDetail = await convex.query(
        api.models.lists.mcpQueries.getList,
        { userId: userId as never, listId: listId as never, includeCompleted },
      );

      const itemLines = result.items.length > 0
        ? result.items.map(
            (i) =>
              `${i.status === "done" ? "[x]" : "[ ]"} ${i.title} (id: ${i.itemId})`,
          )
        : ["(no items)"];

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `${result.name}${result.pinned ? " (pinned)" : ""}`,
              `List ID: ${result.listId}`,
              "",
              ...itemLines,
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.archiveList,
    "Archive a list (soft delete — items remain intact for review)",
    {
      listId: z.string().describe("The list ID to archive"),
    },
    async ({ listId }) => {
      await convex.mutation(
        api.models.lists.mcpActions.archiveList,
        { userId: userId as never, listId: listId as never },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: "List archived.",
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.createListItem,
    "Add an item to a list",
    {
      listId: z.string().describe("The list to add the item to"),
      title: z.string().describe("The item text"),
    },
    async ({ listId, title }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.createListItem,
        { userId: userId as never, listId: listId as never, title },
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Added: "${result.title}" (id: ${result.itemId})`,
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.updateListItem,
    "Update a list item — change title, mark done/open, or reorder",
    {
      itemId: z.string().describe("The item ID to update"),
      title: z.string().optional().describe("New title text"),
      status: z
        .enum(["open", "done"])
        .optional()
        .describe("Set status (done = check off, open = reopen)"),
      position: z
        .number()
        .optional()
        .describe("New position for reordering"),
    },
    async ({ itemId, title, status, position }) => {
      const result = await convex.mutation(
        api.models.lists.mcpActions.updateListItem,
        {
          userId: userId as never,
          itemId: itemId as never,
          title,
          status,
          position,
        },
      );

      const statusText = result.status === "done" ? " [done]" : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated: "${result.title}"${statusText}`,
          },
        ],
      };
    },
  );

  server.tool(
    MCP_TOOL_NAMES.getOpenItems,
    "Get all open items across all active (non-archived) lists",
    {
      limit: z
        .number()
        .min(1)
        .max(200)
        .default(50)
        .describe("Max items to return"),
    },
    async ({ limit }) => {
      type OpenItem = {
        itemId: string;
        title: string;
        position: number;
        listId: string;
        listName: string;
      };
      const results: OpenItem[] = await convex.query(
        api.models.lists.mcpQueries.getOpenItems,
        { userId: userId as never, limit },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No open items.",
            },
          ],
        };
      }

      // Group by list name for readable output
      const byList = new Map<string, OpenItem[]>();
      for (const item of results) {
        const group = byList.get(item.listName) ?? [];
        group.push(item);
        byList.set(item.listName, group);
      }

      const lines: string[] = [];
      for (const [listName, items] of byList) {
        lines.push(`## ${listName}`);
        for (const item of items) {
          lines.push(`- [ ] ${item.title} (id: ${item.itemId})`);
        }
        lines.push("");
      }

      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n"),
          },
        ],
      };
    },
  );
```

- [ ] **Step 2: Verify the web app compiles**

Run: `cd apps/web && npx next build`
Expected: Build succeeds with no TypeScript errors.

If this fails due to import issues, ensure `api.models.lists.mcpActions` and `api.models.lists.mcpQueries` are being generated. You may need to run `cd packages/convex && npx convex dev --once` first to regenerate the API types.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/mcp/server.ts
git commit -m "feat(lists): wire 8 list tools into MCP server"
```

### Task 10: End-to-End Verification

- [ ] **Step 1: Start Convex dev server**

Run: `cd packages/convex && npx convex dev`
Expected: Server starts, all functions registered including `lists.*` functions.

- [ ] **Step 2: Test via MCP tools in Claude Code**

Using the Brain MCP connection, run through this sequence:

1. Call `create_list` with name "Test List", pinned: false → should return list ID
2. Call `create_list_item` with the list ID and title "First item" → should return item ID
3. Call `create_list_item` with the list ID and title "Second item" → should return item ID
4. Call `get_list` with the list ID → should show both items ordered
5. Call `update_list_item` marking first item as done → should confirm
6. Call `get_list` with the list ID → should show only "Second item" (completed excluded by default)
7. Call `get_list` with includeCompleted: true → should show both, first marked done
8. Call `update_list` with pinned: true → should confirm
9. Call `get_lists` with pinned: true → should show "Test List" with counts
10. Call `get_open_items` → should show "Second item" under "Test List"
11. Call `archive_list` → should confirm
12. Call `get_lists` → should return empty (archived excluded by default)
13. Call `get_open_items` → should return empty (archived list items excluded)

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(lists): address issues found during e2e verification"
```
