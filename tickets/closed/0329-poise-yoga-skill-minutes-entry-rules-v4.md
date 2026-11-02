---
id: 329
slug: poise-yoga-skill-minutes-entry-rules-v4
title: Yoga (vinyasa) as a hand-logged workout: the Poise skill, a minutes entry, rules v4
type: feature
priority: med
status: closed
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: agent
created: 2026-11-02T16:01:44Z
started: 2026-11-02T16:02:11Z
closed: 2026-11-02T16:59:46Z
---

## Description

The operator started a vinyasa yoga plan and wants it to be a workout type with its own skill, logged by time ("my workout this morning was 30 minutes"). Vinyasa is mostly flexibility with some strength.

Decided with the operator on 2026-11-02 (D-469): skill **Poise**, **30 XP/min** (0.5 XP/s, session parity: 30 min = 900 against a run's 885), full credit to 60 min then the standard soft cap, Constitution's usual 1/3 feed (feeds may only target meta skills, so the strength share rides on Constitution and on the rate), and a new **`minutes`** entry kind on /log: shown as `30 min`, stepped ±5 min, typed `30` means 30 minutes, stored as `durationS` so the `seconds:` kernel scores it unchanged. The ruleset ships as **v4** (v3 is pinned) and the ledger replays onto it, moving no XP.

## Acceptance criteria

- [x] `rules/xp-rules-v4.yaml` is v3 plus one `poise` activity row (measure `seconds:yoga`, 0.5 XP/s, soft cap 3600 s, Constitution 0.3333) with one `yoga` exercise, `entry: minutes`; v3 is pinned in `shipped-rulesets.json`.
- [x] The schema and validator accept a `minutes` entry, which agrees with `seconds:<id>` exactly as `seconds` does.
- [x] `/log` renders the yoga row with no per-exercise `.tsx` branch: the number reads `30 min`, ± steps 5 min, a typed `30` means 30 minutes, and the set carries `durationS: 1800`.
- [x] A 30-minute log scores through the unchanged `processActivity`: Poise +900 and Constitution at Poise's rate, no cells.
- [x] Adding Poise fires zero level-up cards (D-146), and `04` §1.1/§3.2 and `02` §3.2 describe v4.
- [x] Deployed and the live ledger replayed onto v4 with every existing skill unchanged.

## Notes

The `minutes` entry is a new entry kind, so a code change keyed on the schema enum (as `distance` was in `0240`). Every later minute-logged workout is a YAML row.

Out of scope: Strava `Yoga` activities. They are archived but not ingested (`03-integrations.md` §2.6 mapping table), and a Strava activity carries no sets, so `seconds:yoga` would read zero. That would need an `elapsedS`-style measure, filed separately if wanted.

## Resolution

**Decisions (D-469), all taken by the operator on 2026-11-02 in one round.**
- **Name: Poise.** Balance and control under load, which covers both sides of vinyasa.
- **Rate: 0.5 XP/s = 30 XP/min.** That is session parity: 30 minutes = 900. Full rate to 3600 s,
  then the standard soft cap, so 90 minutes = 2,250. Sanity ceiling 10800 s.
- **Strength: Constitution 0.3333 only.** Feeds may only target meta skills, so the strength
  side is priced into the rate.
- **Entry: a new `minutes` kind.** It shows `30 min`, steps ±5, and a typed `30` is thirty
  minutes. The set carries `durationS`, so the existing `seconds:` kernel scores it.

**What I found that the ticket did not mention.**
- `rows.ts` derived the stepper floor from `minUnitsForCredit` assuming the row and the skill
  count the same unit. A minutes row on a seconds skill would have floored at 60 *minutes*.
  The new `SKILL_UNITS_PER_ROW_UNIT` converts it.
- Poise is the first real minted row since v1. Two tests had assumed the newest ruleset had none:
  - `d146-guard.test.ts` built its "earned 99" standing as if every enabled skill was earned.
    It now adds V's own minted rows on top (`earnedStandingAt`).
  - The year-ten panel fixture appended a fixed six rows. It now tops up to fifteen, so the next
    skill will not break it.

**Files.**
- **Rules.** `rules/xp-rules-v4.yaml` (v3 + Poise, `introducedIn: 4`, `displayOrder: 55`, one
  `yoga` exercise, quickValues `[30, 45, 60]`), the generated `.json` and `xp-rules.bundled.ts`,
  and v4 pinned in `shipped-rulesets.json`.
- **Sigil.** A tree-pose figure in `rules/sigils.json`.
- **Schema and validator.** `src/rules/schema.ts` adds `minutes`. `src/rules/validate.ts`: a
  `minutes` entry requires `seconds:<id>`.
- **Entry boundary,** `lib/log/workout-entry.ts`: `OPTIONAL_FIELDS_BY_ENTRY.minutes = []`.
- **Rows,** `lib/log/rows.ts`: the step, decimals, set scale (60), `SKILL_UNITS_PER_ROW_UNIT`,
  `formatValue` and `parseValue` all handle `minutes`.
- **UI.** `app/log/log-row.tsx`: the accessible name is `yoga, minutes`.
- **Docs.** `04` §1.1 (row and count) and §3.2 (rate row and parity bullet), `06` §6.3's step
  row, D-469, and `check-doc-ruleset.mjs`'s self-test count.

**Tests.**
- `lib/log/log-workout.test.ts`: 4 new tests, through the real adapter and `processActivity`
  under v4:
  - 30 minutes = Poise 900 plus Constitution's third;
  - no ground;
  - 90 minutes = 2,250;
  - refused under v3.
- `lib/log/rows.test.ts`: now on v4, with 3 new tests.
- `src/rules/validate.test.ts`: 2 new tests.
- `app/log/log-page.test.tsx`: the label regex.
- Suite: 278 files, 4,590 tests green. Typecheck, lint, every `amplify.yml` guard (except
  `--require-literals`, which needs Amplify's env) and `drill:ci` are clean, and GitHub `gate`
  passed on `5a3bc8f`.

**Deployed and replayed.** Amplify job 442 (`5a3bc8f`) SUCCEEDED. Then
`replay-xp.ts --to 4 --confirm`: 364 rows deleted and rewritten, 3 floor rows survived, no new
floors, generation 271. Every skill is unchanged:
- cartography 27,061
- constitution 11,170
- might 80
- roving 1,017
- vigil 660
- wayfaring 31,761

The total is 71,749 XP both before and after, all on v4. Total Level is 101; the extra point is
Poise's minted level 1, which fires no card (D-146).

## Operator validation

### Smoke test: agent, 2026-11-02, `devault`, live

These are direct invocations of the live `log-workout` Lambda as the owner. All were refused
before any write:
- `yoga` `{durationS: 1800}` with a bad timezone → `BAD_TIMEZONE`. The exercise is known live,
  and a seconds set is accepted.
- `yoga` `{reps: 30}` → `BAD_SET … sets[0].durationS must be a positive integer`.
- `yoga` `{distanceM: 5000}` → the same `BAD_SET`. The minutes row is stored as seconds and
  nothing else.

**Not done live:** an accepted yoga log. It would award real XP that can never be removed, so the
operator makes the first one. `log-workout.test.ts` proves the accepted path.

### For the operator: perceptual — verified 2026-11-02

**Done by the operator, desktop browser, `/log`:** "logged it, the row and confirmation look right". This was the real 30-minute session from the morning of 2026-11-02.

The check as written:

**Desktop browser, `/log`.** The yoga row appears after the plank row, as Poise. Check that:
- the number reads `30 min`;
- ± moves it by 5;
- typing `45` shows `45 min`;
- LOG shows "POISE … Poise +900 → L…" at 30 minutes.

Logging this morning's real 30 minutes is the check.

D-123 trigger checked? A / B / C / none. *(Tickets touching auth, sharing, export or public routes — `08-security-privacy.md` §2.4. Anything but "none" reopens D-123 before merge.)*
