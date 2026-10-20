---
id: 254
slug: beat-1-mode-crossfade
title: Beat 1 cross-fades from adventure to the saved map mode over 300 ms
type: feature
priority: med
status: open
size: s
capability: 15-two-map-modes-and-cold-territory
depends_on: [80, 98]
blocked_by: []
source: agent
created: 2026-10-13T15:53:19Z
started: 2026-10-19T20:41:49Z
---

## Description

`06-ui-ux.md` §3.2: the post-run sequence *"always plays in **adventure** rendering, regardless of the
user's saved mode … On completion it cross-fades (300 ms) back to the saved mode. This is legal
under D-051 … The cross-fade back is what keeps the promise."*

`0080` could not build this: the milestone ships one rendering (`V1` in `lib/fog/fog-uniforms.ts`,
adventure's darkness and animation) and no saved-mode setting exists. It stubbed the seam instead
(D-295): `lib/run-moment/mode.ts` has `SEQUENCE_MODE = "adventure"`, `savedRenderMode()` that always
answers adventure, and `modeCrossFade(saved)`, which `RunSequence` calls at the end of the beat and
which returns `null` today. This ticket makes it real once capability 15 has an atlas mode and a
saved setting to read.

## Acceptance criteria

- [x] `savedRenderMode()` reads the setting capability 15 introduces; the stub's hard-coded answer is gone.
- [x] The sequence renders in adventure for its whole length whatever the saved mode, including the
      fog palette, animation and label treatment §5.2 assigns to adventure.
- [x] At the end of the sequence the map cross-fades to the saved mode over ~~300~~ **320** ms; a user whose saved
      mode is atlas ends the sequence in atlas (`0080` criterion 5, as originally written).
      *(Amended: D-378 makes every mode fade the toggle's 320 ms — 06 §3.2 amended by `0098`. The title's
      "300 ms" is superseded the same way; the title is left as filed.)*
- [x] A user whose saved mode is adventure sees no fade and no change at the hand-back.
- [x] Skip (`0084`) jumps straight to the saved mode with no fade, consistent with *"instantly, no fade"*.

## Notes

Filed from `0080` (D-295). The seam is `modeCrossFade` in `lib/run-moment/mode.ts` and its one call
site in `app/run/[activityId]/run-sequence.tsx`'s `finish`. If capability 15 ends up shipping with a
single mode after all, decline this ticket rather than keeping the stub alive.

## Operator validation

Desktop browser, with the saved mode set to atlas: open a run with `⟲ Relive`. The beat should play
in adventure and settle into atlas with a soft 320 ms fade (D-378), not a cut. With the saved mode set to
adventure, the hand-back should show no change at all.

**Result (operator, 2026-10-20, desktop browser, `/run/:id` on the deployed site, build 419):** all checks good.
With saved mode atlas, Relive played in adventure and settled into atlas with a soft 320 ms fade. A click or Esc
mid-sequence landed already in atlas with no fade. With saved mode adventure, the hand-back changed nothing.
**Agent smoke (2026-10-19):** signed out, `/run/<id>` returned 307 to `/?next=…`; the route serves behind auth.
There is no new server surface; fade timings are covered by `lib/run-moment/beat1.test.ts`.

## Resolution

Most of this ticket was already built by `0098`. That ticket replaced the D-295 stub with
`savedRenderMode()`, which reads the toggle's per-device store in `lib/map-mode.ts`. It also added
`runPageMode`, which shows adventure for as long as the sequence plays, whatever mode was saved
or clicked. So adventure's V1 palette, its running `u_time` and its labels are on screen for the
whole beat. And it routed the hand-back through `MapShell`'s single swap path (D-374), which does
a diffed `setStyle` with `carryAppLayers` and a 320 ms fog-uniform/route-glow cross-fade.
Criteria 1–4 were therefore already true on `main`. This ticket confirms them and covers them
with tests.

The one gap was criterion 5. A skip changed the mode with the same 320 ms fade as a finish, but
06 §3.4 says skip is *"instantly, no fade"*.

### Files touched

- **`lib/run-moment/mode.ts`**
  - `modeCrossFade(saved, cause)` now takes the `ExitCause`. A `complete` cause (the sequence
    finished, or aborted) gets 320 ms, from the `MODE_CROSSFADE_MS` constant (D-378). A click, Esc
    or Back gets 0 ms. When the saved mode is adventure it returns `null`.
  - New `handBackFadeMs(cause)`.
  - New `runPageFadeMs({ frontierClicked, endCause })`, which gives the fade for the run page's
    next mode change. A frontier click always fades. A Relive (`endCause` back to `null`) keeps
    the existing 320 ms fade into adventure.
- **`app/run/[activityId]/run-moment.tsx`**
  - New `endCause` state. It is set in the exit's `onExit(cause)` and in the no-exit `onDone`
    path (`complete`), in the same handler as `dispatch({ type: "done" })`. React batches the two,
    so the mode change and its fade reach `MapShell` in one render.
  - `onRelive` clears it.
  - Passes `modeFadeMs={runPageFadeMs(…)}` to `MapShell`.
- **`components/map/map-shell.tsx`**
  - New optional `modeFadeMs` prop. It is held in a ref and read when a mode change lands, so a
    change of the fade alone never starts a transition.
  - It is passed as `ms` to `startModeTransition`. `ms <= 0` is that function's existing hard cut.
  - Reduced motion is still a hard cut whatever the value (D-376).
  - Home omits the prop and keeps 320 ms.
- **`app/run/[activityId]/run-sequence.tsx`**: a comment at `finish` names the new fade rule.
- **`lib/run-moment/beat1.test.ts`**: a new `0254` block.
  - A finish gets 320 ms; each skip cause gets 0.
  - A saved adventure gets `null` for every cause.
  - Checks `runPageFadeMs` in all four states.
  - Hands a skip's 0 ms to the real `startModeTransition`: one synchronous apply of atlas's frame
    and no rAF requested. A finish does request rAF.
- **`docs/06-ui-ux.md` §3.2**: one sentence saying a skip hands back with no fade. The edit shifts
  line numbers, so `docs/INDEX.md` needs regenerating (the orchestrator's job).

### Decisions

- **The hand-back's target is the saved mode, not the frontier override.** The frontier click
  only happens after the sequence, and `onRelive` resets it before the next play. So the
  hand-back always lands on `useMapMode()`'s saved value (D-378). Nothing here is ambiguous.
- **D-368's "trace ink over the fog in atlas" does not arise during beat 1.** The beat never
  renders in atlas.
- **A frontier click after a skip still fades.** It is a separate mode change, and the toggle's
  rule (320 ms) applies to it.
- **No second swap mechanism.** The skip's cut is the same `swapBasemap` + `startModeTransition`
  path with `ms = 0`.

### Verification

- All `amplify.yml` build-phase guards pass.
- `npm run typecheck`, `npm run lint`, `npx vitest run` (242 files, 4103 passed, 1 skipped) and
  `npm run build` pass.
