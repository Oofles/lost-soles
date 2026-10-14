---
id: 258
slug: log-level-up-reduced-motion
title: Level-up cards on /log honour prefers-reduced-motion
type: feature
priority: med
status: open
size: s
capability: 12-post-run-moment
depends_on: [84]
blocked_by: []
source: agent
created: 2026-10-14T02:28:49Z
---

## Description

`0084` gave `LevelUpQueue` a `reduced` prop (`cardReducedAt`: no scale, no border wipe, no rise, no
flight) and passes it from the run sequence only. `/log` plays the same queue (§6.4, D-288) and still
plays it in full motion under `prefers-reduced-motion`. `06-ui-ux.md` §3.4 states the rule for cards
("appear and hold without scaling"), and §6.4 says `/log` plays them "identically".

Left out of `0084` so as not to widen it (D-298 records the boundary).

## Acceptance criteria

- [ ] `/log` passes `reduced` to `LevelUpQueue` from `REDUCED_MOTION_QUERY`, read when the queue starts.
- [ ] A test asserts `/log`'s queue is given the flag; the card frames themselves are already tested
      by `lib/run-moment/reduced-motion.test.tsx`.

## Notes

One line in `app/log/log-page.tsx` plus its test. `RunMoment` reads the media query with a
`useMemo` keyed on the play; `/log` can read it the same way, when a queue is created.

## Operator validation

None needed by eye beyond `0084`'s reduced-motion check, which judges the same card. Agent: emulate
`prefers-reduced-motion` in headless Chromium, log a workout that crosses a level, and confirm the
card's transform stays `none`.
