# Open Brain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a personal semantic memory system with MCP access, Convex backend, and Next.js web UI.

**Architecture:** Turborepo monorepo with a Next.js app (`apps/web`) hosting both the web dashboard and MCP API endpoint, backed by a Convex package (`packages/convex`) handling database, vector search, auth, and AI actions (OpenAI embeddings + Claude Haiku metadata extraction).

**Tech Stack:** TypeScript, Next.js (App Router), Convex, Convex Auth, OpenAI (embeddings), Anthropic (Haiku), MCP SDK, Turborepo, pnpm, Subframe (UI)

**Reference:** Design doc at `docs/plans/2026-03-03-open-brain-design.md`, stack conventions at `~/.claude/my-stack.md`

---

### Task 1: Scaffold Monorepo

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `.npmrc`
- Create: `packages/typescript-config/package.json`
- Create: `packages/typescript-config/base.json`
- Create: `packages/typescript-config/nextjs.json`
- Create: `packages/typescript-config/react-library.json`
- Create: `packages/eslint-config/package.json`
- Create: `packages/eslint-config/base.js`
- Create: `packages/eslint-config/next.js`

**Step 1: Create root package.json**

```json
{
  "name": "open-brain",
  "private": true,
  "packageManager": "pnpm@10.6.2",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "check-types": "turbo run check-types",
    "test": "turbo run test",
    "test:once": "turbo run test:once",
    "format": "prettier --write \"**/*.{ts,tsx,md}\""
  },
  "devDependencies": {
    "prettier": "^3.4.0",
    "turbo": "^2.4.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Step 3: Create turbo.json**

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "stream",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^lint"]
    },
    "check-types": {
      "dependsOn": ["^check-types"]
    },
    "test": {
      "cache": false,
      "persistent": true
    },
    "test:once": {
      "cache": false
    }
  },
  "globalPassThroughEnv": ["PORT", "WEB_PORT"],
  "globalEnv": [
    "CONVEX_DEPLOYMENT",
    "NEXT_PUBLIC_CONVEX_URL",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY"
  ]
}
```

**Step 4: Create .gitignore**

```
node_modules/
.next/
.turbo/
dist/
.env
.env.local
.env.*.local
```

**Step 5: Create .npmrc**

```
auto-install-peers=true
```

**Step 6: Create TypeScript configs**

Create `packages/typescript-config/package.json`, `base.json`, `nextjs.json`, `react-library.json` per stack conventions (exact content in `~/.claude/my-stack.md`).

**Step 7: Create ESLint configs**

Create `packages/eslint-config/package.json`, `base.js`, `next.js` per stack conventions.

**Step 8: Install dependencies and verify**

```bash
pnpm install
```

**Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold turborepo monorepo"
```

---

### Task 2: Set Up Convex Package

**Files:**
- Create: `packages/convex/package.json`
- Create: `packages/convex/tsconfig.json`
- Create: `packages/convex/src/convex/schema.ts`
- Create: `packages/convex/src/convex/auth.ts`
- Create: `packages/convex/src/convex/convex.config.ts`
- Create: `packages/convex/src/convex/http.ts`

**Step 1: Create packages/convex/package.json**

```json
{
  "name": "@repo/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./convex/_generated/api": "./src/convex/_generated/api.js",
    "./convex/*": "./src/convex/*",
    "./models/*": "./src/convex/models/*"
  },
  "scripts": {
    "deploy:dev": "convex dev --once",
    "deploy:prod": "convex deploy -y"
  },
  "dependencies": {
    "@convex-dev/auth": "^0.0.80",
    "@auth/core": "^0.37.0",
    "convex": "^1.17.0"
  }
}
```

**Step 2: Create packages/convex/tsconfig.json**

```json
{
  "compilerOptions": {
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "target": "ES2022",
    "strict": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "resolveJsonModule": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create convex.config.ts**

```typescript
// packages/convex/src/convex/convex.config.ts
import { defineApp } from "convex/server";

const app = defineApp();
export default app;
```

**Step 4: Create auth.ts**

```typescript
// packages/convex/src/convex/auth.ts
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [Password],
});
```

Start with Password provider only. Add OAuth (GitHub, Google) later.

**Step 5: Create schema.ts with authTables + thoughts + apiKeys**

```typescript
// packages/convex/src/convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { thoughtFields } from "./models/thoughts/validators";
import { apiKeyFields } from "./models/apiKeys/validators";

export default defineSchema({
  ...authTables,
  thoughts: defineTable(thoughtFields)
    .index("by_userId", ["userId"])
    .index("by_userId_and_type", ["userId", "metadata.type"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      filterFields: ["userId"],
    }),
  apiKeys: defineTable(apiKeyFields)
    .index("by_keyHash", ["keyHash"])
    .index("by_userId", ["userId"]),
});
```

**Step 6: Create http.ts**

```typescript
// packages/convex/src/convex/http.ts
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();
auth.addHttpRoutes(http);

export default http;
```

**Step 7: Initialize Convex project**

```bash
cd packages/convex && npx convex init
```

Then run auth setup:

```bash
npx @convex-dev/auth
```

**Step 8: Install and push**

```bash
pnpm install && cd packages/convex && pnpm deploy:dev
```

**Step 9: Commit**

```bash
git add -A && git commit -m "feat: set up convex package with auth and schema"
```

---

### Task 3: Thoughts Model

**Files:**
- Create: `packages/convex/src/convex/models/thoughts/validators.ts`
- Create: `packages/convex/src/convex/models/thoughts/model.ts`
- Create: `packages/convex/src/convex/models/thoughts/private.ts`
- Create: `packages/convex/src/convex/models/thoughts/public.ts`
- Create: `packages/convex/src/convex/models/thoughts/actions.ts`

**Step 1: Create validators.ts**

```typescript
// packages/convex/src/convex/models/thoughts/validators.ts
import { v } from "convex/values";

export const thoughtType = v.union(
  v.literal("decision"),
  v.literal("person_note"),
  v.literal("idea"),
  v.literal("meeting_note"),
  v.literal("task"),
  v.literal("reference"),
);

export const thoughtMetadata = v.object({
  type: thoughtType,
  topics: v.array(v.string()),
  people: v.array(v.string()),
  actionItems: v.array(v.string()),
  summary: v.string(),
});

export const thoughtFields = {
  content: v.string(),
  embedding: v.array(v.float64()),
  metadata: thoughtMetadata,
  userId: v.id("users"),
};
```

**Step 2: Create model.ts with core CRUD functions**

```typescript
// packages/convex/src/convex/models/thoughts/model.ts
import { QueryCtx, MutationCtx } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

export async function _findById(ctx: QueryCtx, id: Id<"thoughts">) {
  return await ctx.db.get(id);
}

export async function _listByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number = 20,
) {
  return await ctx.db
    .query("thoughts")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .take(limit);
}

export async function _insertOne(
  ctx: MutationCtx,
  fields: {
    content: string;
    embedding: number[];
    metadata: {
      type: "decision" | "person_note" | "idea" | "meeting_note" | "task" | "reference";
      topics: string[];
      people: string[];
      actionItems: string[];
      summary: string;
    };
    userId: Id<"users">;
  },
) {
  return await ctx.db.insert("thoughts", fields);
}
```

**Step 3: Create private.ts with internal queries/mutations**

```typescript
// packages/convex/src/convex/models/thoughts/private.ts
import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { thoughtMetadata } from "./validators";
import { _insertOne, _listByUser } from "./model";

export const insertOne = internalMutation({
  args: {
    content: v.string(),
    embedding: v.array(v.float64()),
    metadata: thoughtMetadata,
    userId: v.id("users"),
  },
  returns: v.id("thoughts"),
  handler: async (ctx, args) => {
    return await _insertOne(ctx, args);
  },
});

export const listByUser = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.id("thoughts"),
    _creationTime: v.number(),
    content: v.string(),
    embedding: v.array(v.float64()),
    metadata: thoughtMetadata,
    userId: v.id("users"),
  })),
  handler: async (ctx, args) => {
    return await _listByUser(ctx, args.userId, args.limit ?? 20);
  },
});
```

**Step 4: Create public.ts with authenticated queries**

```typescript
// packages/convex/src/convex/models/thoughts/public.ts
import { query } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { thoughtMetadata, thoughtType } from "./validators";
import { _listByUser } from "./model";

export const listRecent = query({
  args: {
    limit: v.optional(v.number()),
    type: v.optional(thoughtType),
  },
  returns: v.array(v.object({
    _id: v.id("thoughts"),
    _creationTime: v.number(),
    content: v.string(),
    metadata: thoughtMetadata,
    userId: v.id("users"),
  })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    if (args.type) {
      return await ctx.db
        .query("thoughts")
        .withIndex("by_userId_and_type", (q) =>
          q.eq("userId", userId).eq("metadata.type", args.type!)
        )
        .order("desc")
        .take(args.limit ?? 20);
    }

    return await _listByUser(ctx, userId, args.limit ?? 20);
  },
});

export const getStats = query({
  args: {},
  returns: v.object({
    totalThoughts: v.number(),
    byType: v.array(v.object({ type: v.string(), count: v.number() })),
    topTopics: v.array(v.object({ topic: v.string(), count: v.number() })),
    topPeople: v.array(v.object({ person: v.string(), count: v.number() })),
    dateRange: v.optional(v.object({
      earliest: v.number(),
      latest: v.number(),
    })),
  }),
  handler: async (ctx, _args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const allThoughts = await ctx.db
      .query("thoughts")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const typeCounts = new Map<string, number>();
    const topicCounts = new Map<string, number>();
    const peopleCounts = new Map<string, number>();

    for (const thought of allThoughts) {
      typeCounts.set(thought.metadata.type, (typeCounts.get(thought.metadata.type) ?? 0) + 1);
      for (const topic of thought.metadata.topics) {
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      }
      for (const person of thought.metadata.people) {
        peopleCounts.set(person, (peopleCounts.get(person) ?? 0) + 1);
      }
    }

    const byType = [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);

    const topTopics = [...topicCounts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topPeople = [...peopleCounts.entries()]
      .map(([person, count]) => ({ person, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const dateRange = allThoughts.length > 0
      ? {
          earliest: allThoughts[allThoughts.length - 1]!._creationTime,
          latest: allThoughts[0]!._creationTime,
        }
      : undefined;

    return {
      totalThoughts: allThoughts.length,
      byType,
      topTopics,
      topPeople,
      dateRange,
    };
  },
});
```

**Step 5: Create actions.ts with AI actions**

```typescript
// packages/convex/src/convex/models/thoughts/actions.ts
"use node";

import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { v } from "convex/values";
import { thoughtMetadata } from "./validators";

export const generateEmbedding = internalAction({
  args: { text: v.string() },
  returns: v.array(v.float64()),
  handler: async (_ctx, args): Promise<number[]> => {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: args.text,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  },
});

export const extractMetadata = internalAction({
  args: { text: v.string() },
  returns: thoughtMetadata,
  handler: async (_ctx, args) => {
    const fallback = {
      type: "reference" as const,
      topics: [],
      people: [],
      actionItems: [],
      summary: args.text.slice(0, 100),
    };

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
          max_tokens: 512,
          system: `Extract metadata from the following thought/note. Return ONLY valid JSON with this exact structure:
{
  "type": "decision" | "person_note" | "idea" | "meeting_note" | "task" | "reference",
  "topics": ["topic1", "topic2"] (1-3 keyword topics),
  "people": ["Name1"] (names mentioned, empty array if none),
  "actionItems": ["item1"] (action items if any, empty array if none),
  "summary": "One-line summary"
}`,
          messages: [{ role: "user", content: args.text }],
        }),
      });

      if (!response.ok) {
        console.error(`Anthropic metadata extraction failed: ${response.statusText}`);
        return fallback;
      }

      const data = await response.json();
      const text = data.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return fallback;

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate the parsed type is one of the allowed types
      const validTypes = ["decision", "person_note", "idea", "meeting_note", "task", "reference"];
      if (!validTypes.includes(parsed.type)) {
        parsed.type = "reference";
      }

      return {
        type: parsed.type,
        topics: Array.isArray(parsed.topics) ? parsed.topics : [],
        people: Array.isArray(parsed.people) ? parsed.people : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        summary: typeof parsed.summary === "string" ? parsed.summary : args.text.slice(0, 100),
      };
    } catch (error) {
      console.error("Metadata extraction error:", error);
      return fallback;
    }
  },
});

export const captureThought = internalAction({
  args: {
    userId: v.id("users"),
    content: v.string(),
  },
  returns: v.object({
    thoughtId: v.id("thoughts"),
    metadata: thoughtMetadata,
  }),
  handler: async (ctx, args) => {
    // Run embedding and metadata extraction in parallel
    const [embedding, metadata] = await Promise.all([
      ctx.runAction(internal.models.thoughts.actions.generateEmbedding, {
        text: args.content,
      }),
      ctx.runAction(internal.models.thoughts.actions.extractMetadata, {
        text: args.content,
      }),
    ]);

    const thoughtId = await ctx.runMutation(
      internal.models.thoughts.private.insertOne,
      {
        content: args.content,
        embedding,
        metadata,
        userId: args.userId,
      }
    );

    return { thoughtId, metadata };
  },
});

export const searchByVector = internalAction({
  args: {
    userId: v.id("users"),
    query: v.string(),
    threshold: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.object({
    _id: v.id("thoughts"),
    content: v.string(),
    metadata: thoughtMetadata,
    score: v.float64(),
    createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const threshold = args.threshold ?? 0.5;
    const limit = args.limit ?? 10;

    const embedding = await ctx.runAction(
      internal.models.thoughts.actions.generateEmbedding,
      { text: args.query }
    );

    const results = await ctx.vectorSearch("thoughts", "by_embedding", {
      vector: embedding,
      limit: 256,
      filter: (q) => q.eq("userId", args.userId),
    });

    // Post-filter by threshold and limit
    const filtered = results
      .filter((r) => r._score >= threshold)
      .slice(0, limit);

    // Fetch full documents
    const docs = await Promise.all(
      filtered.map(async (r) => {
        const doc = await ctx.runQuery(
          internal.models.thoughts.private.getById,
          { id: r._id }
        );
        return doc ? {
          _id: r._id,
          content: doc.content,
          metadata: doc.metadata,
          score: r._score,
          createdAt: doc._creationTime,
        } : null;
      })
    );

    return docs.filter((d): d is NonNullable<typeof d> => d !== null);
  },
});
```

Note: `searchByVector` needs a `getById` internal query in `private.ts`. Add:

```typescript
// Add to private.ts
export const getById = internalQuery({
  args: { id: v.id("thoughts") },
  returns: v.union(
    v.object({
      _id: v.id("thoughts"),
      _creationTime: v.number(),
      content: v.string(),
      embedding: v.array(v.float64()),
      metadata: thoughtMetadata,
      userId: v.id("users"),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
```

**Step 6: Push to Convex and verify**

```bash
cd packages/convex && pnpm deploy:dev
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add thoughts model with embedding and metadata actions"
```

---

### Task 4: API Keys Model

**Files:**
- Create: `packages/convex/src/convex/models/apiKeys/validators.ts`
- Create: `packages/convex/src/convex/models/apiKeys/model.ts`
- Create: `packages/convex/src/convex/models/apiKeys/public.ts`
- Create: `packages/convex/src/convex/models/apiKeys/private.ts`

**Step 1: Create validators.ts**

```typescript
// packages/convex/src/convex/models/apiKeys/validators.ts
import { v } from "convex/values";

export const apiKeyFields = {
  userId: v.id("users"),
  keyHash: v.string(),
  keyPrefix: v.string(),
  name: v.string(),
  lastUsedAt: v.optional(v.number()),
};
```

**Step 2: Create model.ts**

```typescript
// packages/convex/src/convex/models/apiKeys/model.ts
import { QueryCtx, MutationCtx } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

export async function _findByHash(ctx: QueryCtx, keyHash: string) {
  return await ctx.db
    .query("apiKeys")
    .withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash))
    .unique();
}

export async function _listByUser(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("apiKeys")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .collect();
}

export async function _insertOne(
  ctx: MutationCtx,
  fields: {
    userId: Id<"users">;
    keyHash: string;
    keyPrefix: string;
    name: string;
  },
) {
  return await ctx.db.insert("apiKeys", fields);
}

export async function _deleteOne(ctx: MutationCtx, id: Id<"apiKeys">) {
  await ctx.db.delete(id);
}
```

**Step 3: Create private.ts for internal access (MCP auth lookup)**

```typescript
// packages/convex/src/convex/models/apiKeys/private.ts
import { internalQuery, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { _findByHash } from "./model";

export const findByHash = internalQuery({
  args: { keyHash: v.string() },
  returns: v.union(
    v.object({
      _id: v.id("apiKeys"),
      _creationTime: v.number(),
      userId: v.id("users"),
      keyHash: v.string(),
      keyPrefix: v.string(),
      name: v.string(),
      lastUsedAt: v.optional(v.number()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await _findByHash(ctx, args.keyHash);
  },
});

export const updateLastUsed = internalMutation({
  args: { id: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { lastUsedAt: Date.now() });
    return null;
  },
});
```

**Step 4: Create public.ts for authenticated user access**

```typescript
// packages/convex/src/convex/models/apiKeys/public.ts
import { query, mutation } from "../../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { _listByUser, _insertOne, _deleteOne } from "./model";

export const list = query({
  args: {},
  returns: v.array(v.object({
    _id: v.id("apiKeys"),
    _creationTime: v.number(),
    keyPrefix: v.string(),
    name: v.string(),
    lastUsedAt: v.optional(v.number()),
  })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const keys = await _listByUser(ctx, userId);
    // Never return keyHash to the client
    return keys.map((k) => ({
      _id: k._id,
      _creationTime: k._creationTime,
      keyPrefix: k.keyPrefix,
      name: k.name,
      lastUsedAt: k.lastUsedAt,
    }));
  },
});

export const create = mutation({
  args: { name: v.string() },
  returns: v.object({
    id: v.id("apiKeys"),
    rawKey: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Generate a random API key
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const rawKey = "ob_" + Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Hash it for storage
    const encoder = new TextEncoder();
    const data = encoder.encode(rawKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const keyHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const keyPrefix = rawKey.slice(0, 11); // "ob_" + first 8 hex chars

    const id = await _insertOne(ctx, {
      userId,
      keyHash,
      keyPrefix,
      name: args.name,
    });

    // rawKey is returned ONCE — never stored or retrievable again
    return { id, rawKey };
  },
});

export const revoke = mutation({
  args: { id: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const key = await ctx.db.get(args.id);
    if (!key || key.userId !== userId) {
      throw new Error("API key not found");
    }

    await _deleteOne(ctx, args.id);
    return null;
  },
});
```

**Step 5: Push to Convex and verify**

```bash
cd packages/convex && pnpm deploy:dev
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add API keys model with create, list, revoke"
```

---

### Task 5: Set Up Next.js App

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/next.config.js`
- Create: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/ConvexClientProvider.tsx`
- Create: `apps/web/src/middleware.ts`

**Step 1: Create Next.js app with Convex Auth integration**

Use `create-next-app` or create manually. Key files:

`apps/web/package.json`:
```json
{
  "name": "@repo/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port ${WEB_PORT:-3000}",
    "build": "next build",
    "start": "next start",
    "lint": "eslint --max-warnings 0",
    "check-types": "tsc --noEmit"
  },
  "dependencies": {
    "@convex-dev/auth": "^0.0.80",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "convex": "^1.17.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@repo/db": "workspace:*"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create layout with Convex Auth providers**

```typescript
// apps/web/src/app/layout.tsx
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "./ConvexClientProvider";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <body>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
```

```typescript
// apps/web/src/app/ConvexClientProvider.tsx
"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsProvider client={convex}>
      {children}
    </ConvexAuthNextjsProvider>
  );
}
```

**Step 3: Create middleware for route protection**

```typescript
// apps/web/src/middleware.ts
import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/sign-in", "/sign-up"]);
const isProtectedRoute = createRouteMatcher(["/(authenticated)(.*)"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/");
  }
  if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/sign-in");
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next|api).*)", "/", "/(api|trpc)(.*)"],
};
```

Note: Exclude `/api` from middleware matcher so the MCP endpoint doesn't go through auth middleware (it has its own API key auth).

**Step 4: Install dependencies and verify**

```bash
pnpm install && cd apps/web && pnpm dev
```

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: set up next.js app with convex auth"
```

---

### Task 6: MCP Endpoint

**Files:**
- Create: `apps/web/src/lib/mcp/server.ts`
- Create: `apps/web/src/lib/mcp/auth.ts`
- Create: `apps/web/src/app/api/mcp/route.ts`

**Step 1: Create MCP auth helper**

```typescript
// apps/web/src/lib/mcp/auth.ts
import { ConvexHttpClient } from "convex/browser";
import { internal } from "@repo/db/convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function authenticateApiKey(
  authHeader: string | null,
): Promise<{ userId: string; keyId: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const rawKey = authHeader.slice(7);
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const apiKey = await convex.query(internal.models.apiKeys.private.findByHash, { keyHash });
  if (!apiKey) return null;

  // Update last used timestamp (fire and forget)
  convex.mutation(internal.models.apiKeys.private.updateLastUsed, { id: apiKey._id }).catch(() => {});

  return { userId: apiKey.userId, keyId: apiKey._id };
}
```

Note: The `ConvexHttpClient` calling internal functions requires the `CONVEX_DEPLOYMENT` env var for admin access. This needs to be verified — may need to use `fetchQuery` with admin token instead. Adjust during implementation based on Convex docs for calling internal functions from outside.

**Step 2: Create MCP server factory**

```typescript
// apps/web/src/lib/mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConvexHttpClient } from "convex/browser";
import { internal } from "@repo/db/convex/_generated/api";
import { z } from "zod";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function createMcpServer(userId: string) {
  const server = new McpServer({
    name: "open-brain",
    version: "1.0.0",
  });

  server.tool(
    "search_thoughts",
    "Semantic search across all stored thoughts",
    {
      query: z.string().describe("Natural language search query"),
      threshold: z.number().min(0).max(1).default(0.5).describe("Similarity threshold"),
      limit: z.number().min(1).max(50).default(10).describe("Max results"),
    },
    async ({ query, threshold, limit }) => {
      const results = await convex.action(
        internal.models.thoughts.actions.searchByVector,
        { userId: userId as any, query, threshold, limit }
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(results.map((r) => ({
            content: r.content,
            metadata: r.metadata,
            similarityScore: r.score,
            createdAt: new Date(r.createdAt).toISOString(),
          })), null, 2),
        }],
      };
    }
  );

  server.tool(
    "browse_recent",
    "Browse most recent thoughts, optionally filtered by type or topic",
    {
      limit: z.number().min(1).max(100).default(20).describe("How many thoughts to return"),
      type: z.enum(["decision", "person_note", "idea", "meeting_note", "task", "reference"]).optional().describe("Filter by thought type"),
      topic: z.string().optional().describe("Filter by topic keyword"),
    },
    async ({ limit, type, topic }) => {
      const results = await convex.query(
        internal.models.thoughts.private.listByUser,
        { userId: userId as any, limit }
      );

      let filtered = results;
      if (type) {
        filtered = filtered.filter((t) => t.metadata.type === type);
      }
      if (topic) {
        filtered = filtered.filter((t) =>
          t.metadata.topics.some((tp) => tp.toLowerCase().includes(topic!.toLowerCase()))
        );
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(filtered.map((t) => ({
            content: t.content,
            metadata: t.metadata,
            createdAt: new Date(t._creationTime).toISOString(),
          })), null, 2),
        }],
      };
    }
  );

  server.tool(
    "get_stats",
    "Get overview statistics of what's in your brain",
    {},
    async () => {
      // Stats requires authenticated session — we'll call the internal query directly
      const thoughts = await convex.query(
        internal.models.thoughts.private.listByUser,
        { userId: userId as any, limit: 10000 }
      );

      const typeCounts = new Map<string, number>();
      const topicCounts = new Map<string, number>();
      const peopleCounts = new Map<string, number>();

      for (const t of thoughts) {
        typeCounts.set(t.metadata.type, (typeCounts.get(t.metadata.type) ?? 0) + 1);
        for (const topic of t.metadata.topics) {
          topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
        }
        for (const person of t.metadata.people) {
          peopleCounts.set(person, (peopleCounts.get(person) ?? 0) + 1);
        }
      }

      const stats = {
        totalThoughts: thoughts.length,
        byType: [...typeCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
        topTopics: [...topicCounts.entries()].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 10),
        topPeople: [...peopleCounts.entries()].map(([person, count]) => ({ person, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      };

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(stats, null, 2),
        }],
      };
    }
  );

  server.tool(
    "capture_thought",
    "Save a new thought to your brain",
    {
      content: z.string().describe("The thought content to save"),
    },
    async ({ content }) => {
      const result = await convex.action(
        internal.models.thoughts.actions.captureThought,
        { userId: userId as any, content }
      );

      return {
        content: [{
          type: "text" as const,
          text: `Thought captured successfully.\n\nType: ${result.metadata.type}\nTopics: ${result.metadata.topics.join(", ") || "none"}\nPeople: ${result.metadata.people.join(", ") || "none"}\nSummary: ${result.metadata.summary}`,
        }],
      };
    }
  );

  return server;
}
```

**Step 3: Create the API route**

```typescript
// apps/web/src/app/api/mcp/route.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import { createMcpServer } from "@/lib/mcp/server";
import { authenticateApiKey } from "@/lib/mcp/auth";

export async function POST(req: Request) {
  // Authenticate
  const auth = await authenticateApiKey(req.headers.get("authorization"));
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create fresh MCP server per request (stateless)
  const server = createMcpServer(auth.userId);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  // Bridge Fetch Request to Node.js req/res for the SDK
  const { req: nodeReq, res: nodeRes } = toReqRes(req);
  const body = await req.json();
  await transport.handleRequest(nodeReq, nodeRes, body);

  return toFetchResponse(nodeRes);
}

export async function GET() {
  return new Response(null, { status: 405 });
}

export async function DELETE() {
  return new Response(null, { status: 405 });
}
```

Note: `fetch-to-node` bridges Fetch API to Node.js types. If this package doesn't exist or doesn't work, the alternative is to manually construct the Node.js request/response or find an equivalent bridge. Verify during implementation.

**Step 4: Install MCP SDK and dependencies**

```bash
cd apps/web && pnpm add @modelcontextprotocol/sdk zod
```

**Step 5: Test with curl**

```bash
# Test initialization
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ob_<your-key>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

Expected: JSON-RPC response with server capabilities.

**Step 6: Test with Claude Code**

```bash
claude mcp add --transport http open-brain http://localhost:3000/api/mcp --header "Authorization: Bearer ob_<your-key>"
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add MCP endpoint with 4 tools"
```

---

### Task 7: Web UI — Auth Pages

**Files:**
- Create: `apps/web/src/app/sign-in/page.tsx`
- Create: `apps/web/src/app/sign-up/page.tsx`

**Step 1: Create sign-in page**

Client component using `useAuthActions` from `@convex-dev/auth/react`. Password sign-in form with email + password fields. Link to sign-up.

**Step 2: Create sign-up page**

Same form with `flow: "signUp"`. Link to sign-in.

**Step 3: Verify auth flow works**

Start dev server, navigate to `/`, get redirected to `/sign-in`, create account, get redirected to `/`.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add sign-in and sign-up pages"
```

---

### Task 8: Web UI — Dashboard Page

Use @superpowers:subframe:design for UI design, then @superpowers:subframe:develop for implementation.

**Files:**
- Create: `apps/web/src/app/(authenticated)/page.tsx`
- Create: `apps/web/src/app/(authenticated)/layout.tsx`
- Create: `apps/web/src/features/thoughts/components/ThoughtCard.tsx`
- Create: `apps/web/src/features/thoughts/components/QuickCapture.tsx`

**Step 1: Create authenticated layout**

Layout that checks auth (via `Authenticated`/`Unauthenticated` from `convex/react`) and shows a nav bar with links to Dashboard, Search, Browse, Settings, and a sign-out button.

**Step 2: Create dashboard page**

- Shows total thought count (from `getStats` query)
- Quick capture form (calls `captureThought` action)
- List of 10 most recent thoughts (from `listRecent` query)

**Step 3: Create ThoughtCard component**

Displays a single thought: content, type badge, topics as tags, people mentioned, timestamp.

**Step 4: Create QuickCapture component**

Text area + submit button. Calls the `captureThought` action via a mutation. Shows loading state while embedding/metadata runs.

**Step 5: Verify end-to-end**

Sign in, capture a thought, see it appear in the recent list.

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add dashboard with quick capture and recent thoughts"
```

---

### Task 9: Web UI — Search Page

**Files:**
- Create: `apps/web/src/app/(authenticated)/search/page.tsx`
- Create: `apps/web/src/features/thoughts/components/SearchResults.tsx`

**Step 1: Create search page**

Search input field. On submit, calls `searchByVector` action. Displays results ranked by similarity score using `ThoughtCard` with score badge.

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add semantic search page"
```

---

### Task 10: Web UI — Browse Page

**Files:**
- Create: `apps/web/src/app/(authenticated)/browse/page.tsx`

**Step 1: Create browse page**

Paginated list of all thoughts using `listRecent` query. Type filter dropdown. Sorted by newest first. Uses `ThoughtCard` component.

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add browse page with type filter"
```

---

### Task 11: Web UI — Settings Page

**Files:**
- Create: `apps/web/src/app/(authenticated)/settings/page.tsx`
- Create: `apps/web/src/features/api-keys/components/ApiKeyList.tsx`
- Create: `apps/web/src/features/api-keys/components/CreateApiKeyDialog.tsx`

**Step 1: Create settings page**

- "Generate API Key" button opens dialog
- Dialog: name input → submit → shows raw key ONCE with copy button and warning
- List of existing keys: name, prefix, last used date, revoke button
- Connection instructions section: how to connect Claude Desktop, Claude Code, ChatGPT

**Step 2: Commit**

```bash
git add -A && git commit -m "feat: add settings page with API key management"
```

---

### Task 12: Smoke Test & Polish

**Step 1: End-to-end smoke test**

1. Sign up via web UI
2. Create an API key in settings
3. Connect Claude Code: `claude mcp add --transport http open-brain http://localhost:3000/api/mcp --header "Authorization: Bearer ob_xxxxx"`
4. In Claude Code: "Save this thought: I'm testing Open Brain for the first time"
5. In Claude Code: "Search my thoughts for testing"
6. In web UI: verify the thought appears on dashboard and search

**Step 2: Fix any issues found during smoke test**

**Step 3: Final commit**

```bash
git add -A && git commit -m "feat: complete open brain MVP"
```

---

## Dependency Order

```
Task 1 (scaffold) → Task 2 (convex) → Task 3 (thoughts model) → Task 4 (api keys model)
                                                                          ↓
Task 5 (next.js app) ──────────────────────────────→ Task 6 (MCP endpoint)
         ↓
Task 7 (auth pages) → Task 8 (dashboard) → Task 9 (search) → Task 10 (browse) → Task 11 (settings)
                                                                                          ↓
                                                                                  Task 12 (smoke test)
```

Tasks 3-4 and Task 5 can proceed in parallel once Task 2 is done.
Tasks 6 depends on Tasks 3, 4, and 5.
Tasks 7-11 depend on Task 5.
Task 12 depends on everything.

---

## Environment Variables Needed

**Convex (set via `npx convex env set`):**
- `OPENAI_API_KEY` — for text-embedding-3-small
- `ANTHROPIC_API_KEY` — for Claude Haiku metadata extraction
- `JWT_PRIVATE_KEY` — generated by `npx @convex-dev/auth`
- `JWKS` — generated by `npx @convex-dev/auth`
- `SITE_URL` — `http://localhost:3000` (dev), production URL later

**Next.js (`apps/web/.env.local`):**
- `NEXT_PUBLIC_CONVEX_URL` — from Convex dashboard
- `CONVEX_DEPLOYMENT` — for admin access to internal functions from API routes
