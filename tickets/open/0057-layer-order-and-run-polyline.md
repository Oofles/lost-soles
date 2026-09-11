---
id: 57
slug: layer-order-and-run-polyline
title: Layer order — fog above labels, run polyline above the fog
type: feature
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: [54, 56]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-10T23:38:33Z
---

## Description

Layer order here is a design decision, not plumbing (`05-fog-of-war.md` §4.4).

**Fog goes above the basemap *and its labels*.** Unexplored place names stay hidden. That is most of
the "uncovering the world" feeling, and it is the reason label placement differs between the two map
modes later. A fog layer inserted below the symbol layers would leave street names floating over
undiscovered ground, which reads as a rendering bug and destroys the mechanic.

**The route goes above the fog.** Your own trace is always visible, even over ground whose cells
have not been written yet — a run that is still syncing must still draw its line.

Route styling, and the colours are specified because they have to survive both backgrounds:

```js
run-glow: line-color #ffb347, line-width 12, line-blur 10, line-opacity 0.35
run-core: line-color #fff2d0, line-width 2.5
both: line-cap round, line-join round; source has lineMetrics: true
```

Warm cream core with an amber glow reads on parchment *and* against dark fog. Pure white blows out
on parchment; pure red vanishes into it. Do not substitute a "nicer" colour — this pairing is doing
two jobs at once and capability `15` will introduce the parchment background these were chosen for.

**Optimisation worth taking:** draw the just-uploaded run's polyline into the **mask** as a thick
soft line as well, so the corridor clears the instant the run appears, before the server's cell
write round-trips back. This writes to the mask texture only, **never to the explored set**, and is
discarded on the next rebuild. The client never invents cells.

Route geometry comes from the stored polyline object per activity, not from the raw archive and not
from the cell set.

## Acceptance criteria

- [x] The fog custom layer is inserted above every symbol layer in the Protomaps style; a test
      asserts its index is after the last `symbol` layer.
- [x] **(operator)** Place names and street labels in unexplored territory are not visible through
      the fog. — verified 2026-09-10: labels stay hidden.
      *Re-classified by `0057`. It was not marked `(operator)` and it had to be: §4.3 sets
      `maxOpacity` to 0.94 deliberately, so 6% of the basemap bleeds through fogged ground by
      design (`fog-uniforms.ts`: "the whole difference between mist over a map and a hole cut in a
      black sheet"). Whether a street name survives that is a legibility judgement no test can
      make. The MECHANISM this criterion depends on — the fog above every symbol layer — is
      criterion 1 and is asserted against the real Protomaps layer list.*
- [x] `run-glow` and `run-core` layers exist above the fog with exactly the paint values above,
      `lineMetrics: true` on the source.
- [x] A run whose cells have not yet been written still renders its polyline.
- [x] The optimistic mask write draws the latest run's polyline as a thick soft line into the mask
      and is cleared on the next bucket rebuild.
- [x] The optimistic path writes to the mask only; a test asserts the explored `Set` and
      `BigUint64Array` are untouched.
- [x] **(operator)** Toggling the fog layer off leaves basemap and route rendering correct.
      — verified 2026-09-10: `?fog=off` works and the route is still drawn.
      *Also re-classified, and for a weaker reason than criterion 2: the mechanical half is tested
      (`?fog=off` adds no custom layer, and every stock style layer plus both route layers is
      still present and in order). What a test cannot say is whether MapLibre actually DRAWS them
      — the failure worth catching is a route that was accidentally made to depend on the fog
      layer's existence, and that is invisible until somebody looks.*
- [x] Route rendering is correct across a trace with a split (0045) — no chord drawn across the gap.

## Notes


**Blocked 2026-09-10 on 0195:** 0057 draws route geometry from a stored per-activity object that is never written — traceRef is null on every row, no object exists under traces/, and no endpoint serves one. 0195 writes the artefact and serves the latest run.

The hex grid is not drawn, at all. If the game-y grid read is ever wanted, it is a *separate* faint
decorative `line` layer of hex boundaries, clipped to revealed ground, at high zoom only — and kept
strictly out of the mask (`05-fog-of-war.md` §4.1). Not at this milestone.

## Resolution

**Closed across two sessions.** Two criteria turned out to be perceptual and were re-classified
`(operator)` — see the criteria themselves for the reasoning — so the code was committed and
deployed (job 190) while the ticket stayed open, and the operator's answers came back the same
day. Both held. One observation about colour was deferred to `0197` rather than acted on.

### What was built

| File | What it owns |
|---|---|
| `lib/map-layers.ts` | §4.4's layer order, the route source/layers, the palette resolver |
| `lib/fog/route-corridor.ts` | the optimistic corridor — polyline → disc instances |
| `lib/fog/mask-layer.ts` | `setOptimisticRoute`, and the upload path reworked around it |
| `lib/runs/wire.ts` | the served shape, moved out of `server.ts` so a client may import it |
| `lib/runs/client.ts` | the browser half of `/api/runs/latest` |
| `components/map/use-latest-run.ts` | when to ask, and where the two pieces of geometry land |
| `lib/fog/debug-flags.ts` | `?fog=off` |
| `app/tokens.css` | `--route-glow`, `--route-line` |
| `src/domain/geo.ts` | `metresBetween` widened to a clock-free `Located` |

### The corridor is drawn as discs, not as a line

"A thick soft line" in §4.4 describes the result, not the primitive. Rendering it as an actual
line would have meant a second program, a second VAO and a second falloff function — and then a
corridor whose feather is a **different shape** from the one the cells produce, so the moment the
real cells landed the edge would change character. That is precisely the visible jump the
optimisation exists to prevent.

Splatting the same disc the cell field is made of costs no new GL objects at all: four floats in
the layout `mask.ts` already draws, appended to the bucket's own array and drawn by the same single
`drawArraysInstanced`. It is D-232's bridge-disc move one layer further out, and the spacing is
D-232's number for D-232's reason.

**It is narrower than what replaces it, on purpose.** The cell reveal covers every res-10 cell
within 65 m of the trace and then draws a 102 m disc at each centre, so the eventual corridor
reaches further from the line than a 102 m disc centred ON the line does. Under `gl.MAX` a
near-subset is invisible once the real thing arrives, and the asymmetry is the right way round:
too narrow means the fog edge creeps outward when the cells land, which is what this map does
anyway. Too wide would mean clear ground going back into the mist.

### The colours were already in the palette — `check-design-tokens.mjs` found that out

§4.4 writes `#ffb347` and `#fff2d0` as literals and the ticket says not to substitute anything
nicer, so the first implementation put them in `map-layers.ts`. The design-token gate failed the
build: raw hex lives in `app/tokens.css` and nowhere else (§8.3).

That read as two design rules in conflict and it was not one. **`0016` had already written both
values into `app/tokens.css`**, under the comment *"Lantern — the frontier, the route, the reveal.
FIXED BY 05-fog-of-war.md §4.4. DO NOT RETUNE."* The palette was written for this ticket before
this ticket existed, and the gate was pointing at the file that already held the answer.

So the values are unchanged and the module resolves them from the computed style. The gate's own
escape hatch (`design-tokens:allow`) would have been the wrong call — the reason to suppress would
have been "the colour is specified elsewhere", and it turned out to be specified exactly where the
gate said to look. Two semantic tokens were added (`--route-glow`, `--route-line`) because §8.3
says components reference semantics, not primitives; **both are deliberately absent from the two
dark-theme blocks**, since §8.3 also says the dark theme does not darken the map and the route sits
on the same fog in either theme. A test asserts that absence, because "finishing the set" in the
dark block is an easy and wrong thing to do later.

The one real cost: a MapLibre paint value cannot BE a CSS variable, so it is read once per data
change via `getComputedStyle`. `routePaletteFrom` throws on an empty token rather than falling back
to a literal — a fallback would be a second copy of the colour in the module the tokens exist to
keep colour out of — and `use-latest-run.ts` catches, so a broken stylesheet costs the line and not
the map.

### `#pending`/`#lastBucket` became desired-state-plus-a-dirty-bit

`0055` held a bucket that `prerender` consumed and a `#lastBucket` it re-queued whenever the
instance buffer was destroyed. A second source of instances would have made that two consume-once
queues that must be re-queued together — four ways to be half-uploaded. Holding the desired
contents and one dirty flag makes "re-upload everything" a single assignment, which is what a
variant rebuild, a style reload and an `onRemove`/re-add all actually want. All 26 of `0055`/`0056`'s
existing layer tests pass unchanged against it.

One behavioural difference worth naming: the upload is now skipped when there is nothing to upload
into an already-empty buffer, so a fogless boot no longer logs a `visibleInstanceCount=0` line per
resource build. An empty upload over a *non-empty* buffer still happens — that is how an emptied
set clears a stale mask.

### Hook order is load-bearing and is guarded by a grep

`setBucket` discards the corridor (criterion 5). Effects run in declaration order, so `map-shell.tsx`
must call `useFogMask` before `useLatestRun` or the corridor is wiped on the commit it was set —
intermittently, depending on what else re-rendered. The vitest environment here is `node` with no
DOM, so the hook cannot be driven; `use-latest-run.test.ts` asserts the source order instead and
says plainly that it is a tripwire rather than a test. `no-per-frame-projection.test.ts` is the
precedent.

### `metresBetween` now takes a position without a clock

The corridor interpolates points along a polyline that were never fixes, so it has no honest value
to put in `GeoPoint.t`. Widening the parameter to `Pick<GeoPoint, "lat" | "lng">` was preferable to
fabricating a timestamp at the call site: an invented `t` on something the map treats as a recorded
position is the kind of value that later gets believed. Both existing callers pass a full
`GeoPoint` and are unaffected; `geo.test.ts` now covers both shapes.

### What went wrong

**Three of my own edits, not the design.** A `python3` string-slice edit to `map-layers.ts` silently
deleted the three spec builders along with the block it was replacing — caught by `tsc`, not by
anything I did. A second one truncated `debug-flags.test.ts` at the import block, which vitest
reported as "Expected identifier but found end of file"; restored from git and redone. And I read
`npm run lint`'s exit code through a pipe to `tail` and got `0` from `tail` while eslint had exited
`1` — the exact failure the *verify gates by exit code* rule names, on the first try, in the same
session it was recalled.

**A wrong claim in `0195` that this ticket's smoke test corrected.** `0195` recorded that "a chord
across a split would be hundreds of metres to kilometres". Against the ten real stored objects the
three genuine splits are **20.9 m, 4.4 m and 14.1 m** apart end-to-start — they are pause/quality
splits, not teleports. So the real data does not exercise criterion 8 nearly as hard as that
sentence suggests, and the synthetic 5 km-gap test is what actually proves the no-chord property.
Recorded rather than quietly relied on.

## Operator validation

### What I ran myself

**The shipped corridor packer against the real stored geometry.** All ten `traces/` objects for
the live account, pulled from S3 with the `devault` profile and fed to `packRouteCorridor` — the
same function the browser calls, not a re-implementation. No coordinates are reproduced here
(D-199, `08` §7.2).

```
  parts  vertices  discs   maxDiscGap    truncated
    1       648      25      66.0 m        false
    2      1369      58      66.1 m        false
    1       621      25      66.0 m        false
    1      1169      46      66.0 m        false
    2      1012      42      66.0 m        false
    1      3603     133      66.5 m        false
    1       982      38      65.6 m        false
    1       427      17      66.0 m        false
    2      3915      96      65.9 m        false
    1      2801      90      66.4 m        false

corridor step (res 10)     65.7 m
objects / with a split     10 / 3
total optimistic discs     570      (largest single run: 133)
worst gap between discs    66.5 m
longest split refused      20.9 m
```

- **No object truncated**, and the largest single run contributes 133 discs against a
  `MAX_CORRIDOR_DISCS` of 4,000 and §6.4's 6,000-instance budget. The cap is a guard, not a
  constraint at real volumes.
- **`maxDiscGap` exceeds the 65.7 m step by up to 0.8 m**, and that is the instance buffer's
  precision rather than a hole in the walk: instances are `Float32Array`, which resolves to ~0.6 m
  of ground at these latitudes, and two adjacent discs can each carry that error independently.
  It is under 1% of the 102 m disc the value positions. The unit tests assert the same bound with
  the same reasoning.
- **No disc lands in any split's gap** — see the Resolution for why the real gaps are too short to
  make that a hard test, and why the synthetic one carries the criterion.

**The deploy.** Amplify job **190 SUCCEED** (`a89d5d0`), after 189 on `0195`'s close commit.

**The endpoint, live and still gated, after the deploy.** `GET` and `POST` to
`https://soles.devaultsecurity.com/api/runs/latest` unauthenticated both answer `404` — unchanged
by this ticket, and the data path the renderer depends on is the one `0195` deployed. `GET /`
answers `200`, and the signed-out payload still carries no coordinate (`0053`'s check, re-run by
hand because this ticket adds a second geometry source to that page).

**The gate set, by exit code** (not through a pipe): nine guard scripts, `npm run typecheck`,
`npm run lint`, `npm run build` and **1,931 tests across 106 files** — all `0`, with
`public/maplibre/` moved aside for `check-design-tokens` and `lint` (tickets `0188`/`0190`, already
open; CI lints before it builds, so the directory does not exist there). **No AWS SDK reached the
client bundle** — `.next/static/chunks` contains no `DynamoDBClient`, `client-dynamodb` or
`SignatureV4`, which is what `lib/runs/wire.ts` exists to guarantee.

### What is still the operator's — desktop browser (D-227), after this deploys

Two observations, one page load each. Nothing to set up, nothing to construct.

1. **`https://soles.devaultsecurity.com/`** — pan to the edge of your territory. Inside revealed
   ground street names should read normally; **immediately outside it, no place name or street name
   should be legible through the fog.** If names bleed through, the insertion point is wrong. While
   you are there: the route line should be findable at a glance — the amber glow doing its job —
   and the cream core should stay visible where the line crosses from revealed ground onto fogged
   ground.
2. **`https://soles.devaultsecurity.com/?fog=off`** — the fog layer is not added at all. The
   basemap should look exactly like the stock map and **the route must still be drawn**. This is
   the check that the route was not accidentally made to depend on the fog layer existing.

### What the operator reported — 2026-09-10, desktop browser

1. **Labels stay hidden.** Criterion 2 holds: no place or street name is legible through the fog
   over unexplored ground.
2. **`?fog=off` works and the route is still drawn.** Criterion 7 holds — the route does not
   depend on the fog layer existing.
3. **The route is findable, and the amber reads as subtle against the stock basemap.** Verbatim:
   *"a little hard to see with the light colored amber on white/gray of the map. However, I kind of
   like it since it's not too obtrusive."* **Expected, and not a defect to fix here.** §4.4 chose
   `#ffb347` / `#fff2d0` to survive *parchment* and dark fog — and the parchment fork is
   **capability 15**, which has not landed. The stock Protomaps `light` flavour is the wrong
   background for this pairing and `09-roadmap.md` §2.3 calls that ground *"present but ugly"* on
   purpose. Recorded rather than acted on: the ticket is explicit that the colours are not to be
   retuned, and retuning them against a background that is being replaced is how a palette drifts.
   Capability 15 is where this is re-judged, with the right ground under it. Filed as `0197`
   (`15-two-map-modes-and-cold-territory`) so it is a scheduled look rather than a memory.
4. **Only the latest run is drawn.** Expected: `/api/runs/latest` serves exactly one feature by
   design (`0195` argues why a list endpoint built against no caller would be guessed at and
   rewritten), and **`0085` owns the permanent trace layer** — every route ever run, faint sepia,
   accumulating into a web of worn paths — in capability 12.
