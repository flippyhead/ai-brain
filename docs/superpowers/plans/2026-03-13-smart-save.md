# Smart Save Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mem0-style smart save to the AI Brain so that `capture_thought` automatically detects and replaces stale thoughts instead of blindly appending.

**Architecture:** Modify the `captureThought` write path to vector-search for similar existing thoughts, classify each as ADD/UPDATE/DELETE/NOOP via Claude Haiku, then execute the appropriate mutations. No new tables or infrastructure.

**Tech Stack:** Convex (backend), Claude Haiku (classification), OpenAI text-embedding-3-small (embeddings), TypeScript

**Spec:** `docs/superpowers/specs/2026-03-13-smart-save-design.md`

---

## Chunk 1: Schema & Data Layer

### Task 1: Add `updatedAt` field to validators

**Files:**
- Modify: `packages/convex/convex/models/thoughts/validators.ts:20-25`

- [ ] **Step 1: Add `updatedAt` to `thoughtFields`**

In `packages/convex/convex/models/thoughts/validators.ts`, add the optional field:

```typescript
export const thoughtFields = {
  content: v.string(),
  embedding: v.array(v.float64()),
  metadata: thoughtMetadata,
  userId: v.id("users"),
  updatedAt: v.optional(v.number()),
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/convex/convex/models/thoughts/validators.ts
git commit -m "feat: add updatedAt field to thought schema"
```

---

### Task 2: Update return type validators across all query files

Adding `updatedAt` to the schema means every query that returns thought documents must include it in their return type validators, or Convex will reject documents that have the field set.

**Files:**
- Modify: `packages/convex/convex/models/thoughts/private.ts:8-16` (getById return type)
- Modify: `packages/convex/convex/models/thoughts/private.ts:29-37` (listByUser return type)
- Modify: `packages/convex/convex/models/thoughts/mcpQueries.ts:14-20` (listByUser return type)
- Modify: `packages/convex/convex/models/thoughts/public.ts:12-19` (listRecent return type)

- [ ] **Step 1: Update `getById` return type in `private.ts`**

In `packages/convex/convex/models/thoughts/private.ts`, update the `getById` return validator (lines 8-16):

```typescript
  returns: v.union(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      embedding: v.array(v.float64()),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
```

- [ ] **Step 2: Update `listByUser` return type in `private.ts`**

In `packages/convex/convex/models/thoughts/private.ts`, update the `listByUser` return validator (lines 29-37):

```typescript
  returns: v.array(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      embedding: v.array(v.float64()),
      metadata: thoughtMetadata,
      userId: v.id("users"),
      updatedAt: v.optional(v.number()),
    }),
  ),
```

- [ ] **Step 3: Update `listByUser` return type in `mcpQueries.ts`**

In `packages/convex/convex/models/thoughts/mcpQueries.ts`, update the return validator (lines 14-20). Note: this query strips `embedding` before returning, so the validator must NOT include it:

```typescript
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
```

- [ ] **Step 4: Update `listRecent` return type in `public.ts`**

In `packages/convex/convex/models/thoughts/public.ts`, update the return validator (lines 12-19). Note: this query strips `embedding` before returning, so the validator must NOT include it:

```typescript
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
```

- [ ] **Step 5: Update `capture` return type in `publicActions.ts`**

In `packages/convex/convex/models/thoughts/publicActions.ts`, update the `capture` action return type (lines 14-16) to match the new `captureThought` return shape:

```typescript
  returns: v.object({
    thoughtId: v.id("thoughts"),
    metadata: thoughtMetadata,
    operationSummary: v.optional(v.string()),
  }),
```

- [ ] **Step 6: Run type check**

```bash
cd /Users/peterbrown/Development/ai-brain && pnpm check-types
```

Expected: passes with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/convex/convex/models/thoughts/private.ts packages/convex/convex/models/thoughts/mcpQueries.ts packages/convex/convex/models/thoughts/public.ts packages/convex/convex/models/thoughts/publicActions.ts
git commit -m "feat: add updatedAt to all thought return type validators"
```

---

### Task 3: Add `updateOne` and `deleteOne` mutations

**Files:**
- Modify: `packages/convex/convex/models/thoughts/model.ts` (add `_updateOne`, `_deleteOne`)
- Modify: `packages/convex/convex/models/thoughts/private.ts` (add `updateOne`, `deleteOne` internalMutations)

- [ ] **Step 1: Add model functions to `model.ts`**

In `packages/convex/convex/models/thoughts/model.ts`, add after the existing `_insertOne` function:

```typescript
export async function _updateOne(
  ctx: MutationCtx,
  id: Id<"thoughts">,
  fields: {
    content: string;
    embedding: number[];
    metadata: {
      type:
        | "decision"
        | "person_note"
        | "idea"
        | "meeting_note"
        | "task"
        | "reference";
      topics: string[];
      people: string[];
      actionItems: string[];
      summary: string;
    };
    updatedAt: number;
  },
) {
  await ctx.db.patch(id, fields);
}

export async function _deleteOne(ctx: MutationCtx, id: Id<"thoughts">) {
  await ctx.db.delete(id);
}
```

- [ ] **Step 2: Add `updateOne` internalMutation to `private.ts`**

In `packages/convex/convex/models/thoughts/private.ts`, add the import for `_updateOne` and `_deleteOne`:

Update the import line:
```typescript
import { _findById, _insertOne, _listByUser, _updateOne, _deleteOne } from "./model";
```

Add after the existing `insertOne` mutation:

```typescript
export const updateOne = internalMutation({
  args: {
    id: v.id("thoughts"),
    content: v.string(),
    embedding: v.array(v.float64()),
    metadata: thoughtMetadata,
    updatedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await _updateOne(ctx, args.id, {
      content: args.content,
      embedding: args.embedding,
      metadata: args.metadata,
      updatedAt: args.updatedAt,
    });
    return null;
  },
});

export const deleteOne = internalMutation({
  args: {
    id: v.id("thoughts"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await _deleteOne(ctx, args.id);
    return null;
  },
});
```

- [ ] **Step 3: Run type check**

```bash
cd /Users/peterbrown/Development/ai-brain && pnpm check-types
```

Expected: passes with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/convex/convex/models/thoughts/model.ts packages/convex/convex/models/thoughts/private.ts
git commit -m "feat: add updateOne and deleteOne mutations for smart save"
```

---

## Chunk 2: Classification Module

### Task 4: Create the classifier

This is the core of the feature — the LLM call that decides ADD/UPDATE/DELETE/NOOP.

**Files:**
- Create: `packages/convex/convex/models/thoughts/classify.ts`

- [ ] **Step 1: Create `classify.ts`**

Create the file `packages/convex/convex/models/thoughts/classify.ts`:

```typescript
"use node";

import { internalAction } from "../../_generated/server";
import { v } from "convex/values";

/** Minimum similarity score to consider a thought as a classification candidate. */
export const SIMILARITY_THRESHOLD = 0.7;

/** Maximum number of similar thoughts sent to the classifier. */
export const MAX_CANDIDATES = 10;

const classificationResponseSchema = v.object({
  operations: v.array(
    v.object({
      action: v.union(v.literal("UPDATE"), v.literal("DELETE")),
      thoughtId: v.string(),
      reason: v.string(),
      mergedContent: v.optional(v.string()),
    }),
  ),
  addNew: v.boolean(),
});

type ClassificationResponse = {
  operations: Array<{
    action: "UPDATE" | "DELETE";
    thoughtId: string;
    reason: string;
    mergedContent?: string;
  }>;
  addNew: boolean;
};

type CandidateThought = {
  _id: string;
  content: string;
  metadata: {
    type: string;
    topics: string[];
    people: string[];
    summary: string;
  };
  createdAt: number;
};

const SYSTEM_PROMPT = `You are a memory manager for a personal knowledge base. You are given new content being saved, along with existing similar entries (each with an id, content, metadata, and creation date).

Your job: determine if the new content UPDATES, REPLACES, or is INDEPENDENT of each existing entry.

Guidelines:
- UPDATE when the new content is clearly a newer version of the same fact (e.g., project status changed, goal revised, preference updated). Use mergedContent if the new content only partially overlaps and you want to combine both into a single coherent entry.
- DELETE when an existing entry is fully redundant given the new content
- Leave alone (omit from operations) when entries are related but both independently valuable (e.g., two different decisions about the same project)
- Set addNew to false only when the new content is fully captured by an UPDATE with mergedContent
- When in doubt, leave existing entries alone — false updates are worse than mild duplication

Return ONLY valid JSON matching this schema:
{
  "operations": [
    {
      "action": "UPDATE" | "DELETE",
      "thoughtId": "<id of existing entry>",
      "reason": "<why this action>",
      "mergedContent": "<optional: combined content for UPDATE>"
    }
  ],
  "addNew": true | false
}`;

export const classifyThought = internalAction({
  args: {
    newContent: v.string(),
    candidates: v.array(
      v.object({
        _id: v.string(),
        content: v.string(),
        metadata: v.object({
          type: v.string(),
          topics: v.array(v.string()),
          people: v.array(v.string()),
          summary: v.string(),
        }),
        createdAt: v.number(),
      }),
    ),
  },
  returns: v.union(classificationResponseSchema, v.null()),
  handler: async (_ctx, args): Promise<ClassificationResponse | null> => {
    const candidateList = args.candidates
      .map(
        (c: CandidateThought) =>
          `ID: ${c._id}\nContent: ${c.content}\nType: ${c.metadata.type}\nTopics: ${c.metadata.topics.join(", ")}\nSummary: ${c.metadata.summary}\nCreated: ${new Date(c.createdAt).toISOString()}`,
      )
      .join("\n\n---\n\n");

    const userMessage = `NEW CONTENT:\n${args.newContent}\n\nEXISTING SIMILAR ENTRIES:\n\n${candidateList}`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!response.ok) {
        console.error(
          `Classification LLM call failed: ${response.statusText}`,
        );
        return null;
      }

      const data = (await response.json()) as {
        content: Array<{ text: string }>;
      };
      const text = data.content[0]!.text;

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("Classification returned no valid JSON:", text);
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]) as ClassificationResponse;

      // Validate structure
      if (!Array.isArray(parsed.operations) || typeof parsed.addNew !== "boolean") {
        console.error("Classification returned invalid structure:", parsed);
        return null;
      }

      // Validate thoughtIds against candidate set
      const validIds = new Set(args.candidates.map((c: CandidateThought) => c._id));
      const validatedOps = parsed.operations.filter((op) => {
        if (!validIds.has(op.thoughtId)) {
          console.warn(
            `Classification returned unknown thoughtId: ${op.thoughtId}, ignoring`,
          );
          return false;
        }
        if (op.action !== "UPDATE" && op.action !== "DELETE") {
          console.warn(
            `Classification returned invalid action: ${op.action}, ignoring`,
          );
          return false;
        }
        return true;
      });

      return {
        operations: validatedOps,
        addNew: parsed.addNew,
      };
    } catch (error) {
      console.error("Classification error:", error);
      return null;
    }
  },
});
```

- [ ] **Step 2: Run type check**

```bash
cd /Users/peterbrown/Development/ai-brain && pnpm check-types
```

Expected: passes with no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/convex/convex/models/thoughts/classify.ts
git commit -m "feat: add thought classification module for smart save"
```

---

## Chunk 3: Smart Save Write Path

### Task 5: Modify `captureThought` to use smart save

This is where it all comes together. The existing `captureThought` action gets the similarity search + classification + operation execution logic.

**Files:**
- Modify: `packages/convex/convex/models/thoughts/actions.ts:13-45`

- [ ] **Step 1: Add imports at the top of `actions.ts`**

Add the needed imports after the existing imports in `packages/convex/convex/models/thoughts/actions.ts`:

```typescript
import {
  SIMILARITY_THRESHOLD,
  MAX_CANDIDATES,
} from "./classify";

type ClassificationResponse = {
  operations: Array<{
    action: "UPDATE" | "DELETE";
    thoughtId: string;
    reason: string;
    mergedContent?: string;
  }>;
  addNew: boolean;
};
```

- [ ] **Step 2: Rewrite `captureThought` with smart save flow**

Replace the entire `captureThought` action in `packages/convex/convex/models/thoughts/actions.ts` (lines 13-45):

```typescript
export const captureThought = internalAction({
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
    // Step 1: Generate embedding for the new content
    const embedding = await ctx.runAction(
      internal.models.thoughts.helpers.generateEmbedding,
      { text: args.content },
    );

    // Step 2: Search for similar existing thoughts
    const similarResults = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 256,
      filter: (q) => q.eq("userId", args.userId),
    });

    const candidates = similarResults
      .filter((r) => r._score >= SIMILARITY_THRESHOLD)
      .slice(0, MAX_CANDIDATES);

    // Step 3: If similar thoughts found, classify
    let classification: ClassificationResponse | null = null;
    if (candidates.length > 0) {
      // Fetch full documents for candidates
      const candidateDocs = await Promise.all(
        candidates.map(async (r) => {
          const doc = await ctx.runQuery(
            internal.models.thoughts.private.getById,
            { id: r._id },
          );
          return doc
            ? {
                _id: r._id as string,
                content: doc.content,
                metadata: {
                  type: doc.metadata.type,
                  topics: doc.metadata.topics,
                  people: doc.metadata.people,
                  summary: doc.metadata.summary,
                },
                createdAt: doc._creationTime,
              }
            : null;
        }),
      );

      const validCandidates = candidateDocs.filter(
        (d): d is NonNullable<typeof d> => d !== null,
      );

      if (validCandidates.length > 0) {
        classification = await ctx.runAction(
          internal.models.thoughts.classify.classifyThought,
          { newContent: args.content, candidates: validCandidates },
        );
      }
    }

    // Step 4: Execute operations
    const summaryParts: string[] = [];

    if (classification && classification.operations.length > 0) {
      for (const op of classification.operations) {
        if (op.action === "UPDATE") {
          const contentToStore = op.mergedContent ?? args.content;

          // Log previous content for safety during rollout
          const existing = await ctx.runQuery(
            internal.models.thoughts.private.getById,
            { id: op.thoughtId as any },
          );
          if (existing) {
            console.log(
              `[Smart Save] Overwriting thought ${op.thoughtId}. Previous content: ${existing.content}`,
            );
          }

          // Re-embed and re-extract metadata for the updated content
          const [newEmbedding, newMetadata] = await Promise.all([
            ctx.runAction(
              internal.models.thoughts.helpers.generateEmbedding,
              { text: contentToStore },
            ),
            ctx.runAction(
              internal.models.thoughts.helpers.extractMetadata,
              { text: contentToStore },
            ),
          ]);

          await ctx.runMutation(
            internal.models.thoughts.private.updateOne,
            {
              id: op.thoughtId as any,
              content: contentToStore,
              embedding: newEmbedding,
              metadata: newMetadata,
              updatedAt: Date.now(),
            },
          );
          summaryParts.push(`Updated 1 existing thought (${op.reason})`);
        } else if (op.action === "DELETE") {
          console.log(
            `[Smart Save] Deleting thought ${op.thoughtId}. Reason: ${op.reason}`,
          );
          await ctx.runMutation(
            internal.models.thoughts.private.deleteOne,
            { id: op.thoughtId as any },
          );
          summaryParts.push(`Removed 1 redundant thought (${op.reason})`);
        }
      }
    }

    // Step 5: Add new thought if needed
    let thoughtId: any;
    let metadata: any;

    if (!classification || classification.addNew !== false) {
      metadata = await ctx.runAction(
        internal.models.thoughts.helpers.extractMetadata,
        { text: args.content },
      );

      thoughtId = await ctx.runMutation(
        internal.models.thoughts.private.insertOne,
        {
          content: args.content,
          embedding,
          metadata,
          userId: args.userId,
        },
      );
    } else {
      // addNew is false — content was merged into an existing thought
      // Return the first updated thought's ID and re-fetch its metadata
      const updatedId = classification.operations.find(
        (op) => op.action === "UPDATE",
      )?.thoughtId;

      if (updatedId) {
        const updated = await ctx.runQuery(
          internal.models.thoughts.private.getById,
          { id: updatedId as any },
        );
        thoughtId = updatedId;
        metadata = updated?.metadata ?? {
          type: "reference" as const,
          topics: [],
          people: [],
          actionItems: [],
          summary: args.content.slice(0, 100),
        };
      } else {
        // Shouldn't happen, but fallback: just add it
        metadata = await ctx.runAction(
          internal.models.thoughts.helpers.extractMetadata,
          { text: args.content },
        );

        thoughtId = await ctx.runMutation(
          internal.models.thoughts.private.insertOne,
          {
            content: args.content,
            embedding,
            metadata,
            userId: args.userId,
          },
        );
      }
    }

    const operationSummary =
      summaryParts.length > 0 ? summaryParts.join(". ") : undefined;

    return { thoughtId, metadata, operationSummary };
  },
});
```

- [ ] **Step 3: Run type check**

```bash
cd /Users/peterbrown/Development/ai-brain && pnpm check-types
```

Expected: passes with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/convex/convex/models/thoughts/actions.ts
git commit -m "feat: integrate smart save classification into captureThought"
```

---

## Chunk 4: MCP Response Updates

### Task 6: Update MCP action return type and server response

**Files:**
- Modify: `packages/convex/convex/models/thoughts/mcpActions.ts:14-29`
- Modify: `apps/web/src/lib/mcp/server.ts:186-218`

- [ ] **Step 1: Update `capture` action return type in `mcpActions.ts`**

In `packages/convex/convex/models/thoughts/mcpActions.ts`, update the `capture` action (lines 14-29):

```typescript
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
```

- [ ] **Step 2: Update MCP server response message**

In `apps/web/src/lib/mcp/server.ts`, update the `capture_thought` tool handler (lines 192-217):

```typescript
    async ({ content }) => {
      type CaptureResult = {
        thoughtId: string;
        metadata: { type: string; topics: string[]; people: string[]; actionItems: string[]; summary: string };
        operationSummary?: string;
      };
      const result: CaptureResult = await convex.action(
        api.models.thoughts.mcpActions.capture,
        { userId: userId as never, content },
      );

      const statusLine = result.operationSummary
        ? `Thought captured. ${result.operationSummary}.`
        : "Thought captured successfully.";

      return {
        content: [
          {
            type: "text" as const,
            text: [
              statusLine,
              "",
              `Type: ${result.metadata.type}`,
              `Topics: ${result.metadata.topics.join(", ") || "none"}`,
              `People: ${result.metadata.people.join(", ") || "none"}`,
              `Summary: ${result.metadata.summary}`,
            ].join("\n"),
          },
        ],
      };
    },
```

- [ ] **Step 3: Run type check**

```bash
cd /Users/peterbrown/Development/ai-brain && pnpm check-types
```

Expected: passes with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/convex/convex/models/thoughts/mcpActions.ts apps/web/src/lib/mcp/server.ts
git commit -m "feat: update MCP capture response to include operation summary"
```

---

## Chunk 5: Deploy & Verify

### Task 7: Deploy and test

- [ ] **Step 1: Deploy Convex functions**

```bash
cd /Users/peterbrown/Development/ai-brain/packages/convex && npx convex dev --once
```

Expected: all functions deploy successfully.

- [ ] **Step 2: Test basic capture (no similar thoughts)**

Use the MCP `capture_thought` tool to save something on a new topic. Verify:
- Response says "Thought captured successfully."
- Thought appears in browse_recent

- [ ] **Step 3: Test smart save (update existing)**

Save a thought about a topic that already exists but with updated information. For example:
1. First: "Currently working on Project X, it is in planning phase"
2. Then: "Project X has moved to development phase"

Verify:
- Response includes operation summary like "Updated 1 existing thought"
- Only the updated version appears in search results, not both

- [ ] **Step 4: Test smart save (independent thoughts)**

Save a thought that's related to an existing topic but independently valuable. Verify:
- Response says "Thought captured successfully." (no operations)
- Both thoughts exist

- [ ] **Step 5: Commit any fixes and final commit**

```bash
git add -A
git commit -m "feat: smart save - complete implementation"
```
