# Self-hosting AI Brain

This runbook is for a small personal deployment shared by a few independent
accounts. It keeps the operational surface deliberately narrow: one Convex
project, one Next.js/Vercel project, and one set of server-side AI provider
credentials. Each person still creates a separate AI Brain account and
authorizes their own MCP client.

The deployment can fit within hosted free tiers at low usage, but it is not
guaranteed to be completely free. OpenAI embeddings and Anthropic extraction
and classification are metered API calls. Connecting a ChatGPT or Claude
consumer account does not provide or pay for those backend API calls. Qdrant is
not required because Convex already stores and searches the vectors.

## Stop point before deployment

Repository setup and all local tests can be completed without accounts or
credentials. The first actions that require external access are:

- creating or selecting Convex and Vercel projects;
- creating OpenAI and Anthropic API keys;
- setting production environment variables;
- deploying Convex or Vercel; and
- connecting ChatGPT and Claude accounts.

Do not paste credentials into an issue, pull request, chat, shell command, or
tracked file. Use the provider dashboards or an interactive CLI prompt.

## Configuration map

| Variable                   | Location          | Purpose                                                               |
| -------------------------- | ----------------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONVEX_URL`   | Vercel/Next.js    | Public Convex client origin; intentionally browser-visible            |
| `MCP_JWT_ISSUER`           | Vercel and Convex | Stable HTTPS origin of the Next.js gateway; values must match exactly |
| `MCP_JWT_PRIVATE_JWK`      | Vercel only       | Signs 60-second Convex identity tokens; secret                        |
| `MCP_JWT_PUBLIC_JWK`       | Vercel only       | Published through the MCP JWKS endpoint                               |
| `MCP_JWT_KEY_ID`           | Vercel only       | Identifies the signing key; generated with the key pair               |
| `MCP_OAUTH_ENCRYPTION_KEY` | Vercel only       | Encrypts OAuth registrations and authorization codes; secret          |
| `OPENAI_API_KEY`           | Convex only       | Creates embeddings; secret and billed to the self-host                |
| `ANTHROPIC_API_KEY`        | Convex only       | Extracts and classifies memories; secret and billed to the self-host  |

`CONVEX_SITE_URL` is supplied by Convex and should not be created manually.
`CONVEX_DEPLOYMENT` is local Convex CLI linkage, not an application secret and
not a Convex backend environment variable. Convex backend variables are scoped
to a Convex deployment and are not sourced from the Next.js `.env.local` file.

Platform references:

- [Convex environment variables](https://docs.convex.dev/production/environment-variables)
- [Convex environment CLI](https://docs.convex.dev/cli/reference/env)
- [Convex deployment CLI](https://docs.convex.dev/cli/reference/deploy)
- [Vercel environment variables](https://vercel.com/docs/environment-variables)

Reference templates live at
[`apps/web/.env.example`](../apps/web/.env.example). Provider credential
provisioning is intentionally deferred to the secure credential phase; this
runbook records the required Convex variable names but does not create keys or
put placeholder secrets in a file.

## 1. Prepare the fork locally

Install and verify the repository before connecting any hosted service:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm check-types
pnpm test:once
pnpm build
```

For local web validation, create the ignored `apps/web/.env.local` only after
the real deployment values are available. Never fill in or commit the example
file.

## 2. Create and configure Convex

Create a Convex project for the fork and link `packages/convex` to it. The
production deployment will require `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`,
but select and provision those credentials only during the secure credential
phase. Set the non-secret issuer after the final stable Vercel origin is known:

```sh
pnpm --filter @repo/db exec convex env --prod set MCP_JWT_ISSUER
```

Enter the final stable Vercel origin for `MCP_JWT_ISSUER`, for example
`https://your-project.vercel.app`, with no path or trailing slash. The Convex
and Vercel values must be identical. Do not deploy until the secure credential
phase has supplied both provider variables. Deploying Convex is a production
action; perform it only after reviewing the target project:

```sh
pnpm --filter @repo/db deploy:prod
```

## 3. Create and configure Vercel

Import the fork as a new Vercel project with the repository root as the project
root. Use a stable production domain before setting the issuer. Configure all
of these for Production; use separate Preview values if preview deployments
need a working OAuth flow:

- `NEXT_PUBLIC_CONVEX_URL`
- `MCP_JWT_ISSUER`
- `MCP_JWT_PRIVATE_JWK`
- `MCP_JWT_PUBLIC_JWK`
- `MCP_JWT_KEY_ID`
- `MCP_OAUTH_ENCRYPTION_KEY`

Generate the signing pair and OAuth encryption key once on a trusted local
machine:

```sh
pnpm generate:mcp-jwks
```

Copy each generated value directly into the matching Vercel environment
variable. The command prints secret material, so do not save or paste its
output into the repository or a conversation. Only
`NEXT_PUBLIC_CONVEX_URL` may be exposed through a `NEXT_PUBLIC_` variable.

Do not rotate the signing or encryption values as routine maintenance for this
personal deployment. Rotating the OAuth encryption key invalidates existing
client registrations and requires each MCP client to reconnect.

## 4. Run the safe preflight

The web preflight reads the ignored `apps/web/.env.local` by default. It checks
origins, P-256 key shape and pairing, the OAuth key shape, and required names.
Its output contains variable names only, never values:

```sh
pnpm check:self-hosting
```

The Convex preflight asks the Convex CLI for environment variable names only;
it never requests their values:

```sh
pnpm check:self-hosting:convex
```

To check a non-production Convex deployment, run:

```sh
node scripts/check-self-hosting.mjs --convex --deployment dev
```

After deployment, the public health endpoint returns HTTP 503 with missing or
invalid variable names if the Next.js gateway is misconfigured. It never
returns configured values:

```sh
curl --fail-with-body https://your-ai-brain.example.com/api/mcp/health
```

## 5. Create the two accounts

1. Open the deployed web application and create the primary account.
2. Sign out or use a separate browser profile and create the second account.
3. In each account, create its own AI Brain API key if direct MCP setup asks for
   one. Never share one account's key with the other account.
4. Connect each person's ChatGPT and Claude clients to
   `https://your-ai-brain.example.com/api/mcp` and complete OAuth while signed
   in as that person.

The same server-side OpenAI and Anthropic credentials serve both accounts.
Those provider keys are not exposed to either user or MCP client.

## 6. Verify behavior before relying on it

Use harmless synthetic facts first. Complete these checks in both accounts:

1. Capture a durable fact and retrieve it with different wording.
2. Capture a changed fact; confirm normal search returns the new current fact
   and historical search returns the former fact as superseded.
3. Correct an inaccurate fact; confirm the bad fact is retracted rather than
   represented as formerly true.
4. Repeat a fact; confirm capture does not create a duplicate current memory.
5. Search for the other account's distinctive synthetic fact; confirm there
   are no results.
6. In both ChatGPT and Claude, state a durable project update without saying
   “remember this”; confirm the client calls capture automatically.
7. Start a later conversation and ask about the project; confirm the client
   invokes recall and uses the current fact.

Automatic capture remains client-mediated. The MCP server can strongly
describe when its tools should be used, but it cannot observe a ChatGPT or
Claude conversation unless that client calls the tool. A database replacement
would not change this limitation.

## Personal-operation policy

For a low-stakes personal deployment, use additive schema changes, run the
verification suite, and deploy forward. The temporal fields are optional for
legacy records, so the current memory work does not require a destructive data
migration or an audit-log/rollback system. Vercel retains prior code
deployments, but memory transitions written to Convex should be treated as
durable data rather than something a code rollback will undo.

Keep routine operations minimal:

- do not rotate keys unless one is exposed;
- do not add Elasticsearch, Qdrant, a reranker, or another model until the
  retrieval evaluation shows a concrete need;
- review provider usage occasionally for unexpected spend; and
- rerun both preflights after changing a domain, project, or credential.

## Common failures

| Symptom                                   | Check                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Health endpoint returns 503               | Fix only the variable names listed in `issues`                                           |
| OAuth metadata has the wrong host         | Make `MCP_JWT_ISSUER` the final stable HTTPS origin and redeploy Vercel                  |
| Convex rejects MCP identity tokens        | Match `MCP_JWT_ISSUER` in both systems, then redeploy Convex                             |
| All capture or search calls fail          | Confirm the two provider variable names exist on the production Convex deployment        |
| Clients must authorize again unexpectedly | Check whether `MCP_OAUTH_ENCRYPTION_KEY` changed                                         |
| Automatic capture is inconsistent         | Verify the client enabled the MCP server and inspect whether it called `capture_thought` |
