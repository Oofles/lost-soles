---
id: 329
slug: poise-yoga-skill-minutes-entry-rules-v4
title: Yoga (vinyasa) as a hand-logged workout: the Poise skill, a minutes entry, rules v4
type: feature
priority: med
status: open
size: m
capability: 10-add-workout
depends_on: []
blocked_by: []
source: agent
created: 2026-11-02T16:01:44Z
started: 2026-11-02T16:02:11Z
---

## Description

The operator started a vinyasa yoga plan and wants it to be a workout type with its own skill, logged by time ("my workout this morning was 30 minutes"). Vinyasa is mostly flexibility with some strength.

Decided with the operator on 2026-11-02 (D-469): skill **Poise**, **30 XP/min** (0.5 XP/s, session parity: 30 min = 900 against a run's 885), full credit to 60 min then the standard soft cap, Constitution's usual 1/3 feed (feeds may only target meta skills, so the strength share rides on Constitution and on the rate), and a new **`minutes`** entry kind on /log: shown as `30 min`, stepped ±5 min, typed `30` means 30 minutes, stored as `durationS` so the `seconds:` kernel scores it unchanged. The ruleset ships as **v4** (v3 is pinned) and the ledger replays onto it, moving no XP.

## Acceptance criteria

- [ ] `rules/xp-rules-v4.yaml` is v3 plus one `poise` activity row (measure `seconds:yoga`, 0.5 XP/s, soft cap 3600 s, Constitution 0.3333) with one `yoga` exercise, `entry: minutes`; v3 is pinned in `shipped-rulesets.json`.
- [ ] The schema and validator accept a `minutes` entry, which agrees with `seconds:<id>` exactly as `seconds` does.
- [ ] `/log` renders the yoga row with no per-exercise `.tsx` branch: the number reads `30 min`, ± steps 5 min, a typed `30` means 30 minutes, and the set carries `durationS: 1800`.
- [ ] A 30-minute log scores through the unchanged `processActivity`: Poise +900 and Constitution at Poise's rate, no cells.
- [ ] Adding Poise fires zero level-up cards (D-146), and `04` §1.1/§3.2 and `02` §3.2 describe v4.
- [ ] Deployed and the live ledger replayed onto v4 with every existing skill unchanged.

## Notes

The `minutes` entry is a new entry kind, so a code change keyed on the schema enum (as `distance` was in `0240`). Every later minute-logged workout is a YAML row.

Out of scope: Strava `Yoga` activities. They are archived but not ingested (`03-integrations.md` §2.6 mapping table), and a Strava activity carries no sets, so `seconds:yoga` would read zero. That would need an `elapsedS`-style measure, filed separately if wanted.

## Operator validation

TODO

D-123 trigger checked? A / B / C / none. *(Tickets touching auth, sharing, export or public routes — `08-security-privacy.md` §2.4. Anything but "none" reopens D-123 before merge.)*
