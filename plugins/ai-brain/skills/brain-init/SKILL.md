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
