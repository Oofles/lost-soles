---
id: 298
slug: real-gpu-cost-of-the-cold-pass
title: Real-GPU cost of the cold pass and its frame copy
type: chore
priority: med
status: closed
size: s
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-20T13:32:55Z
started: 2026-10-26T13:42:13Z
closed: 2026-10-26T14:37:28Z
---


## Description

`0100` added a cold-territory pass in atlas that copies the frame under the fog into a texture
(`copyTexSubImage2D`) and samples it with ~17 taps plus the composite's warp (D-391). SwiftShader
cannot say what a full-frame copy costs on a real GPU. `0059`'s perf harness is the gate for
renderer cost but closed before this pass existed. Measure the cold pass on real hardware and
decide whether it needs a cheaper path.

## Acceptance criteria

- [x] Frame time in atlas with cold ground on screen is measured on a real GPU (desktop) against the
      same view with the cold weight forced to 0, and recorded in the capability doc.
- [x] If the pass pushes the frame past `0059`'s budget, a cheaper approach is proposed as a
      decision (e.g. a half-resolution copy, or skipping the copy when no cold disc is in view).
      *It does not on the desktop's GPU (RTX 5080, 1919×1023): both arms hold p50 16.7 ms. No
      decision is proposed. The copy is ~5% of the pass on every GPU measured, so neither example
      would buy anything. The lever, if one is ever needed, is the feather's tap count.*

## Notes

Filed by the orchestrator from `0100`'s report (wave 15.3, 2026-10-20). Adventure never runs the
pass (D-391), so only atlas is at stake.

## Resolution

**The cold pass is within `0059`'s budget on the desktop's GPU, and the frame copy is not where
its cost is.** Figures and setup are recorded in `docs/capabilities/18-mvp-hardening.md`, §"The
cold pass on a real GPU".

### Reaching a real GPU from WSL2

The question was whether anything here can render on hardware. It can, by this route:
- **headed** snap Chromium on WSLg, with `GALLIUM_DRIVER=d3d12`;
- Mesa then runs ANGLE over D3D12 through `/dev/dxg`;
- `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA` picks the RTX 5080 over the AMD iGPU.

Without the driver variable, Mesa falls back to llvmpipe. Headless Chromium only ever gets
SwiftShader or llvmpipe. The runner checks the renderer string and **refuses** (exit 2, no figure)
when it is software, so a CPU number can never be recorded as the GPU one.
`EXT_disjoint_timer_query_webgl2` is available on this path. That means GPU time per pass, not
only frame time.

### Files touched

- `tools/fog-harness/cold-cost-harness.js` (new). This is the page. It uses:
  - the 150k fixture through the shipped `ExploredSet`, `ZoomBucketStore` (with a `LastRunDays`
    that is 365 days old everywhere), `FogViewportController` and `FogMaskLayer`;
  - the shipped `PATH`, on a real rAF clock.

  Arms run in this order: warm-up (discarded), cold, off, cold, off, copy-only. Off is
  `{ ...ATLAS, coldWash: 0 }`, so the layer skips the pass and its copy. Copy-only is off plus a
  custom layer doing the same full-frame `copyTexSubImage2D`, timed on its own.

  It judges the measured arms against `report.ts`'s own constants:
  - D-241's frame budget on `PAN_PHASES`;
  - mask < 1 ms and composite < 2 ms of GPU time.

  It also asserts that the cold pass ran in every cold arm and never ran in an off arm.
- `tools/fog-harness/run-cold-cost.mjs` (new). The runner:
  - bundles the page with esbuild and inlines the fixture;
  - launches headed Chromium with occlusion and background throttling disabled;
  - reads the result over the DevTools protocol, using Node's global `WebSocket`, so there is no
    new dependency;
  - waits for Chromium to exit before `harnessWorkdir` cleans up. That fixes a race with the
    profile directory.

  Options: `--size`, `--dpr`, `--dataset`.
- `tools/fog-harness/README.md`: the runner listed and described.
- `docs/capabilities/18-mvp-hardening.md`: the measurement, the table and the reading.

### What was measured (150k cells, all cold, 690 states per arm)

- **RTX 5080, 1919×1023, DPR 1** (the judged case): `COLD COST PASS`.
  - Cold pass GPU time is 0.13–0.15 ms mean (1.4 ms max). The composite is ~1.6 ms in both arms.
  - Pan-phase p50 is 16.6–16.8 ms with the pass on and 16.7–16.8 ms with it off: vsync-locked
    either way.
  - Drops: 0% with the pass on, and one frame (0.8%) in one off arm.
- **RTX 5080, 3840×2048, DPR 2** (stress, not judged): fails D-241 **in both arms**.
  - p50 is 18.4 ms off and 18.6 ms on. The mask is 1.4 ms off, over its 1 ms budget.
  - The pass adds 0.2 ms of p50. The miss belongs to the frame size, not to the cold pass.
- **AMD Radeon iGPU, 1919×1023:** the off arm already fails.
  - The composite is 10 ms against its 2 ms budget, and p50 is 18.8 ms with the pass off.
  - The pass adds 7.3 ms of GPU and 8 ms of p50.
  - This path goes through Mesa's GL-on-D3D12 translation, so the reading is pessimistic, and it is
    not the display adapter.
- **The copy alone:** 0.018 ms on the 5080 and 0.37 ms on the iGPU, about 5% of the pass either way.

### Decisions made

- **The judged GPU is the RTX 5080.** It is the desktop's discrete card, and 05 §6.4's earlier
  desktop figure was also taken on a discrete NVIDIA card. The iGPU and the 4K figures are
  recorded, not judged.
- **No `D-xxx` is proposed for criterion 2.** Its condition, "the pass pushes the frame past the
  budget", does not hold on the desktop GPU. The two cheaper paths it suggests both target the
  copy, and the copy is measured at ~5% of the pass, so recording either one as a decision would
  record a non-saving.

## Operator validation

None perceptual. The figures above come from `run-cold-cost.mjs` on this machine (WSL2 → WSLg →
D3D12), against the RTX 5080 and then the AMD iGPU, run on 2026-10-26. The re-run command is in the
capability doc.

No deploy smoke test applies, because the commit ships tooling and docs only (Amplify build 430
was green). The open assumption, that the operator's desktop browser renders on the RTX 5080 and not
the AMD iGPU, is put to the operator in the wave's hand-over. If it is the iGPU, that is a new ticket
about the composite's budget, not a reopening of this one.
