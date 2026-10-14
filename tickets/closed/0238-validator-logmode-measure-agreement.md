---
id: 238
slug: validator-logmode-measure-agreement
title: Validator does not check that a skill row's logMode agrees with its measure
type: bug
priority: low
status: closed
size: s
capability: 09-xp-engine-and-ledger
depends_on: []
blocked_by: []
source: agent
created: 2026-10-02T15:19:39Z
started: 2026-10-14T19:00:53Z
closed: 2026-10-14T19:03:09Z
---

## Description

**Found by capability 09's drift audit (2026-10-02).** The scoring kernel is chosen by the
`measure` prefix (`src/scoring/units.ts:40-67`). `logMode` is only checked for membership
(`src/rules/validate.ts:~415`). A row with `logMode: reps` and `measure: distanceKm` validates and
scores as distance. That is a data row the rules allow but the design never meant to, and adding
a workout type is supposed to be a data row that cannot go wrong silently (D-031/D-141).

## Acceptance criteria

- [x] `validate` refuses a skill row whose `logMode` disagrees with its `measure` kind, with a
      message naming the row, both fields and the allowed pairings.
- [x] The allowed `logMode` ↔ `measure` pairings live in one table, in `src/rules`, not as a
      per-skill branch (no skill id appears; `no-skill-names.test.ts` stays green).
- [x] Every row in every bundled ruleset still validates.
- [x] 02-data-model §3.7's note pointing at this ticket is updated to say the check exists.

## Steps to reproduce

1. Copy a reps skill row in a scratch ruleset; change its `measure` to `distanceKm`, leaving `logMode: reps`.
2. Run the validator over that ruleset.

## Expected vs actual

- **Expected:** a seed-time error naming the row and the mismatched pair.
- **Actual:** it validates, and the row scores as distance.

## Notes

None beyond the Resolution.

## Resolution

- **`src/rules/schema.ts`** — `LOG_MODE_OF_MEASURE`, the 02 §3.7 kernel table as data, keyed by
  fixed measure (`distanceKm`, `cells`, `share`) or kernel prefix (`reps:`, `seconds:`). Typed
  `satisfies Record<FIXED_MEASURES | MEASURE_PREFIXES, LogMode>`, so adding a fixed measure or
  prefix without a pairing fails to compile. No skill id anywhere; `no-skill-names.test.ts` green.
- **`src/rules/validate.ts`** — `validateLogModeAgrees`, called from `validateMatch` only once the
  measure is a valid, non-derived activity measure and the `logMode` is a member of `LOG_MODES`.
  So a typo in either field produces one error, not two. The error goes on `skills[i].logMode`
  and names the skill id, both values, the kernel the scorer would actually use, and every
  allowed pairing.
- **`src/rules/validate.test.ts`** — the ticket's repro (`might` with `measure: distanceKm`)
  checked against every part of the message; three more mismatches (trace→duration, reps→trace,
  duration→reps); an unknown `logMode` still reports once; v1/v2/v3 bundled rulesets each
  validate with zero errors.
- **`docs/02-data-model.md` §3.7** — the D-276 amendment now says the validator refuses a
  disagreement and points at `LOG_MODE_OF_MEASURE`. INDEX rebuilt.
- **No new D-xxx.** D-276 already decided the measure picks the kernel. This only enforces it.
- **Observed, not acted on:** a reps/duration row that has `exercises[]` was already partly caught
  by `entryAgreesWithMeasure` (a `count` exercise against `distanceKm` errors), so the repro now
  gives two errors. That is correct: they are different defects. A row with no exercises was
  the uncaught case. Meta rows have no measure, so their `logMode` is still checked for membership
  only. Requiring `derived` there would be new scope, and no ticket asks for it.
- **Full suite:** 3388 pass, 1 fails. The failure is `src/adapters/strava/adapter.test.ts`'s
  `summary_polyline` grep tripping over untracked `tmp/0080`–`0085/seed.ts` leftovers. That is
  local only and unrelated (tracked files are clean).

## Operator validation

Nothing perceptual here: a seed-time validator error. Smoke test (2026-10-14, WSL dev box):
copied `rules/xp-rules-v3.json` to a scratch file and set `might.match.measure = "distanceKm"`
(leaving `logMode: reps`), then ran `validateRuleSet` over it and over the three bundled files.
The scratch file returned `skills[4].logMode`: *"\"might\": logMode \"reps\" disagrees with
match.measure \"distanceKm\", which is a \"trace\" measure — the scorer follows the measure, so the
row would score as trace. Allowed pairings (02 §3.7): trace ⇔ distanceKm, reps ⇔
reps:<exerciseId>, duration ⇔ seconds:<exerciseId>, derived ⇔ cells, derived ⇔ share."*. v1, v2 and
v3 each returned `[]`. No operator check needed.
