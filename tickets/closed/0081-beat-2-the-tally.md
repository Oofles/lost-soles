---
id: 81
slug: beat-2-the-tally
title: Beat 2 — the parchment tally (2.9 to 6.0 s), staggered count-ups, and never a zero
type: feature
priority: high
status: closed
size: m
capability: 12-post-run-moment
depends_on: [78, 62, 65]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-13T17:41:00Z
closed: 2026-10-13T18:32:41Z
---

## Description

The ledger. `06-ui-ux.md` §3.2, beat 2.

The camera pulls back **1.5 zoom levels** (so newly-lit territory sits in context rather than
filling the frame) and a parchment ledger rises over the bottom ~55% of the screen with a 300 ms
`easeOutQuint`. The map stays visible above it. **It is never a full-screen takeover** — the ledger
is a thing laid *on* the map, in keeping with the fiction that the map is the artifact.

```
│  RETURN FROM THE FOG        Thu 28 Aug · 8.4km│
│  Wayfaring    +576   ▓▓▓▓▓▓▓░░░  L47  8,003 →48│
│  Cartography  +375   ▓▓▓▓▓░░░░░  L41  4,572 →42│
│  Constitution +192   ▓░░░░░░░░░  L41↑ 6,645 →42│
│  ────────────────────────────────────────────│
│  21 cells claimed · 8 remembered             │
│  3.18 km never run before                    │
│  Total XP  1,884,120 → 1,885,263   (+1,143)  │
│  Total Level  271                            │
```

- Rows appear **staggered 240 ms apart**, top to bottom, each sliding up 8dp with a 180 ms fade.
- `+576` **counts** from 0 over 700 ms with `easeOutExpo` — fast at the start, visibly decelerating
  into the final digit. **Tabular numerals**, so nothing reflows while counting.
- The XP bar fills in the same 700 ms window. If the fill crosses 100% it does **not** wrap: it
  fills to full, holds, and hands off to beat 3 (0082).
- `L41 ↑` marks a level gained. The arrow is `--gold-500` and is the only colour in the row.
- **Clicking a row expands it to the reason breakdown**: `318 new ground · 62 remembered · 196
  familiar`. This falls out of the `XpLedger` (0062) for free and it is what makes the numbers feel
  *accountable* rather than dispensed. **Expansion pauses the sequence.**
- `"3.18 km never run before"` gets its own line, phrased in **distance, not cells**. Cells are the
  mechanic; kilometres of new road is the feeling (D-012).
- Total XP is shown as an explicit `old → new` transition — it is one of only two numbers guaranteed
  non-zero every session, so it is the tally's floor.

**Two rules from §3.5 belong here, not in the fallback ticket, because they are tally rules:**

1. **Never render a zero.** A skill that earned nothing is **omitted**, not shown at 0. An absent
   row is neutral; a zero is an accusation. (The click-breakdown still shows the full truth.)
2. **Row order is sorted by XP gained, descending** — not a fixed skill order. On a quiet run
   Wayfaring leads and Constitution follows, and the guaranteed-non-zero lines carry the bottom.

There is no `(halved)` annotation, no strikethrough, no "you could have earned 510". The app does
not hide the D-021 discount and it never labels it as a penalty. The number is the number.

## Acceptance criteria

- [x] Beat 2 spans 2.9 s → 6.0 s ± 0.1 s in the desktop browser.
- [x] The map remains visible above the ledger at all times; the ledger never covers more than ~55%
      of the viewport height.
- [x] Rows stagger at 240 ms; each count-up runs 700 ms with `easeOutExpo` and ends on the exact
      ledger value (no off-by-one from easing).
- [x] Numerals are tabular: a screenshot at t=3.4 s and one at t=3.9 s have identical text metrics —
      nothing reflows mid-count.
- [x] A bar whose fill crosses 100% fills to full and holds; it never wraps to a second bar.
- [x] A skill with zero XP this activity does **not** appear as a row. A test with
      `Cartography = 0` asserts no Cartography row is rendered anywhere in the DOM.
- [x] Rows are ordered by XP descending; a test with Constitution > Wayfaring puts Constitution
      first.
- [x] Clicking a row expands the reason breakdown sourced from `XpLedgerEntry` rows, and the
      sequence clock pauses while expanded and resumes on collapse.
- [x] `displayedXp` in the tally equals `SUM(ledger)` for the activity — asserted, not eyeballed.
- [x] Total XP renders as `old → new (+delta)` and Total Level renders the D-145 value.

## Notes

**2026-09-28 — handed over from `0061`.** `0061`'s perceptual check could not run because this beat
did not exist yet. When it does: a run over ground covered this month must show Wayfaring as a
**half-XP** line attributed to explored ground (`recent_ground`), with no Cartography row. A run over
ground last covered more than six months ago must show half Wayfaring XP (`rearmed_ground`) *and* a
Cartography row at half credit. The archived 2026-09-27 run is the ready-made rearmed + recent case,
and 2026-09-07 is all-recent.

Depends on 0062 (`XpLedgerEntry`, the source of both the totals and the breakdown) and 0065 (Total
Level / Total XP). It reads; it never scores.

`06-ui-ux.md` §8.4 governs type and D-148 governs gold: gold is a fill and a rule, never body text,
and the `↑` arrow qualifies as a rule-weight mark, not type. Check the level arrow against D-148
before shipping.

The breakdown-on-click is cheap and disproportionately valuable — it is the difference between a
number the app dispensed and a number the app can account for. Do not defer it.

## Operator validation

**Use the next ordinary run, or an imported/replayed or synthetic activity (manual adapter or through the queue, D-229).** In the desktop browser: watch the tally.
Can you read every row as it lands? Is the count-up fast
enough to feel eager and slow enough that you can read the final number, or does it feel like a slot
machine? Click a row mid-count and confirm the sequence pauses rather than racing on underneath the
expansion. Then log a strength session (`/log`) with no run at all and open its `/run/:id`: there
must be no Wayfaring row and no Cartography row, and nothing on screen should read as an absence.
Finally, replay (or wait for the next ordinary run of) a loop you have run ten times and check that no row anywhere says `0`.

## Resolution

**What was built:** `d0db52b`, plus three fixes found by the smoke (`742d435`, `8840b92`, `72d3a39`).

- **Numbers.** `lib/run-moment/tally.ts` is pure. It turns three inputs into everything the tally shows:
  - the run's `XpLedgerEntry` rows;
  - each skill's XP **before** the run;
  - the ruleset.

  It produces the lines (XP descending, zeros omitted, each with its reason parts), the bar's
  from/to, `L↑`, XP to next, the new-road km, Total XP `old → new`, and Total Level (D-145).
  `lib/runs/ledger.ts` gained `scoredRows`, so the end state's per-skill fold and the tally pick rows
  the same way.
- **"Before", as of the run.** This was the operator's choice (A); it is recorded as D-296.
  - `lib/runs/tally-server.ts` (`xpBeforeRun`) sums T4 `byUserAndSeq` rows with
    `seq < <startedAt>#<activityId>#00`, plus every `retained_floor` row.
  - It runs on the SSR compute in `page.tsx` and reaches `RunMoment` as the `xpBefore` prop.
  - `amplify/backend.ts` adds a `custom.xpLedgerTableName` output and one statement,
    `dynamodb:Query` on that **one index ARN**.
  - A failed read yields `null`. The rows still show what the run earned; only the bars and totals go.
- **Clock.** `lib/run-moment/beat2.ts`:
  - The parchment rises over 300 ms with `easeOutQuint`.
  - Lines stagger 240 ms apart, each with a 180 ms fade and an 8 px slide.
  - Counts run 700 ms on `easeOutExpo`, **rescaled so f(1) = 1 exactly**. The textbook curve ends at
    0.999, which is the off-by-one in criterion 3.
  - The beat lasts 3.1 s.
  - `PausableClock` removes the time spent paused.
  - If a long tally would overrun 6.0 s, the stagger closes up. That never happens at today's row
    count.
- **Component.** `run-ledger.tsx`:
  - `TallyView` replaces `LedgerView`. One component serves both seats: the panel during the
    sequence, the settled frame in the end state.
  - `useRunTally` lifts the ledger read into `RunMoment`, so both seats share one read.
  - Rows are `<button aria-expanded>`. Clicking one expands its reason breakdown.
- **Sequence.** `run-sequence.tsx`:
  - The old body is now `Beat1`. It no longer calls `onDone`; it hands over to `Beat2`.
  - `Beat2` is a fixed, opaque panel: at most 55 vh, a `--gold-500` top rule, `z-index` above the
    map.
  - Expansion pauses the clock.
  - Beat 2 plays even when beat 1 is skipped (an untraced activity, or no WebGL2), because §3.4
    says the numbers never depend on the graphics.
  - `window.__sequence` records the beat boundaries for the harness.
- **Camera.** `lib/run-moment/camera.ts` `pullBack` goes to the run's fitted zoom minus 1.5, offset
  up by half the map the panel covers.

**Decisions:** D-296, covering five things:
- "before" is computed as of the run, server-side, with floors included;
- Total Level ignores `levelHighWater`;
- the arrow is `--progress-activity`, not `--gold-500`, because 2.24:1 on parchment fails 1.4.11
  (the same conflict as D-291), and the tally's bars are ink so the arrow stays the row's only colour;
- the km line is found from data;
- the camera anchoring and the handoff timing.

`06` §3.2's arrow line is amended.

**Smaller choices:**
- Breakdown words reuse `reasonWords` from the skill sheet ("re-armed ground", "familiar ground"),
  not the ticket mockup's "remembered / familiar". There is one vocabulary.
- The km line comes from the `units` of any km-unit skill's `new_ground` row. `units` was added to the
  AppSync selection set.

**What went wrong, all found by the smoke rather than the tests:**
1. **Beat 2 started ~100 ms late.** At first, `Beat2`'s clock started when it mounted (2003 ms → 3003
   ms after t0). Beat 1 now hands over `t0 + 2.9 s` and beat 2 starts its clock there.
2. **Relive compounded the zoom.** The pull-back was relative to the current zoom, and beat 1 does
   not move a camera that already holds the run, so each ⟲ Relive shrank the route by another
   1.5 levels. The pull-back is now anchored to `cameraForBounds(run)`. It uses `offset`, not
   `padding`, because padding persists on the transform.
3. **A `↑` leaked through the veiled column.** The arrow toggled `visibility: visible`, which
   overrides an ancestor's inherited `hidden`. The strength-session screenshot showed a gold `↑`
   floating under the map. It now fades by opacity. There is a unit test, plus a smoke check that
   nothing under the veiled column computes `visible`.
4. **Three harness mistakes** (my own):
   - the strength check counted rows in both the panel and the veiled column;
   - the layout probe compared `offsetLeft`, but a row with an in-flight transform becomes its
     children's `offsetParent`;
   - the Relive probe read the first play's stale `__sequence`.
5. **The local `next build` and the polyline guard trip on gitignored `tmp/0069`/`tmp/0080`
   scratch.** It is pre-existing and invisible to CI. I moved `tmp/` aside for the build.

**Tests:**
- `lib/run-moment/tally.test.tsx` (16): never-zero in the DOM, ordering, Σ = ledger, the level-up
  bar, Total Level, the breakdown, the veil regression.
- `lib/run-moment/beat2.test.ts`: timing, stagger, exact final values for six magnitudes, monotone
  counts, the pausable clock, a pull-back that does not compound.
- `lib/runs/tally-server.test.ts`: as-of sum, floors, other users, paging.
- `run-moment.test.tsx`, updated.

The full suite is green except the pre-existing `tmp/0080/seed.ts` polyline-guard hit (gitignored).

## Operator validation

**Agent smoke, deployed site (Amplify job 352, `72d3a39`), 2026-10-13** (`tmp/0081/{seed.ts,expect.ts,drive.mjs,cleanup.ts}`).

**Setup.** A throwaway Cognito user, with four activities through the **production** paths:
- A: 2025-12, km 1–2.
- B: 2026-09, km 2–3.
- C: 2026-10-10, km 0–3, which yields new, re-armed and familiar ground.
- D: a 30-pushup strength log, through `logWorkout`.

`expect.ts` computed each tally from the real ledger with the shipped `xpBeforeRun` and `tallyFor`.
- The live `seq` format matched the cut.
- C's "before" was exactly A + B (522).

Headless Chromium at 1280×900 signed in through the real Authenticator.

**Result: 26/26.**
- **Timing.** Beat 2 ran from **2900 ms to 6016 ms**.
- **No reflow.** Layout boxes were identical at t = 3.4 s and 3.9 s, with counts moving
  `+186 → +196` and `+80 → +180`.
- **Panel geometry.** The panel was 315 px of a 900 px viewport, and the map stayed visible above it.
- **Exact values.** Final counts were `+196 +181 +65`, the exact ledger values, XP-descending. Their
  Σ of 442 equals `SUM(ledger)`.
- **Totals.** `Total XP 522 → 964 (+442)`, `Total Level 25`, and `0.92 km never run before`. Every
  `↑` matched a computed level-up.
- **Pause.** On Relive, clicking a row at +450 ms froze the panel for 2 s, and the breakdown read
  `92 new ground · 54 familiar ground · 50 re-armed ground`. Collapsing resumed it: 5383 ms wall,
  2270 ms paused, so 3.1 s of beat clock.
- **Strength session.** Beat 2 played with no beat 1. Its rows were exactly `might, constitution`,
  with no Wayfaring or Cartography row and no `0` anywhere. Nothing under the veiled column was
  visible.
- No console errors.

**Screenshots I looked at** (`tmp/0081/shots/`):
- The parchment sits under a still-lit, pulled-back map.
- Bars are ink, and the `↑` is darker gold.
- Relive frames identically to the first play.

**Cleanup**, verified empty afterwards (0 ledger rows and 0 activity rows for the uid):
- DynamoDB: 16 ledger, 4 activity, 4 skill-state, 1 profile, 4 receipt and 185 explored-cell rows.
- S3: 32 object versions.
- The archive bucket and the Cognito user.

**Not checked by me, and perceptual (for the operator, desktop browser):**
- Whether the count-up feels eager rather than like a slot machine.
- Whether every row is readable as it lands.
- 0061's handover cases on the real account: the archived 2026-09-27 run (re-armed + recent) and
  2026-09-07 (all-recent, which must show no Cartography row).


**Operator, desktop browser — verified 2026-10-13: all five perceptual checks good.** The count-up reads as
eager, not a slot machine, and every row is readable as it lands. Expanding a row mid-count holds the
sequence and the breakdown reads as an account. The 2026-09-27 run shows half-credit Wayfaring
(explored + re-armed) with a half-credit Cartography row. 2026-09-07 (all-recent) shows no Cartography
row. A strength session shows no absence and no `0`.
