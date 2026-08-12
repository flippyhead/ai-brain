---
name: brain-init
description: Bootstrap AI Brain with a small, reviewed set of atomic durable facts and narrative memories. Connector data produces candidates only; nothing is stored before user approval.
---

# Brain Init

Build a high-signal initial memory set. This workflow is deliberately conservative: discovery and storage are separate phases, and the user approves the proposed set before any write tool is called.

## Prerequisites

The AI Brain connector must expose `mcp__ai-brain__remember_fact`, `mcp__ai-brain__capture_thought`, `mcp__ai-brain__search_facts`, and `mcp__ai-brain__search_thoughts`. If any are unavailable, stop and ask the user to reconnect or update AI Brain.

## Non-negotiable rules

- Do not call any AI Brain write tool before Step 6 approval.
- Propose at most 15 candidates in one run.
- Each candidate must contain one subject and one independently changeable fact or one coherent narrative unit whose parts change together.
- Prefer precise structured facts over prose whenever the information is a name, exact date, relationship, provider, school, employer, location, or scalar preference.
- Never store a current age, tenure, or other derived value. Store an exact date of birth only when the complete date was explicitly stated or confirmed. Never infer a birth date from an age.
- Never infer a relationship, role, preference, priority, or permanence from activity patterns.
- A single email, meeting, message, repository interaction, or company mention is not durable knowledge.
- Skip completed-task catalogs, vendor/company lists, browsing or activity logs, small talk, speculative ideas, credentials, authentication data, and secrets.
- Existing assistant memory and connector content are evidence, not automatically true user facts.
- If a fact may have changed, distinguish `changed` (old value was formerly true) from `corrected` (old value was inaccurate).

## Step 1: Check current brain

Call `mcp__ai-brain__get_stats`. Tell the user whether this is an empty bootstrap or a proposed addition to an existing brain. Do not imply that existing content will be overwritten.

## Step 2: Discover sources

Identify sources available in the current session:

1. Direct statements and confirmations in the current conversation.
2. User-authored instruction or memory files such as `~/.claude/CLAUDE.md`, when the client can read them.
3. Existing AI Brain facts and thoughts.
4. Connected email, calendar, Slack, GitHub, project-management, or file tools.

Report only which source categories are available. Do not perform an exhaustive scan.

## Step 3: Gather bounded evidence

Use the smallest amount of source material needed to find durable candidates.

- Direct user statements may support a candidate by themselves.
- User-authored instruction files may support explicit preferences or identity facts.
- Connected tools may suggest candidates, but never establish them. Use recent data only to identify a small number of potentially important people, projects, or recurring contexts worth asking about.
- Do not enumerate frequent contacts, companies, meetings, tasks, channels, or repositories into memory.
- Do not quote or save private message/email content. In the preview, name the source category and provide a short paraphrased rationale.

Stop gathering once 15 plausible high-value candidates have been found.

## Step 4: Normalize and admit candidates

For every candidate, decide one of:

- `PROPOSE`: explicit or plausibly important, durable, atomic, and useful later.
- `ASK`: potentially useful but needs the user's confirmation or a missing exact value/date.
- `SKIP`: incidental, inferred, derived, transient, noisy, sensitive, or redundant.

Do not show ordinary `SKIP` items unless explaining why a tempting category was excluded. Never turn an `ASK` candidate into a stored fact without a user answer.

Choose a storage form:

### Structured fact

Use for precise subject-predicate-value knowledge. Prepare:

- subject `key`, `kind`, and canonical `name`
- stable snake_case `predicate`
- typed `value`
- `validFrom` or `validTo` only if explicitly known
- `isCore` only for a very small set of broadly useful enduring facts

Examples:

- `person:zevin` / `date_of_birth` / exact date
- `person:jordan` / `primary_care_provider` / entity `person:dr-jane-smith`
- `person:zevin` / `current_school` / entity `organization:downtown-school`

### Narrative thought

Use only for one durable decision with rationale, one coherent project state, one commitment, or one recurring pattern. Keep it concise. Do not use headings such as “About me,” “My team,” or “Active projects” to combine unrelated knowledge.

## Step 5: Check for existing knowledge

For each proposed fact, call `mcp__ai-brain__search_facts` using the exact subject name and predicate. For each proposed narrative, call `mcp__ai-brain__search_thoughts` using exact names and identifiers.

- Remove duplicates.
- If a current single-valued fact conflicts, explicitly ask whether the new value represents a change or a correction.
- Do not erase or silently overwrite the older state.

## Step 6: Preview and request approval

Show one compact table with no more than 15 rows:

| #   | Proposed memory | Form | Source | Temporal handling | Core? |
| --- | --------------- | ---- | ------ | ----------------- | ----- |

Then list any `ASK` questions separately. State how many noisy candidates were excluded and give category-level examples, not a long rejected list.

Ask the user to approve all, approve selected row numbers, edit them, or cancel. Stop and wait. Do not write anything in this step.

## Step 7: Store only approved candidates

Create one batch id in the form `brain-init:<ISO timestamp>`.

For each approved structured fact, call `mcp__ai-brain__remember_fact` with:

- `sourceType: user_confirmed`
- the batch id
- one subject, predicate, and typed value
- `cardinality: single` unless concurrent values are genuinely valid
- `changeKind: changed` or `corrected` based on the user's answer
- validity dates only when explicitly known

For each approved narrative, call `mcp__ai-brain__capture_thought` with:

- `sourceType: user_confirmed`
- the batch id
- one concise coherent narrative unit

If a write is declined by the admission gate, report it; do not weaken or reword the candidate merely to force storage.

## Step 8: Report

Report:

- facts stored, citing each as `fact:<id>`
- narrative memories stored, citing each as `thought:<id>`
- duplicates left unchanged
- candidates not stored and why

End by saying that future direct durable facts can be captured automatically; connector-derived information will continue to require confirmation.
