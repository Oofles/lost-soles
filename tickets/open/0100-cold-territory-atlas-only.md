---
id: 100
slug: cold-territory-atlas-only
title: Cold territory wash, atlas mode only, on a different perceptual channel
type: feature
priority: high
status: open
size: m
capability: 15-two-map-modes-and-cold-territory
depends_on: [98, 99]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Render rediscovery-eligible ground — explored cells whose `lastRunAt` is ageing toward and past
the 6-month cooldown (D-022, D-120) — as a cool wash, **in atlas mode only** (D-133). Adventure
mode stays pure known/unknown for atmosphere.

D-133 names the risk precisely: a third visual state that fights the frontier for attention.
**The design answer is that cold ground is not a third fog state at all** (`06-ui-ux.md` §4.6).
It is a wash painted strictly *inside* already-revealed ground, and D-147 separates it from the
frontier on a **different perceptual channel**:

| | The frontier | Cold ground |
|---|---|---|
| Channel | **Luminance + warm glow** — bright warm rim against dark fog | **Temperature + saturation** — cool, desaturating wash on lit parchment |
| Where it lives | The explored/unexplored boundary | The interior of explored territory only |
| Edge | Hairline, sharp by design in atlas | Soft, 40 px feather, no defined edge |
| Can they touch? | **No** — see the clip rule | |

**The clip rule is the whole trick and it is one line.** Cold opacity is multiplied by
`smoothstep(0.0, 0.25, coverage - 0.75)`, which clips the wash **two cell-widths inside the
coverage mask**, leaving a band of plain warm parchment between cold ground and the frontier at
all times. Cold ground can therefore never render at the reveal edge and the two can never be
confused — not at a glance, not by someone who has never used the app. This is how D-050
atmosphere and D-051 legibility are both satisfied (D-147).

**The ramp is continuous from month 5, not a binary at the 6-month line:**

```
  wash opacity
   0.18 ┤                        ╭──────────────────  asymptote
        │                   ╭────╯
   0.10 ┤              ╭────╯   ← 6 months: re-armed for 50% discovery credit
        │         ╭────╯
   0.00 ┼────────╯
        └────┬────────┬────────┬────────┬─────────►  months since last run
             4        5        6        9
```

Starting the ramp at month 5 is the useful part: **you can see ground coming back into season
before it arrives**, which is what actually changes a Saturday's route, and it is the visual twin
of the chronicle line *"Ashgrove Lane comes back into season in nineteen days"*. It costs one
uniform and no extra data — `explored-lastrun-r10.bin` is already delivered.

Colour: `--cold-wash` `#7E93AD`, multiplied over the lit basemap, plus a −18% saturation shift.
**Never a stipple, never a hatch, never a hex outline** — patterns read as information about one
specific cell and invite tapping, and there is nothing to tap (06 §4.4).

## Acceptance criteria

- [ ] Cold wash renders in atlas and is **absent** in adventure: a pixel test over a fixture with
      12-month-old cells shows a measurable blue/saturation delta in atlas and **zero** delta in
      adventure at the same viewport.
- [ ] The clip rule is implemented as `smoothstep(0.0, 0.25, coverage - 0.75)`; a shader test
      asserts cold opacity is exactly 0 wherever `coverage <= 0.75`, so no cold pixel exists
      within two cell-widths of the frontier.
- [ ] Opacity follows the ramp: 0.0 at ≤4 months, ~0.10 at 6 months, asymptotic to 0.18 — asserted
      at 4, 5, 6, 9 and 24 months against the tabled values, tolerance ±0.01.
- [ ] The wash is continuous — no discontinuity at the 6-month boundary; the derivative of the
      ramp is finite everywhere (no step function in the shader).
- [ ] The wash is a multiply of `#7E93AD` plus a −18% saturation shift; there is no stipple,
      hatch, outline, or per-cell border anywhere in the implementation.
- [ ] The wash is driven from `lastRunAt` per cell (D-120) and no code path writes or reads a
      presence bit.
- [ ] Cold ground never darkens a street label below the 0099 legibility measurement — labels are
      drawn above the wash in atlas.

## Notes

The 40 px feather and the two-cell clip are doing different jobs and both are needed: the feather
stops the wash from having an edge of its own, the clip stops it from ever reaching the edge that
matters.

If the wash looks too blue on the phone at z16, that is a value change to `--cold-wash` and the
saturation shift — file it as a new ticket. It is **not** a reason to add an outline or raise the
opacity above the asymptote, and it is never a reason to show cold ground in adventure.

## Operator validation

On the Android phone, atlas mode, over ground you last ran 5–7 months ago (the chronicle can tell
you where). Look for a cool, edgeless dimming in the middle of your own territory, with a clear
band of warm parchment between it and the fog edge. Then long-press to adventure: the cool wash
must vanish completely while the fog and rim are unchanged. Finally, in bright sunlight, confirm
you can still tell the warm frontier from the cool ground at a glance — if you have to think about
which is which, D-147's channel separation has failed and the wash is too strong.
