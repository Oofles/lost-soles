---
id: 85
slug: no-new-territory-fallback-and-the-trace-layer
title: The no-new-territory fallback — the permanent trace layer and a run that still counts
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [80, 81, 83]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

`06-ui-ux.md` §3.5 opens with the sentence that justifies this ticket's priority: **"This is the case
that decides whether the app survives month four."** Local ground fills in; S2 predicts discovery
decay by month 4–6. On a Tuesday loop round the block, `newCells = 0`, and that will become the
*common* case, not the exception.

**The failure to avoid is precise.** A ledger reading `Cartography +0` over a map where nothing
visibly happened reads as *"that run did not count"* — which is the INTVL wound (I1) reopened by the
reward screen instead of by the scoring engine. **The scoring is already correct**: D-021 gives a
repeat loop half XP to the activity skill, still XP, never zero. It is the *presentation* that can
turn a correct number into a discouragement.

Rules 1 and 3 (never render a zero; sort rows by XP descending) ship in 0081. Rule 4 (the warm
no-new-ground chronicle lines) ships in 0083. **This ticket owns rule 2 and the end-to-end result.**

**Rule 2 — beat 1 changes subject and keeps its 2.9 seconds.** It is never shortened and never
skipped. Instead of fog burning back, the lantern traverses the route over already-clear ground and
the route **inks into the permanent trace layer**: every route you have ever run, drawn faintly in
sepia (`--ink-300` at 0.28), accumulating into a visible web of worn paths across your territory. On
a no-new-ground run, the beat is *this line joining the web*, and **the segments you have run most
darken perceptibly**. The subject shifts from *territory* to *the record of your passage* — still
cumulative, still permanent, still yours.

The trace layer is worth building for its own sake: it is the **second permanent artifact in the
app**, it costs one GeoJSON source, and it makes ordinary runs visible. It is **not** a repetition
reward (P6) — nothing is scored off it, there is no "10th time" badge (N4). It is just the honest
shape of where you actually go.

**And there is always something.** `04-game-design.md` §4.1's guarantee holds by construction: cells
revealed and Total XP are the two numbers that can never be zero for a real activity, and Total XP is
always on screen. Even if every skill row were somehow empty, the ledger still shows the Total XP
transition and the chronicle line — *"a small honest number that went up beats a large fake one."*

The tally on such a run reads, in full:

```
  RETURN FROM THE FOG          Tue 2 Sep · 5.1 km
  Wayfaring     +255   ▓▓▓▓▓▓▓▓░░  L47  7,748 →48
  Constitution   +85   ▓▓░░░░░░░░  L41  6,560 →42
  ──────────────────────────────────────────────
  5.1 km added to the record
  Total XP  1,885,263 → 1,885,603   (+340)

  "Old roads, run well. The map holds them still."

  ◇  Unclaimed ground 1.2 km north — Millbrook
```

Note `+255`, not `+510`. The app does not hide the discount and it never labels it as a penalty.

## Acceptance criteria

- [ ] A permanent trace layer renders every past route as sepia `--ink-300` at 0.28, from one
      GeoJSON source, beneath the run polyline and above the basemap.
- [ ] Segments covered by multiple runs render perceptibly darker than single-run segments, and the
      darkening is bounded so a daily commute route does not saturate to black.
- [ ] Nothing reads the trace layer for scoring: a grep proves no scoring module imports it, and no
      count, badge or "nth time" string exists anywhere in its code path.
- [ ] On a run with `newCells = 0`, beat 1 still lasts 2.9 s ± 0.1 s — not shortened, not skipped.
- [ ] On such a run the new route visibly inks into the trace layer during beat 1, and the layer
      still contains it after a reload.
- [ ] The tally on such a run shows no Cartography row (0081's rule 1) and leads with Wayfaring
      (0081's rule 3).
- [ ] The summary line reads `"5.1 km added to the record"` — distance framing, not a cell count and
      not a zero.
- [ ] The Total XP `old → new (+delta)` line is present and non-zero.
- [ ] The chronicle line comes from the no-new-ground set (0083).
- [ ] An end-to-end test replays the same route twice and asserts the second play produces: half
      Wayfaring XP, zero Cartography rows, a 2.9 s beat 1, a trace-layer write, and no string
      anywhere on screen matching `0 cells`, `No new`, or `(halved)`.

## Notes

Depends on 0080 (beat 1, whose subject this changes), 0081 (the tally rules) and 0083 (the chronicle
lines).

This is the ticket most likely to be judged "done" prematurely, because it passes its tests long
before it feels right. The tests here can only prove the absences — no zero, no penalty label, no
shortened beat. Whether the run *feels* like it counted is the operator's call and nobody else's.

The trace layer is deliberately built in `12` rather than deferred to `15`, because a no-new-ground
run with nothing to look at is the exact failure this ticket exists to prevent, and by the time `15`
ships the operator will already have had a dozen of them.

## Operator validation

**This one requires two runs, a week apart, on the same route.**

Run your usual loop — the one round the block you have already covered — and import it. On the
Android phone, watch the whole sequence without skipping. The honest question, asked immediately
afterwards and not rationalised: **did that feel like "you did the work", or did it feel like
"nothing happened"?** If it is the second, the ticket is not done, regardless of the test suite.

Look specifically at: (a) the map during beat 1 — is there something to watch, or is the lantern
sliding over dead ground; (b) whether your eye goes looking for a missing Cartography row; (c)
whether the trace layer is visible enough to notice and faint enough not to compete with the fog
edge.

Then open the map at home zoom and look at the accumulated web of your routes. After a month of
ordinary running that picture should be worth opening the app for on its own. If it is not, say so
in a new ticket rather than extending this one.
