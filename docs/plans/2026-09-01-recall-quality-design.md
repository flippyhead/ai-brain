# Recall Quality — Design

**Goal:** Make `recall_context` return the right memories, in a budget the caller
can afford, annotated with what the brain does not know.

**Origin:** the GBrain comparison (`docs/comparisons/gbrain.md`). Export was
on that list and was built separately (`pnpm export:brain`) as the precondition
for the bake-off, so it is not a workstream here. The remaining four ideas are
kept, and one larger defect was found while planning them and is now first.

**Architecture:** four independent workstreams against the existing retrieval
path (`packages/convex/convex/models/facts/`,
`packages/convex/convex/models/thoughts/`, and the recall handler in
`apps/web/src/lib/mcp/server.ts`), plus one decision gate that builds nothing
until it is answered.

---

## The ordering principle

W1 and W2 change **what is retrieved**. W3 changes **what fits**. W4 annotates
**what is there**. Shaping and annotating a window that is missing the right
memory is wasted work, so retrieval quality comes first. W5 is a surface-area
commitment and is gated on a decision, not scheduled.

| #   | Workstream                          | Changes            | Size           |
| --- | ----------------------------------- | ------------------ | -------------- |
| W0  | Blend policy: core and fact slots   | what is retrieved  | small          |
| W1  | Semantic recall for facts           | what is retrieved  | medium         |
| W2  | Exact-entity lookup tier            | what is retrieved  | small          |
| W3  | Budget-aware recall shaping         | what fits          | small          |
| W4  | Gap analysis in the recall envelope | what is reported   | medium         |
| W5  | MEMORY_VERBS v1 conformance         | the public surface | decision first |

---

## W0 — The blend policy buries the right memory (found by the bake-off)

**Status: implemented** in PR #40 — `coreLimitFor(5)` is 1 (one more per
further five), core slots are facts only, and facts fill at most a third of
the relevance slots with no floor. The five lost shapes are eval cases.

**Evidence.** In the 2026-09-02 bake-off (`docs/comparisons/gbrain-bakeoff.md`)
AI Brain lost five of twelve questions on retrieval: the right memory existed
and `recall_context` did not return it. The diagnostic: at the default limit of
5, `coreLimitFor` reserves three slots, so the same two core facts and one
core meeting note arrived in all twelve payloads and only two slots were left
for relevance. Of those, facts are guaranteed at least half, and fact search is
keyword-only, so unrelated facts took slots on unrelated questions. Re-asking
at limit 8 surfaced the missing memory — eighth of eight.

**Design.** Two changes in `models/recallBlend.ts`, both small:

1. Core takes at most one slot at the default limit, and only facts — a
   narrative memory flagged `isCore` should not ride along on every question.
   `coreLimitFor(5)` = 1, not 3.
2. Facts are not guaranteed half the relevance slots until W1 lands. Until fact
   search can rank semantically, a guaranteed fact slot is a guaranteed junk
   slot on any question the keyword index cannot serve.

The eval harness shares this policy, so the change is measured by the same
cases that measure the tool. Add the five lost bake-off questions as eval
cases before changing anything, so the fix is visible as recall@5 going up.

**Why it comes before W1.** It is a one-file change, it would have flipped four
of the five lost questions, and it makes W1's effect measurable rather than
mixed in with a slot-budget artefact.

## W1 — Facts have no semantic recall

**This was not on the GBrain list. It is the largest recall defect in the
system and it was found while planning the others.**

`facts` carries a `by_searchText` search index and nothing else
(`packages/convex/convex/schema.ts:33-43`). There is no `embedding` field and no
vector index. `searchFacts` (`models/facts/model.ts:554-576`) is therefore pure
keyword matching over `searchText`.

Meanwhile `thoughts` gets the full treatment: a 1536-dimension vector index plus
a text index, fused with Reciprocal Rank Fusion at K=60
(`models/thoughts/actions.ts:380-470`).

The consequence is concrete. The fact "Peter Brown — therapist: Sara Smucker
Barnwell" is retrievable by the word _therapist_ and not by _"who do I see for
mental health"_, _"my counselor"_, or _"the person I talk to about work
stress"_. The precise half of the hybrid memory model — the half the README
calls authoritative — is the half that cannot be reached semantically.

**Design.** Give facts the same retrieval path thoughts already have:

1. Add `embedding: v.optional(v.array(v.float64()))` to `factFields`
   (`models/facts/validators.ts:66-80`) and a `by_embedding` vector index on
   `facts` mirroring the thoughts index, filtered on `userId`.
2. Embed `searchText` on write, reusing
   `internal.models.thoughts.helpers.generateEmbedding` — same model
   (`text-embedding-3-small`), same 1536 dimensions, no new provider surface.
3. Fuse vector and keyword hits with the same RRF constant and the same
   one-based rank convention as thoughts, so the two stores rank comparably.

**The structural catch, stated up front:** `searchFacts` today is a `QueryCtx`
function, and Convex exposes `ctx.vectorSearch` only inside actions. Fact search
must move to an action the way thought search already did
(`models/thoughts/mcpActions.ts`), with `mcpQueries.search` either retired or
kept as the keyword-only fallback for callers without an embedding budget. This
is the bulk of the work in W1 — the embedding itself is a dozen lines.

**Cost.** One additional embedding call per fact write. A fact write is already
rare relative to a thought capture, and `remember_fact` is currently doing zero
model calls, so this moves it from free to roughly the cost of a capture's
embedding. Backfilling existing facts is a one-time migration of trivial size
at current volume.

**Open question.** Whether a superseded fact should keep its embedding. Keeping
it costs storage and makes historical recall work; dropping it saves nothing
meaningful at this volume. Recommend keeping it.

---

## W2 — Exact-entity lookup tier ahead of fusion

GBrain runs an exact-lookup tier before fusion so that a query naming a thing
that resolves gets that thing first, rather than whatever ranked highest.
AI Brain has the index for this and does not use it on the read path.

`entities` carries `by_userId_kind_normalizedName`
(`schema.ts:25-31`), and every fact points at a subject entity. When a query
contains a token sequence that normalizes to a known entity name or alias,
that entity's current facts should be served ahead of ranked results —
"who is my therapist" should not depend on RRF putting the therapist fact above
a narrative thought that also says the word.

**Design.**

1. A read-only resolver in `models/facts/model.ts`. **`resolveEntity`
   (`model.ts:145`) must not be used** — it takes a `MutationCtx`, and it
   creates the entity on a miss and patches aliases on a hit. A read path that
   calls it would write an entity for every unrecognized proper noun in a
   user's message. The new resolver takes `QueryCtx`, returns
   `Doc<"entities"> | null`, and writes nothing.
2. Candidate extraction from the query: normalize with the existing
   `normalizeEntityName`, then test n-grams against `normalizedName` via the
   index.
3. Alias matching needs a decision. `normalizedAliases` is an array field, so
   Convex cannot index it directly. Two options:
   - **(a) Bounded per-user entity scan.** At current volume (tens of entities)
     this is free and simple. Revisit above roughly 5,000 entities.
   - **(b) An `entityAliases` join table** — one row per alias, indexed.
     Correct at any scale, more schema.
     **Recommend (a) now**, with the threshold written into a comment so the
     trigger for (b) is explicit rather than discovered under load.
4. Exact hits enter the blend as a new source tier ahead of `core`, capped so
   they cannot consume the whole window — the same reasoning
   `blendRecallContext` already applies to core facts
   (`models/recallBlend.ts:56-60`).

**Open question.** Whether an exact hit should suppress the same fact arriving
through the relevance tier, or whether dedup by ID is sufficient. Dedup by ID
is almost certainly sufficient; the blend already does this for core.

---

## W3 — Budget-aware recall shaping

**A correction to the comparison document:** the claim that recall has "no size
bound" was imprecise. There are two bounds today — `truncateContext` caps each
thought at 4,000 characters (`server.ts:254-259`), and the response declares
`_meta: { "anthropic/maxResultSizeChars": 50000 }` (`server.ts:766`).

What is missing is not a bound, it is **allocation**. Three specific problems:

1. **Blind spend.** Eight results at 4,000 characters each is 32,000 characters
   — roughly 8,000 tokens — spent without regard to whether the eighth result
   was worth a tenth of the first. A long, weakly-relevant thought and a short,
   exactly-relevant fact compete on equal footing.
2. **Blind truncation.** `truncateContext` cuts at a character offset. A
   4,001-character thought loses its last sentence mid-word, and the caller
   cannot tell whether the ellipsis hid something material.
3. **Silent loss.** Nothing in the response says trimming happened, so a client
   cannot ask for more.

**Design.** Replace the per-item cap with a total budget:

- A single `maxContextChars` for the whole envelope, defaulting well under the
  declared 50,000 and overridable per call.
- Allocation proportional to tier: exact hits and core get their full text;
  relevance items share what remains, longest-first, so one long item is
  trimmed before four short ones are dropped.
- Truncation at a sentence or paragraph boundary rather than a character
  offset.
- A `truncated: true` marker on any trimmed item and a count in the envelope,
  so the loss is visible.

Small, self-contained, and entirely inside the MCP layer — no schema change.

---

## W4 — Gap analysis in the recall envelope

The single most-cited reason GBrain reads as a brain rather than a search box is
that `gbrain think` says what it does not know. That behavior does not require
GBrain's synthesis layer or a second model call: at the moment `recall_context`
assembles its window it already holds everything needed to compute the useful
gaps.

**Design.** Add a `gaps` block to the response, computed from data in hand, with
no additional model call:

- **Stale.** The newest returned memory is older than a threshold. Says
  plainly: _nothing has been added on this since 14 June._
- **Disagreement.** A returned fact and a returned thought carry different
  values for the same subject and predicate. The eval harness already treats
  this as a first-class failure — `forbiddenExactStrings` exists precisely to
  catch "the structured and narrative stores disagreeing on the same predicate"
  (`models/thoughts/memoryEval.ts:20-24`). What the harness catches in CI, the
  live tool should report to the caller.
- **Thin.** Fewer results than requested, or every result below a score floor —
  the brain is guessing, and the caller should know before quoting it.
- **Settling.** A returned current fact whose predecessor was superseded
  recently. The lifecycle data is already stored (`supersededAt`,
  `supersededBy`, `changeReason`); this reads it.

**Placement.** A sibling key in the response envelope, not prose mixed into the
memory list — the memories stay machine-parseable. The tool description then
instructs clients to surface gaps when answering.

**Explicitly not in scope.** Synthesis. `recall_context` keeps returning
memories, not answers. Composing the answer is the client's job and it is
already good at it; the value here is the honest footnote, not the prose.

**Open question.** Thresholds — how old is stale, how low is thin. Recommend
starting with fixed, commented constants and only making them configurable if
they turn out to be wrong in practice.

---

## W5 — MEMORY_VERBS v1 conformance (decision gate)

GBrain publishes a frozen wire protocol — `recall`, `remember`, `entity`,
`synthesize`, `forget`, `context_pack`, `delta` — with a conformance runner
(`gbrain protocol conformance --target <endpoint>`). Field names and semantics
are frozen forever; additions must be optional.

**What it buys.** Any harness already wired to those seven verbs could point at
AI Brain without changes. That is real reach for a project whose current reach
is whatever Peter wires up by hand, and it requires adopting no GBrain code —
only its interface.

**What it costs.** Twenty-two tools have to map onto seven verbs, which means
either a second surface alongside the existing one or a translation layer.
Response envelopes gain required fields (`protocol_version`, evidence,
provenance, cost). And `synthesize` is a verb AI Brain has no implementation
for — W4 deliberately stops short of it.

**This is a positioning decision, not an engineering one, and it should not be
scheduled until it is answered:**

> Is AI Brain a private memory service for one person's agents, or a memory
> server other people's harnesses connect to?

If the first, W5 is cost with no return and should be dropped from the roadmap.
If the second, it is the cheapest distribution available and W1–W4 should be
built with the verb envelope in mind rather than retrofitted into it.

**Recommendation: answer this before starting W1**, because the answer changes
nothing about W1–W3 but does change the shape of W4's response envelope.

---

## Sequencing

```
W1 semantic facts ──┐
                    ├──► W3 budget shaping ──► W4 gap analysis
W2 exact lookup  ───┘

W5 ── decision gate (answer before W4 lands)
```

W1 and W2 are independent of each other and can land in either order. W3 is
easier once both are in, because the blend it is budgeting has its final shape.
W4 depends on W3 only in that both touch the same response assembly.

## What this does not do

- **No export work.** Export exists (`pnpm export:brain`) and is an operator
  command, not a retrieval concern; nothing here changes it.
- **No ingestion.** The client-mediated constraint stays. Nothing here adds a
  cron, a connector, or a background job.
- **No link graph.** Typed edges and traversal are the other genuinely strong
  GBrain idea, and they are a larger change than everything above combined.
  Revisit after W1–W4 if entity-to-entity questions turn out to be common.
- **No synthesis.** See W4.
