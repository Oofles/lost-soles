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
started: 2026-10-15T15:50:47Z
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

- [x] On a touch device at < 1024px, a downward drag on the skill sheet that starts at its top
      (the sheet scrolled to 0) dismisses it through the same path as every other dismissal
      (`router.back()` from the panel, `router.replace("/skills")` after a deep link).
- [x] A downward drag while the sheet's content is scrolled scrolls the content and does not
      dismiss.
- [x] A short or mostly-horizontal drag does not dismiss.
- [x] Every existing dismissal path (Esc, scrim, Close, back) still works; at ≥ 1024px, where the
      sheet is a centred dialog, nothing changes.
- [x] One gesture implementation, shared by every sheet — `/chronicle` and ticket capture take it
      when they are built, rather than each growing their own.

## Notes

- `app/skills/skill-sheet.tsx` owns the sheet today; the gesture likely belongs in a small shared
  hook so §1.5's other sheets reuse it.
- Pointer events, not a gesture library: one vertical threshold, no inertia physics.

## Operator validation

None from the operator by default: the gesture is behaviour a test can drive with synthetic
pointer events, and the phone is not a validation surface (D-227). If the operator happens to try
it on the phone, that is a bonus, not a gate.

**Done 2026-10-15 (agent, desktop machine, headless Chromium).** The agent drove real CDP touch events
at 400×800 mobile emulation. A long downward swipe at the top dismissed the sheet. A short swipe, a
horizontal swipe, and a downward swipe from `scrollTop` 500 (the content scrolled to 267) did not.
At 1280px nothing happened. A pointer-only control fired `pointercancel` and never dismissed, which is
the evidence for D-314. `lib/sheet/swipe-dismiss.test.ts` holds 12 tests. Gate on `main` at `c0ca988`
was green (3445 passed). Amplify job 400: SUCCEED. The page is auth-gated
(`/skills/wayfaring` → 307 to sign-in), so the shipped chunk was not fetched; the deployed build is
the commit that carries the module.

## Resolution

**Files touched**

- `lib/sheet/swipe-dismiss.ts` — new. The one gesture every §1.5 sheet takes: `isDismissSwipe`
  (the pure rule), `attachSwipeDismiss(el, onDismiss, env)` (the listeners; returns the
  uninstaller) and `useSwipeDismiss(ref, onDismiss)` (the hook a sheet calls).
- `lib/sheet/swipe-dismiss.test.ts` — new, 12 tests driving synthetic pointer and touch events
  against a fake sheet (Node's `EventTarget`; the repo has no jsdom).
- `app/skills/skill-sheet.tsx` — calls `useSwipeDismiss(dialog, onDismiss)`, adds
  `overscroll-behavior: contain` to the sheet, and the header comment now lists the fourth path.

**How it works.** The gesture arms at `pointerdown` only when all three hold: the pointer is a
finger (`pointerType === "touch"`), the viewport is < 1024px (`matchMedia("(min-width: 1024px)")`
does not match — the same breakpoint as the sheet's own CSS), and the sheet is at `scrollTop` 0.
The first move past 3px picks a direction: down (and at least as vertical as horizontal) claims
the drag; up or sideways releases it to the browser. While claimed the sheet follows the finger
(`translateY`); on release it dismisses when `dy >= 96px` and `dy > 2·|dx|` (within ~27° of
straight down), otherwise springs back over 160ms. One threshold, no velocity, no inertia. A
dismissal calls the sheet's own `onDismiss` — the same path as Esc, scrim and Close, so the route
still decides between `router.back()` and `router.replace("/skills")`. Nothing else changed:
Esc, scrim, Close and back are untouched, and at ≥ 1024px the gesture never arms.

**Decisions made**

- **A non-passive `touchmove` listener alongside the pointer events.** The ticket says pointer
  events, and the gesture *is* pointer events — but with `touch-action: auto` Chromium claims any
  vertical drag on a scrollable element as a pan and fires `pointercancel` a few pixels in, even
  at `scrollTop` 0 where there is nothing to scroll. A pointer-only gesture therefore never sees
  the drag. The headless-Chromium probe below shows it: a pointer-only control dismissed 0 of 2
  long downward swipes and logged a `pointercancel` on each. The one `touchmove` listener calls
  `preventDefault` only for a drag the gesture has claimed (armed, first move downward), so the
  browser keeps every other drag, including all scrolling. The alternative — `touch-action: none`
  on the sheet — would kill content scrolling; `pan-down`/`pan-up` direction semantics are not
  reliable enough across engines to bet a gesture on.
- **Touch only.** A mouse drag on the desktop is not a sheet gesture; the desktop has Esc, the
  scrim and Close.
- **`overscroll-behavior: contain`** on the sheet so a pull at its top is never the page's
  pull-to-refresh.
- **Shared location `lib/sheet/`**, not inside `app/skills/`, so `/chronicle` and ticket capture
  import it when built (acceptance criterion 5). `06-ui-ux.md` §1.5 already says sheets dismiss on
  swipe-down; the code now matches it, so no doc change.

**Verification**

- `npx vitest run lib/sheet` — 12 tests: long downward drag from the top dismisses exactly once
  and cancels the browser pan; the sheet follows the finger and springs back on a short release;
  a drag while scrolled neither dismisses nor cancels the pan; short, mostly-horizontal and
  down-then-sideways drags do not dismiss; an upward-first drag is left to the browser even when
  it comes back down; `pointercancel` never dismisses; ≥ 1024px never arms; a mouse drag never
  arms; detaching removes every listener.
- **Headless Chromium probe (agent, 2026-10-15, WSL, `/snap/bin/chromium`)** — the transpiled
  module on a 400×800 mobile-emulated page with a scrollable bottom sheet, real CDP
  `Input.dispatchTouchEvent` swipes: long down at top → dismissed, no `pointercancel`; short down
  at top → not dismissed; horizontal → not dismissed; down from `scrollTop` 500 → content scrolled
  to 267, not dismissed; at 1280×800 desktop → not dismissed. Control (pointer-only, no
  `touchmove` claim): long down at top → **not** dismissed, `pointercancel` fired — the reason for
  the listener. Probe files were in the scratchpad and the worktree's `tmp/`, removed before
  commit.
