# Workflow Insights UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add structured workflow reports and insights to the AI Brain app with feedback controls and MCP tools, replacing the current unstructured thought-based storage.

**Architecture:** Two new Convex tables (`reports`, `insights`) with a model layer following the existing thoughts pattern (validators → model → private → public → mcpQueries/mcpActions). Two new MCP tools (`create_report`, `get_insights`). A new `/insights` page with Latest Report and Unresolved tabs, insight cards with status controls (Noted/Done/Dismissed), and dismiss-with-tag feedback.

**Tech Stack:** Convex (schema, queries, mutations, actions), Next.js 15 (React 19, inline styles), MCP SDK (zod schemas), TypeScript

---

### Task 1: Define validators for reports and insights

**Files:**
- Create: `packages/convex/convex/models/reports/validators.ts`

**Step 1: Create the validators file**

Follow the pattern in `packages/convex/convex/models/thoughts/validators.ts`. Define validators for both tables.

```typescript
import { v } from "convex/values";

export const insightCategory = v.union(
  v.literal("feature-discovery"),
  v.literal("anti-pattern"),
  v.literal("productivity"),
  v.literal("automation"),
);

export const insightStatus = v.union(
  v.literal("new"),
  v.literal("noted"),
  v.literal("done"),
  v.literal("dismissed"),
);

export const dismissTag = v.union(
  v.literal("already-fixed"),
  v.literal("not-relevant"),
  v.literal("already-knew"),
  v.literal("incorrect"),
);

export const projectActive = v.object({
  path: v.string(),
  sessions: v.number(),
});

export const reportFields = {
  userId: v.id("users"),
  startDate: v.string(),
  endDate: v.string(),
  sessionsAnalyzed: v.number(),
  totalPrompts: v.number(),
  totalToolCalls: v.number(),
  projectsActive: v.array(projectActive),
  modelUsage: v.any(),
};

export const insightFields = {
  reportId: v.id("reports"),
  userId: v.id("users"),
  category: insightCategory,
  observation: v.string(),
  recommendation: v.string(),
  evidence: v.string(),
  status: insightStatus,
  dismissTag: v.optional(dismissTag),
  dismissText: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
};
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors related to the new validators file.

**Step 3: Commit**

```bash
git add packages/convex/convex/models/reports/validators.ts
git commit -m "feat: add report and insight validators"
```

---

### Task 2: Add reports and insights tables to schema

**Files:**
- Modify: `packages/convex/convex/schema.ts`

**Step 1: Update schema to include new tables**

Add imports for the new validators and define the two tables with indexes.

```typescript
import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { thoughtFields } from "./models/thoughts/validators";
import { apiKeyFields } from "./models/apiKeys/validators";
import { reportFields, insightFields } from "./models/reports/validators";

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
  reports: defineTable(reportFields)
    .index("by_userId", ["userId"]),
  insights: defineTable(insightFields)
    .index("by_reportId", ["reportId"])
    .index("by_userId_and_status", ["userId", "status"]),
});
```

**Step 2: Verify TypeScript compiles and Convex accepts the schema**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors.

**Step 3: Push schema to Convex dev**

Run: `cd /Users/peterbrown/Development/ai-brain && npx convex dev --once`
Expected: Schema pushed successfully, new tables created.

**Step 4: Commit**

```bash
git add packages/convex/convex/schema.ts
git commit -m "feat: add reports and insights tables to schema"
```

---

### Task 3: Create model layer for reports and insights

**Files:**
- Create: `packages/convex/convex/models/reports/model.ts`

**Step 1: Create the model file**

Follow the pattern in `packages/convex/convex/models/thoughts/model.ts`. Define low-level database operations.

```typescript
import { QueryCtx, MutationCtx } from "../../_generated/server";
import { Id } from "../../_generated/dataModel";

export async function _findReportById(ctx: QueryCtx, id: Id<"reports">) {
  return await ctx.db.get(id);
}

export async function _listReportsByUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  limit: number = 20,
) {
  return await ctx.db
    .query("reports")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .order("desc")
    .take(limit);
}

export async function _insertReport(
  ctx: MutationCtx,
  fields: {
    userId: Id<"users">;
    startDate: string;
    endDate: string;
    sessionsAnalyzed: number;
    totalPrompts: number;
    totalToolCalls: number;
    projectsActive: Array<{ path: string; sessions: number }>;
    modelUsage: Record<string, number>;
  },
) {
  return await ctx.db.insert("reports", fields);
}

export async function _findInsightById(ctx: QueryCtx, id: Id<"insights">) {
  return await ctx.db.get(id);
}

export async function _listInsightsByReport(
  ctx: QueryCtx,
  reportId: Id<"reports">,
) {
  return await ctx.db
    .query("insights")
    .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
    .collect();
}

export async function _listInsightsByUserAndStatus(
  ctx: QueryCtx,
  userId: Id<"users">,
  status: "new" | "noted" | "done" | "dismissed",
  limit: number = 50,
) {
  return await ctx.db
    .query("insights")
    .withIndex("by_userId_and_status", (q) =>
      q.eq("userId", userId).eq("status", status),
    )
    .order("desc")
    .take(limit);
}

export async function _insertInsight(
  ctx: MutationCtx,
  fields: {
    reportId: Id<"reports">;
    userId: Id<"users">;
    category: "feature-discovery" | "anti-pattern" | "productivity" | "automation";
    observation: string;
    recommendation: string;
    evidence: string;
    status: "new";
    dismissTag?: undefined;
    dismissText?: undefined;
    updatedAt?: undefined;
  },
) {
  return await ctx.db.insert("insights", fields);
}

export async function _updateInsightStatus(
  ctx: MutationCtx,
  id: Id<"insights">,
  fields: {
    status: "noted" | "done" | "dismissed";
    dismissTag?: "already-fixed" | "not-relevant" | "already-knew" | "incorrect";
    dismissText?: string;
    updatedAt: number;
  },
) {
  return await ctx.db.patch(id, fields);
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors.

**Step 3: Commit**

```bash
git add packages/convex/convex/models/reports/model.ts
git commit -m "feat: add report and insight model layer"
```

---

### Task 4: Create private (internal) mutations and queries

**Files:**
- Create: `packages/convex/convex/models/reports/private.ts`

**Step 1: Create the private file**

Follow the pattern in `packages/convex/convex/models/thoughts/private.ts`.

```typescript
import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import {
  insightCategory,
  insightStatus,
  dismissTag,
  projectActive,
  insightFields,
  reportFields,
} from "./validators";
import {
  _findReportById,
  _listReportsByUser,
  _insertReport,
  _findInsightById,
  _listInsightsByReport,
  _listInsightsByUserAndStatus,
  _insertInsight,
  _updateInsightStatus,
} from "./model";

export const insertReport = internalMutation({
  args: {
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    sessionsAnalyzed: v.number(),
    totalPrompts: v.number(),
    totalToolCalls: v.number(),
    projectsActive: v.array(projectActive),
    modelUsage: v.any(),
  },
  returns: v.id("reports"),
  handler: async (ctx, args) => {
    return await _insertReport(ctx, args);
  },
});

export const insertInsight = internalMutation({
  args: {
    reportId: v.id("reports"),
    userId: v.id("users"),
    category: insightCategory,
    observation: v.string(),
    recommendation: v.string(),
    evidence: v.string(),
  },
  returns: v.id("insights"),
  handler: async (ctx, args) => {
    return await _insertInsight(ctx, {
      ...args,
      status: "new",
      dismissTag: undefined,
      dismissText: undefined,
      updatedAt: undefined,
    });
  },
});

export const getReportById = internalQuery({
  args: { id: v.id("reports") },
  returns: v.union(
    v.object({
      _id: v.id("reports"),
      _creationTime: v.number(),
      ...reportFields,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await _findReportById(ctx, args.id);
  },
});
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors.

**Step 3: Commit**

```bash
git add packages/convex/convex/models/reports/private.ts
git commit -m "feat: add report and insight internal mutations/queries"
```

---

### Task 5: Create public queries and mutations (for web UI)

**Files:**
- Create: `packages/convex/convex/models/reports/public.ts`

**Step 1: Create the public file**

Follow the auth pattern from `packages/convex/convex/models/thoughts/public.ts` — use `getAuthUserId()` for authentication.

```typescript
import { query, mutation, action } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  insightCategory,
  insightStatus,
  insightFields,
  reportFields,
  dismissTag,
  projectActive,
} from "./validators";
import {
  _listReportsByUser,
  _listInsightsByReport,
  _listInsightsByUserAndStatus,
  _findInsightById,
  _updateInsightStatus,
} from "./model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

export const listReports = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("reports"),
      _creationTime: v.number(),
      userId: v.id("users"),
      startDate: v.string(),
      endDate: v.string(),
      sessionsAnalyzed: v.number(),
      totalPrompts: v.number(),
      totalToolCalls: v.number(),
      projectsActive: v.array(projectActive),
      modelUsage: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await _listReportsByUser(ctx, userId, args.limit ?? 20);
  },
});

export const getLatestReport = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("reports"),
      _creationTime: v.number(),
      userId: v.id("users"),
      startDate: v.string(),
      endDate: v.string(),
      sessionsAnalyzed: v.number(),
      totalPrompts: v.number(),
      totalToolCalls: v.number(),
      projectsActive: v.array(projectActive),
      modelUsage: v.any(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const reports = await _listReportsByUser(ctx, userId, 1);
    return reports[0] ?? null;
  },
});

export const listInsightsByReport = query({
  args: {
    reportId: v.id("reports"),
  },
  returns: v.array(
    v.object({
      _id: v.id("insights"),
      _creationTime: v.number(),
      reportId: v.id("reports"),
      userId: v.id("users"),
      category: insightCategory,
      observation: v.string(),
      recommendation: v.string(),
      evidence: v.string(),
      status: insightStatus,
      dismissTag: v.optional(dismissTag),
      dismissText: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await _listInsightsByReport(ctx, args.reportId);
  },
});

export const listUnresolvedInsights = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("insights"),
      _creationTime: v.number(),
      reportId: v.id("reports"),
      userId: v.id("users"),
      category: insightCategory,
      observation: v.string(),
      recommendation: v.string(),
      evidence: v.string(),
      status: insightStatus,
      dismissTag: v.optional(dismissTag),
      dismissText: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const newInsights = await _listInsightsByUserAndStatus(ctx, userId, "new");
    const notedInsights = await _listInsightsByUserAndStatus(ctx, userId, "noted");
    return [...newInsights, ...notedInsights].sort(
      (a, b) => b._creationTime - a._creationTime,
    );
  },
});

export const updateInsightStatus = mutation({
  args: {
    insightId: v.id("insights"),
    status: v.union(v.literal("noted"), v.literal("done"), v.literal("dismissed")),
    dismissTag: v.optional(dismissTag),
    dismissText: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const insight = await _findInsightById(ctx, args.insightId);
    if (!insight || insight.userId !== userId) {
      throw new Error("Insight not found");
    }

    await _updateInsightStatus(ctx, args.insightId, {
      status: args.status,
      dismissTag: args.dismissTag,
      dismissText: args.dismissText,
      updatedAt: Date.now(),
    });

    // If dismiss text is provided, save it as a user preference thought
    if (args.dismissText) {
      await ctx.scheduler.runAfter(
        0,
        internal.models.thoughts.actions.captureThought,
        {
          userId,
          content: `[User Preference] User dismissed workflow insight about ${insight.category}. Reason: '${args.dismissText}'. Consider excluding similar recommendations from future workflow reports.`,
        },
      );
    }

    return null;
  },
});
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors.

**Step 3: Commit**

```bash
git add packages/convex/convex/models/reports/public.ts
git commit -m "feat: add public report queries and insight status mutation"
```

---

### Task 6: Create MCP queries and actions

**Files:**
- Create: `packages/convex/convex/models/reports/mcpQueries.ts`
- Create: `packages/convex/convex/models/reports/mcpActions.ts`

**Step 1: Create mcpQueries.ts**

Follow the pattern in `packages/convex/convex/models/thoughts/mcpQueries.ts` — accept `userId` as a parameter.

```typescript
import { query } from "../../_generated/server";
import { v } from "convex/values";
import {
  insightCategory,
  insightStatus,
  dismissTag,
  projectActive,
} from "./validators";
import {
  _listInsightsByUserAndStatus,
} from "./model";

export const listInsights = query({
  args: {
    userId: v.id("users"),
    status: v.optional(insightStatus),
    category: v.optional(insightCategory),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("insights"),
      _creationTime: v.number(),
      reportId: v.id("reports"),
      userId: v.id("users"),
      category: insightCategory,
      observation: v.string(),
      recommendation: v.string(),
      evidence: v.string(),
      status: insightStatus,
      dismissTag: v.optional(dismissTag),
      dismissText: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.status) {
      const results = await _listInsightsByUserAndStatus(
        ctx,
        args.userId,
        args.status as "new" | "noted" | "done" | "dismissed",
        limit,
      );
      if (args.category) {
        return results.filter((r) => r.category === args.category);
      }
      return results;
    }

    // No status filter — get all insights for user
    const allStatuses = ["new", "noted", "done", "dismissed"] as const;
    const allResults = await Promise.all(
      allStatuses.map((s) =>
        _listInsightsByUserAndStatus(ctx, args.userId, s, limit),
      ),
    );
    let combined = allResults.flat().sort((a, b) => b._creationTime - a._creationTime).slice(0, limit);
    if (args.category) {
      combined = combined.filter((r) => r.category === args.category);
    }
    return combined;
  },
});
```

**Step 2: Create mcpActions.ts**

Follow the pattern in `packages/convex/convex/models/thoughts/mcpActions.ts`.

```typescript
"use node";

import { action } from "../../_generated/server";
import { internal as _internal } from "../../_generated/api";
import { v } from "convex/values";
import { insightCategory, projectActive } from "./validators";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const internal = _internal as any;

export const createReport = action({
  args: {
    userId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    sessionsAnalyzed: v.number(),
    totalPrompts: v.number(),
    totalToolCalls: v.number(),
    projectsActive: v.array(projectActive),
    modelUsage: v.any(),
    insights: v.array(
      v.object({
        category: insightCategory,
        observation: v.string(),
        recommendation: v.string(),
        evidence: v.string(),
      }),
    ),
  },
  returns: v.object({
    reportId: v.id("reports"),
    insightIds: v.array(v.id("insights")),
  }),
  handler: async (ctx, args) => {
    const { insights, ...reportData } = args;

    const reportId = await ctx.runMutation(
      internal.models.reports.private.insertReport,
      reportData,
    );

    const insightIds = await Promise.all(
      insights.map((insight) =>
        ctx.runMutation(internal.models.reports.private.insertInsight, {
          reportId,
          userId: args.userId,
          ...insight,
        }),
      ),
    );

    return { reportId, insightIds };
  },
});
```

**Step 3: Verify TypeScript compiles**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors.

**Step 4: Commit**

```bash
git add packages/convex/convex/models/reports/mcpQueries.ts packages/convex/convex/models/reports/mcpActions.ts
git commit -m "feat: add MCP queries and actions for reports"
```

---

### Task 7: Register MCP tools in the server

**Files:**
- Modify: `apps/web/src/lib/mcp/server.ts`

**Step 1: Add `create_report` and `get_insights` tools**

Add two new `server.tool()` registrations after the existing `capture_thought` tool in `apps/web/src/lib/mcp/server.ts`. The tools call the new MCP actions/queries.

```typescript
  // Add after the capture_thought tool registration (after line 213):

  server.tool(
    "create_report",
    "Create a workflow analysis report with structured insights",
    {
      startDate: z.string().describe("Report period start date (ISO format, e.g. 2026-03-01)"),
      endDate: z.string().describe("Report period end date (ISO format, e.g. 2026-03-07)"),
      sessionsAnalyzed: z.number().describe("Number of sessions analyzed"),
      totalPrompts: z.number().describe("Total user prompts in period"),
      totalToolCalls: z.number().describe("Total tool calls in period"),
      projectsActive: z.array(z.object({
        path: z.string(),
        sessions: z.number(),
      })).describe("Projects with session counts"),
      modelUsage: z.record(z.string(), z.number()).describe("Model usage counts"),
      insights: z.array(z.object({
        category: z.enum(["feature-discovery", "anti-pattern", "productivity", "automation"]),
        observation: z.string().describe("What the data shows"),
        recommendation: z.string().describe("Specific actionable advice"),
        evidence: z.string().describe("Numbers/data supporting the observation"),
      })).describe("Array of structured insights"),
    },
    async (args) => {
      type CreateReportResult = {
        reportId: string;
        insightIds: string[];
      };
      const result: CreateReportResult = await convex.action(
        api.models.reports.mcpActions.createReport,
        {
          userId: userId as never,
          ...args,
        },
      );

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "Report created successfully.",
              "",
              `Report ID: ${result.reportId}`,
              `Insights created: ${result.insightIds.length}`,
              `Period: ${args.startDate} to ${args.endDate}`,
            ].join("\n"),
          },
        ],
      };
    },
  );

  server.tool(
    "get_insights",
    "Get workflow insights, optionally filtered by status or category",
    {
      status: z.enum(["new", "noted", "done", "dismissed"]).optional().describe("Filter by insight status"),
      category: z.enum(["feature-discovery", "anti-pattern", "productivity", "automation"]).optional().describe("Filter by insight category"),
      limit: z.number().min(1).max(100).default(50).describe("Max results to return"),
    },
    async ({ status, category, limit }) => {
      type Insight = {
        _id: string;
        _creationTime: number;
        reportId: string;
        category: string;
        observation: string;
        recommendation: string;
        evidence: string;
        status: string;
        dismissTag?: string;
        dismissText?: string;
      };
      const results: Insight[] = await convex.query(
        api.models.reports.mcpQueries.listInsights,
        {
          userId: userId as never,
          status,
          category,
          limit,
        },
      );

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No insights found matching the criteria.",
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
                category: r.category,
                observation: r.observation,
                recommendation: r.recommendation,
                evidence: r.evidence,
                status: r.status,
                dismissTag: r.dismissTag,
                dismissText: r.dismissText,
                createdAt: new Date(r._creationTime).toISOString(),
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/web/src/lib/mcp/server.ts
git commit -m "feat: register create_report and get_insights MCP tools"
```

---

### Task 8: Create InsightCard component

**Files:**
- Create: `apps/web/src/features/insights/components/InsightCard.tsx`

**Step 1: Create the InsightCard component**

Follow the styling pattern from `apps/web/src/features/thoughts/components/ThoughtCard.tsx` — inline styles, no CSS framework. The card shows category badge, observation, recommendation, evidence (collapsible), and status controls.

```typescript
"use client";

import { useMutation } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import type { Id } from "@repo/db/convex/_generated/dataModel";

const categoryColors: Record<string, string> = {
  "anti-pattern": "#ffebee",
  "feature-discovery": "#e3f2fd",
  productivity: "#e8f5e9",
  automation: "#f3e5f5",
};

const categoryTextColors: Record<string, string> = {
  "anti-pattern": "#c62828",
  "feature-discovery": "#1565c0",
  productivity: "#2e7d32",
  automation: "#6a1b9a",
};

const DISMISS_TAGS = [
  { value: "already-fixed", label: "Already fixed" },
  { value: "not-relevant", label: "Not relevant" },
  { value: "already-knew", label: "Already knew" },
  { value: "incorrect", label: "Incorrect" },
] as const;

interface InsightCardProps {
  insight: {
    _id: Id<"insights">;
    _creationTime: number;
    category: string;
    observation: string;
    recommendation: string;
    evidence: string;
    status: string;
    dismissTag?: string;
    dismissText?: string;
  };
}

export function InsightCard({ insight }: InsightCardProps) {
  const updateStatus = useMutation(api.models.reports.public.updateInsightStatus);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showDismiss, setShowDismiss] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [dismissText, setDismissText] = useState("");
  const [saved, setSaved] = useState(false);

  const isResolved = insight.status === "done" || insight.status === "dismissed";

  const handleStatus = async (status: "noted" | "done") => {
    await updateStatus({ insightId: insight._id, status });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleDismiss = async () => {
    if (!selectedTag) return;
    await updateStatus({
      insightId: insight._id,
      status: "dismissed",
      dismissTag: selectedTag as "already-fixed" | "not-relevant" | "already-knew" | "incorrect",
      dismissText: dismissText || undefined,
    });
    setShowDismiss(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleUndo = async () => {
    await updateStatus({ insightId: insight._id, status: "noted" });
  };

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
        backgroundColor: "#fff",
        opacity: isResolved ? 0.6 : 1,
      }}
    >
      {/* Header: category badge + status label */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 8,
          alignItems: "center",
        }}
      >
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 12,
            backgroundColor: categoryColors[insight.category] ?? "#f5f5f5",
            color: categoryTextColors[insight.category] ?? "#333",
            fontWeight: 500,
          }}
        >
          {insight.category}
        </span>
        {isResolved && (
          <span style={{ fontSize: 12, color: "#999" }}>
            {insight.status}
            {insight.dismissTag && ` — ${insight.dismissTag.replace("-", " ")}`}
          </span>
        )}
        {saved && (
          <span style={{ fontSize: 12, color: "#4caf50" }}>Saved</span>
        )}
      </div>

      {/* Observation */}
      <p style={{ margin: "0 0 8px", fontWeight: 500, lineHeight: 1.4 }}>
        {insight.observation}
      </p>

      {/* Recommendation */}
      <p style={{ margin: "0 0 8px", lineHeight: 1.5, color: "#333" }}>
        {insight.recommendation}
      </p>

      {/* Evidence (collapsible) */}
      <button
        onClick={() => setShowEvidence(!showEvidence)}
        style={{
          background: "none",
          border: "none",
          color: "#666",
          cursor: "pointer",
          fontSize: 13,
          padding: 0,
          marginBottom: showEvidence ? 8 : 0,
        }}
      >
        {showEvidence ? "Hide evidence" : "Show evidence"}
      </button>
      {showEvidence && (
        <p style={{ margin: 0, fontSize: 13, color: "#666", lineHeight: 1.4 }}>
          {insight.evidence}
        </p>
      )}

      {/* Status controls */}
      {!isResolved && (
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button
            onClick={() => handleStatus("noted")}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ddd",
              background: insight.status === "noted" ? "#e3f2fd" : "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Noted
          </button>
          <button
            onClick={() => handleStatus("done")}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Done
          </button>
          <button
            onClick={() => setShowDismiss(!showDismiss)}
            style={{
              padding: "4px 12px",
              borderRadius: 4,
              border: "1px solid #ddd",
              background: showDismiss ? "#ffebee" : "#fff",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Undo for resolved insights */}
      {isResolved && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={handleUndo}
            style={{
              background: "none",
              border: "none",
              color: "#1565c0",
              cursor: "pointer",
              fontSize: 13,
              padding: 0,
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* Dismiss panel */}
      {showDismiss && (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            backgroundColor: "#fafafa",
            borderRadius: 4,
            border: "1px solid #eee",
          }}
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {DISMISS_TAGS.map((tag) => (
              <button
                key={tag.value}
                onClick={() => setSelectedTag(tag.value)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 16,
                  border: selectedTag === tag.value ? "2px solid #c62828" : "1px solid #ddd",
                  background: selectedTag === tag.value ? "#ffebee" : "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {tag.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={dismissText}
            onChange={(e) => setDismissText(e.target.value)}
            placeholder="Why? (optional, saved to your brain)"
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 4,
              border: "1px solid #ddd",
              fontSize: 13,
              marginBottom: 8,
              boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleDismiss}
            disabled={!selectedTag}
            style={{
              padding: "6px 16px",
              borderRadius: 4,
              border: "none",
              background: selectedTag ? "#c62828" : "#ccc",
              color: "#fff",
              cursor: selectedTag ? "pointer" : "default",
              fontSize: 13,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/web/src/features/insights/components/InsightCard.tsx
git commit -m "feat: add InsightCard component with status controls"
```

---

### Task 9: Create the /insights page

**Files:**
- Create: `apps/web/src/app/(authenticated)/insights/page.tsx`

**Step 1: Create the insights page**

Follow the pattern from `apps/web/src/app/(authenticated)/browse/page.tsx`. Two tabs: Latest Report and Unresolved.

```typescript
"use client";

import { useQuery } from "convex/react";
import { api } from "@repo/db/convex/_generated/api";
import { useState } from "react";
import { InsightCard } from "@/features/insights/components/InsightCard";

type Tab = "latest" | "unresolved";

export default function InsightsPage() {
  const [tab, setTab] = useState<Tab>("latest");

  const latestReport = useQuery(api.models.reports.public.getLatestReport);
  const reportInsights = useQuery(
    api.models.reports.public.listInsightsByReport,
    latestReport ? { reportId: latestReport._id } : "skip",
  );
  const unresolvedInsights = useQuery(
    api.models.reports.public.listUnresolvedInsights,
  );
  const allReports = useQuery(api.models.reports.public.listReports);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div>
      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          marginBottom: 24,
          borderBottom: "1px solid #eee",
        }}
      >
        <button
          onClick={() => setTab("latest")}
          style={{
            padding: "8px 20px",
            border: "none",
            borderBottom: tab === "latest" ? "2px solid #333" : "2px solid transparent",
            background: "none",
            cursor: "pointer",
            fontWeight: tab === "latest" ? 600 : 400,
            fontSize: 15,
          }}
        >
          Latest Report
        </button>
        <button
          onClick={() => setTab("unresolved")}
          style={{
            padding: "8px 20px",
            border: "none",
            borderBottom: tab === "unresolved" ? "2px solid #333" : "2px solid transparent",
            background: "none",
            cursor: "pointer",
            fontWeight: tab === "unresolved" ? 600 : 400,
            fontSize: 15,
          }}
        >
          Unresolved
          {unresolvedInsights && unresolvedInsights.length > 0 && (
            <span
              style={{
                marginLeft: 6,
                padding: "1px 6px",
                borderRadius: 10,
                backgroundColor: "#e3f2fd",
                fontSize: 12,
              }}
            >
              {unresolvedInsights.length}
            </span>
          )}
        </button>
      </div>

      {/* Latest Report Tab */}
      {tab === "latest" && (
        <div>
          {latestReport === undefined ? (
            <p>Loading...</p>
          ) : latestReport === null ? (
            <p style={{ color: "#666" }}>
              No reports yet. Run <code>/workflow-analyst</code> in Claude Code to generate your first report.
            </p>
          ) : (
            <>
              {/* Summary strip */}
              <div
                style={{
                  padding: 12,
                  backgroundColor: "#fafafa",
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 14,
                  color: "#555",
                  display: "flex",
                  gap: 24,
                  flexWrap: "wrap",
                }}
              >
                <span>
                  <strong>Period:</strong> {formatDate(latestReport.startDate)} — {formatDate(latestReport.endDate)}
                </span>
                <span>
                  <strong>Sessions:</strong> {latestReport.sessionsAnalyzed}
                </span>
                <span>
                  <strong>Prompts:</strong> {latestReport.totalPrompts}
                </span>
                <span>
                  <strong>Tool calls:</strong> {latestReport.totalToolCalls}
                </span>
                <span>
                  <strong>Projects:</strong> {latestReport.projectsActive.length}
                </span>
              </div>

              {/* Insights */}
              {reportInsights === undefined ? (
                <p>Loading insights...</p>
              ) : reportInsights.length === 0 ? (
                <p style={{ color: "#666" }}>No insights in this report.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {reportInsights.map((insight) => (
                    <InsightCard key={insight._id} insight={insight} />
                  ))}
                </div>
              )}

              {/* Report history link */}
              {allReports && allReports.length > 1 && (
                <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #eee" }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Previous Reports</h3>
                  {allReports.slice(1).map((report) => (
                    <div
                      key={report._id}
                      style={{
                        padding: 8,
                        fontSize: 14,
                        color: "#555",
                        borderBottom: "1px solid #f5f5f5",
                      }}
                    >
                      {formatDate(report.startDate)} — {formatDate(report.endDate)}
                      {" · "}
                      {report.sessionsAnalyzed} sessions
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Unresolved Tab */}
      {tab === "unresolved" && (
        <div>
          {unresolvedInsights === undefined ? (
            <p>Loading...</p>
          ) : unresolvedInsights.length === 0 ? (
            <p style={{ color: "#666" }}>All caught up! No unresolved insights.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {unresolvedInsights.map((insight) => (
                <InsightCard key={insight._id} insight={insight} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/insights/page.tsx
git commit -m "feat: add /insights page with latest report and unresolved tabs"
```

---

### Task 10: Add Insights to navigation

**Files:**
- Modify: `apps/web/src/app/(authenticated)/layout.tsx`

**Step 1: Add the Insights nav link**

Add `<Link href="/insights">Insights</Link>` after the Dashboard link in the `Nav` component at `apps/web/src/app/(authenticated)/layout.tsx:22`.

```typescript
      <Link href="/">Dashboard</Link>
      <Link href="/insights">Insights</Link>
      <Link href="/search">Search</Link>
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm check-types`
Expected: No errors.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/layout.tsx
git commit -m "feat: add Insights link to navigation"
```

---

### Task 11: Update Workflow Analyst skill to use new MCP tools

**Files:**
- Modify: `~/.claude/skills/workflow-analyst/SKILL.md`

**Step 1: Update Step 3 (Check Previous Insights)**

In the skill file, replace the Step 3 instructions that use `search_thoughts` with instructions to use the new `get_insights` MCP tool.

Replace the Step 3 section with:

```markdown
### Step 3: Check Previous Insights

Use the `get_insights` MCP tool to check for existing insights:

1. Call `get_insights` with `status: "new"` — find unresolved insights to avoid repeating
2. Call `get_insights` with `status: "noted"` — find acknowledged but not-yet-acted-on insights
3. Call `get_insights` with `status: "dismissed"` — find what the user doesn't want to see again

Also search the AI Brain for `[User Preference]` thoughts using `search_thoughts` with query: "User Preference workflow" to understand the user's environment and exclusions.

Note which insights are still open and which categories have been frequently dismissed so you don't repeat them.

If the MCP tools are unavailable, fall back to `search_thoughts` with query: "workflow insight claude code".
```

**Step 2: Update Step 5 (Publish)**

Replace the Step 5 instructions that use `capture_thought` with instructions to use `create_report`.

Replace the Step 5 section with:

```markdown
### Step 5: Publish to AI Brain

Call the `create_report` MCP tool with:

- Report metadata: startDate, endDate, sessionsAnalyzed, totalPrompts, totalToolCalls, projectsActive, modelUsage
- Array of insights, each with: category, observation, recommendation, evidence

If the `create_report` MCP tool is unavailable, fall back to saving individual insights via `capture_thought`.
```

**Step 3: Update Step 6 (Write Weekly Report)**

Remove or mark as optional the markdown file write. The AI Brain app is now the source of truth.

Add a note:

```markdown
### Step 6: Write Local Report (Optional)

If desired, still write the markdown report to `~/.claude/workflow-reports/` as a local backup. This step is optional now that reports are stored in AI Brain.
```

**Step 4: Update Step 7 (Summary)**

Update to reference the Insights page:

```markdown
### Step 7: Summary

After publishing, output a brief summary to the user:
- How many insights were generated
- The report period
- Direct them to the /insights page in the AI Brain web UI to review and provide feedback
```

**Step 5: Commit**

```bash
git add ~/.claude/skills/workflow-analyst/SKILL.md
git commit -m "feat: update workflow analyst skill to use create_report and get_insights MCP tools"
```

---

### Task 12: End-to-end verification

**Step 1: Start the dev server**

Run: `cd /Users/peterbrown/Development/ai-brain && pnpm dev`
Expected: Next.js and Convex dev servers start without errors.

**Step 2: Verify the /insights page loads**

Navigate to `http://localhost:3000/insights` in the browser.
Expected: Page loads with "No reports yet" message and the two tabs.

**Step 3: Verify MCP tools are registered**

Check that the MCP endpoint responds with the new tools. Use the browser or curl to verify the MCP server lists `create_report` and `get_insights` alongside the existing 4 tools.

**Step 4: Test the full flow**

Run `/workflow-analyst` in Claude Code (which should now call `create_report` instead of `capture_thought`). Then check the `/insights` page to verify the report and insights appear. Test the Noted/Done/Dismiss controls.

**Step 5: Commit any fixes**

If any issues are found during testing, fix and commit.
