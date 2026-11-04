---
id: 343
slug: rules-v5-strength-regions-and-iron
title: Rules v5: Might, Footing, Fortitude by body region; Endurance becomes Iron
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: [341, 342]
blocked_by: []
source: agent
created: 2026-11-04T05:04:40Z
started: 2026-11-04T13:50:37Z
---

## Description

Ship D-483's skills as `rules/xp-rules-v5.yaml` (v4 plus changes; v4 is pinned):

- **Might** (`might`): upper body. Exercises: `strength-upper` (minutes) and `pushup` (count, 8 s each). Measure `seconds:` at 0.5 XP/s.
- **Footing** (`footing`, new, `introducedIn: 5`): lower body. Exercise: `strength-lower` (minutes).
- **Fortitude** (`fortitude`): core and total body. Exercises: `strength-core` (minutes), `situp` (count, 6 s each), `plank` (seconds, 3 s per second).
- **Iron** (`endurance` id, renamed, `kind: meta`, no exercises): fed 0.3333 by Might, Footing and Fortitude.
- The **Strength workout** split entry (`0342`) over the three region exercises, 10% step, quick values 30 / 45 / 60.
- Soft cap 3600 s and sanity ceiling 10800 s on each region skill; every activity row still feeds Constitution 0.3333.

## Acceptance criteria

- [x] `rules/xp-rules-v5.yaml` validates. v4 is pinned in `shipped-rulesets.json`. Generated `.json` and `xp-rules.bundled.ts` are regenerated.
- [x] Under v5, 20 pushups = 80 Might XP, 30 situps = 90 Fortitude XP and 60 s plank = 90 Fortitude XP, identical to v4. A 30-minute 100%-upper log = 900 Might and 300 Iron.
- [x] Footing's minted level 1 fires no level-up card (D-146). Iron's kind change fires none either: Endurance holds 0 XP, so verify that on the live ledger before replay and **stop** if it does not.
- [x] Sigils for Footing and Iron in `rules/sigils.json`. Might and Fortitude keep theirs.
- [x] Docs: `04` §1.1 skill tables and counts, §3.2 rates (with the D-483 parity note), §5.2 Power = `mean(Might, Footing, Fortitude)`, `02` §3.2. `check-doc-ruleset.mjs` passes.
- [x] Deployed, and the live ledger replayed onto v5 with every skill's XP unchanged (record before/after, as `0329` did). *Amended 2026-11-04 (D-484, operator): every skill except Iron, which gains a third of Might's historical XP. The criterion assumed D-483's "the swap moves no XP", which missed the new feed.*

## Notes

Decision: D-483. Depends on `0341` and `0342`. Cited design: `04` §1.1, §1.3, §3.2, §5.2, §7.6; `02` §3.2, §3.8; D-146, D-469 (Poise precedent).
Until `0344` lands, the Strength workout entry exists in data but has no designed /log row; pushups, situps and planks keep working.

## Resolution

**Ruleset.** `rules/xp-rules-v5.yaml` is v4 plus D-483. The generated `xp-rules-v5.json` and
`xp-rules.bundled.ts` are regenerated. v4 was already pinned by `0329`, so `shipped-rulesets.json`
needed no change.
- **Might, Footing (new, `introducedIn: 5`, `displayOrder: 35`) and Fortitude** are each a
  `seconds:<own id>` tally:
  - 0.5 XP/s;
  - soft cap 3600, sanity ceiling 10800;
  - feeds Constitution 0.3333 and Iron 0.3333.
- **Exercises** convert into the tally by `scale`:
  - `strength-upper`, `strength-lower` and `strength-core` (minutes) at 1;
  - pushup 8, situp 6, plank 3.

  The tally suffix is the skill's own id, never an exercise id, so 0341's cross-row check passes.
- **Iron** is the `endurance` row turned meta:
  - `logMode: derived`, `unit: share`, `match: null`, no exercises;
  - `displayOrder: 75`, so it comes after Constitution in META.
- **The split** is `splits: [{id: strength, …}]`: the three members, step 10, quick values
  30/45/60.
- **`minUnitsForCredit` was not specified, and is my call.** It gates no XP (D-269); it sets /log's
  stepper floor per exercise.
  - Might is 8, one pushup, as in v4.
  - Footing is 60.
  - Fortitude is 6, one situp. One skill has one floor, so the plank stepper now starts at 2 s,
    not v4's 5 s.

**Sigils.** `rules/sigils.json` gains `footing` (a boot). `endurance` is redrawn as an anvil for
Iron, replacing the plank-era hourglass. I rendered them through `sharp` to check they read; the
first boot looked like a flask and was redrawn.

**Docs.**
- `04` §1.1: tables, counts and sentence.
- `04` §1.3: the excerpt shows v5's Might, and Iron, because Might's feed must resolve.
- `04` §3.2: rate rows, plus the D-483 parity note beside the old strength anchor.
- `04` §5.2: Power = `mean(Might, Footing, Fortitude)`, as an amendment note.
- `02` §3.2: `kind` may change across versions, and v5's `strength` split.
- `check-doc-ruleset.mjs`: its four self-test seeds that mutated v4 doc strings now mutate v5's.

**Tests.**
- `lib/log/log-workout.test.ts`: 10 new tests, on the shipped v5, through the real adapter and
  `processActivity`:
  - 20 pushups, 30 situps and a 60 s plank score 80 / 90 / 90 under both v4 and v5;
  - 30 min at 100% upper = 900 Might, 300 Iron and 300 Constitution;
  - 45 min at 40/30/30 = 540 / 405 / 405;
  - Iron is never matched;
  - four `BAD_SPLIT` refusals with no accept and no transaction.
- `src/scoring/d146-guard.test.ts`, the v4 → v5 replay:
  - Footing is minted and Iron is not;
  - Total Level +3;
  - the next log queues no card.
- Fixed tests the new rows broke:
  - `log-page.test.tsx`: "Core & total body" is the first label with an `&`, so the test escapes it.
  - `new-workout-type.test.tsx`: a skill with several exercises is a run of /log rows, so runs are
    collapsed before the order check.
  - `detail.test.ts`: Might's rules sentence.
- Full suite: 4,788 passed, 1 skipped. Typecheck, lint and every `amplify.yml` guard are clean.
  The guards ran on a clean copy, except the three that need Amplify's environment and the
  history scan; Trigger B ran in the repo.

**What went wrong: D-483's "the swap moves no XP" was false (D-484).** It checked that Endurance and
Fortitude held 0 XP and missed the feed. The v5 dry run showed that Might's 120 XP of historical
pushups would also pay Iron a third, about 40 XP. I stopped before `--confirm` and asked. The
operator accepted it, because it is the rule every future log follows. The replay criterion is
amended to say so. My first D-146 test asserted the replay with unchanged XP and was wrong for the
same reason. It was rewritten after the replay.

**Deployed and replayed.**
- Amplify job 452 (`c05b2d1`) SUCCEEDED.
- `replay-xp.ts --to 5 --confirm`:
  - deleted 368 rows, wrote 370;
  - 3 floor rows survived, and no new floors were written;
  - 119 activities rescored;
  - 0 cells changed; generation 272;
  - run `REPLAY#…#0MW2BS26VOJDMGJ` DONE;
  - pre-flight snapshot `snapshots/skillstate/…/2026-11-04T16:22:41.898Z-271.json`.

| skill | before (v4) | after (v5) |
|---|---|---|
| cartography | 27,061 | 27,061 |
| constitution | 11,483 | 11,483 |
| endurance (Iron) | 0 | 40 |
| might | 120 | 120 |
| poise | 900 | 900 |
| roving | 1,017 | 1,017 |
| vigil | 660 | 660 |
| wayfaring | 31,761 | 31,761 |
| **total** | **73,002** | **73,042** |

Total Level is now 114. Footing is at its minted level 1, and Iron reached level 3 from 40 XP.

**Interim, until `0344`.** /log has no designed Strength workout row yet. It does show three new
single minutes rows: "Upper body" (Might), "Lower body" (Footing) and "Core & total body"
(Fortitude). They log and score correctly, because `logRows` renders every exercise.

## Operator validation

### For the operator: perceptual

On the desktop browser, open `/skills`: Footing and Iron appear, Endurance does not, and the names, sigils and order read right.

### Agent smoke test

The live ledger's before/after per-skill XP from the replay, and refused-before-write invocations of `log-workout` for the new exercise ids. Carried from `0342`: live `BAD_SPLIT` refusals of the Strength workout split (shares summing to 90, a share off the 10% step, an outside member, client-sent sets), each with no write.

### Agent smoke test, 2026-11-04, `devault`, live, after the replay

I invoked the live `log-workout` Lambda directly as the owner. The owner is on v5 now, because
`rulesForUser` pins by the user's version. Every call was refused:
- shares summing to 90 → `BAD_SPLIT: split shares sum to 90%, not 100%`
- 45/25/30 → `BAD_SPLIT: … must be a whole multiple of 10`
- a `yoga` member → `BAD_SPLIT: "yoga" is not part of "strength"`
- client-sent `sets` → `BAD_SPLIT: "strength" is a split: it carries split, not sets`
- a valid 100/0/0 split with a bad timezone → `BAD_TIMEZONE` (the split parses live)
- `strength-upper` `{reps}` and `strength-core` `{distanceM}` → `BAD_SET … durationS must be a
  positive integer`
- `strength-lower` and `plank` with a bad timezone → `BAD_TIMEZONE` (both known live)

Afterwards there were still 119 activities, so nothing was written. The first accepted Strength
workout should be the operator's real session.
