---
id: 45
slug: trace-to-h3-cell-set
title: domain/fog.ts — traceToCells, a pure trace → H3 res-10 cell Set
type: feature
priority: high
status: open
size: m
capability: 07-fog-projection-and-cells
depends_on: [25, 36]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`traceToCells(trace)` turns a normalized `Trace` into a **`Set` of H3 resolution-10 cell ids**.
Pure: no clock, no network, no RNG, no store access. `05-fog-of-war.md` §2.2 is the specification
and its pseudocode is normative.

**Resolution 10 is canonical and never mixed (D-115).** A res-9 cell and its res-10 children are
different ids; `gridDisk`, `gridDistance` and `gridPathCells` all refuse to cross resolutions.
Res 10 is the only resolution this function ever emits. Coarser resolutions exist only as derived
render aggregates (0058) and only as a transport option (0049), and a compacted array must go
through `uncompactCells(arr, 10)` before any membership test.

This ticket owns steps 1–4 of §2.2 — clean, collapse dwells, split on implausible jumps, densify
and collect candidates. The exact radius filter (step 5) and the `REVEAL_R_M` constant are 0046,
because that filter is the definition of "revealed" and deserves its own acceptance criteria.

Constants: `MAX_ACC_M = 50`, `DWELL_SPEED = 0.5 m/s`, `DWELL_MIN_S = 60`,
**`TELEPORT_SPEED = 12.0 m/s` — CONTESTED, see criterion 11**, `SPLIT_GAP_M = 250`,
`SPLIT_GAP_S = 120`, `DENSIFY_STEP_M = 30`.

Three of these carry reasoning that must survive into the code as comments:

- **Densify at 30 m**, comfortably under res 10's 65.7 m inradius, so no cell along the path can
  be skipped when the stream drops points in a tunnel. `h3.gridPathCells` is cheaper and wrong —
  it returns a *grid* line, not a *geodesic* line, fails across pentagons, and errors on long
  distances. Densify-then-index is boring and correct.
- **Collapse dwells, do not drop them.** The runner standing at a traffic light is still on the
  route and must still reveal that cell; left alone, GPS drift smears a disc of noise cells around
  one spot. Collapse each dwell to its geometric median.
- **Split, never interpolate, across implausible jumps.** A lost fix that reacquires 400 m away
  must not draw a corridor through buildings. Under-revealing is recoverable — run it again.
  Over-revealing is not: D-020 makes it permanent.

**The output being a `Set` is load-bearing.** Every same-run property in `05-fog-of-war.md` §3.3 —
out-and-backs, loops, figure-eights, crossing your own path — falls out of this one fact. Do not
"optimise" it into an array.

## Acceptance criteria

- [ ] `traceToCells(trace): Set<H3Index>` is exported from `src/domain/fog.ts` and returns res-10
      ids only; a test asserts `getResolution(c) === 10` for every returned cell.
- [ ] Purity: the test suite runs it with `Date.now`, `Math.random` and `fetch` stubbed to throw.
- [ ] Samples with `accuracyM > 50` are dropped; samples with null accuracy are kept.
- [ ] Non-finite and consecutive-identical coordinates are dropped.
- [ ] A ≥60 s stretch under 0.5 m/s collapses to a single geometric-median point that still
      qualifies its own cell.
- [ ] A jump above the settled `TELEPORT_SPEED` (criterion 11), or a >250 m gap lasting >120 s,
      splits the trace; no cells are emitted along
      the joining chord.
- [ ] A synthetic trace with a 400 m sampling gap along a straight road still yields a contiguous
      cell chain (densification proof).
- [ ] An out-and-back over the same street yields exactly the same set as the one-way version.
- [ ] A figure-eight's crossing point contributes one cell, not two.
- [ ] A real checked-in Strava fixture (~2,700 points, 5 miles) yields **40–130 cells**.
- [ ] An all-garbage trace (every sample filtered) returns an empty set without throwing.
- [ ] **`TELEPORT_SPEED` is reconciled with the ingestion sanitizer's gate, or the difference is
      justified in writing.** Added by the `05-strava-adapter` drift audit, 2026-09-06
      (divergence 2). `05-fog-of-war.md` §2.2 specifies 12.0 m/s; **D-197 set
      `src/adapters/strava/sanitize.ts`'s gate to 12.5 m/s** for `run`/`walk`/`hike` after
      measuring 21,225 real fixes, deliberately admitting bursts up to the ~12.4 m/s world-record
      peak. A trace arriving here has already passed that gate, so 12.0 can only fire on fixes
      D-197 chose to keep — and each such split writes a `gaps` entry (D-198), the *"dotted
      corridor"* §9.5 warns about. Rides are out of scope: only `wayfaring` has
      `revealsGround: true` and it matches `kinds: [run, walk, hike]`.
      **Either** import the per-kind table `sanitize.ts` already owns rather than restating a
      number (D-031: a gate per kind is a data row, never a `switch`), **or** record why the fog
      layer should split where the sanitizer accepts. §9.5's *"measure it on the user's real first
      20 runs"* applies — the 21,225-fix dataset from `0037` is the measurement. Silently shipping
      12.0 is the one outcome this criterion forbids, and `05-fog-of-war.md` §2.2 carries the
      matching note.

## Notes

Candidate generation uses `gridDisk(c, 1)` so a path grazing a cell's edge still qualifies it; the
generosity is corrected by 0046's exact filter. Emitting `gridDisk(c, 1)` *as the answer* would be
7 cells and ~394 m across — it would gift the two parallel streets either side, which directly
attacks D-012.

This runs server-side in the ingest Lambda, always (`05-fog-of-war.md` §2.2). The client never
computes cells for scoring. With one user this is theoretical; the cost of getting the trust
boundary right is zero.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

None (pure function, no UI). Validated indirectly by 0046 and 0059 — the first time the map shows
your actual streets is the real test of this code.
