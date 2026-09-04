---
id: 158
slug: rescale-cycling-xp-rate
title: Rescale the cycling rate to 60 XP/km — a typical ride is 15 km, not 25
type: chore
priority: high
status: closed
size: s
capability: 04-domain-contract-and-rules
depends_on: [157]
blocked_by: []
source: operator
created: 2026-09-04T14:29:52Z
started: 2026-09-04T14:29:52Z
closed: 2026-09-04T14:31:50Z
---

## Description

`0157` shipped `roving` and `cadence` at **35 XP/km**, derived from the speed-ratio anchor
(100/3 — cycling covers roughly 3× the distance of running for comparable effort) and
sanity-checked against an **assumed** typical ride of 25 km.

The operator's typical ride is **15 km**. At 35 XP/km that is **525 XP**, against a typical run's
885 and a typical strength session's 840 — under 60% of either, which is not session parity by
any reading. `04-game-design.md` §3.2's stated anchor is *"one typical hard session of anything
should be worth about the same total XP as one typical hard session of anything else"*, and the
number was set against a distance nobody had checked.

885 / 15 = 59. **60**, for legibility — a clean 3/5 of running, and a 15 km ride lands at 900
against a run's 885 (1.7% off). `cadence` takes the identical rate, as it did before, exactly as
D-132 gave Vigil full Wayfaring XP rather than half.

**This was caught by the operator reading the file**, one day after `0157` closed, and is the
D-181 argument in miniature: every smoke test passed and would have gone on passing, because the
file was internally consistent and wrong. Correctness checks cannot see a wrong assumption; a
person who knows how far they actually ride can.

## Acceptance criteria

- [x] `roving` and `cadence` both carry `xpPerUnit: 60`.
- [x] The YAML comment explains the derivation **and** names the superseded 35 with its reason,
      so the file does not read as though 60 were obvious all along.
- [x] D-189 is **amended in place with a visible banner**, not silently edited — the 35 stays on
      the page.
- [x] A test asserts the **principle** rather than the number: a typical ride within 10% of a
      typical run, with the assumed ride distance named as a constant, so changing the rate
      without revisiting the assumption fails and says why.
- [x] Both cycling skills still share one rate, asserted by comparison rather than by literal.
- [x] The operator's sign-off on `0028` and `0157` is recorded on those closed tickets.
- [x] Typecheck, lint at `--max-warnings 0`, the full suite and `build-index.mjs --check` pass.

## Notes

The general failure worth naming: **35 was defensible arithmetic on an undefended premise.** The
ratio was right, the anchor was right, and the input was invented. A test asserting
`xpPerUnit === 35` would have locked the error in and looked like rigour. That is why the new test
names `TYPICAL_RIDE_KM` and asserts parity against it — the assumption becomes a visible,
editable thing rather than a number smuggled into a rate.

No change to `revealsGround`, `match`, or anything else from `0157`. One number in two rows.

## Resolution

**Files amended** — `rules/xp-rules-v1.yaml` (two `xpPerUnit` values and the derivation comment),
`src/rules/xp-rules-v1.test.ts` (+2 tests), `docs/decisions/DECISIONS.md` (D-189 amendment banner),
`tickets/closed/0028-*.md` and `tickets/closed/0157-*.md` (operator sign-offs).

One number in two rows. The reason it warranted a ticket rather than an edit is the record: a rate
that changed 24 hours after shipping, without an explanation on the page, is a rate the next reader
distrusts.

**What was actually wrong, stated plainly.** 35 XP/km was defensible arithmetic on an undefended
premise. The ratio was sound (100/3, cycling covering ~3× the distance for comparable effort), the
anchor was the one §3.2 names, and the input — "a typical ride is about 25 km" — was invented by me
and never checked with the person who rides. At the real 15 km it paid 525 XP against a run's 885.

**Why no automated check could have caught it.** Every smoke test passed on `0157` and would have
gone on passing: the file was internally consistent, the validator was happy, the mutual-exclusivity
grid was correct. The error was in a premise, and a premise is invisible to a correctness check. It
took the operator reading the file and knowing how far they actually ride — which is precisely the
D-181 argument for keeping a human on the *legibility* step rather than only on the parts a script
cannot reach.

**The test is written to stop the same class of error, not this instance of it.** Asserting
`xpPerUnit === 60` would have locked in whatever number was current and looked like rigour — it is
exactly the test that would have blessed 35. Instead it names `TYPICAL_RIDE_KM = 15` as a constant
and asserts the *principle*: a typical ride within 10% of a typical run. Change the rate without
revisiting the assumption and it fails, naming both candidates. Verified by putting 35 back: it
fails with *"a 15 km ride is 525 XP against a typical run's 885 (40.7% off) … either the rate or
TYPICAL_RIDE_KM is now wrong."*

**D-189 is amended with a visible banner, and the 35 is left standing.** The working agreement says
never to edit a settled decision quietly, and this is the case it is written for: silently
overwriting the number would erase the fact that it was chosen against an unchecked assumption,
which is the only part of this worth remembering.

**Nothing else moved.** `revealsGround`, `match`, the mutual-exclusivity grid and the ten rows are
untouched.

## Operator validation

**None required — the operator already supplied the judgement this ticket acts on.** *"My typical
ride is closer to 15km, so please rescale to match that."* Everything after that is arithmetic and
a guard, and both are mine to verify.

| Check | Result |
|---|---|
| `roving.xpPerUnit`, `cadence.xpPerUnit` | both **60** |
| A 15 km ride | 60 × 15 = **900 XP** — against a typical run's 885 (1.7% off) and strength's 840 |
| Both cycling skills share one rate | asserted by comparison, not by literal |
| Parity test with the rate put back to 35 | **fails**, reporting "525 XP … 40.7% off … either the rate or TYPICAL_RIDE_KM is now wrong" |
| Parity test at 60 | passes |
| Rules tests | `npx vitest run src/rules` — 69 passed |
| Full suite | `npm test` — 24 files, 381 passed, 1 skipped |
| Typecheck / lint | exit 0 / exit 0 |
| Docs index, backlog | up to date; 0 errors, 0 warnings |

**The guard was verified to fail before it was trusted to pass** — the 35 was reinstated, the test
run, the message read, and the 60 restored. A parity assertion that has only ever been seen green
is indistinguishable from one that asserts nothing, and this one exists specifically because the
thing it guards already went wrong once.

**Recorded on the two closed tickets**, since their validation asked for a reading I could not do:
`0028` and `0157` both carry the operator's dated sign-off. `0157`'s notes that the legibility read
**passed** and the rate check **did not** — the file was legible enough that reading it surfaced a
wrong number, which is the outcome that section exists to produce.
