---
id: 275
slug: deferred-lifetime-stats-explorer-since-re-armed-lifetime-mos
title: Deferred lifetime stats — explorer since, re-armed lifetime, most-run ground, total distance and runs
type: feature
priority: low
status: closed
size: m
capability: 18-mvp-hardening
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T18:54:00Z
closed: 2026-10-26T20:04:26Z
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

**Withdrawn 2026-10-26 — D-453.** Declined. The three originals are preserved verbatim in
`## Resolution`.

- [x] Declined into `tickets/closed/` with a `## Resolution`; D-329's "a ticket exists for them" is
      amended by D-453, and `05` §8.3, `09` §row 5 and the capability doc say the ticket was
      declined rather than pending.

## Notes

`lib/stats/derived.ts` holds the built half (`lifetimeTerritory`: cells, area, frontier length).
Put the rest beside it, or in its server counterpart, rather than inline in a page.

- 2026-10-15 (operator): moved from `13-home-plinth-and-chronicle` to `18-mvp-hardening`. No capability, MVP or post-MVP, designs a screen that consumes these numbers, and the ticket must not start until one does (D-329); leaving it in 13 blocked that capability's audit. If no screen exists by `18`'s audit, decide then whether to decline it.

## Operator validation

**None, and none is owed: declined, not delivered.** Nothing was built, so there is no screen to look
at and nothing deployed to smoke-test. The original line read "Decided with the consuming screen",
and that still holds for whichever future ticket builds one.

## Resolution

**Declined by the operator, 2026-10-26, at wave 18.5's planning (D-453).**

The ticket's own text said not to start until a screen needed these numbers. None does, in any
capability, MVP or post-MVP, and its first criterion could never be met. Left open, it would have
held capability 18's audit indefinitely. The orchestrator offered decline, defer, or leave open;
the operator chose decline.

What survives the decline:
- `05` §8.3 still specifies all four stats and their sources. It is the design a future ticket cites.
- `lib/stats/derived.ts` remains the place for them, beside `lifetimeTerritory`.
- The constraints of the original criteria carry forward to that future ticket: computed from the
  source of truth, never a period aggregate (N2), no VPC Lambda (D-081), bounded at year five.

Original criteria, verbatim:

> - A consuming screen exists and cites the stats it shows.
> - Each shown stat is computed from its source of truth (cell table, run ledger), never from a
>   cached number, and is never a period aggregate (N2).
> - The computation adds no VPC-attached Lambda (D-081) and is bounded at year-five scale.

Files touched: `docs/decisions/DECISIONS.md` (D-453), `docs/05-fog-of-war.md` §8.3 note,
`docs/09-roadmap.md` (capability 13 row 5), `docs/capabilities/18-mvp-hardening.md` ticket list.
