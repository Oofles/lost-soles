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

- [x] `traceToCells(trace): Set<H3Index>` is exported from `src/domain/fog.ts` and returns res-10
      ids only; a test asserts `getResolution(c) === 10` for every returned cell.
- [x] Purity: the test suite runs it with `Date.now`, `Math.random` and `fetch` stubbed to throw.
- [x] Samples with `accuracyM > 50` are dropped; samples with null accuracy are kept.
- [x] Non-finite and consecutive-identical coordinates are dropped.
- [x] A ≥60 s stretch under 0.5 m/s collapses to a single geometric-median point that still
      qualifies its own cell.
- [x] A jump above the settled `TELEPORT_SPEED` (criterion 11), or a >250 m gap lasting >120 s,
      splits the trace; no cells are emitted along
      the joining chord.
- [x] A synthetic trace with a 400 m sampling gap along a straight road still yields a contiguous
      cell chain (densification proof).
- [x] An out-and-back over the same street yields exactly the same set as the one-way version.
- [x] A figure-eight's crossing point contributes one cell, not two.
- [x] ~~A real checked-in Strava fixture (~2,700 points, 5 miles) yields **40–130 cells**.~~
      **AMENDED 2026-09-07 — the band was `0046`'s, and the fixture could not have met any band.**
      Two separate faults, both recorded in `## Resolution`:
      (a) **40–130 is the FILTERED count**, which `0046` criterion 6 already asserts. This ticket
      stops at §2.2 step 4's k=1 candidate set, ~2.5x larger by construction. Asserting 40–130 on
      candidates would mean skipping `gridDisk` — which §2.2 makes normative — or shipping a
      filter this ticket does not own.
      (b) **The fixture's synthetic geometry had no extent.** D-199's walk drew an independent
      random bearing per step, so a real 6,069 m run occupied a 98 m × 154 m box and projected to
      **2 cells**. Fixed here (D-213), and the generator regenerates rather than re-captures.
      **As built:** `src/adapters/strava/fog-projection.test.ts` drives the real `normalize()`
      over `real-run-outdoor` and asserts **120–200 candidate cells** (measured 145) and that the
      on-path count stays inside **40–130** (measured 58), so `0046`'s band stays reachable and a
      drift fails here rather than there. The test lives adapter-side because **D-188** forbids a
      domain test naming a vendor path.

- [x] **`Trace.gaps` (D-198) drives the split, before §2.2's own rules.** Added 2026-09-07 while
      implementing; §2.2's pseudocode predates the field and `01-architecture.md` §11 requires it
      (*"no cell is emitted across a `gaps` interval"*). Recorded as **D-212**, §2.2 amended with a
      step 0. §2.2's step 3 is kept as defence in depth for an unsanitized `Trace` and is expected
      never to fire on a normalised one. Tests cover both directions: a gap that no §2.2 rule
      would catch is still cut, and each side scores exactly as it would alone.
- [x] An all-garbage trace (every sample filtered) returns an empty set without throwing.
- [x] **`TELEPORT_SPEED` is reconciled with the ingestion sanitizer's gate, or the difference is
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

      **SETTLED 2026-09-07 — the first branch, with one correction to how it is spelled.**
      The criterion says to import the table *`sanitize.ts` already owns*, and that is not
      buildable: `check-boundaries.mjs`'s STRICT tier greps `/strava/i` over all of `src/domain`,
      so `fog.ts` importing anything from the adapter directory fails the build — and it is right
      to (D-100). **The dependency inverted instead.** `MAX_IMPLIED_SPEED_MS` and `metresBetween`
      moved to `src/domain/geo.ts`; the adapter now imports them from the domain, which is the
      direction D-100 wanted anyway, and `fog.ts` reads the same table. One gate, one owner, no
      restated literal — the test asserts the identity
      `TELEPORT_SPEED_MS === MAX_IMPLIED_SPEED_MS.run`, not the value, so a future measurement
      cannot move one and leave the other (D-193). No `ActivityKind` parameter: exactly one skill
      row has `revealsGround: true` (D-189), its `match` names the three on-foot kinds, and a test
      asserts all three hold the same gate. Recorded as **D-212**; §2.2's note is rewritten from
      "unresolved on purpose" to the answer, with 12.0 left visible as superseded.

## Notes

Candidate generation uses `gridDisk(c, 1)` so a path grazing a cell's edge still qualifies it; the
generosity is corrected by 0046's exact filter. Emitting `gridDisk(c, 1)` *as the answer* would be
7 cells and ~394 m across — it would gift the two parallel streets either side, which directly
attacks D-012.

This runs server-side in the ingest Lambda, always (`05-fog-of-war.md` §2.2). The client never
computes cells for scoring. With one user this is theoretical; the cost of getting the trust
boundary right is zero.

## Resolution

Closed 2026-09-07. `traceToCells` ships as specified; **three things in the plan turned out to
be wrong on contact, and all three are recorded as decisions rather than worked around.**

### Files

| File | What |
|---|---|
| `src/domain/fog.ts` | **new.** `traceToCells` + the §2.2 constants. Steps 0–4. |
| `src/domain/fog.test.ts` | **new.** 32 tests, all synthetic geometry near Point Nemo. |
| `src/domain/geo.ts` | **new.** `metresBetween`, `impliedSpeedMs`, `MAX_IMPLIED_SPEED_MS` — moved out of the adapter so both sides of the D-100 boundary can share one copy. |
| `src/domain/geo.test.ts` | **new.** The pure assertions from `sanitize.test.ts`, moved with the code. |
| `src/domain/contract-drift.test.ts` | the domain's dependency allowlist, narrowed to admit `h3-js` (D-214). |
| `src/adapters/strava/sanitize.ts` | imports the table and the haversine from the domain; ~90 lines excised, no behaviour change. |
| `src/adapters/strava/sanitize.test.ts` | keeps the behavioural gate tests; the pure ones moved. |
| `src/adapters/strava/fog-projection.test.ts` | **new.** Criterion 10, end to end through the real `normalize()`. Adapter-side because D-188 forbids a domain test naming a vendor path. |
| `scripts/make-strava-fixture.mjs` | correlated bearings (D-213) + a `--resynthesise` mode. |
| `__fixtures__/real-run-{outdoor,signal-loss,dst-boundary}.json` | geometry regenerated. |
| `docs/05-fog-of-war.md` §2.2 | step 0 added; the CONTESTED note replaced with its answer. |
| `docs/01-architecture.md` §11 | the stale `k=0` corrected. |
| `docs/decisions/DECISIONS.md` | D-212, D-213, D-214. |
| `package.json` / lock | `h3-js@4.5.0`. |

### The three findings

**1. `Trace.gaps` was in no acceptance criterion, and it is the one that matters most (D-212).**
§2.2's pseudocode takes a bare point list and predates D-198 entirely, while
`01-architecture.md` §11 has always required that no cell be emitted across a `gaps` interval —
and nothing said where that happened. Splitting on `gaps` is now step 0, and it is *strictly
stronger* than §2.2's own step 3 (30 s regardless of distance, against 250 m **and** 120 s), so
on a normalised trace step 3 never fires. Step 3 is kept anyway: this is a domain function and
it does not get to assume its caller sanitized anything.

**2. Criterion 11's first branch was unbuildable as written.** It said to import the table
*`sanitize.ts` already owns*. `check-boundaries.mjs`'s STRICT tier greps `/strava/i` over all of
`src/domain`, so that import fails the build — correctly. The dependency inverted instead: the
table moved to `src/domain/geo.ts` and the adapter imports it from there. `fog.ts` asserts the
*identity* rather than the value, so 12.0 is gone and the two gates cannot drift apart.

**3. The fixture could not have satisfied criterion 10, and nothing could have noticed (D-213).**
D-199's `synthesise()` drew an independent random bearing per step — a diffusive walk, extent
∝ √n. A real 6,069 m run occupied **98 m × 154 m**, roughly one res-10 cell of area, and
projected to **2 cells** against a required 40–130. Every existing check is satisfied by that:
the fidelity floor measures a sampling *rate*, the sanitizer measures step *lengths*, `bbox` was
only asserted to contain its own points, and the geography guard prefers a tighter scribble. The
fog projection is simply the first consumer that measures extent.

Bearings are now correlated (0.03 rad/m, measured); step lengths, point counts, timestamps and
every non-geometric field are byte-identical in effect, and the bearings still carry nothing from
the real track, so D-199's rejection of a rigid transform is untouched. Regeneration needed no
re-capture and no credentials: `synthesise` reads only step lengths, and the committed fixtures
already carry the real ones. `--resynthesise` is a branch in the capture script rather than a new
module, because `adapter.test.ts` keeps a deliberately short allowlist of files permitted to
decode an encoded line and a second module would have had to be added to it.

### Decisions taken while building

- **`h3-js` in the domain (D-214).** `contract-drift.test.ts` asserted the domain imports only
  `node:` builtins and siblings — written when `src/domain/` was three types-only files.
  `01-architecture.md` §11 names `h3-js` for this exact step, so the test was broader than the
  design. Narrowed to a one-entry allowlist with a reason, plus a test asserting the package
  really has zero dependencies rather than trusting the comment.
- **Weiszfeld, fixed iteration count.** Purity means determinism; iterate-until-converged makes
  the output depend on floating-point luck. The coincident-sample case (a receiver repeating one
  fix for two minutes) is handled explicitly — it is where Weiszfeld is undefined.
- **Great-circle interpolation** rather than linear-in-degrees. At the distances that survive
  step 3 the two agree to ~1 cm, so this buys no accuracy; it removes a small-angle assumption
  from a function whose output is permanent, for a few trigonometric calls.

### What went wrong on the way

Three of my own tests failed first, and two were my geometry rather than the code: the k=1
candidate disc reaches ~197 m, so "midpoint" probes 200 m from a leg were inside it and the
splits looked like non-splits. The third was worse — my "figure-eight" was four disconnected
legs whose implicit joining chord the splitter declined to cut, so it was testing the splitter
and not the `Set`. Rebuilt as one continuous walk. The `no-skill-names` gate (D-031) also caught
me naming a skill id in a comment, exactly as `sanitize.ts`'s comment warns it did to its own
first draft.

### Scope explicitly NOT taken

`REVEAL_R_M` and the exact radius filter remain `0046`. This function's output is a *candidate*
set and must not be treated as revealed ground; `0047` depends on `0046`, so nothing consumes it
in between. The `03-integrations.md` §2.2-vs-§2.6 citation error is ticket `0174`'s — the new
files cite §2.6 correctly, which adds two lines to that ticket's sweep rather than pre-empting it.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

**Nothing is routed to the operator.** This is a pure function with no screen, no deployed
resource and no AWS surface, so there is nothing an operator could see that a script cannot. The
original text said *"None (pure function, no UI)"* and that is still the right answer for the
function — but D-181 says the burden moves rather than disappears, so what was actually run is
recorded here.

**Smoke tests run by the agent, 2026-09-07, on this workstation (Node 23.11.1):**

| Check | Result |
|---|---|
| `npx vitest run` | **1149 passed, 1 skipped, 63 files.** 38 of them new. |
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings 0`) | clean |
| `node scripts/check-boundaries.mjs` + `--self-test` | clean — **and it fired first**, on the fixture path literal in the domain test. That is what moved criterion 10's test to the adapter side (D-188). |
| `node scripts/check-fixture-geography.mjs` + `--self-test` | **10,611 coordinates across 22 files, all within 0.05° of Point Nemo** — re-run after regenerating three fixtures, which is the check that matters most here. |
| `node scripts/check-adapter-deletion.mjs` + `--self-test` | clean after moving the gate table out of the adapter |
| `node scripts/check-design-tokens.mjs` | clean |
| `npm run build` | succeeds; first-load JS unchanged at 102 kB |
| `node scripts/check-bundle-leak.mjs` + `--self-test` | no secret in built output |
| `bash -n .githooks/pre-commit` | clean |

**The measurement that mattered**, since criterion 10 is a claim about a number:

| | before | after |
|---|---|---|
| `real-run-outdoor` bounding box | 98 m × 154 m | ~1.6 km radius |
| res-10 cells on the path | **2** | **58** |
| k=1 candidate cells | 10 | **145** |
| path length (unchanged, by construction) | 6,069 m | 6,070 m |

A hand-built 6 km rectangular circuit yields 49 path cells and 140 candidates, so the regenerated
fixture is in the right band for a real run rather than merely larger than it was.

**What no script here can prove, and which ticket proves it.** That the corridor *reads* as one
street wide on a real map is `0046`'s operator check, and that the operator's own streets appear
is `0059`'s. This ticket's output is a deliberately over-generous candidate set, so there is
nothing here a human eye could usefully judge yet.
