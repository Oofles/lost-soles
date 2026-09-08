---
id: 155
slug: cross-adapter-cell-set-equivalence
title: T3 cross-adapter equivalence — one run, two adapters, the same H3 res-10 cell set
type: chore
priority: high
status: closed
size: m
capability: 07-fog-projection-and-cells
depends_on: [45]
blocked_by: []
source: agent
created: 2026-09-04T00:46:59Z
started: 2026-09-08T15:24:36Z
closed: 2026-09-08T15:39:27Z
---

## Description

**Split out of `0027` on 2026-09-03, because T3 as written there could not be built in any
ordering of the backlog.** T3 needs an H3 res-10 projection; that is `0045` (`traceToCells`), which
`depends_on: [25, 36]`; and `0036` `depends_on: [27]`. So `0027 → 0036 → 0045 → what 0027 needed`.
A cycle, not a priority call. This ticket is that dependency stated honestly, so the work happens
at the first point it is possible instead of being amended away.

`docs/contracts/ingestion-contract.md` §5 check 3, and `0027`'s T3 in full:

> The same physical run ingested via two adapters yields the **same H3 cell set** within tolerance.
> Only one adapter exists at MVP, so land the harness now with a **second, synthetic fixture
> adapter** replaying the same GPX-derived points through a different code path. The test must be
> real and green, not `test.skip`.

**What this protects, and it is the only check that protects it.** T1 and T2 assert the boundary's
SHAPE — no vendor type in the domain, one importer of the adapter directory. A replacement adapter
can satisfy both, typecheck cleanly, and still emit a subtly different trace: a rounded coordinate,
a point dropped at a gap, a different reading of where a pause ended. That difference becomes a
different cell set, and **the map never re-fogs (D-020)** — cell writes are append-only, so this is
not a bug you notice and fix, it is wrong ground written permanently into a map with no undo.

T1/T2 check that the pipes are connected. T3 checks that the same water comes out.

**What it deliberately does NOT do**, so nobody mistakes its scope later:

- It does not say either adapter is *right*. Two adapters can agree and both be wrong about the
  world. It is an equivalence test, not a correctness test.
- It does not catch shared blindness — two decimated sources agree beautifully. That is check 5,
  the **fidelity floor**, which ships with `0038`.
- It does not exercise the real ingestion path: no queue, no S3, no DynamoDB. It is a pure
  comparison of `normalize()` → `traceToCells()` output.

**Why it must exist BEFORE the migration rather than during it.** Its entire value is being
already-written on the day the adapter is swapped. A test authored on migration day is a test
written to bless a decision already committed to, under time pressure. `0027`'s Notes: *"a cell-set
equivalence harness that already exists is the difference between a one-week migration and a
rewrite."*

**The second adapter is synthetic and lives in a fixture**, per `0027`'s wording — it replays the
same GPX-derived points through a different code path. It is NOT `0069`'s `manual` adapter: waiting
for a real second adapter is waiting for capability `10`, and the harness is worth more than the
realism. Once a real second adapter exists it should be added as a second case, not a replacement.

## Acceptance criteria

- [x] A fixture adapter exists under `__fixtures__/` implementing `SourceAdapter`, whose
      `normalize()` reaches the same `Trace` as the primary adapter by a genuinely different code
      path — not a copy of the primary's parser, or the test proves nothing.
      *`src/adapters/__fixtures__/gpx-adapter.ts`. Different in every layer: XML vs columnar
      JSON, attribute strings through `Number()` vs `JSON.parse` numbers, absolute ISO instants
      vs integer offsets, document order vs array index, and its own speed-gate loop. The only
      thing shared is `src/domain/geo.ts`'s D-197 rule — which is the point: two implementations
      of one contract, not one implementation compared with itself.*
- [x] One physical run, as a checked-in fixture, is ingested through both adapters and both cell
      sets are computed with `traceToCells` at res 10.
      *`real-run-outdoor.json` (a captured response, 2,537 fixes, 6,043 m, re-based to Point Nemo
      per D-199) and `equivalence-run.gpx`, the same run at five decimal places.*
- [x] The assertion is on **set equality within a tolerance**, and the tolerance is a **named
      constant with a comment justifying its value** — not an inline number.
      *`MAX_CELL_SET_DIVERGENCE = 0.02`, justified by a measurement table rather than by
      assertion — see the Resolution.*
- [x] The tolerance's justification says what physical difference it is absorbing (float rounding
      at a cell edge) and what it must NOT absorb (a dropped segment, a collapsed loop).
      *And the percentage alone cannot express the second half, which is the finding: losing
      200 m off a 6 km run is under 7% and a tolerance chosen by percentage would pass it. The
      `isolated` rule — a differing cell with no neighbour in the intersection — is what refuses
      it, regardless of the percentage.*
- [x] The test is not `.skip`, not `.todo`, and fails if either adapter is removed.
      *Four red proofs recorded under `## Operator validation`.*
- [x] The failure message names **D-100 / D-121.1 / D-020** and says, in one line, that an
      unequal cell set means permanent wrong ground on a map that cannot re-fog.
      *Asserted by four tests on the message itself, including that it tells the reader not to
      widen the tolerance.*
- [x] Runs in `npm test`, and therefore in both `.github/workflows/gate.yml` and `amplify.yml`.
- [x] `docs/contracts/ingestion-contract.md` §5 check 3 is annotated with the ticket that
      implements it, so the contract and the code do not drift (D-153).

## Notes

**Do not drop this ticket.** `0027`'s Notes predicted the exact argument that would be used —
*"T3 is the test most likely to be dropped as 'we only have one adapter'"* — and it is the reason
this was split into a real ticket with a real dependency rather than struck off `0027` with a
promise to remember.

The tolerance is the part most likely to be got wrong in a way that makes the test useless. A
tolerance wide enough to never fail is a test that has been deleted without anyone noticing. If a
tolerance that passes cannot be justified in a sentence, the adapters genuinely disagree and that
is the finding.

Capability is `07-fog-projection-and-cells` because that is where `traceToCells` lands and where
its own tests live, not because the check belongs to fog. It is a boundary check that happens to
need a projection.

### What the ticket's author asked for (kept as context, answered in `## Operator validation` below)

None. A pure unit comparison of two in-memory cell sets — no screen, no device, no deployed
resource. Verified by the agent: the test green, and red when either adapter is removed or the
tolerance is tightened past what the fixtures support. Record both results at close.

## Resolution

The harness exists, it is green on real fixtures, and it is red on four different ways of breaking
it. The measurement it produced is the interesting part.

### The two adapters agree EXACTLY, and that is the finding

The tolerance was set from a measurement rather than a guess. Re-projecting the checked-in run
(2,537 fixes, 6,043 m, 45 res-10 cells) at successively coarser coordinate precision:

| precision | metres | cells differing | isolated |
|---|---|---|---|
| 7 dp | 0.01 m | **0** | 0 |
| 6 dp | 0.1 m | **0** | 0 |
| 5 dp | 1.1 m | **0** | 0 |
| 4 dp | 11 m | 5 of 49 (10.2%) | 0 |

**At any precision a real GPX carries, the cell sets are identical.** `REVEAL_R_M`'s 65 m radius
is simply not sensitive to metre-scale disagreement — a fix moving a metre almost never changes
which cells sit within 65 m of the path. Only an 11 m error, beyond anything a real export
produces, moves anything at all.

So the driver asserts **exact equality**, not merely "within tolerance". `0155`'s own Notes are
the reason: *"a tolerance wide enough to never fail is a test that has been deleted without
anyone noticing."* The tolerance is still there and still 2% — chosen to sit between the two rows
that matter — but as the bar a FUTURE adapter must clear, fixed now so migration day is a
measurement rather than an argument.

### A percentage cannot express what the tolerance must refuse

Criterion 4 asks the justification to say what the tolerance must NOT absorb: a dropped segment, a
collapsed loop. Writing that down showed a percentage cannot do it. **Losing the last 200 m of a
6 km run is three cells of forty-five — under 7%, and on a longer run far less.** A tolerance
chosen only by percentage passes it.

So the comparison has a second, structural rule. Rounding at a boundary can only move cells that
are ALREADY adjacent to the agreed set; a dropped segment removes a contiguous run whose far end
touches nothing both adapters kept. A differing cell with no neighbour in the intersection —
`isolated` — fails **regardless of the percentage**. `cell-set-equivalence.test.ts` proves it on a
truncated line that is comfortably inside 2% and fails anyway.

### "A genuinely different code path" taken literally

A copy of the primary's parser would compare an implementation with itself and pass forever.
Nothing is shared:

| | primary | fixture |
|---|---|---|
| wire format | JSON, columnar streams | XML, one element per fix |
| coordinates | `number` from `JSON.parse` | attribute STRINGS through `Number()` |
| time | integer offsets from a base | absolute ISO instants, parsed per point |
| ordering | array index | document order |
| sanitation | `sanitizeTracePoints`, anchor-corrected (`0172`) | its own loop |
| precision | 6 dp | **5 dp**, deliberately coarser |

What *is* shared is `src/domain/geo.ts` — `MAX_IMPLIED_SPEED_MS` (D-197) and `metresBetween` — and
that is the point rather than a compromise: two implementations of the same RULE. An adapter that
invented its own speed gate would be a different contract, not a different implementation of this
one. A test asserts the two traces are genuinely unequal (>100 differing points), so the agreement
about territory cannot become trivial without something noticing.

### Where the pieces live, and what dies on migration day

`check-boundaries.mjs` requires the driver — which names the primary adapter — to live inside that
adapter's directory; D-188 refuses test files an exemption and `0027` was already turned down
asking for one. So **the driver dies with the adapter it names**, and that is stated in the file
rather than discovered later.

Everything worth having in advance does not die: the tolerance, its measurement table, the
adjacency rule and the failure message are in `src/adapters/__fixtures__/cell-set-equivalence.ts`,
which is source-agnostic, as is its own test. A replacement adapter writes a sixty-line driver
against a harness that already exists — which is exactly what `0027` meant by *"the difference
between a one-week migration and a rewrite."*

### Two structural guards had to be taught, and one had a hole (D-223)

Adding a second adapter-shaped directory broke `registry.test.ts` and
`check-adapter-deletion.mjs` — correctly, by their own rules, applied to something that is not an
adapter. Both now exclude `__fixtures__`/`__snapshots__`/`__mocks__` **by name**, because a real
adapter is never called any of those and a name cannot widen by accident the way a heuristic can.

**An exclusion without a replacement rule is a gap**, so there is one: `registry.test.ts` now
asserts the fixture adapter is imported only by test files and is never registered. Without it, a
fixture adapter naming no vendor could have been imported by production code with neither the
import guard nor `check-boundaries.mjs` objecting — a second, unregistered ingest path.

### And the same shape of hole in a third guard, which mattered more

`check-fixture-geography.mjs` read only `.json`. Checking in a `.gpx` with 2,537 real-shaped fixes
would have left them **unscanned while the tree reported clean** — and this repository is public
(D-199, 08 §7.2). It now reads GPX, and the coordinate count rose from 10,611 to 13,148 across 23
files, which is how I know it is actually reading them rather than passing vacuously.

Its own self-test then caught the first implementation: I required `lat` before `lon` in source
order. **GPX does not fix attribute order**, so `<trkpt lon="…" lat="…"/>` is legal and would have
walked straight past the check. Matched independently now.

### Files

**New:** `src/adapters/__fixtures__/cell-set-equivalence.ts` + its test (12),
`src/adapters/__fixtures__/gpx-adapter.ts`, `src/adapters/__fixtures__/equivalence-run.gpx`,
`src/adapters/strava/cross-adapter-equivalence.test.ts` (5).
**Modified:** `src/adapters/registry.test.ts` (the exclusion + the replacement rule),
`scripts/check-adapter-deletion.mjs`, `scripts/check-fixture-geography.mjs` (GPX + 6 self-test
cases), `docs/contracts/ingestion-contract.md` §5 check 3, D-223.

## Operator validation

**None needed, and the ticket said so** — *"a pure unit comparison of two in-memory cell sets — no
screen, no device, no deployed resource."* It also asked for two specific results to be recorded,
and both are below, along with two more.

### Green

- **1,550 tests, 78 files**, `npm run typecheck` and `npm run lint` clean.
- All seven gate scripts pass, and all six that carry a `--self-test` pass that too — including
  `check-fixture-geography.mjs`'s, now 24 cases.
- The equivalence suite is 17 tests: 5 driving both adapters, 12 on the harness itself.

### Red — four ways of breaking it, each verified by hand

| # | What was broken | What happened |
|---|---|---|
| 1 | **An adapter regresses** — the GPX parser rounded to 4 dp (the measured 11 m case) | 2 tests fail: *"10.20% of the union differs, over the 2.00% tolerance"* |
| 2 | **The fixture adapter removed** | the suite fails to load: `Cannot find module '../__fixtures__/gpx-adapter'` |
| 3 | **The GPX run removed** | 3 tests fail with `ENOENT` on `equivalence-run.gpx` |
| 4 | **The primary's fixture removed** | 3 tests fail with `ENOENT` on `real-run-outdoor.json` |

Everything was restored and the suite is green again — 17/17 — which is itself the fifth check.

The ticket asked for red *"when the tolerance is tightened past what the fixtures support"*. That
turned out to be unreachable honestly: the fixtures diverge by **zero**, so no non-negative
tolerance can fail them. Setting it negative does go red (5 harness tests), but it proves nothing
about the fixtures. Case 1 is the real version of that check — an adapter that actually disagrees —
and it is the one recorded.
