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

- [ ] When `tally.total` is null and `tally.runXp > 0`, the ledger footer shows a Total XP line
      carrying the run's own gain (e.g. `Total XP +442`), in the same slot and style as the
      transition line, with no "before → after" and no error wording.
- [ ] When the read succeeds, the footer is unchanged (`Total XP 522 → 964 (+442)`).
- [ ] The floor line appears in the animated tally and in the static end state alike.
- [ ] A unit test covers the null-`xpBefore` path and asserts the floor line, and that no `0`
      renders anywhere (§3.5).

## Notes

Filed by the capability-12 drift audit, 2026-10-15. `totalLevel` stays omitted on a failed read:
§3.5's guarantee is about Total XP, and a Total Level without "before" has nothing honest to show.

## Operator validation

None by eye: the line's look is the existing transition line's. Agent: a unit test on the null path;
if cheap, force the read to fail in a headless smoke and confirm `Total XP +N` renders.
