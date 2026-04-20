---
name: weekly-review
description: Weekly synthesis of your brain thoughts, workflow insights, and goals. Surfaces gaps, open loops, and recommendations. Every claim is cited back to its source.
---

# Weekly Review

A weekly synthesis that cross-references your brain thoughts, workflow insights, and goals to surface what you'd miss looking at any one source alone.

Every claim in the output must be grounded in a source — cite thoughts as `thought:<id>`, insights as `insight:<id>`, lists as `list:<id>`.

## Workflow

### Step 1: Establish the Week's Time Window

Compute the start of the week as an epoch-ms timestamp.

- "This week" = from 7 days ago at 00:00 local time to now.
- Convert to epoch ms: `Date.now() - 7 * 24 * 60 * 60 * 1000` (rounded down to the start of the day).

Call this `weekStartMs`.

### Step 2: Pull the Week's Timeline

Call `mcp__ai-brain__timeline_thoughts` with:
- `aroundMs`: `weekStartMs`
- `before`: `0`
- `after`: `50`

This returns up to 50 compact index rows in chronological order for thoughts captured since the start of the week.

If the array is empty, tell the user: "Your brain has no thoughts captured this week. Try capturing some thoughts, or run `/brain-init` if your brain is empty." Then stop.

### Step 3: Pull Insights and Goals

**Workflow insights:**
Call `mcp__ai-brain__get_insights` with `status: "new"`, then again with `status: "noted"`. If the tool is unavailable (server doesn't expose insights for this user), note this and skip insight-dependent sections.

**Goals and priorities:**
Call `mcp__ai-brain__get_lists` with `pinned: true` to get the user's stated goals and priorities.

**Open items:**
Call `mcp__ai-brain__get_open_items` to get unfinished tracked items across all lists.

### Step 4: Hydrate Noteworthy Thoughts

From the week's timeline (Step 2), select up to 10 thoughts that look most substantive (by `summary` + `snippet` + `topics`) — the ones you'll want to cite in the synthesis.

Call `mcp__ai-brain__get_thoughts` with `ids: [<up to 10 ids>]`. Only these hydrated results can be quoted or paraphrased in the synthesis. The rest of the timeline is still referenceable by `thought:<id>` + summary.

### Step 5: Produce the Review

Generate a report with these 5 sections. Each section should be concise — the entire review should be scannable in 2 minutes. **Every factual claim must cite its source.**

---

**This Week in 30 Seconds**

2-3 sentence headline summary. What was the dominant theme? What stands out?

Cite 2-3 anchor thoughts: `thought:<id>`.

---

**Attention vs. Intention**

Compare workflow insights (what you actually did) against pinned goals (what you intended to do).

Flag:
- Goals with no corresponding session activity — "You said [goal] is a priority but had no sessions related to it" — cite the goal as `list:<id>`.
- Heavy activity on topics not in your goals — "[Topic] consumed [X]% of sessions but isn't in your goals" — cite `insight:<id>`.
- Momentum shifts — "[Topic] went from [X]% to [Y]% of sessions week over week" — cite `insight:<id>`.

If no workflow insights are available, display instead:
> "Install the `radar` plugin (`/plugin install radar@flippyhead/radar`) for time allocation analysis."

---

**Knowledge Captured**

Review the themes from saved thoughts this week. Cite each theme to an anchor thought.

Highlight:
- Topics with workflow insights but no saved thoughts — "You worked on [topic] but didn't save any knowledge about it — is there something worth persisting?" — cite `insight:<id>`.
- Repeated thought topics — building momentum on a theme — cite 2-3 `thought:<id>` examples.
- Cross-domain connections — thoughts from different contexts that might be related — cite the connected thoughts.

---

**Open Loops**

Aggregate unfinished threads from all sources:
- Open items from pinned lists — cite each `list:<id>` with item counts.
- Workflow insights still marked "new" — cite each `insight:<id>`.
- Decisions mentioned in thoughts that lack clear resolution — cite the `thought:<id>` where the decision was raised.

---

**Next Week**

2-3 specific, actionable recommendations based on the above. Be forward-looking, not retrospective. Reference specific projects, people, or decisions — with citations — when possible.

---

### Step 6: Offer to Save

After presenting the review, ask:
"Want me to save a summary of this review to your brain? This helps track trends across weeks."

If yes, save a condensed version via `mcp__ai-brain__capture_thought` with format:
"Weekly review (week of [ISO date]): [2-3 sentence summary of key themes, attention vs. intention highlights, and top recommendation]. Grounded in: thought:<id1>, thought:<id2>, insight:<id1>."

Return the new `thought:<id>` to the user so they can find this review later via `/brain-thread` or `/brain-context`.
