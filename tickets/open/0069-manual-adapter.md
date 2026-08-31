---
id: 69
slug: manual-adapter
title: The manual adapter — src/adapters/manual/ behind the ingestion contract
type: feature
priority: high
status: open
size: m
capability: 10-add-workout
depends_on: [26, 70]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

**D-100: ingestion is source-agnostic.** Everything that produces an `Activity` does so behind
one normalized contract, and in-app logging is not an exception to that — it is another adapter.
`src/adapters/manual/` sits beside `src/adapters/strava/` and implements the same interface, so
the scoring pipeline cannot tell the difference and no manual-logging special case leaks into it.

What makes it distinct is only what it *omits*: **a manual workout has no `Trace`**.
`hasTrace: false`, `traceRef: null`, `cellCount: 0`. That single fact carries all the downstream
behaviour with no additional flags — no trace ⇒ no H3 projection ⇒ no `ExploredCell` write ⇒ no
generation bump ⇒ no Cartography award (**I-27**: *"zero discovery credit / no map reveal" is
expressed by no field at all*). Do not add a `grantsDiscovery: false`.

The client's entry point is a **`logWorkout` mutation** that runs the **same server-side
pipeline** as any other ingest — this is the one carve-out in I-20, and it exists precisely so
the client still cannot write XP. The client submits *what was done*, never *what it is worth*.

**Strength work is never ingested from Strava** (D-060), even if Strava later exposes something
that looks like it. This adapter is the only path.

Idempotency: the client supplies an idempotency key with each submission; the same key
re-delivered writes nothing new and returns the original result, so the background-sync queue in
0068 can retry freely.

## Acceptance criteria

- [ ] `src/adapters/manual/` implements the same adapter interface as the Strava adapter, with
      no additions to that interface and no `manual`-shaped branch in the pipeline.
- [ ] The adapter emits an `Activity` with `hasTrace: false`, `traceRef: null` and
      `cellCount: 0`; the row shape is otherwise identical to a traced activity.
- [ ] `source.source` is `manual`, drawn from the existing `SourceId` vocabulary.
- [ ] A `logWorkout` mutation exists, is `allow.owner()`, and accepts only measured work — units,
      exercise id, an optional occurred-at, an idempotency key. It accepts **no XP field, no
      skill id, and no level field**; a CI assertion over the generated schema enforces this.
- [ ] The mutation runs the same scoring pipeline as the webhook path — same
      `selectActivitySkills`, same rating, same ledger write, same transaction.
- [ ] A logged workout writes **no** `ExploredCell` row and does **not** bump `generation`; a
      test asserts the map's generation is byte-identical before and after.
- [ ] Re-submitting the same idempotency key writes zero new ledger rows and returns the
      original result.
- [ ] `occurredAt` defaults to submission time but may be back-dated; scoring uses it, never
      wall clock, so a back-dated log replays identically.
- [ ] No Strava type, and no manual-adapter type, appears outside its own directory (D-121's
      boundary rule, applied symmetrically).
- [ ] A test logs one session through the mutation end-to-end and asserts Might, Fortitude and
      Constitution all move.

## Notes

**Cross-capability dependency added during backlog validation (2026-08-30):** 0026 provides adapters/types.ts and the registry the manual adapter registers with.


The adapter boundary is what makes D-103 true — the watch/device decision is not blocking —
and it is also what will make a future Health Connect or GPSLogger adapter a directory rather
than a refactor. Keeping the manual path inside the boundary rather than beside it is the whole
value.

An offline log that is flushed days later must score with its **original** `occurredAt`, which
matters for the D-120 six-month ground window on any future traceless distance skill.

## Operator validation

On **`/log`** on the **Pixel 8 Pro**, in a basement with no signal: log 30 pushups. Walk back
into signal and watch the **`/skills` panel** — Might must move within a few seconds, with no
prompt, no retry button and no error ever having appeared. Then open the **map on `/`** and
confirm **nothing was revealed**: no new territory, no generation flicker, no Cartography row in
the tally. A workout logged indoors must leave the map untouched.
