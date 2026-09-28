---
id: 211
slug: fog-edge-reads-as-disc-outlines
title: The fog edge reads as disc outlines, not ragged mist — noiseAmp cannot fix it
type: feature
priority: low
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [119]
blocked_by: []
source: agent
created: 2026-09-28T12:27:56Z
---

## Description

Filed from `0119`. §4.3 promises *"a ragged, organic mist edge instead of a smooth blurred blob"*.
Over the real basemap at z16 the edge still reads as **scalloped disc outlines**, a chain of
circles following the corridor, at every `u_noiseAmp` in §5.2's range, including the 0.25 that
`0119` shipped.

`0056` recorded why, and `0119` confirmed it by eye. The noise displaces the boundary by
`amp/2 × (1 − FALLOFF_INNER) × radius`, about 5 m at 0.25, against a reveal ramp roughly 17 m wide.
That ratio, not the amplitude, is what decides raggedness. The other lever is `FALLOFF_INNER`, and
D-231 raised it to 0.60 specifically to kill the neighbour seam, so lowering it trades one artefact
for the other. That is a design decision, which is why `0119` did not touch it.

Candidate directions (to evaluate, not to pick here): perturb in the mask pass rather than on the
threshold; domain-warp the coverage lookup (sample `u_mask` at a noise-offset UV) so the edge
itself moves; or accept disc outlines as the look. Any change must keep D-243's per-level coarseness
step, which the operator likes, and must re-check `SEAM_FLOOR`.

## Acceptance criteria

- [ ] A decision on the edge treatment is recorded as a `D-xxx`, including whether it supersedes any
      part of D-231.
- [ ] If the shader changes: the neighbour seam stays invisible (the `run.mjs` T3 probe stays green),
      the noise stays ground-anchored under a pan (D-233), and the per-level step survives (D-243).
- [ ] Rendered at z16 with `tools/fog-harness/tune.mjs` next to `0119`'s `z16-after-0119.png`.
- [ ] Labels inside revealed ground at the frontier are no less readable than with the fog off (D-051).

## Notes

- `0119`'s baseline: `docs/capabilities/assets/0119/z16-after-0119.png`.
- The edge is scale dependent (ground metres): judge it at the zoom the map is actually used at, and
  also at z14–z15, where the wobble is only a couple of pixels.

## Operator validation

Desktop browser (D-240). Look at a frontier at z16 and at z14: does the edge read as drifting mist
or as a chain of circles? Pan for 20 s: no crawl, no boiling. A perceptual call (D-229).
