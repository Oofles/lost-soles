---
id: 139
slug: validate-accepts-duplicate-required-sections
title: validate accepts duplicate required sections, so a stub block can hide a phantom unchecked criterion
type: bug
priority: med
status: open
size: s
capability: 01-ticket-system
depends_on: []
blocked_by: []
source: agent
created: 2026-09-01T21:31:18Z
started: 2026-09-30T20:32:39Z
---

## Description

`validate` requires that each of the four mandatory `##` sections **exists**. It does not require
that there is exactly **one** of each, so a ticket carrying two `## Acceptance criteria` sections
passes clean.

Found on 2026-09-01 while working `0129`, which had a full `TODO` stub block from `create` followed
by its real content — two `## Description`, two `## Acceptance criteria`, two `## Notes`, two
`## Operator validation`. It had validated clean since 2026-08-31.

**The harm is not cosmetic.** `acceptance()` resets its section flag at every `##` heading, so it
collects checkboxes from *every* `## Acceptance criteria` section and folds them into one list. The
stub's `- [ ] TODO` was therefore a real unchecked criterion on a real ticket: `close` would have
refused `0129` with a criterion whose text is `TODO`, and the honest fix would have looked like
"tick a box to make the close pass" — the exact move `close`'s refusal message forbids. It is also
invisible in `index.json`, which reports `acceptance: {checked, total}` with the phantom included.

The likely cause is a `create` followed by a body written from a template that repeated the headings
rather than filling them, but the point of the ticket is the validator, not the origin: a duplicate
required section should be an error.

## Steps to reproduce

1. `tickets.mjs create --title "x" --type feature --priority med` — note the generated body has
   `## Description`, `## Acceptance criteria`, `## Notes`, `## Operator validation`.
2. Append a second copy of all four headings, with a `- [ ] TODO` under the second
   `## Acceptance criteria`.
3. `tickets.mjs validate` → 0 errors.
4. `tickets.mjs show <id>` → the acceptance count includes the phantom criterion.

## Expected vs actual

**Expected:** `validate` errors with a rule naming the duplicated section, e.g.
`duplicate-section  '## Acceptance criteria' appears 2 times`.

**Actual:** 0 errors, and a phantom unchecked criterion that silently blocks the ticket's own close.

## Acceptance criteria

- [x] `validate` errors on any `open/` or `closed/` ticket carrying a required section more than
      once, naming the section and the count.
- [x] The rule is scoped so it cannot misfire on legitimate repeats: `## Deferred — resumed …`
      (D-174) is a *different* heading and must stay legal, as must a ticket that mentions a
      heading name inside a fenced code block.
- [x] Inbox items stay exempt, consistent with every other section rule (D-170).
- [x] A test covers the exact `0129` shape — a full stub block followed by real content — and
      asserts the phantom criterion is caught rather than counted.
- [x] `tickets.mjs validate` is run across the whole backlog and any other ticket with the same
      defect is repaired in the same commit.

## Notes

`0129`'s stub block was removed by hand while closing it, so the backlog may currently be clean —
that is not a reason to skip the last criterion. The whole point is that nothing noticed for two
days.

Consider whether the same class of gap exists elsewhere in `SECTION_RULES`: the table asks "is this
heading present" everywhere, and "present exactly once" is the stronger property in every case.

Related: `0129` (where it was found), D-170 (the rule list this extends), `0126`.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

None — ticket-system tooling with no user-visible surface. The check that matters is that
`tickets.mjs validate` reports 0 errors across the backlog after the fix, and errors on a
deliberately duplicated section.

## Resolution

**Files**
- `.claude/skills/tickets/scripts/tickets.mjs`
  - New `duplicateSections(fm, body, folder)`. It returns every required section (the union of the
    `SECTION_RULES` groups that apply, so the bug/design/closed sections are covered too, as the
    Notes suggested) that appears more than once, as `[{section, count}]`. It matches exact heading
    lines, so `## Deferred — resumed …` is a different section. It skips lines inside ``` fences and
    returns `[]` for the inbox (D-170).
  - `validate` reports each one as `duplicate-section  '## X' appears N times`. Exported for tests.
- `.claude/skills/tickets/scripts/tickets.test.mjs`: 5 tests in a new `0139` describe:
  - the exact `0129` shape (full stub block, then real content), with an error for each of the
    four sections;
  - type-specific and closed-only sections;
  - a fenced heading plus two `## Deferred — resumed` headings, which validate clean;
  - the close-time exemption below;
  - inbox exemption.
  Against the pre-fix script, 3 of the 5 fail (the bug) and 2 pass (the exempt paths).
  Suite: 173/173.
- `tickets/closed/0130-…md`: repaired. It had the full `create` stub block above its real content,
  and its stub criterion had been **ticked** (`- [x] TODO — the generated stub's placeholder`) to
  get the close through. That is exactly the move this ticket predicted. The stub block is deleted.
  The real criteria and Resolution are untouched.

**What went wrong / decision.** The first backlog sweep found 52 errors, and 49 were not defects.
The documented close procedure (`reference.md` "Appended at close", SKILL.md close step 3)
*appends* a second `## Operator validation` holding the result, so every properly closed ticket
carries two. The acceptance criterion as written ("any required section more than once") would
have made the normal close procedure produce an invalid ticket. I asked the operator, who chose to
allow one close-time `## Operator validation` **after `## Resolution`, in `closed/` only**. Each
half, before and after Resolution, may appear once. A third copy, a repeat in `open/`, or a repeat
before Resolution is still an error, and the message reports the total count. The criterion is
met within that scope. No `D-xxx`: this codifies the existing documented close procedure rather
than changing any design.

**Not done:** `acceptance()` still folds every `## Acceptance criteria` block together. With
`validate` now refusing the duplicate, that is harmless, and changing the parser was out of scope.
`node --test .claude/skills/tickets/scripts/` (the directory form in the test file's header) fails
before and after this change, while `node --test …/tickets.test.mjs` passes. This is pre-existing
and unrelated, noted rather than fixed.

## Operator validation

None needed from the operator: this is CLI validation with no screen. Verified by the agent:
- `node --test .claude/skills/tickets/scripts/tickets.test.mjs`: **173/173 pass**.
- Real backlog: `tickets.mjs validate` gave 52 errors under the strict rule, and 0 errors,
  0 warnings after the close-time exemption and the `0130` repair.
- The new tests against the old script: 3 fail, 2 pass, as expected.
