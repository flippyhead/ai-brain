# Lists UI & Unified Browse Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lists UI to the Browse page with inline editing, merge Search into Browse, and remove the standalone Search page.

**Architecture:** Expand `lists/public.ts` with auth-gated mutations and queries. Rewrite the Browse page with a Lists/Thoughts toggle. Extract search+browse into a ThoughtsView component. Add ListCard, ListItemRow, and CreateListInput components.

**Tech Stack:** Convex (queries/mutations), Next.js (React, App Router), inline styles (no component library)

**Spec:** `docs/superpowers/specs/2026-03-16-lists-ui-design.md`

---

## Chunk 1: Backend — Public Mutations & Model Changes

### Task 1: Add `_deleteItem` to model layer

**Files:**
- Modify: `packages/convex/convex/models/lists/model.ts`

- [ ] **Step 1: Add `_deleteItem` function**

Add after the `_updateItem` function (around line 116):

```typescript
export async function _deleteItem(ctx: MutationCtx, id: Id<"listItems">) {
  await ctx.db.delete(id);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/convex/convex/models/lists/model.ts
git commit -m "feat(lists): add _deleteItem model function"
```

### Task 2: Expand `lists/public.ts` with auth-gated queries and mutations

**Files:**
- Modify: `packages/convex/convex/models/lists/public.ts`

- [ ] **Step 1: Rewrite `public.ts` with all needed functions**

Replace the entire file contents with:

```typescript
import { query, mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { listItemStatus } from "./validators";
import {
  _listsByUser,
  _countItemsByList,
  _findListById,
  _itemsByList,
  _insertList,
  _updateList,
  _insertItem,
  _findItemById,
  _updateItem,
  _deleteItem,
} from "./model";

// --- Queries ---

export const getLists = query({
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

export const getList = query({
  args: {
    listId: v.id("lists"),
    includeCompleted: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }

    const items = await _itemsByList(ctx, args.listId, {
      includeCompleted: args.includeCompleted,
    });

    return {
      _id: list._id,
      name: list.name,
      pinned: list.pinned,
      items: items.map((item) => ({
        _id: item._id,
        title: item.title,
        status: item.status,
        position: item.position,
        completedAt: item.completedAt,
      })),
    };
  },
});

// --- Mutations ---

export const createList = mutation({
  args: {
    name: v.string(),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const listId = await _insertList(ctx, {
      name: args.name,
      pinned: args.pinned,
      userId,
    });
    return { listId, name: args.name, pinned: args.pinned };
  },
});

export const updateList = mutation({
  args: {
    listId: v.id("lists"),
    name: v.optional(v.string()),
    pinned: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }

    const update: Partial<{ name: string; pinned: boolean }> = {};
    if (args.name !== undefined) update.name = args.name;
    if (args.pinned !== undefined) update.pinned = args.pinned;
    await _updateList(ctx, args.listId, update);
  },
});

export const archiveList = mutation({
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }
    await _updateList(ctx, args.listId, { archivedAt: Date.now() });
  },
});

export const createListItem = mutation({
  args: {
    listId: v.id("lists"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const list = await _findListById(ctx, args.listId);
    if (!list || list.userId !== userId) {
      throw new Error("List not found");
    }

    const items = await _itemsByList(ctx, args.listId, { includeCompleted: true });
    const maxPosition = items.length > 0
      ? Math.max(...items.map((i) => i.position))
      : 0;

    const itemId = await _insertItem(ctx, {
      title: args.title,
      status: "open",
      position: maxPosition + 1,
      listId: args.listId,
      userId,
    });

    return { itemId };
  },
});

export const updateListItem = mutation({
  args: {
    itemId: v.id("listItems"),
    title: v.optional(v.string()),
    status: v.optional(listItemStatus),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const item = await _findItemById(ctx, args.itemId);
    if (!item || item.userId !== userId) {
      throw new Error("Item not found");
    }

    const update: Partial<{
      title: string;
      status: "open" | "done";
      completedAt: number | undefined;
    }> = {};
    if (args.title !== undefined) update.title = args.title;
    if (args.status !== undefined) {
      update.status = args.status;
      if (args.status === "done") {
        update.completedAt = Date.now();
      } else {
        update.completedAt = undefined;
      }
    }

    await _updateItem(ctx, args.itemId, update);
  },
});

export const deleteListItem = mutation({
  args: {
    itemId: v.id("listItems"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const item = await _findItemById(ctx, args.itemId);
    if (!item || item.userId !== userId) {
      throw new Error("Item not found");
    }

    await _deleteItem(ctx, args.itemId);
  },
});
```

- [ ] **Step 2: Verify Convex compiles**

Run: `cd packages/convex && npx convex dev --once`
Expected: All functions registered, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/models/lists/public.ts
git commit -m "feat(lists): add auth-gated public queries and mutations for web UI"
```

### Task 3: Verify web app builds

- [ ] **Step 1: Build the web app**

Run: `npx turbo build --filter=@repo/web`
Expected: Build succeeds. The existing Browse page still uses `api.models.thoughts.public.listRecent` which is unchanged.

- [ ] **Step 2: Commit if any codegen changes**

```bash
git add packages/convex/convex/_generated/api.d.ts
git commit -m "chore: update generated Convex types"
```

---

## Chunk 2: Frontend — UI Components & Browse Page Rewrite

### Task 4: Create ListItemRow component

**Files:**
- Create: `apps/web/src/features/lists/components/ListItemRow.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useMutation } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { Id } from "@repo/db/convex/_generated/dataModel";

interface ListItemRowProps {
  item: {
    _id: Id<"listItems">;
    title: string;
    status: "open" | "done";
  };
}

export function ListItemRow({ item }: ListItemRowProps) {
  const updateItem = useMutation(api.models.lists.public.updateListItem);
  const deleteItem = useMutation(api.models.lists.public.deleteListItem);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [loading, setLoading] = useState(false);

  const isDone = item.status === "done";

  const toggleStatus = async () => {
    setLoading(true);
    try {
      await updateItem({
        itemId: item._id,
        status: isDone ? "open" : "done",
      });
    } catch (err) {
      console.error("Failed to update item:", err);
    } finally {
      setLoading(false);
    }
  };

  const saveTitle = async () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== item.title) {
      try {
        await updateItem({ itemId: item._id, title: trimmed });
      } catch (err) {
        console.error("Failed to update title:", err);
      }
    } else {
      setEditTitle(item.title);
    }
    setEditing(false);
  };

  const handleDelete = async () => {
    try {
      await deleteItem({ itemId: item._id });
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px solid #f8f8f8",
      }}
    >
      <input
        type="checkbox"
        checked={isDone}
        disabled={loading}
        onChange={toggleStatus}
        style={{ width: 16, height: 16, accentColor: "#16a34a", cursor: "pointer" }}
      />
      {editing ? (
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveTitle();
            if (e.key === "Escape") {
              setEditTitle(item.title);
              setEditing(false);
            }
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 14,
            padding: "2px 4px",
            border: "1px solid #0070f3",
            borderRadius: 4,
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      ) : (
        <span
          onClick={() => {
            if (!isDone) {
              setEditTitle(item.title);
              setEditing(true);
            }
          }}
          style={{
            flex: 1,
            fontSize: 14,
            color: isDone ? "#999" : "#333",
            textDecoration: isDone ? "line-through" : "none",
            cursor: isDone ? "default" : "text",
          }}
        >
          {item.title}
        </span>
      )}
      {isDone && (
        <span
          onClick={handleDelete}
          style={{
            fontSize: 11,
            color: "#999",
            cursor: "pointer",
            padding: "2px 4px",
          }}
          title="Remove item"
        >
          ✕
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/lists/components/ListItemRow.tsx
git commit -m "feat(lists-ui): add ListItemRow component with inline editing"
```

### Task 5: Create CreateListInput component

**Files:**
- Create: `apps/web/src/features/lists/components/CreateListInput.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useMutation } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";

interface CreateListInputProps {
  onDone: () => void;
}

export function CreateListInput({ onDone }: CreateListInputProps) {
  const createList = useMutation(api.models.lists.public.createList);
  const [name, setName] = useState("");
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    setLoading(true);
    try {
      await createList({ name: trimmed, pinned });
      setName("");
      setPinned(false);
      onDone();
    } catch (err) {
      console.error("Failed to create list:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
        marginBottom: 12,
        backgroundColor: "#fff",
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
          if (e.key === "Escape") onDone();
        }}
        placeholder="List name..."
        autoFocus
        style={{
          flex: 1,
          padding: 8,
          border: "1px solid #ddd",
          borderRadius: 4,
          fontSize: 14,
          fontFamily: "inherit",
        }}
      />
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#666" }}>
        <input
          type="checkbox"
          checked={pinned}
          onChange={(e) => setPinned(e.target.checked)}
        />
        Pin
      </label>
      <button
        onClick={handleCreate}
        disabled={loading || !name.trim()}
        style={{
          padding: "8px 16px",
          background: "#0070f3",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          cursor: loading || !name.trim() ? "default" : "pointer",
          opacity: loading || !name.trim() ? 0.5 : 1,
        }}
      >
        {loading ? "..." : "Create"}
      </button>
      <button
        onClick={onDone}
        style={{
          padding: "8px 12px",
          background: "none",
          border: "1px solid #ddd",
          borderRadius: 6,
          fontSize: 14,
          cursor: "pointer",
          color: "#666",
        }}
      >
        Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/lists/components/CreateListInput.tsx
git commit -m "feat(lists-ui): add CreateListInput component"
```

### Task 6: Create ListCard component

**Files:**
- Create: `apps/web/src/features/lists/components/ListCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { Id } from "@repo/db/convex/_generated/dataModel";
import { ListItemRow } from "./ListItemRow";

interface ListCardProps {
  list: {
    _id: Id<"lists">;
    name: string;
    pinned: boolean;
    counts: { total: number; open: number; done: number };
  };
  defaultExpanded?: boolean;
}

export function ListCard({ list, defaultExpanded = false }: ListCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showCompleted, setShowCompleted] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState(list.name);
  const [newItemTitle, setNewItemTitle] = useState("");

  const updateList = useMutation(api.models.lists.public.updateList);
  const archiveList = useMutation(api.models.lists.public.archiveList);
  const createItem = useMutation(api.models.lists.public.createListItem);

  const items = useQuery(
    api.models.lists.public.getList,
    expanded ? { listId: list._id, includeCompleted: showCompleted } : "skip",
  );

  const handleRename = async () => {
    const trimmed = renameName.trim();
    if (trimmed && trimmed !== list.name) {
      try {
        await updateList({ listId: list._id, name: trimmed });
      } catch (err) {
        console.error("Failed to rename:", err);
      }
    } else {
      setRenameName(list.name);
    }
    setRenaming(false);
  };

  const handleTogglePin = async () => {
    try {
      await updateList({ listId: list._id, pinned: !list.pinned });
    } catch (err) {
      console.error("Failed to toggle pin:", err);
    }
  };

  const handleArchive = async () => {
    try {
      await archiveList({ listId: list._id });
    } catch (err) {
      console.error("Failed to archive:", err);
    }
  };

  const handleAddItem = async () => {
    const trimmed = newItemTitle.trim();
    if (!trimmed) return;
    try {
      await createItem({ listId: list._id, title: trimmed });
      setNewItemTitle("");
    } catch (err) {
      console.error("Failed to add item:", err);
    }
  };

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        marginBottom: 8,
        backgroundColor: "#fff",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: expanded ? "1px solid #f0f0f0" : "none",
          cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#999", fontSize: 12 }}>
            {expanded ? "▼" : "▶"}
          </span>
          {renaming ? (
            <input
              type="text"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") {
                  setRenameName(list.name);
                  setRenaming(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{
                fontWeight: 600,
                fontSize: 15,
                border: "1px solid #0070f3",
                borderRadius: 4,
                padding: "2px 6px",
                outline: "none",
                fontFamily: "inherit",
              }}
            />
          ) : (
            <span style={{ fontWeight: 600, fontSize: 15 }}>{list.name}</span>
          )}
          {list.pinned && (
            <span
              style={{
                background: "#e8f4e8",
                color: "#16a34a",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              pinned
            </span>
          )}
          <span style={{ color: "#999", fontSize: 12 }}>
            {list.counts.open}/{list.counts.total} open
          </span>
        </div>
        <div
          style={{ display: "flex", gap: 8, fontSize: 12 }}
          onClick={(e) => e.stopPropagation()}
        >
          <span
            onClick={() => {
              setRenameName(list.name);
              setRenaming(true);
            }}
            style={{ cursor: "pointer" }}
            title="Rename"
          >
            ✏️
          </span>
          <span
            onClick={handleTogglePin}
            style={{ cursor: "pointer" }}
            title={list.pinned ? "Unpin" : "Pin"}
          >
            📌
          </span>
          <span
            onClick={handleArchive}
            style={{ cursor: "pointer" }}
            title="Archive"
          >
            📦
          </span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: "8px 16px" }}>
          {items === undefined ? (
            <p style={{ color: "#999", fontSize: 14, margin: "8px 0" }}>
              Loading...
            </p>
          ) : items.items.length === 0 ? (
            <p style={{ color: "#999", fontSize: 14, margin: "8px 0" }}>
              No items yet.
            </p>
          ) : (
            items.items.map((item) => (
              <ListItemRow key={item._id} item={item} />
            ))
          )}

          {/* Show completed toggle */}
          {list.counts.done > 0 && (
            <div style={{ marginTop: 4 }}>
              <span
                onClick={() => setShowCompleted(!showCompleted)}
                style={{
                  fontSize: 12,
                  color: "#0070f3",
                  cursor: "pointer",
                }}
              >
                {showCompleted
                  ? "Hide completed"
                  : `Show ${list.counts.done} completed`}
              </span>
            </div>
          )}

          {/* Add item input */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 0",
              marginTop: 4,
            }}
          >
            <span style={{ color: "#ccc", fontSize: 14 }}>+</span>
            <input
              type="text"
              value={newItemTitle}
              onChange={(e) => setNewItemTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddItem();
              }}
              placeholder="Add item..."
              style={{
                border: "none",
                outline: "none",
                fontSize: 14,
                color: "#666",
                flex: 1,
                background: "transparent",
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/lists/components/ListCard.tsx
git commit -m "feat(lists-ui): add ListCard component with expand/collapse and actions"
```

### Task 7: Create ThoughtsView component

**Files:**
- Create: `apps/web/src/features/thoughts/components/ThoughtsView.tsx`

- [ ] **Step 1: Create the component**

This extracts and combines the Browse and Search page functionality:

```tsx
"use client";

import { useQuery, useAction } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { ThoughtCard } from "./ThoughtCard";

const TYPES = [
  "decision",
  "person_note",
  "idea",
  "meeting_note",
  "task",
  "reference",
] as const;

type ThoughtType = (typeof TYPES)[number];

interface SearchResult {
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
}

export function ThoughtsView() {
  const [typeFilter, setTypeFilter] = useState<ThoughtType | "">("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const searchThoughts = useAction(api.models.thoughts.publicActions.search);

  const recentThoughts = useQuery(
    api.models.thoughts.public.listRecent,
    typeFilter ? { limit: 50, type: typeFilter } : { limit: 50 },
  );

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    setSearching(true);
    try {
      const res = await searchThoughts({ query: searchQuery.trim() });
      setSearchResults(res as unknown as SearchResult[]);
    } catch (err) {
      console.error("Search failed:", err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults(null);
  };

  // Show search results if a search was performed, otherwise show recent
  const showingSearch = searchResults !== null;
  const thoughts = showingSearch ? searchResults : recentThoughts;

  return (
    <div>
      {/* Search bar */}
      <form onSubmit={handleSearch} style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your thoughts semantically..."
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 4,
              border: "1px solid #ddd",
              fontFamily: "inherit",
            }}
          />
          <button
            type="submit"
            disabled={searching || !searchQuery.trim()}
            style={{
              padding: "10px 20px",
              cursor: searching || !searchQuery.trim() ? "default" : "pointer",
              borderRadius: 4,
            }}
          >
            {searching ? "Searching..." : "Search"}
          </button>
          {showingSearch && (
            <button
              type="button"
              onClick={clearSearch}
              style={{
                padding: "10px 16px",
                cursor: "pointer",
                borderRadius: 4,
                background: "none",
                border: "1px solid #ddd",
                color: "#666",
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {/* Type filter (only when browsing, not searching) */}
      {!showingSearch && (
        <div style={{ marginBottom: 16 }}>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ThoughtType | "")}
            style={{ padding: 8, borderRadius: 4, border: "1px solid #ddd" }}
          >
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Results */}
      {thoughts === undefined || thoughts === null ? (
        <p style={{ color: "#666" }}>Loading...</p>
      ) : thoughts.length === 0 ? (
        <p style={{ color: "#666" }}>
          {showingSearch ? "No matching thoughts found." : "No thoughts found."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {thoughts.map((t: any) => (
            <ThoughtCard
              key={t._id}
              thought={{
                ...t,
                _creationTime: t._creationTime ?? t.createdAt,
              }}
              score={t.score}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/thoughts/components/ThoughtsView.tsx
git commit -m "feat(lists-ui): add ThoughtsView component combining browse + search"
```

### Task 8: Rewrite Browse page with toggle view

**Files:**
- Modify: `apps/web/src/app/(authenticated)/browse/page.tsx`

- [ ] **Step 1: Replace the browse page**

Replace the entire file with:

```tsx
"use client";

import { useQuery } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { ListCard } from "@/features/lists/components/ListCard";
import { CreateListInput } from "@/features/lists/components/CreateListInput";
import { ThoughtsView } from "@/features/thoughts/components/ThoughtsView";

type View = "lists" | "thoughts";

export default function BrowsePage() {
  const [view, setView] = useState<View>("lists");
  const [showCreateList, setShowCreateList] = useState(false);

  const lists = useQuery(
    api.models.lists.public.getLists,
    view === "lists" ? {} : "skip",
  );

  const pinnedLists = lists?.filter((l) => l.pinned) ?? [];
  const otherLists = lists?.filter((l) => !l.pinned) ?? [];

  return (
    <div>
      {/* Header with toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0 }}>Browse</h1>
        <div
          style={{
            display: "flex",
            background: "#f0f0f0",
            borderRadius: 6,
            overflow: "hidden",
            fontSize: 14,
          }}
        >
          <div
            onClick={() => setView("lists")}
            style={{
              padding: "6px 16px",
              background: view === "lists" ? "#333" : "transparent",
              color: view === "lists" ? "#fff" : "#666",
              cursor: "pointer",
            }}
          >
            Lists
          </div>
          <div
            onClick={() => setView("thoughts")}
            style={{
              padding: "6px 16px",
              background: view === "thoughts" ? "#333" : "transparent",
              color: view === "thoughts" ? "#fff" : "#666",
              cursor: "pointer",
            }}
          >
            Thoughts
          </div>
        </div>
      </div>

      {view === "lists" ? (
        <div>
          {/* New List button */}
          {!showCreateList && (
            <button
              onClick={() => setShowCreateList(true)}
              style={{
                padding: "8px 16px",
                background: "#0070f3",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                fontSize: 14,
                cursor: "pointer",
                marginBottom: 24,
              }}
            >
              + New List
            </button>
          )}

          {showCreateList && (
            <CreateListInput onDone={() => setShowCreateList(false)} />
          )}

          {lists === undefined ? (
            <p style={{ color: "#666" }}>Loading...</p>
          ) : lists.length === 0 && !showCreateList ? (
            <p style={{ color: "#666" }}>
              No lists yet. Create one to start tracking goals and todos.
            </p>
          ) : (
            <>
              {/* Pinned section */}
              {pinnedLists.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: "#999",
                      marginBottom: 8,
                    }}
                  >
                    Pinned
                  </div>
                  {pinnedLists.map((list) => (
                    <ListCard
                      key={list._id}
                      list={list}
                      defaultExpanded={true}
                    />
                  ))}
                  <div style={{ marginBottom: 16 }} />
                </>
              )}

              {/* Other lists section */}
              {otherLists.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: "#999",
                      marginBottom: 8,
                    }}
                  >
                    Other Lists
                  </div>
                  {otherLists.map((list) => (
                    <ListCard key={list._id} list={list} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <ThoughtsView />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(authenticated)/browse/page.tsx
git commit -m "feat(lists-ui): rewrite browse page with lists/thoughts toggle"
```

### Task 9: Update nav and remove Search page

**Files:**
- Modify: `apps/web/src/app/(authenticated)/layout.tsx`
- Delete: `apps/web/src/app/(authenticated)/search/page.tsx`

- [ ] **Step 1: Update nav in layout.tsx**

Replace the nav links section (lines 22-27) with:

```tsx
      <Link href="/">Dashboard</Link>
      <Link href="/browse">Browse</Link>
      <Link href="/insights">Insights</Link>
      <Link href="/settings">Settings</Link>
      <Link href="/getting-started">Getting Started</Link>
```

This removes the Search link and moves Browse before Insights.

- [ ] **Step 2: Delete the search page**

```bash
rm apps/web/src/app/\(authenticated\)/search/page.tsx
```

- [ ] **Step 3: Verify the web app builds**

Run: `npx turbo build --filter=@repo/web`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(authenticated)/layout.tsx
git rm apps/web/src/app/(authenticated)/search/page.tsx
git commit -m "feat(lists-ui): update nav order, remove standalone search page"
```

### Task 10: End-to-End Verification

- [ ] **Step 1: Start the dev server**

Run: `npx turbo dev`

- [ ] **Step 2: Manual verification in browser**

Navigate to the app and verify:

1. Nav shows: Dashboard, Browse, Insights, Settings, Getting Started (no Search)
2. Browse defaults to Lists view with your pinned lists expanded
3. Click a checkbox → item toggles done/open
4. Click item title → inline edit, save on Enter or blur
5. Type in "Add item..." → press Enter → item appears
6. Click ✏️ → rename input appears, save on Enter
7. Click 📌 → list moves between pinned/unpinned sections
8. Click 📦 → list disappears (archived)
9. Click "+ New List" → inline form, create with name + optional pin
10. Toggle to "Thoughts" → shows search bar + type filter + recent thoughts
11. Search for something → results with scores appear
12. Click "Clear" → returns to browse mode
13. `/search` URL → 404 (page removed)

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(lists-ui): address issues found during e2e verification"
```
