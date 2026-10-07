---
id: 243
slug: kind-override-stored-and-honoured
title: A kind override is stored as a correction and honoured by ingest, rebuild and scoring
type: feature
priority: med
status: open
size: m
capability: 10-add-workout
depends_on: [237]
blocked_by: []
source: agent
created: 2026-10-07T11:43:42Z
started: 2026-10-07T12:12:25Z
---

## Description

The storage, ingest, rebuild and scoring half of `0171`, split out on 2026-10-07 (D-284). `0244`
adds the UI on top of it.

`Activity.kind` is derived once from the source's type string and rewritten on every delivery
(`persistActivity` does an unconditional `Put`). A rebuild (`02` §8.3) re-derives it from `raw/`.
So an override stored only on the Activity row would be undone by the next sync and by any
rebuild. This ticket gives a kind correction a durable home and makes every path that writes
`kind` honour it.

All of the design questions are settled in **D-284**. Do not re-open them here.

## Acceptance criteria

- [ ] A kind override is an immutable fact under `raw/`, a sibling of the activity's archive
      prefix (the `dedupe.ts` `.duplicate-of.json` pattern). It records the derived kind, the new
      kind, who set it and when. A later override is a new object, and the newest one wins.
- [ ] Ingest applies the override after `normalize()`. A re-sync or `reingest` of an overridden
      activity stores the overridden `kind`, and a test proves it.
- [ ] `replay.ts` and the §8.3 rebuild apply the override the same way, so a rebuild does not
      revert it. `02` §8.3 is amended to say so.
- [ ] The derived kind survives on the Activity row next to the override (`derivedKind`), so the
      UI can show "was X".
- [ ] The sanitizer's outlier gate keeps using the DERIVED kind, so an override never changes the
      trace (D-284 a).
- [ ] A pipeline entry point applies an override and re-scores that one activity with the
      D-142 replay rule: delete its non-floor rows, re-score under the new kind, and write
      `retained_floor` for any skill's shortfall. No skill's XP goes down (D-135). If no skill
      would gain, it writes nothing and reports that.
- [ ] Revealed cells stay revealed whatever the new kind (D-020). If the new kind reveals ground
      and the old one did not, its cells are revealed with `firstRunAt = startedAt`, and no
      discovery XP is awarded (D-260, D-284 c).
- [ ] The kind must be one the rules know about. An unknown kind is refused before anything is
      written.

## Notes

- The fast-read mirror the operator agreed to (D-284) is the Activity row's `kind` +
  `derivedKind` + `kindOverride` provenance fields. Do not add a separate table unless the
  implementation shows the row cannot carry them, and ask first if it cannot.
- The re-score must take the same concurrency guard as the replay job (`replayInProgress` on
  Profile), so it cannot interleave with a ruleset replay.
- D-278 (revised activities do not re-score) is untouched. That rule covers the source changing
  the content. This ticket covers the operator asserting a kind, which re-scores explicitly.

- **Depends on `0237`.** The `retained_floor` id is unique only per (skill, version pair). A
  per-activity re-score that leaves a skill short would collide with an earlier floor and wedge
  ingest. `0237`'s per-run discriminator has to cover per-correction floors as well.

## Operator validation

None for the operator: nothing in this ticket has a UI (`0244` does). Smoke test by the agent
against the deployed stack:

1. Apply an override to a real archived activity.
2. Re-ingest it through the real path.
3. Confirm the Activity row keeps the override, the ledger moved add-only, and the `raw/`
   override object exists.
