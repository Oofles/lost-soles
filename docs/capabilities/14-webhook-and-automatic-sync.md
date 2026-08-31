# 14-webhook-and-automatic-sync

> **Stub, generated during backlog validation.** The authoritative design is the
> `#### \`14-webhook-and-automatic-sync\`` section of [`../09-roadmap.md`](../09-roadmap.md). This file is where the
> DESIGN step's output belongs, and where [`AUDIT.md`](AUDIT.md) results are appended at close.

## Tickets (6)

- `0091` — strava-webhook Lambda behind a Function URL, added via the CDK escape hatch, acking in 2 s
- `0092` — The hub.challenge handshake (the key has a dot) and subscription lifecycle management
- `0093` — Event validation, replay idempotency, deauthorization, and cost-DoS defence
- `0094` — token-refresh scheduled Lambda — refresh before expiry, every 4 hours, never on failure
- `0095` — The reconciliation sweep — listSince backstop for silently dropped webhooks
- `0096` — "Your run is on the map" — the one notification, deep-linking to /run/:id

## Design notes

_Filled in at the DESIGN step, before TICKET-WRITE._

## Audit

_Appended by `/tickets audit` at close. See [`AUDIT.md`](AUDIT.md)._

## Reflection

_Filled in at the REFLECT step, after USE._

