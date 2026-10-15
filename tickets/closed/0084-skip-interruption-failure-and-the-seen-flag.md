---
id: 84
slug: skip-interruption-failure-and-the-seen-flag
title: Skip, interruption, reduced motion, WebGL loss, backfill, and the per-device seen flag
type: feature
priority: high
status: closed
size: m
capability: 12-post-run-moment
depends_on: [78, 80, 81, 82, 83]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-13T22:36:39Z
closed: 2026-10-14T03:07:51Z
---

## Description

Every way out of the sequence. `06-ui-ux.md` §3.4.

**Skip.** Click anywhere (or press Esc) → jump to the end state, **instantly, no fade**. Not "next
beat". **One click or key always ends it.** This is the rule that makes an eight-second animation
acceptable to ship at all: the user is never trapped and never has to click four times to escape.

**Back.** Back during the sequence → end state. A second back → `/`.

**`prefers-reduced-motion`** (`05-fog-of-war.md` §4.5): no lantern traversal, no counting numbers,
no card overshoot. The reveal becomes a single 400 ms cross-fade from pre-run to post-run territory;
the ledger fades in complete; level-up cards appear and hold without scaling. Everything is still
**sequenced** — you still see the map before the numbers. Only the motion is removed, never the
order and never the content.

**Failure mid-sequence.** WebGL context loss genuinely happens (GPU resets, driver updates, memory pressure).
Abort to the end state with a static map image. The ledger is plain DOM and always survives.
**The numbers must never depend on the graphics.**

**Backfill.** The first Strava import fetches years of history. Do **not** queue 300 sequences.
Backfill produces **one** aggregate reveal: the whole archive burns back at once over 4 s, with a
ledger showing lifetime totals and starting levels, and a single card: `Total Level 214`. Individual
runs become rows in the Chronicle with `seen` already set.

**The `seen` flag.** A run is marked `seen` the first time the sequence completes **or is skipped**.
It is a **local, per-device** flag and it **never affects scoring** — D-135's spirit: display state
is not truth. Store it client-side (IndexedDB alongside `explored-r10.bin`); clearing app data loses
`seen` and that is acceptable, because losing it costs an offer to replay, not data.

## Acceptance criteria

- [x] A click or Esc at t=0.2, 1.5, 3.0, 4.5, 6.5 and 8.0 s each lands on the **end state** — never on the
      next beat, never on `/`. Six cases, six assertions.
      — `exit.test.ts` (12 cases); smoke: 12/12 with trusted CDP clicks and keys, job 366.
- [x] A click or Esc during a level-up card also lands on the end state, dismissing the whole queue.
      — smoke: click on the card's scrim → end state; no card or panel 2 s later.
- [x] Skip has no fade: the frame after the click or Esc is the end state.
      — smoke: the end state was in place on the 1st animation frame after the event in all 12 cases.
- [x] Back during the sequence → end state; a second back → `/`.
      — smoke, and after a click skip one Back → `/` (the sentinel is consumed).
- [x] With `prefers-reduced-motion: reduce`, the reveal is a single 400 ms cross-fade, numbers do
      not count, cards do not overshoot, and the map still appears before the ledger.
      — `reduced-motion.test.tsx`; smoke: lantern opacity 0 on 631 frames, final numbers on all 499
      panel frames, card transform `none` on 170 frames, beat 2 at 2,900 ms in both modes.
- [x] Reduced motion changes no content: the same rows, lines and cards are present as in the full
      sequence, asserted by comparing rendered text between the two modes.
      — test (settled tally, three card kinds) and smoke (panel `innerText` at beat 5, and the card
      list `skill:7, skill:5`, identical in both modes).
- [x] A forced WebGL context loss mid-sequence (via `WEBGL_lose_context`) aborts to the end state
      with a static map; the ledger, chronicle line and frontier line are all still correct.
      — smoke at t = 1.5 s: end state, route still drawn, all three texts equal the reference load;
      `restoreContext()` brought the live map back and removed the still. No console errors.
- [x] ~~A backfill import of ≥50 activities produces exactly **one** sequence, a 4 s aggregate reveal,
      a lifetime-totals ledger, and one Total Level card — not one sequence per activity.~~
      **Moved to `0257`** (2026-10-13, operator, D-298): there is no backfill import to reveal until
      `0177` builds one, and its paced, hours-long import changes when the reveal should play.
- [x] ~~After backfill, every backfilled activity is `seen` and the plinth shows no new-run line.~~
      **Moved to `0257`** with the reveal it depends on (D-298). The plinth is capability 13's; this
      ticket ships `isSeen()` (`lib/run-moment/seen.ts`) as the hook it will read.
- [x] `seen` is written on both completion and skip; a test asserts skipping marks it.
      — `exit.test.ts` (click, Esc, Back, complete each call `onExit` once); smoke read it from IndexedDB.
- [x] `seen` lives only on the device: clearing IndexedDB restores the replay offer and changes no
      XP, no ledger row and no `SkillState` value.
      — `seen.test.ts` (delete → unseen; only `RunMoment` imports it); smoke: deleted the database →
      unseen, and the uid's ledger + SkillState digest was identical before and after the drives.

## Notes

Depends on every beat ticket (0080–0083) because it must be able to interrupt each of them, and on
0078 for the end state it lands on.

Implement skip as **one** listener that tears down the sequence clock and mounts the end state, not
as per-beat skip handling. Per-beat handling is how "click goes to the next beat" bugs get born, and
that behaviour is explicitly forbidden.

The backfill aggregate is the highest-consequence path here and the one least likely to be exercised
in development, because it happens exactly once per account. Test it against a fixture of 300
activities before the first real connect, not after.

## Resolution

**What was built:** three commits. `154b7dc` is the work. `a32485f` and `47328b4` are fixes found by
the smoke.

The operator made three calls up front (2026-10-13), recorded as **D-298**:
1. **Split backfill out** into `0257` (capability 14, after `0177`). Reasons: there is no import to
   reveal yet, and an hours-long paced import changes *when* the reveal should play.
2. **Sequence controls keep their meaning.** §3.2's "tap a row" (built in `0081`, where it pauses
   the sequence) contradicts §3.4's "tap anywhere". A click inside `[data-sequence-control]` (a row
   expander or the frontier line) does not skip. Esc always does. §3.4 is amended.
3. **The "static map image" is the route drawn as SVG from its geometry.** It is not a canvas
   snapshot.

**The exit** (`lib/run-moment/exit.ts`):
- One set of listeners, wired once per play by `RunMoment`. No beat knows it can be skipped. A
  grep test holds that no beat, ledger, lines or card file listens for a click, key or popstate.
- Click is caught in the capture phase and swallowed, so the header's `←` skips instead of leaving.
  Esc also skips.
- **Back** works through a sentinel history entry pushed at the start. It carries the run entry's
  Next router state and is pushed with the unpatched `pushState` (`lib/runs/history.ts` explains
  why).
- Every other exit calls `history.back()` to take the sentinel off, so one Back from the end state is
  `/`. The smoke checked this.
- The effect is declared after `seedHomeBehind`'s, so the seed is underneath the sentinel. A
  test checks the order.
- Every exit dispatches `done` and marks `seen`. The beats' own `onDone` goes through `complete()`.

**Reduced motion** is read once per play (`useMemo` on `play`; nothing it changes is in SSR markup).
- **Beat 1:** no flight, lantern, bloom or ink traversal (the whole line is drawn at once). The
  reveal is a cross-fade through the existing seam, with every reveal cell given arc 0.
- **Beat 2:** the panel fades in over 300 ms instead of rising, with final numbers, and the pull-back
  happens with duration 0.
- **Cards:** `cardReducedAt` (scale 1, border already drawn, no rise). `LevelUpQueue` and
  `LevelUpCard` take `reduced`, which also drops the flight.
- **Timing is unchanged.** Beat 1 keeps its 2.9 s (fade, then hold), so the map is seen before the
  numbers for as long as in full motion. §3.4 left this open; I chose it, and it is in D-298.

**WebGL loss:**
- `MapStage` gained `lost` (set on `webglcontextlost`, cleared on restore).
- `RunMoment` aborts to the end state and shows `RouteStill` over the map box until the rebuilt map
  reports `ready`. The still is the route in the route tokens on `--bg`, plus one sentence:
  "The map's graphics reset. Everything below is complete."

**`seen`** (`lib/run-moment/seen.ts`):
- An IndexedDB database of its own, `lost-soles-seen`, keyed by activity id. It is not a store
  inside `lost-soles-fog`, because adding one would need a version bump that another open tab blocks.
- `markSeen` and `isSeen` swallow failures. `isSeen` is the hook for capability 13's plinth. Nothing
  reads it today, and autoplay still depends only on the entry's intent (`0078`).

**What went wrong:**
1. **The fog layer threw on a lost context.** `prerender` called `getParameter(VIEWPORT)`, which
   returns `null` when the context is lost, so `Array.from(null)` threw. This is a pre-0084 gap
   (the 0055-era layer) that only a real loss reaches. Both hooks now return on
   `gl.isContextLost()`, with a fake-GL test (`a32485f`). It is within this ticket because
   criterion 7's abort was throwing on every frame.
2. **The first cross-fade was a snap.** Ramping the weight from 0 to 1 showed as ~170 ms in the
   middle of the 400. Fog clears only as coverage crosses `smoothstep(REVEAL_LO, REVEAL_HI)`
   plus or minus noise. The ramp now spans that band, and the test asserts what is visible, not
   the weight (`47328b4`).
3. **Two smoke cases failed on the first run.** Both were the t = 0.2 s skips. The ledger read was
   still in flight, and the end state filled it about 230 ms later. That is correct behaviour; the
   driver now waits for the ledger and reports how long it took.
4. **The local full suite has one red test,** `adapter.test.ts`'s polyline grep. It matches
   gitignored `tmp/008x/seed.ts` smoke seeds from earlier tickets, not tracked code. CI (`gate`)
   was green on all three commits.

**Filed:**
- `0257`: the backfill aggregate reveal (capability 14).
- `0258`: `/log`'s level-up cards honour reduced motion. That is the same component, but left out
  so as not to widen this ticket.

**Tests added:**
- `lib/run-moment/exit.test.ts`: 41 tests.
- `seen.test.ts`, `reduced-motion.test.tsx` and `route-still.test.ts`.
- One lost-context test in `mask-layer.test.ts`.

## Operator validation

**Agent smoke, deployed site (Amplify job 366, `47328b4`), 2026-10-13** (`tmp/0084/{seed.ts,drive.mjs,scored.ts,cleanup.ts}`).

**Setup.** A throwaway Cognito user and three synthetic Point Nemo runs, processed by the
production `processActivity` (the same seed as 0083). Run B is 3 km over familiar ground and
plays two level-up cards. Run C is 2 km, 113 of its 118 cells new. Headless Chromium at 1280×900,
with trusted input through CDP `Input.dispatchMouseEvent` and `dispatchKeyEvent`.

**34/34 checks passed.**
- **Click and Esc at 0.2, 1.5, 3.0, 4.5, 6.5 and 8.0 s** each landed on the end state:
  - still on `/run/:id`, with no panel or card left;
  - ledger and chronicle text equal to a reference load;
  - end state on the 1st animation frame every time.
- **Click during a card:** end state, and the queue was gone.
- **D-298:** a real click on a tally row expanded it and the sequence kept going. Esc then ended it.
- **Back:** during the sequence it went to the end state; the next Back went to `/`. After a click
  skip, one Back went to `/`.
- **Reduced motion (emulated):**
  - beat 2 began at 2,900 ms, the same as full motion;
  - lantern opacity was 0 on every frame;
  - every panel frame showed `+150|+50` (full motion starts at `+0|+0`);
  - the panel only changed opacity;
  - the card transform was `none`;
  - panel text and the card list were identical to full motion.
- **WebGL lost** via `WEBGL_lose_context` at 1.5 s: end state, route still drawn; ledger,
  chronicle and frontier equal to the reference. `restoreContext()` brought the live map back.
  No console errors after the `a32485f` fix.
- **`seen`:** B was marked after skipping and C (never played) was not. Deleting the database made
  B unseen. The uid's XpLedgerEntry and SkillState digest was `76f3ff293c176d0e` (9 + 3 rows)
  before and after all three drives.

**Screenshots** (`tmp/0084/shots/`):
- `skip-1500-click-end`
- `card-before-click`
- `reduced-C-{50…2000}ms`: the cross-fade, frame by frame, and visibly a fade, not a snap
- `webgl-lost-still`
- `webgl-restored`

**Cleanup.** Removed 3 activity, 9 ledger, 3 skill-state, 1 profile, 3 receipt and 302
explored-cell rows; 27 S3 object versions; the archive bucket; and the Cognito user.

**For the operator** (perceptual, desktop browser, one of your own runs, via ⟲ Relive):
1. Click at a few different moments: during the camera, the lantern, the count and a card. Does it
   always feel like *one* click out, with nothing flashing on the way?
2. Turn on DevTools → Rendering → emulate `prefers-reduced-motion: reduce` and Relive. Do you still
   see the map first, then the numbers, and still know what happened? If it tells you *less*, it is
   wrong.
3. The WebGL-lost still (`tmp/0084/shots/webgl-lost-still.jpg`): is a route drawing plus that
   sentence the right thing to see when the map's graphics fail, or would you rather see something
   else there?

**As filed** (kept for the record; the backfill paragraph now belongs to `0257`):

> In the desktop browser, with a real imported run: play the sequence and click at a different moment
> each time — during the camera fly, during the lantern, mid-count, mid-card. Every single time you must
> land on the end state with the correct final numbers. Count the clicks needed to escape: it must always
> be one.
>
> Turn on the OS reduce-motion setting (or DevTools → Rendering → emulate `prefers-reduced-motion`)
> and replay. You should still see the
> map first, then the numbers, and you should still know what happened — just without motion. If the
> reduced-motion version tells you *less*, it is wrong.
>
> Then the real test: in a fresh browser profile signed in to Strava for the first time, watch the backfill. It
> must be one four-second reveal of your whole history and one card, not a queue. If it queues, close
> the tab — and then confirm nothing was double-scored when you reopen it.

**Operator, desktop browser — verified 2026-10-15 (at the `12` audit): all perceptual checks above good.**
