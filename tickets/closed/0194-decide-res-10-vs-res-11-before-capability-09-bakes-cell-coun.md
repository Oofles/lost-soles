---
id: 194
slug: decide-res-10-vs-res-11-before-capability-09-bakes-cell-coun
title: DECIDE res 10 vs res 11 before capability 09 bakes cell counts into the XP economy
type: design
priority: high
status: closed
size: s
capability: 08-map-and-fog-renderer
depends_on: [56]
blocked_by: []
source: agent
created: 2026-09-10T19:35:00Z
closed: 2026-09-11T01:51:22Z
---

## Description

**Raised by the operator looking at the real map**, during `0055`'s third validation pass: *"The
zig-zagging is still there which doesn't actually follow my run super well — will that be fixed in a
later ticket or is that an end-state artifact?"*

It is an end-state artifact of **D-115** (res 10 canonical), and §2.1 and §9.4 both name res 11 as
the documented escape hatch. This ticket exists to make that a decision with a date on it rather
than a paragraph everyone remembers differently.

### Measured, on the operator's own nine runs

```
res 10:   98 cells · centres wander median 28 m, p95 63 m · disc radius 102 m · corridor ~330 m wide
res 11:  695 cells · centres wander median 31 m, p95 61 m · disc radius  39 m · corridor ~200 m wide
```

**Two separate things, and only one of them is about resolution:**

1. **The wander is `REVEAL_R_M`, not the grid.** A cell is revealed when its centre is within 65 m of
   the path, so the chain of centres sits a median 28 m off the route. **Res 11 does not change
   this** — see the near-identical p95. Anyone reaching for res 11 to make the fog "follow the run"
   should read that row twice.
2. **The 102 m disc is what makes the wander visible.** A centreline wobbling 28 m is invisible drawn
   with a small brush and obvious drawn with a 200 m one. Res 11 shrinks the brush to 39 m and
   narrows the corridor by 40%.

### Why this is urgent in a way it was not last week

**XP is per-cell discovery credit.** The moment capability `09` lands (`0060`–`0064`), the
resolution is baked into the XP economy: level curves, the 693 ceiling, every ledger entry. Changing
it afterwards means re-deriving the ledger as well as the map, against D-135's rule that XP may only
ever be added to.

Right now the whole account is **85 cells**, and `0192` has just built a replay path that re-derives
the entire set from the S3 archive on demand. The cost of this decision will never be lower.

### What must NOT be used to decide it

**The `?fog=mask` debug view.** It is deliberately unflattering — hard-edged, near-black, fully
opaque — because its job is to make coverage legible, not beautiful. `0056` replaces it with soft
mist at 94% max opacity, an fBm-perturbed ragged boundary and a rim glow, and the basemap shows
through even under full fog. That is why this ticket `depends_on: [56]`: judging a resolution
question against pass 1's debug blit is judging the wrong picture.

## Options considered

### A. Stay at res 10 — reaffirm D-115

The corridor keeps its 102 m brush and its ~330 m width. `0056`'s mist may well make that read as
atmosphere rather than as geometry; §9.4 already accepted the over-reveal *"with an exit"*, and not
taking the exit is a legitimate outcome. Costs nothing, changes nothing, and the transport story
(§7's *"the explored set fits in a browser tab"*) stays comfortably true.

The risk is that it is chosen by default rather than on the evidence — which is what this ticket
exists to prevent.

### B. Re-derive at res 11 — supersede D-115

Brush 102 m → 39 m, corridor 330 m → 200 m, cells ×7 on this data (×4.4 at five-year scale). The
mechanism already exists: raw traces are archived immutably (D-101) and `0192` built the replay path
that re-runs them. The set is 85 cells today, so the migration is minutes.

Costs: transport goes from ~300–450 KB gzipped to ~1.5–2 MB at five years; `0058`'s viewport culling
stops being an optimisation and becomes required; and the XP economy must be settled against the new
counts before `09` writes its first ledger row.

### C. Keep res 10 for storage, render at res 11

Rejected before it gets proposed: §2.1 is explicit that mixed resolutions are not stored and that
coarser levels exist *"only as derived render/zoom aggregates"* — derived DOWNWARD, by `cellToParent`.
There is no upward derivation: a res-10 cell does not know which of its seven res-11 children the
runner actually crossed. Rendering finer than you store means inventing ground.

### D. Shrink `revealScale`

Narrows the corridor without touching storage, and reintroduces exactly the scalloping D-231 and
D-232 just removed — R4 bounds it at 1.15 and the seam collapses below that. Mentioned only so it is
not rediscovered as a cheap fix.

## Open questions

- **Does `0056`'s mist actually make the res-10 geometry acceptable?** The whole ticket turns on
  this and it cannot be answered before `0056` ships. It is the reason for `depends_on: [56]`.
- **What does res 11 do to the XP economy's feel?** Seven times the cells means seven times the
  discovery events for the same run. Whether that is "more satisfying progress" or "inflation that
  makes the 693 ceiling meaningless" is a game-design question for `09`, not a rendering one — but it
  has to be answered here, because after `09` the answer is expensive.
- **Is `REVEAL_R_M = 65` itself right?** The measured wander is a median 28 m, and it is set by that
  constant rather than by the grid. Nothing in this ticket proposes changing it — D-020 makes it
  permanent for ground already scored — but if the corridor still reads as not following the run at
  res 11, this is the number to look at next, and it is a much harder one to change.

## Acceptance criteria

- [x] `0056` is closed and the fog has been looked at as **mist**, on the desktop browser, over
      ground the operator recognises. — verified 2026-09-10 on `0056`: all five perception checks
      passed first time, *"street names are visible on revealed ground"*, *"panning works great"*.
- [x] **(operator)** A decision: stay at res 10, or re-derive at res 11. Recorded as a `D-xxx` that
      either supersedes D-115 explicitly or reaffirms it with the numbers above.
      — verified 2026-09-10: res 11. *"yes, res 11 looks a lot better! Go with that."* Taken
      against two rendered comparisons of the operator's own archived runs (see Resolution).
      Recorded as **D-237**, superseding D-115 explicitly and retiring D-216.
- [x] If res 11: the transport cost is re-measured rather than quoted. §2.1 prices five years at
      147,782 cells / 1.18 MB (res 10) against 657,289 / 5.26 MB (res 11), and ~300–450 KB gzipped
      against ~1.5–2 MB — *"the difference between 'ship it all, once' and 'think about paging'"*.
      Check it against `0054`'s real decode timings before committing.
      — measured, and **both of §2.1's numbers were wrong in opposite directions**; see Resolution.
- [x] If res 11: `0192`'s replay path is what re-derives the set. Confirm it produces the same
      corridor from the same archived bytes at the new resolution, and that D-020 is not violated on
      the way — the res-10 cells are not deleted, they are superseded.
      — **the replay path alone could not do it**, which is this ticket's most useful finding; see
      Resolution. Ten activities replayed, 590 cells, exact match against a local derivation.
- [x] ~~If res 10:~~ **res 11 was chosen, so this criterion's branch never ran.** Amended rather than
      dropped, because §9.4 still had to be rewritten — in the opposite direction. It now records
      that the exit was **taken**, with what it cost, so this is not re-litigated every time someone
      sees the map. The original wording (*"considered and declined"*) is preserved above.

## Notes

- **Not a bug and not `0055`'s to fix.** `0055` delivers §4.2's mask faithfully; D-231 and D-232 took
  it as far as the res-10 grid allows. The remaining shape is the grid.
- **A third option exists and is worse:** shrinking `revealScale` below R4's 1.15 bound would narrow
  the corridor and reintroduce scalloping, which is what D-231/D-232 just removed.
- **Watch the instance budget if res 11 wins.** Bridges (D-232) multiply instances by ~2–3x, and res
  11 multiplies cells by ~7x on this data. §6.4 asserts `visibleInstanceCount <= 6,000` at every
  zoom, so `0058`'s culling stops being optional and becomes load-bearing.
- The operator's screenshots that prompted this are in `tmp/`, which is gitignored — a screenshot of
  the fog names the streets and traces the route through them (D-199, `08` §7.2).

## Resolution

**Res 11. D-237, superseding D-115 and retiring D-216.** The operator chose it against two rendered
comparisons of their own archived runs, not against this ticket's prose — which matters, because the
prose had the mechanism wrong.

### What the ticket got right, and the one thing it got backwards

Right, and worth restating because it is counter-intuitive: **the wander is `REVEAL_R_M`, not the
grid.** Measured across eleven archived runs — res 10 median 28 m / p95 62 m, res 11 median 32 m /
p95 61 m. Res 11 does not make the corridor hug the route.

What it changes is the **brush**: `revealScale × circumradius`, 102 m → 39 m. A 28 m wander painted
with a 102 m brush reads as a zig-zag on any street run at an angle; the same wander painted with a
39 m brush reads as a line. `05` §2.1's second reason for res 10 — *"res 11 buys nothing visually,
hex geometry never reaches the screen"* — has a true premise and a false conclusion, because the
disc RADIUS is set by the grid even though the silhouette never is. Corrected in the doc.

**And the ground revealed does not change at all**: 1.343 km² at res 10 against 1.359 km² at res 11,
a 1.2% difference that is the finer grid resolving the same boundary. Membership is "centre within
65 m of the path" either way. That single measurement is what makes the migration safe under D-020
and what makes R3's cost model wrong.

### Two defects that would have shipped green

**`CANDIDATE_K`, and this is the one that matters.** D-216 observed that 65 m sat just under res 10's
65.7 m inradius, so a revealed cell had necessarily been *entered* — and that is precisely why step
4's `gridDisk(cell, 1)` was wide enough. At res 11 the inradius is 24.8 m, 65 m is 2.6 inradii, and
k=1 **misses cells**: measured 694 revealed at k=1 against 695 at k=2 on the operator's own runs. One
in 695, 0.14%, and under D-020 that miss is permanent — curable only by running there again. The
candidate disc is now derived from the grid rather than inherited from a coincidence that had
stopped holding. Ships at k=3, the provable bound; k=2 saturates empirically but the arithmetic
lands on 2.01 with no margin, and a permanent miss is the wrong thing to be tight about.

**`DENSIFY_STEP_M` 30 → 12.** Its contract is "comfortably under the inradius". 30 m is 1.2× res 11's
24.8 m — exactly the cell-skip it exists to prevent. The preserved quantity is the ratio (~0.46).

### Three tests were passing for the wrong reason

Found by the migration, and each was measuring grid slop rather than the property named on the tin:

- **Two bridge tests** probed `step(NEMO, 350, π/2)` for *"the corridor was bridged"*. That point is
  **91.7 m from the bridging segment** — outside `REVEAL_R_M` entirely. They passed at res 10 because
  that one cell's centre happened to land 61.3 m from the line, 30 m nearer than the probe itself; at
  res 11 the smaller cell's centre lands at 75.1 m. They now probe the bridge's own midpoint, which
  is resolution-independent and strictly stronger.
- **The dwell test** asserted `withPause.size === without.size` exactly. That held at res 10 by
  coarseness: the collapsed median sits ~8 m off the dwell point and at a 65.7 m inradius that never
  crossed a boundary. It now bounds the extra cells by one point's disc, which is what "collapsing to
  ONE point" actually claims.

`server.test.ts`'s chain-size test also needed k=180 → 240: at res 11 the same disk encodes to
197,963 B, under the cap, because delta gaps depend on the id layout and not only the cell count.
Its own precondition assertion caught that, which is the test working.

### The migration, and why the ticket's criterion 4 was not achievable as written

**`0192`'s replay path cannot perform a resolution change on its own.** `explored-blob-store.ts`'s
`readManifest` throws when the stored manifest's res does not match the code's, and it is right to —
the alternative is merging two resolutions into one blob. With the worker deployed at res 11 and the
manifest at res 10, every replayed activity would have failed in the `blobs` phase.

Worse, and only visible on reading the write path: **the AGG rows increment (`ADD exploredChildren
:added`), they do not recompute.** Replaying on top of the res-10 rows would have added ~590 res-11
children to counts already holding 85 res-10 ones — the same ground counted twice, silently
inflating coverage. A resolution migration therefore needs a deliberate cutover, which no ticket
specified and which was put to the operator before anything was deleted.

The cutover, with the operator's explicit go-ahead:

1. `manifest.json` copied to `manifest-r10-gen39.json.bak` in S3 and to `tmp/0194/backup/`, then
   deleted — which is what puts `regenerateExplored` on its bootstrap path.
2. The 102 res-10 T6 rows (85 cells + 17 AGG) deleted in five `BatchWriteItem` calls, **explicitly
   preserving the `#GEN` row**. Deleting that would have reset the generation counter, and
   `explored-generation.ts` is emphatic that a generation going backwards leaves *"every cached
   client convinced it is already up to date"*.
3. Ten receipted activities replayed. (An eleventh archived activity, `strava/15336494333`, has no
   receipt and the tool skips it — which is why the target was 590 and not the 695 that all eleven
   produce.)

**Result:** manifest `res: 11`, `cellCount: 590`, generation **39 → 54** (monotonic, never
backwards), object key `explored-r11.54.bin` — the derived name working, so the res-10 objects keep
their own names and are superseded rather than overwritten. D-020 holds: the res-11 set covers the
same ground, re-derived from the immutable archive (D-101).

### What went wrong

**The deploy was sequenced wrong and it broke the map for about forty minutes.** Pushing res-11 code
while the stored blob was still res 10 meant the client decoder rejected its own data — the safe
failure, and still a failure the operator would have seen had they opened the app. The cutover should
have been planned before the push, not discovered after it. The guard behaving correctly is what
turned a data-corruption bug into an outage, which is the trade it exists to make.

`0196` (bulk replay exhausts the manifest-race retries) recurred, as expected — one message stalled
in flight, DLQ 0, correctness unaffected. Recorded there as a third data point; it is now two
failures out of two bulk replays at ten, which is less intermittent than `0195` guessed.

### Left deliberately undone

- **`RES_PARENT` stays 6 and is now wrong**, visibly: a res-6 parent has 7⁵ = 16,807 res-11 children,
  the figure its own comment rejects for res 5. Confirmed in production data — the AGG rows now carry
  `totalChildren=16807` at res 6 and `2401` at res 7, which is the number the fix restores. Filed as
  **`0198`** rather than smuggled in behind a constant change.
- **The XP economy question resolves to calibration, not constraint.** 7× the cells means 7× the
  discovery events, but XP-per-cell is a free parameter `09` has not set yet; 7× cells at ⅐ credit is
  the same curve. There is no ledger to invalidate because there is no ledger — which was the whole
  argument for doing this before capability `09`. (The ticket's worry about "the 693 ceiling" was a
  misreading: 693 is 7 skills × 99 levels and has nothing to do with cell counts.)
- **`0058`'s viewport culling is now load-bearing** rather than an optimisation, as the ticket's
  Notes predicted.

### Files

`src/domain/fog.ts` (`RES`, `DENSIFY_STEP_M`, new `CANDIDATE_K`, step 4) ·
`src/pipeline/explored-blob-store.ts` (object keys derived from `RES`) · eleven test files ·
`docs/05-fog-of-war.md` §2.1 and §9.4 · `docs/02-data-model.md` volume and transport tables ·
`docs/09-roadmap.md` cells-per-run band · `docs/research/R3-geospatial.md` §2 cost table ·
`docs/decisions/DECISIONS.md` (D-237) · new `tools/fog-harness/res-compare.ts`,
`render-cells.{mjs,js}` and `workdir.mjs`.

**Also fixed, reported by the operator mid-ticket and unrelated to res 11:** 27 abandoned `~/fog-*`
scratch directories. All four `tools/fog-harness/*.mjs` tools `mkdtemp`'d into `$HOME` and never
cleaned up — done because headless chromium under WSL only loads `file://` from beneath `$HOME`. The
project is itself under `$HOME`, so `tmp/fog-harness/` satisfies the constraint without leaving the
repo. One owner (`workdir.mjs`), cleanup on `exit` and on `SIGINT`/`SIGTERM`/`SIGHUP`.

## Operator validation

### ★ OPERATOR RESULT — 2026-09-10: res 11 ★

*"yes, res 11 looks a lot better! Go with that."*

The decision is the deliverable, and it was taken against a picture rather than a paragraph — which
is the one thing this ticket insisted on. Two side-by-side renders of the operator's **own archived
runs**, re-derived at both resolutions and composited through the shipped `0056` fog over the same
ground, with the run polyline beneath:

- `tmp/0194/res-compare-diagonal.png` — 800 m across, centred on a **500 m stretch at bearing
  47.7°**, found by searching all eleven runs for the straightest most-diagonal segment. This is the
  case the operator described, and it is the one that settles it: res 10 steps left-right-left in
  102 m discs that bulge ~100 m off the line on alternating sides; res 11 tracks the line.
- `tmp/0194/res-compare-neighbourhood.png` — 2.8 km across, a whole run at browsing zoom. Res 10
  swallows the interior of the loop; res 11 lets the shape of the run be read back off the map.

Both are gitignored: a render of the real fog traces the operator's route (D-199, `08` §7.2).

**Not routed to the operator — nothing here needed a human, a phone, or a run** (D-181/D-229):

- **The full gate set, by exit code** (not by reading a tail): **1,931 tests** across 106 files,
  eleven guard scripts, `tsc --noEmit`, `eslint . --max-warnings 0`, `npm run build`. All 0. The
  generated `public/maplibre` was removed first, per `0188`/`0190`.
- **Amplify job 193** on `8a646f3`: BUILD / DEPLOY / VERIFY all `SUCCEED`.
- **Post-deploy smoke test:** `/` → 200 · `/?fog=noise` → 200 · `/?fog=mask,debug` → 200.
- **The deployed bundle actually carries res 11.** The client's res guard survives minification as
  `if(s!==n.$H)throw ... ": res "...", expected "...` and the `$H` export resolves to **11** in
  `page-77366b0491e916cf.js`. Checked on the artifact rather than in the source, because the source
  being right is not evidence that the bundle shipped it.
- **The published blob matches a local derivation exactly.** `explored-r11.54.bin` pulled from S3,
  decoded through the shipped `decodeExploredBlob`: header res 11, generation 54, **590 cells, 0
  missing, 0 extra** against `traceToCells` run over the same ten archived objects. 414 bytes on the
  wire.
- **The AGG rows rebuilt clean, not double-counted:** 2 parents at res 6, 5 at res 7, 13 at res 8,
  each summing to exactly 590 explored children.
- **Queue drained with DLQ 0**, one message stalled in flight — `0196`, expected, correctness
  unaffected.
- **Transport re-measured rather than quoted** (criterion 3), and §2.1 was wrong in both directions:
  the cell multiplier is **7×, not 4.4×** (same ground, finer description), *and* the bytes are far
  cheaper than feared, because the quoted figure priced 8-byte raw ids rather than the delta-varint
  format `0049` shipped — **3.01 B/cell at res 10 against 2.02 B/cell at res 11**, since finer sets
  have smaller gaps. The whole 5-mile disc around home, fully explored, is 100,369 res-11 cells in
  **198 KB raw, decoding in 8.1 ms** against `0054`'s recorded 46.9 ms at 152,551 cells and a 150 ms
  budget.
- **The harness cleanup verified by running all four tools** (`run.mjs`, `run-maplibre.mjs`,
  `render-png.mjs`, `render-cells.mjs`): all exit 0, `~/fog-*` count 0, `tmp/fog-harness/` empty
  afterwards.

**One thing genuinely left for the operator, and it is the next run rather than a checklist.** The
operator finished a run while this ticket was in flight and is holding it unsynced. Syncing it
exercises the res-11 path end to end through normal ingest on data that has never been replayed —
which is worth more than another replay and is what capability `07`'s audit needs for its USE step.
