---
id: 249
slug: skill-and-chronicle-sheets-dismiss-on-swipe-down
title: Skill and chronicle sheets dismiss on swipe-down
type: feature
priority: low
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-08T15:18:40Z
---

## Description

`06-ui-ux.md` §1.5 says sheets — `/chronicle`, the skill detail sheet, ticket capture — dismiss
"on back, on swipe-down, and on scrim tap". `0074` shipped the skill sheet with Esc, scrim click,
a Close button and back, and **no swipe-down**, without amending §1.5. Found by the `11-skills-panel`
drift audit (2026-10-08); the operator chose to keep the design and add the gesture.

**Low priority on purpose.** The desktop browser is the viewing surface (D-227, D-251); the phone
is for capture and the occasional glance. Swipe-down is the phone affordance a bottom sheet is
expected to have there, and nothing more.

## Acceptance criteria

- [ ] On a touch device at < 1024px, a downward drag on the skill sheet that starts at its top
      (the sheet scrolled to 0) dismisses it through the same path as every other dismissal
      (`router.back()` from the panel, `router.replace("/skills")` after a deep link).
- [ ] A downward drag while the sheet's content is scrolled scrolls the content and does not
      dismiss.
- [ ] A short or mostly-horizontal drag does not dismiss.
- [ ] Every existing dismissal path (Esc, scrim, Close, back) still works; at ≥ 1024px, where the
      sheet is a centred dialog, nothing changes.
- [ ] One gesture implementation, shared by every sheet — `/chronicle` and ticket capture take it
      when they are built, rather than each growing their own.

## Notes

- `app/skills/skill-sheet.tsx` owns the sheet today; the gesture likely belongs in a small shared
  hook so §1.5's other sheets reuse it.
- Pointer events, not a gesture library: one vertical threshold, no inertia physics.

## Operator validation

None from the operator by default: the gesture is behaviour a test can drive with synthetic
pointer events, and the phone is not a validation surface (D-227). If the operator happens to try
it on the phone, that is a bonus, not a gate.
