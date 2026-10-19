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

- [ ] `savedRenderMode()` reads the setting capability 15 introduces; the stub's hard-coded answer is gone.
- [ ] The sequence renders in adventure for its whole length whatever the saved mode, including the
      fog palette, animation and label treatment §5.2 assigns to adventure.
- [ ] At the end of the sequence the map cross-fades to the saved mode over 300 ms; a user whose saved
      mode is atlas ends the sequence in atlas (`0080` criterion 5, as originally written).
- [ ] A user whose saved mode is adventure sees no fade and no change at the hand-back.
- [ ] Skip (`0084`) jumps straight to the saved mode with no fade, consistent with *"instantly, no fade"*.

## Notes

Filed from `0080` (D-295). The seam is `modeCrossFade` in `lib/run-moment/mode.ts` and its one call
site in `app/run/[activityId]/run-sequence.tsx`'s `finish`. If capability 15 ends up shipping with a
single mode after all, decline this ticket rather than keeping the stub alive.

## Operator validation

Desktop browser, with the saved mode set to atlas: open a run with `⟲ Relive`. The beat should play
in adventure and settle into atlas with a soft 300 ms fade, not a cut. With the saved mode set to
adventure, the hand-back should show no change at all.
