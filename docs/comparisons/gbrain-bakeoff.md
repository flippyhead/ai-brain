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

_Not yet run._

| Date | Questions | AI Brain | GBrain | Call |
| ---- | --------- | -------- | ------ | ---- |
|      |           |          |        |      |
