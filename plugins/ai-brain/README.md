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
