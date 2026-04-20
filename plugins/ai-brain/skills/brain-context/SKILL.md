---
name: brain-context
description: Restore the context of a specific moment — what was happening, what decisions were in flight, what was on your mind. Anchors on a date or event, pulls the timeline window, synthesizes a brief.
argument-hint: <time reference>
---

# Brain Context

Restore what was in your head at a specific moment. Given a time reference — a date, range, or event-like phrase — pull a window of thoughts via `timeline_thoughts`, hydrate the most diverse and substantive ones, and produce a cited brief.

## Prerequisites

`mcp__ai-brain__search_thoughts`, `mcp__ai-brain__timeline_thoughts`, and `mcp__ai-brain__get_thoughts` must be available. If not, tell the user to install/update the AI Brain plugin and stop.

## Arguments

- `$ARGUMENTS` — Required, free text:
  - A date: `/brain-context "April 10"`, `/brain-context "last Thursday"`, `/brain-context "2026-04-15"`
  - A range: `/brain-context "the week of April 15"`
  - An event-like phrase: `/brain-context "the week we picked Convex"`

## Workflow

### Step 1: Resolve the Anchor Timestamp

Determine whether `$ARGUMENTS` is a parseable date or an event phrase.

**Try date parsing first:**
- ISO 8601 (`2026-04-15`, `2026-04-15T10:00`) → epoch ms directly.
- Natural language date (`April 10`, `last Thursday`, `yesterday`) → convert to epoch ms at noon local time of that day.
- Range phrases (`the week of April 15`) → use the Monday of that week at noon as the anchor, and widen the `before`/`after` values (see Step 2).

**If date parsing fails, treat as an event-like phrase:**
1. Call `mcp__ai-brain__search_thoughts` with `query: $ARGUMENTS`, `limit: 5`.
2. If zero hits, tell the user: "I couldn't parse '[input]' as a date or find a matching event in your brain. Try a specific date (e.g. `April 10`) or a phrase from an actual thought." Stop.
3. If one clear match, use its `createdAt` as `aroundMs` and announce: "Anchoring on [summary] from [ISO date] (`thought:<id>`)."
4. If multiple close matches, list them and ask the user to pick one.

Call the resolved timestamp `aroundMs`.

### Step 2: Pull the Window

Default window sizes:
- Single day (date input): `before: 15`, `after: 15`
- Range (week of X): `before: 25`, `after: 5` (looking back across the week, small look-ahead)

Call `mcp__ai-brain__timeline_thoughts` with:
- `aroundMs`: the resolved timestamp
- `before`: per above
- `after`: per above
- `type`: omit (want everything for context)

If the result array is empty, tell the user: "No thoughts captured around [date]. Try a wider range or a different moment." Stop.

### Step 3: Triage for Diversity

From the compact index, select 5-8 thoughts to hydrate, optimizing for diversity:
- Distinct `type` values when possible (decision, meeting_note, person_note, idea, task, reference)
- Distinct `topics` — avoid two thoughts with overlapping topic lists if similar summaries
- Distinct `people` mentioned — try to cover multiple collaborators if relevant

Skip obvious repeats and low-signal rows (empty topic/people, generic summaries).

Call `mcp__ai-brain__get_thoughts` with `ids: [<5-8 selected IDs>]`.

### Step 4: Synthesize the Brief

Write a markdown brief organized for quick orientation:

```markdown
## Context: [date or event anchor]

**What was happening**
<1-2 sentence summary of the period's dominant themes, citing 2-3 anchor thoughts as `thought:<id>`.>

**Decisions in flight**
<bullet list of any decisions or choices under consideration — each cited as `thought:<id>`. Omit section if none.>

**People involved**
<bullet list grouping thoughts by the people they mention — e.g. "Emma: hiring conversation (`thought:<id>`), product sync (`thought:<id>`)". Omit if nothing is people-tagged.>

**Projects and topics**
<bullet list grouping thoughts by project/topic — cite each with `thought:<id>`.>

**Open questions from that moment**
<bullet list of questions, uncertainties, or unresolved threads from the hydrated thoughts — each cited as `thought:<id>`. Omit section if none.>

---

**Full window** (for reference):
- `thought:<id>` — <summary> (<date, or just time if all same day>)
- ...
```

For a single-day anchor, the sections above may collapse — just produce whichever sections have content.

**Never write a claim without a citation.** If a statement doesn't map to a hydrated thought, remove it.

### Step 5: Offer Next Steps

After the brief, suggest:
- "Want to trace how a specific thread from this window evolved? Try `/brain-thread thought:<id>`."
- "Want a wider window? Run again with an explicit date range."
