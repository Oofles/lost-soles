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

- [x] `mapMode` is gone from the `Profile` model and its doc comment in `amplify/data/resource.ts`,
      and from the `it.each` grant list in `amplify/profile-model.test.ts`.
- [x] The two `amplify/...` entries in `check-mode-boundary.mjs`'s exemption table are removed, and
      the gate passes with an empty table; its `--self-test` still passes.
      *(Amended: the table is removed outright rather than left empty, with the by-line code path
      that read it — an empty exemption mechanism is an invitation. The gate passes over 535 files;
      the self-test passes 17 cases, the schema line now among the must-fire ones.)*
- [x] `02-data-model.md`'s T1 `Profile` row no longer lists `mapMode`, citing D-383 and 05 §5.3.
- [ ] After deploy, the Amplify data schema no longer exposes the field (introspect the AppSync
      schema or check the generated `amplify_outputs` model).
      *(Not tickable before deploy. Locally the generated schema no longer has it — the grant test
      reads the built schema and passes without it. The post-deploy introspection is in the
      Resolution's smoke test, for the orchestrator.)*

## Notes

Filed by the orchestrator from `0099` (operator, 2026-10-19). Removing a nullable AppSync/DynamoDB
attribute is non-destructive: existing items keep a stray attribute nobody reads. Leave
`showColdTerritory` alone — `0100` may use it.

## Operator validation

None perceptual. Smoke test: the deployed schema no longer has `mapMode`, and the mode toggle still
persists across a reload on `/` (localStorage, untouched).

## Resolution

**Files touched**
- `amplify/data/resource.ts` — `mapMode: a.string()` and its `"atlas" | "adventure"` doc comment
  removed from `Profile`; the preference list in the model's doc comment is now three fields.
- `amplify/profile-model.test.ts` — `mapMode` dropped from the owner-writes `it.each` list.
- `scripts/check-mode-boundary.mjs` — the `ALLOW_LINES` table and the per-file `okLines` check that
  consumed it are gone; the header's "one pre-existing exception" paragraph is replaced by "no
  exceptions" naming this ticket and D-383. Self-test: `amplify/data/resource.ts` with the old
  column line is now a must-FIRE case (the column cannot come back silently); the
  `resource-2.ts` contrast case and the "other line in an exempt file" extra case, which only
  existed to test the by-line mechanism, are removed. 17 cases.
- `docs/02-data-model.md` — T1 `Profile` row for `mapMode` removed; a note under the table says
  there is no such attribute because the mode is per-device localStorage (05 §5.3) and confined by
  D-383, and that `0296` dropped it.
- `docs/capabilities/15-two-map-modes-and-cold-territory.md` — the name-boundary row's "19
  self-test cases" corrected to 17, no exemptions.

**Decisions.** One judgement call, within the ticket's stated aim ("so the gate has no
exceptions"): the exemption table was deleted rather than emptied, since keeping an unused
by-line escape hatch, untested, is how the next exception gets added quietly. No new `D-xxx`;
D-383 already anticipated this ticket. `showColdTerritory` untouched (0100).

**Data.** Removing a nullable attribute is non-destructive: any existing `Profile` item keeps a
stray `mapMode` attribute nobody reads. No migration. The toggle's localStorage key
(`lib/map-mode.ts`) is untouched.

**Not done here:** `docs/INDEX.md` regeneration (orchestrator's — `02` and capability `15` changed).

**Smoke test (post-deploy, orchestrator):** the lost-soles `main` AppSync API is
`nog4xy2l7baqlhghpndh2565qe` (tags `amplify:app-id d14fhvl4rp79nn`, `amplify:branch-name main`;
it prints `1` before this deploy, checked 2026-10-20):
```
aws appsync get-introspection-schema --api-id nog4xy2l7baqlhghpndh2565qe --format SDL \
  --profile devault --region us-east-1 /tmp/profile-schema.graphql >/dev/null
awk '/^type Profile /,/^}/' /tmp/profile-schema.graphql | grep -c mapMode   # expect 0
```
Then on `/`, toggle to adventure, reload: it stays adventure (localStorage, untouched).
