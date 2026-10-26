---
id: 268
slug: measure-skip-token-saving
title: Measure the skip-token saving: Amplify build count and minutes, 2026-10-15 to 10-29
type: chore
priority: low
status: deferred
size: s
capability: 18-mvp-hardening
depends_on: [214]
blocked_by: []
source: agent
created: 2026-10-15T15:17:29Z
deferred: 2026-10-26T19:03:53Z
---

## Description

`0214` closed with the before figures and a projection, but not the after. Its last acceptance
criterion needs two weeks of data from after the hook landed (D-311, `f4c265d`, 2026-10-15).

Before (2026-10-01 to 10-14): 124 Amplify jobs on `main`, `USE1-BuildDuration` 1,233.2 min =
$12.33. Projected: 42% of build minutes skipped.

## Deferred

**Reason:** Measures Amplify builds 2026-10-15 to 10-28; the window has not closed (today 2026-10-26).

**Re-check** — the cheap test that says the wait is over. `tickets.mjs recheck 0268`
runs it and reports the result; nothing un-defers on its own. When it exits 0, read the
output and `tickets.mjs resume 0268`.

```sh
[ "$(date -u +%F)" \> 2026-10-28 ] && echo "ready: measurement window 10-15..10-28 has closed" || echo "not yet: workable on or after 2026-10-29"
```


## Acceptance criteria

- [ ] On or after 2026-10-29, record the Amplify job count on `main` and the Cost Explorer
      `USE1-BuildDuration` minutes and cost for 2026-10-15 to 10-28, against the before figures.
      Also record how many pushes carried the skip token.
- [ ] If the saving is well under the projection, find out why: a hook not installed, a
      `core.hooksPath` missing on a clone, or pushes that mix code and docs.

## Notes

Not workable before 2026-10-29. Related: `0214`, D-311, D-083.

## Operator validation

None: a measurement. The agent reads Cost Explorer and `amplify list-jobs`.
