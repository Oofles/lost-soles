---
id: 327
slug: maplibre-renders-50-s-while-the-fog-animator-requests-29-fin
title: MapLibre renders ~50/s while the fog animator requests ~29 — find the extra render source
type: chore
priority: low
status: open
size: s
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-10-28T02:24:41Z
---

## Description

`0112`'s reduced-motion harness control run (2026-10-25) measured MapLibre rendering about 50 frames/s
while the fog animator requests about 29 repaints/s (D-376's 30 fps cap). Something other than the
fog loop is triggering renders. The cap on the animator's own requests holds. The extra ~20/s are
GPU and CPU time spent on frames nobody asked for. `0112` recorded this as "measured, not acted
on", and it was never ticketed. The capability 18 audit (§5, 2026-10-27) filed it.

## Acceptance criteria

- [ ] The source of the extra renders is identified, with evidence: a `render`-event trace with
      `triggerRepaint` callers, or the harness counts with candidate sources switched off.
- [ ] Either it is removed and the control run's render rate is ≤ the animator's request rate + a
      stated tolerance, or it is legitimate (for example, tile fade-in) and the reason is recorded in
      `## Resolution` with no code change.
- [ ] `tools/a11y/run-reduced-motion.mjs` still passes. If a fix lands, its control-run numbers are
      recorded before and after.

## Notes

Low risk: the frame budget is met with headroom on the RTX 5080 (`0298`, `0117` §9.5). Worth knowing
mainly because a render loop that runs when nothing changes is the kind of cost that grows quietly.
Candidates: MapLibre's own fade transitions, a layer's `paint` property updated per frame, and
`setFeatureState` calls.

## Operator validation

None owed. Harness counts are the evidence.

D-123 trigger checked? none.
