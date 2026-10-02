---
id: 227
slug: triage-merge-writes-target-before-slug-check
title: triage-merge writes the target's Notes before its slug check can refuse
type: bug
priority: low
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-10-01T00:38:18Z
started: 2026-10-02T04:20:46Z
---

## Description

`cmdTriageMerge` appends the merged note to the target ticket's `## Notes` (its `writeFileSync` on
`target.path`) and only **afterwards** derives the capture's slug and runs
`if (!SLUG_RE.test(slug)) die(...)`. A capture whose title slugifies to nothing (punctuation-only, or
emoji-only from the phone) therefore half-merges: the target gains the note, the capture stays in
the inbox, and a retry with `--slug` appends the note **a second time**.

Same class as `0141`: a writer that writes before it has finished checking. Found while adding
`0141`'s enum check, which deliberately runs before that write.

## Acceptance criteria

- [x] Every refusal in `triage-merge` (slug, enums, missing Notes, closed target) happens before
      any file is written.
- [x] A test: merge of a capture titled `"!!!"` with no `--slug` exits non-zero and leaves the
      target ticket byte-identical; a retry with `--slug` produces exactly one merged note.

## Steps to reproduce

1. Put a capture in `tickets/inbox/` with `title: "!!!"`, commit it.
2. `tickets.mjs triage-merge tickets/inbox/<it>.md --into <open id>` → refuses on the slug.
3. The target ticket's `## Notes` already holds the merged note.

## Expected vs actual

**Expected:** the slug refusal leaves the target untouched.

**Actual:** the target is rewritten, then the command dies; a retry duplicates the note.

## Notes

Fix is to move the slug derivation/check above the target write, so it sits with the other refusals.

## Operator validation

None needed — CLI-only; the test above is the proof.

## Resolution

- `.claude/skills/tickets/scripts/tickets.mjs` `cmdTriageMerge`: moved the slug derivation +
  `SLUG_RE` refusal, and the `## Notes`-exists refusal (which was before the write but buried in the
  merge-body construction), up beside the other refusals. Every `die()` in the function — `--into`,
  `readCapture`, enums, missing target, closed target, missing Notes, slug — now runs before the
  first `writeFileSync`. A comment cites 0227 so nobody moves the check back down.
- `.claude/skills/tickets/scripts/tickets.test.mjs`: new test in the `0023 — triage` suite. A capture
  titled `"!!!"` merged without `--slug` exits non-zero, the target is byte-identical and the capture
  survives; the retry with `--slug bang` succeeds with exactly one `Merged from a capture` note.
  The test **failed against the pre-fix script** (checked by running it on `HEAD`'s copy), so it
  really guards the regression.
- Not touched: `nextId()`/`git mv` failing after the write could still leave a half-merge, but those
  are environment failures, not refusals, and the ticket covers refusals only.
- No decisions recorded.

## Operator validation

None needed. This is CLI-only and nothing here is perceptual. Smoke test: the full tickets suite
passed (`node --test tickets.test.mjs`, 188/188), and the 0227 test failed on the pre-fix code and
passed after the fix.
