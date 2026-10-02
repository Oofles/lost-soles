---
id: 70
slug: workout-entry-accommodates-sets
title: WorkoutEntry shape that accommodates sets from day one
type: feature
priority: high
status: closed
size: s
capability: 10-add-workout
depends_on: [25]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-02T19:52:51Z
closed: 2026-10-02T19:59:29Z
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

- [x] `WorkoutEntry.sets` is a **list** in the type, the API schema and the persisted item, with
      no scalar `reps`/`seconds`/`km` field anywhere alongside it.
- [x] A one-tap log of 30 pushups persists `sets: [{ reps: 30 }]`, not `reps: 30`.
- [x] The scorer computes units as `Σ sets[].<unitKey>` and a test proves a three-set entry
      (`[{reps:10},{reps:10},{reps:10}]`) scores identically to `[{reps:30}]`.
- [x] No code path indexes `sets[0]`; a lint rule or test asserts this.
- [x] ~~The unit key is resolved from the registry row's `unit`, not from a union type in source.~~
      **Amended (D-280):** the set field is resolved from the registry row's **measure kernel**
      (`reps:pushup` → `reps`, `seconds:plank` → `durationS`) through the one `SET_FIELDS` map the
      scorer also uses — never from a union type in source. `unit` is a display noun (`rep`,
      `second`) and names no field.
- [x] `occurredAt` is stored explicitly and may be back-dated; it is the value scoring uses.
- [x] A round-trip test writes, reads and re-scores an entry with 1, 3 and 0 sets; the 0-set
      case is rejected at the API boundary with a named error.
- [x] A forward-compatibility test adds a `restSeconds` key to a set object and asserts existing
      readers ignore it without error.
- [x] Nothing in this ticket adds UI: `/log` still writes exactly one set per tap.

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0025 provides the domain contract WorkoutSet is defined against.


This ticket is deliberately small and deliberately first in its capability. It is the one piece
of `10-add-workout` that is expensive to get wrong, because it is the only piece that is written
into durable storage and cannot be changed by editing a component.

The post-MVP sets editor is ~~a **long-press on the row**~~ **a small visible control on the row**
*(long-press is undiscoverable with a mouse — D-251, D-253, 0215)*, opening a sheet with per-set
entry and a rest timer. The row itself does not change and one-click logging keeps working for
anyone who never opens it. Nothing about that path needs building now; it needs only to remain possible.

A rest timer is the one deferred feature that could violate D-013 — a timer is a thing that
*runs*, and things that run create obligations. If it ever lands it must be startable only from
inside the sets sheet, must never notify, and must die when the sheet closes. Recorded here so
the constraint is attached to the data model that would enable it.

## Resolution

**The ticket's shape conflicted with the canonical contract, and the contract won (D-280,
operator decision 2026-10-02).** `0025` had already transcribed `Activity.sets: WorkoutSet[]`
(`{ exercise, reps?, durationS?, weightKg? }`) into the domain and the Amplify schema, and `0060`'s
scorer already summed it. So there is **no `WorkoutEntry` table**: `WorkoutEntry` is the `/log`
**request body**, and a manual log persists as an `Activity`. `01` §3's row 5, which listed a
`WorkoutEntry` model, was amended. Criterion 5 was amended because the registry's `unit` (`rep`,
`second`) names no field. The field comes from the measure's kernel, which `02` §3.7 already makes
code.

**Files**
- `src/scoring/units.ts`: added `SET_FIELDS` (kernel → `WorkoutSet` field) and `setFieldOf(measure)`.
  `sumSets` now reads through `SET_FIELDS`, so the scorer and the boundary share one map. Exported
  from `src/scoring/index.ts`.
- `lib/log/workout-entry.ts` (new): the `WorkoutEntry` / `EntrySet` types,
  `parseWorkoutEntry(input, registry)` (throws `WorkoutEntryError` with a `code`: `NO_SETS`,
  `UNKNOWN_EXERCISE`, `BAD_SET`, `BAD_OCCURRED_AT`, `BAD_IDEMPOTENCY_KEY`, `NOT_AN_OBJECT`),
  `entryFieldFor`, and `entryActivityFields` (stamps `exercise` onto each set; `occurredAt` →
  `startedAt`). The parser drops unknown keys such as `restSeconds`. It refuses another kernel's
  field on a set (`durationS` on pushups) so that a set is never half-scored.
- `lib/log/workout-entry.test.ts` (new, 18 tests): one block per criterion, against the real v2
  registry. It includes a `marshall`/`unmarshall` DynamoDB round trip for 1 and 3 sets, and a
  synthetic `burpee` row that proves a new exercise needs no code.
- `src/scoring/no-positional-sets.test.ts` (new): a grep guard over `src app lib components
  amplify` for `sets[N]`, `sets?.[N]`, `sets.at(` and `[x] = …sets`. It has the usual "scans >10
  files" and "detects a planted violation" proofs (D-176: a guard must prove it ran).
- `docs/decisions/DECISIONS.md` (D-280), `docs/01-architecture.md` §3 row 5.

**What went wrong.** I first put the boundary in `src/adapters/manual/`. `registry.test.ts`
failed, correctly: every adapter directory must be registered, and registering one is `0069`'s
job. I moved it to `lib/log/`, which is the `/log` route's input boundary (`0068`). `0069` imports
`entryActivityFields` from there.

**Left for later tickets, deliberately.** A future-dated `occurredAt` is not refused. Refusing it
needs a clock, and the parser is pure; the manual adapter (`0069`) owns `now()`. That adapter also
owns `kind`, identity, the raw archive and idempotent writes keyed on `idempotencyKey`.

## Operator validation

*Planned at ticket-write:* Not directly visible. Validate on the **`/skills/:skillId` detail sheet** for Might in the
desktop browser: log 30 pushups in one click, then log 10 pushups three times. The `RECENT` list
must show four entries and Might's XP must have increased by exactly twice the 30-rep award. If
three-times-ten scores differently from thirty, the sum over `sets` is wrong.

**No perceptual check is possible yet.** The ticket's suggested check (logging on the Might detail
sheet) needs the `/log` route (`0068`) and the manual adapter (`0069`), and neither exists. That
check belongs to those tickets.

**Smoke test (agent, 2026-10-02, AWS `devault`, us-east-1)**: `tmp/0070/smoke.ts` created a
throwaway on-demand DynamoDB table, `lost-soles-0070-smoke-1790971082685`. It sent three `/log`
bodies through `parseWorkoutEntry` → `entryActivityFields`, then `PutItem`, then a consistent
`GetItem`, and re-scored each one with `scoreActivity` under v2. Then it deleted the table.
- `1x30` → stored `[{"exercise":"pushup","reps":30}]`, and the back-dated `startedAt
  2026-09-20T07:00:00Z` was kept. Written and read both score `might:30u:120xp,
  constitution:120u:40xp`.
- `3x10` → stored three set objects. Score identical to `1x30`.
- `[{reps:30, restSeconds:60}]` → `restSeconds` dropped at the boundary. Score identical.
- `sets: []` → `WorkoutEntryError NO_SETS`.

Full suite: 138 files, 2577 passed, 1 skipped. `npm run typecheck` and `npm run lint` are clean
except for the pre-existing errors under the gitignored `tmp/`. `check-boundaries.mjs` exits 0.
