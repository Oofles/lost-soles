---
id: 296
slug: drop-the-dead-profile-mapmode-column-and-its-mode-boundary-e
title: Drop the dead Profile.mapMode column and its mode-boundary exemption
type: chore
priority: low
status: open
size: s
capability: 15-two-map-modes-and-cold-territory
depends_on: []
blocked_by: []
source: agent
created: 2026-10-19T23:33:11Z
started: 2026-10-20T12:52:28Z
---

## Description

`Profile.mapMode` (`amplify/data/resource.ts`) is a preference column from `02` T1 that nothing reads
or writes. `05` §5.3 makes the map mode a per-device localStorage setting, which is what `0098`
shipped. The column is the only thing outside the renderer, the toggle and the run-moment seam that
names the mode, so `0099`'s gate (`scripts/check-mode-boundary.mjs`, D-383) carries a by-line
exemption for it and for its grant test in `amplify/profile-model.test.ts`. Drop the column and remove
the exemption, so the gate has no exceptions.

## Acceptance criteria

- [ ] `mapMode` is gone from the `Profile` model and its doc comment in `amplify/data/resource.ts`,
      and from the `it.each` grant list in `amplify/profile-model.test.ts`.
- [ ] The two `amplify/...` entries in `check-mode-boundary.mjs`'s exemption table are removed, and
      the gate passes with an empty table; its `--self-test` still passes.
- [ ] `02-data-model.md`'s T1 `Profile` row no longer lists `mapMode`, citing D-383 and 05 §5.3.
- [ ] After deploy, the Amplify data schema no longer exposes the field (introspect the AppSync
      schema or check the generated `amplify_outputs` model).

## Notes

Filed by the orchestrator from `0099` (operator, 2026-10-19). Removing a nullable AppSync/DynamoDB
attribute is non-destructive: existing items keep a stray attribute nobody reads. Leave
`showColdTerritory` alone — `0100` may use it.

## Operator validation

None perceptual. Smoke test: the deployed schema no longer has `mapMode`, and the mode toggle still
persists across a reload on `/` (localStorage, untouched).
