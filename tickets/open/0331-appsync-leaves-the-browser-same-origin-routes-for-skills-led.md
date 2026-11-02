---
id: 331
slug: appsync-leaves-the-browser-same-origin-routes-for-skills-led
title: AppSync leaves the browser: same-origin routes for skills, ledger, log and kind
type: feature
priority: med
status: open
size: m
capability: 19-authjs-migration
depends_on: [117]
blocked_by: []
source: agent
created: 2026-11-02T17:18:05Z
---


## Description

Capability `19-authjs-migration`. Design: `docs/capabilities/19-authjs-migration.md`
§"Architectural impact" and §"API surface changes". Decision: **D-472**, AppSync stops being a
client-facing API. Re-affirmed D-123: **D-470**.

The browser reaches AppSync through four `generateClient` transports. Each becomes a fetch to a
same-origin route handler that runs as the SSR compute role and keys every read by `currentUserId()`.
This is the pattern `/api/runs/*` and `/api/fog` already use (D-228, D-456).

- `lib/skills/transport.ts`: `XpLedgerEntry` by seq and by skill, `Profile.get`, `Landmark.list` →
  `GET` routes under `/api/skills/`. Direct DynamoDB `Query`/`GetItem` on those model tables, with the
  table names published through `backend.addOutput` as `activityTableName` already is.
- `lib/runs/ledger-transport.ts` → `GET /api/runs/[activityId]/ledger`.
- `lib/log/transport.ts` `logWorkout` → `POST /api/log`, which `lambda:Invoke`s `log-workout` with
  `{ userId, ...args }`.
- `lib/run-kind/transport.ts` `setActivityKind` → `POST /api/runs/[activityId]/kind`, which invokes
  `set-activity-kind` the same way.
- Both Lambda handlers read `event.userId`, not `event.identity.sub`, and still check
  `OWNER_USER_IDS`. The SSR compute role is the only principal with `lambda:InvokeFunction` on them.
- The transports keep their exported function signatures, so no component changes.

The AppSync mutations and the browser's `generateClient` stay compiled until `0334` changes the data
auth. This ticket only stops the browser from calling them.

## Acceptance criteria

- [ ] No file under `app/`, `components/` or `lib/` imports `aws-amplify/data` (lint rule or grep
      test).
- [ ] Each new route is exported through `withNoStore` and passes `check-route-cache-control.mjs`.
- [ ] Each new route has a test: signed out → 404 (matching the middleware's API behaviour); signed
      in → the reads are keyed by the session uid, and a uid passed in the query or body is ignored.
- [ ] Both POST routes refuse a foreign `Origin` (D-471) and do not invoke the Lambda.
- [ ] `amplify/fog-delivery-read-grant.test.ts`-style synth tests pin the SSR role's new grants:
      read-only on the model tables it reads, and `lambda:InvokeFunction` on exactly the two
      functions.
- [ ] `lib/security-headers.ts`'s `connect-src` no longer names the AppSync endpoint.
- [ ] `08` §5.5's `defineData` bullet and `01` §1's "Client-facing data" row are amended, citing
      D-472.

## Notes

`/log` and `/skills` are static on purpose (D-282). They still are: the data is fetched client-side
from the new routes, as before, only from a different origin.

Lambda invoke latency replaces an AppSync hop, so the cost is about the same. If `/log`'s
confirmation gets slower than it is today, say so in the Resolution with numbers.

## Operator validation

Agent smoke tests against production: each GET route signed-out 404; CloudWatch shows `log-workout`
invoked by the SSR role after a synthetic `/log` POST made with a minted test session (or recorded as
the operator's check if no session can be minted). Perceptual: the operator logs one workout on `/log`
and opens `/skills` on the desktop browser. It should look exactly as before.

D-123 trigger checked? **none** — no new identity, export or public route. Every new route is
authed and `private, no-store`. Cites D-470.
