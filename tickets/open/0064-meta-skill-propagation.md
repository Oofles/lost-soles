---
id: 64
slug: meta-skill-propagation
title: Meta-skill propagation — Cartography and Constitution via feeds
type: feature
priority: high
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: [48, 60, 61, 62]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-09-29T03:06:50Z
---

## Description

Meta skills are never selected by the matcher (`02-data-model.md` §3.4). They arrive by two
routes, both driven by data:

**Constitution — `feeds`.** Every activity skill row carries
`feeds: [{ skill: constitution, rate: 0.3333 }]`. After an activity skill's XP is rated, the
scorer walks `feeds` and emits one additional ledger row per entry with
`reason: constitution_share`. **The 1/3 is a row's attribute, not a constant in the scorer** —
that is the whole point (J4 in §3.1). Constitution is why a session that moves Might 1.8% of a
level still moves *something* visible.

**Cartography — discovery credit.** Awarded by the fog subsystem, not the activity matcher:
**13 XP per newly revealed H3 res-10 cell** (15 until D-215), at full credit for new ground and **50%** for
re-armed ground (last run > 6 months ago). **Recent ground earns zero, and emits no row at
all** — not a row of zero (D-120, §4.2). Rows carry `reason: cells_new` / `cells_rearmed`.

Rates for the record, all from the registry, none hardcoded: **100 XP/km · pushup 4 · situp 3 ·
plank 1.5/sec · new cell 13 · Constitution 1/3 of activity XP.**

Propagation is **one level deep and non-recursive**: a meta skill's own award never feeds
anything. `feeds` on a `kind: meta` row is a seed-time error, not a runtime loop.

## Acceptance criteria

- [x] After the activity skills are rated, the scorer emits one `constitution_share` row per feed
      **target** per activity, valued at `round(Σ feederXp × rate)`. *Amended 2026-09-28
      (D-255). This originally said "one row per `feeds` entry", which collides on T4's id.*
- [x] The 1/3 rate is read from `feeds[].rate` in the registry; no `0.3333`, `1/3` or
      `/ 3` literal appears in the scorer.
- [x] The share is computed from the **post-multiplier** activity XP, so a half-XP re-run feeds
      half the Constitution.
- [x] A strength session that trains Might and Fortitude produces **two** activity rows and
      **one** `constitution_share` row fed by both. *Amended 2026-09-28 (D-255). This originally
      asked for two share rows. The ledger id `activity#skill#reason#v` cannot hold two, and
      `04` §8.3 and `02` §4.2 already describe one.*
- [x] Cartography pays the Cartography row's `xpPerUnit` per new cell (13, D-215; this
      criterion said 15) and `xpPerUnit × unitMultipliers.rearmed`, rounded, per re-armed cell.
      Both numbers come from the row.
- [x] Recent ground produces **no** Cartography ledger row whatsoever; a test asserts the row
      count, not the XP value.
- [x] Propagation does not recurse: a fixture with `feeds` on a meta row fails at **seed time**
      with a named error, and the scorer contains no loop that could follow it.
- [x] No skill id appears in the propagation code path (I-25); `constitution` is reached only as
      the value of `feeds[].skill`.
- [x] Worked examples reproduce to the XP: `04` §8.2 (amended to `Math.round`, D-256: 578 / 384
      / 193) and §8.3 (300 / 270 / 270 / 280), plus the ticket's own example (8.85 km all-new →
      885 / 884 / 295; 30 pushups + 40 situps → 120 / 120 / 80). *Amended 2026-09-28. The ticket's
      example is not in §8.2 or §8.3, so all three are asserted.*

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0048 provides the per-run new-cell counts Cartography propagates from.


Cartography's award is emitted by the fog stage (`05-fog-of-war.md` §8.2) because that is the
stage that knows the cell set; it is folded into the same `TransactWriteItems`. Keep the rate
lookup in the shared registry accessor so the two stages cannot quote different numbers.

The asymmetry between activity XP and discovery credit on recent ground is deliberate and is
restated in 0061 — repeated ground pays half activity XP *and nothing* for discovery. Do not
"tidy" it into a symmetric multiplier.

Constitution at 1/3 across five activity skills is what makes Total Level move on weeks when no
individual skill does. If it ever needs rebalancing, that is a YAML edit plus a replay (0066),
not a code change — which is the property this ticket is really protecting.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the **`/run/:activityId` post-run tally** in the desktop browser, immediately after importing an
8–9 km activity over mostly new ground (replayed or synthetic — manual adapter or through the
queue, D-229): the parchment ledger must list Wayfaring, Cartography **and**
Constitution as separate rows. Check by eye that the Constitution row is about a third of the
Wayfaring row. Then open `/log`, log 30 pushups and 40 situps in one session, and confirm the
tally shows **four** rows — Might, Fortitude, and a Constitution share for each — not three.
