---
id: 141
slug: tickets-mjs-create-accepts-enum-values-that-validate-then-re
title: tickets.mjs create accepts enum values that validate then rejects
type: bug
priority: med
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T22:29:42Z
---

## Description

`create` checks only that `--title`, `--type` and `--priority` are **present** (line 1121); it never
checks their VALUES against `ENUMS` (line 34), which only `validate` reads. So the script happily
writes a ticket that its own validator rejects one command later.

Hit for real while filing `0140`: `--priority medium` was accepted, the file was written, `index.json`
was regenerated, and `validate` then reported
`ERROR [enum] priority='medium' is not one of high|med|low`. The ticket had to be hand-edited —
which is the thing `CLAUDE.md` says never to do, forced by the tool that exists to prevent it.

**Same class as `0127`** (`create` could not derive a valid slug), and the same class as `0137`'s
theme one layer over: the writer and the checker disagree about what a valid ticket is, and only the
checker is right. A backlog is single-writer *because* the script is the writer; a writer that emits
invalid records spends that guarantee.

Affected flags, all with an enum in `ENUMS` or a fixed set the rest of the script assumes:
`--type`, `--priority`, `--size`, `--status` (where accepted), `--source`.

## Acceptance criteria

- [ ] `create` rejects an out-of-enum value for every enum-valued flag it accepts, **before** writing
      any file or touching `index.json`, naming the flag and listing the permitted values.
- [ ] `tickets.mjs create --title x --type bug --priority medium` exits non-zero and leaves
      `tickets/open/` and `index.json` byte-identical.
- [ ] The permitted values come from the SAME `ENUMS` constant `validate` uses — not a second list
      that can drift from it. A duplicated enum is this bug with a longer fuse.
- [ ] A test covers at least one rejected value and one accepted value per enum flag.
- [ ] `triage-move` is checked for the same gap, since it also writes frontmatter from flags.

## Steps to reproduce

1. `node .claude/skills/tickets/scripts/tickets.mjs create --title "x" --type bug --priority medium --size s --capability 01-ticket-system --source agent`
2. The file is written and `index.json` updated.
3. `node .claude/skills/tickets/scripts/tickets.mjs validate` → `1 error(s)`.

## Expected vs actual

**Expected:** `create` refuses at step 1 with `--priority must be one of: high, med, low`.

**Actual:** it writes an invalid ticket, and the error surfaces later — after the operator has moved
on — as a validation failure on a file they must then hand-edit.

## Notes

Cheap fix, and it should be a table-driven check rather than five `if`s, so a future flag cannot be
added without one.

Related: `0127` (create could not derive a valid slug), `0140` (where this was hit).

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

None required — a CLI refusal with no rendered surface. Confirmable by running the reproduction
above and seeing a non-zero exit with no file created.
