# Personal Memory Quality Roadmap

**Date:** 2026-08-10
**Status:** Implemented through the credential boundary

## Goal

Make AI Brain a low-maintenance memory layer for a small, self-hosted,
multi-account deployment. The design favors reliable personal context,
conservative history, low recurring cost, and simple operations over
enterprise-scale search features or exhaustive conversation logging.

## Architectural decision

Keep the existing Next.js, Convex, and MCP architecture.

Elasticsearch is not required at the expected corpus size. Convex already
provides transactional storage, text search, vector search, and a free tier.
Moving to Elasticsearch would add an always-on search service and inference
configuration without solving the main automatic-capture constraint: an MCP
server cannot observe a ChatGPT or Claude conversation unless the client calls
one of its tools.

Guaranteed per-turn capture would require controlling the chat loop, using a
transcript bridge, or importing conversation history. That is a separate client
integration decision, not a storage-engine decision.

## Work included before deployment

### 1. Account and OAuth boundaries

- Derive the Convex account from a short-lived signed identity.
- Bind OAuth clients, redirects, authorization codes, and resources.
- Keep tenant checks in application mutations and queries.

### 2. Temporal memory

- Preserve `current`, `superseded`, and `retracted` states.
- Insert replacements and update prior memories atomically.
- Keep formerly true information distinct from information that was inaccurate.
- Store optional validity dates separately from the time AI Brain learned about
  a fact.

### 3. Grounded capture and recall

- Ask capable clients to capture durable information automatically.
- Capture user-stated or user-confirmed facts, not an assistant's unsupported
  inference.
- Ask clients to recall with the verbatim user message so proper nouns, version
  numbers, and other exact terms reach keyword search.
- Combine explicitly marked core memories with query-specific search results,
  then hydrate and deduplicate them before returning context.
- The core bound is on *retrieval*, not storage: `recall_context` returns at
  most `DEFAULT_CORE_MEMORY_LIMIT` (10, capped at 25) core memories, but
  nothing limits how many memories a client may mark `isCore`. As the marked
  set grows, "core" converges on the most recently marked entries rather than
  the most important ones. A storage-side cap needs a demotion policy —
  deciding which core memory is evicted — so it is deliberately deferred until
  live use shows how large the marked set actually gets.
- Keep normal search current-only and require an explicit historical option.

### 4. Memory-quality evaluation

- Test current, historical, and corrected retrieval behavior.
- Include exact-term and paraphrased-query fixtures.
- Treat any cross-account result as a release-blocking failure.
- Establish a baseline before adding a reranker, time decay, or use-count
  scoring.

The repository now contains a deterministic scoring and account-isolation
harness. Recording the first live hybrid-retrieval baseline remains part of
post-credential acceptance because embeddings cannot be exercised without the
deployment's provider decision.

### 5. Deployment readiness

- Document all Next.js and Convex environment variables.
- Validate required configuration without printing secret values.
- Provide a self-hosting sequence and post-deployment acceptance checklist.

## Cost work completed at the credential boundary

Classification and metadata extraction now share one schema-constrained Haiku
response. The capture path reuses its original embedding when the stored text
is unchanged and creates a second embedding only for a rewritten replacement.
Provider failures fall back to a bounded deterministic metadata shape rather
than making a second model request. Both configured provider credentials and
their selected models were verified with minimal live requests before
deployment.

## Deferred until evidence justifies it

- Elasticsearch or another dedicated search cluster.
- Cross-encoder reranking.
- Recency decay or recall-count boosting.
- Raw storage of every conversation turn.
- Background consolidation of raw transcripts.
- A custom chat client or transcript bridge for guaranteed capture.

These features add cost, data retention, or operational complexity. Revisit
them only after live ChatGPT and Claude tests identify a concrete failure that
the simpler design cannot address.

## Deployment acceptance scenarios

1. Two accounts can capture and retrieve their own memories without returning
   the other account's records.
2. A new current fact supersedes a formerly true fact and both remain available
   for historical questions.
3. A correction retracts an inaccurate fact and never presents it as prior
   history.
4. Explicit real-world validity dates remain distinct from record creation and
   supersession times.
5. Repeating an already captured fact does not create a duplicate.
6. Exact names and project identifiers are found by hybrid retrieval.
7. Missing or malformed deployment configuration fails with variable names but
   never exposes secret values.
