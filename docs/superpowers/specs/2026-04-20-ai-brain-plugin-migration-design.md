# AI Brain Plugin Migration Design

**Date:** 2026-04-20
**Author:** Peter Brown (with Claude)
**Status:** Approved for planning

## Overview

Migrate the `open-brain` Claude Code plugin out of `flippyhead/radar` and into `flippyhead/ai-brain` (this repo), renamed to `ai-brain`, upgraded to leverage the v3 server capabilities that shipped in PR #15 (hybrid search, progressive disclosure, timeline retrieval, stable citation IDs). Publish to a thin distribution repo (`flippyhead/ai-brain-plugin`) via a CI mirror so users don't clone the server source.

## Why

The plugin's behavior is server-coupled. Every breaking server change creates coordinated plugin work — PR #15 proved this: `search_thoughts` changed return shape, and the plugin's skills (still in radar) now have stale assumptions about full `content`. Colocating plugin source with server source means one PR, one version story, one source of truth. The CI mirror preserves clone-size sanity for users installing the plugin.

The "Phase 2" work originally implied by `2026-04-13-radar-local-only-phase1.md` (separating open-brain out of radar) never happened. This spec is that work, retargeted at ai-brain instead of a standalone `flippyhead/open-brain` repo.

## Goals

1. `flippyhead/ai-brain` becomes its own Claude Code marketplace hosting one plugin (`ai-brain`, v3.0.0).
2. Three existing skills (`brain-init`, `brain-sync`, `weekly-review`) are upgraded for progressive disclosure and citation IDs.
3. Two new skills (`brain-thread`, `brain-context`) leverage `timeline_thoughts`.
4. `flippyhead/ai-brain-plugin` becomes the thin distribution repo users install from.
5. `flippyhead/radar` is cleaned up: `plugins/open-brain/` directory deleted, removed from its marketplace manifest.
6. A lightweight skill→tool reference check runs in CI to catch plugin-server drift.
7. Plugin verified working end-to-end before radar cleanup.

## Non-Goals

- **No user migration.** Single user (author), clean cut.
- **No server-side changes.** All 17 MCP tools stay exactly as shipped in PR #15. No new tools, no schema changes, no changes to `apps/web/` or `packages/convex/`.
- **No repo rename.** `ai-brain` stays `ai-brain`. Vercel URL, Convex project, git remote all untouched.
- **No new plugin-side skills beyond the two specified.** `/brain-cite` and `/brain-connect` are deferred to a future plan.
- **No full server unit-test suite.** That's a sibling plan (to be written and started immediately after this one merges).

## Architecture

### Repo layout

```
ai-brain/                              (this repo root)
├── .claude-plugin/
│   └── marketplace.json               # Marketplace config for direct/dev installs
├── plugins/
│   └── ai-brain/                      # The plugin source (migrated from radar)
│       ├── .claude-plugin/
│       │   └── plugin.json            # Plugin manifest, version 3.0.0
│       ├── .mcp.json                  # MCP server URL
│       ├── CLAUDE.md                  # Plugin-dev-focused notes
│       ├── README.md                  # User-facing: what it is, install, usage
│       ├── hooks/
│       │   ├── hooks.json
│       │   └── check-brain-status.mjs
│       └── skills/
│           ├── brain-init/SKILL.md
│           ├── brain-sync/SKILL.md
│           ├── weekly-review/SKILL.md
│           ├── brain-thread/SKILL.md  (new)
│           └── brain-context/SKILL.md (new)
├── apps/web/                          # Server + UI (unchanged)
├── packages/convex/                   # Convex backend (unchanged)
├── packages/eslint-config/            (unchanged)
├── packages/typescript-config/        (unchanged)
├── docs/superpowers/specs/            # Including this spec
├── docs/superpowers/plans/            # The implementation plan lands here
└── .github/workflows/
    ├── publish-plugin.yml             # Mirror to ai-brain-plugin on version tag
    └── skill-tool-drift-check.yml     # Lightweight CI check
```

### Distribution via CI mirror

The plugin ships to users through `flippyhead/ai-brain-plugin`, a thin distribution repo:

```
ai-brain-plugin/                       (distribution repo — produced by CI)
├── .claude-plugin/
│   ├── marketplace.json               # Flat — source "./"
│   └── plugin.json
├── .mcp.json
├── skills/
├── hooks/
└── README.md                          # User-facing, preserved across publishes
```

The distribution repo is flat. Users clone ~300 KB instead of the full monorepo.

**Publish flow** (triggered by version-tag push in ai-brain, e.g. `v3.0.0`):
1. Checkout ai-brain at the tagged commit.
2. Checkout ai-brain-plugin with write access (GitHub deploy key, stored as secret).
3. Clear everything in ai-brain-plugin except `.git` and `README.md`.
4. Copy contents of `plugins/ai-brain/*` to ai-brain-plugin root.
5. Generate a flat `.claude-plugin/marketplace.json` pointing at `./`.
6. Commit with message `release: ai-brain v3.0.0` (tag reference).
7. Tag ai-brain-plugin with the matching version.
8. Push commit and tag.

**Version coupling:** distribution tags mirror source tags exactly. Distribution repo version is always derived, never drifts.

### Skills — upgrades to the three existing ones

**Approach:** moderate. Preserve each skill's structure, voice, and user-facing purpose. Rework only the parts that touch retrieval, and teach each skill to cite sources where it improves output.

- **`/brain-init`** (zero-input onboarding). Mostly write-heavy — minimal changes. At the end-of-init summary ("here's what I saved"), display `thought:<id>` citations per item saved, and suggest `/brain-thread` / `/brain-context` as natural next steps.

- **`/brain-sync`** (project context sync). Heaviest lift. Rewrite the comparison logic:
  1. `search_thoughts(query, type?)` → compact index (id + snippet + score).
  2. Triage candidates by snippet and score.
  3. `get_thoughts(ids=[...])` only for plausible matches.
  4. Compare full content; decide skip / capture new / append update.
  5. Report results with `thought:<id>` provenance.

- **`/weekly-review`** (weekly synthesis). Biggest winner from v3.
  1. Replace ad-hoc recent-thought fetching with an explicit `timeline_thoughts(aroundMs=<start-of-week>, before=0, after=50)` call — chronologically bounded window.
  2. `get_thoughts(ids=[...])` for items worth diving into.
  3. Synthesis prompt instructs the model to ground every claim in a `thought:<id>` or `insight:<id>` citation. Output becomes a citable document, not just a summary.

### Skills — the two new ones

Both new skills center on `timeline_thoughts`. They differ in entry point: topic vs. moment.

#### `/brain-thread` — reconstruct an idea's evolution

**Argument:** `<topic or thought ID>` (e.g. `/brain-thread "COPA remodel"` or `/brain-thread thought:abc123`).

**Flow:**
1. **Resolve seed.** If input matches `thought:<id>` or a bare ID string, use it directly. Otherwise `search_thoughts(query, limit=10)`. Single dominant hit → auto-pick. Multiple close candidates → show user their snippets and ask for pick.
2. **Walk timeline.** `timeline_thoughts(seedId=<picked>, before=10, after=10, type?)`. Wider default than the tool's built-in 5/5 — threads reward context.
3. **Triage + hydrate.** For the 3–5 most substantive neighbors, `get_thoughts(ids=[...])` for full content. Skip shallow ones.
4. **Synthesize.** Narrative markdown — "How the thinking evolved" — with `thought:<id>` citations anchoring each claim. Optional structure: *"Before the decision… The turn… After."*

**Output:** Markdown narrative, every claim citable.

**Use case:** "Show me how I arrived at the COPA remodel decision."

#### `/brain-context` — restore a moment

**Argument:** `<time reference>` (e.g. `/brain-context "last Thursday"`, `/brain-context "April 10"`, `/brain-context "the week we picked Convex"`).

**Flow:**
1. **Resolve anchor.** If parseable as a date/range → convert to epoch ms (treat as `aroundMs`). If event-like → `search_thoughts(query)` → best match's `createdAt` is the anchor. Bail if ambiguous with a helpful retry message.
2. **Pull window.** `timeline_thoughts(aroundMs=<ms>, before=15, after=15)`. Wider than `/brain-thread` because the user wants ambient context.
3. **Triage + hydrate.** For the top 5–8 by diversity (topics, types, people), `get_thoughts` for full content. Skip obvious repeats.
4. **Synthesize.** Compact brief — "Here's what was in your head that week" — grouped by topic or type, with citations.

**Output:** Markdown brief organized for quick orientation.

**Use case:** "I'm picking up a dropped thread. What was going on in mid-April?"

#### Shared conventions across both new skills

- `type` filter is respected if passed.
- Both fail gracefully when the brain is empty ("nothing to work with — try `/brain-init` first").
- Both inherit large-payload handling via `get_thoughts`.

### Hook

`check-brain-status.mjs` from radar ports directly over. It's a SessionStart hook that pings `ai-brain` MCP via `get_stats`; if the brain is empty or near-empty, it prints a one-line nudge suggesting `/brain-init`.

**Changes:**
- File moves from `plugins/open-brain/hooks/` → `plugins/ai-brain/hooks/`.
- Internal `open-brain` references renamed to `ai-brain`.
- Nudge text updated to mention the two new skills alongside `/brain-init`.
- Behavior, timeout, error handling unchanged.

### Skill→tool drift check (CI)

A GitHub Action that runs on every PR to `ai-brain`:

1. Parse all SKILL.md files under `plugins/ai-brain/skills/` and extract referenced MCP tool names (e.g. `search_thoughts`, `timeline_thoughts`, `get_thoughts`).
2. Read the tool registration in `apps/web/src/lib/mcp/tools.ts` (`MCP_TOOL_NAMES` object).
3. Fail the check if any skill references a tool name that isn't registered.

**Why this matters:** the new single-repo colocation risks coupling drift (change a tool, forget to update the skill). This check catches drift before it reaches users. It's 30 minutes of CI work and directly prevents the class of breakage we just created the risk for.

**Format:** Node.js script in `.github/workflows/`, roughly 50 lines, zero dependencies. Runs as a standalone step in a `skill-tool-drift-check.yml` workflow.

## Sequencing

Strict order. Do not skip ahead.

### Phase 1 — Plugin working in ai-brain itself

1. Create `plugins/ai-brain/` scaffold: directories, stub skills, `plugin.json` at v3.0.0, `.mcp.json`, `hooks.json`.
2. Create `.claude-plugin/marketplace.json` at repo root.
3. Migrate + upgrade the three existing skills (`brain-init`, `brain-sync`, `weekly-review`).
4. Write the two new skills (`brain-thread`, `brain-context`).
5. Migrate the hook (`check-brain-status.mjs`).
6. Install locally from the source repo (`/plugin marketplace add` from local path or GitHub). Verify: plugin loads, SessionStart hook fires, every skill invokes its tools correctly against the live v3 server.

### Phase 2 — CI and distribution

7. Create `flippyhead/ai-brain-plugin` (empty public repo).
8. Write the GitHub Action `publish-plugin.yml` in ai-brain.
9. Set up deploy key / repo secret for cross-repo push.
10. Tag `v3.0.0-rc.1`, trigger the Action, verify ai-brain-plugin populates correctly.
11. Install from the distribution repo in a fresh directory. Verify parity with Phase 1 local install.
12. Add `skill-tool-drift-check.yml`. Push a test PR that intentionally renames a tool without updating the skills, verify the check fails.

### Phase 3 — Radar cleanup

Only after Phase 2 is verified:

13. In `flippyhead/radar` (separate PR): delete `plugins/open-brain/`, drop it from `.claude-plugin/marketplace.json`, remove from `README.md` and `CLAUDE.md`, bump radar's marketplace-level version (marketplace.json changed), commit, tag.
14. Locally: uninstall `open-brain@radar`, install `ai-brain@ai-brain-plugin`, verify the actual workflow (daily session, brain-sync, weekly-review) still works end-to-end.

### Phase 4 — Documentation and final polish

15. Update ai-brain root `README.md` to mention the plugin and link to the distribution repo.
16. Confirm plugin's own `README.md` is user-facing: install steps, skills, MCP URL, troubleshooting.
17. Release tag `v3.0.0` (promotes from `v3.0.0-rc.1` if CI is green).

## Verification strategy

No test framework in the project for this plan's scope. Verification is structured manual testing plus the CI drift check.

**Per-skill smoke test** (documented as a checklist in the plan):
- `/brain-init` — runs clean against an empty brain; summary includes `thought:<id>` citations.
- `/brain-sync` — captures a fabricated new thought; correctly skips an existing near-duplicate; output cites provenance.
- `/weekly-review` — produces citable markdown for a week's worth of thoughts; every synthesis claim has a citation.
- `/brain-thread` — resolves a seed thought; walks timeline; narrative structure with citations.
- `/brain-context` — resolves a date reference (date string AND event-like phrase); summary groups by topic; citations present.

**Tool coverage:**
- The CI drift check (skill→tool reference) runs on every PR.

**Hook firing:**
- Open new session with empty brain → nudge appears.
- Open new session with populated brain → no nudge.
- Verify hook completes within its existing timeout.

**Clone size sanity:**
- After first CI publish, `du -sh` on the distribution repo. Expect <1 MB.

## Version bump

- **Plugin:** `2.0.1` (in radar) → `3.0.0` (in ai-brain/ai-brain-plugin).
  - Major bump justified by: rename (`open-brain` → `ai-brain`), new install path, skill prompts require v3 server shape.
- **ai-brain server:** no bump (monorepo, not a single package; server code unchanged).
- **radar marketplace:** patch bump (marketplace.json contents changed — one plugin removed).

**Version source of truth:** the plugin's version lives in exactly one place: `plugins/ai-brain/.claude-plugin/plugin.json`. The root `.claude-plugin/marketplace.json` pulls the version from the plugin manifest at publish time (via the CI script), never hand-duplicated. The distribution repo's `marketplace.json` and `plugin.json` are both generated from that single source. This avoids the "version in three places" problem radar has.

## Radar cleanup — concrete changes

A separate PR in `flippyhead/radar`:

- `DELETE plugins/open-brain/` (entire directory and all contents)
- `MODIFY .claude-plugin/marketplace.json` — drop the open-brain entry
- `MODIFY .claude-plugin/plugin.json` — if the top-level marketplace version field is used, bump it
- `MODIFY README.md` — remove open-brain mentions, add a one-liner pointing to `flippyhead/ai-brain-plugin`
- `MODIFY CLAUDE.md` — remove open-brain-specific guidance; note the move
- Run `./scripts/bump-version.sh` if radar's script expects marketplace-level version sync

## Follow-up plan (referenced, not included)

Immediately after this plan merges, write and execute a sibling plan:

**`2026-04-21-server-test-coverage-design.md`** — add `convex-test` + Vitest to `packages/convex/`, with initial coverage for the v3 bugs (RRF merge, `truncateSnippet`, `listAroundTime` boundaries, `getByIds` ownership filter). Runs in CI on every PR.

This is out of scope for the current plan to keep the migration focused, but is the next priority.

## Risks

**R1 — Skill prompts reference tools that don't exist.**
*Mitigation:* Skill→tool drift check in CI (part of this plan).

**R2 — CI mirror leaves distribution repo in a bad state.**
*Mitigation:* Publish on tag push (explicit user action), not on main push. Test with `v3.0.0-rc.1` before real release.

**R3 — Local install path changes during dev (marketplace URL, plugin name).**
*Mitigation:* Phase 1 explicitly installs from local source path first, before the distribution repo exists. Phase 2 then installs from distribution and verifies parity.

**R4 — Radar's users are affected.** *N/A* — no users other than author. Explicitly confirmed.

**R5 — Skills regress compared to their radar behavior.**
*Mitigation:* Phase 1 skill-by-skill smoke tests before merging to main. Keep skill voice/structure largely unchanged to isolate upgrade edits.

## Open questions

None at spec approval time. All resolved during brainstorm.

## Appendix: file-by-file change summary

### In `ai-brain` (new/changed in this plan)

```
CREATE .claude-plugin/marketplace.json
CREATE plugins/ai-brain/.claude-plugin/plugin.json
CREATE plugins/ai-brain/.mcp.json
CREATE plugins/ai-brain/CLAUDE.md
CREATE plugins/ai-brain/README.md
CREATE plugins/ai-brain/hooks/hooks.json
CREATE plugins/ai-brain/hooks/check-brain-status.mjs
CREATE plugins/ai-brain/skills/brain-init/SKILL.md
CREATE plugins/ai-brain/skills/brain-sync/SKILL.md
CREATE plugins/ai-brain/skills/weekly-review/SKILL.md
CREATE plugins/ai-brain/skills/brain-thread/SKILL.md
CREATE plugins/ai-brain/skills/brain-context/SKILL.md
CREATE .github/workflows/publish-plugin.yml
CREATE .github/workflows/skill-tool-drift-check.yml
CREATE .github/scripts/skill-tool-drift-check.mjs
MODIFY README.md                     (mention the plugin, link distribution)
```

### In `ai-brain-plugin` (new repo, CI-managed)

Produced by the GitHub Action. No manual edits except `README.md` (preserved across publishes).

### In `radar` (separate PR, post-migration)

```
DELETE plugins/open-brain/           (entire directory)
MODIFY .claude-plugin/marketplace.json
MODIFY .claude-plugin/plugin.json     (if version sync required)
MODIFY README.md
MODIFY CLAUDE.md
```

## Success criteria

1. A fresh machine can run `/plugin marketplace add flippyhead/ai-brain-plugin` + `/plugin install ai-brain@ai-brain-plugin` and end up with a working plugin.
2. All five skills (three upgraded, two new) execute successfully against the live v3 server.
3. Skill→tool drift check runs green on the migration PR and blocks a test PR that introduces drift.
4. Clone size of distribution repo on install is <1 MB.
5. Radar no longer contains `plugins/open-brain/` and its marketplace no longer advertises it.
6. User's daily workflow (brain-sync, weekly-review) works end-to-end with the new plugin.
