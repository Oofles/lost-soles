---
id: 257
slug: backfill-aggregate-reveal
title: Backfill aggregate reveal — one 4 s reveal, lifetime ledger, one Total Level card, backfilled runs seen
type: feature
priority: high
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: [177, 84]
blocked_by: []
source: agent
created: 2026-10-13T22:36:47Z
---

## Description

Split out of `0084` on 2026-10-13, with the operator, because the import it reveals does not exist
yet. `06-ui-ux.md` §3.4, *Backfill*:

> The first Strava import fetches years of history. Do **not** queue 300 sequences. Backfill
> produces **one** aggregate reveal: the whole archive burns back at once over 4 s, with a ledger
> showing lifetime totals and starting levels, and a single card: `Total Level 214`. Individual runs
> become rows in the Chronicle with `seen` already set.

Today the first Sync looks back only `FIRST_SYNC_LOOKBACK_DAYS` (30), and the full historical import
is `0177`. That import is **paced over hours** against the read budget, which the design's picture
of "the first import" as a single event did not anticipate. So the first job here is a decision:
**when does the aggregate reveal play** — on backfill completion, on the next visit after it, or
progressively? Settle it with the operator before building, and record it as a `D-xxx`.

The reveal itself reuses `0084`'s machinery: the one-listener skip, reduced motion (a 400 ms
cross-fade instead of the 4 s burn), WebGL-loss fallback to the end state, and the per-device
`seen` store in `lib/run-moment/seen.ts`.

## Acceptance criteria

- [ ] When the aggregate reveal plays is decided with the operator and recorded as a `D-xxx`.
- [ ] A backfill import of ≥50 activities produces exactly **one** sequence, a 4 s aggregate reveal,
      a lifetime-totals ledger, and one Total Level card — not one sequence per activity.
- [ ] After backfill, every backfilled activity is `seen` on this device and the plinth shows no
      new-run line for any of them.
- [ ] Skip, Back, reduced motion and WebGL loss behave as in `0084` during the aggregate reveal.
- [ ] Tested against a fixture of 300 activities.

## Notes

`0084`'s notes: *"The backfill aggregate is the highest-consequence path here and the one least
likely to be exercised in development, because it happens exactly once per account. Test it against
a fixture of 300 activities before the first real connect, not after."* The operator's account has
already done its 30-day first sync, so the first real backfill is `0177`'s. This ticket must land
**with or before** `0177` is switched on for real, or the first run of the importer has no reveal.

Filed in capability 14 rather than 12 so that capability 12's audit is not held behind a
capability-14 dependency.

The `seen` flag is per-device (§3.4). A backfill marks seen on the device that plays the reveal;
another device sees no individual new-run lines only if the plinth also treats backfilled activities
as not-new. Decide which with the trigger question above.

## Operator validation

In the desktop browser, after a backfill (a synthetic one against throwaway data is fine — never a
real first connect just to test this): one four-second reveal of the whole history and one card, not
a queue. Then reload and confirm nothing was double-scored.
