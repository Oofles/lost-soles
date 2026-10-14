---
id: 262
slug: rearmindays-when-ground-near-a-run-comes-back-into-season
title: rearmInDays: when ground near a run comes back into season
type: feature
priority: low
status: open
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-14T15:47:35Z
started: 2026-10-14T19:47:30Z
---

## Description

Found closing `0256`. The forward-looking chronicle row `rearm-soon-named` (*"Ashgrove Lane comes
back into season in nineteen days"*, `06-ui-ux.md` §3.5 rule 4) has a street source now (D-302) but
still no `rearmInDays` fact, so it is never selectable.

It cannot come from the run's own cells: the run just re-ran them, so every one of them is 183 days
from season. It needs the `lastRunAt` of cells **near** the run that it did not touch — a T6 read
the run page does not make today, or a value ingest computes and stores beside the run's classes
(`rearmedSince`'s neighbour). Determinism matters: a Relive must read the same line, so a value
computed against *today's* T6 state is wrong; it has to be as-of the run.

## Acceptance criteria

- [ ] `rearmInDays` is a chronicle fact computed as of the run, never `now()`, and stored or
      derivable so the same activity selects the same line on every read.
- [ ] `{street}` for this row names the street of the cell that comes back into season soonest, via
      `lib/place-names.ts` (D-302).
- [ ] A no-new-ground run with such a cell within the chosen radius can select `rearm-soon-named`;
      the row stays the only forward-looking one (`0083` Notes).

## Notes

Decide the radius and whether ingest stores the fact (preferred: one T6 read at ingest, which
already holds the neighbourhood's records for classification) before writing code.

## Operator validation

In the desktop browser, open a no-new-ground run that selects the line and judge whether it reads
as an invitation, never a deadline (N2).
