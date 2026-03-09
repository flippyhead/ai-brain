# AI Workflow Analyst — Design Document

## Owner: Peter (peter@wagglelabs.com)
## Date: March 7, 2026

---

## 1. Overview

The AI Workflow Analyst is a service that continuously reviews Claude Code conversation history to surface actionable insights about how you work with AI coding tools. It identifies underused features, workflow anti-patterns, productivity trends, and automation opportunities.

### Problem

AI coding tools evolve rapidly. Users develop habits early and miss new features, repeat inefficient patterns, and never get feedback on how they could work more effectively. There's no "coach" watching how you use these tools.

### Solution

A weekly scheduled Claude Code task that parses session transcripts, researches the latest tool capabilities, and generates categorized insights — saved both to AI Brain (for semantic search across AI tools) and as readable markdown reports.

---

## 2. Architecture

```
Weekly Claude Code Scheduled Task
         │
         ├─ 1. Scan ~/.claude/projects/ for recent session .jsonl files
         │
         ├─ 2. Parse & aggregate session data
         │     ├─ Tool usage counts (by tool, by project)
         │     ├─ Error/retry patterns
         │     ├─ Skill invocations
         │     ├─ Session metadata (project, branch, duration, model)
         │     └─ Repeated sequences / manual patterns
         │
         ├─ 3. Research latest capabilities
         │     ├─ Web search: Anthropic blog, docs, changelogs
         │     └─ Extract tool/skill list from session system prompts
         │
         ├─ 4. Check previous insights (search AI Brain, avoid repeats)
         │
         ├─ 5. Analyze: aggregated data + capabilities → insights
         │
         └─ 6. Publish
               ├─ Save each insight to AI Brain via capture_thought MCP tool
               └─ Write weekly markdown report to ~/.claude/workflow-reports/
```

No new code in the ai-brain repo. This is entirely a Claude Code skill + scheduled task that uses existing infrastructure.

---

## 3. Data Extraction

### Input

- `~/.claude/projects/{project-path}/{session-id}.jsonl` — full session transcripts
- `~/.claude/history.jsonl` — input history across all projects
- Time window: sessions modified in the last 7 days

### What gets extracted per session

| Field | Source |
|-------|--------|
| Project path, git branch | Session metadata fields |
| Start/end timestamps, duration | First/last entry timestamps |
| Model used, Claude Code version | Session metadata |
| User messages (prompts) | Entries with `type: "user"` |
| Tool calls & results | Entries with tool use content blocks |
| Tool success/failure counts | Tool result entries (error vs success) |
| Permission denials | Tool results with denial indicators |
| Skills invoked | `/skill` command entries |
| Error sequences | Consecutive failed tool calls or retries |

### Cross-session aggregation

- Tool usage frequency across all sessions
- Error rates by tool
- Project activity distribution (sessions per project)
- Time-of-day and day-of-week patterns
- Frequently typed prompts (from history.jsonl)
- Repeated multi-step sequences

### Context window management

Sessions can be very large. The extractor produces condensed summaries (counts, lists, notable sequences) rather than sending raw transcripts. This keeps the analysis prompt within context limits.

---

## 4. Capability Research

Each weekly run actively researches the latest Claude Code features and capabilities.

### Research targets

- Anthropic Claude Code documentation and changelog
- Anthropic blog posts about Claude Code updates
- Release notes for recent Claude Code versions

### How it works

1. Web search for recent Claude Code feature announcements, tips, best practices
2. Extract the available tools/skills list from the most recent session's system prompt (already captured in JSONL)
3. Combine into a structured "capability reference" for the analyzer

### Output

- List of known features/tools with descriptions
- Newly announced features from the past week/month
- Tips and best practices from official sources

### Extensibility

v1 covers Claude Code only. The architecture supports adding other tools later (Cursor, ChatGPT, etc.) by adding new research targets — but we don't build that now.

---

## 5. Analysis & Insight Generation

### Input to analyzer

1. Aggregated session data (tool usage stats, error patterns, workflow sequences, time patterns)
2. Capability reference (available tools/skills + newly announced features)
3. Previous week's insights (from AI Brain, to avoid repetition)

### Four insight categories

| Category | What the analyzer looks for |
|----------|----------------------------|
| Feature discovery | Tools/skills in the capability list that never appear in session data. New features from changelog that match user's work patterns. |
| Workflow anti-patterns | High error/retry rates. Permission denials. Manual Bash commands for things dedicated tools handle (e.g. `grep` via Bash instead of Grep tool). Fighting with tools. |
| Productivity patterns | Sessions per project, average session length, time-of-day distribution, project attention distribution, tool usage breakdown. |
| Automation opportunities | Repeated multi-step sequences across sessions. Frequently typed prompts. Tasks that follow the same pattern — candidates for skills, hooks, or scripts. |

### Deduplication

Before saving, search AI Brain for recent `workflow_insight` thoughts to avoid repeating advice already given. Only surface new or evolved insights.

### Output format per insight

- **Category** — one of the four types
- **Observation** — what was noticed in the data
- **Recommendation** — what to do about it
- **Evidence** — specific numbers or examples from sessions

---

## 6. Output & Storage

### AI Brain thoughts

Each insight saved via `capture_thought` MCP tool. Content structured as:

```
[Workflow Insight — {Category}]

Observation: {what was noticed}

Recommendation: {what to do about it}

Evidence: {specific numbers/examples}
```

Metadata extraction (Claude Haiku) classifies these with topics like `workflow-insight`, the category name, and `claude-code`. Searchable across all AI tools via MCP.

### Weekly markdown report

Written to `~/.claude/workflow-reports/YYYY-WNN.md`.

Contents:
- Summary stats (sessions, projects active, tool usage breakdown)
- Top insights organized by category
- Week-over-week trends (if previous reports exist)
- "Quick wins" section — 2-3 easiest improvements

Location rationale: under `~/.claude/` keeps it colocated with session data. Not in any project repo since it's cross-project.

---

## 7. Scheduling & Orchestration

### Implementation

A Claude Code skill file containing the full analyst prompt and workflow instructions, triggered by Claude Code's `/schedule` command to run weekly.

### Task flow

1. Determine time window (current date, last 7 days)
2. Scan `~/.claude/projects/` for session `.jsonl` files modified in window
3. Parse each session, build structured summary
4. Web search for latest Claude Code features/changelog
5. Search AI Brain for previous insights (deduplication)
6. Construct analysis prompt, generate insights
7. Save insights to AI Brain via `capture_thought`
8. Write weekly markdown report

### Error handling

- AI Brain MCP unreachable → still write markdown report
- No sessions in time window → short "no activity" report, skip analysis
- Web search for capabilities fails → proceed with session-embedded capability list only

---

## 8. What gets built

| Artifact | Description |
|----------|-------------|
| Claude Code skill file | Contains the full analyst workflow prompt |
| `/schedule` configuration | Weekly trigger for the skill |
| `~/.claude/workflow-reports/` directory | Output location for markdown reports |

No new database tables, no new API endpoints, no changes to the ai-brain codebase.

---

## 9. Future extensions (not in v1)

- Support for additional AI tools (Cursor, ChatGPT, Copilot)
- Multi-user support via AI Brain platform
- Web dashboard for viewing insights with charts/trends
- On-demand MCP tool for ad-hoc analysis
- Comparison across time periods ("you improved X by 30% this month")

---

*Extends: Open Brain (docs/plans/2026-03-03-open-brain-design.md)*
