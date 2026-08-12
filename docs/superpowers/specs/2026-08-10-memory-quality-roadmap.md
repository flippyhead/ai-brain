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

## Post-deployment roadmap (2026-08-11)

Reviewed against Atlas, the Elastic search-labs agent memory demo. Atlas stores
episodic, semantic, and procedural memory in three Elasticsearch indices with
two-stage hybrid retrieval, Gaussian decay, use-count boosting, and a
background consolidation job.

The storage decision is unchanged: Convex. Its vector and text indices already
supply both retrieval legs, and reciprocal rank fusion over them is implemented
in `models/thoughts/actions.ts`. Atlas needs a dedicated cluster largely
because it records every conversation turn, which this deployment does not do
and, through MCP alone, cannot do.

Atlas mechanisms this repository already implements: business-time validity,
soft supersession with preserved history, the retracted-versus-superseded
distinction, hybrid BM25 and vector retrieval fused by RRF, an explicit
historical-results option, write-time deduplication through the same retriever
used for recall, bounded core-memory injection, and an audit listing.

### Phase 1 — retrieval baseline

Nothing below Phase 2 should be built before this exists, because the repair
for a ranking failure differs from the repair for a retrieval failure and the
current fixtures cannot tell them apart.

- Extend the deterministic fixtures to cover paraphrased queries, retraction
  versus formerly-true, multi-fact project status, and a genuine cross-account
  case whose result set actually contains a foreign document.
- Add a live baseline script alongside `check-self-hosting.mjs` that seeds two
  accounts, runs `recall_context` per fixture, scores the real rankings with
  the existing `evaluateRetrievalCase`, and exits non-zero on any account leak.
- Record the resulting R@5 and R@10 in this document.

#### First recorded baseline, 2026-08-11

Run with `pnpm eval:recall` against the development deployment, thirteen
memories across two accounts, nine queries.

| Measure | Result |
| --- | --- |
| R@5 | 1.0 |
| R@10 | 1.0 |
| Account leaks | 0 |
| Retracted or stale results | 0 (after the fix below) |

Read the recall figures narrowly. The larger account holds nine retrievable
memories, so a ten-result window can barely fail to contain the expected one;
these numbers say the retriever is not broken, not that it is good. They are
not comparable to Atlas's reported 0.89, which was measured over a far larger
synthetic corpus. Their value is as a regression floor and as the carrier for
the account-isolation and lifecycle assertions, which is where the harness
actually earned its cost:

The first run failed. `includeHistorical` disabled lifecycle filtering
entirely, so retracted memories were returned alongside superseded ones and a
value that had never been true was presented as prior history — acceptance
scenario 3, failing in production code. Four call sites shared the defect: the
text leg, the vector leg, the shared list model, and the web list. They now
route through one `isMemoryRetrievable` predicate that admits superseded
memories for historical reads and withholds retracted ones in every mode.

#### Second baseline, 2026-08-12, blended stores

Re-run after the structured facts work merged, with the harness extended to
seed facts and score the blend `recall_context` actually serves — core facts,
relevant facts, core memories, and hybrid narrative results together.

| Measure | First run | Blended run |
| --- | --- | --- |
| R@5 | 1.0 | 1.0 |
| R@10 | 1.0 | 1.0 |
| Account leaks | 0 | 0 |
| Cross-store disagreements | not measured | 0 |

The recall figures did not move, and were not expected to: `hybridSearch` is
thoughts-only and the facts work did not touch it. Re-running the original
harness unchanged would have proved nothing, so the harness itself was the
thing that needed to grow.

What is new is the disagreement check. Scoring now supports
`forbiddenExactStrings`, and both accounts hold a `school` fact for the same
child with different values. One account's query requires "Redwood Academy" and
forbids "Brightwater"; the other requires the reverse. A cross-account leak or
a structured/narrative disagreement on the same predicate now fails the run
rather than being invisible, and the assertion is non-vacuous because the
forbidden value genuinely exists in the other account.

One fixture was wrong on the first attempt and is worth recording: forbidding
"O negative" on the correction case failed, because the retraction convention
deliberately states the corrected value *and* names the earlier claim as
inaccurate, so the string legitimately appears. Withholding the retracted fact
is covered by the status check instead.

### Phase 2 — gaps that need no further evidence

- `forget_thought`. There is currently no delete path for a memory. Retraction
  covers information that was wrong; it does not cover a memory that should
  never have been stored, such as a mis-captured credential or a third party's
  private detail. Atlas writes a tombstone into its episodic index; this
  deployment has nowhere to put one and will simply delete.
- Core-memory deduplication. Atlas orders identity and constraint facts ahead
  of recency and drops near-duplicates by token-set Jaccard similarity. That
  addresses the convergence problem described above, where a growing marked set
  reduces "core" to "most recently marked", without requiring the demotion
  policy that a storage-side cap would need. See the structured-facts section
  below: this item may no longer be necessary.
- A `procedural` value on the existing thought type. Procedural content
  currently lands as `reference`. The type is already a filter field on both
  the search index and `by_userId_and_type`, so this is an enum addition rather
  than a schema change. An orthogonal `semantic | procedural` field was
  considered and rejected: it would widen the schema, capture arguments,
  analysis response, and tools for a dimension nothing reads. Atlas's fuller
  procedural store — steps, versions, success and failure counters — is a
  playbook registry, a separate feature, and is not planned.
- Automatic recall in Claude Code. No MCP server can compel a client to call
  `recall_context`, and retrieval quality is bounded by how often it is called
  rather than by ranking. A session-start hook alongside
  `hooks/check-brain-status.mjs` can inject core memories unprompted. This is
  client-specific and does not help ChatGPT, but it is the largest single
  improvement available.

### Phase 3 — refinements gated on the Phase 1 numbers

This narrows the deferral list above by naming the evidence each item needs.

- Cross-encoder reranking: only if the baseline falls below roughly 0.8 R@10
  *and* the misses are ranking failures, with the correct memory present in the
  candidate pool but placed too low. A reranker cannot repair a retrieval miss.
- Use-count boosting with `last_used_at` write-back: only if misses correlate
  with frequently used memories. It costs a write on every recall and forms a
  positive feedback loop that favours whatever the ranking already surfaces.
- Recency decay: not planned. Supersession and `validTo` model staleness
  explicitly, which is better information than a decay curve approximating it,
  and decay penalises stable identity facts. Atlas exempts procedural memory
  from decay for the same reason.

### Also declined

- Confidence scores with harsh-versus-natural contradiction handling. The
  existing superseded and retracted states already carry the decision-relevant
  part of that distinction.
- Episodic turn storage and background consolidation, for the reasons in
  "Architectural decision" above.
- Document-level security. Account isolation stays in application queries and
  is enforced as a release-blocking condition by the evaluation harness.

## Interaction with the structured facts work

Jordan is adding account-isolated `entities` and typed `facts` tables with
`remember_fact` and `search_facts` tools, moving exact dates, relationships,
providers, and schools into structured storage. Narrative capture becomes a
gate returning ADD, ASK, or SKIP that fails closed and refuses broad
biographies. `recall_context` blends structured facts with narrative thoughts.

That work lands first. The phases above adjust as follows.

### Phase 1 changes

The fixture set must be re-partitioned before it is written. Several planned
fixtures — exact schools, dates, project identifiers — are precisely the
questions structured storage is meant to answer, so each fixture now has to
declare which store is expected to answer it. A fixture that passes because the
narrative leg found a restatement of a fact the structured leg should have
returned is a false pass.

One new failure class matters more than recall: the two stores can disagree.
The same school can exist as a current typed fact and as a current narrative
thought holding a different value, and blended recall would surface both. Add
fixtures that assert the stores agree, and treat disagreement as a failure at
the same severity as an account leak.

Record the baseline twice, before and after the facts work merges, using the
same script. The delta is the only evidence that structured storage improved
retrieval rather than merely relocating it.

### Phase 2 changes

- Core-memory deduplication is probably obsolete. Its purpose was to stop
  repeated restatements of identity facts from crowding the core set, and a
  fact keyed by entity and predicate cannot be restated into a duplicate. Move
  this to evidence-gated and revisit only if the post-merge core set still
  drifts.
- `forget_thought` must cover facts and entities as well. A delete path that
  removes the narrative memory but leaves the derived typed fact is not a
  delete path. Orphaned entities need a rule: delete when the last referencing
  fact goes, or keep them and accept the residue.
- The automatic recall hook gets a better payload. A bounded set of typed facts
  is a more reliable always-on injection than narrative core memories, because
  it is small, non-redundant, and machine-readable.
- The `procedural` thought type is unaffected.

### Shared lifecycle

Typed facts preserve former values and retract inaccurate ones, which is the
same current, superseded, and retracted lifecycle the thoughts tables already
implement in `models/thoughts/memoryLifecycle.ts`. Two independent
implementations of that lifecycle will drift, and the divergence will show up
as exactly the store-disagreement failure described above. Share the transition
logic across both tables rather than reimplementing it per table.

### Questions resolved on 2026-08-12

- Precedence. Narrative capture refuses information a structured predicate
  already records. `captureThought` passes overlapping current facts to the
  admission gate; a NOOP citing a fact returns the `duplicate` disposition and
  writes nothing, and content contradicting a fact returns ASK so the
  correction goes through `remember_fact`. Storing both was rejected because it
  leaves the stores able to hold contradictory current values indefinitely and
  moves reconciliation into every query. Auto-routing free text to
  `(subject, predicate, value)` was rejected for now because a misfire writes a
  wrong structured fact silently; it remains an upgrade to this design rather
  than an alternative to it.
- ADD, ASK, and SKIP stayed on the same axis as the existing actions, in one
  model response. The gate returns exactly one action, so `classify.ts` did not
  need to split.
- Validity fields mean the same thing in both tables, and the derived-age
  rejection is enforced at write time in `normalizePredicate`.

### Status as of 2026-08-12

Merged: the recall baseline harness and `isMemoryRetrievable` (#27), structured
facts with the precedence refusal (#26), and the ungrounded-capture fallback
(#28). Both stores now share one retrievability rule.

Outstanding, in the order they are worth doing:

- Re-record the baseline now that facts have merged, and compare against the
  table above. This is the delta the first run exists to make measurable.
- The cross-store fixture, which precedence unblocked: seed a fact, attempt a
  narrative capture of the same information, assert exactly one current value
  across both stores.
- Phase 2's remaining items: `forget_thought` spanning thoughts, facts, and
  entities; the `procedural` thought type; the automatic recall hook.
- Core-memory deduplication stays evidence-gated and may now be unnecessary,
  since a fact keyed by entity and predicate cannot be restated into a
  duplicate.

Operational items that are not code:

- Vercel preview deploys fail on pull requests from the `jordan-hivemind` fork
  with "Authorization required to deploy" and need a one-time authorization.
  Production is unaffected, and CI runs `pnpm build`, so the build stays
  covered either way.
- Qodo's citation ruleset is configured outside this repository and still
  rejects `fact:<id>`. Both in-repo enumerations were updated; the external
  rule needs the token added.
