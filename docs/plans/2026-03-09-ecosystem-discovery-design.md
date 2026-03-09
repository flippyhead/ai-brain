# Ecosystem Discovery for Workflow Analyst — Design

**Goal:** Enhance the workflow analyst to discover plugins, MCP servers, and skills the user isn't using but would benefit from, based on popularity, relevance to their tech stack, and actual usage patterns.

**Architecture:** A new Node.js script (`refresh-ecosystem.mjs`) fetches and caches ecosystem data from public registries and local files. The analyst reads this cache during analysis and produces `ecosystem` category insights that flow through the existing feedback loop.

## Ecosystem Cache

### Data Sources

**Local (no network):**
- `~/.claude/plugins/install-counts-cache.json` — plugin popularity rankings (maintained by Claude Code)
- `~/.claude/plugins/installed_plugins.json` — what the user has installed, with versions
- `~/.claude/plugins/known_marketplaces.json` — registered marketplace sources
- `~/.claude/skills/*/SKILL.md` — installed skills (glob + parse frontmatter)
- Active project files (`package.json`, `Cargo.toml`, etc.) — tech stack inference
- Most recent Cowork session metadata JSON — MCP server health and configured servers

**Network (public, no auth):**
- `raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json` — plugin names, descriptions, categories, tags
- `registry.modelcontextprotocol.io/v0/servers?limit=50` — top MCP servers
- `api.github.com/repos/anthropics/skills/contents/` — official available skills

Each network call is wrapped in try/catch. If it fails, that section is skipped or stale cache is reused. The script never fails entirely.

### Cache Structure

Written to `~/.claude/skills/workflow-analyst/ecosystem-cache.json`:

```json
{
  "refreshedAt": "2026-03-09T...",
  "userContext": {
    "techStack": ["typescript", "react", "next.js", "convex"],
    "activeProjects": ["ai-brain", "ourchannel", "copa-commander"],
    "frequentPromptThemes": ["PR review", "deploy", "test"],
    "mcpServerHealth": {
      "connected": ["posthog", "gmail", "chrome"],
      "failed": ["slack", "box"],
      "needsAuth": ["ms365"]
    }
  },
  "plugins": {
    "available": [
      { "name": "code-review", "description": "...", "installs": 118000, "category": "...", "tags": ["review"], "version": "1.2.0" }
    ],
    "installed": [
      { "name": "superpowers", "marketplace": "claude-plugins-official", "version": "4.3.1", "latestVersion": "4.5.0" }
    ]
  },
  "mcpServers": {
    "available": [
      { "name": "github", "description": "...", "source": "registry" }
    ],
    "installed": [
      { "name": "posthog", "tools": ["docs-search", "insight-query", "..."], "source": "cowork" }
    ]
  },
  "skills": {
    "available": [
      { "name": "commit", "description": "...", "repo": "anthropics/skills" }
    ],
    "installed": [
      { "name": "workflow-analyst", "description": "..." }
    ]
  }
}
```

### Tech Stack Inference

The script reads the session parser output to find active projects, then checks each project root for:
- `package.json` → extract dependencies for framework detection (react, next, vue, express, etc.)
- `Cargo.toml` → Rust
- `pyproject.toml` / `requirements.txt` → Python
- `go.mod` → Go

Stored as `userContext.techStack` — a flat list of detected technologies.

### MCP Server Health

Read the most recent Cowork session metadata JSON file (sorted by `lastActivityAt`). Extract:
- `enabledMcpTools` keys → installed MCP tools
- `remoteMcpServersConfig` → remote server names
- Init entry in `audit.jsonl` → `mcp_servers` array with `status` field ("connected", "failed", "needs-auth")

### Prompt Theme Extraction

Read the history parser output (`frequentPrompts`). Group frequent prompts into themes by keyword matching (review, test, deploy, debug, refactor, etc.). Stored as `userContext.frequentPromptThemes`.

## New Insight Category: `ecosystem`

Added as a fifth category alongside `feature-discovery`, `anti-pattern`, `productivity`, `automation`.

### Convex Changes

- `validators.ts` — add `"ecosystem"` to `insightCategory` union
- `InsightCard.tsx` — add color mapping (teal/cyan: background `#e0f2f1`, text `#00695c`)
- `server.ts` — add `"ecosystem"` to the `create_report` MCP tool's category enum
- `mcpQueries.ts` — no changes needed (already accepts any valid category)

### Insight Format

Same structure as other insights:

```
Category: ecosystem
Observation: "code-review plugin (118K installs) automates PR review. You ran /review 3 times and had 12 PR-related sessions this week."
Recommendation: "Install with: /install-plugin code-review from claude-plugins-official"
Evidence: "118K installs, 3 manual /review invocations, 12 PR sessions across 3 projects"
```

### Relevance Filtering

The analyst should NOT recommend everything that's popular. Filter by:

1. **Tech stack match** — only recommend plugins/tools tagged for technologies the user actually uses
2. **Usage pattern match** — cross-reference prompt themes and tool usage against plugin descriptions
3. **Previously dismissed** — check `get_insights` for dismissed ecosystem insights to avoid repeating
4. **Minimum popularity threshold** — skip very low-install plugins unless description strongly matches a pain point
5. **No duplicates** — don't recommend things that duplicate functionality the user already has

### Additional Ecosystem Insights

Beyond "things you don't have," the analyst should also surface:

- **Plugin updates available** — "superpowers 4.3.1 installed, 4.5.0 available"
- **Broken MCP servers** — "Your Legal plugin's Slack server is failing — check configuration"
- **MCP servers needing auth** — "MS365 server needs authentication setup"

## Updated Analyst Workflow

```
Step 0: Refresh Ecosystem Cache (NEW)
  → node refresh-ecosystem.mjs
  → Reads local files + fetches from GitHub/MCP Registry
  → Writes ecosystem-cache.json

Step 1: Parse Session Data (unchanged)
Step 2: Research Latest Capabilities (unchanged)
Step 3: Check Previous Insights (unchanged)

Step 4: Analyze (EXPANDED)
  → Feature Discovery (unchanged)
  → Workflow Anti-Patterns (unchanged)
  → Productivity Patterns (unchanged)
  → Automation Opportunities (unchanged)
  → Ecosystem Discovery (NEW)
    - Read ecosystem-cache.json
    - Diff available vs installed for plugins, MCP servers, skills
    - Filter by tech stack, usage patterns, prompt themes
    - Check for plugin updates
    - Check for broken/needs-auth MCP servers
    - Cross-reference against dismissed insights
    - Produce 2-4 ecosystem insights, prioritized by relevance

Step 5: Publish to AI Brain (unchanged)
Step 6: Summary (unchanged)
```

## Implementation Files

| File | Action |
|------|--------|
| `~/.claude/skills/workflow-analyst/refresh-ecosystem.mjs` | Create — cache refresh script |
| `~/.claude/skills/workflow-analyst/SKILL.md` | Modify — add Step 0, expand Step 4 |
| `packages/convex/convex/models/reports/validators.ts` | Modify — add `"ecosystem"` to category |
| `apps/web/src/features/insights/components/InsightCard.tsx` | Modify — add ecosystem color |
| `apps/web/src/lib/mcp/server.ts` | Modify — add `"ecosystem"` to create_report schema |

## Future Work (Separate Design Sessions)

### A. Authoritative Docs & Changelog Tracking
Replace ad-hoc web searches in Step 2 with structured parsing of actual Claude Code release notes, docs.anthropic.com, and code.claude.com/docs. Detect version changes from session data and surface what's new since last analysis.

### B. Cowork & Desktop Session Parsing
Extend the analyst to parse `~/Library/Application Support/Claude/local-agent-mode-sessions/` audit.jsonl files. Same tool usage analysis but covering email triage, calendar management, browser automation, and other non-coding workflows.

### C. Better Community Intelligence
Target specific sources like r/ClaudeAI, Agentic Coding Substack, awesome-claude-code repos, and Anthropic DevRel content for tips that match user's patterns.
