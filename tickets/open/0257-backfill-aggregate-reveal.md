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
started: 2026-10-18T01:23:55Z
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

- [x] When the aggregate reveal plays is decided with the operator and recorded as a `D-xxx`.
      *(Decided by the operator 2026-10-17: on the next map visit, server-marked. Proposed as
      D-NEW-a in this ticket's report; the orchestrator allocates the number, agents may not.)*
- [x] A backfill import of ≥50 activities produces exactly **one** sequence, a 4 s aggregate reveal,
      a lifetime-totals ledger, and one Total Level card — not one sequence per activity.
- [x] After backfill, every backfilled activity is `seen` on this device and the plinth shows no
      new-run line for any of them.
- [x] Skip, Back, reduced motion and WebGL loss behave as in `0084` during the aggregate reveal.
      *(Through `0084`'s own `wireSequenceExit`, its reduced-motion band and its `lost` stage; the
      frame functions are tested. Not yet driven in a browser: that is the post-deploy smoke.)*
- [x] Tested against a fixture of 300 activities.

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

- **2026-10-16 (orchestrator, from `0177`):** the backfill ran once, on 2026-10-16 from 15:10:03.786Z
  to 15:30:08.420Z, and imported 97 activities. They are the T3 rows whose `ingestedAt` falls in
  that interval; `startedAt` before the first Sync's month is the tighter filter. The v3 → v3 XP
  replay ran afterwards (`REPLAY#…#0MVB4K8NXAXBD9N`, Total Level 100). The reveal must be judged
  against that post-replay state. The ledger has already absorbed the backfill, so "before" for an
  aggregate reveal is the state as of `ingestedAt` < 15:10:03Z, not today's minus nothing.

## Operator validation

In the desktop browser, after a backfill (a synthetic one against throwaway data is fine — never a
real first connect just to test this): one four-second reveal of the whole history and one card, not
a queue. Then reload and confirm nothing was double-scored.

## Resolution

**The trigger (operator, 2026-10-17, proposed as D-NEW-a).** The reveal plays on the next map
visit, and the server marks it. When an import completes, one server-side **backfill batch
record** is written. It holds the window, the imported activity ids, and the standing before and
after. The next visit to `/`, on any device, plays one aggregate reveal, once per device. Every
imported activity is not-new on every device.

**Where the record lives: an S3 object, `users/<uid>/backfill/batch.json`** (`lib/backfill/store.ts`).
I chose this over a new table or a `Profile` field:
- the SSR compute already reads `users/*`, so it needs no new AWS resource, grant or schema change;
- it is derived from immutable facts, so it sits with the other derived objects;
- one record per account: a later import overwrites it with a new `batchId`.

Only tools write it. The browser never sees the ids.

**How "before" is computed.** It is not "today minus the batch's XP", because the XP replay
re-folded the history afterwards.
- **XP:** the newest **SkillState snapshot** taken before the window opens (D-143's after-every-ingest
  snapshot). This is what the user was actually shown.
- **Map:** the newest **explored blob published before the window**, found by `LastModified`.
  Blobs are generation-named and never rewritten.

`after` is the account now: SkillState plus the manifest. For the real import:
- before: generation 135, 1,352 cells, 19 activities, Total Level 59, 23,423 XP;
- after: generation 267, 5,211 cells, 116 activities, Total Level 100, 70,994 XP;
- 3,859 cells burn back.

This was checked with a read-only dry run against the real account.

**Which activities are in the batch** (`batchActivities`): the ACTIVE rows whose `ingestedAt` is in
the window and whose `startedAt` is older than the account's oldest earlier activity. A run synced
while the import was going stays an ordinary new run.

**Finding: the CLI printed its end instant too early.** `backfill.ts` printed its end instant while
the last window was still being processed. Four of the 97 activities have `ingestedAt` between
15:30:08.946Z and 15:30:11.738Z, after the printed `15:30:08.420Z`. Consequences:
- the one-off record uses `--to 2026-10-16T15:31:00Z`;
- `batch-record.ts` warns about matches within 5 minutes after `--to`;
- the CLI now waits for the queue to drain before it closes the window.

**How the plinth tells a backfilled run from a new one.** `/api/runs/latest` reads the record beside
the run. It serves the **mark** (the record without its ids) at the collection level, and
`backfilled: true` on the latest run when the run is in the batch. The Chronicle route and page mark
their rows the same way. Then:
- `latestSeen` treats a backfilled run as seen on every device;
- `unseenIds` never gives it the gold mark.

**How "played once" works across devices.** Once **per device**. The `0084` seen store records it
under `backfill:<batchId>`. No client write reaches the server, so the server alone decides what is
new, and §3.1 already makes `seen` per device. A rewrite of the record keeps the `batchId`, so a
refresh after the replay never replays the reveal on a device that has played it.

**Home** (`components/backfill/use-backfill-reveal.ts`, `components/plinth/home-screen.tsx`):
- The mark rides on the latest-run answer that home already waits for and caches. That gives a warm
  start the answer before any request (D-333).
- While home cannot yet say whether a reveal is due, the hold is pending and the fog keeps its last
  frame. "Cannot yet say" covers: a pre-`0257` cached answer, the `seen` read, and the two blobs
  loading.
- When a reveal is due, the batch's cells (`after` blob − `before` blob, both from
  `/api/fog/blob/<gen>`) are held back with the unseen run's (`mergeHolds`). Then they are installed
  as the reveal, placed by rank of distance from the map's centre.
- The plinth is veiled while the reveal is pending or playing.
- A blob read failure means no reveal on this visit, and nothing is marked.

**The sequence** (`components/backfill/backfill-reveal.tsx`, `lib/backfill/reveal.ts`). One clock:
| Time | What happens |
|---|---|
| 0–4.0 s | the burn (gold bloom, faded out over 300 ms) |
| 4.0 s | the ledger rises 24 px over 300 ms |
| 5.0–6.4 s | one `Total Level N` card (`LevelUpQueue` with one card) |
| 8.4 s | home again |

The ledger shows:
- what came in: the count and the month span;
- lifetime totals: activities, cells (`+N`), XP;
- every trained skill's starting level, with `was N`;
- Total Level, with `was N`.

`0084`'s machinery is reused, not copied:
- **One exit:** click, Esc and Back all go through `wireSequenceExit`, and every way out marks the
  batch seen.
- **Reduced motion:** a 400 ms cross-fade across `REDUCED_BAND`, no bloom, no rise, the card held.
  Same boundaries.
- **WebGL lost:** abort to home. The ledger is DOM.
- **No WebGL2:** the clock starts at once and the numbers still play.

**One change outside the reveal's own files:** `use-fog-mask.ts`. A reveal on home over zero
territory now gets an empty set instead of no layer, so an account whose only ground is the import
still sees the burn. This extends D-319's "the first thing the fog ever does is burn back".

**Files.**
- New:
  - `lib/backfill/{batch,store,plan,reveal}.ts` and their tests;
  - `lib/backfill/__fixtures__/three-hundred.ts`;
  - `components/backfill/{backfill-reveal.tsx,use-backfill-reveal.ts}`;
  - `tools/backfill/batch-record.ts`.
- Changed:
  - `app/api/runs/latest/route.ts` (and its test);
  - `app/api/runs/chronicle/route.ts`, `app/(home)/chronicle/page.tsx`;
  - `lib/runs/wire.ts`, `lib/chronicle/rows.ts`, `components/chronicle/chronicle-panel.tsx`;
  - `components/plinth/{home-screen,plinth}.tsx`, `components/map/use-fog-mask.ts`;
  - `lib/run-moment/seen.test.ts` (new importer allowed);
  - `tools/backfill/backfill.ts` (drain, write the record, print the refresh command);
  - `docs/06-ui-ux.md` §3.4 and `docs/03-integrations.md` §2.5 (amendment notes).

**Tests:** 300-activity fixture, 42 new tests.
- One sequence: the 4 s burn, then the ledger, then one card, done at 8.4 s. Nothing in the clock
  counts activities.
- Reduced motion: the same phases.
- The batch's ground and its outward order.
- The record built from stubbed T3, SkillState, snapshots and blobs: 278 in, the 2 "during" runs
  out, before and after correct.
- None of the 278 is fresh on the plinth or gold in the Chronicle, even with this device's flag
  unset.

