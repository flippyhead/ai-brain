---
name: brain-thread
description: Reconstruct the chronological evolution of thinking around a topic or anchor thought. Walks the timeline around a seed, hydrates the most substantive neighbors, and produces a citable narrative.
argument-hint: <topic or thought-id> [--type <type>]
---

# Brain Thread

Trace how your thinking on a topic evolved over time. Given a seed — either a topic (free text) or a thought ID — walk the chronological neighbors via `timeline_thoughts`, hydrate the most substantive ones, and produce a cited narrative.

## Prerequisites

`mcp__ai-brain__search_thoughts`, `mcp__ai-brain__timeline_thoughts`, and `mcp__ai-brain__get_thoughts` must be available. If not, tell the user to install/update the AI Brain plugin and stop.

## Arguments

- `$ARGUMENTS` — Required:
  - A topic, e.g. `/brain-thread "COPA remodel"`
  - OR a thought ID, e.g. `/brain-thread thought:abc123xyz` or `/brain-thread abc123xyz`
- Optional flag:
  - `--type <decision|person_note|idea|meeting_note|task|reference>` — filter the timeline to one thought type

Parse `$ARGUMENTS` to extract:
- `seedInput` — the non-flag portion (quoted topic or ID)
- `type` — the `--type` value if present

## Workflow

### Step 1: Resolve the Seed

Detect whether `seedInput` is an ID or a topic.

- **ID pattern:** matches `^thought:[a-zA-Z0-9_-]+$` or a bare identifier of at least 16 chars (Convex IDs are longer).
- **Topic pattern:** anything else (quoted or unquoted free text).

**If ID:** strip the `thought:` prefix (if present) and use it directly as `seedId`. Skip to Step 2.

**If topic:**
1. Call `mcp__ai-brain__search_thoughts` with `query: <topic>`, `limit: 10`, and `type: <type>` if a type filter was provided.
2. If zero hits, tell the user: "No thoughts match '[topic]'. Try a different query or check `/brain-init` if your brain is empty." Stop.
3. If one hit dominates by score (score > 2× the next best), auto-pick it and announce: "Using seed: [summary] (`thought:<id>`)."
4. If multiple close candidates, show the user the top 3-5 as a list:
   ```
   Multiple possible seeds for "[topic]":
   1. [summary] (`thought:<id>`) — [snippet preview]
   2. [summary] (`thought:<id>`) — [snippet preview]
   ...
   Which one should I thread from? (number, or paste another ID)
   ```
   Wait for the user's pick. Use their selection as `seedId`.

### Step 2: Walk the Timeline

Call `mcp__ai-brain__timeline_thoughts` with:
- `seedId`: the resolved seed
- `before`: `10`
- `after`: `10`
- `type`: `<type>` if provided, omit otherwise

The result is an ordered array of up to 21 compact index rows, seed included. If only the seed is present (no neighbors), tell the user: "This thought has no chronological neighbors yet — there's nothing to thread. Try a broader topic or come back after more captures." Stop.

### Step 3: Triage and Hydrate

From the timeline, select the 3-5 most substantive neighbors (plus the seed) to hydrate. Signals of substance:
- Summary mentions a decision, turning point, or concrete change
- Distinct topics from the surrounding rows (not just a repeat)
- Type is `decision` or `meeting_note` over `reference` when both are present

Call `mcp__ai-brain__get_thoughts` with `ids: [<selected IDs including seed>]`.

### Step 4: Synthesize the Narrative

Write a markdown narrative with this optional structure:

```markdown
## Thread: [short topic inferred from seed]

**Before the turn**
<1-2 paragraphs covering thoughts chronologically before the seed or pivotal point. Cite each claim as `thought:<id>`.>

**The turn**
<1 paragraph covering the seed thought itself — the pivotal moment the thread centers on. Cite as `thought:<seedId>`.>

**After**
<1-2 paragraphs covering how thinking evolved after. Cite each claim as `thought:<id>`.>

---

**All thoughts in this thread** (for reference):
- `thought:<id>` — <summary> (<date>)
- `thought:<id>` — <summary> (<date>)
- ...
```

If the thread is very short (3-4 thoughts), simplify to a single narrative paragraph followed by the reference list.

**Never write a claim without a citation.** If a statement doesn't map to a hydrated thought, remove it.

### Step 5: Offer Next Steps

After the narrative, suggest:
- "Want to widen the window? Try `/brain-thread thought:<seedId> --type decision` or increase the range by running again."
- "Want the full context around a specific turn? Use `/brain-context <date>` anchored on that thought's createdAt."
