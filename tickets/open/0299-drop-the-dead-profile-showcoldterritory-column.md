---
id: 299
slug: drop-the-dead-profile-showcoldterritory-column
title: Drop the dead Profile.showColdTerritory column
type: chore
priority: low
status: open
size: s
capability: 15-two-map-modes-and-cold-territory
depends_on: []
blocked_by: []
source: agent
created: 2026-10-20T16:12:39Z
---


## Description

`Profile.showColdTerritory` (`amplify/data/resource.ts`) is a preference column from `02` T1 that
nothing reads or writes. `0100` shipped the cold wash as part of atlas itself: the palette's
`coldWash` is 1 in atlas and 0 in adventure (`lib/fog/fog-uniforms.ts`), with no switch, and it left
the column unwired on purpose. D-133 says atlas renders cold ground, full stop, and D-395 settles
that there is no toggle. Drop the column, the same way `0296` dropped `mapMode`.

Filed by capability 15's audit as its one code-was-wrong divergence (D-262).

## Acceptance criteria

- [ ] `showColdTerritory` is gone from the `Profile` model and its doc comment in
      `amplify/data/resource.ts`, and from the `it.each` grant list in
      `amplify/profile-model.test.ts`.
- [ ] `02-data-model.md`'s T1 `Profile` row no longer lists `showColdTerritory`, and cites D-395.
- [ ] After deploy, the AppSync introspection's `type Profile` has no `showColdTerritory`.

## Notes

Removing a nullable AppSync/DynamoDB attribute is non-destructive: existing items keep a stray
attribute that nobody reads. Do not backfill or scrub. `0296`'s Resolution has the exact shape:
three files, plus a post-deploy `aws appsync get-introspection-schema --api-id
nog4xy2l7baqlhghpndh2565qe --format SDL`. The audit already amended 02 T1's summary row and its S-5
line (D-395); this ticket owns only the T1 attribute row, which goes with the column.

## Operator validation

None perceptual: a schema field that nobody reads. Smoke test after deploy: the AppSync
introspection, as in `0296`.
