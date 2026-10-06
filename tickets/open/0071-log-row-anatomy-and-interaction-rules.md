---
id: 71
slug: log-row-anatomy-and-interaction-rules
title: /log row anatomy and interaction rules
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: [68]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-06T18:52:30Z
---

## Description

The physical half of `/log`. `06-ui-ux.md` §6.4 and §9.2–9.3 specify a row that works
**without care or precision**.

**Row anatomy**, all sourced from the registry:

| Element | Behaviour |
|---|---|
| Sigil + skill name + unit label | The unit label is the **plain-English** one (`pushups`, `plank`, `treadmill / track`) — "reps" and "seconds" are schema words |
| The number | Pre-filled with **your last logged value for this type** — not a goal, not an average, not a target. Click/focus → numeric input, select-all on focus |
| `−` / `+` | Registry-defined step: pushups ±5, situps ±5, plank ±15s, distance ±0.5 km. Holding the button repeats at 4/s. Clamped at the registry's `minUnitsForCredit` |
| `LOG` | Commits that row immediately. ~~56 × 96dp, hard against the right edge~~ *(D-251, 0215)* |

~~**Reach and target rules (non-negotiable):** 56dp minimum touch target with 8dp minimum spacing;
touch slop raised to **16dp** so a finger sliding on a damp screen still registers as a tap and
not a flick; every frequent target inside the right-thumb arc (`y > 520dp` on a 412 × 915dp
viewport) or up the right edge.~~ *(D-251, 0215 — phone reach rules; `/log` is a desktop-browser
feature.)*

**No gesture is the only path to anything.** **No swipe-to-delete, no drag-to-reorder, no
drag-and-drop** — ~~they fail hardest with a wet thumb and~~ they always destroy something when
they misfire. ~~**A second touch point during a tap is treated as a pan, not a tap**, so water
bridging two contacts cannot log a workout.~~ *(D-251, 0215)*

**Undo, 8 seconds, in-row.** This is the one place the app permits a destructive action, and it
gets **undo, not a confirmation dialog** — a confirm dialog taxes every log to guard against a rare
mis-click; undo handles it afterwards. After a click the row becomes its confirmation in place: `MIGHT 30
pushups · Might +120 → L31 · ⟲ Undo 7s`, gold, with a 6dp bar wipe on the skill bar that then
settles.

~~**Left-handed mirroring** is one flexbox direction and one flag in `/settings`; it flips the
`LOG` column to the left edge. Set once, never touched again.~~ *(D-251, 0215 — a thumb-reach
rule.)*

## Acceptance criteria

- [x] ~~Every interactive target on the row is ≥ 56dp with ≥ 8dp spacing; `LOG` is 56 × 96dp and
      flush to the right edge.~~ **Withdrawn by D-251 (0215) — tick when closing; nothing to build.**
- [x] ~~Touch slop for taps is 16dp, verified by a test that dispatches a pointer-down and
      pointer-up 12dp apart and asserts a tap fired.~~ **Withdrawn by D-251 (0215) — tick when closing; nothing to build.**
- [x] ~~All of `−`, the number, `+` and `LOG` fall at `y > 520dp` on a 412 × 915dp viewport for
      the first row, and the page scrolls so any row can be brought into that band.~~ **Withdrawn by D-251 (0215) — tick when closing; nothing to build.**
- [x] The value is pre-filled from **the last logged value for that type**, per type, persisted
      locally; a fresh install falls back to the registry's default.
- [x] `−`/`+` use the ~~registry's~~ step *(from the exercise's `entry` kind — D-282)*, holding repeats at 4/s, and the value clamps at
      `minUnitsForCredit` (never below).
- [x] Clicking the number focuses a numeric input with the value selected; committing the input
      does not log.
- [x] ~~A second simultaneous touch point during a tap is treated as a pan and logs nothing.~~ **Withdrawn by D-251 (0215) — tick when closing; nothing to build.**
- [x] There is no swipe-to-delete, no drag-to-reorder and no drag-and-drop anywhere on the page.
- [x] `LOG` produces the in-row confirmation with an 8-second `⟲ Undo`, counting down visibly;
      undo removes the entry locally and cancels or compensates the queued write.
- [x] There is **no confirmation dialog** on this page, for any action.
- [x] The unit label rendered is the registry's plain-English label, never `reps` or `seconds`.
- [x] ~~A left-handed flag in `/settings` mirrors the `LOG` column; no other layout changes.~~ **Withdrawn by D-251 (0215) — tick when closing; nothing to build.**
- [x] Every control has an accessible name and the row is operable by screen reader without
      relying on position.

## Notes

The 8-second undo window is the reason no confirmation exists. Do not add "are you sure" to any
control on this page, including under review pressure — the design assumes the mis-click and
handles it afterwards, which is the only strategy that keeps logging one click.

The pre-fill being *last value* rather than *average* or *target* is deliberate: an average is a
statistic and a target is an instruction, and this app gives neither (D-013, N4).

## Resolution

**Built in the same session as `0068` and committed with it (`008d3f8`).** The row and the page
share one module set, so splitting the code across two commits would have committed a `/log`
with no row. This ticket records the row's half. D-282 settles the step, and D-251 withdrew the
phone criteria, which are ticked with nothing built.

**Where each criterion lives**
- **Last value, per type, persisted locally.**
  - Written to IndexedDB `kv` under `last:<uid>:<exerciseId>` at the click, before the
    confirmation shows (`app/log/log-page.tsx` `onLog`).
  - A fresh install falls back to `row.fallback`, the exercise's first `quickValue` (D-282).
  - **An undone log restores the previous value.** It was never logged, so it is not "your last
    logged value".
- **Step, repeat and clamp.**
  - `STEP_BY_ENTRY` gives count ±5 and seconds ±15. `stepValue` and `clampValue` floor at
    `minUnitsForCredit` (`lib/log/rows.ts`).
  - `holdToRepeat` (`lib/log/repeat.ts`) steps on press, then at 4/s after 400 ms. A pointer
    press goes through the repeater; a keyboard click (`detail === 0`) steps exactly once.
  - `−` is disabled at the floor.
  - The repeaters depend on `row` only, so a hold is not rebuilt (and stopped) on every step.
- **The number.** It is always a `type="text" inputMode="numeric"` input, and focus selects all
  of it.
  - Enter or blur commits the typed value, clamped. Enter does **not** log, and Escape abandons
    the edit.
  - A plank takes `1:30` or `90`.
  - A typed value still uncommitted when LOG is pressed is the value logged.
- **Confirmation and undo.** The row is replaced in place by `MIGHT 30 pushups / Might +120 → L31
  / ⟲ Undo 7s` in `--accent-text`, with a 6px bar wiping to the level progress.
  `prefers-reduced-motion` removes the wipe's motion.
  - The countdown ticks every 250 ms.
  - Undo calls `undoLog`, which deletes the held entry **before it can flush** (D-282, D-135).
    It also takes the award back off the page's pending standing.
  - After 8 s the row settles back to its controls, keeping the logged value.
  - Focus moves to Undo on LOG, and back to LOG when the row settles, so a keyboard never falls
    off the row.
- **No dialog, no swipe, no drag.** `log-page.test.tsx` greps `app/log/` for `confirm(`,
  `<dialog`, `role="dialog"`, `onDrag`, `draggable`, `onSwipe` and `onTouchMove`, and checks the
  rendered markup as well.
- **Plain-English label.** `row.label` is the exercise's `label`, lowercased (`pushups`,
  `situps`, `plank`). `rows.test.ts` refuses `rep(s)` and `second(s)`.
- **Accessible names.**
  - Each row is `role="group"` named `Might: pushups`.
  - The controls are named `Decrease pushups by 5`, `pushups, count`, `Increase pushups by 5`,
    `Log 30 pushups` and `Undo 30 pushups, 7 seconds left`.
  - The confirmation line is `aria-live="polite"`.
  - No name depends on position.

**Not here.** Sigils are `0072`'s icon set. The long-press sets editor is deferred (`06` §6.6),
and no long-press action exists on the row.

## Operator validation

*Planned at ticket-write:* On **`/log`** in the desktop browser: log 40 pushups with the mouse, and again with the keyboard
alone. Deliberately mis-click once and use `⟲ Undo` before it expires. Confirm there is no
confirmation dialog anywhere.

**Pending: the operator's look at `/log` in the desktop browser.** This is the one check the
suite cannot make (D-229): whether the row reads at a glance, and whether the flow takes under
three seconds without hunting. Undo inside the 8 seconds writes nothing, so the check costs no
XP unless the operator lets a log stand.

**Automated (agent, 2026-10-06):** see `0068`'s validation. The suite (148 files, 2,685 tests),
typecheck, lint, `next build` (`○ /log`) and the deployed-stack smoke all ran over this code.
