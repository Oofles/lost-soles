---
id: 268
slug: measure-skip-token-saving
title: Measure the skip-token saving: Amplify build count and minutes, 2026-10-15 to 10-29
type: chore
priority: low
status: closed
size: s
capability: 18-mvp-hardening
depends_on: [214]
blocked_by: []
source: agent
created: 2026-10-15T15:17:29Z
closed: 2026-10-27T02:33:26Z
---

## Description

`0214` closed with the before figures and a projection, but not the after. Its last acceptance
criterion needs two weeks of data from after the hook landed (D-311, `f4c265d`, 2026-10-15).

Before (2026-10-01 to 10-14): 124 Amplify jobs on `main`, `USE1-BuildDuration` 1,233.2 min =
$12.33. Projected: 42% of build minutes skipped.

## Deferred — resumed 2026-10-27

**Reason:** Measures Amplify builds 2026-10-15 to 10-28; the window has not closed (today 2026-10-26).

**Re-check** — the cheap test that says the wait is over. `tickets.mjs recheck 0268`
runs it and reports the result; nothing un-defers on its own. When it exits 0, read the
output and `tickets.mjs resume 0268`.

```sh
[ "$(date -u +%F)" \> 2026-10-28 ] && echo "ready: measurement window 10-15..10-28 has closed" || echo "not yet: workable on or after 2026-10-29"
```

**Resumed 2026-10-27:** operator: estimate from 12 of 14 days today and accept the accuracy risk

## Acceptance criteria

- [x] ~~On or after 2026-10-29,~~ record the Amplify job count on `main` and the Cost Explorer
      `USE1-BuildDuration` minutes and cost for 2026-10-15 to 10-28, against the before figures.
      Also record how many pushes carried the skip token. *(Amended 2026-10-26 by the operator:
      estimated today from the 12 complete days, 10-15 to 10-26, extrapolated to 14, accepting the
      accuracy risk. Figures in `## Resolution`.)*
- [x] (Not applicable: the saving beat the projection, 55% against 42%.) If the saving is well under the projection, find out why: a hook not installed, a
      `core.hooksPath` missing on a clone, or pushes that mix code and docs.

## Notes

Not workable before 2026-10-29. Related: `0214`, D-311, D-083.

## Operator validation

**None owed: a measurement.** The orchestrator read the sources directly, 2026-10-27 ~02:00 UTC:
`aws amplify list-jobs` (main), Cost Explorer `USE1-BuildDuration` (daily, through 10-26), and
GitHub Actions `gate` push runs on `main`, one per push whether skipped or not.

## Resolution

**Estimated, not measured over the full window, by the operator's choice (2026-10-26):** close it
today and accept the accuracy risk, instead of waiting for 10-29.

| | Before, 10-01 to 10-14 (14 days) | After, 10-15 to 10-26 (12 days, measured) | After, scaled to 14 days |
|---|---|---|---|
| Pushes to `main` | 134 | 134 | ~156 |
| Amplify jobs | 124 (0214's figure; `list-jobs` counts 130 by start time) | 47 | ~55 |
| Build minutes (Cost Explorer) | 1,233.2 | 475.0 | ~554 |
| Cost | $12.33 | $4.75 | ~$5.54 |
| Minutes per day | 88.1 | 39.6 | 39.6 |

- **Saving: about 55% of build minutes and cost**, against 0214's projected 42%. Minutes per job
  barely moved (9.9 before, 10.1 after), so the whole saving is in jobs not started.
- **Pushes with the skip token:** 87 of 134 since 10-15 (65%) produced no Amplify job. Only 44 show
  the token in GitHub's run title, because GitHub truncates long subjects with "…". One spot check
  (`d200a26`) found the token at the end of the full subject. The other 43 were not each checked;
  that they carry it is inferred from their having no job.
- **Activity was higher after, not lower:** 11.2 pushes a day against 9.6, so the drop is not
  explained by less work.
- **Why it beat 42%, probably:** waves (D-312) arrived in the same period. They push code once per
  wave and send the start, close and result commits tickets-only. That is a likely explanation,
  not a measured one.

**Accuracy risk accepted:** the last two days are extrapolated at the 12-day rate. A day with an
unusual amount of code pushing could move the 14-day total by perhaps ±10%. That cannot turn a 55%
saving into one under the projection.

Criterion 2 (investigate a shortfall) does not apply. Nothing was found wrong with the hook.
