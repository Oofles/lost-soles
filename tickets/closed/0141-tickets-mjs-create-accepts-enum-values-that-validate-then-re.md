---
id: 141
slug: tickets-mjs-create-accepts-enum-values-that-validate-then-re
title: tickets.mjs create accepts enum values that validate then rejects
type: bug
priority: med
status: closed
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T22:29:42Z
closed: 2026-10-01T00:38:46Z
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

- [x] `create` rejects an out-of-enum value for every enum-valued flag it accepts, **before** writing
      any file or touching `index.json`, naming the flag and listing the permitted values.
- [x] `tickets.mjs create --title x --type bug --priority medium` exits non-zero and leaves
      `tickets/open/` and `index.json` byte-identical.
- [x] The permitted values come from the SAME `ENUMS` constant `validate` uses — not a second list
      that can drift from it. A duplicated enum is this bug with a longer fuse.
- [x] A test covers at least one rejected value and one accepted value per enum flag.
- [x] `triage-move` is checked for the same gap, since it also writes frontmatter from flags.

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

**Result (2026-09-30, agent smoke test, WSL2 terminal):** in the real repo,
`tickets.mjs create --title "x" --type bug --priority medium --size s --capability 01-ticket-system --source agent`
printed `--priority must be one of: high, med, low (got 'medium'). Nothing was written.` and exited 1;
`sha256sum tickets/index.json` was unchanged and `tickets/open/` still held 78 files. A second run with
`--size xl` refused the same way. `git status` afterwards showed only the two script files modified,
and `validate` reported 0 errors. Nothing here for the operator to look at.

## Resolution

**Files:** `.claude/skills/tickets/scripts/tickets.mjs`, `.claude/skills/tickets/scripts/tickets.test.mjs`.

- New `checkEnums(fm, name)` goes through `ENUMS`, the same constant `validate` reads, and `die`s on
  the first field outside its list, naming where the value came from and listing the permitted
  values. It is table-driven, so a field added to `ENUMS` is checked by every writer automatically.
- `create` calls it on the frontmatter it has just built, after defaults are applied and before
  `writeFileSync`/`writeIndex`. `status` is always `open` there, and `--type`, `--priority`,
  `--size` and `--source` are all covered.
- **`triage-move` had the same gap and more.** `--size` comes from a flag, but `type`, `priority` and
  `source` come from the *capture's own frontmatter*, written on the phone, which nothing checked.
  `triage-decline` and `triage-merge` build their frontmatter the same way (`triagedFrontmatter`),
  so all three now call `checkTriageEnums` right after `readCapture`. For merge that is before it
  rewrites the target ticket. A bad capture value is reported as `tickets/inbox/c.md: 'priority' must
  be one of …` rather than as a flag the operator never typed. `triage-defer` is deliberately left
  unchecked: it writes no frontmatter, and refusing to defer a malformed capture would block the
  one action that leaves it alone.
- `ENUMS` is now exported, and the tests iterate over the imported constant rather than restating it.
- **Tests (`0141 —` suite, 9 cases):** the exact reproduction (non-zero exit, `tickets/open/` and
  `index.json` byte-identical); a rejected and an accepted value for each create flag; a test that
  every value `validate` rejects is also refused by `create`; `triage-move` with a bad `--size`; and
  move/decline/merge with a bad capture `priority` (capture stays in the inbox, merge target
  unchanged, nothing in `closed/`). Full suite 181/181.

**What went wrong:** while switching the test to import `ENUMS`, a Python `str.replace` was given a
slice whose end marker (`const base = {`) also matched earlier in the file. The slice was empty, so
the replacement was inserted between every character of the test file (+372k lines). I caught it at
the next test run, restored the file with `git checkout`, and re-appended the block. No commit was
affected.

**Filed:** `0227`. `triage-merge` writes the target's Notes before its *slug* check can refuse, so a
punctuation-only capture title half-merges and a retry duplicates the note. It is the same "writes
before it checks" class, and out of this ticket's scope.

