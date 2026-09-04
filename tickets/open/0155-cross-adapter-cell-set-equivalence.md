---
id: 155
slug: cross-adapter-cell-set-equivalence
title: T3 cross-adapter equivalence — one run, two adapters, the same H3 res-10 cell set
type: chore
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: [45]
blocked_by: []
source: agent
created: 2026-09-04T00:46:59Z
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

- [ ] A fixture adapter exists under `__fixtures__/` implementing `SourceAdapter`, whose
      `normalize()` reaches the same `Trace` as the primary adapter by a genuinely different code
      path — not a copy of the primary's parser, or the test proves nothing.
- [ ] One physical run, as a checked-in fixture, is ingested through both adapters and both cell
      sets are computed with `traceToCells` at res 10.
- [ ] The assertion is on **set equality within a tolerance**, and the tolerance is a **named
      constant with a comment justifying its value** — not an inline number.
- [ ] The tolerance's justification says what physical difference it is absorbing (float rounding
      at a cell edge) and what it must NOT absorb (a dropped segment, a collapsed loop).
- [ ] The test is not `.skip`, not `.todo`, and fails if either adapter is removed.
- [ ] The failure message names **D-100 / D-121.1 / D-020** and says, in one line, that an
      unequal cell set means permanent wrong ground on a map that cannot re-fog.
- [ ] Runs in `npm test`, and therefore in both `.github/workflows/gate.yml` and `amplify.yml`.
- [ ] `docs/contracts/ingestion-contract.md` §5 check 3 is annotated with the ticket that
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

## Operator validation

None. A pure unit comparison of two in-memory cell sets — no screen, no device, no deployed
resource. Verified by the agent: the test green, and red when either adapter is removed or the
tolerance is tightened past what the fixtures support. Record both results at close.
