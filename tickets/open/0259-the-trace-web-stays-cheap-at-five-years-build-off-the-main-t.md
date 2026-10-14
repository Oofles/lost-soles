---
id: 259
slug: the-trace-web-stays-cheap-at-five-years-build-off-the-main-t
title: The trace web stays cheap at five years — build off the main thread or precompute it
type: chore
priority: low
status: open
size: m
capability: 18-mvp-hardening
depends_on: [85]
blocked_by: []
source: agent
created: 2026-10-14T04:48:33Z
---

## Description

`0085` (D-299) builds the permanent trace web on the browser's main thread from every past route,
each time the explored generation changes. At today's 19 traced runs that is ~17 ms and ~40 KB.
A synthetic five years (1,000 runs × 8 km, GPS-like wiggle) measured **~1.7 s** of main-thread
work and **~15 MB** of `/api/runs/web` input — a visible stall on map load and on every
`/run/:id` beat 1 (which builds it twice: with and without the run).

This is not a problem yet and must not be solved speculatively. It becomes one somewhere past a
few hundred runs. Pick the cheapest of: (a) build in a Web Worker; (b) a worker-side precomputed
drawn web stored beside the inputs, with "without this run" derived by subtraction of that run's
own pieces; (c) a coarser store (delta-encoded integers) to cut the transfer.

## Acceptance criteria

- [ ] With a synthetic 1,000-run web, map load spends under 50 ms of main-thread time on the web
      (measured, not estimated), and `/api/runs/web` transfers under 2 MB.
- [ ] `lib/trace-web/web.test.ts` still passes unchanged — the drawn web is identical.
- [ ] Beat 1 still lasts 2.9 s ± 0.1 s with the large web.

## Notes

Measured in `0085`'s session with a throwaway vitest harness over `buildWeb`; the numbers are in
D-299's last bullet. Filed in `18`, not `12`, so it does not hold capability 12's audit open for a
cost that is years away.

## Operator validation

None perceptual: this is a performance ticket, verified by measurement. The agent runs the
synthetic-scale measurement and records it.
