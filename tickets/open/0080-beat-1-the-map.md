---
id: 80
slug: beat-1-the-map
title: Beat 1 — the map (0.0 to 2.9 s): camera, lantern, route ink, three kinds of ground
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [78, 79, 57]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The 2.9 seconds the whole app is built around. `04-game-design.md` §4.2: *"If we only ever get one
thing right in this app, it is this 2.5 seconds."*

`06-ui-ux.md` §3.2, to the frame:

- **0.0–0.4 — camera.** Fly to the run's bounding box with 12% padding, `easeOutCubic`, 400 ms.
  **If the run is already in frame, do not move** — a gratuitous camera move at the start reads as
  jank.
- **0.4–2.6 — the lantern.** A point of warm light (`--lantern-500 #FFB347`, 18dp soft radius,
  additive) travels the actual `latlng` stream, **never `summary_polyline`** (D-121 mitigation 4).
  Traversal is arc-length parameterised: constant screen speed, so 3 km and 20 km both take 2.2 s.
  This ticket drives `revealProgress` from 0079 off the lantern's arc position.
- **The route inks in behind it**: `run-core #fff2d0` at 2.5px over `run-glow #ffb347` blurred 10px
  at 0.35 — `05-fog-of-war.md` §4.4 verbatim, reused unchanged.
- **2.6–2.9** — lantern lands, settles, one soft pulse at the final point.
- **Mode.** The sequence always plays in **adventure** rendering regardless of the saved mode, then
  cross-fades back (300 ms) on completion. Legal under D-051 because legibility is a *task*
  guarantee and there is no wayfinding task inside the reveal — the cross-fade back is what keeps
  the promise.

**Three kinds of ground read differently as they clear** (this is not decoration — it is the user
being able to *see* why the tally says what it says):

| Ground | Visual | Duration |
|---|---|---|
| **New** (never run) | Gold-white bloom at the reveal edge, `--gold-300 #E3C766` → fades to bare parchment | 600 ms |
| **Remembered** (>6mo, re-armed, 50% credit — D-120) | Cool flush, `--frost-400 #7FA8C9`, dimmer and slower, like breath clearing off glass | 900 ms |
| **Familiar** (<6mo) | No bloom; route ink lays down over already-clear ground | Silent |

Beat 1 **must never be preceded** by a numbers panel, a title card, a loading spinner, or a
"Run imported!" toast. Nothing before the map. Ever.

**Sound: none.** No audio in this app, ever — it is used after a run, often around other people,
and sound is state you must configure, which is upkeep (D-013).

## Acceptance criteria

- [ ] Total beat duration is 2.9 s ± 0.1 s measured on the target phone, for both a 3 km run and a
      20 km run — the two must differ by less than 0.1 s.
- [ ] The camera does not move at all when the run's bounding box is already within the viewport at
      the current camera position.
- [ ] The lantern's path is sampled from the full `latlng` stream; a test asserts the point count
      used matches the trace's, and that `summary_polyline` is never read on this path.
- [ ] Fog reveal is gated on lantern arc position: at t=1.5 s the revealed area corresponds to the
      lantern's position, not to the full run.
- [ ] Rendering is in adventure mode throughout, and cross-fades to the saved mode over 300 ms at
      beat end; a user whose saved mode is atlas ends beat 1 in atlas.
- [ ] Cells classified new, cold and warm (0048) receive the gold, frost and silent treatments
      respectively — verified on a run that crosses all three.
- [ ] Nothing renders before the map: an automated check asserts no toast, dialog, spinner or title
      element mounts between route entry and t=0.
- [ ] No `Audio`, `AudioContext` or media element is constructed anywhere in the sequence.
- [ ] Frame rate holds inside the §6.4 budget for the whole beat on the real phone (0059 harness).

## Notes

Depends on 0079 for the animated mask (do not inline a second reveal path here), 0057 for the route
polyline layer, and 0078 for the route and end state to land in.

The three ground treatments read the discovery classification computed at ingest by 0048 — beat 1
must not reclassify anything client-side. If the classification is missing (an older activity
imported before 0048 shipped), fall back to the silent treatment; a missing bloom is a smaller lie
than a wrong one.

Scope discipline (§8.7): `06-ui-ux.md` §10 lists what is deliberately not built and it is binding.
Particle effects, a trailing comet tail, screen shake, a compass rose — file a ticket, do not extend
this one (07 §1.2: never expand a ticket's scope).

## Operator validation

**Go for an actual run and import it.** There is no substitute and no automated test for this beat.

On the Android phone, outdoors, ideally in daylight: open the push notification and watch. The first
thing you see must be the map. Watch whether the fog reads as retreating *behind* the light or as
switching off around it — if it switches off, the arc gating is wrong. On a route that crosses
ground you have not run before and ground you have, confirm the gold bloom appears only on the new
part and that the transition between treatments is not a visible seam. Then run the same route again
next week and watch it play with all-familiar ground: the lantern should still travel, the route
should still ink, and it should still feel like something happened. Note the wall-clock time from
tap to lantern-landing with a stopwatch; if it is not ~2.9 s, the beat is not done.
