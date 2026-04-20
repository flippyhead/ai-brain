# AI Brain Plugin Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `open-brain` plugin from `flippyhead/radar` into this repo, rename it to `ai-brain`, upgrade its skills for the v3 server (hybrid search, progressive disclosure, timeline, citations), and publish via a thin distribution repo (`flippyhead/ai-brain-plugin`) produced by CI.

**Architecture:** Source of truth lives at `ai-brain/plugins/ai-brain/`. The ai-brain repo root gains a `.claude-plugin/marketplace.json` for direct/dev installs. A GitHub Action mirrors `plugins/ai-brain/` to `flippyhead/ai-brain-plugin` on version tag push — that thin repo is what users actually install from. Three existing skills are migrated + upgraded; two new skills (`brain-thread`, `brain-context`) leverage `timeline_thoughts`. A skill→tool drift check runs in CI on every PR.

**Tech Stack:** Claude Code plugin system (SKILL.md, plugin.json, marketplace.json, hooks.json), Node.js ESM (hook + CI scripts), GitHub Actions (publish workflow + drift check), MCP HTTP (server URL unchanged).

**Spec:** `docs/superpowers/specs/2026-04-20-ai-brain-plugin-migration-design.md`

---

## File Structure

Every file this plan touches, grouped by phase.

### Phase 1 — Plugin in ai-brain

Created in this repo:

```
.claude-plugin/marketplace.json                   (dev/direct install marketplace)
plugins/ai-brain/.claude-plugin/plugin.json       (plugin manifest, v3.0.0)
plugins/ai-brain/.mcp.json                        (MCP server URL)
plugins/ai-brain/CLAUDE.md                        (plugin dev notes)
plugins/ai-brain/README.md                        (user-facing install/usage)
plugins/ai-brain/hooks/hooks.json                 (SessionStart hook registration)
plugins/ai-brain/hooks/check-brain-status.mjs     (migrated hook script)
plugins/ai-brain/skills/brain-init/SKILL.md       (migrated + upgraded)
plugins/ai-brain/skills/brain-sync/SKILL.md       (migrated + rewrite retrieval section)
plugins/ai-brain/skills/weekly-review/SKILL.md    (migrated + rewrite for timeline + citations)
plugins/ai-brain/skills/brain-thread/SKILL.md     (NEW)
plugins/ai-brain/skills/brain-context/SKILL.md    (NEW)
```

### Phase 2 — Distribution / CI

```
.github/scripts/skill-tool-drift-check.mjs        (drift check script)
.github/scripts/generate-dist-marketplace.mjs     (generates dist marketplace.json)
.github/workflows/skill-tool-drift-check.yml      (runs drift check on PRs)
.github/workflows/publish-plugin.yml              (mirrors to dist repo on tag)
```

### Phase 3 — Radar cleanup

A **separate PR** in `flippyhead/radar`:

```
DELETE plugins/open-brain/
MODIFY .claude-plugin/marketplace.json
MODIFY README.md
MODIFY CLAUDE.md
```

### Phase 4 — Docs and polish

```
MODIFY README.md                                  (mention plugin, link dist repo)
```

---

## Branch Setup

Work happens on branch `feat/ai-brain-plugin-migration`. The spec commit already exists on this branch. All subsequent tasks add commits on top.

If you're not on it: `git checkout feat/ai-brain-plugin-migration`.

---

## Phase 1 — Plugin in ai-brain

### Task 1: Plugin manifest and marketplace skeleton

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `plugins/ai-brain/.claude-plugin/plugin.json`

- [ ] **Step 1: Create directories**

```bash
mkdir -p .claude-plugin
mkdir -p plugins/ai-brain/.claude-plugin
mkdir -p plugins/ai-brain/hooks
mkdir -p plugins/ai-brain/skills/brain-init
mkdir -p plugins/ai-brain/skills/brain-sync
mkdir -p plugins/ai-brain/skills/weekly-review
mkdir -p plugins/ai-brain/skills/brain-thread
mkdir -p plugins/ai-brain/skills/brain-context
```

- [ ] **Step 2: Write the plugin manifest**

Create `plugins/ai-brain/.claude-plugin/plugin.json` with exactly this content:

```json
{
  "name": "ai-brain",
  "description": "Personal AI memory — hybrid search, timeline retrieval, citable thoughts. Captures, syncs, and synthesizes your knowledge across sessions.",
  "version": "3.0.0",
  "author": {
    "name": "Peter Brown",
    "url": "https://ptb.io"
  },
  "repository": "https://github.com/flippyhead/ai-brain",
  "license": "MIT",
  "keywords": [
    "brain",
    "memory",
    "knowledge",
    "onboarding",
    "review",
    "mcp"
  ]
}
```

- [ ] **Step 3: Write the dev/direct-install marketplace**

Create `.claude-plugin/marketplace.json` with exactly this content:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "ai-brain",
  "description": "AI Brain — personal memory layer for Claude Code.",
  "owner": {
    "name": "Peter Brown",
    "email": "peter@wagglelabs.com"
  },
  "plugins": [
    {
      "name": "ai-brain",
      "description": "Personal AI memory — hybrid search, timeline retrieval, citable thoughts.",
      "version": "3.0.0",
      "author": { "name": "Peter Brown" },
      "source": "./plugins/ai-brain"
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/ plugins/ai-brain/.claude-plugin/
git commit -m "feat(plugin): scaffold ai-brain plugin manifest and marketplace

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: MCP config

**Files:**
- Create: `plugins/ai-brain/.mcp.json`

- [ ] **Step 1: Write the MCP config**

Create `plugins/ai-brain/.mcp.json` with exactly:

```json
{
  "mcpServers": {
    "ai-brain": {
      "type": "http",
      "url": "https://ai-brain-pi.vercel.app/api/mcp"
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/ai-brain/.mcp.json
git commit -m "feat(plugin): add MCP server config pointing to production

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Migrate SessionStart hook

**Files:**
- Create: `plugins/ai-brain/hooks/hooks.json`
- Create: `plugins/ai-brain/hooks/check-brain-status.mjs`

- [ ] **Step 1: Write hooks.json**

Create `plugins/ai-brain/hooks/hooks.json` with exactly:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/check-brain-status.mjs\"",
            "timeout": 10000
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Write check-brain-status.mjs**

Create `plugins/ai-brain/hooks/check-brain-status.mjs` with exactly:

```javascript
#!/usr/bin/env node

// Check if the user's AI Brain has any thoughts.
// If empty, suggest running /brain-init.
// Exits silently if brain has content or is unreachable.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DEFAULT_BRAIN_URL = "https://ai-brain-pi.vercel.app/api/mcp";

async function getBrainUrl() {
  try {
    const hookDir = dirname(fileURLToPath(import.meta.url));
    const configPath = join(hookDir, "..", ".mcp.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    return config?.mcpServers?.["ai-brain"]?.url || DEFAULT_BRAIN_URL;
  } catch {
    return DEFAULT_BRAIN_URL;
  }
}

function getAuthHeader() {
  const explicitAuth =
    process.env.AI_BRAIN_AUTHORIZATION ?? process.env.MCP_AUTHORIZATION;
  if (explicitAuth) return explicitAuth;

  const token =
    process.env.AI_BRAIN_TOKEN ??
    process.env.AI_BRAIN_API_KEY ??
    process.env.MCP_AUTH_TOKEN;
  return token ? `Bearer ${token}` : undefined;
}

async function checkBrainStatus() {
  try {
    const brainUrl = await getBrainUrl();
    const headers = { "Content-Type": "application/json" };
    const authorization = getAuthHeader();
    if (authorization) headers.Authorization = authorization;

    const initRes = await fetch(brainUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "ai-brain-hook", version: "3.0.0" },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!initRes.ok) process.exit(0);

    const sessionId = initRes.headers.get("mcp-session-id");
    if (sessionId) headers["mcp-session-id"] = sessionId;

    await fetch(brainUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
        params: {},
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    const statsRes = await fetch(brainUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_stats", arguments: {} },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!statsRes.ok) process.exit(0);

    const data = await statsRes.json();
    const content = data?.result?.content?.[0]?.text;
    if (content) {
      const stats = JSON.parse(content);
      if (stats.totalThoughts === 0) {
        console.log(
          "Your AI Brain is empty. Run `/brain-init` to set up your knowledge base from connected tools and AI memory. Once populated, try `/brain-thread <topic>` or `/brain-context <date>` to explore."
        );
      }
    }
  } catch {
    // Any error — exit silently
  }
}

checkBrainStatus();
```

**Note the differences from radar's version:** env var names renamed `OPEN_BRAIN_*` → `AI_BRAIN_*`, `clientInfo.name` updated to `ai-brain-hook`, `clientInfo.version` to `3.0.0`, nudge text updated to mention the two new skills, "Open Brain" in message text changed to "AI Brain".

- [ ] **Step 3: Verify the hook script runs standalone**

```bash
node plugins/ai-brain/hooks/check-brain-status.mjs
```

Expected: exits within 10 seconds. Output depends on brain state. If your brain has thoughts, no output. If empty, prints the nudge. If unreachable or any error, silent exit.

- [ ] **Step 4: Commit**

```bash
git add plugins/ai-brain/hooks/
git commit -m "feat(plugin): migrate SessionStart hook from radar

Renamed env var prefixes OPEN_BRAIN_* to AI_BRAIN_*. Updated nudge
text to mention the new brain-thread and brain-context skills.
clientInfo now identifies as ai-brain-hook v3.0.0.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Migrate brain-init skill

**Files:**
- Create: `plugins/ai-brain/skills/brain-init/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Create `plugins/ai-brain/skills/brain-init/SKILL.md` with exactly:

````markdown
---
name: brain-init
description: Bootstrap your AI Brain from connected tools and Claude's memory. Zero-input onboarding — discovers your connectors, pulls meta-knowledge, and saves it automatically.
---

# Brain Init

Bootstrap your AI Brain by automatically discovering what tools you have connected and extracting durable meta-knowledge from them.

## Prerequisites

The AI Brain connector must be available. If `mcp__ai-brain__capture_thought` and `mcp__ai-brain__search_thoughts` MCP tools are not available, stop and tell the user to connect AI Brain first.

## Workflow

### Step 1: Check Brain Status

Call `mcp__ai-brain__get_stats` to see if the brain already has content.

- If the brain has thoughts, tell the user: "Your brain already has [N] thoughts. Running brain-init will add new knowledge without duplicating what's already there. Proceeding..."
- If the brain is empty, tell the user: "Setting up your AI Brain for the first time. I'll scan your connected tools and build your knowledge base automatically."

### Step 2: Discover Connectors

Enumerate available MCP tools by checking what's loaded in this session. Look for these patterns:

| Connector | Tool patterns to look for | What it tells us |
|-----------|--------------------------|------------------|
| Email | `email_search`, `outlook_email_search`, `gmail_*` | Communication patterns, key contacts |
| Calendar | `calendar_*`, `google_calendar_*`, `outlook_calendar_*` | Meeting rhythm, team structure |
| ClickUp | `clickup_*`, `get_task`, `search_tasks` | Projects, responsibilities |
| GitHub | GitHub MCP tools or `gh` CLI available | Repos, collaborators |
| Slack | `slack_*`, `send_message`, `search_messages` | Team context, channels |
| Linear | `linear_*` | Projects, issue tracking |
| Jira | `jira_*` | Projects, issue tracking |

Report which connectors were found: "I found connections to: [list]. I'll use these to learn about your work."

If no connectors beyond AI Brain are available, skip to Step 4 (Claude Memory) and then Step 5 (Fallback Questions).

### Step 3: Pull Meta-Knowledge from Connectors

For each available connector, extract **durable meta-knowledge** — not transient task data.

**For email/communication tools:**
- Search recent emails (last 14 days) to identify the 5-10 most frequent contacts
- Note relationships: who do they report to? who reports to them? who do they collaborate with?
- Do NOT save email content — just relationship patterns

**For calendar:**
- List events from the last 14 days
- Identify recurring meetings: name, frequency, attendees
- Infer: team structure, work rhythm, role (e.g., "has 3 direct report 1:1s = likely a manager")
- Do NOT save individual event details — just patterns

**For project management (ClickUp/Linear/Jira):**
- List spaces/projects the user is active in
- Identify what they're assigned to most
- Note project names and their apparent purpose
- Do NOT save individual task details

**For GitHub:**
- List repos with recent activity
- Note primary languages, collaborators
- Identify PR review patterns (who reviews whose code?)

**For Slack:**
- List channels the user is most active in
- Note frequent conversation partners
- Do NOT save message content

Compile findings into structured notes organized by: role signals, key people, active projects, work patterns.

### Step 4: Import Claude Memory

Check for existing knowledge Claude has about this user:

1. Read `~/.claude/CLAUDE.md` if it exists — this contains user-stated preferences and instructions
2. Read memory files from `~/.claude/projects/*/memory/` — these contain stored memories from previous sessions
3. Draw on conversation context — what Claude already knows from prior sessions

Organize findings into: people, projects, preferences, decisions, recurring topics.

### Step 5: Fallback Questions (only if no connectors found)

If no connectors beyond AI Brain were discovered in Step 2, ask these 3-4 quick questions:

1. "What's your role? (e.g., frontend engineer, product manager, founder)"
2. "What are you mainly working on right now? (1-3 projects)"
3. "Who do you work with most closely? (2-5 people and their roles)"

Use the answers as the basis for Step 6 instead of connector data.

### Step 6: Synthesize and Save

Consolidate all sources into focused brain thoughts. Before saving each thought, call `mcp__ai-brain__search_thoughts` with the topic to check for duplicates.

Note: `search_thoughts` returns a compact index — `{id, summary, snippet, type, topics, score}`. If a candidate looks like a duplicate from its `summary` + `snippet`, call `mcp__ai-brain__get_thoughts` with the candidate's `id` to fetch full content and confirm before deciding.

**Thoughts to create:**

1. **About me** — Role, responsibilities, what I work on, communication style, tools I use.
   Format: "About me: [role] at [company if known]. Responsibilities: [list]. Primary tools: [list]. Communication style: [preferences from CLAUDE.md or inferred]."

2. **My team** — Key people, their roles, how we work together.
   Format: "My team: [Person] ([role]) — [relationship/how we work together]. [repeat for each key person]."

3. **Active projects** — Current focus areas with context.
   Format: "Active projects: [Project 1] — [what it is, my role in it]. [Project 2] — [description]. Priority order: [if determinable]."

4. **Work patterns** — Meeting rhythm, schedule patterns, preferences.
   Format: "Work patterns: [recurring meetings]. Typical schedule: [if determinable]. Preferences: [from CLAUDE.md or inferred]."

Save each via `mcp__ai-brain__capture_thought`. `capture_thought` returns the new thought's `thoughtId` — collect these so Step 7 can cite them.

**Additionally:** If enough signal exists to identify project priorities, create a pinned goal list via `mcp__ai-brain__create_list` with the top projects, then call `mcp__ai-brain__update_list` to pin it.

### Step 7: Report

Show the user a summary of what was captured, with each item cited as `thought:<id>` so they can trace provenance:

- Which connectors were scanned
- What was saved — one bullet per thought, each cited as `thought:<id>`
- Whether a goals list was created (and its id)
- Next steps: "Try `/brain-thread <topic>` to trace how your thinking on a theme evolves, or `/brain-context <date>` to restore what was on your mind at a specific time."

End with: "Does this look right? Anything missing or incorrect?"
````

- [ ] **Step 2: Commit**

```bash
git add plugins/ai-brain/skills/brain-init/
git commit -m "feat(plugin): migrate brain-init skill with v3 upgrades

Renamed all 'Open Brain' references to 'AI Brain'. Added note about
new compact-index return shape of search_thoughts and how to use
get_thoughts to confirm duplicate candidates. Report step now
cites each captured thought as thought:<id> and suggests the two
new navigation skills.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Migrate brain-sync skill

**Files:**
- Create: `plugins/ai-brain/skills/brain-sync/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Create `plugins/ai-brain/skills/brain-sync/SKILL.md` with exactly:

````markdown
---
name: brain-sync
description: Sync the current project's context into your AI Brain. Reads project files, compares against existing brain knowledge via progressive disclosure, and captures only new or changed information.
argument-hint: [--name <project-name>]
---

# Brain Sync

Sync the current project's context into the AI Brain so future conversations have up-to-date knowledge about this project.

## Arguments

- `$ARGUMENTS` — Optional:
  - `--name <project-name>` — Override the auto-derived project name

Parse the name value from `$ARGUMENTS` if provided.

## Workflow

### Step 1: Gather Project Context

Read the following from the current working directory. Skip any that don't exist.

**Project identity:**
- `README.md`
- `package.json`, `Cargo.toml`, `pyproject.toml`, or `go.mod` (whichever exists)
- `CLAUDE.md`

**Git state:**
- Run `git branch --show-current`
- Run `git log --oneline -20`
- Run `gh pr list --limit 10` (skip if `gh` is unavailable)

**Project structure:**
- Run `ls -la` at the project root

**Strategic context:**
- If `docs/` exists, list its contents and selectively read files that reveal project direction (specs, architecture docs, roadmaps). Do not read every file.
- Read `GOALS.md`, `TODO.md`, or similar planning files if they exist.

### Step 2: Derive Project Name

If `--name` was provided, use that. Otherwise, derive the project name using this precedence:

1. The `name` field from `package.json` / `Cargo.toml` / `pyproject.toml`
2. The first heading in `README.md`
3. The current directory name (fallback)

### Step 3: Search Brain for Existing Knowledge (Progressive Disclosure)

**3a. Triage via compact index.**

Call `mcp__ai-brain__search_thoughts` with:
- `query`: the project name
- `limit`: 10

This returns a compact index: each hit has `{id, summary, snippet, type, topics, score}`. Do NOT assume full content is present — there is none; `snippet` is ~240 chars.

**3b. Identify hydration candidates.**

From the index rows, select up to 5 candidates that look materially related (by `summary` + `snippet` + `topics`). Discard unrelated or obviously-stale rows based on snippet alone.

**3c. Hydrate.**

Call `mcp__ai-brain__get_thoughts` with `ids: [<up to 5 ids>]`. This returns full content for those specific thoughts. Only these hydrated results participate in the diff.

### Step 4: Synthesize and Diff

Compare the current project state (from Step 1) against the hydrated thoughts (from Step 3c):

- Identify information that is **new** (not in any hydrated thought)
- Identify information that has **changed** (contradicts or updates an existing thought)
- Identify information that is **unchanged** (already accurately captured)

For each unchanged fact, note the `thought:<id>` that already captures it — you'll reference these in the report.

### Step 5: Sync to Brain

Based on the diff from Step 4:

**First sync** (no hydrated thoughts, or all candidates were unrelated):
Capture a comprehensive project summary via `mcp__ai-brain__capture_thought`. Structure the content with the project name first. Example format:

```
Project: <name> — <one-line description>. Tech stack: <technologies>. Key features: <features>. Current status: <status>. Next steps: <direction>.
```

If the summary would be excessively long, split into 2-3 focused thoughts (e.g., project overview, current status/roadmap). Collect each `thoughtId` returned.

**Subsequent syncs** (hydrated thoughts found):
Only capture thoughts for meaningful changes. Frame each as an update:

```
Update: <project-name> — <what changed> (<date>). <new status or direction>.
```

Skip unchanged information. If nothing meaningful has changed, capture no thoughts.

**No changes:**
Tell the user the brain is already up to date and skip to Step 6.

### Step 6: Report to User

Briefly tell the user:
- What was synced (or that everything was already current)
- How many new thoughts were captured, each cited as `thought:<id>`
- Key highlights of what changed — cite updates as `thought:<new-id>` and the prior thoughts they supersede as `thought:<old-id>` where applicable
- Unchanged facts cited as `thought:<id>` so the user can confirm coverage
````

- [ ] **Step 2: Commit**

```bash
git add plugins/ai-brain/skills/brain-sync/
git commit -m "feat(plugin): migrate brain-sync skill with progressive disclosure

Step 3 reworked into 3a/3b/3c: triage via compact search_thoughts
index, select up to 5 hydration candidates, fetch full content via
get_thoughts. Diff now operates on hydrated docs only. Report cites
each captured thought and each unchanged prior thought as
thought:<id>.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Migrate weekly-review skill

**Files:**
- Create: `plugins/ai-brain/skills/weekly-review/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Create `plugins/ai-brain/skills/weekly-review/SKILL.md` with exactly:

````markdown
---
name: weekly-review
description: Weekly synthesis of your brain thoughts, workflow insights, and goals. Surfaces gaps, open loops, and recommendations. Every claim is cited back to its source.
---

# Weekly Review

A weekly synthesis that cross-references your brain thoughts, workflow insights, and goals to surface what you'd miss looking at any one source alone.

Every claim in the output must be grounded in a source — cite thoughts as `thought:<id>`, insights as `insight:<id>`, lists as `list:<id>`.

## Workflow

### Step 1: Establish the Week's Time Window

Compute the start of the week as an epoch-ms timestamp.

- "This week" = from 7 days ago at 00:00 local time to now.
- Convert to epoch ms: `Date.now() - 7 * 24 * 60 * 60 * 1000` (rounded down to the start of the day).

Call this `weekStartMs`.

### Step 2: Pull the Week's Timeline

Call `mcp__ai-brain__timeline_thoughts` with:
- `aroundMs`: `weekStartMs`
- `before`: `0`
- `after`: `50`

This returns up to 50 compact index rows in chronological order for thoughts captured since the start of the week.

If the array is empty, tell the user: "Your brain has no thoughts captured this week. Try capturing some thoughts, or run `/brain-init` if your brain is empty." Then stop.

### Step 3: Pull Insights and Goals

**Workflow insights:**
Call `mcp__ai-brain__get_insights` with `status: "new"`, then again with `status: "noted"`. If the tool is unavailable (server doesn't expose insights for this user), note this and skip insight-dependent sections.

**Goals and priorities:**
Call `mcp__ai-brain__get_lists` with `pinned: true` to get the user's stated goals and priorities.

**Open items:**
Call `mcp__ai-brain__get_open_items` to get unfinished tracked items across all lists.

### Step 4: Hydrate Noteworthy Thoughts

From the week's timeline (Step 2), select up to 10 thoughts that look most substantive (by `summary` + `snippet` + `topics`) — the ones you'll want to cite in the synthesis.

Call `mcp__ai-brain__get_thoughts` with `ids: [<up to 10 ids>]`. Only these hydrated results can be quoted or paraphrased in the synthesis. The rest of the timeline is still referenceable by `thought:<id>` + summary.

### Step 5: Produce the Review

Generate a report with these 5 sections. Each section should be concise — the entire review should be scannable in 2 minutes. **Every factual claim must cite its source.**

---

**This Week in 30 Seconds**

2-3 sentence headline summary. What was the dominant theme? What stands out?

Cite 2-3 anchor thoughts: `thought:<id>`.

---

**Attention vs. Intention**

Compare workflow insights (what you actually did) against pinned goals (what you intended to do).

Flag:
- Goals with no corresponding session activity — "You said [goal] is a priority but had no sessions related to it" — cite the goal as `list:<id>`.
- Heavy activity on topics not in your goals — "[Topic] consumed [X]% of sessions but isn't in your goals" — cite `insight:<id>`.
- Momentum shifts — "[Topic] went from [X]% to [Y]% of sessions week over week" — cite `insight:<id>`.

If no workflow insights are available, display instead:
> "Install the `radar` plugin (`/plugin install radar@flippyhead/radar`) for time allocation analysis."

---

**Knowledge Captured**

Review the themes from saved thoughts this week. Cite each theme to an anchor thought.

Highlight:
- Topics with workflow insights but no saved thoughts — "You worked on [topic] but didn't save any knowledge about it — is there something worth persisting?" — cite `insight:<id>`.
- Repeated thought topics — building momentum on a theme — cite 2-3 `thought:<id>` examples.
- Cross-domain connections — thoughts from different contexts that might be related — cite the connected thoughts.

---

**Open Loops**

Aggregate unfinished threads from all sources:
- Open items from pinned lists — cite each `list:<id>` with item counts.
- Workflow insights still marked "new" — cite each `insight:<id>`.
- Decisions mentioned in thoughts that lack clear resolution — cite the `thought:<id>` where the decision was raised.

---

**Next Week**

2-3 specific, actionable recommendations based on the above. Be forward-looking, not retrospective. Reference specific projects, people, or decisions — with citations — when possible.

---

### Step 6: Offer to Save

After presenting the review, ask:
"Want me to save a summary of this review to your brain? This helps track trends across weeks."

If yes, save a condensed version via `mcp__ai-brain__capture_thought` with format:
"Weekly review (week of [ISO date]): [2-3 sentence summary of key themes, attention vs. intention highlights, and top recommendation]. Grounded in: thought:<id1>, thought:<id2>, insight:<id1>."

Return the new `thought:<id>` to the user so they can find this review later via `/brain-thread` or `/brain-context`.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/ai-brain/skills/weekly-review/
git commit -m "feat(plugin): rewrite weekly-review for v3 timeline + citations

Step 2 replaces ad-hoc recent-thought fetching with an explicit
timeline_thoughts(aroundMs=weekStartMs, before=0, after=50) call.
Step 4 hydrates up to 10 noteworthy thoughts via get_thoughts before
the synthesis. Every section of the output now requires citations —
thought:<id>, insight:<id>, list:<id>. The saved summary itself
includes the grounding citations so future reviews can trace back.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Write new brain-thread skill

**Files:**
- Create: `plugins/ai-brain/skills/brain-thread/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Create `plugins/ai-brain/skills/brain-thread/SKILL.md` with exactly:

````markdown
---
name: brain-thread
description: Reconstruct the chronological evolution of thinking around a topic or anchor thought. Walks the timeline around a seed, hydrates the most substantive neighbors, and produces a citable narrative.
argument-hint: <topic or thought-id> [--type <type>]
---

# Brain Thread

Trace how your thinking on a topic evolved over time. Given a seed — either a topic (free text) or a thought ID — walk the chronological neighbors via `timeline_thoughts`, hydrate the most substantive ones, and produce a cited narrative.

## Prerequisites

`mcp__ai-brain__search_thoughts`, `mcp__ai-brain__timeline_thoughts`, and `mcp__ai-brain__get_thoughts` must be available. If not, tell the user to install/update the AI Brain plugin and stop.

## Arguments

- `$ARGUMENTS` — Required:
  - A topic, e.g. `/brain-thread "COPA remodel"`
  - OR a thought ID, e.g. `/brain-thread thought:abc123xyz` or `/brain-thread abc123xyz`
- Optional flag:
  - `--type <decision|person_note|idea|meeting_note|task|reference>` — filter the timeline to one thought type

Parse `$ARGUMENTS` to extract:
- `seedInput` — the non-flag portion (quoted topic or ID)
- `type` — the `--type` value if present

## Workflow

### Step 1: Resolve the Seed

Detect whether `seedInput` is an ID or a topic.

- **ID pattern:** matches `^thought:[a-zA-Z0-9_-]+$` or a bare identifier of at least 16 chars (Convex IDs are longer).
- **Topic pattern:** anything else (quoted or unquoted free text).

**If ID:** strip the `thought:` prefix (if present) and use it directly as `seedId`. Skip to Step 2.

**If topic:**
1. Call `mcp__ai-brain__search_thoughts` with `query: <topic>`, `limit: 10`, and `type: <type>` if a type filter was provided.
2. If zero hits, tell the user: "No thoughts match '[topic]'. Try a different query or check `/brain-init` if your brain is empty." Stop.
3. If one hit dominates by score (score > 2× the next best), auto-pick it and announce: "Using seed: [summary] (`thought:<id>`)."
4. If multiple close candidates, show the user the top 3-5 as a list:
   ```
   Multiple possible seeds for "[topic]":
   1. [summary] (`thought:<id>`) — [snippet preview]
   2. [summary] (`thought:<id>`) — [snippet preview]
   ...
   Which one should I thread from? (number, or paste another ID)
   ```
   Wait for the user's pick. Use their selection as `seedId`.

### Step 2: Walk the Timeline

Call `mcp__ai-brain__timeline_thoughts` with:
- `seedId`: the resolved seed
- `before`: `10`
- `after`: `10`
- `type`: `<type>` if provided, omit otherwise

The result is an ordered array of up to 21 compact index rows, seed included. If only the seed is present (no neighbors), tell the user: "This thought has no chronological neighbors yet — there's nothing to thread. Try a broader topic or come back after more captures." Stop.

### Step 3: Triage and Hydrate

From the timeline, select the 3-5 most substantive neighbors (plus the seed) to hydrate. Signals of substance:
- Summary mentions a decision, turning point, or concrete change
- Distinct topics from the surrounding rows (not just a repeat)
- Type is `decision` or `meeting_note` over `reference` when both are present

Call `mcp__ai-brain__get_thoughts` with `ids: [<selected IDs including seed>]`.

### Step 4: Synthesize the Narrative

Write a markdown narrative with this optional structure:

```markdown
## Thread: [short topic inferred from seed]

**Before the turn**
<1-2 paragraphs covering thoughts chronologically before the seed or pivotal point. Cite each claim as `thought:<id>`.>

**The turn**
<1 paragraph covering the seed thought itself — the pivotal moment the thread centers on. Cite as `thought:<seedId>`.>

**After**
<1-2 paragraphs covering how thinking evolved after. Cite each claim as `thought:<id>`.>

---

**All thoughts in this thread** (for reference):
- `thought:<id>` — <summary> (<date>)
- `thought:<id>` — <summary> (<date>)
- ...
```

If the thread is very short (3-4 thoughts), simplify to a single narrative paragraph followed by the reference list.

**Never write a claim without a citation.** If a statement doesn't map to a hydrated thought, remove it.

### Step 5: Offer Next Steps

After the narrative, suggest:
- "Want to widen the window? Try `/brain-thread thought:<seedId> --type decision` or increase the range by running again."
- "Want the full context around a specific turn? Use `/brain-context <date>` anchored on that thought's createdAt."
````

- [ ] **Step 2: Commit**

```bash
git add plugins/ai-brain/skills/brain-thread/
git commit -m "feat(plugin): add brain-thread skill for reconstructing idea evolution

New skill walks timeline_thoughts around a seed (topic or thought ID),
hydrates 3-5 substantive neighbors via get_thoughts, and produces a
citable markdown narrative. Enforces thought:<id> citations for every
claim in the output.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Write new brain-context skill

**Files:**
- Create: `plugins/ai-brain/skills/brain-context/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

Create `plugins/ai-brain/skills/brain-context/SKILL.md` with exactly:

````markdown
---
name: brain-context
description: Restore the context of a specific moment — what was happening, what decisions were in flight, what was on your mind. Anchors on a date or event, pulls the timeline window, synthesizes a brief.
argument-hint: <time reference>
---

# Brain Context

Restore what was in your head at a specific moment. Given a time reference — a date, range, or event-like phrase — pull a window of thoughts via `timeline_thoughts`, hydrate the most diverse and substantive ones, and produce a cited brief.

## Prerequisites

`mcp__ai-brain__search_thoughts`, `mcp__ai-brain__timeline_thoughts`, and `mcp__ai-brain__get_thoughts` must be available. If not, tell the user to install/update the AI Brain plugin and stop.

## Arguments

- `$ARGUMENTS` — Required, free text:
  - A date: `/brain-context "April 10"`, `/brain-context "last Thursday"`, `/brain-context "2026-04-15"`
  - A range: `/brain-context "the week of April 15"`
  - An event-like phrase: `/brain-context "the week we picked Convex"`

## Workflow

### Step 1: Resolve the Anchor Timestamp

Determine whether `$ARGUMENTS` is a parseable date or an event phrase.

**Try date parsing first:**
- ISO 8601 (`2026-04-15`, `2026-04-15T10:00`) → epoch ms directly.
- Natural language date (`April 10`, `last Thursday`, `yesterday`) → convert to epoch ms at noon local time of that day.
- Range phrases (`the week of April 15`) → use the Monday of that week at noon as the anchor, and widen the `before`/`after` values (see Step 2).

**If date parsing fails, treat as an event-like phrase:**
1. Call `mcp__ai-brain__search_thoughts` with `query: $ARGUMENTS`, `limit: 5`.
2. If zero hits, tell the user: "I couldn't parse '[input]' as a date or find a matching event in your brain. Try a specific date (e.g. `April 10`) or a phrase from an actual thought." Stop.
3. If one clear match, use its `createdAt` as `aroundMs` and announce: "Anchoring on [summary] from [ISO date] (`thought:<id>`)."
4. If multiple close matches, list them and ask the user to pick one.

Call the resolved timestamp `aroundMs`.

### Step 2: Pull the Window

Default window sizes:
- Single day (date input): `before: 15`, `after: 15`
- Range (week of X): `before: 25`, `after: 5` (looking back across the week, small look-ahead)

Call `mcp__ai-brain__timeline_thoughts` with:
- `aroundMs`: the resolved timestamp
- `before`: per above
- `after`: per above
- `type`: omit (want everything for context)

If the result array is empty, tell the user: "No thoughts captured around [date]. Try a wider range or a different moment." Stop.

### Step 3: Triage for Diversity

From the compact index, select 5-8 thoughts to hydrate, optimizing for diversity:
- Distinct `type` values when possible (decision, meeting_note, person_note, idea, task, reference)
- Distinct `topics` — avoid two thoughts with overlapping topic lists if similar summaries
- Distinct `people` mentioned — try to cover multiple collaborators if relevant

Skip obvious repeats and low-signal rows (empty topic/people, generic summaries).

Call `mcp__ai-brain__get_thoughts` with `ids: [<5-8 selected IDs>]`.

### Step 4: Synthesize the Brief

Write a markdown brief organized for quick orientation:

```markdown
## Context: [date or event anchor]

**What was happening**
<1-2 sentence summary of the period's dominant themes, citing 2-3 anchor thoughts as `thought:<id>`.>

**Decisions in flight**
<bullet list of any decisions or choices under consideration — each cited as `thought:<id>`. Omit section if none.>

**People involved**
<bullet list grouping thoughts by the people they mention — e.g. "Emma: hiring conversation (`thought:<id>`), product sync (`thought:<id>`)". Omit if nothing is people-tagged.>

**Projects and topics**
<bullet list grouping thoughts by project/topic — cite each with `thought:<id>`.>

**Open questions from that moment**
<bullet list of questions, uncertainties, or unresolved threads from the hydrated thoughts — each cited as `thought:<id>`. Omit section if none.>

---

**Full window** (for reference):
- `thought:<id>` — <summary> (<date, or just time if all same day>)
- ...
```

For a single-day anchor, the sections above may collapse — just produce whichever sections have content.

**Never write a claim without a citation.** If a statement doesn't map to a hydrated thought, remove it.

### Step 5: Offer Next Steps

After the brief, suggest:
- "Want to trace how a specific thread from this window evolved? Try `/brain-thread thought:<id>`."
- "Want a wider window? Run again with an explicit date range."
````

- [ ] **Step 2: Commit**

```bash
git add plugins/ai-brain/skills/brain-context/
git commit -m "feat(plugin): add brain-context skill for moment restoration

New skill resolves a time reference (date, range, or event-like phrase
resolved via search_thoughts), pulls a timeline window via
timeline_thoughts, hydrates 5-8 diverse thoughts via get_thoughts,
and produces a cited markdown brief. Enforces thought:<id> citations
throughout.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Plugin README

**Files:**
- Create: `plugins/ai-brain/README.md`

- [ ] **Step 1: Write README.md**

Create `plugins/ai-brain/README.md` with exactly:

````markdown
# AI Brain

Personal AI memory layer for Claude Code. Captures thoughts across sessions, syncs project context, and synthesizes what you've learned — with citable sources.

## What it does

AI Brain is a thin Claude Code plugin over a hosted MCP server. The server stores your thoughts, people, projects, and insights; the plugin exposes skills that let Claude read and write that store as part of your workflow.

### Five skills

- **`/brain-init`** — Zero-input onboarding. Scans connected tools (email, calendar, ClickUp, GitHub, Slack) + your CLAUDE.md, then captures durable meta-knowledge.
- **`/brain-sync`** — Sync the current project's context into the brain. Compares against existing thoughts via progressive disclosure and only captures new or changed info.
- **`/weekly-review`** — Weekly synthesis cross-referencing thoughts, workflow insights (if `radar` is installed), and goals. Every claim cites its source.
- **`/brain-thread <topic>`** — Reconstruct the evolution of your thinking on a topic. Walks the chronological neighbors around a seed thought.
- **`/brain-context <date>`** — Restore what was on your mind at a specific moment. Anchors on a date or event-like phrase.

### One hook

- **SessionStart:** Checks if your brain is empty and nudges you to `/brain-init` if so. Silent otherwise.

## Install

```
/plugin marketplace add flippyhead/ai-brain-plugin
/plugin install ai-brain@ai-brain-plugin
```

## Requirements

- Claude Code or compatible MCP client
- An AI Brain server account (hosted at https://ai-brain-pi.vercel.app)

### Authentication (optional)

If your brain is protected by an API key, set one of:

- `AI_BRAIN_TOKEN`
- `AI_BRAIN_API_KEY`
- `MCP_AUTH_TOKEN`

Or pass an explicit auth header via `AI_BRAIN_AUTHORIZATION` / `MCP_AUTHORIZATION`.

## Tips for getting the most out of it

- **Cite sources in responses.** When you ask Claude a question grounded in your brain, expect answers with `thought:<id>` or `insight:<id>` citations — click through to find provenance.
- **Use `/brain-sync` when switching projects.** It only captures what's actually new, so running it every few days keeps the brain current without bloating it.
- **Use `/brain-thread` for retrospectives.** When a decision didn't go the way you hoped, trace the thread back to see what you were optimizing for.
- **Use `/brain-context` when returning from a break.** The brief restores ambient context — who you were working with, what was in flight — in under a minute.

## Troubleshooting

**Plugin shows no skills after install.** Run `/plugin` to confirm `ai-brain` is listed and enabled. If not, reinstall via the command above.

**"MCP tools not available" errors.** Check that `mcp__ai-brain__*` tools appear in `/mcp`. If the server is reachable via curl but tools aren't listed, try `/mcp reload`.

**SessionStart hook doesn't nudge on empty brain.** The hook silently exits on network errors (timeout, auth failure). Run the script directly to debug:
```
node ~/.claude/plugins/cache/ai-brain-plugin/*/hooks/check-brain-status.mjs
```

**Want to see what's in your brain without a skill?** Use `/mcp` to find the `ai-brain` server, then invoke `get_stats` or `browse_recent` directly.

## License

MIT. See the source repo at https://github.com/flippyhead/ai-brain.
````

- [ ] **Step 2: Commit**

```bash
git add plugins/ai-brain/README.md
git commit -m "docs(plugin): add user-facing README

Install instructions, skill descriptions, tips, and troubleshooting.
Written for end users, not plugin developers.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: Plugin CLAUDE.md

**Files:**
- Create: `plugins/ai-brain/CLAUDE.md`

- [ ] **Step 1: Write CLAUDE.md**

Create `plugins/ai-brain/CLAUDE.md` with exactly:

````markdown
# AI Brain Plugin — Dev Notes

This file guides Claude Code when making changes to the plugin source at `plugins/ai-brain/`.

## Purpose

Thin client plugin for the AI Brain MCP server. Five skills + one SessionStart hook. The MCP server (same repo, under `apps/web/src/lib/mcp/`) does all the real work — this plugin's job is to prompt Claude to use the server's tools well.

## Version

Single source of truth: `plugins/ai-brain/.claude-plugin/plugin.json` — the `version` field.

The root `.claude-plugin/marketplace.json` (dev install) and the distribution repo's generated `marketplace.json` both pull from that one place. Don't hand-edit marketplace versions.

**Bump rules:**
- Patch (`3.0.0` → `3.0.1`) — typo fixes, nudge text tweaks, CI changes that don't affect behavior
- Minor (`3.0.0` → `3.1.0`) — new skills, non-breaking prompt improvements
- Major (`3.0.0` → `4.0.0`) — breaking skill contracts, rename, or any change that forces users to reinstall

## Skill conventions

All skills follow these invariants. If you break one of them, fix it before committing.

1. **Tool names are namespaced `mcp__ai-brain__<tool>`.** Never use bare tool names in skill prompts — the drift check in CI verifies namespaced names resolve to registered tools.
2. **Progressive disclosure.** `search_thoughts` returns a compact index (`id`, `summary`, `snippet`, `type`, `topics`, `score`). Never assume full `content` is present. Always triage the index, then hydrate via `get_thoughts` for the IDs you want to read.
3. **Citations.** Any synthesized output (narrative, brief, summary) must cite `thought:<id>`, `insight:<id>`, or `list:<id>` for every factual claim. No naked claims.
4. **Graceful empty-brain.** Every skill must handle the "brain is empty" case with a friendly message suggesting `/brain-init` — not an error stack.

## How to test a change locally

1. Bump the version in `plugins/ai-brain/.claude-plugin/plugin.json`.
2. In a separate Claude Code session, install from the local source path:
   ```
   /plugin marketplace add /path/to/ai-brain
   /plugin install ai-brain@ai-brain
   ```
3. Run the skill you changed. Verify expected behavior.
4. If you changed the hook, open a brand-new session to trigger SessionStart.

## CI checks

- `skill-tool-drift-check.yml` — runs on every PR. Verifies every `mcp__ai-brain__<tool>` reference in skills and hooks matches a tool registered in `apps/web/src/lib/mcp/tools.ts`.
- `publish-plugin.yml` — runs on version tag push. Mirrors `plugins/ai-brain/` to `flippyhead/ai-brain-plugin`.

## Relationship to the server

The server lives in the same repo at `apps/web/` + `packages/convex/`. A breaking server change (tool rename, return-shape change) requires a coordinated plugin update in the same PR. The drift check catches tool renames; return-shape changes are caught manually.

## Related docs

- Plugin migration design: `docs/superpowers/specs/2026-04-20-ai-brain-plugin-migration-design.md`
- Server API: `apps/web/src/lib/mcp/server.ts`
- Tool registry: `apps/web/src/lib/mcp/tools.ts`
````

- [ ] **Step 2: Commit**

```bash
git add plugins/ai-brain/CLAUDE.md
git commit -m "docs(plugin): add dev-focused CLAUDE.md

Documents skill conventions (progressive disclosure, citations,
graceful empty-brain), version source of truth, local test procedure,
and CI checks.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Skill→tool drift check script

**Files:**
- Create: `.github/scripts/skill-tool-drift-check.mjs`

- [ ] **Step 1: Write the drift check script**

Create `.github/scripts/skill-tool-drift-check.mjs` with exactly:

```javascript
#!/usr/bin/env node

/**
 * Skill->tool drift check.
 *
 * Scans every SKILL.md under plugins/ai-brain/skills/ and every .mjs hook
 * under plugins/ai-brain/hooks/ for references to `mcp__ai-brain__<tool>`
 * (skills) or bare tool names in `tools/call` params (hooks).
 *
 * Reads the registered tool names from apps/web/src/lib/mcp/tools.ts.
 *
 * Exits 0 if every referenced tool is registered.
 * Exits 1 and prints offenders if any skill or hook references an
 * unregistered tool.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function readRegisteredTools() {
  const toolsPath = join(repoRoot, "apps/web/src/lib/mcp/tools.ts");
  const src = await readFile(toolsPath, "utf-8");
  // Extract string values from MCP_TOOL_NAMES: e.g. searchThoughts: "search_thoughts"
  const regex = /:\s*"([a-z_]+)"/g;
  const registered = new Set();
  let match;
  while ((match = regex.exec(src)) !== null) {
    registered.add(match[1]);
  }
  if (registered.size === 0) {
    throw new Error(`No tools extracted from ${toolsPath}`);
  }
  return registered;
}

async function collectSkillFiles() {
  const skillsRoot = join(repoRoot, "plugins/ai-brain/skills");
  const skillDirs = await readdir(skillsRoot);
  const files = [];
  for (const dir of skillDirs) {
    const skillFile = join(skillsRoot, dir, "SKILL.md");
    try {
      await readFile(skillFile, "utf-8");
      files.push(skillFile);
    } catch {
      // Skip if SKILL.md missing — not this check's job
    }
  }
  return files;
}

async function collectHookFiles() {
  const hooksRoot = join(repoRoot, "plugins/ai-brain/hooks");
  const entries = await readdir(hooksRoot);
  return entries
    .filter((e) => e.endsWith(".mjs"))
    .map((e) => join(hooksRoot, e));
}

function extractSkillToolRefs(src) {
  // Matches mcp__ai-brain__<tool_name> with tool names being snake_case
  const regex = /mcp__ai-brain__([a-z_]+)/g;
  const refs = new Set();
  let match;
  while ((match = regex.exec(src)) !== null) {
    refs.add(match[1]);
  }
  return refs;
}

function extractHookToolRefs(src) {
  // Matches name: "tool_name" in tools/call params
  const regex = /name:\s*"([a-z_]+)"/g;
  const refs = new Set();
  let match;
  while ((match = regex.exec(src)) !== null) {
    refs.add(match[1]);
  }
  return refs;
}

async function main() {
  const registered = await readRegisteredTools();
  const skills = await collectSkillFiles();
  const hooks = await collectHookFiles();

  const offenders = [];

  for (const skill of skills) {
    const src = await readFile(skill, "utf-8");
    const refs = extractSkillToolRefs(src);
    for (const ref of refs) {
      if (!registered.has(ref)) {
        offenders.push({ file: skill, tool: ref });
      }
    }
  }

  for (const hook of hooks) {
    const src = await readFile(hook, "utf-8");
    const refs = extractHookToolRefs(src);
    for (const ref of refs) {
      if (!registered.has(ref)) {
        offenders.push({ file: hook, tool: ref });
      }
    }
  }

  if (offenders.length > 0) {
    console.error("Skill->tool drift detected:");
    for (const { file, tool } of offenders) {
      const rel = file.replace(repoRoot + "/", "");
      console.error(`  ${rel}: references unregistered tool "${tool}"`);
    }
    console.error(
      `\nRegistered tools: ${[...registered].sort().join(", ")}`,
    );
    process.exit(1);
  }

  console.log(
    `Skill->tool drift check passed (${skills.length} skills, ${hooks.length} hooks, ${registered.size} registered tools)`,
  );
}

main().catch((err) => {
  console.error("Drift check failed to run:", err);
  process.exit(2);
});
```

- [ ] **Step 2: Verify the drift check passes on the current plan's skills**

Run from the repo root:

```bash
node .github/scripts/skill-tool-drift-check.mjs
```

Expected output:
```
Skill->tool drift check passed (5 skills, 1 hooks, 17 registered tools)
```

If it fails: fix the offenders before proceeding. Either the skill references a typo (fix the skill) or the tool genuinely isn't registered (stop — this is a bigger issue than the drift check).

- [ ] **Step 3: Verify the drift check catches a deliberate failure**

Temporarily edit `plugins/ai-brain/skills/brain-thread/SKILL.md` and change one tool reference from `mcp__ai-brain__get_thoughts` to `mcp__ai-brain__fake_tool`. Run the script again:

```bash
node .github/scripts/skill-tool-drift-check.mjs
```

Expected output:
```
Skill->tool drift detected:
  plugins/ai-brain/skills/brain-thread/SKILL.md: references unregistered tool "fake_tool"
...
Exit code: 1
```

Revert the change:

```bash
git checkout plugins/ai-brain/skills/brain-thread/SKILL.md
```

Re-run to confirm clean:

```bash
node .github/scripts/skill-tool-drift-check.mjs
```

Expected: success.

- [ ] **Step 4: Commit**

```bash
git add .github/scripts/skill-tool-drift-check.mjs
git commit -m "feat(ci): skill->tool drift check script

Scans SKILL.md files and hook scripts for mcp__ai-brain__<tool>
references, cross-checks against the MCP_TOOL_NAMES registry in
apps/web/src/lib/mcp/tools.ts, and exits non-zero on drift.
Prevents the class of breakage where a server tool rename leaves
skill prompts pointing at nothing.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: CI workflow for drift check

**Files:**
- Create: `.github/workflows/skill-tool-drift-check.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/skill-tool-drift-check.yml` with exactly:

```yaml
name: Skill-Tool Drift Check

on:
  pull_request:
    paths:
      - "plugins/ai-brain/**"
      - "apps/web/src/lib/mcp/tools.ts"
      - ".github/scripts/skill-tool-drift-check.mjs"
      - ".github/workflows/skill-tool-drift-check.yml"
  push:
    branches: [main]
    paths:
      - "plugins/ai-brain/**"
      - "apps/web/src/lib/mcp/tools.ts"

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Use Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run skill-tool drift check
        run: node .github/scripts/skill-tool-drift-check.mjs
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/skill-tool-drift-check.yml
git commit -m "feat(ci): workflow wiring for skill->tool drift check

Runs on any PR or push that touches plugin skills, the tool registry,
the drift check script itself, or its workflow. Fails the PR if a
skill references an unregistered tool.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: Local install smoke test

This task has no file changes — it verifies the plugin works from its current source location. No commit.

- [ ] **Step 1: Install from the local source**

In a fresh Claude Code session (separate terminal), run:

```
/plugin marketplace add /Users/peterbrown/Development/ai-brain
/plugin install ai-brain@ai-brain
```

Expected: installation succeeds, `ai-brain` appears in `/plugin list`.

- [ ] **Step 2: Verify MCP tools are reachable**

In the installed session, run:

```
/mcp
```

Expected: `ai-brain` server is listed and `Connected`. Expand it — all 17 tools should appear (`capture_thought`, `search_thoughts`, `get_thoughts`, `timeline_thoughts`, etc.).

- [ ] **Step 3: Verify SessionStart hook fires**

Close that session. Open a brand-new session from the same directory.

Expected (if your brain has thoughts): no nudge, silent.
Expected (if you run a fresh install and brain is empty): the nudge about running `/brain-init`.

- [ ] **Step 4: Run each skill and verify**

Within the test session, run each skill and confirm behavior. Use a brain populated with at least a week's worth of real thoughts for meaningful output.

**`/brain-init`**:
- Expected: scans your connectors, summarizes what it saved, cites each saved thought as `thought:<id>`, suggests `/brain-thread` and `/brain-context` as next steps.
- Check: no errors; citations present; suggested next-step skills named correctly.

**`/brain-sync`**:
- From a project directory with a `README.md` and `package.json`.
- Expected: searches brain, hydrates up to 5 candidates, reports what was captured/updated/unchanged, all items cited.
- Check: compact-index triage visible in Claude's narration; `get_thoughts` called only for plausible candidates.

**`/weekly-review`**:
- Expected: pulls the past 7 days via `timeline_thoughts`, hydrates up to 10, produces a 5-section markdown review with citations on every claim.
- Check: section headers present; no uncited synthesis claims.

**`/brain-thread "<topic from your brain>"`** (pick a topic with multiple thoughts):
- Expected: resolves seed (auto-picks if clear, asks otherwise), walks timeline, produces narrative with Before/Turn/After structure, cites every claim.
- Check: citations present; narrative focused on the topic (not unrelated neighbors).

**`/brain-context "<recent date>"`**:
- Expected: resolves date to timestamp, pulls window, produces brief organized by topic/people/projects, cites every claim.
- Check: brief is well-organized; all cited IDs actually appear in the reference list.

- [ ] **Step 5: Uninstall local-install version**

```
/plugin uninstall ai-brain@ai-brain
/plugin marketplace remove ai-brain
```

This keeps your main Claude Code install clean. You'll reinstall later from the distribution repo (Task 17).

---

## Phase 2 — Distribution / CI

### Task 14: Distribution repo setup

- [ ] **Step 1: Create the distribution repo**

Using the GitHub CLI:

```bash
gh repo create flippyhead/ai-brain-plugin --public \
  --description "AI Brain plugin for Claude Code — published from flippyhead/ai-brain"
```

Expected: "Created repository flippyhead/ai-brain-plugin on GitHub" and a URL.

- [ ] **Step 2: Bootstrap the repo with a README**

Clone it to a temp dir and push an initial README:

```bash
cd /tmp
gh repo clone flippyhead/ai-brain-plugin ai-brain-plugin-init
cd ai-brain-plugin-init
cat > README.md <<'EOF'
# AI Brain Plugin

Distribution repo for the AI Brain Claude Code plugin. Source of truth lives at https://github.com/flippyhead/ai-brain under `plugins/ai-brain/`.

## Install

```
/plugin marketplace add flippyhead/ai-brain-plugin
/plugin install ai-brain@ai-brain-plugin
```

## Docs

See the [plugin README](./README.md) and the [source repo](https://github.com/flippyhead/ai-brain).

---

Updates to this repo are produced automatically by CI in the source repo on version tag push. Do not hand-edit files other than this README (which is preserved across publishes).
EOF

git add README.md
git commit -m "docs: initial distribution repo README"
git push origin main
cd /Users/peterbrown/Development/ai-brain
rm -rf /tmp/ai-brain-plugin-init
```

Expected: the distribution repo on GitHub shows one commit with the README.

- [ ] **Step 3: Generate a deploy key for cross-repo push**

```bash
ssh-keygen -t ed25519 -f /tmp/ai-brain-plugin-deploy-key -N "" -C "ai-brain-plugin CI publish"
```

This creates `/tmp/ai-brain-plugin-deploy-key` (private) and `/tmp/ai-brain-plugin-deploy-key.pub` (public).

- [ ] **Step 4: Install the public key as a deploy key on the distribution repo (with write access)**

```bash
gh repo deploy-key add /tmp/ai-brain-plugin-deploy-key.pub \
  --repo flippyhead/ai-brain-plugin \
  --title "ai-brain CI publisher" \
  --allow-write
```

Expected: "Deploy key added."

- [ ] **Step 5: Install the private key as a GitHub Actions secret on the source repo**

```bash
gh secret set AI_BRAIN_PLUGIN_DEPLOY_KEY \
  --repo flippyhead/ai-brain \
  < /tmp/ai-brain-plugin-deploy-key
```

Expected: "Set Actions secret AI_BRAIN_PLUGIN_DEPLOY_KEY for flippyhead/ai-brain"

- [ ] **Step 6: Clean up temp key files**

```bash
rm /tmp/ai-brain-plugin-deploy-key /tmp/ai-brain-plugin-deploy-key.pub
```

No commit yet — this task configures external state.

---

### Task 15: Distribution marketplace generator

**Files:**
- Create: `.github/scripts/generate-dist-marketplace.mjs`

- [ ] **Step 1: Write the generator**

Create `.github/scripts/generate-dist-marketplace.mjs` with exactly:

```javascript
#!/usr/bin/env node

/**
 * Generates the distribution repo's marketplace.json from the source
 * plugin's plugin.json. Writes output to the path given as argv[2].
 *
 * Ensures the distribution marketplace version always matches the
 * source plugin version — the single version source of truth is
 * plugins/ai-brain/.claude-plugin/plugin.json.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error(
      "Usage: generate-dist-marketplace.mjs <output-path-for-marketplace.json>",
    );
    process.exit(1);
  }

  const pluginManifest = JSON.parse(
    await readFile(
      join(repoRoot, "plugins/ai-brain/.claude-plugin/plugin.json"),
      "utf-8",
    ),
  );

  const marketplace = {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "ai-brain-plugin",
    description: "AI Brain — personal memory layer for Claude Code.",
    owner: {
      name: pluginManifest.author?.name ?? "Peter Brown",
      email: "peter@wagglelabs.com",
    },
    plugins: [
      {
        name: pluginManifest.name,
        description: pluginManifest.description,
        version: pluginManifest.version,
        author: { name: pluginManifest.author?.name ?? "Peter Brown" },
        source: "./",
      },
    ],
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(marketplace, null, 2) + "\n");

  console.log(
    `Generated ${outPath} for ${pluginManifest.name}@${pluginManifest.version}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the generator produces valid JSON**

```bash
mkdir -p /tmp/dist-test
node .github/scripts/generate-dist-marketplace.mjs /tmp/dist-test/marketplace.json
cat /tmp/dist-test/marketplace.json
```

Expected: prints a JSON object with `name: "ai-brain-plugin"`, a single plugin entry with `version: "3.0.0"` and `source: "./"`. Clean up:

```bash
rm -rf /tmp/dist-test
```

- [ ] **Step 3: Commit**

```bash
git add .github/scripts/generate-dist-marketplace.mjs
git commit -m "feat(ci): marketplace.json generator for distribution repo

Reads the plugin version and metadata from
plugins/ai-brain/.claude-plugin/plugin.json and emits a flat
marketplace.json suitable for a single-plugin distribution repo
(source: \"./\"). Keeps version as single source of truth.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 16: Publish workflow

**Files:**
- Create: `.github/workflows/publish-plugin.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/publish-plugin.yml` with exactly:

```yaml
name: Publish Plugin

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
    inputs:
      tag:
        description: "Version tag (e.g. v3.0.0-rc.1)"
        required: true
        type: string

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - name: Determine source ref
        id: ref
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "tag=${{ inputs.tag }}" >> "$GITHUB_OUTPUT"
          else
            echo "tag=${GITHUB_REF#refs/tags/}" >> "$GITHUB_OUTPUT"
          fi

      - name: Checkout source (at tag)
        uses: actions/checkout@v4
        with:
          ref: ${{ steps.ref.outputs.tag }}
          path: source

      - name: Configure SSH for distribution repo
        env:
          DEPLOY_KEY: ${{ secrets.AI_BRAIN_PLUGIN_DEPLOY_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$DEPLOY_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan github.com >> ~/.ssh/known_hosts

      - name: Clone distribution repo
        run: git clone git@github.com:flippyhead/ai-brain-plugin.git dist

      - name: Clear distribution contents (preserve .git and README.md)
        run: |
          cd dist
          shopt -s dotglob
          for item in *; do
            case "$item" in
              .git|README.md) continue ;;
              *) rm -rf -- "$item" ;;
            esac
          done

      - name: Copy plugin source into distribution
        run: |
          cp -R source/plugins/ai-brain/. dist/

      - name: Generate flat marketplace.json in distribution
        run: |
          cd source
          node .github/scripts/generate-dist-marketplace.mjs ../dist/.claude-plugin/marketplace.json

      - name: Configure git in dist
        run: |
          cd dist
          git config user.name "ai-brain CI"
          git config user.email "ci@ai-brain.local"

      - name: Commit and tag
        id: publish
        run: |
          cd dist
          git add -A
          if git diff --staged --quiet; then
            echo "No changes — skipping commit/tag."
            echo "changed=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          TAG="${{ steps.ref.outputs.tag }}"
          git commit -m "release: ai-brain ${TAG} (from flippyhead/ai-brain@${TAG})"
          git tag "${TAG}"
          echo "changed=true" >> "$GITHUB_OUTPUT"

      - name: Push commit and tag to distribution
        if: steps.publish.outputs.changed == 'true'
        run: |
          cd dist
          git push origin main
          git push origin "${{ steps.ref.outputs.tag }}"

      - name: Summary
        run: |
          echo "Source tag: ${{ steps.ref.outputs.tag }}"
          echo "Distribution: https://github.com/flippyhead/ai-brain-plugin"
          echo "Changed: ${{ steps.publish.outputs.changed }}"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/publish-plugin.yml
git commit -m "feat(ci): publish-plugin workflow for distribution mirror

Triggered on version tag push (v*) or manual dispatch. Clones the
distribution repo with SSH deploy key, wipes contents except .git
and README.md, copies plugins/ai-brain/* to the root, generates a
flat marketplace.json, commits, tags, and pushes. Version tags are
mirrored exactly from source to distribution.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 17: Release candidate publish + distribution install smoke test

This task exercises the publish workflow end-to-end. No file changes; tag manipulation only.

- [ ] **Step 1: Push the branch and create a PR to main**

```bash
git push -u origin feat/ai-brain-plugin-migration
gh pr create --title "feat: migrate open-brain plugin to ai-brain repo" \
  --body "$(cat <<'EOF'
## Summary

Migrates the `open-brain` plugin out of `flippyhead/radar` into this repo, renamed to `ai-brain`, upgraded for the v3 server (hybrid search, progressive disclosure, timeline, citations). Publishes to `flippyhead/ai-brain-plugin` via CI mirror on version tag push.

## Spec

`docs/superpowers/specs/2026-04-20-ai-brain-plugin-migration-design.md`

## What's in this PR

- Plugin source at `plugins/ai-brain/` — 3 upgraded skills + 2 new skills + hook
- Repo-root marketplace.json for dev installs
- Skill→tool drift check in CI
- publish-plugin workflow for tag-triggered distribution mirror
- Distribution marketplace.json generator

## Test Plan

- [ ] `skill-tool-drift-check` workflow runs green on this PR
- [ ] Vercel preview still builds (this PR doesn't touch app code but CI should confirm)
- [ ] After merge: tag `v3.0.0-rc.1` and verify the publish workflow succeeds and populates `flippyhead/ai-brain-plugin`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for CI to pass and merge**

Confirm the drift-check workflow passes on the PR. Merge via:

```bash
gh pr merge --merge --delete-branch
git checkout main && git pull
```

- [ ] **Step 3: Tag release candidate**

```bash
git tag v3.0.0-rc.1
git push origin v3.0.0-rc.1
```

- [ ] **Step 4: Watch the publish workflow run**

```bash
gh run watch $(gh run list --workflow=publish-plugin.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: the workflow completes in under 60 seconds with a success status. If it fails, the most likely causes are:
- Deploy key not set correctly → re-check Task 14 steps 3-5
- Distribution repo doesn't exist or lacks the deploy key → verify via `gh repo view flippyhead/ai-brain-plugin`
- `generate-dist-marketplace.mjs` throws → run it locally to reproduce

- [ ] **Step 5: Verify the distribution repo is populated**

```bash
gh api repos/flippyhead/ai-brain-plugin/contents/ --jq '.[] | .name'
gh api repos/flippyhead/ai-brain-plugin/git/refs/tags --jq '.[] | .ref'
```

Expected: contents list shows `.claude-plugin`, `.mcp.json`, `README.md`, `hooks`, `skills`, and `CLAUDE.md`. Tag list includes `refs/tags/v3.0.0-rc.1`.

- [ ] **Step 6: Check clone size**

```bash
cd /tmp
gh repo clone flippyhead/ai-brain-plugin ai-brain-plugin-size-test
du -sh ai-brain-plugin-size-test
rm -rf ai-brain-plugin-size-test
cd /Users/peterbrown/Development/ai-brain
```

Expected: clone size under 1 MB.

- [ ] **Step 7: Install from the distribution repo**

In a fresh Claude Code session:

```
/plugin marketplace add flippyhead/ai-brain-plugin
/plugin install ai-brain@ai-brain-plugin
```

Expected: install succeeds, plugin loads, `/mcp` shows ai-brain server connected, all five skills available.

- [ ] **Step 8: Rerun the Task 13 smoke-test battery against the distribution-installed plugin**

Verify parity with local install by running each of the five skills. Behavior should be identical to Task 13. Record any differences for investigation.

---

## Phase 3 — Radar cleanup

**Separate PR in `flippyhead/radar`.** Do not start this phase until Phase 2 is verified green.

### Task 18: Remove open-brain from radar

All changes in this task happen in the radar repo, not ai-brain. Clone it locally first:

```bash
cd /Users/peterbrown/Development
gh repo clone flippyhead/radar radar-cleanup
cd radar-cleanup
git checkout -b chore/remove-open-brain-plugin
```

- [ ] **Step 1: Delete the plugin directory**

```bash
git rm -rf plugins/open-brain
```

- [ ] **Step 2: Update marketplace.json**

Edit `.claude-plugin/marketplace.json`. Remove the `open-brain` entry from the `plugins` array. After editing, the `plugins` array should contain only the `radar` entry.

Example resulting file (check the actual file for current context):

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "radar",
  "description": "Your AI development radar — workflow intelligence for Claude Code and Cowork",
  "owner": {
    "name": "Peter Brown",
    "email": "peter@wagglelabs.com"
  },
  "plugins": [
    {
      "name": "radar",
      "description": "Analyzes your coding sessions, scans the AI ecosystem, and recommends tools and techniques that match your goals and workflow.",
      "version": "<keep-current-version>",
      "author": { "name": "Peter Brown" },
      "source": "./plugins/radar"
    }
  ]
}
```

Also update the top-level description if it still mentions "persistent memory" (that was open-brain).

- [ ] **Step 3: Update root `.claude-plugin/plugin.json`**

If radar's root `.claude-plugin/plugin.json` description mentions "persistent memory" or "open-brain," trim it. Keep the version number untouched unless radar has its own versioning convention.

- [ ] **Step 4: Update README.md**

Remove any sections that install or describe open-brain. Add a one-line migration note near the top:

```markdown
> **Note:** The `open-brain` plugin formerly shipped from this marketplace has moved to its own home at [flippyhead/ai-brain-plugin](https://github.com/flippyhead/ai-brain-plugin). Install it from there: `/plugin marketplace add flippyhead/ai-brain-plugin`.
```

- [ ] **Step 5: Update CLAUDE.md**

Remove the "Open Brain plugin" section from radar's root CLAUDE.md (the section that describes `plugins/open-brain/`). Add a one-line pointer under "Repo Structure" or at the end:

```markdown
## Former open-brain plugin

The `open-brain` persistent-memory plugin formerly lived at `plugins/open-brain/`. It moved to `flippyhead/ai-brain-plugin` (distribution) sourced from `flippyhead/ai-brain` (monorepo). This repo is now radar-only.
```

- [ ] **Step 6: Run radar's version bump script if present**

```bash
ls scripts/
```

If `bump-version.sh` exists, run a patch bump for radar's marketplace change:

```bash
./scripts/bump-version.sh radar <next-patch>
```

Check what `<next-patch>` should be by reading `.claude-plugin/plugin.json` and incrementing the last component.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove open-brain plugin (moved to flippyhead/ai-brain-plugin)

Phase 2 of the radar/open-brain split originally planned in
2026-04-13-radar-local-only-phase1.md. open-brain now lives at
flippyhead/ai-brain (source) and flippyhead/ai-brain-plugin
(distribution). This repo is now radar-only.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

- [ ] **Step 8: Open a PR and merge**

```bash
git push -u origin chore/remove-open-brain-plugin
gh pr create --title "chore: remove open-brain plugin" --body "open-brain has moved to flippyhead/ai-brain-plugin. This PR drops it from the radar marketplace."
gh pr merge --merge --delete-branch
```

- [ ] **Step 9: Clean up the local clone**

```bash
cd /Users/peterbrown/Development
rm -rf radar-cleanup
```

---

### Task 19: Local uninstall old, install new, verify end-to-end workflow

Back in ai-brain context (or wherever you normally run Claude Code):

- [ ] **Step 1: Uninstall the radar-sourced open-brain**

```
/plugin uninstall open-brain@radar
```

Expected: removed cleanly.

- [ ] **Step 2: Install from the new distribution**

Already done in Task 17 Step 7, but if you uninstalled during testing:

```
/plugin marketplace add flippyhead/ai-brain-plugin
/plugin install ai-brain@ai-brain-plugin
```

- [ ] **Step 3: Run your real daily workflow**

Test each skill against your actual brain, not a fabricated test brain. Specifically:

- Run `/brain-sync` from an active project — confirm it captures the current state without duplicating existing thoughts, and cites everything.
- Run `/weekly-review` — confirm it produces a citable markdown review covering real work from the past week.
- Run `/brain-thread` on a topic you know has multiple thoughts — confirm narrative is coherent.
- Run `/brain-context` with a specific date from last week — confirm the brief matches your memory of that day.

- [ ] **Step 4: Observe SessionStart hook**

Open a brand-new session in a project directory. Watch for the hook's behavior. (It should be silent because your brain is populated.)

---

## Phase 4 — Docs and release

### Task 20: Update ai-brain root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Find the root README**

```bash
ls README.md
```

If it doesn't exist, skip to Step 3 and create it. Otherwise, read it to understand the current structure.

- [ ] **Step 2: Add/update the plugin section**

If the README exists, add a new section near the top (after any badges/overview). If not, create a minimal README from scratch using the template below.

Template to paste (adapt if the README has its own structure):

```markdown
## Plugin for Claude Code

The `ai-brain` Claude Code plugin lives at [`plugins/ai-brain/`](./plugins/ai-brain/). It's the recommended way to interact with AI Brain from Claude Code — five skills covering capture, sync, review, and navigation.

Install:

```
/plugin marketplace add flippyhead/ai-brain-plugin
/plugin install ai-brain@ai-brain-plugin
```

See [`plugins/ai-brain/README.md`](./plugins/ai-brain/README.md) for details.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: mention the ai-brain plugin in root README

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 21: Promote to v3.0.0

- [ ] **Step 1: Verify the branch is merged and you're on main**

```bash
git checkout main
git pull
```

- [ ] **Step 2: Tag the release**

```bash
git tag v3.0.0
git push origin v3.0.0
```

- [ ] **Step 3: Watch the publish workflow**

```bash
gh run watch $(gh run list --workflow=publish-plugin.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

Expected: success, distribution repo now has tag `v3.0.0` and a matching commit.

- [ ] **Step 4: Verify distribution version**

```bash
gh api repos/flippyhead/ai-brain-plugin/contents/.claude-plugin/marketplace.json --jq '.content' | base64 -d | grep -E '"version"'
```

Expected: `"version": "3.0.0"`.

- [ ] **Step 5: Final reinstall and smoke test**

In Claude Code:

```
/plugin uninstall ai-brain@ai-brain-plugin
/plugin install ai-brain@ai-brain-plugin
```

Run one of each skill to confirm nothing regressed vs. the rc.1 testing in Task 17. The plugin version shown in `/plugin list` should be `3.0.0`.

---

## Success Criteria (from spec)

Check each at the end of Phase 4:

- [ ] A fresh machine can run `/plugin marketplace add flippyhead/ai-brain-plugin` + `/plugin install ai-brain@ai-brain-plugin` and end up with a working plugin.
- [ ] All five skills (three upgraded, two new) execute successfully against the live v3 server.
- [ ] Skill→tool drift check runs green on the migration PR and blocks a test PR that introduces drift.
- [ ] Clone size of distribution repo on install is <1 MB.
- [ ] Radar no longer contains `plugins/open-brain/` and its marketplace no longer advertises it.
- [ ] Your daily workflow (brain-sync, weekly-review) works end-to-end with the new plugin.

Once all boxes are checked, this plan is complete. The sibling plan for server unit tests (`2026-04-21-server-test-coverage`) is the immediate next priority.
