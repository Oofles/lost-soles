---
id: 275
slug: deferred-lifetime-stats-explorer-since-re-armed-lifetime-mos
title: Deferred lifetime stats — explorer since, re-armed lifetime, most-run ground, total distance and runs
type: feature
priority: low
status: open
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T18:54:00Z
---

## Description

`05` §8.3 lists lifetime stats that `0090` could not build client-side (D-329): **explorer since**
(`min(firstRunAt)`), **cells re-armed lifetime** (`Σ discoveryCount − 1`), **most-run ground**
(`max(visitCount)`) and **total distance / runs**. They need per-cell history from the server's cell
table and full run totals, none of which the browser holds. No screen consumes them, and the
operator chose to defer them until one does (D-329). The Chronicle is not that screen; it carries
no totals.

**Do not start this ticket until a screen design needs these numbers.** When it does, add a
`depends_on` on that ticket and decide the transport there (server read in the consuming page's
SSR, or a small derived payload beside `explored-r10.bin`).

## Acceptance criteria

- [ ] A consuming screen exists and cites the stats it shows.
- [ ] Each shown stat is computed from its source of truth (cell table, run ledger), never from a
      cached number, and is never a period aggregate (N2).
- [ ] The computation adds no VPC-attached Lambda (D-081) and is bounded at year-five scale.

## Notes

`lib/stats/derived.ts` holds the built half (`lifetimeTerritory`: cells, area, frontier length).
Put the rest beside it, or in its server counterpart, rather than inline in a page.

- 2026-10-15 (operator): moved from `13-home-plinth-and-chronicle` to `18-mvp-hardening`. No capability, MVP or post-MVP, designs a screen that consumes these numbers, and the ticket must not start until one does (D-329); leaving it in 13 blocked that capability's audit. If no screen exists by `18`'s audit, decide then whether to decline it.

## Operator validation

Decided with the consuming screen.
