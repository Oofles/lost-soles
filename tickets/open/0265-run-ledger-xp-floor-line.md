---
id: 265
slug: run-ledger-xp-floor-line
title: The run ledger keeps a +N XP floor line when the earlier standing cannot be read
type: bug
priority: med
status: open
size: s
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T13:20:51Z
started: 2026-10-15T13:31:03Z
---

## Description

`06-ui-ux.md` §3.5 (lines ~562–565): *"Total XP is always on screen. If literally every skill row
were somehow empty, the ledger still shows the Total XP transition and the chronicle line."*

Found by the `12-post-run-moment` audit (§2, code-was-wrong). When the "before" standing cannot be
read (D-296's as-of read fails), `tallyFor` returns `total: null` and `totalLevel: null`
(`lib/run-moment/tally.ts:93`), and `run-ledger.tsx`'s footer list drops the `total` footer with
nothing in its place (`app/run/[activityId]/run-ledger.tsx:68`). D-296 accepts that a failed read
costs the bars and the transition. It does not license losing every Total XP number: the run's own
`runXp` is already computed from the ledger and does not depend on "before".

## Steps to reproduce

1. Open a run's `/run/:id` while D-296's as-of "before" read fails (in a test: `tallyFor` with
   `xpBefore` null).
2. Look at the ledger footer.

## Expected vs actual

**Expected:** a Total XP line is on screen with the run's own gain (§3.5: "Total XP is always on
screen").
**Actual:** the `total` footer is dropped and no Total XP number appears at all.

## Acceptance criteria

- [x] When `tally.total` is null and `tally.runXp > 0`, the ledger footer shows a Total XP line
      carrying the run's own gain (e.g. `Total XP +442`), in the same slot and style as the
      transition line, with no "before → after" and no error wording.
- [x] When the read succeeds, the footer is unchanged (`Total XP 522 → 964 (+442)`).
- [x] The floor line appears in the animated tally and in the static end state alike.
- [x] A unit test covers the null-`xpBefore` path and asserts the floor line, and that no `0`
      renders anywhere (§3.5).

## Notes

Filed by the capability-12 drift audit, 2026-10-15. `totalLevel` stays omitted on a failed read:
§3.5's guarantee is about Total XP, and a Total Level without "before" has nothing honest to show.

## Operator validation

None by eye: the line's look is the existing transition line's. Agent: a unit test on the null path;
if cheap, force the read to fail in a headless smoke and confirm `Total XP +N` renders.

**Deployed:** Amplify job 395 (`a2e815b`) SUCCEED. Local gate on that commit: typecheck, lint,
`npm test` 190 files / 3,419 passed (1 skipped, the known gitleaks-availability case), and every
`amplify.yml` pre-build guard.

**Agent smoke, deployed site, 2026-10-15** (throwaway Cognito user signed in by SRP through the
repo's own `aws-amplify/auth`, session cookies sent with `curl`; **no data written**. A read-only
scan of all 11 tables found 0 rows naming the uid, and the user was then deleted):
- `/skills/might` signed in: HTTP 200. Its shipped JS contains `remembered ground` and
  `remembered cells`, and neither `re-armed ground` nor `re-armed cells`.
- A fake `/run/:id` renders the 404 page, which does not load the run page's chunk, so the run
  page's JS could not be inspected live without seeding an activity on prod. I did not seed one.
  Instead, a local `next build` of the same commit puts `a row for`, `data-hint` and
  `pointer: coarse` in `app/run/[activityId]/page-*.js`. The live chunk carries a different hash
  (env inlined at build), so it could not be fetched by name.

**The floor line by eye:** not forced live. Making D-296's read fail on prod means breaking a grant or a table, and the path is one branch of `TallyView`, which the two new tests render directly. None needed by eye: the line reuses the transition line's style.

## Resolution

**Files.** `app/run/[activityId]/run-ledger.tsx`: `tallyFooters` now pushes `total` when
`tally.total` exists **or** `tally.runXp > 0`. The `total` case renders `Total XP +N`, counting up
from 0 with the same `countAt`/`progress(i)` as every other line, when there is no `before`. With
a `before` the transition line is untouched. `TallyView` is the one component behind both the
beat-2 panel and the end state, so criterion 3 holds by construction. It is not a second code path.
`lib/run-moment/tally.test.tsx`: the old test asserted *"no totals"*, which was D-296's rule. It now
asserts no arrow and no Total Level, and two new tests cover the floor line (and that no bare `0`
renders) and the unchanged transition.

**Decision.** **D-310** narrows D-296's *"a failed read costs the bars and the totals"* to the bars,
the transition and Total Level. It is a visible supersession: D-296 is left as written. Total Level
stays omitted, because without "before" there is no honest number to show.

**What went wrong.** Nothing in the build. The audit itself was the finding. The guarantee in §3.5
had been quietly traded away by D-296 without amending §3.5, and an existing test locked in the trade.
