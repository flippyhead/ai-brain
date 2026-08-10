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

For a private deployment, follow the [self-hosting runbook](./docs/self-hosting.md). It covers the two-service layout, account isolation, configuration preflight, and the point where hosted accounts and provider credentials become necessary.

Run the local verification suite with:

    pnpm lint
    pnpm check-types
    pnpm test:once
    pnpm build

## Automatic capture, grounded recall, and temporal memory

The MCP server instructs capable clients to call `capture_thought`
automatically when a conversation reveals durable personal facts,
preferences, relationships, project changes, decisions, or recurring working
patterns. This is client-mediated: an MCP server cannot observe a conversation
unless the client invokes one of its tools.

For relevant prompts, `recall_context` combines a small set of explicitly
marked core memories with query-specific hybrid search results and returns the
full records needed to answer. Clients are instructed to send the user's
complete current message so exact names, identifiers, and version strings reach
keyword search as well as semantic search.

Smart Save compares each capture with the account's current memories:

- Independent information is added.
- Duplicate information is ignored.
- Information that changed creates a new current memory and marks the former
  memory as `superseded`.
- A correction creates a new current memory and marks the incorrect memory as
  `retracted`.

Superseded and retracted memories are preserved and linked to their replacement;
they are not overwritten or deleted. Normal search and browsing return current
memories. MCP clients can request historical results when answering questions
about prior states or how something changed.

Memories may also carry explicit real-world `validFrom` and `validTo` times.
These are separate from when AI Brain recorded or superseded the memory, so a
known school start date, project period, or former role can be represented
without treating the database write time as the event time. Inaccurate claims
are retracted and have no historical validity interval.

## AI provider configuration

The Convex backend currently uses OpenAI
`text-embedding-3-small` for semantic search and Anthropic Claude Haiku for
metadata extraction and Smart Save classification. Set `OPENAI_API_KEY` and
`ANTHROPIC_API_KEY` on your Convex deployment.

These are server-side API calls. Connecting ChatGPT or Claude as an MCP client
does not provide their API keys or charge these calls to a consumer
subscription. A self-hosted deployment uses the API keys configured on that
deployment.

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
