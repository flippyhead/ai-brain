# Lists & Pinned Goals — Design Spec

*Date: 2026-03-15*

## Problem

The AI Brain stores thoughts as unstructured semantic knowledge, but has no way to track ordered, actionable items like todo lists or active goals. The user wants to:

1. Maintain todo lists (one or multiple named lists) of items being actively worked on.
2. Have certain "top-line" lists always loaded by AI tools at session start, replacing the static GOALS.md file approach.
3. Interact with lists primarily through MCP tools (Claude Code), with web UI as a future addition.

## Solution

Add dedicated `lists` and `listItems` tables to Convex, separate from the existing `thoughts` model. Expose eight new MCP tools for full list lifecycle. Lists can be "pinned" so AI tools proactively load them at session start. Auth follows the existing pattern: `userId` is resolved from `createMcpServer(userId)` and passed to all Convex operations.

## Data Model

### `lists` Table

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `v.string()` | Yes | List name (e.g., "COPA Launch", "Q2 Goals") |
| `pinned` | `v.boolean()` | Yes | If true, loaded proactively by AI tools |
| `userId` | `v.id("users")` | Yes | Owner |
| `archivedAt` | `v.optional(v.number())` | No | Timestamp if archived (soft delete) |

**Indexes:**
- `by_userId` — fetch all lists for a user
- `by_userId_and_pinned` — fetch pinned lists efficiently

### `listItems` Table

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `v.string()` | Yes | Item text |
| `status` | `v.union(v.literal("open"), v.literal("done"))` | Yes | Completion state |
| `position` | `v.number()` | Yes | Sort order (fractional indexing) |
| `listId` | `v.id("lists")` | Yes | Parent list |
| `userId` | `v.id("users")` | Yes | Owner (denormalized for cross-list queries) |
| `completedAt` | `v.optional(v.number())` | No | Timestamp when marked done |

**Indexes:**
- `by_listId` — fetch items for a specific list
- `by_userId_and_status` — fetch all open items across lists

### Design Decisions

- **Fractional positioning:** Insert between positions 1.0 and 2.0 → 1.5. Avoids rewriting all positions on reorder. Simple and sufficient for MCP-driven use. At expected list sizes (tens of items, occasional reorder), precision degradation is not a concern.
- **Soft archive on lists:** `archivedAt` timestamp instead of hard delete. Old lists remain reviewable.
- **Denormalized `userId` on items:** Enables "all my open items" query without joining through lists.
- **`completedAt` on items:** Tracks when things got done for future velocity/review features.

## MCP Tools

Eight new tools added to the existing MCP server at `/api/mcp`:

### `create_list`

Creates a new named list.

- **Args:** `name` (string, required), `pinned` (boolean, default false)
- **Returns:** `{ listId, name, pinned }`

### `update_list`

Updates a list's name or pinned status.

- **Args:** `listId` (string, required), `name` (string, optional), `pinned` (boolean, optional)
- **Returns:** Updated list object

### `get_lists`

Fetches all lists for the user with item counts.

- **Args:** `pinned` (boolean, optional — filter to pinned only), `includeArchived` (boolean, default false)
- **Returns:** `Array<{ listId, name, pinned, archivedAt?, counts: { total, open, done } }>`
- **Behavior:** Archived lists are always excluded from `pinned: true` queries, even if `includeArchived` is true.

### `create_list_item`

Adds an item to a list. Appends to end by default.

- **Args:** `listId` (string, required), `title` (string, required)
- **Returns:** `{ itemId, title, status: "open", position }`
- **Behavior:** Sets position to max existing position + 1 (or 1.0 if list is empty).

### `update_list_item`

Updates an existing list item. Supports check-off, rewording, and reordering.

- **Args:** `itemId` (string, required), `title` (string, optional), `status` ("open" | "done", optional), `position` (number, optional)
- **Returns:** Updated item object
- **Behavior:** When `status` changes to "done", sets `completedAt` to current timestamp. When `status` changes to "open", clears `completedAt`.

### `get_list`

Fetches a single list with its ordered items.

- **Args:** `listId` (string, required), `includeCompleted` (boolean, default false)
- **Returns:** `{ listId, name, pinned, items: Array<{ itemId, title, status, position, completedAt? }> }`
- **Behavior:** Items sorted by `position` ascending. Completed items excluded by default to reduce noise.

### `archive_list`

Soft-archives a list. Items remain intact but are excluded from cross-list queries (e.g., `get_open_items`). `get_list` still works on archived lists for review purposes.

- **Args:** `listId` (string, required)
- **Returns:** `{ success: true }`

### `get_open_items`

Fetches all open items across all non-archived lists for the user.

- **Args:** `limit` (number, default 50)
- **Returns:** `Array<{ itemId, title, position, listId, listName }>`
- **Behavior:** Uses `by_userId_and_status` index. Excludes items from archived lists. Sorted by list name, then position.

## Pinned Lists Behavior

Lists with `pinned: true` serve as the user's "always-on" priorities. The intended workflow:

1. User creates lists like "Active Goals" or "This Week" and pins them.
2. Claude Code (or any MCP client) calls `get_lists(pinned: true)` at session start.
3. AI has live, up-to-date context on current priorities without relying on static files.
4. As items are checked off or added through any AI tool, every future session sees the updated state.

This replaces the current `@GOALS.md` approach in CLAUDE.md with live data.

## File Structure

Following existing project conventions:

```
packages/convex/convex/
├── schema.ts                          # Add lists + listItems tables
├── models/
│   └── lists/
│       ├── model.ts                   # CRUD operations
│       ├── validators.ts              # Field definitions & return types
│       ├── private.ts                 # Internal mutations & queries
│       ├── public.ts                  # Public queries/mutations
│       ├── mcpActions.ts              # MCP-facing actions
│       └── mcpQueries.ts             # MCP-facing queries

apps/web/src/lib/mcp/
├── server.ts                          # Add 8 new tool definitions
└── tools.ts                           # Add tool name constants
```

## Out of Scope

- Web UI for lists (MCP-first; add later)
- Apple Reminders two-way sync (future project — EventKit/Shortcuts integration)
- Sub-items / nesting
- Due dates, priority levels, tags
- Semantic search / vector embeddings on list items
- Smart Save interaction (lists and thoughts are independent)
- Bulk operations (one item at a time is fine for conversational MCP use)
- `delete_list_item` (mark done instead; add hard delete later if needed. Note: mistakenly added items can be addressed by a future `delete_list_item` tool if this proves annoying.)
- `move_item_to_list` (add when needed)
