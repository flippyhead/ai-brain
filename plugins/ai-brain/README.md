# AI Brain

Personal AI memory layer for Claude Code. Captures thoughts across sessions, syncs project context, and synthesizes what you've learned — with citable sources.

## What it does

AI Brain is a thin Claude Code plugin over a hosted MCP server. The server stores your thoughts, people, projects, and insights; the plugin exposes skills that let Claude read and write that store as part of your workflow.

The server asks compatible AI clients to capture precise durable facts through
typed entity relationships and coherent narrative memories separately.
Captures are deduplicated. When something changes, the new current fact or
memory is linked to the former record, which remains available as explicit
history rather than being overwritten.
For relevant prompts, the server also asks the client to recall a small core
memory set plus query-specific current context before answering. Both behaviors
remain client-mediated: the server cannot see a conversation unless the client
calls a tool.

### Five skills

- **`/brain-init`** — Preview-first onboarding. Discovers available sources, excludes incidental or inferred noise, and proposes at most 15 atomic facts/memories for approval before writing anything.
- **`/brain-sync`** — Sync the current project's context into the brain. Compares against existing thoughts via progressive disclosure and only captures new or changed info.
- **`/weekly-review`** — Weekly synthesis cross-referencing thoughts, workflow insights (if `radar` is installed), and goals. Every claim cites its source.
- **`/brain-thread <topic>`** — Reconstruct the evolution of your thinking on a topic. Walks the chronological neighbors around a seed thought.
- **`/brain-context <date>`** — Restore what was on your mind at a specific moment. Anchors on a date or event-like phrase.

### Two hooks

Both run once when a Claude Code session starts, and both stay silent when the brain is unreachable, slow, or rejects the credentials, so they never block a session.

- **Empty-brain nudge** (`check-brain-status.mjs`): if your brain has no thoughts, prints a one-line suggestion to run `/brain-init`. Silent otherwise.
- **Core memory injection** (`inject-core-memory.mjs`): fetches your explicitly marked core facts and core memories through the server's `list_core_memories` tool and prints them so they become part of the session context before you type anything. No MCP server can make a client call `recall_context` on its own; this hook is how standing context reaches Claude unprompted. What lands in context is a short block:

  ```
  ## Core memory (AI Brain)
  Facts:
  - <one-line fact statement> (fact:<id>)
  Memories:
  - <memory summary> (thought:<id>)
  Fuller, message-specific recall is available via the mcp__ai-brain__recall_context tool.
  ```

  It reads at most 10 core facts and 10 core memories, keeps each on one bounded line, only prints entries it can cite, writes nothing to disk, and prints nothing at all when you have no core context yet. To turn it off, set `AI_BRAIN_SESSION_RECALL=0` in the environment Claude Code runs in.

Both hooks need an API key in the environment (see [Install](#install), step 3). Without one they are inert: they print nothing and the session starts normally. The skills are unaffected; they use the OAuth connection Claude Code holds.

## Install

1. Add the marketplace and install the plugin:

   ```
   /plugin marketplace add flippyhead/ai-brain-plugin
   /plugin install ai-brain@ai-brain-plugin
   ```

2. Connect the MCP server. The first time a skill reaches the brain, Claude Code opens your browser to sign in and authorize; that OAuth grant is what the skills and every `mcp__ai-brain__*` tool use from then on.

3. Give the hooks a key. The two SessionStart hooks run as plain Node scripts outside Claude Code's MCP connection, so they cannot use the OAuth grant from step 2 and the server rejects unauthenticated calls. Generate an API key in the AI Brain web app under Settings, then export it in the environment Claude Code starts from (for example your shell profile):

   ```
   export AI_BRAIN_TOKEN=ob_...
   ```

   `AI_BRAIN_API_KEY` and `MCP_AUTH_TOKEN` are accepted as aliases, and `AI_BRAIN_AUTHORIZATION` / `MCP_AUTHORIZATION` set the full `Authorization` header instead. Until one of these is set, both hooks stay inert: nothing is injected and nothing is printed. Treat the key like a password; the hooks send it only to the server URL in the plugin's `.mcp.json`.

## Requirements

- Claude Code or compatible MCP client
- An AI Brain server account (hosted at https://ai-brain-pi.vercel.app)
- For the SessionStart hooks, an AI Brain API key in the environment (Install, step 3)

## Tips for getting the most out of it

- **Cite sources in responses.** When you ask Claude a question grounded in your brain, expect answers with `fact:<id>`, `thought:<id>`, or `insight:<id>` citations.
- **Use `/brain-sync` when switching projects.** It only captures what's actually new, so running it every few days keeps the brain current without bloating it.
- **Use `/brain-thread` for retrospectives.** When a decision didn't go the way you hoped, trace the thread back to see what you were optimizing for.
- **Use `/brain-context` when returning from a break.** The brief restores ambient context — who you were working with, what was in flight — in under a minute.
- **Ask historical questions naturally.** Search defaults to current memories; the plugin can include superseded or corrected memories when you ask what used to be true or how something changed.
- **Mark core context sparingly.** Core memories are always considered during grounded recall, so reserve them for durable identity, relationship, preference, and active-project facts.

## Troubleshooting

**Plugin shows no skills after install.** Run `/plugin` to confirm `ai-brain` is listed and enabled. If not, reinstall via the command above.

**"MCP tools not available" errors.** Check that `mcp__ai-brain__*` tools appear in `/mcp`. If the server is reachable via curl but tools aren't listed, try `/mcp reload`.

**SessionStart hook doesn't nudge on empty brain, or no core memory block appears.** Both hooks silently exit on network errors (timeout, auth failure). Run the scripts directly to debug:

```
node ~/.claude/plugins/cache/ai-brain-plugin/*/hooks/check-brain-status.mjs
node ~/.claude/plugins/cache/ai-brain-plugin/*/hooks/inject-core-memory.mjs
```

If both print nothing, the usual cause is a missing API key: the hooks cannot use Claude Code's OAuth grant, so `AI_BRAIN_TOKEN` (or an alias) must be set in the environment Claude Code starts from (Install, step 3). The core memory hook also prints nothing when no fact or memory is marked core yet; mark a few with `isCore` (or ask Claude to) and start a new session. If you set `AI_BRAIN_SESSION_RECALL=0`, the block is off by design.

**Want to see what's in your brain without a skill?** Use `/mcp` to find the `ai-brain` server, then invoke `get_stats` or `browse_recent` directly.

## License

MIT. See the source repo at https://github.com/flippyhead/ai-brain.
