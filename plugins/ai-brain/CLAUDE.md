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
