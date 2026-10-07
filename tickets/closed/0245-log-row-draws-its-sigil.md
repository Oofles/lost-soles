---
id: 245
slug: log-row-draws-its-sigil
title: The /log row draws its skill's sigil, as 06 §6.3–6.4 require
type: bug
priority: low
status: closed
size: s
capability: 10-add-workout
depends_on: [72]
blocked_by: []
source: agent
created: 2026-10-07T16:21:25Z
started: 2026-10-07T16:27:35Z
closed: 2026-10-07T16:29:53Z
---

## Description

Filed by capability `10-add-workout`'s drift audit (D-288) as its one code-was-wrong divergence.

`06` §6.4's row anatomy opens with **"Sigil + skill name + unit label"**, and the §6.3 wireframe
draws a sigil (`✥`, `✜`, `⧗`, `◈`) at the head of every row. The shipped row (`app/log/log-row.tsx`)
draws the skill name and the unit label, but no sigil.

The miss came from a handoff. `0068` and `0071` both deferred the sigil to `0072`'s icon set
(`0071`: *"Not here. Sigils are `0072`'s icon set."*). `0073` built that set as data
(`rules/sigils.json`, `components/sigil.tsx`, D-283), and `0072` proved a new skill's sigil reaches
`/skills`. Nobody went back to `/log`.

The fix is one element. `<Sigil skillId={row.skillId} />` reads the data-keyed map and draws the
fallback seal for a skill with no entry, so the row still names no skill (I-25) and a new workout
type is still a YAML row plus one JSON sigil entry (D-031).

## Acceptance criteria

- [x] Every `/log` row, idle and confirmed, draws its skill's sigil from `components/sigil.tsx`
      before the skill name, as on `/skills`. The sigil stays decorative (`aria-hidden`), so the
      row's accessible name is unchanged.
- [x] A skill with no entry in `rules/sigils.json` draws the fallback seal on `/log`, asserted by
      a test.
- [x] `src/rules/no-skill-names.test.ts` (I-25) and `app/new-workout-type.test.tsx` (I-24) still
      pass, unweakened. The new-type world's `/log` row draws the fixture's sigil.

## Steps to reproduce

1. Open `/log` in the desktop browser.
2. Look at the head of any row.

## Expected vs actual

**Expected:** the skill's sigil, then the skill name, then the plain-English unit label
(`06` §6.3–6.4).

**Actual:** the skill name and the unit label, with no sigil.

## Notes

- Use `Sigil`, not a new component. Pick its size to sit on the name's baseline; `/skills` tiles
  use the default 28, and a row header probably wants about 20.
- §6.3's confirmed-row sketch (`✥  MIGHT   30 pushups`) keeps the sigil, so the confirmed state
  draws it too.

## Operator validation

On `/log` in the desktop browser: each row's sigil reads as the same mark the skill wears on
`/skills`, and it does not crowd the name or the controls. This is perceptual only; the tests
prove which sigil is drawn.

### Result

**Pending the operator's look, desktop browser, `/log`.** The agent checked the rest:
- Which sigil each row draws, and the fallback seal: proven by the tests.
- The confirmed state keeps the sigil: both states render through `RowName`, asserted.
- The build: `next build` leaves `○ /log` static (5.53 kB). Pushed in `7e5428e`, so Amplify
  deploys it.

The open question is only whether the 20px mark sits right beside the name. If it crowds the name
or the controls, that is a size tweak, not a reopen.

## Resolution

**Files.**
- `app/log/log-row.tsx`: new exported `RowName`, the sigil (`Sigil`, 20px) and then the
  upper-cased skill name. Both the idle and the confirmed state render through it. The confirmed
  line became a flex row, and its "30 pushups" text moved into its own `<span>` so the gap
  applies to it cleanly.
- `app/log/log-page.test.tsx`: three tests.
  - Every row's `<svg>` carries exactly `sigilPaths(skillId)`, is `aria-hidden`, and comes
    before the name.
  - `RowName` for an unknown skill draws `FALLBACK_SEAL`.
  - A source assertion that both states use `<RowName row={row} />`.
- `app/new-workout-type.test.tsx`: the Pull-ups row on `/log` draws the fixture's sigil (I-24).

**Why `RowName` and a source assertion for the confirmed state.** The repo has no DOM test
library, and the confirmed state only exists after a click. Rendering it would mean adding
jsdom/testing-library for one assertion. Sharing one component between the two states makes
"the confirmed row keeps its sigil" a property of the code, and the source assertion keeps it
that way.

**Size 20, not `/skills`' default 28.** The mark sits inline with the 1rem name rather than
heading a tile. That is a judgement call, and it is the operator check below.

**Mutation check.** With the `<Sigil>` line removed from `RowName`, the three new `/log` tests and
the new I-24 test failed (3 of 27 in those files). Restored.

**Gate.** typecheck and lint are clean. Full suite: 159 files, 2,846 passed, 1 skipped. The I-25
grep passes unchanged: the row names no skill, and the sigil comes from `rules/sigils.json` by
`row.skillId`.

Nothing went wrong in the build itself. What went wrong was upstream: `0068` and `0071` both said
"sigils are `0072`'s", and `0072`'s criteria named only `/skills`. The capability `10` audit
caught it (D-288).
