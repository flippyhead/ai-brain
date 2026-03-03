# Open Brain — Design Document

## Owner: Peter (peter@wagglelabs.com)
## Date: March 3, 2026

---

## 1. Overview

Open Brain is a personal knowledge system that stores thoughts, decisions, notes, and context in a single database you own. Everything is searchable by semantic meaning via vector embeddings, and exposed to any AI tool via MCP (Model Context Protocol). Based on Nate B. Jones' Open Brain concept, rebuilt with a custom tech stack.

### Problem

Every AI chat starts from zero. Built-in memories are siloed per platform. The "specification problem" in AI prompting is actually a memory problem — the people getting 10x results are giving their AI accumulated context.

### Solution

A personal semantic memory layer that follows you across AI tools. Read and write access via MCP, browseable via a web dashboard.

---

## 2. Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Database + vector search | Convex | Stores thoughts, embeddings, metadata, API keys |
| Auth | Convex Auth | Multi-user login/sessions |
| Embedding | OpenAI text-embedding-3-small | 1536-dim vectors for semantic search |
| Metadata extraction | Claude Haiku | Classifies thoughts into types, extracts topics/people/actions |
| MCP server | Next.js API route + MCP TypeScript SDK | 4 tools for AI clients (stateless JSON mode) |
| Web UI | Next.js + Subframe | Browse, search, capture, manage API keys |
| Hosting | Vercel (Next.js) + Convex (backend) |
| Monorepo | Turborepo + pnpm workspaces | Standard project conventions |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────┐
│                   AI Clients                     │
│  Claude Desktop / ChatGPT / Cursor / Claude Code │
│                                                   │
│  Connected via MCP (read + write)                │
└──────────────────────┬──────────────────────────┘
                       │ POST /api/mcp (Streamable HTTP, stateless JSON)
                       │ Auth: Bearer <api_key>
                       ▼
┌─────────────────────────────────────────────────┐
│              Next.js App (Vercel)                │
│                                                   │
│  /api/mcp/route.ts  ← MCP endpoint              │
│    → MCP SDK (StreamableHTTPServerTransport)     │
│    → enableJsonResponse: true, stateless         │
│    → Auth via hashed API key lookup              │
│                                                   │
│  /app/(authenticated)/ ← Web UI                  │
│    → Dashboard, search, browse, settings         │
│    → Auth via Convex Auth sessions               │
│                                                   │
│  Both use Convex JS client ────────────────────┐ │
└─────────────────────────────────────────────────│─┘
                                                   │
                       ┌───────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│                    Convex                        │
│                                                   │
│  Tables: thoughts, apiKeys, users (auth)        │
│  Vector Index: on embedding field (1536 dims)   │
│  Actions: generateEmbedding (OpenAI),           │
│           extractMetadata (Claude Haiku)         │
│  Mutations: storeThought, createApiKey          │
│  Queries: browseRecent, getStats, listApiKeys   │
│                                                   │
│  Auth: Convex Auth (multi-user)                 │
└─────────────────────────────────────────────────┘
```

### Data Flows

**Capture (via MCP):**
1. AI client calls `capture_thought` MCP tool
2. Next.js API route authenticates via API key → resolves userId
3. Convex action runs `generateEmbedding` (OpenAI) and `extractMetadata` (Claude Haiku) in parallel
4. Stores as a single row in `thoughts` table with userId
5. Confirmation returned to AI client with extracted metadata summary

**Capture (via Web UI):**
1. User types thought in quick capture form
2. Convex mutation triggers same action pipeline (embedding + metadata in parallel)
3. Stored with userId from Convex Auth session

**Search (via MCP):**
1. AI client calls `search_thoughts` MCP tool
2. Convex action generates query embedding via OpenAI
3. Vector search against `thoughts` table, filtered by userId at the index level
4. Post-filter by similarity threshold (default 0.5), truncate to limit
5. Results returned ranked by similarity score

**Search (via Web UI):**
1. User types query in search page
2. Same Convex action pipeline as MCP search
3. Results displayed with content, metadata tags, similarity score, date

---

## 4. Convex Schema

### `thoughts` table

```typescript
// models/thoughts/validators.ts
export const thoughtFields = {
  content: v.string(),
  embedding: v.array(v.float64()),
  metadata: v.object({
    type: v.union(
      v.literal("decision"),
      v.literal("person_note"),
      v.literal("idea"),
      v.literal("meeting_note"),
      v.literal("task"),
      v.literal("reference"),
    ),
    topics: v.array(v.string()),
    people: v.array(v.string()),
    actionItems: v.array(v.string()),
    summary: v.string(),
  }),
  userId: v.id("users"),
};
```

```typescript
// schema.ts
thoughts: defineTable(thoughtFields)
  .index("by_userId", ["userId"])
  .index("by_userId_and_type", ["userId", "metadata.type"])
  .vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 1536,
    filterFields: ["userId"],
  }),
```

### `apiKeys` table

```typescript
// models/apiKeys/validators.ts
export const apiKeyFields = {
  userId: v.id("users"),
  keyHash: v.string(),       // SHA-256 hash (never store raw key)
  keyPrefix: v.string(),     // First 8 chars for display ("ob_a1b2c3d4...")
  name: v.string(),          // User-provided label ("Claude Desktop")
  lastUsedAt: v.optional(v.number()),
};
```

```typescript
// schema.ts
apiKeys: defineTable(apiKeyFields)
  .index("by_keyHash", ["keyHash"])
  .index("by_userId", ["userId"]),
```

### Vector Search Notes

- Convex vector search does not support a similarity threshold parameter — we over-fetch and post-filter by `_score >= threshold` in the action
- Max 256 results per vector search query
- `filterFields: ["userId"]` ensures pre-search filtering — no cross-user data leakage

---

## 5. Model Functions

### thoughts/model.ts
- `_findById(ctx, id)` — single thought or null
- `_listByUser(ctx, userId)` — all thoughts for user (paginated)
- `_insertOne(ctx, fields)` — create thought row

### thoughts/actions.ts
- `generateEmbedding(text)` — calls OpenAI text-embedding-3-small, returns float64[]
- `extractMetadata(text)` — calls Claude Haiku, returns metadata object
- `captureThought(ctx, {userId, content})` — runs embedding + metadata in parallel, inserts row
- `searchByVector(ctx, {userId, query, threshold?, limit?})` — generates query embedding, vector search, post-filter

### apiKeys/model.ts
- `_findByHash(ctx, hash)` — look up key by SHA-256 hash
- `_listByUser(ctx, userId)` — all keys for user
- `_insertOne(ctx, fields)` — create key row

---

## 6. MCP Server

### Hosting

Next.js API route at `apps/web/src/app/api/mcp/route.ts`. Uses the MCP TypeScript SDK (`@modelcontextprotocol/sdk`) with `StreamableHTTPServerTransport` in stateless mode.

```typescript
// Stateless per-request pattern
export async function POST(req: Request) {
  // 1. Extract API key from Authorization header
  // 2. Hash key, look up in Convex → get userId
  // 3. Create fresh McpServer + transport per request
  // 4. Register tools scoped to userId
  // 5. Handle request, return JSON response
}

export async function GET()    { return new Response(null, { status: 405 }); }
export async function DELETE() { return new Response(null, { status: 405 }); }
```

Configuration:
- `sessionIdGenerator: undefined` (stateless)
- `enableJsonResponse: true` (no SSE)

### Tools

**`search_thoughts`**
- Input: `query` (string), `threshold` (float, default 0.5), `limit` (int, default 10)
- Generates query embedding, vector search filtered by userId, post-filter by threshold
- Returns: `[{ content, metadata, similarityScore, createdAt }]`

**`browse_recent`**
- Input: `limit` (int, default 20), `type` (optional string), `topic` (optional string)
- Queries thoughts by userId, ordered by creation time descending
- Filters by metadata type/topic if provided
- Returns: `[{ content, metadata, createdAt }]`

**`get_stats`**
- Input: none
- Counts total thoughts, breakdowns by type, most mentioned people, most common topics, date range
- All scoped to authenticated userId
- Returns: stats object

**`capture_thought`**
- Input: `content` (string)
- Runs generateEmbedding + extractMetadata in parallel
- Inserts row with userId from API key
- Returns: confirmation with extracted metadata summary

### Authentication

```
MCP Client → Authorization: Bearer ob_xxxxx
                    ↓
          route.ts extracts key
                    ↓
          SHA-256 hash → look up in apiKeys table
                    ↓
          Found? → userId extracted → tools scoped to that user
          Not found? → 401 Unauthorized
```

### Client Connection Patterns

- **Claude Desktop**: Settings → Connectors → Add custom connector → paste URL
- **Claude Code**: `claude mcp add --transport http open-brain https://your-app.vercel.app/api/mcp --header "Authorization: Bearer ob_xxxxx"`
- **ChatGPT**: Settings → Apps & Connectors → paste URL (requires paid plan)

---

## 7. Web UI

Built with Next.js (App Router) + Subframe for UI components.

### Pages

**Dashboard (`/`)** — Landing page after login
- Total thought count, recent activity summary
- Quick capture form (text input + submit)
- List of 10 most recent thoughts

**Search (`/search`)** — Semantic search
- Search input field
- Results ranked by similarity score
- Each result shows: content, metadata tags, similarity score, date

**Browse (`/browse`)** — Paginated list of all thoughts
- Filter by type (dropdown) and topic
- Sorted by newest first
- Click to expand full content + metadata

**Settings (`/settings`)** — Account & API key management
- Generate new API key (shown once, then only prefix visible)
- List existing keys with name, prefix, last used date
- Revoke keys
- MCP connection instructions for Claude Desktop, Claude Code, ChatGPT

### Auth

- Convex Auth handles sign-up/sign-in
- `(authenticated)` route group with layout that checks auth
- Unauthenticated users redirected to sign-in

---

## 8. Error Handling

**Embedding is critical, metadata is best-effort.**

- OpenAI embedding API failure → capture fails, error returned to caller
- Claude Haiku metadata extraction failure → capture succeeds with fallback metadata:
  - `type: "reference"`, empty `topics`/`people`/`actionItems`, content truncated as `summary`
- Invalid/missing API key → 401 Unauthorized (before MCP server is created)
- Malformed JSON-RPC → MCP SDK returns standard JSON-RPC error
- Vector search returns zero results → empty array (not an error)
- Convex handles real-time error states in web UI natively

---

## 9. Testing Strategy

**Convex functions:** Unit test model functions and integration test the capture pipeline (mock external API calls).

**MCP endpoint:** Test API route with HTTP requests — verify auth, tool dispatch, response format. Smoke test with Claude Code during development.

**No tests for:** UI components (visual, Subframe), thin external API wrappers.

---

## 10. Differences from Original Open Brain

| Area | Original | This Build |
|------|----------|------------|
| Database | Supabase (Postgres + pgvector) | Convex |
| MCP hosting | Supabase Edge Function | Next.js API route |
| MCP transport | SSE (deprecated spec) | Streamable HTTP, stateless JSON |
| Metadata LLM | gpt-4o-mini via OpenRouter | Claude Haiku direct |
| Embedding API | OpenAI via OpenRouter | OpenAI direct |
| Auth | Shared secret | Convex Auth + per-user hashed API keys |
| Capture UI | Slack webhook | MCP + web UI only |
| Web UI | None | Next.js dashboard |

No functional gaps — everything the original can do, this build does. Differences are infrastructure choices or security improvements.

---

## 11. Deferred to v1.1

- Stats & patterns visualization (topic clusters, activity over time)
- Bulk import for migrating from other systems
- Editing/updating existing thoughts (MVP is append-only)
- Additional API endpoints for webhooks
- Team/shared knowledge bases

---

*Based on: Nate B. Jones, "Why your AI starts from zero every time you open a new chat + my Open Brain guide" (March 2, 2026). Implementation brief: open-brain-implementation-brief.md.*
