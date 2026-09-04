# AI Brain vs GBrain — the bake-off

A protocol for answering one question with evidence instead of argument:

> Does a **curated** brain answer better than a **comprehensive** one?

AI Brain refuses most capture candidates at the door and keeps what survives.
GBrain ingests broadly and consolidates afterward. Both are defensible. This
document is how to find out which one serves its owner better, using the same
memories in both.

Everything here runs on the operator's own machine. Nothing in this file
contains personal data, and nothing in the procedure asks for any to be written
down — the question set is deliberately written as _shapes_ of question, filled
in locally at run time.

## Why this exists

The comparison in `gbrain.md` is a code read. It establishes what each system
_can_ do. It cannot establish which one you would rather have, because that
depends on your memories and your questions. This is the part that needs data.

Guard against the obvious failure: **do not run two live memory layers.** This
is a time-boxed evaluation with an end date and no write-back into GBrain from
normal work. Two brains kept in parallel indefinitely drift, and then neither is
trustworthy.

## Setup

### 1. Export

```bash
pnpm export:brain --prod                                   # lists accounts
pnpm export:brain --prod --user <userId> --out ./brain-export
```

Produces:

```
brain-export/
  json/       thoughts.json, facts.json, entities.json, lists.json,
              listItems.json, manifest.json     — the faithful archive
  markdown/   people/, companies/, projects/, places/, concepts/,
              memories/, _manifest.json          — the GBrain-shaped brain
```

Add `--include-historical` to carry superseded and retracted memories too.
Leave it off for the bake-off: GBrain should be judged on the current brain, the
same one AI Brain answers from.

Check `manifest.json` before continuing. `exported.thoughts` must equal
`counts.thoughts.current`; if it does not, the export stopped early and the
comparison would be measuring a truncated brain.

### 2. Load GBrain

**This sequence is verified.** It was run end to end against GBrain v0.47.9.0
with a synthetic corpus produced by this exporter. The obvious shorter version —
`gbrain import <dir>` — imports the pages but leaves **`active facts: 0`**,
because fence reconciliation runs in the cycle phase and only for a
git-backed source. An import-only load would hand the bake-off a GBrain with no
facts at all and make it lose for a reason that is not its fault.

```bash
cd ./brain-export/markdown
git init && git add -A && git commit -m "brain export"   # sync requires a git repo
cd -

gbrain init --pglite
gbrain sync --repo ./brain-export/markdown --full        # NOT `gbrain import`
gbrain dream                                             # reconciles the ## Facts fences
gbrain extract --stale                                   # builds the graph edges
gbrain doctor
```

Set `OPENAI_API_KEY` before `sync`. Without it GBrain refuses to embed and
requires `--no-embed`, which leaves semantic search and `gbrain think` dark —
`think` returns "no LLM available" and retrieval warns `QUESTION_EMBED_FAILED`.
Running the bake-off in that state measures AI Brain's hybrid search against
GBrain's keyword index, which is not the comparison anyone wants. `gbrain think`
additionally needs `ANTHROPIC_API_KEY`.

`gbrain doctor` reporting `brain score 10/100 (embed 0/35)` means the embeddings
never ran. Fix that before asking a single question.

### 3. Verify the import was faithful

Before asking a single question, confirm GBrain received what was sent. An
unfair import produces a confident, wrong conclusion. Each of these was
confirmed working against the exporter:

- **Facts reconciled.** `gbrain dream` reports `extract_facts N fact(s)
reconciled across N page(s)`. If it says 0, the source is not git-backed and
  step 2 was skipped or reordered.
- **Lifecycle survived.** `gbrain entity people/<someone>` shows `active facts`
  equal to their _current_ fact count, not their total. A person with two
  current facts, one superseded and one retracted must read `active facts: 2`.
- **The graph wired.** After `gbrain extract --stale`, an entity referenced by
  another entity's fact shows non-zero `backlinks`, and `gbrain doctor` reports
  `graph_coverage` well above 0%.
- **Pages are retrievable.** `gbrain search "<a person's name>"` returns their
  facts as the snippet, not `| # | claim | kind | ...`. A fence-only page
  chunks to table syntax and matches nothing.

If any of these fail, stop and fix the export. A brain where retired claims read
as current, or where the graph never wired, loses on contradictions and on
traversal for the wrong reason.

## The question set

Twelve questions across six shapes, two each. Write the specific questions
locally before starting — deciding them after seeing an answer is how a
bake-off becomes a justification.

Then commit them with the run. Question text and the citation ids of the pinned
reference answers are privacy-safe; the memory contents they resolve to are not,
and do not belong in the repo. Run 1's questions were never preserved, so Run 2
had to ask new ones and could compare only at the shape level — the cheapest
possible loss to avoid, and it costs one file.

| #     | Shape                                                                                             | What it tests                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1–2   | **Exact recall.** A specific attribute of a specific person or project.                           | Precision. AI Brain's typed facts should shine; keyword-only fact search is its known weak point. |
| 3–4   | **Semantic recall.** The same attribute asked in words that never appear in the stored memory.    | Whether the store can be reached without knowing its vocabulary. This is the defect W1 addresses. |
| 5–6   | **Open loops.** What is outstanding with a named person or project.                               | Whether commitments survive as commitments.                                                       |
| 7–8   | **Change over time.** What used to be true and what replaced it.                                  | Lifecycle. AI Brain's supersede/retract chain against GBrain's fence strikethrough.               |
| 9–10  | **Synthesis across memories.** A question no single memory answers.                               | GBrain's `think` against a client composing from AI Brain's `recall_context`.                     |
| 11–12 | **Honest ignorance.** Something the brain genuinely does not know, adjacent to something it does. | Does it say so, or does it confabulate? Weighted double — see below.                              |

Ask each side identically. For AI Brain, call `recall_context` with the question
verbatim and let the client answer. For GBrain, run both `gbrain search` and
`gbrain think` and record the `think` answer.

## Scoring

Per question, 0–3:

| Score  | Meaning                                                                 |
| ------ | ----------------------------------------------------------------------- |
| 3      | Correct, complete, and sourced.                                         |
| 2      | Correct but thin, or correct with a missing qualifier.                  |
| 1      | Partially right, or right but buried in noise the reader must sort.     |
| 0      | Wrong, or nothing found.                                                |
| **−2** | **Confidently wrong.** A fabricated or retired claim stated as current. |

The −2 is the whole point. A memory system that is occasionally silent is
usable. One that is occasionally, confidently wrong is worse than no memory
system, because it poisons decisions made on top of it. Shape 11–12 scores count
double for the same reason.

Record raw answers verbatim in a scratch file, not summaries. Score afterwards,
in one pass, with the answers anonymised as to source if you can manage it.

## Reading the result

| Outcome                                           | Read                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GBrain wins clearly, including on 11–12           | Move. The curation thesis did not survive contact with data. Migrate and stop maintaining a memory platform. |
| Roughly even, AI Brain better on 11–12            | Stay. The enforcement is doing real work. Build W1 and W2, revisit W4.                                       |
| Roughly even elsewhere, GBrain better on 3–4 only | Stay, and W1 is urgent — that gap is the missing fact embeddings, not the architecture.                      |
| AI Brain wins clearly                             | Stay. Drop W5, keep the system small and opinionated.                                                        |

The trap to avoid: GBrain will almost certainly win on **breadth**, because it
can ingest mail and calendar and AI Brain cannot. That is a difference in what
each was fed, not in which brain is better. Judge only on the exported corpus,
which both sides have in full.

## Record the outcome

Write the result — scores, the four or five answers that decided it, and the
call — back into AI Brain as a decision memory, and append the summary here.
A bake-off whose result lives only in a terminal gets re-argued in a month.

## Results

### Run 1 — 2026-09-02, remote session, MCP-assembled corpus

**Setup.** No prod deploy key was available, so the corpus was pulled through
AI Brain's own MCP tools rather than the exporter: the 111 current memories
from 2026-07-29 to 2026-09-01 (a contiguous window, not a sample), plus the
three project-related facts and their two entities; two relationship facts were
deliberately left out. The same files were rendered through the shipped
exporter's renderers and loaded into GBrain v0.47.9.0 (PGLite, OpenAI
`text-embedding-3-small`, 113 pages, 122 chunks, 100% embedded, 3 facts
reconciled, 29 backlinks, graph coverage 75%). GBrain's `think` ran on
`gpt-5.5` because the available Anthropic key was identity-linked and needs a
workspace header GBrain does not send.

AI Brain answered from its full store of ~400 current memories, with questions
restricted to the window GBrain held, so AI Brain's job was harder if anything.
`recall_context` was called at its default limit of 5 — the out-of-the-box
experience — and the client (Claude) composed answers strictly from each
payload, saying "no record" when the payload lacked the answer.

Scoring by an independent judge (`gpt-5.5`, answers anonymised and positions
shuffled per question), against reference answers pinned from the corpus
before any retrieval ran. One judge score was corrected by hand: on the first
synthesis question the judge marked GBrain −2 as "fabricated", but the figure it
gave exists verbatim in a later memory — a wrong-source answer, scored 1.

| #   | Shape                       | AI Brain | GBrain | What happened                                                                                                           |
| --- | --------------------------- | -------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | exact                       | 3        | 3      | Both exact.                                                                                                             |
| 2   | exact                       | 3        | 3      | Both exact.                                                                                                             |
| 3   | semantic                    | 0        | 1      | AI Brain returned a memory that mentioned the bake-off but not the winner. GBrain named the model, missed the fallback. |
| 4   | semantic                    | 0        | 3      | AI Brain returned nothing relevant. GBrain complete.                                                                    |
| 5   | open loops                  | 1        | 3      | AI Brain returned the unbilled work, not what the client owed. GBrain assembled six memories.                           |
| 6   | open loops                  | 3        | 2      | AI Brain's current memory was exact. GBrain's chunk excerpt cut off the remaining items.                                |
| 7   | change                      | 2        | 2      | Both had the correction, neither the first figure.                                                                      |
| 8   | change                      | 0        | 1      | AI Brain returned the wrong memory. GBrain had the sequence, not the category names.                                    |
| 9   | synthesis                   | 3        | 1*     | AI Brain retrieved the exact memory. GBrain answered from a later, different measurement.                               |
| 10  | synthesis                   | 0        | 2      | AI Brain returned one of three parts. GBrain assembled all three.                                                       |
| 11  | ignorance ×2                | 3        | 3      | Both said "no record" and gave the adjacent context.                                                                    |
| 12  | ignorance ×2                | 3        | 3      | Both said "no record".                                                                                                  |
|     | **Weighted total (max 42)** | **27**   | **33** | as judged: 27 / 30                                                                                                      |

\* corrected from −2, see above.

### The read

**Neither system confabulated.** Zero −2 scores once the judge's error is
corrected. Both were perfect on honest ignorance, and GBrain's `## Gaps`
section is genuinely honest — it said what it did not know on nine of twelve
answers. The curation thesis did not separate the two on the trust axis, at
least on this corpus and these questions.

**AI Brain lost five questions on retrieval, not on knowledge.** On 3, 4, 5, 8
and 10 the right memory exists in AI Brain (it is the same corpus) and
`recall_context` did not return it. The diagnostic that explains it:

- At the default limit of 5, **three slots go to the same core set on every
  call** — two core facts and one core memory — leaving two slots for
  relevance. The core memory in question is a meeting note, not an identity
  fact, and it appeared in all twelve payloads regardless of subject.
- Of the relevance slots, the blend gives facts at least half. Fact search is
  keyword-only, so unrelated facts (a model-selection method, a bug note, an
  escrow file number) took slots on unrelated questions.
- Re-asking the semantic question at limit 8 **did** return the right memory
  — as the eighth of eight, below a five-month-old inventory note and three
  keyword-matched facts. The vector search works. The blend buries it.

This is the defect the recall-quality design already calls W1, plus a second
one it had not named: the blend policy itself.

**Where AI Brain won, it won on precision.** The two questions it took
outright (6 and 9) were ones where a single current memory answered exactly and
it retrieved that memory; GBrain's chunked excerpts lost the tail of the same
memory, and on 9 it reached for a different number. **Where GBrain won, it won
on breadth**: 5 and 10 were assembled from four to six memories with citations
and a gaps list, which is the synthesis layer doing what it claims.

### The call

Per the decision table above: **roughly even; GBrain better on retrieval;
honest ignorance tied. Stay, and fix retrieval now.** GBrain did not win on the
axis that would justify a move, and every question it took from AI Brain has a
named cause with a small fix.

Concretely, ahead of W1:

1. **Blend policy.** Stop reserving three of five slots for core on every call,
   or make core one slot; stop guaranteeing facts half the relevance slots
   while fact search is keyword-only. This is one file (`models/recallBlend.ts`)
   and it would have changed four of the five lost questions.
2. **Core hygiene.** A memory flagged `isCore` appears in every recall payload.
   Only identity-grade facts belong there.
3. **W1** as planned — facts need embeddings.

Then re-run this bake-off on the full export with the prod key. The corpus
here was a window, and the export path proper has yet to be exercised against
the real deployment.

### Run 2 — 2026-09-04, live prod store, AI Brain only

**Setup.** Solo run: AI Brain only, no GBrain side. The point of run 1 was the
move-or-stay decision, and that is settled; the point here is whether W0–W4
fixed the five retrieval losses. Run 1's verbatim questions were never
committed, so these are **new** questions on the same six shapes — per-question
comparison with run 1 is invalid, shape-level comparison is valid. Questions and
reference answers were pinned from `browse_recent` and `search_thoughts` and
frozen before any `recall_context` call.

Answered from the live prod store (~488 thoughts, 23 facts) through the deployed
MCP endpoint, confirmed running current `main` by tool-description fingerprint.
`recall_context` at default limit 5 (limit 8 on the two synthesis questions),
client composing strictly from the payload. Self-scored — no independent judge,
which is the run's main methodological weakness and is why the finding that
matters is the *shape* of the failures, not the total.

| #   | Shape                       | Run 1 | Run 2 | What happened                                                                                    |
| --- | --------------------------- | ----- | ----- | ------------------------------------------------------------------------------------------------ |
| 1   | exact                       | 3     | 3     | Rates and deposit exact.                                                                         |
| 2   | exact                       | 3     | 3     | Tax amount and due date exact.                                                                   |
| 3   | semantic                    | 0     | 0     | Run-model memory never surfaced. Two slots went to unrelated personal money facts.               |
| 4   | semantic                    | 0     | 0     | Pinecone rule never surfaced; returned the older Neon pgvector plan it revises.                  |
| 5   | open loops                  | 1     | 3     | Task memory returned with both sides of the ledger in `actionItems`.                             |
| 6   | open loops                  | 3     | 3     | Smoke test #190 plus PR 2 and PR 3, exact.                                                       |
| 7   | change                      | 2     | 3     | Both the original ≈$98k/yr figure and the corrected $104,736.76 returned together.               |
| 8   | change                      | 0     | 3     | "NOT operative marching orders" returned in full.                                                |
| 9   | synthesis                   | 3     | 1     | Build cost and existing spend, but the buy-side price book never surfaced — at limit 8.          |
| 10  | synthesis                   | 0     | 2     | Oversight call and Erik's history returned; the Ontomaton $63k thread did not.                   |
| 11  | ignorance ×2                | 3     | 3     | Payload carried "Verify copa.fyi domain registrant" as an open item. Honest.                     |
| 12  | ignorance ×2                | 3     | 3     | **Gaps block fired**: "no fact recording a school for this question; it may not be stored."      |
|     | **Weighted total (max 42)** | 27    | 33    | GBrain scored 33 in run 1.                                                                       |

### The read

**Zero confabulations again.** No −2 in either run. The trust axis holds.

**W0, W3 and W4 are working.** Core dropped from three slots to one. The gaps
block fired unprompted on the one question with no stored answer — the honest
"I don't know" is now a feature of the envelope, not of the client's manners.
The budget note reports trimming and drops instead of silently truncating.
Change-over-time went 2/0 → 3/3, and open loops 1/3 → 3/3.

**Semantic recall did not move: 0 and 0, exactly as in run 1.** This is the
finding. W1 gave *facts* embeddings, but both semantic misses are *thought*
shaped. The proof is Q11: the run-model memory Q3 could not reach came back
immediately when the query contained the literal string "copa.fyi". The memory
is retrievable by keyword and not by paraphrase, which is the original W1
complaint relocated to the thought store.

**W1 introduced a new precision problem.** With only 23 facts, most of them
personal, fact embeddings now let `money_dynamic_with_julia`,
`money_sensitivity_pattern` and `feels_loved_by` match business-finance
questions on the word "money". They took relevance slots on Q3, Q5, Q8 and Q10.
Semantic fact search is working exactly as specified and making the blend worse,
because the fact corpus is too small and too personal to be matched on affect.

**The core fact slot is spent on the same fact every time.** The therapist fact
appeared in all twelve payloads. Core *memories* are already relevance-gated —
"a core memory appears only when it is relevant" — and core *facts* are not.
That asymmetry is the remaining half of the run-1 core-hygiene defect.

**One latent −2.** Q4 returned the 3 Sep forum-search plan (a pgvector index on
Neon) which the 4 Sep Pinecone rule revises. Neither memory is formally
superseded, so a client answers with the retired plan stated as current. Scored
0, not −2, because nothing was fabricated — but that is the shape a confident
wrong answer would take.

### The call

Stay, again, and the next three fixes are named by this run, in order:

1. **Relevance-gate the core fact slot** the way core memories already are.
   One line of blend policy; it frees a slot on every single call.
2. **Thought semantic recall.** Find why paraphrase does not reach a thought the
   literal token reaches instantly. This is the whole remaining gap.
3. **Link the forum-search memory to the Pinecone rule**, or supersede it.

Not urgent, but worth naming: fact relevance should weight predicate over prose,
or personal facts will keep answering business questions while the fact corpus
is small.
