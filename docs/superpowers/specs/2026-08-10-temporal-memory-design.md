# Automatic Capture and Temporal Memory

**Date:** 2026-08-10
**Status:** Implemented

## Goal

Make AI Brain a low-maintenance memory enhancement for ordinary AI
conversations:

1. Compatible clients should notice durable information and save it without
   waiting for an explicit "remember this" command.
2. New information should become current without silently erasing useful prior
   context.
3. Information that was formerly true must be distinguishable from information
   that was simply wrong.

This is semantic memory history, not a general audit log or rollback system.

## Client-mediated automatic capture

An MCP server cannot observe the surrounding conversation. It only receives
requests when the client calls a tool. AI Brain therefore uses both MCP server
instructions and the `capture_thought` tool description to ask capable clients
to capture:

- stable personal facts and preferences;
- people and relationships;
- project context and meaningful status changes;
- decisions and rationale;
- commitments and recurring working patterns.

Clients are told not to capture transient small talk or credentials. Client
behavior still determines how consistently automatic capture occurs.

## Lifecycle

Every memory is in one logical state:

| State        | Meaning                                                                    |
| ------------ | -------------------------------------------------------------------------- |
| `current`    | Presently authoritative. Legacy rows with no state are treated as current. |
| `superseded` | Formerly true, but no longer current.                                      |
| `retracted`  | Recorded previously, but later determined to be inaccurate.                |

Smart Save produces one of four conservative decisions:

| Decision    | Result                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------- |
| `ADD`       | Insert an independent current memory.                                                     |
| `NOOP`      | Return the existing memory without creating a duplicate.                                  |
| `SUPERSEDE` | Atomically insert a new current memory and link the formerly true memories as superseded. |
| `RETRACT`   | Atomically insert a correction and link the inaccurate memories as retracted.             |

There is no destructive update or delete path in automatic capture.

## Example

Existing current memory:

> Zevin attends Lakeside School.

New conversation:

> Zevin changed schools and now attends Redwood Academy.

New current memory:

> Zevin currently attends Redwood Academy. He previously attended Lakeside
> School.

The Lakeside memory is retained unchanged as `superseded`; both records link
to one another. A correction uses `retracted` instead and explicitly says the
earlier claim was inaccurate.

## Storage

Optional lifecycle fields preserve compatibility with existing rows:

- `memoryStatus`
- `supersededAt`
- `supersededBy`
- `supersedes`
- `changeReason`

The replacement insert and prior-memory patches occur in one Convex mutation.
It validates that every prior memory is current and belongs to the same user.

## Retrieval

Search and recent browsing return current memories by default. Callers set
`includeHistorical: true` for former-state, correction, or evolution
questions. Full thought hydration exposes lifecycle links and reasons.
`timeline_thoughts` includes lifecycle status so chronological narratives can
distinguish current, superseded, and retracted information.

## Failure behavior

- Invalid or hallucinated classifier output falls back to `ADD`.
- Unknown thought IDs cannot be transitioned.
- A cross-account or non-current prior memory aborts the entire transition.
- If classification or transition fails, the new input is added rather than
  lost.
- Memory content is treated as untrusted prompt data; instructions embedded in
  it are ignored.
