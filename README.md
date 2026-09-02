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

## Structured facts, narrative memory, and grounded recall

AI Brain uses a hybrid memory model:

- `entities` give people, organizations, projects, and places stable identities.
- `facts` store precise typed subject-predicate-value knowledge such as exact
  dates, relationships, providers, schools, employers, and scalar preferences.
- `thoughts` store one coherent narrative decision, project state, commitment,
  or recurring pattern.

Readable fact statements are generated from structured data for search and
display; the typed value remains authoritative. The MCP server instructs
capable clients to call `remember_fact` or `capture_thought` automatically for
explicit durable information. This remains client-mediated: an MCP server
cannot observe a conversation unless the client invokes one of its tools.

For relevant prompts, `recall_context` combines a small set of explicitly
marked core facts/memories with query-specific fact and thought search results.
Clients are instructed to send the user's complete current message so exact
names, identifiers, and version strings reach retrieval unchanged.

Precise facts are account-isolated, source-labelled, and optionally associated
with an import batch. A single-valued fact change creates a new current record
and preserves the former record as `superseded`; a correction marks the
inaccurate record `retracted`. Derived ages are rejected in favor of an exact
`date_of_birth` value when the date is actually known.

Smart Save compares each capture with the account's current memories:

- Independent information is added.
- Duplicate information is ignored.
- Information that changed creates a new current memory and marks the former
  memory as `superseded`.
- A correction creates a new current memory and marks the incorrect memory as
  `retracted`.
- Broad, incidental, inferred, derived, or non-atomic candidates are returned
  as `ASK` or `SKIP` without being stored.

Superseded and retracted memories are preserved and linked to their replacement;
they are not overwritten or deleted. Normal search and browsing return current
memories. MCP clients can request historical results when answering questions
about prior states or how something changed.

Forgetting is the one exception. Retract when a memory was wrong; forget when
it must not remain in storage regardless, such as a mis-captured credential or a
third party's private detail. `forget_thought`, `forget_fact`, and
`forget_entity` hard-delete the record with no undo and no tombstone. A
forgotten memory's neighbours are repaired rather than left dangling: an
earlier memory it had replaced stays retired (forgetting a change is not an
undo of it), and its replacement stays current. Forgetting an entity also
deletes every fact about it and every fact on another subject whose value is
that entity, because those facts' readable text carries the entity's name.
Each call requires a reason, which is echoed back but not stored — nothing
remains to store it on.

Memories may also carry explicit real-world `validFrom` and `validTo` times.
These are separate from when AI Brain recorded or superseded the memory, so a
known school start date, project period, or former role can be represented
without treating the database write time as the event time. Inaccurate claims
are retracted and have no historical validity interval.

## Exporting your memories

    pnpm export:brain --prod                                    # list accounts
    pnpm export:brain --prod --user <userId> --out ./brain-export

Two formats are written. `json/` is a faithful archive — every stored field
except the embedding, unaltered, one file per collection, covering every
account-owned table (memories, facts, entities, lists and their items, reports
and their insights). `markdown/` is a brain directory another memory system can
read: entity pages carrying a `## Facts` fence and memory pages carrying
frontmatter.

Re-running into the same `--out` replaces the generated `json/` and
`markdown/` directories outright rather than writing over them, so a memory
retracted since the last run does not survive as a stale page. Anything else
under `--out` is left alone.

The markdown form preserves lifecycle rather than flattening it. A superseded
fact is written struck through and pointed at the row that replaced it; a
retracted fact is written struck through and marked forgotten, with its reason.
An export that dropped that distinction would hand the reader two competing
current claims where the account holds one retired one.

Embeddings are never exported. They are derived from content the archive
already carries in full, and any consumer that needs them can regenerate them.

Superseded and retracted memories are excluded unless `--include-historical` is
passed. Export reads through `convex run`, so it uses the deployment
credentials already configured rather than handling a key itself.

## AI provider configuration

The Convex backend currently uses OpenAI
`text-embedding-3-small` for semantic search and Anthropic Claude Haiku for
one schema-constrained Smart Save analysis that combines admission,
classification, and metadata extraction for narrative thoughts. A narrative
capture normally uses one embedding and one Haiku call;
a second embedding is created only when a changed fact produces different
standalone replacement text. Set `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` on
your Convex deployment.

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
