# Recall Quality Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give facts semantic recall, serve exactly-named entities first, spend
the context window deliberately, and report what the brain does not know.

**Architecture:** Four workstreams against the existing retrieval path. W1 adds
an embedding and vector index to `facts` and moves fact search into an action.
W2 adds a read-only entity resolver and a new blend tier. W3 replaces per-item
truncation with envelope-wide budget allocation. W4 computes a `gaps` block from
data already in hand.

**Tech Stack:** Convex (schema/validators/model/actions), TypeScript, Zod
(MCP tool schemas), Vitest + convex-test

**Design doc:** `docs/plans/2026-09-01-recall-quality-design.md`

**W0 (blend policy) is implemented** in PR #40: one core slot at the
default limit, facts only, and no guaranteed fact share of the relevance
slots. It precedes everything below and is not repeated here.

**Decision gate:** W5 (MEMORY_VERBS conformance) is deliberately absent from
this plan. Answer the positioning question in the design doc before W4 lands —
it changes W4's envelope shape and nothing else.

---

## Workstream 1 — Semantic recall for facts

### Task 1: Add an embedding field and vector index to `facts`

**Files:**

- Modify: `packages/convex/convex/models/facts/validators.ts:66-80`
- Modify: `packages/convex/convex/schema.ts:33-43`

**Step 1: Add the field**

In `factFields`, alongside `searchText`, add:

```typescript
  embedding: v.optional(v.array(v.float64())),
```

Optional, not required — existing facts have none until Task 3 backfills them,
and a fact written while the embedding provider is down must still store.

**Step 2: Add the vector index**

The `facts` table definition currently chains `.index(...)` calls and one
`.searchIndex("by_searchText", ...)`. Add a vector index mirroring the thoughts
one (`schema.ts:17-22`):

```typescript
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    })
```

1536 and `userId` filtering are not free choices — they must match
`text-embedding-3-small` and the account-isolation pattern thoughts already use.

**Step 3: Verify**

Run: `pnpm --filter @repo/db exec convex dev --once --typecheck disable 2>&1 | tail -5`
Expected: schema pushes with no validator errors.

**Step 4: Commit**

---

### Task 2: Embed `searchText` on fact write

**Files:**

- Modify: `packages/convex/convex/models/facts/mcpActions.ts`
- Modify: `packages/convex/convex/models/facts/model.ts`

**Step 1: Locate the write path**

`remember_fact` reaches Convex through `models/facts/mcpActions.ts`. Read it
before editing — the fact write currently completes without any model call, and
that is the property this task changes.

**Step 2: Generate the embedding in the action**

Reuse the existing helper rather than adding a second embedding path:

```typescript
const embedding = await ctx.runAction(
  internal.models.thoughts.helpers.generateEmbedding,
  { text: searchText },
);
```

Generate it in the action, before the mutation, and pass it through. The
mutation stays a mutation.

**Step 3: Handle provider failure without losing the write**

If `generateEmbedding` throws (`OPENAI_API_KEY` unset, provider down), the fact
must still be stored without an embedding — keyword search still finds it, and
Task 3's backfill will fill it in later. Wrap the call, do not let it propagate.

**Step 4: Verify**

Run: `pnpm test:once` — existing fact tests must still pass. Add a test
asserting a fact stores with `embedding` undefined when the helper throws.

**Step 5: Commit**

---

### Task 3: Backfill embeddings for existing facts

**Files:**

- Create: `packages/convex/convex/models/facts/migrations.ts`

**Step 1: Write the migration**

Follow the pattern in `models/thoughts/migrations.ts`. An internal action that
pages through facts where `embedding === undefined`, embeds `searchText`, and
patches. Batch it and make it resumable — at current volume (tens of facts) this
runs in one pass, but the shape should survive growth.

**Step 2: Run and verify**

Run it against dev, then confirm every fact has an embedding of length 1536.

**Step 3: Commit**

---

### Task 4: Fuse vector and keyword hits in fact search

**Files:**

- Modify: `packages/convex/convex/models/facts/model.ts:554-576`
- Modify: `packages/convex/convex/models/facts/mcpActions.ts`
- Modify: `apps/web/src/lib/mcp/server.ts:614-620`

**Step 1: Move fact search into an action**

This is the structural change flagged in the design doc. `ctx.vectorSearch` is
action-only, and `searchFacts` is a `QueryCtx` function. Add
`mcpActions.search` for facts, modelled directly on
`models/thoughts/actions.ts:380-470`:

- embed the query once
- run `ctx.vectorSearch("facts", "by_embedding", { vector, limit, filter: userId })`
  and the existing keyword query in parallel
- post-filter vector hits through `isFactRetrievable` — vector indexes cannot
  filter the optional lifecycle fields, exactly as the thoughts path notes at
  `actions.ts:409-411`
- fuse with **K = 60 and one-based ranks**, matching
  `actions.ts:440-447` exactly. If the two stores fuse differently, their scores
  are not comparable and the blend in `recallBlend.ts` is silently weighting
  noise.

**Step 2: Keep a keyword-only fallback**

Leave `mcpQueries.search` in place for callers that cannot afford an embedding
round-trip, and for the case where `OPENAI_API_KEY` is unset. The action falls
back to it rather than failing the whole recall.

**Step 3: Point the recall handler at the action**

In `server.ts`, the `recall_context` handler currently calls
`convex.query(api.models.facts.mcpQueries.search, ...)` inside its
`Promise.all` (`server.ts:614-620`). Switch to the new action. Keep it inside
the same `Promise.all` — fact and thought search must stay parallel.

**Step 4: Verify**

Run: `pnpm test:once` and `pnpm check-types`.

Then verify the actual defect is fixed. With a fact whose predicate is
`therapist`, `search_facts` for _"who do I see for mental health"_ must return
it. Before this task it returns nothing.

**Step 5: Commit**

---

## Workstream 2 — Exact-entity lookup tier

### Task 5: Add a read-only entity resolver

**Files:**

- Modify: `packages/convex/convex/models/facts/model.ts`

**Step 1: Write `findEntity`**

```typescript
export async function findEntity(
  ctx: QueryCtx,
  userId: Id<"users">,
  name: string,
): Promise<Doc<"entities"> | null>;
```

**Do not reuse `resolveEntity` (`model.ts:145`).** It takes a `MutationCtx`, it
inserts on a miss, and it patches aliases on a hit. Calling it from a read path
would create an entity for every unrecognized proper noun in a user's message.
The new function writes nothing.

**Step 2: Match on the indexed name first**

Normalize with the existing `normalizeEntityName`, then look up via
`by_userId_kind_normalizedName`. Kind is part of the index, so either iterate
the five kinds or add a `by_userId_and_normalizedName` index — prefer the
index; five queries per candidate token is wasteful.

**Step 3: Match aliases with a bounded scan**

`normalizedAliases` is an array field and Convex cannot index it. Scan the
account's entities and match in memory. Add a comment stating the threshold
explicitly:

```typescript
// Alias matching scans the account's entities because normalizedAliases is an
// array field. Free at tens of entities. Above ~5,000, replace this with an
// entityAliases join table (one indexed row per alias).
```

**Step 4: Verify**

Add tests: exact name hit, alias hit, miss returns null, and — the important
one — **a miss creates no entity row**.

**Step 5: Commit**

---

### Task 6: Extract entity candidates from the query

**Files:**

- Create: `packages/convex/convex/models/facts/entityMatch.ts`
- Create: `packages/convex/convex/models/facts/entityMatch.test.ts`

**Step 1: Write a pure candidate extractor**

Given the raw query string, produce normalized n-gram candidates to test against
entity names. Keep it pure and separately testable — no `ctx`, same discipline
as `recallBlend.ts` and `memoryEval.ts`.

Cap n-gram length (entity names are short) and cap the candidate count so a
12,000-character query cannot produce thousands of lookups.

**Step 2: Test it**

Multi-word names, casing, punctuation, and a long query staying under the
candidate cap.

**Step 3: Commit**

---

### Task 7: Serve exact hits as a blend tier

**Files:**

- Modify: `packages/convex/convex/models/recallBlend.ts`
- Modify: `packages/convex/convex/models/recallBlend.test.ts`
- Modify: `apps/web/src/lib/mcp/server.ts`

**Step 1: Add the tier to the blend**

`blendRecallContext` currently takes core facts, core thoughts, relevant facts
and relevant thoughts. Add exact hits as a tier ahead of core, capped so they
cannot consume the whole window — the same reasoning that caps core facts at two
slots (`recallBlend.ts:56-60`).

Dedup by ID across tiers, as core/relevance already does.

**Step 2: Preserve the single-copy invariant**

The file's own header explains why one copy of this policy serves both the tool
and the eval harness. Whatever changes here must keep both callers on the same
code path — a harness ordering results differently measures a window nobody
sees.

**Step 3: Label the tier in the response**

Results carry `source: "core" | "relevance"` today. Add `"exact"` so a client
can tell a named-entity hit from a ranked guess.

**Step 4: Verify**

Run: `pnpm test:once`. Extend `recallBlend.test.ts` for the new tier, and check
the recall eval cases in `memoryEval.test.ts` still pass — particularly the
tenant-leak assertions.

**Step 5: Commit**

---

## Workstream 3 — Budget-aware recall shaping

### Task 8: Replace per-item truncation with envelope allocation

**Status: implemented** in PR #45 (`apps/web/src/lib/mcp/recall-budget.ts`,
wired into `recall_context` with a `maxContextChars` parameter).

**Files:**

- Modify: `apps/web/src/lib/mcp/server.ts:254-259`
- Create: `apps/web/src/lib/mcp/recall-budget.ts`
- Create: `apps/web/src/lib/mcp/recall-budget.test.ts`

**Step 1: Write the allocator as a pure module**

Given items with tier, text and score, plus a total character budget, return the
items with text trimmed to fit. Rules:

- exact and core tiers keep their full text
- relevance items share the remainder, trimmed **longest-first**, so one long
  item is cut before four short ones are dropped
- trim at a sentence or paragraph boundary, not a character offset
- mark every trimmed item `truncated: true`

Pure and separately tested, like `recallBlend`.

**Step 2: Wire it into the recall handler**

`truncateContext` is applied at three call sites in the recall handler
(`server.ts:695`, `server.ts:723`, and the core-thought mapping). Replace them
with one allocator pass over the assembled context array, after the blend and
before serialization.

**Step 3: Set the budget below the declared ceiling**

The response declares `maxResultSizeChars: 50000` (`server.ts:766`). Default the
budget well under it and expose it as an optional tool parameter. Note in a
comment that the two numbers are related — the declared ceiling is the host's
hard limit, the budget is our soft one.

**Step 4: Report the loss**

Add a trimmed-item count to the envelope so a client can ask for more instead of
silently working from a cut-off memory.

**Step 5: Verify**

Run: `pnpm test:once` and `pnpm check-types`. Test: budget respected in
aggregate, core never trimmed, longest-first ordering, boundary trimming, and
an item shorter than its allocation passing through untouched.

**Step 6: Commit**

---

## Workstream 4 — Gap analysis

> Answer the W5 positioning question in the design doc before starting this
> workstream. It changes the envelope shape here and nothing earlier.

### Task 9: Compute gaps from the assembled window

**Files:**

- Create: `packages/convex/convex/models/recallGaps.ts`
- Create: `packages/convex/convex/models/recallGaps.test.ts`

**Step 1: Write the gap detector as a pure function**

Input: the blended window plus the current time. Output: a list of gaps. **No
model call** — everything needed is already in hand.

Four detectors:

- **stale** — newest returned memory older than the threshold. Report the date.
- **disagreement** — a returned fact and a returned thought carrying different
  values for the same subject and predicate. This is the same condition
  `forbiddenExactStrings` exists to catch in the eval harness
  (`models/thoughts/memoryEval.ts:20-24`); reuse that matching logic rather than
  writing a second one.
- **thin** — fewer results than requested, or all results below a score floor.
- **settling** — a returned current fact whose predecessor was superseded
  recently, read from `supersededAt` / `supersededBy` / `changeReason`.

**Step 2: Fixed, commented thresholds**

Constants at the top of the file with a sentence each explaining the number. Do
not make them configurable yet — make them wrong in an obvious place first.

**Step 3: Test each detector**

One case per detector plus a clean window producing no gaps. Deterministic, no
provider calls — same discipline as `memoryEval.ts`.

**Step 4: Commit**

---

### Task 10: Return gaps in the recall envelope

**Files:**

- Modify: `apps/web/src/lib/mcp/server.ts`

**Step 1: Change the response shape**

The handler currently serializes a bare array (`server.ts:753-766`). Wrap it:

```jsonc
{ "memories": [ ... ], "gaps": [ ... ] }
```

**This is a breaking change for anything parsing the current top-level array.**
Check `plugins/ai-brain/skills/` for consumers before landing it — the
skill-tool drift check (`.github/workflows/skill-tool-drift-check.yml`) exists
for exactly this class of mismatch and must pass.

**Step 2: Keep memories machine-parseable**

Gaps are a sibling key. Do not mix prose into the memory list.

**Step 3: Update the tool description**

`recall_context`'s description (`server.ts:540`) is the only instruction most
clients ever read. Add one sentence telling the client to surface gaps when
answering. Keep it short — the description is already dense.

**Step 4: Verify end to end**

Run: `pnpm lint`, `pnpm check-types`, `pnpm test:once`, `pnpm build`.

Then verify against a real account: a query about a topic untouched for months
must return a `stale` gap naming the date.

**Step 5: Commit**

---

## Out of scope

Export (already shipped as `pnpm export:brain`; nothing here touches it),
ingestion of any kind, the typed link graph, and synthesis. See the design doc
for the reasoning on each.
