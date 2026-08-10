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

Run the local verification suite with:

    pnpm lint
    pnpm check-types
    pnpm test:once
    pnpm build

## MCP-to-Convex authentication

MCP API keys are exchanged by the Next.js gateway for short-lived, signed
Convex identities. MCP functions derive the account ID from that identity and
do not accept a caller-provided `userId`.

Generate an ES256 key pair:

    pnpm generate:mcp-jwks

Set all four generated values on the Next.js deployment, plus
`MCP_JWT_ISSUER`, whose value is the public origin of that deployment without a
trailing slash (for example, `https://brain.example.com`). Keep
`MCP_JWT_PRIVATE_JWK` server-side and never expose it as a `NEXT_PUBLIC_`
variable. `MCP_OAUTH_ENCRYPTION_KEY` is also server-only; it encrypts dynamic
client registrations and short-lived authorization codes. Rotating it requires
connected MCP clients to register and authorize again.

Set the same issuer on the Convex deployment and redeploy Convex so it trusts
tokens issued by the gateway:

    pnpm --filter @repo/db exec convex env set MCP_JWT_ISSUER https://brain.example.com
    pnpm --filter @repo/db deploy:prod

The public key is served from `/.well-known/mcp-jwks.json`; Convex fetches it
from the issuer origin. If the issuer or signing keys are absent, MCP data
functions fail closed.
