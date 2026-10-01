---
id: 193
slug: the-2025-08-04-run-has-archived-bytes-but-no-ingest-receipt
title: The 2025-08-04 run has archived bytes but no ingest receipt, so it cannot be replayed
type: bug
priority: med
status: open
size: s
capability: 07-fog-projection-and-cells
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T15:20:00Z
started: 2026-10-01T15:15:01Z
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

- [x] A decision between the three options above, recorded — a `D-xxx` if it changes what a receipt
      means.
- [x] If a receipt is reconstructed, it is **distinguishable from a minted one** by inspection, and a
      test asserts that a reconstructed receipt cannot be produced by the ordinary accept path.
- [x] The run is replayed and the published set reaches ~~98 cells~~ **the count predicted offline
      from its archived bytes** *(amended 2026-10-01: 98 was res 10 over a 10-run map; the map is now
      res 11 and 17 runs, where this run adds exactly 2 of its 179 cells — 1139 → 1141. See
      Resolution)*, or the ticket is closed as
      `wont-fix` with the reason written down.
- [x] `tools/replay/replay-activities.ts` no longer reports a permanent `NO RECEIPT — skipped` line
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

## Resolution

**Option 1, adopted — with one change from the ticket's framing, decided mid-ticket and recorded as
D-265.** The proposal was "a provenance field, keep `keyKind: ACCEPT`". That turned out to be
impossible to do honestly: the ACCEPT key is `sha256(source:owner:externalId:aspect)` and the owner
id is something only the adapter knows (D-100), so a reconstructed row *cannot* carry an ACCEPT-shaped
key from a source-agnostic tool. A different key shape is what `keyKind` exists to name, so the row
gets **both**: `keyKind: "ADOPT"` with an `adopt#<activityId>` key, and `adoptedFrom` naming the
archived object.

### Files

- `src/pipeline/ingest-receipt.ts` — `ReceiptKeyKind` gains `ADOPT`; `IngestReceipt.adoptedFrom`;
  `adoptedKeyFor`, `adoptReceipt` (conditional put, `QUEUED`/0 attempts, refuses an object outside
  `raw/<userId>/<source>/`, idempotent — a second adopt returns `exists`). `acceptIngest`'s
  `keyKind` param is now `Exclude<…, "ADOPT">` and it throws on `ADOPT` at runtime for a caller
  arriving via a cast.
- `src/pipeline/ingest-receipt.test.ts` — 4 tests: the row's shape, idempotency, prefix refusal,
  and **the accept path cannot produce an ADOPT row** (criterion 2).
- `tools/replay/replay-activities.ts` — `--adopt`. An orphan is adoptable only with **both** archived
  bytes and an `Activity` row (`GetItem` on `custom.activityTableName`). Without the flag an orphan
  reads `NO RECEIPT — re-run with --adopt to reconstruct one`, or `…and no Activity row; not
  adoptable, investigate by hand`. The word "skipped" is gone (criterion 4).
- `docs/02-data-model.md` T8 — the `adopt#` key shape, `ADOPT` in `keyKind`, the `adoptedFrom` row.
- `docs/decisions/DECISIONS.md` — **D-265**.

### What changed underneath the ticket

- **The target number was stale.** Since this was filed the map moved to res 11 and gained seven
  more runs. Measured offline with the shipped `normalizeStrava` + `traceToCells` over the archived
  envelope against the published `explored-r11.66.bin`: the run covers **179 cells, 177 of them
  already revealed** by later runs on the same roads. Prediction: 1139 → 1141. Criterion 3 amended
  accordingly rather than ticked against a number that no longer applies.
- **The ticket under-sold the generality.** Receipts carry a 90-day TTL; the oldest live ones expire
  ~2026-12-05. After that *every* replayed activity is an orphan, so `--adopt` is the replay path
  for anything older than a quarter, not a one-off for 2025.
- **XP looked like a double award and was not.** The adopted receipt came back `DONE` with
  `xpAwarded: 335`. The ledger holds exactly two rows for this activity, both created 2026-09-07
  (84 constitution + 251 wayfaring = 335) — the dev-era award. `xp-ledger.ts:431`'s `alreadyScored`
  branch wrote no rows and no `SkillState` `ADD`s; 335 is the existing award read back.
- **The first draft of the test tripped `check-boundaries`** (D-100): it used `"strava"` inside
  `src/pipeline`. Switched to `gpslogger` like the rest of the file.
- **The scratch prediction script** needed `--config vitest.config.ts` for the `@/` alias and a
  `gunzip` (the published blob is `Content-Encoding: gzip`). Deleted after use.

### Checks

Guard scripts, `tsc --noEmit`, `eslint --max-warnings 0`, and the full vitest suite — 133 files,
2,464 passed, 1 skipped — all green by exit code.

## Operator validation

**Agent-side, by smoke test against the live stack** (D-181/D-229). Nothing here is perceptual.

- **Adopt, through the real path** — `replay-activities.ts --user <sub> --adopt --external
  15336494333 --confirm` wrote `adopt#1fb91a42…` and enqueued one `reingest` to the deployed queue.
- **The row is distinguishable by inspection** — `get-item`: `keyKind: ADOPT`, `adoptedFrom:
  raw/<uid>/strava/15336494333/22d02bfd….json`, `acceptedAt` 2026-10-01T15:18Z (the adoption, not a
  fake import date).
- **The worker took it unchanged** — receipt `DONE` on `attempts: 1`, `newCellCount: 2`. Queue and DLQ
  both `0/0`.
- **The result is exact** — manifest gen 66 → **67**, `cellCount` 1139 → **1141**, matching the
  offline prediction.
- **No double award** — 2 ledger rows for the activity, both dated 2026-09-07; no new rows.
- **The dry run without `--adopt`** now lists the orphan with the flag that recovers it.

What's left for the operator is `0055`'s existing perceptual check of the map. The two new cells are
too few to need a check of their own.

