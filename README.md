# AI Brain

Personal AI memory layer — a Convex-backed MCP server, a Next.js web UI, and a Claude Code plugin. Captures thoughts across sessions, syncs project context, and synthesizes what you've learned — with citable sources.

## Plugin for Claude Code

The `ai-brain` Claude Code plugin lives at [`plugins/ai-brain/`](./plugins/ai-brain/). It's the recommended way to interact with AI Brain from Claude Code — five skills covering capture, sync, review, and navigation.

Install:

    /plugin marketplace add flippyhead/ai-brain-plugin
    /plugin install ai-brain@ai-brain-plugin

See [`plugins/ai-brain/README.md`](./plugins/ai-brain/README.md) for details.

## Development

This is a pnpm monorepo (apps/, packages/, plugins/). Install dependencies with `pnpm install` and see the per-package README files for specifics.
