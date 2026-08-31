---
id: 84
slug: skip-interruption-failure-and-the-seen-flag
title: Skip, interruption, reduced motion, WebGL loss, backfill, and the per-device seen flag
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [78, 80, 81, 82, 83]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Every way out of the sequence. `06-ui-ux.md` §3.4.

**Skip.** Tap anywhere → jump to the end state, **instantly, no fade**. Not "next beat". **One tap
always ends it.** This is the rule that makes an eight-second animation acceptable to ship at all:
the user is never trapped and never has to tap four times to escape.

**Back.** Back during the sequence → end state. A second back → `/`.

**`prefers-reduced-motion`** (`05-fog-of-war.md` §4.5): no lantern traversal, no counting numbers,
no card overshoot. The reveal becomes a single 400 ms cross-fade from pre-run to post-run territory;
the ledger fades in complete; level-up cards appear and hold without scaling. Everything is still
**sequenced** — you still see the map before the numbers. Only the motion is removed, never the
order and never the content.

**Failure mid-sequence.** WebGL context loss genuinely happens on phones under memory pressure.
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

- [ ] A tap at t=0.2, 1.5, 3.0, 4.5, 6.5 and 8.0 s each lands on the **end state** — never on the
      next beat, never on `/`. Six cases, six assertions.
- [ ] A tap during a level-up card also lands on the end state, dismissing the whole queue.
- [ ] Skip has no fade: the frame after the tap is the end state.
- [ ] Back during the sequence → end state; a second back → `/`.
- [ ] With `prefers-reduced-motion: reduce`, the reveal is a single 400 ms cross-fade, numbers do
      not count, cards do not overshoot, and the map still appears before the ledger.
- [ ] Reduced motion changes no content: the same rows, lines and cards are present as in the full
      sequence, asserted by comparing rendered text between the two modes.
- [ ] A forced WebGL context loss mid-sequence (via `WEBGL_lose_context`) aborts to the end state
      with a static map; the ledger, chronicle line and frontier line are all still correct.
- [ ] A backfill import of ≥50 activities produces exactly **one** sequence, a 4 s aggregate reveal,
      a lifetime-totals ledger, and one Total Level card — not one sequence per activity.
- [ ] After backfill, every backfilled activity is `seen` and the plinth shows no new-run line.
- [ ] `seen` is written on both completion and skip; a test asserts skipping marks it.
- [ ] `seen` lives only on the device: clearing IndexedDB restores the replay offer and changes no
      XP, no ledger row and no `SkillState` value.

## Notes

Depends on every beat ticket (0080–0083) because it must be able to interrupt each of them, and on
0078 for the end state it lands on.

Implement skip as **one** listener that tears down the sequence clock and mounts the end state, not
as per-beat skip handling. Per-beat handling is how "tap goes to the next beat" bugs get born, and
that behaviour is explicitly forbidden.

The backfill aggregate is the highest-consequence path here and the one least likely to be exercised
in development, because it happens exactly once per account. Test it against a fixture of 300
activities before the first real connect, not after.

## Operator validation

On the Android phone, with a real imported run: play the sequence and tap at a different moment each
time — during the camera fly, during the lantern, mid-count, mid-card. Every single time you must
land on the end state with the correct final numbers. Count the taps needed to escape: it must always
be one.

Turn on **Remove animations** in Android accessibility settings and replay. You should still see the
map first, then the numbers, and you should still know what happened — just without motion. If the
reduced-motion version tells you *less*, it is wrong.

Then the real test: on a fresh install signed in to Strava for the first time, watch the backfill. It
must be one four-second reveal of your whole history and one card, not a queue. If it queues, kill
the app — and then confirm nothing was double-scored when you reopen it.
