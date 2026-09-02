---
id: 61
slug: ground-multipliers
title: Ground multipliers — new, re-armed and recent ground (D-120)
type: feature
priority: high
status: open
size: m
capability: 09-xp-engine-and-ledger
depends_on: [48, 60]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Weight a trace-measured activity's units by the state of the ground it covered, per **D-120**
and **D-021**. Three states, per H3 res-10 cell (D-115), classified against the cell's
`lastRunAt`:

| Ground state | Activity XP | Discovery credit | `lastRunAt` |
|---|---|---|---|
| **new** — never seen | 100% | full (owned by `07-fog-projection-and-cells`) | set |
| **re-armed** — last run **> 6 months** ago | **50%** | **50%** | bumped |
| **recent** — last run **≤ 6 months** ago | **50%** | **zero** | bumped |

The multipliers come from the skill row's `groundMultipliers: {new, rearmed, recent}` — they
are **not constants in the scorer**. `groundMultipliers: null` is a documented third state
meaning *this skill is not ground-scored at all* (Vigil), which is distinct from `{1,1,1}`;
a null-ground skill emits a single `distance` row and never a ground row.

Activity XP and discovery credit are **asymmetric on purpose** and must not be conflated.
Re-armed ground pays half activity XP *and* half discovery; recent ground pays half activity
XP *and nothing at all* for discovery — so there is no zero-XP Cartography row, which would
inflate the ledger by roughly 40% for no information (`02-data-model.md` §4.2).

The split is computed per cell over the trace's per-cell segments, then summed into three
`unitsEffective` buckets which become up to three ledger rows with `reason` values
`new_ground`, `rearmed_ground`, `recent_ground`.

## Acceptance criteria

- [ ] Distance over cells absent from the explored set is rated at the row's
      `groundMultipliers.new`.
- [ ] Distance over cells whose `lastRunAt` is more than 6 months before the activity's
      `startedAt` is rated at `groundMultipliers.rearmed`, and `lastRunAt` is bumped.
- [ ] Distance over cells whose `lastRunAt` is 6 months or less before `startedAt` is rated at
      `groundMultipliers.recent`, and `lastRunAt` is bumped.
- [ ] The 6-month comparison uses the **activity's own `startedAt`**, never wall-clock `now`,
      so the classification is identical on replay (`04-game-design.md` §7.4).
- [ ] A skill with `groundMultipliers: null` is never ground-classified; it emits one row with
      `reason: distance` at full rate.
- [ ] An activity crossing all three ground states produces the correct blended total, and
      `Σ unitsEffective` over the three buckets is consistent with the raw `units`.
- [ ] Rounding to integer XP happens **once**, at ledger write time, not per segment (I-19).
- [ ] Unit tests cover: all-new, all-recent, all-re-armed, all three mixed in one trace, a
      zero-distance trace, and a traceless activity.
- [ ] No multiplier literal (`0.5`, `1.0`) appears in the scorer for ground purposes; every
      one is read from the registry row.
- [ ] This ticket makes **no** change to Cartography discovery credit, which is awarded by the
      fog subsystem (`05-fog-of-war.md` §8.2) and propagated by 0064.

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0048 provides the new / re-armed / cooled classification the D-120 multipliers rate.


The ground classification on the ingest path may read `ExploredCell` (T6) as a cache. The
**replay** path must not: `02-data-model.md` §4.4 step 3b reconstructs `firstRunAt`/`lastRunAt`
by folding `cells/<uid>/<activityId>.cells.bin` in `startedAt` order, because `ExploredCell` is
itself a projection of that fold. Share the classifier function between both paths and inject
the ground-state lookup, so replay cannot silently drift from ingest.

D-120 is FINAL: the map never re-fogs. Half XP is not a punishment for repeating a route — it
is what keeps a familiar loop worth running (`06-ui-ux.md` §3.5).

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

On the **`/run/:activityId` post-run tally** on the **Pixel 8 Pro**: re-run the canal loop you
have already covered this month, import it, and read the tally rows. Wayfaring must show a
**half-XP** line attributed to explored ground, and there must be **no** Cartography row at
all — not a Cartography row reading `+0`. Then run a route you last covered over a year ago:
the tally must show half activity XP *and* a Cartography row at half credit.
