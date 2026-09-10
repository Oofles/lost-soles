---
id: 194
slug: decide-res-10-vs-res-11-before-capability-09-bakes-cell-coun
title: DECIDE res 10 vs res 11 before capability 09 bakes cell counts into the XP economy
type: design
priority: high
status: open
capability: 08-map-and-fog-renderer
size: s
depends_on: [56]
blocked_by: []
source: agent
created: 2026-09-10T19:35:00Z
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

- [ ] `0056` is closed and the fog has been looked at as **mist**, on the desktop browser, over
      ground the operator recognises.
- [ ] **(operator)** A decision: stay at res 10, or re-derive at res 11. Recorded as a `D-xxx` that
      either supersedes D-115 explicitly or reaffirms it with the numbers above.
- [ ] If res 11: the transport cost is re-measured rather than quoted. §2.1 prices five years at
      147,782 cells / 1.18 MB (res 10) against 657,289 / 5.26 MB (res 11), and ~300–450 KB gzipped
      against ~1.5–2 MB — *"the difference between 'ship it all, once' and 'think about paging'"*.
      Check it against `0054`'s real decode timings before committing.
- [ ] If res 11: `0192`'s replay path is what re-derives the set. Confirm it produces the same
      corridor from the same archived bytes at the new resolution, and that D-020 is not violated on
      the way — the res-10 cells are not deleted, they are superseded.
- [ ] If res 10: §9.4's *"accepted, with an exit"* is updated to say the exit was considered and
      declined, with the reason, so this is not re-litigated every time someone sees the map.

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

## Operator validation

The decision itself. Nothing to construct: the input is `0056`'s output on ground they already know.
