# Smart Save: Mem0-style Deduplication for AI Brain

**Date:** 2026-03-13
**Status:** Superseded by [`2026-08-10-temporal-memory-design.md`](./2026-08-10-temporal-memory-design.md)
**Approach:** Mem0-style "Smart Save" — LLM-driven classification on the write path

## Problem

The AI Brain currently treats all content as append-only. When information changes (project status updates, revised goals, updated preferences), old entries accumulate alongside current ones. This degrades retrieval quality over time and forces the caller to manually reconcile stale vs. current information.

## Solution

Add an LLM classification step to the `capture_thought` write path. Before storing new content, the system searches for semantically similar existing thoughts and asks an LLM whether the new content supersedes, contradicts, or is independent of each match. The system then executes the appropriate operations (add, update, or delete) automatically.

## Design Principles

- **Conservative by default.** Err toward keeping entries rather than aggressively deduplicating. Mild duplication is recoverable; accidentally deleting a valuable memory is not.
- **Transparent to callers.** The MCP `capture_thought` tool input interface is unchanged. Callers send content; the system decides what to do with it. The response message reflects what actually happened.
- **No new infrastructure.** Works within the existing Convex data model, vector search, and LLM integrations.

## Architecture

### Write Path (Modified)

```
capture_thought(content)
    |
    v
1. Vector-search existing thoughts (top 10, similarity threshold configurable, default 0.7)
    |
    +--> No similar thoughts found --> normal ADD (current behavior)
    |
    +--> Similar thoughts found
            |
            v
2. Fetch full documents for matches via getById queries
            |
            v
3. Send to classifier LLM (Claude Haiku):
   - New content
   - Existing similar thoughts (id, content, metadata, creation date)
            |
            v
4. LLM returns structured classification (see Classification Model below)
            |
            v
5. Validate returned IDs against candidate set (reject hallucinated IDs)
            |
            v
6. Execute operations:
   - UPDATE: replace content, re-embed, re-extract metadata, set updatedAt
   - DELETE: remove thought
   - ADD: store new thought (current behavior)
   - NOOP (addNew: false): skip entirely
```

### Read Path (Unchanged)

`search_thoughts`, `browse_recent`, and `get_stats` remain exactly as they are. They benefit automatically because the underlying data is cleaner.

## Classification Model

### Actions

| Action | When | Effect |
|--------|------|--------|
| **ADD** | New content is genuinely new | Store as new thought (current behavior) |
| **UPDATE** | New content supersedes an existing thought | Replace existing thought's content, re-embed, re-extract metadata |
| **DELETE** | Existing thought is fully redundant given new content | Remove existing thought |
| **NOOP** | Existing thought is related but independently valuable, or new content is already captured | Leave existing thought alone; skip new if `addNew: false` |

### Classification Response Schema

```typescript
{
  // Operations on existing thoughts. Only include entries where action is not NOOP.
  operations: Array<{
    action: "UPDATE" | "DELETE",
    thoughtId: string,       // Must be an _id from the candidate set provided
    reason: string,          // Why this action was chosen
    mergedContent?: string,  // For UPDATE only: combined content if partial overlap.
                             // If omitted, the new content replaces the existing content entirely.
  }>,
  // Whether to also store the new content as a separate thought.
  // true = add new thought (default). false = new content is fully captured
  // by the operations above (e.g., merged into an existing thought).
  addNew: boolean,
}
```

**Interaction rules:**
- `operations` can contain multiple UPDATEs/DELETEs — one new thought can supersede several stale entries
- `mergedContent` is per-operation, so each UPDATE can have its own merged text
- `addNew: true` + operations = update/delete stale entries AND add the new one
- `addNew: false` + UPDATE with `mergedContent` = merge into existing, don't duplicate
- `addNew: false` + no operations = content already captured, skip entirely
- All `thoughtId` values are validated against the candidate set; hallucinated IDs are ignored

### Classification Prompt

```
You are a memory manager for a personal knowledge base. You are given new
content being saved, along with existing similar entries (each with an id,
content, metadata, and creation date).

Your job: determine if the new content UPDATES, REPLACES, or is INDEPENDENT
of each existing entry.

Guidelines:
- UPDATE when the new content is clearly a newer version of the same fact
  (e.g., project status changed, goal revised, preference updated).
  Use mergedContent if the new content only partially overlaps and you want
  to combine both into a single coherent entry.
- DELETE when an existing entry is fully redundant given the new content
- Leave alone (omit from operations) when entries are related but both
  independently valuable (e.g., two different decisions about the same project)
- Set addNew to false only when the new content is fully captured by
  an UPDATE with mergedContent
- When in doubt, leave existing entries alone — false updates are worse
  than mild duplication

Return JSON only, matching the schema exactly.
```

## Schema Changes

One new optional field on the `thoughts` table:

```typescript
updatedAt: v.optional(v.number())
```

Set when a thought's content is replaced via UPDATE. No new tables, no new indexes.

**Downstream:** Return type validators in `private.ts` (getById, listByUser), `mcpQueries.ts`, and `public.ts` must be updated to include the optional `updatedAt` field.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Classification LLM call fails | Fall back to plain ADD (current behavior). Same fallback pattern as existing metadata extraction. |
| Classification LLM returns unparseable JSON | Fall back to plain ADD. Log the malformed response. Same JSON-parse-and-fallback pattern used in `extractMetadata`. |
| High similarity but LLM says NOOP for all | ADD the new content. LLM decided entries are related but independent. |
| LLM returns thoughtIds not in candidate set | Ignore those operations, execute valid ones. Log a warning. |
| Multiple existing thoughts flagged for UPDATE | Execute all updates. One new entry can supersede multiple stale entries. |
| Re-embedding or re-metadata-extraction fails on UPDATE | Keep the old thought unchanged, ADD the new content instead. Log the error. |

## Concurrency

The vector search + classify + mutate sequence is not transactional. Two near-simultaneous writes with overlapping content could both ADD. This is accepted: writes are infrequent, and mild duplication is handled gracefully by the conservative-by-default principle. Future dedup runs (manual or automated) can clean up any edge cases.

## Performance

The write path adds:
- One vector search (fast)
- One Haiku LLM call (~$0.001 per classification)

**Fast path (no similar thoughts found):** adds ~500ms for the vector search. Common case for new topics.

**Update path (similar thoughts found + UPDATE operations):** adds the classification call (~1s) plus re-embedding and re-metadata-extraction for each updated thought (~2s each). Worst case with multiple updates: 6-8s total. Writes are infrequent and not latency-sensitive.

**Mitigation:** Before overwriting content in an UPDATE, log the previous content via `console.log` for recovery during initial rollout. This is a safety net while the classifier is being tuned, not a permanent feature.

## What This Does NOT Include

- **Version history.** Updated thoughts lose their previous content (mitigated by console logging during rollout). Can be added later if needed.
- **Separate "facts" table or entity extraction.** Thoughts remain the only storage unit.
- **Working memory layer.** A separate mutable "current focus" area. Can be layered on later.
- **Changes to retrieval.** Search and browse remain unchanged.

## MCP Interface

**Input:** No changes. `capture_thought` still accepts `content: string`.

**Output:** Enhanced response message reflects what happened:
- "Thought captured successfully" (plain ADD)
- "Thought captured. Updated 1 existing thought, removed 1 redundant thought." (when operations occurred)
- "Thought already captured — no changes made." (NOOP, addNew: false)

This gives the caller (Claude) transparency into what the brain did without changing the tool's input contract.

## Files to Modify

| File | Change |
|------|--------|
| `packages/convex/convex/schema.ts` | Add `updatedAt` optional field to thoughts |
| `packages/convex/convex/models/thoughts/actions.ts` | Modify `captureThought` to add similarity search + classification step before storage |
| `packages/convex/convex/models/thoughts/private.ts` | Add `updateOne` and `deleteOne` internalMutations; update return type validators to include `updatedAt` |
| `packages/convex/convex/models/thoughts/helpers.ts` | No changes (existing `generateEmbedding` and `extractMetadata` are reused) |
| (new) `packages/convex/convex/models/thoughts/classify.ts` | Classification prompt, LLM call, response parsing, ID validation |
| `packages/convex/convex/models/thoughts/mcpQueries.ts` | Update return type validators to include `updatedAt` |
| `packages/convex/convex/models/thoughts/public.ts` | Update return type validators to include `updatedAt` |
| `apps/web/src/lib/mcp/server.ts` | Update `capture_thought` response message formatting |

## Configuration

| Constant | Default | Purpose |
|----------|---------|---------|
| `SIMILARITY_THRESHOLD` | 0.7 | Minimum similarity score to consider a thought as a candidate for classification |
| `MAX_CANDIDATES` | 10 | Maximum number of similar thoughts sent to the classifier |

Defined as constants in `classify.ts` for easy tuning without code changes.
