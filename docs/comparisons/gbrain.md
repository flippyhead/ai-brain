# AI Brain vs GBrain

A grounded comparison of this project against [garrytan/gbrain](https://github.com/garrytan/gbrain)
(v0.47.9.0, MIT). Read from both codebases on 2026-09-01, not from either
project's marketing copy.

## The one-sentence difference

GBrain is a markdown brain you own on disk with a Postgres index and a daemon
that fills it while you sleep; AI Brain is a hosted, account-isolated memory
service whose value is what it *refuses* to store and how carefully it retires
what changed.

They are not the same product. GBrain optimizes for **volume and autonomy**
(155k pages, 66 crons, ingestion connectors). AI Brain optimizes for
**precision and lifecycle** (typed facts, an admission gate, supersede/retract
history, bitemporal validity).

## Scale

|                    | AI Brain                   | GBrain                        |
| ------------------ | -------------------------- | ----------------------------- |
| Source lines (TS)  | ~16,300 (excl. generated)  | ~392,800 in `src/`            |
| Test files         | 22                         | 2,038                         |
| Public surface     | 22 MCP tools               | 100+ MCP ops, or 7 frozen verbs |
| Skills shipped     | 5 (Claude Code plugin)     | 85 skill directories          |
| CLI commands       | none                       | 159                           |
| History            | 132 commits since 2026-03  | v0.47.9.0, 4 contributors here vs. a large public project |

Surface area is a feature in one direction and a liability in the other. One
person can hold all of AI Brain in their head. Nobody holds all of GBrain in
theirs — which is why it ships `gbrain doctor`, a flag registry, and 30+
`check:*` drift scripts.

## System of record — the load-bearing difference

**GBrain: markdown is the system of record, the database is a derived index.**
`src/core/facts/fence-write.ts` writes a new fact into the entity page's
`## Facts` fence *first* (atomic tmp-write + `renameSync`, FS lockfile), then
stamps the DB. There is a `check:system-of-record` CI script enforcing it. The
brain lives in a private GitHub repo you can clone, grep, and delete.

**AI Brain: the database is the system of record, and there are no files.**
Memory lives in Convex tables (`packages/convex/convex/schema.ts`): `thoughts`,
`entities`, `facts`, `lists`, `reports`, `insights`. There is **no export path
in the codebase** — no markdown dump, no backup command, no cron. That is the
single biggest strategic gap relative to GBrain, and it is a gap in the
property Peter most cares about elsewhere (authoritative, durable, owned).

## Data model

**AI Brain** stores knowledge in two deliberately separate shapes:

- `entities` — stable identities for people/orgs/projects/places, with
  aliases and a normalized-name index.
- `facts` — typed subject-predicate-value rows where the value can be a scalar
  *or* an entity reference (`primary_care_provider → person:sara_smucker_barnwell`).
  Readable statement text is generated for search; the typed value stays
  authoritative.
- `thoughts` — one coherent narrative unit (a decision with rationale, project
  state, a commitment, a recurring pattern), with typed metadata
  (people/topics/actionItems/summary/type).

**GBrain** stores everything as pages and derives structure:

- `pages` (typed, GIN-indexed frontmatter) → `content_chunks` (HNSW pgvector,
  `tsvector` search) → `links` (typed edges: `attended`, `works_at`,
  `invested_in`, `founded`, `advises`), `tags`, `timeline_entries`,
  `page_versions`, `open_loops`.
- Facts exist too, but as fenced blocks inside entity pages, plus a DB index.

The self-wiring graph is real and it is GBrain's headline claim: every page
write extracts entity refs and creates typed edges with **zero LLM calls**
(`src/core/link-extraction.ts`, pure functions, versioned extraction stamp so
stale pages re-extract). AI Brain has entity references on facts but **no edge
table and no traversal** — "who works at Acme?" is a search query here, a graph
walk there.

## Retrieval

Both fuse keyword and vector results with Reciprocal Rank Fusion. That is where
the similarity ends.

**AI Brain** (`models/thoughts/actions.ts`, `models/recallBlend.ts`): Convex
vector index (1536-d, userId-filtered) + full-text search index → RRF → a
*blend policy*. The blend is the interesting part and it is genuinely good
design: at most 3 core slots, of which facts take at most 2 so core facts can't
crowd out core memories; the remaining relevance slots split so facts get at
least one and at most half. One copy of that policy serves both the MCP tool
and the eval harness, on the explicit reasoning that a harness which orders
results differently "measures a window nobody sees."

**GBrain** (`src/core/search/hybrid.ts`): query intent classification →
per-intent weights and RRF-k → exact-lookup tier → relational (graph) arm →
RRF → normalize → source-tier boost (`compiled_truth` 2.0x) → cosine re-score
(0.7 RRF + 0.3 cosine) → reranker → autocut → dedup → two-pass hydration →
token budget enforcement → adaptive return, with a semantic query cache and
telemetry throughout.

And above retrieval, GBrain has a layer AI Brain has no equivalent of:
`gbrain think` synthesizes a cited answer across results *and states what the
brain doesn't know* — stale pages, uncited claims, contradictions, holes. The
gap analysis is the part that changes how the thing gets used.

## Write path and curation

This is where AI Brain is ahead, and it should not be undersold.

- **Grounding gate.** A capture without `sourceType` returns
  `needs_confirmation` and stores nothing — and returns *before* the embedding
  and admission calls, so an ungrounded capture is also free
  (`captureGrounding.test.ts`).
- **Smart Save admission.** Every candidate is compared against current memory
  and resolved to add / ignore / supersede / retract / ASK / SKIP. Broad,
  incidental, inferred, derived, or non-atomic candidates are refused. Most
  memory systems have no opinion here at all; a system that stores everything
  degrades into a log you stop trusting.
- **Lifecycle with history.** A change creates a new current record and marks
  the old one `superseded`; a correction marks it `retracted`. Both are
  preserved and linked, never overwritten. Historical results are opt-in via
  `includeHistorical`.
- **Bitemporality.** `validFrom`/`validTo` are separate from write time, so a
  known school start date or a former role is representable without pretending
  the DB write time was the event.
- **Refused derivations.** Storing a derived age is rejected in favor of an
  exact `date_of_birth`.

GBrain has adjacent machinery — `facts/supersede-resolve.ts`, `decay.ts`,
`forget.ts`, `backstop.ts`, `phantom-audit.ts`, plus overnight consolidation
and `dream_verdicts` — but its default posture is ingest-heavy, and the
cleanup runs after the fact rather than at the door.

## Ingestion and autonomy

**AI Brain has none, by design.** The README states the constraint plainly: an
MCP server cannot observe a conversation unless the client invokes a tool.
There are no crons in `packages/convex/convex/`, no connectors, no importers.
Everything in the brain got there because a client called `remember_fact` or
`capture_thought`.

**GBrain is built around the opposite premise.** `cold-start` imports Gmail,
calendar and contacts; there are skills for archive crawling, blog/media/voice
ingest, meeting ingestion, citation graphs. A minions job queue
(`minion_jobs`, `minion_inbox`, leases, quiet hours, budget meters,
crash-safe two-phase persistence) runs it, and the dream cycle enriches and
consolidates overnight.

That asymmetry explains the page counts. It is also the reason GBrain needs
`data-loss-gate`, `brain-ingest-gate`, and a `SECURITY.md` about the blast
radius of an agent with your mailbox.

## Deployment, identity, isolation

- **AI Brain**: two hosted services (Next.js gateway + Convex). MCP API keys
  are exchanged for short-lived ES256-signed Convex identities; account ID is
  derived from the identity and a caller-supplied `userId` is never accepted;
  functions fail closed without an issuer. Full OAuth 2.1 flow so ChatGPT and
  Claude can both connect as remote MCP clients. Self-hosting runbook exists.
- **GBrain**: local-first. `gbrain init --pglite` gives a brain in 2 seconds
  with no server and no Docker; `gbrain serve` is a stdio subprocess;
  `gbrain serve --http` adds OAuth 2.1, scopes, rate limiting, an admin SPA.
  Company-brain mode scopes each teammate's slice by login.

Both are credible on isolation. AI Brain's story is simpler because there is
one trust boundary; GBrain's is larger because it has to defend a filesystem, a
job queue, and a fleet of agents.

## Evaluation

AI Brain scores recall deterministically with no LLM in the loop
(`memoryEval.ts`): recall@k, plus two checks a recall count cannot catch —
another account's value reaching this account, and the structured and narrative
stores disagreeing on the same predicate. That is a sharper instrument than
most projects this size have.

GBrain publishes BrainBench (P@5 49.1%, R@5 97.9% on a 240-page corpus,
+31.4 P@5 over its graph-disabled variant) in a sibling repo, and carries
`eval_*` tables, contradiction runs, take-quality runs and cross-modal review
in-tree.

## What to take from GBrain

Ranked by value per unit of added complexity.

1. **An export path.** Markdown-per-memory into a private git repo, one
   direction, no sync. It closes the ownership gap, it is a weekend of work,
   and it makes "AI Brain is my source of truth" survivable if Convex ever
   isn't. Highest priority on this list.
2. **A gap-analysis / synthesis response.** Not full `think`, but
   `recall_context` returning *what the brain doesn't know* — the newest
   relevant memory is six weeks old, two current facts disagree, a predicate
   was asked for and is absent. Cheap, and it is the single most-cited reason
   GBrain feels different from search.
3. **An exact-lookup tier ahead of RRF.** When the query contains an entity
   name or alias that resolves, serve that first. AI Brain already has
   `by_userId_kind_normalizedName`; it just isn't used as a retrieval short-circuit.
4. **A recall token budget.** GBrain enforces one; AI Brain caps at 8 results
   with no size bound, so one long thought can dominate a context window.
5. **MEMORY_VERBS v1 conformance** (`recall`, `remember`, `entity`,
   `synthesize`, `forget`, `context_pack`, `delta`). It is a frozen, public,
   additive-forever protocol with a conformance runner. Speaking it would make
   AI Brain a drop-in for every harness that already wired up those verbs,
   without adopting any GBrain code. Worth considering precisely because it
   costs nothing architecturally.

## What not to take

- **The ingestion daemon.** It is what makes GBrain big, and it is the part
  most at odds with AI Brain's admission gate. Autonomous ingest plus a strict
  door means the door does all the work and most of it gets thrown away.
- **The skill wall.** 85 skills is a context bill every session.
- **Running both as memory.** Two memory layers drift, and then neither is
  trustworthy. This was already the standing decision; nothing found in the
  code changes it.

## Note on the capture_thought regression

A `capture_thought` grounding regression was recorded on 2026-08-31 —
every write rejected with "grounding is unknown" regardless of the `sourceType`
passed. **That is no longer reproducing.** A capture with
`sourceType: assistant_commitment` stored cleanly during this comparison
(`thought:k174nehdn1btrsfksf6k9p4n9h8dkj3b`, disposition `stored`), so the fault
is either fixed or narrower than it was logged as. The two `user_stated` and
`user_confirmed` paths were not re-tested here, since testing them means writing
junk into a live brain.

One rough edge remains and is real: `needs_confirmation` has no resolution path,
because there is no confirm tool in the MCP surface. A client that trips the
grounding gate can only give up or re-send. Whatever the state of the
regression, that gap is worth closing.
