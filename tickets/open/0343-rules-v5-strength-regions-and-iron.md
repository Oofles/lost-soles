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

- [ ] `rules/xp-rules-v5.yaml` validates. v4 is pinned in `shipped-rulesets.json`. Generated `.json` and `xp-rules.bundled.ts` are regenerated.
- [ ] Under v5, 20 pushups = 80 Might XP, 30 situps = 90 Fortitude XP and 60 s plank = 90 Fortitude XP, identical to v4. A 30-minute 100%-upper log = 900 Might and 300 Iron.
- [ ] Footing's minted level 1 fires no level-up card (D-146). Iron's kind change fires none either: Endurance holds 0 XP, so verify that on the live ledger before replay and **stop** if it does not.
- [ ] Sigils for Footing and Iron in `rules/sigils.json`. Might and Fortitude keep theirs.
- [ ] Docs: `04` §1.1 skill tables and counts, §3.2 rates (with the D-483 parity note), §5.2 Power = `mean(Might, Footing, Fortitude)`, `02` §3.2. `check-doc-ruleset.mjs` passes.
- [ ] Deployed, and the live ledger replayed onto v5 with every skill's XP unchanged (record before/after, as `0329` did).

## Notes

Decision: D-483. Depends on `0341` and `0342`. Cited design: `04` §1.1, §1.3, §3.2, §5.2, §7.6; `02` §3.2, §3.8; D-146, D-469 (Poise precedent).
Until `0344` lands, the Strength workout entry exists in data but has no designed /log row; pushups, situps and planks keep working.

## Operator validation

### For the operator: perceptual

On the desktop browser, open `/skills`: Footing and Iron appear, Endurance does not, and the names, sigils and order read right.

### Agent smoke test

The live ledger's before/after per-skill XP from the replay, and refused-before-write invocations of `log-workout` for the new exercise ids. Carried from `0342`: live `BAD_SPLIT` refusals of the Strength workout split (shares summing to 90, a share off the 10% step, an outside member, client-sent sets), each with no write.
