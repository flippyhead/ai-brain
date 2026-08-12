---
name: brain-sync
description: Sync the current project's context into your AI Brain. Reads project files, compares against existing brain knowledge via progressive disclosure, and captures only new or changed information.
argument-hint: [--name <project-name>]
---

# Brain Sync

Sync the current project's context into the AI Brain so future conversations have up-to-date knowledge about this project.

## Arguments

- `$ARGUMENTS` — Optional:
  - `--name <project-name>` — Override the auto-derived project name

Parse the name value from `$ARGUMENTS` if provided.

## Workflow

### Step 1: Gather Project Context

Read the following from the current working directory. Skip any that don't exist.

**Project identity:**

- `README.md`
- `package.json`, `Cargo.toml`, `pyproject.toml`, or `go.mod` (whichever exists)
- `CLAUDE.md`

**Git state:**

- Run `git branch --show-current`
- Run `git log --oneline -20`
- Run `gh pr list --limit 10` (skip if `gh` is unavailable)

**Project structure:**

- Run `ls -la` at the project root

**Strategic context:**

- If `docs/` exists, list its contents and selectively read files that reveal project direction (specs, architecture docs, roadmaps). Do not read every file.
- Read `GOALS.md`, `TODO.md`, or similar planning files if they exist.

### Step 2: Derive Project Name

If `--name` was provided, use that. Otherwise, derive the project name using this precedence:

1. The `name` field from `package.json` / `Cargo.toml` / `pyproject.toml`
2. The first heading in `README.md`
3. The current directory name (fallback)

### Step 3: Search Brain for Existing Knowledge (Progressive Disclosure)

**3a. Triage via compact index.**

Call `mcp__ai-brain__search_thoughts` with:

- `query`: the project name
- `limit`: 10
- `includeHistorical`: false

This returns a compact index: each hit has `{id, summary, snippet, type, topics, score}`. Do NOT assume full content is present — there is none; `snippet` is ~240 chars.

**3b. Identify hydration candidates.**

From the index rows, select up to 5 candidates that look materially related (by `summary` + `snippet` + `topics`). Discard unrelated or obviously-stale rows based on snippet alone.

**3c. Hydrate.**

Call `mcp__ai-brain__get_thoughts` with `ids: [<up to 5 ids>]`. This returns full content for those specific thoughts. Only these hydrated results participate in the diff.

### Step 4: Synthesize and Diff

Compare the current project state (from Step 1) against the hydrated thoughts (from Step 3c):

- Identify information that is **new** (not in any hydrated thought)
- Identify information that has **changed** (contradicts or updates an existing thought)
- Identify information that is **unchanged** (already accurately captured)

For each unchanged fact, note the `thought:<id>` that already captures it — you'll reference these in the report.

### Step 5: Sync to Brain

Based on the diff from Step 4:

**First sync** (no hydrated thoughts, or all candidates were unrelated):
Do not create a comprehensive bucket. Store up to three independently changeable units:

- Use `mcp__ai-brain__remember_fact` for an explicit project name, one-line purpose, repository, or other precise scalar attribute. Use subject kind `project`, a stable `project:<slug>` key, `sourceType: user_confirmed`, and cite the project file in `sourceRef`.
- Use `mcp__ai-brain__capture_thought` for one coherent current project state or one decision/roadmap direction. Pass `sourceType: user_confirmed` and a project-file `sourceRef`.
- Do not store a dependency/technology inventory unless the user has said it is strategically important. Do not store completed commit or PR catalogs.

Collect each returned `factId` or `thoughtId`.

**Subsequent syncs** (hydrated thoughts found):
Only capture thoughts for meaningful changes. Frame each as an update:

```
Update: <project-name> — <what changed> (<date>). <new status or direction>.
```

Skip unchanged information. If nothing meaningful has changed, capture no thoughts.

Pass `sourceType: user_confirmed` and the relevant file path as `sourceRef` for every capture. Route precise attribute changes through `remember_fact`; use `changeKind: changed` when the old value was formerly true and `corrected` only when it was inaccurate.

`capture_thought` performs the temporal reconciliation. When the prior state
is known, make the update standalone and include both what is true now and the
useful former context. The server will link the new current memory to any
superseded or retracted memories instead of overwriting them.

**No changes:**
Tell the user the brain is already up to date and skip to Step 6.

### Step 6: Report to User

Briefly tell the user:

- What was synced (or that everything was already current)
- How many new thoughts were captured, each cited as `thought:<id>`
- Key highlights of what changed — cite updates as `thought:<new-id>` and the prior thoughts they supersede as `thought:<old-id>` where applicable
- Unchanged facts cited as `thought:<id>` so the user can confirm coverage
