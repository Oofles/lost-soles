---
id: 193
slug: the-2025-08-04-run-has-archived-bytes-but-no-ingest-receipt
title: The 2025-08-04 run has archived bytes but no ingest receipt, so it cannot be replayed
type: bug
priority: med
status: open
capability: 07-fog-projection-and-cells
size: s
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T15:20:00Z
---

## Description

**Split out of `0192` rather than swept into it.** Nine of the ten archived activities were replayed
and their ground is now on the map. The tenth cannot be, and the reason is structural rather than a
retry away.

`strava/15336494333` — *"Night Run"*, started **2025-08-04**, archived **2026-09-06** — has an
`Activity` row and archived bytes in `raw/`, and **no row in `LostSolesIngestReceipt`**. It predates
the receipt gate: it was imported during development by a path that did not write one.

`recordDelivery` is *"conditional on the row existing and throws when it does not"*, which is
deliberate — it is what rejects a hand-crafted or long-expired message before it can spend a network
call. So a `reingest` for this activity is refused having written nothing, and
`tools/replay/replay-activities.ts` reports it as `NO RECEIPT — skipped` instead of enqueueing a
message it knows will fail.

It is worth **13 res-10 cells**, measured by running the shipped `normalizeStrava` and `traceToCells`
over its archived envelope. The published set is 85 cells; this would take it to 98.

## The thing to decide, which is why this is not just "write the row"

Minting a receipt makes the accept gate's record say an acceptance happened that it never saw. The
receipt table is not merely a lock — `02` T8 and `01-architecture.md` §4 treat it as the audit trail
of what was accepted and when, and `attempts`, `acceptedAt` and `keyKind` all describe a real event.

The honest options, roughly in order of how much they claim:

1. **A `--adopt` flag on the replay tool** that writes a receipt marked as reconstructed — a distinct
   `keyKind`, or an explicit field saying this row was synthesised from an archived object rather
   than minted by `acceptIngest`. Auditable, and the shape generalises to any future orphan.
2. **Let `reingest` tolerate a missing receipt** and create one as it goes. Simplest, and it quietly
   removes the guard that makes `recordDelivery` able to reject a forged message. Probably wrong.
3. **Leave it.** One run from 2025, 13 cells, on a map that is about to gain far more. The cost is
   that the map is knowably incomplete and nothing records why — which is the sort of thing that gets
   rediscovered in a year as "why is that road missing".

Option 1 is the recommendation. Option 3 is only acceptable if this ticket itself is the record.

## Acceptance criteria

- [ ] A decision between the three options above, recorded — a `D-xxx` if it changes what a receipt
      means.
- [ ] If a receipt is reconstructed, it is **distinguishable from a minted one** by inspection, and a
      test asserts that a reconstructed receipt cannot be produced by the ordinary accept path.
- [ ] The run is replayed and the published set reaches 98 cells, or the ticket is closed as
      `wont-fix` with the reason written down.
- [ ] `tools/replay/replay-activities.ts` no longer reports a permanent `NO RECEIPT — skipped` line
      for an activity the operator is expected to have.

## Steps to reproduce

1. `npx vite-node tools/replay/replay-activities.ts -- --user <sub>` — the last line reads
   `strava/15336494333  NO RECEIPT — skipped`.
2. `aws dynamodb scan --table-name LostSolesIngestReceipt` — nine rows, none with that activity id.
3. The archived object exists under `raw/<uid>/strava/15336494333/`, and normalizes to 13 cells.

## Expected vs actual

**Expected:** every activity with archived bytes can be replayed.

**Actual:** an activity whose receipt was never written is unreachable by the replay path, and
silently so unless the tool says it out loud — which it now does.

## Notes

- **Do not reach for option 2 under time pressure.** `recordDelivery`'s throw-on-missing-row is one
  of the four idempotency layers; weakening it to unblock one 2025 run trades a permanent guard for a
  one-off convenience.
- The same situation recurs for any activity imported before a gate existed. Whatever is chosen here
  should be the answer for all of them, not for this one.

## Operator validation

None to construct. If the run is adopted, it appears on the map as ground the operator recognises —
which is `0055`'s check, not a separate one.
