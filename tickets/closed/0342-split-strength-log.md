---
id: 342
slug: split-strength-log
title: A split strength log: one activity, one minutes set per body region
type: feature
priority: high
status: closed
size: m
capability: 10-add-workout
depends_on: [341]
blocked_by: []
source: agent
created: 2026-11-04T05:04:40Z
started: 2026-11-04T05:16:02Z
closed: 2026-11-04T05:22:43Z
---

## Description

D-483's Strength workout entry is one log of N minutes split by percentage across Upper / Lower / Core & total body. It must land as **one activity** carrying one minutes set per region with a non-zero share. Each set's exercise feeds that region's skill (via `0341`), so one session trains up to three skills, each with its own soft cap.

The ruleset declares the split — which exercises it spans, their labels and the share step — so the regions are data, not code (D-031). Neither the entry boundary nor `log-workout` names a region.

## Acceptance criteria

- [x] The ruleset schema can declare a split entry: an id, a label, `entry: minutes`, the member exercises (each one an existing `minutes` exercise), a share step (10%) and quick values. The validator refuses unknown members, a step that does not divide 100, and duplicates.
- [x] `lib/log/workout-entry.ts` and the `log-workout` Lambda accept a split log of total minutes plus shares summing to 100%. They apportion whole seconds — the remainder goes to the largest share, with ties broken by declared member order — and write one activity with one set per non-zero share.
- [x] A log whose shares do not sum to 100, are not multiples of the step, or name an exercise outside the split is refused before any write, with a typed error.
- [x] Through the real adapter and `processActivity`: 45 min at 40/30/30 under a test ruleset awards 540 / 405 / 405 XP to the three region skills and the matching feeds; 45 min at 100/0/0 writes one set.
- [x] Offline queue, idempotency key and undo (`06` §6.4) treat a split log as one log: one undo removes the whole activity.

## Notes

Decision: D-483. Cited design: `06-ui-ux.md` §6.4 (commit/undo), `02` §3.2, `lib/log/*`. Depends on `0341`. The UI is `0344`; this ticket only needs a minimal call path for tests.

## Resolution

**Schema** (`src/rules/schema.ts`).
- New `RuleSplit {id, label, entry: "minutes", members, shareStep, quickValues}` and an optional
  top-level `RuleSet.splits`. It is absent on v1–v4.
- Its members are existing `minutes` exercises, so each share is scored by that member's row
  through the unchanged scorer. The regions are ids in data, and no code names them (D-031).

**Validator** (`validateSplits`). It refuses:
- an unknown member, or a member that is not a `minutes` exercise;
- a member on a disabled or meta row;
- a member listed twice, or fewer than two members;
- members of different `kind` (one log is one activity);
- a `shareStep` that does not divide 100, or a non-`minutes` entry;
- an id that an exercise or another split already uses.

**Boundary** (`lib/log/workout-entry.ts`).
- A split log is `{exerciseId: <splitId>, split: {durationS, shares: [{exerciseId, percent}]}}`.
- `apportionSplit` floors each share to whole seconds and gives the remainder to the largest share,
  ties to the first member. The sets always sum to the total. It writes one set per non-zero
  share, each naming its member `exercise`.
- Client-sent `sets` on a split are refused. The sets are only ever derived.
- New error code `BAD_SPLIT`, for:
  - shares not summing to 100, or off the step;
  - an outside or duplicate member;
  - a negative share, or no shares;
  - a non-positive or fractional total.
- `EntrySet` gains an optional `exercise`, which only a split's apportioning writes.
  `entryActivityFields` uses it when present. The occurredAt/idempotencyKey/timezone checks moved
  into a shared `parseEnvelope`, and their behaviour is unchanged.
- `exerciseKind` resolves a split to its members' kind.

**Wire and archive.**
- `transport.ts` sends `split` and not the derived sets.
- `/api/log` admits `split`.
- The manual adapter reads per-set `exercise` and `split`. The schema hint is `manual/workout-entry@2`,
  an additive change: an `@1` archive reads unchanged.
- `lib/log/rows.ts` adds `splitEntryFor`, the call path `0344` will use. It apportions with the
  same function, so the optimistic award is the scored one.

**Undo.** A split log is one queued entry under one idempotency key, so the existing 8-second
undo removes all of it. No queue change was needed.

**Docs.** `02` §3.2 has a `splits:` paragraph.

**Tests.**
- Fixture `splitRuleSet()` in `src/rules/__fixtures__/scaled-tally.ts`: v4 with Might,
  Fortitude and Endurance as `seconds:` tallies, each with a minutes member, plus their v4
  exercises scaled to keep v4 XP, and a three-member split.
- `validate.test.ts`: 9 tests.
- `workout-entry.test.ts`: 15 tests.
- `log-workout.test.ts`: 5 tests through the real adapter and `processActivity`:
  - 45 min at 40/30/30 = 540 / 405 / 405 plus Constitution's third, in one transaction;
  - 100/0/0 trains only one skill;
  - 2 h at 50/50 = 1,800 each, because the soft cap is per skill;
  - a bad split is refused with no accept and no transaction;
  - a re-delivered key is one log.
- `adapter.test.ts`: 3 tests.
- `transport.test.ts`: 1 test.
- `queue.test.ts`: 1 test (one undo).
- `rows.test.ts`: 1 test.
- Full suite: 4,766 passed, 1 skipped. Typecheck and lint are clean, the `amplify/` suites pass,
  and the `amplify.yml` guards pass.

**Found along the way.** Running `scripts/write-authjs-env.mjs` locally, as part of the guard
sweep, writes a real `.env.production` from SSM. It is gitignored, but it holds secrets and makes
the next run fail ("one source only"). I deleted it, and the local guard sweep now skips that step.

## Operator validation

### Agent smoke test, 2026-11-04, `devault`, live

I invoked the live `log-workout` Lambda directly as the owner with a split log
(`exerciseId: "strength"`, 45 min, 100% `strength-upper`). It returned
`REFUSED:UNKNOWN_EXERCISE: no enabled skill logs exercise "strength"`. That refusal comes from the
parse, which runs before the accept gate, so nothing was archived or written. This is correct
while the live ruleset is v4, which has no splits.

I did not test the `BAD_SPLIT` refusals live, because no live ruleset has a split until v5. They
move to `0343`'s smoke test. The first accepted split log is the operator's real session after
`0344`.
