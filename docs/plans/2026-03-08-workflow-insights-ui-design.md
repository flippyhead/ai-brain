# Workflow Insights UI — Design Document

*2026-03-08*

## Overview

Extend the AI Brain app to store, display, and collect feedback on workflow analysis insights. The Workflow Analyst skill currently generates reports as markdown files and saves unstructured thoughts to the brain. This design introduces structured reports and insights as first-class entities, a dedicated `/insights` page with feedback controls, and a learning loop where user feedback informs future analysis runs.

## Goals

1. Store workflow reports and individual insights as structured data in Convex
2. Let users review insights and provide feedback (Noted / Done / Dismissed)
3. Feed dismissal context back into the brain as user preferences
4. Let the Workflow Analyst skill query previous insights to avoid repeats and respect preferences
5. Cadence-agnostic — reports cover a date range, not a fixed "weekly" concept

## Non-Goals

- Auto-detection of whether an insight was acted on (v2)
- Snooze timers or due dates on insights
- Priority/severity ranking on insights
- Multi-user / team features

## Data Model

### `reports` table

```typescript
{
  userId: Id<"users">,
  startDate: string,           // ISO date, e.g. "2026-03-01"
  endDate: string,             // ISO date, e.g. "2026-03-07"
  sessionsAnalyzed: number,
  totalPrompts: number,
  totalToolCalls: number,
  projectsActive: Array<{
    path: string,
    sessions: number,
  }>,
  modelUsage: Record<string, number>,  // e.g. { "opus": 185, "haiku": 174 }
}
```

Indexes: `by_userId` (list reports by user, ordered by creation time).

### `insights` table

```typescript
{
  reportId: Id<"reports">,
  userId: Id<"users">,
  category: "feature-discovery" | "anti-pattern" | "productivity" | "automation",
  observation: string,
  recommendation: string,
  evidence: string,
  status: "new" | "noted" | "done" | "dismissed",
  dismissTag?: "already-fixed" | "not-relevant" | "already-knew" | "incorrect",
  dismissText?: string,
  updatedAt?: number,
}
```

Indexes:
- `by_userId_and_status` — for the unresolved view (filter by user + status)
- `by_reportId` — for the single-report view

## MCP Tools (for Claude Code)

### `create_report`

Called by the Workflow Analyst skill after analysis. Creates a report and its insights in one call.

**Input:**
```typescript
{
  startDate: string,
  endDate: string,
  sessionsAnalyzed: number,
  totalPrompts: number,
  totalToolCalls: number,
  projectsActive: Array<{ path: string, sessions: number }>,
  modelUsage: Record<string, number>,
  insights: Array<{
    category: "feature-discovery" | "anti-pattern" | "productivity" | "automation",
    observation: string,
    recommendation: string,
    evidence: string,
  }>
}
```

**Returns:** `{ reportId: string, insightIds: string[] }`

All insights are created with `status: "new"`.

### `get_insights`

Called by the Workflow Analyst skill in Step 3 to check previous insights before generating new ones.

**Input:**
```typescript
{
  status?: "new" | "noted" | "done" | "dismissed",
  category?: "feature-discovery" | "anti-pattern" | "productivity" | "automation",
  limit?: number  // default 50
}
```

**Returns:** Array of insight records with all fields.

## Convex Mutations (for Web UI)

### `updateInsightStatus`

Called from the web UI when a user interacts with an insight.

**Input:**
```typescript
{
  insightId: Id<"insights">,
  status: "noted" | "done" | "dismissed",
  dismissTag?: "already-fixed" | "not-relevant" | "already-knew" | "incorrect",
  dismissText?: string,
}
```

**Side effect:** If `dismissText` is provided, also calls the internal thought capture action with content:

```
[User Preference] User dismissed workflow insight about {category}.
Reason: '{dismissText}'. Consider excluding similar recommendations
from future workflow reports.
```

The UI shows a brief "Saved" confirmation.

## Web UI — `/insights` Page

### Navigation

New top-level nav item called **Insights** alongside Dashboard, Browse, Search, Settings.

### Layout

**Top bar** with two tabs:
- **Latest Report** (default) — all insights from the most recent report
- **Unresolved** — all insights with status `new` or `noted` across all reports, grouped by report date

**Summary strip** (Latest Report tab only): report period, sessions analyzed, project counts.

### Insight Cards

Each card displays:
- **Category badge** — color-coded (red: anti-pattern, blue: feature-discovery, green: productivity, purple: automation)
- **Observation** as headline text
- **Recommendation** as body text
- **Evidence** in a collapsible/muted section
- **Status controls** on the right side

### Status Controls

Three buttons per card: **Noted** / **Done** / **Dismiss**

- **Noted** and **Done**: update immediately, show brief "Saved" confirmation
- **Dismiss**: expands an inline section below the card:
  - Row of tag chips: `Already fixed` | `Not relevant` | `Already knew` | `Incorrect`
  - Single-line text field below chips, placeholder: "Why? (optional, saved to your brain)"
  - Submit button
- After status is set, buttons collapse to a label showing current status with an undo option

### Latest Report Tab

- Shows all insights from the most recent report regardless of status
- Resolved insights (done/dismissed) appear muted/collapsed
- "Previous reports" link at the bottom to browse report history

### Unresolved Tab

- Shows all insights with status `new` or `noted`, grouped by report date (newest first)
- Same card layout and controls

### Report History (sub-page)

- List of past reports by date range
- Each entry shows insight count and resolution stats (e.g., "7 insights: 3 done, 2 dismissed, 2 unresolved")
- Click into any report to see its insights

## Workflow Analyst Skill Changes

### Step 3 — Check Previous Insights

Replace `search_thoughts` with:
1. Call `get_insights` with `status: "new"` and `status: "noted"` — find unresolved insights to avoid repeating
2. Call `get_insights` with `status: "dismissed"` — find what the user doesn't want to see
3. Search brain for `[User Preference]` thoughts — understand the user's environment and exclusions

### Step 5 — Publish

Replace multiple `capture_thought` calls with a single `create_report` call containing all report metadata and insights. Drop the markdown file write to `~/.claude/workflow-reports/`.

### Step 7 — Summary

After publishing, tell the user how many insights were generated and direct them to the `/insights` page to review.

## Research Backing

This design was informed by research into feedback mechanisms across recommendation systems, developer tools, and AI products:

- **Status model** (New/Noted/Done/Dismissed) derived from SonarQube, GitHub Dependabot, and Azure Advisor patterns
- **Dismiss with required tag + optional text** follows ChatGPT's asymmetric feedback pattern (more detail on negative)
- **Predefined tags over free text** based on finding that structured tags are more useful than free text at low volume (~5 insights/week)
- **Auto-save dismiss context to brain** creates a two-way learning loop: short-term deduplication + long-term environment understanding
- At weekly cadence with ~5 insights, **forgetting is the risk, not fatigue** — explicit status tracking is appropriate
