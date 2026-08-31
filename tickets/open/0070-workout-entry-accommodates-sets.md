---
id: 70
slug: workout-entry-accommodates-sets
title: WorkoutEntry shape that accommodates sets from day one
type: feature
priority: high
status: open
size: s
capability: 10-add-workout
depends_on: [25]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

**D-062: one-tap quick log for MVP. Sets, reps-per-set and a rest timer are deferred — the data
model is not.** This ticket defines the persisted shape so the deferred feature lands later as a
UI addition rather than a migration.

The rule from `06-ui-ux.md` §6.6, stated as a shape: **each quick log writes one set, not a
scalar.**

```
WorkoutEntry
  exerciseId    "pushup"          # from the registry row's `exercises`
  measure       "reps:pushup"     # the extractor the matcher groups on
  sets          [ { reps: 30 } ]  # ALWAYS a list. One-tap writes a list of one.
  occurredAt    ISO 8601 UTC
  source        "manual"
  idempotencyKey
```

Duration exercises carry `[ { seconds: 90 } ]`; a future distance-manual row carries
`[ { km: 5.0 } ]`. The unit key is named by the registry's `unit`, so a new unit is a registry
value, not a schema change.

Rest intervals are **not** stored in MVP and no field is reserved for them — but `sets` being a
list means adding `restSeconds` later is an optional key on an existing object rather than a
reshape of every historical row.

The scorer sums `sets` to get the unit count. It never reads `sets[0]` positionally.

## Acceptance criteria

- [ ] `WorkoutEntry.sets` is a **list** in the type, the API schema and the persisted item, with
      no scalar `reps`/`seconds`/`km` field anywhere alongside it.
- [ ] A one-tap log of 30 pushups persists `sets: [{ reps: 30 }]`, not `reps: 30`.
- [ ] The scorer computes units as `Σ sets[].<unitKey>` and a test proves a three-set entry
      (`[{reps:10},{reps:10},{reps:10}]`) scores identically to `[{reps:30}]`.
- [ ] No code path indexes `sets[0]`; a lint rule or test asserts this.
- [ ] The unit key is resolved from the registry row's `unit`, not from a union type in source.
- [ ] `occurredAt` is stored explicitly and may be back-dated; it is the value scoring uses.
- [ ] A round-trip test writes, reads and re-scores an entry with 1, 3 and 0 sets; the 0-set
      case is rejected at the API boundary with a named error.
- [ ] A forward-compatibility test adds a `restSeconds` key to a set object and asserts existing
      readers ignore it without error.
- [ ] Nothing in this ticket adds UI: `/log` still writes exactly one set per tap.

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0025 provides the domain contract WorkoutSet is defined against.


This ticket is deliberately small and deliberately first in its capability. It is the one piece
of `10-add-workout` that is expensive to get wrong, because it is the only piece that is written
into durable storage and cannot be changed by editing a component.

The post-MVP sets editor is a **long-press on the row**, opening a sheet with per-set entry and
a rest timer. The row itself does not change and one-tap logging keeps working for anyone who
never long-presses. Nothing about that path needs building now; it needs only to remain possible.

A rest timer is the one deferred feature that could violate D-013 — a timer is a thing that
*runs*, and things that run create obligations. If it ever lands it must be startable only from
inside the sets sheet, must never notify, and must die when the sheet closes. Recorded here so
the constraint is attached to the data model that would enable it.

## Operator validation

Not directly visible. Validate on the **`/skills/:skillId` detail sheet** for Might on the
**Pixel 8 Pro**: log 30 pushups in one tap, then log 10 pushups three times. The `RECENT` list
must show four entries and Might's XP must have increased by exactly twice the 30-rep award. If
three-times-ten scores differently from thirty, the sum over `sets` is wrong.
