---
id: 244
slug: change-kind-from-run-page
title: The operator can change an activity's kind from the run page
type: feature
priority: med
status: open
size: s
capability: 10-add-workout
depends_on: [243]
blocked_by: []
source: agent
created: 2026-10-07T11:43:43Z
started: 2026-10-07T14:16:25Z
---

## Description

The UI half of `0171`, split out on 2026-10-07 (D-284). It builds on `0243`.

The operator can change an activity's kind from the single-run page (`app/run/[activityId]`).
The ticket originally named an "activity list", but that does not exist: `app/chronicle` is
still a stub.

## Acceptance criteria

- [ ] An owner-only custom mutation (`setActivityKind`) backed by a Lambda, on the `logWorkout`
      pattern: the user comes from `identity.sub`, never from an argument. It calls `0243`'s
      entry point. An SDL test pins its auth.
- [ ] The run page shows the activity's kind and, if it has been overridden, the derived kind
      it replaced ("was Walk").
- [ ] The run page has a control to change the kind. Its choices are the kinds the rules know,
      read from data, with no `switch` on a kind (D-031).
- [ ] After a change the page reports the XP result in plain words: what was added to which
      skill, or that nothing changed because XP never goes down (D-135).

## Notes

- *(from `0243`, 2026-10-07)* Show "was X" only when `kindOverride` is non-null **and**
  `kind != derivedKind`. An override set back to the derived kind leaves a non-null mirror: the
  2026-09-07 run (`ab00f078…`) has one, from `0243`'s smoke test. Rows written before `0243` lack
  `derivedKind`, so read it as `derivedKind ?? kind`. The backend is
  `rescoreKind` (`src/pipeline/kind-rescore.ts`); its result has `xp: null` when no skill gained.

- Keep the control secondary. Changing a kind is a rare correction, not a primary action on
  the page (D-051: legibility first).

## Operator validation

**Desktop browser, single-run page.** Open an activity that the agent has re-ingested, change
its kind, and check:

- it displays as the corrected kind with "was X";
- the XP message reads right.

The agent proves by smoke test, not by waiting for a real sync, that the override survives
re-ingest: it replays the archived activity through the ingest path after the change.
