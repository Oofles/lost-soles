---
id: 298
slug: real-gpu-cost-of-the-cold-pass
title: Real-GPU cost of the cold pass and its frame copy
type: chore
priority: med
status: open
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-20T13:32:55Z
started: 2026-10-26T13:42:13Z
---


## Description

`0100` added a cold-territory pass in atlas that copies the frame under the fog into a texture
(`copyTexSubImage2D`) and samples it with ~17 taps plus the composite's warp (D-391). SwiftShader
cannot say what a full-frame copy costs on a real GPU. `0059`'s perf harness is the gate for
renderer cost but closed before this pass existed. Measure the cold pass on real hardware and
decide whether it needs a cheaper path.

## Acceptance criteria

- [ ] Frame time in atlas with cold ground on screen is measured on a real GPU (desktop) against the
      same view with the cold weight forced to 0, and recorded in the capability doc.
- [ ] If the pass pushes the frame past `0059`'s budget, a cheaper approach is proposed as a
      decision (e.g. a half-resolution copy, or skipping the copy when no cold disc is in view).

## Notes

Filed by the orchestrator from `0100`'s report (wave 15.3, 2026-10-20). Adventure never runs the
pass (D-391), so only atlas is at stake.

## Operator validation

None perceptual: the measurement is scripted. A smoke test records the figures.
