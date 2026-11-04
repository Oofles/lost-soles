---
id: 279
slug: unseen-run-marks-use-accent-text-not-accent
title: Unseen-run marks use --accent-text, not --accent
type: bug
priority: med
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-16T04:17:55Z
started: 2026-11-04T20:24:04Z
---

## Description

The unseen-run marks draw in `--accent` (`--gold-500`), which is 2.1:1 on parchment. D-291 forbids
`--gold-500` as a meaning-bearing fill, and on the Chronicle the rule is the only visible cue (the
other is hidden text). D-324 specified `--accent` anyway; the capability `13` audit found the
conflict and the operator chose `--accent-text` (`--gold-700`, 3.7–3.95:1), recorded as **D-335**.

Sites:
- `components/plinth/plinth.tsx:61` — `.plinth-fresh` inset rule.
- `components/plinth/plinth.tsx:63-64` — the `plinth-pulse` keyframes.
- `components/chronicle/chronicle-rows.tsx:67` — the Chronicle row's inset.

`.plinth-dest-primary`'s border (`plinth.tsx:50`) is decoration on a labelled button, not a
meaning-bearing mark, and stays `--accent`.

## Acceptance criteria

- [x] The plinth's `1 new run` rule, its pulse, and the Chronicle row's unseen inset use
      `var(--accent-text)`; none uses `var(--accent)`.
- [x] A test pins it: the plinth and Chronicle styles carry `--accent-text` for the unseen marks and
      no `--accent)` in those rules.
- [x] (operator) On the desktop browser, the unseen mark on `/` and on the Chronicle still reads as
      an invitation, not an alert, at the darker gold — verified 2026-11-04: still reads as an
      invitation.

## Steps to reproduce

1. Open `/` in a private window, so the latest run is unseen.
2. Look at the `1 new run — open it` rule, then open RUNS and look at the marked row.

## Expected vs actual

**Expected:** a `--gold-700` rule (≥3:1 against the surface), per D-291 and D-335.

**Actual:** a `--gold-500` rule at 2.1:1.

## Notes

Filed by the capability `13` drift audit (`AUDIT.md` §2, code-was-wrong). D-324's at-most-one-row
rule is unchanged. `06` §2.4, §3.3 and §8.3 are amended in the same audit.

## Resolution

Files touched:
- `components/plinth/plinth.tsx`: `.plinth-fresh` and both `plinth-pulse` keyframes (four
  occurrences) changed from `var(--accent)` to `var(--accent-text)`. `.plinth-dest-primary`'s
  border is still `--accent`, as the Description says it should be.
- `components/chronicle/chronicle-rows.tsx`: the unseen row's inset `boxShadow` is now
  `var(--accent-text)`.
- `components/plinth/plinth.test.tsx`: the fresh-line test now requires every var in the fresh
  block to be `var(--accent-text)` and none to be `var(--accent)`.
  - Conflict found: the D-148 test "gold appears only as a fill or a rule" banned the
    `--accent-text` token from `plinth.tsx` outright. It used the token's presence as a stand-in for
    "gold text". D-335 makes that stand-in wrong.
  - What it checks now: no `color: var(--accent-text)`, and no `--accent-text` anywhere in
    `PLINTH_CSS` outside a `box-shadow` declaration. D-148's intent is unchanged; the test asserts
    it directly now.
- `components/chronicle/chronicle-panel.test.tsx`: the unseen-row test now matches
  `var(--accent-text)` and refuses `var(--accent)` in the rendered rows.

`--accent-text` is defined in both themes (`app/tokens.css`). Light is `--gold-700`, dark is
`--gold-300`, so the dark-mode mark is the same gold it already was through `--accent`.

No new decision. This implements D-335.

Checks: full `vitest run` (4807 passed, 1 skipped), `tsc --noEmit` clean, eslint clean on both
component directories.

## Operator validation

Perceptual: does the darker rule still read as an invitation? Desktop browser, private window.

- **Operator, desktop browser, private window, 2026-11-04:** checked the `1 new run — open it` rule
  and pulse on `/`, and the marked row on RUNS, against the deployed build (Amplify job 455, commit
  `2ee33ef`). Verdict: still reads as an invitation, not an alert.
- **Smoke test (agent):** Amplify job 455 for `2ee33ef` finished `SUCCEED` on `main`.
