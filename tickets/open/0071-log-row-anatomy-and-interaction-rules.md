---
id: 71
slug: log-row-anatomy-and-interaction-rules
title: /log row anatomy and interaction rules — sweaty thumbs, one hand
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: [68]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The physical half of `/log`. `06-ui-ux.md` §6.4 and §9.2–9.3 specify a row that works when
**precision is unavailable** — a wet capacitive screen, gloves, one hand, heart rate at 150.

**Row anatomy**, all sourced from the registry:

| Element | Behaviour |
|---|---|
| Sigil + skill name + unit label | The unit label is the **plain-English** one (`pushups`, `plank`, `treadmill / track`) — "reps" and "seconds" are schema words |
| The number | Pre-filled with **your last logged value for this type** — not a goal, not an average, not a target. Tap → numeric keypad, select-all on focus |
| `−` / `+` | Registry-defined step: pushups ±5, situps ±5, plank ±15s, distance ±0.5 km. Long-press repeats at 4/s. Clamped at the registry's `minUnitsForCredit` |
| `LOG` | Commits that row immediately. 56 × 96dp, hard against the right edge |

**Reach and target rules (non-negotiable):** 56dp minimum touch target with 8dp minimum spacing;
touch slop raised to **16dp** so a finger sliding on a damp screen still registers as a tap and
not a flick; every frequent target inside the right-thumb arc (`y > 520dp` on a 412 × 915dp
viewport) or up the right edge.

**No gesture is the only path to anything.** **No swipe-to-delete, no drag-to-reorder, no
drag-and-drop** — they fail hardest with a wet thumb and they always destroy something when they
misfire. **A second touch point during a tap is treated as a pan, not a tap**, so water bridging
two contacts cannot log a workout.

**Undo, 8 seconds, in-row.** This is the one place the app permits a destructive action, and it
gets **undo, not a confirmation dialog** — a confirm dialog is two precise taps at exactly the
moment precision is gone. After a tap the row becomes its confirmation in place: `MIGHT 30
pushups · Might +120 → L31 · ⟲ Undo 7s`, gold, with a 6dp bar wipe on the skill bar that then
settles.

**Left-handed mirroring** is one flexbox direction and one flag in `/settings`; it flips the
`LOG` column to the left edge. Set once, never touched again.

## Acceptance criteria

- [ ] Every interactive target on the row is ≥ 56dp with ≥ 8dp spacing; `LOG` is 56 × 96dp and
      flush to the right edge.
- [ ] Touch slop for taps is 16dp, verified by a test that dispatches a pointer-down and
      pointer-up 12dp apart and asserts a tap fired.
- [ ] All of `−`, the number, `+` and `LOG` fall at `y > 520dp` on a 412 × 915dp viewport for
      the first row, and the page scrolls so any row can be brought into that band.
- [ ] The value is pre-filled from **the last logged value for that type**, per type, persisted
      locally; a fresh install falls back to the registry's default.
- [ ] `−`/`+` use the registry's step, long-press repeats at 4/s, and the value clamps at
      `minUnitsForCredit` (never below).
- [ ] Tapping the number opens a numeric keypad with the value selected; committing the keypad
      does not log.
- [ ] A second simultaneous touch point during a tap is treated as a pan and logs nothing.
- [ ] There is no swipe-to-delete, no drag-to-reorder and no drag-and-drop anywhere on the page.
- [ ] `LOG` produces the in-row confirmation with an 8-second `⟲ Undo`, counting down visibly;
      undo removes the entry locally and cancels or compensates the queued write.
- [ ] There is **no confirmation dialog** on this page, for any action.
- [ ] The unit label rendered is the registry's plain-English label, never `reps` or `seconds`.
- [ ] A left-handed flag in `/settings` mirrors the `LOG` column; no other layout changes.
- [ ] Every control has an accessible name and the row is operable by screen reader without
      relying on position.

## Notes

The 8-second undo window is the reason no confirmation exists. Do not add "are you sure" to any
control on this page, including under review pressure — the design assumes the mis-tap and
handles it afterwards, which is the only strategy that works with a wet thumb.

The pre-fill being *last value* rather than *average* or *target* is deliberate: an average is a
statistic and a target is an instruction, and this app gives neither (D-013, N4).

## Operator validation

On **`/log`** on a **6.8in Android phone (Pixel 8 Pro), held right-handed, one hand, with
genuinely sweaty thumbs straight off a set**: log **40 pushups one-handed**. The row must not
require a second hand at any point — not to reach `+`, not to reach `LOG`, not to dismiss the
confirmation. Deliberately mis-tap once and use `⟲ Undo` before it expires. Then rest a second
damp fingertip on the screen while tapping `LOG` and confirm **nothing is logged**. Repeat
wearing winter gloves; every target must still be hittable without looking twice.
