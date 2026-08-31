---
id: 81
slug: beat-2-the-tally
title: Beat 2 — the parchment tally (2.9 to 6.0 s), staggered count-ups, and never a zero
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [78, 62, 65]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
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
- **Tapping a row expands it to the reason breakdown**: `318 new ground · 62 remembered · 196
  familiar`. This falls out of the `XpLedger` (0062) for free and it is what makes the numbers feel
  *accountable* rather than dispensed. **Expansion pauses the sequence.**
- `"3.18 km never run before"` gets its own line, phrased in **distance, not cells**. Cells are the
  mechanic; kilometres of new road is the feeling (D-012).
- Total XP is shown as an explicit `old → new` transition — it is one of only two numbers guaranteed
  non-zero every session, so it is the tally's floor.

**Two rules from §3.5 belong here, not in the fallback ticket, because they are tally rules:**

1. **Never render a zero.** A skill that earned nothing is **omitted**, not shown at 0. An absent
   row is neutral; a zero is an accusation. (The tap-breakdown still shows the full truth.)
2. **Row order is sorted by XP gained, descending** — not a fixed skill order. On a quiet run
   Wayfaring leads and Constitution follows, and the guaranteed-non-zero lines carry the bottom.

There is no `(halved)` annotation, no strikethrough, no "you could have earned 510". The app does
not hide the D-021 discount and it never labels it as a penalty. The number is the number.

## Acceptance criteria

- [ ] Beat 2 spans 2.9 s → 6.0 s ± 0.1 s on the target phone.
- [ ] The map remains visible above the ledger at all times; the ledger never covers more than ~55%
      of the viewport height.
- [ ] Rows stagger at 240 ms; each count-up runs 700 ms with `easeOutExpo` and ends on the exact
      ledger value (no off-by-one from easing).
- [ ] Numerals are tabular: a screenshot at t=3.4 s and one at t=3.9 s have identical text metrics —
      nothing reflows mid-count.
- [ ] A bar whose fill crosses 100% fills to full and holds; it never wraps to a second bar.
- [ ] A skill with zero XP this activity does **not** appear as a row. A test with
      `Cartography = 0` asserts no Cartography row is rendered anywhere in the DOM.
- [ ] Rows are ordered by XP descending; a test with Constitution > Wayfaring puts Constitution
      first.
- [ ] Tapping a row expands the reason breakdown sourced from `XpLedgerEntry` rows, and the
      sequence clock pauses while expanded and resumes on collapse.
- [ ] `displayedXp` in the tally equals `SUM(ledger)` for the activity — asserted, not eyeballed.
- [ ] Total XP renders as `old → new (+delta)` and Total Level renders the D-145 value.

## Notes

Depends on 0062 (`XpLedgerEntry`, the source of both the totals and the breakdown) and 0065 (Total
Level / Total XP). It reads; it never scores.

`06-ui-ux.md` §8.4 governs type and D-148 governs gold: gold is a fill and a rule, never body text,
and the `↑` arrow qualifies as a rule-weight mark, not type. Check the level arrow against D-148
before shipping.

The breakdown-on-tap is cheap and disproportionately valuable — it is the difference between a
number the app dispensed and a number the app can account for. Do not defer it.

## Operator validation

**Go for an actual run and import it.** On the Android phone: watch the tally with the phone in one
hand at arm's length in daylight. Can you read every row without leaning in? Is the count-up fast
enough to feel eager and slow enough that you can read the final number, or does it feel like a slot
machine? Tap a row mid-count and confirm the sequence pauses rather than racing on underneath the
expansion. Then log a strength session (`/log`) with no run at all and open its `/run/:id`: there
must be no Wayfaring row and no Cartography row, and nothing on screen should read as an absence.
Finally, run a loop you have run ten times and check that no row anywhere says `0`.
