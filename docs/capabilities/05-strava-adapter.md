# 05-strava-adapter

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`05-strava-adapter\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (7)

- `0032` — Strava OAuth connect flow with activity:read_all - and a callback that refuses the lesser scope
- `0033` — strava/client.ts - token storage in SourceAccount (T7) and rotating-refresh-token handling
- `0034` — strava listSince(since) - the mandatory reconciliation sweep and the manual-sync producer
- `0035` — Fetch the full latlng stream - never summary_polyline, and never send resolution/series_type
- `0036` — strava/normalize.ts - pure, no network, no clock, streams JSON to { activity, trace }
- `0037` — Activity-kind mapping on sport_type, indoor/no-GPS handling, and trace sanitation
- `0038` — Checked-in real-response fixtures, the fidelity floor, and rate-limit backoff

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

