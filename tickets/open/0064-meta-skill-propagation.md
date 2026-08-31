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
**15 XP per newly revealed H3 res-10 cell**, at full credit for new ground and **50%** for
re-armed ground (last run > 6 months ago). **Recent ground earns zero, and emits no row at
all** — not a row of zero (D-120, §4.2). Rows carry `reason: cells_new` / `cells_rearmed`.

Rates for the record, all from the registry, none hardcoded: **100 XP/km · pushup 4 · situp 3 ·
plank 1.5/sec · new cell 15 · Constitution 1/3 of activity XP.**

Propagation is **one level deep and non-recursive**: a meta skill's own award never feeds
anything. `feeds` on a `kind: meta` row is a seed-time error, not a runtime loop.

## Acceptance criteria

- [ ] After rating an activity skill, the scorer emits one `constitution_share` row per `feeds`
      entry, valued at `round(activityXp × rate)`.
- [ ] The 1/3 rate is read from `feeds[].rate` in the registry; no `0.3333`, `1/3` or
      `/ 3` literal appears in the scorer.
- [ ] The share is computed from the **post-multiplier** activity XP, so a half-XP re-run feeds
      half the Constitution.
- [ ] A strength session that trains Might and Fortitude produces **two** activity rows and
      their **two** corresponding `constitution_share` rows, not one merged share.
- [ ] Cartography awards 15 XP per new cell and 7.5 → rounded per the registry rate for
      re-armed cells, sourced from the Cartography row's `xpPerUnit` and ground rates.
- [ ] Recent ground produces **no** Cartography ledger row whatsoever; a test asserts the row
      count, not the XP value.
- [ ] Propagation does not recurse: a fixture with `feeds` on a meta row fails at **seed time**
      with a named error, and the scorer contains no loop that could follow it.
- [ ] No skill id appears in the propagation code path (I-25); `constitution` is reached only as
      the value of `feeds[].skill`.
- [ ] Worked example: 8.85 km all-new + 30 pushups + 40 situps reproduces to the XP against
      `04-game-design.md` §8.2 / §8.3.

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

On the **`/run/:activityId` post-run tally** on the **Pixel 8 Pro**, immediately after a real
8–9 km run over mostly new ground: the parchment ledger must list Wayfaring, Cartography **and**
Constitution as separate rows. Check by eye that the Constitution row is about a third of the
Wayfaring row. Then open `/log`, log 30 pushups and 40 situps in one session, and confirm the
tally shows **four** rows — Might, Fortitude, and a Constitution share for each — not three.
