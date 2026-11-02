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
started: 2026-11-02T18:42:31Z
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

- [x] No file under `app/`, `components/` or `lib/` imports `aws-amplify/data` (lint rule or grep
      test).
- [x] Each new route is exported through `withNoStore` and passes `check-route-cache-control.mjs`.
- [x] Each new route has a test: signed out → 404 (matching the middleware's API behaviour); signed
      in → the reads are keyed by the session uid, and a uid passed in the query or body is ignored.
- [x] Both POST routes refuse a foreign `Origin` (D-471) and do not invoke the Lambda.
- [x] `amplify/fog-delivery-read-grant.test.ts`-style synth tests pin the SSR role's new grants:
      read-only on the model tables it reads, and `lambda:InvokeFunction` on exactly the two
      functions.
- [x] `lib/security-headers.ts`'s `connect-src` no longer names the AppSync endpoint.
- [x] `08` §5.5's `defineData` bullet and `01` §1's "Client-facing data" row are amended, citing
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

## Resolution

Built by a wave agent in its own worktree (wave 1 of capability `19-authjs-migration`, beside
`0330`). Not yet deployed; the orchestrator closes it after the deploy and the smoke tests below.

**What changed.** The browser no longer has a path to AppSync (D-472). Every call the four
transports made through `generateClient` is now a same-origin `fetch` to a route handler that runs
as the SSR compute role and keys the read by `currentUserId()`, the pattern of `/api/fog` and
`/api/runs/*`. The transports keep their exported signatures, so no component changed. `/log` and
`/skills` are still static (`○` in the build's route table, D-282).

| Transport call (before: AppSync) | Now |
|---|---|
| `fetchSkills` (`SkillState.list`) | `GET /api/skills/state` |
| `fetchRecentLedger` (`byUserAndSeq`, newest 500) | `GET /api/skills/ledger` |
| `fetchSkillLedger` (`bySkill`) | `GET /api/skills/ledger?skill=<id>` |
| `fetchReplayInProgress` (`Profile.get`) | `GET /api/skills/profile` → `{ replayInProgress }` |
| `fetchLandmarks` / `fetchAllLandmarks` (`Landmark.list`) | `GET /api/skills/landmarks[?skill=<id>]` |
| `fetchActivityLedger` (`byActivity`) | `GET /api/runs/[activityId]/ledger` |
| `fetchActivityKind` (`Activity.get`) | `GET /api/runs/[activityId]/kind` → `{ activity }` |
| `sendLog` (`logWorkout` mutation) | `POST /api/log` → invokes `log-workout` |
| `setActivityKind` (mutation) | `POST /api/runs/[activityId]/kind` → invokes `set-activity-kind` |

The description named four transports and their headline calls. `SkillState.list` and
`Activity.get` were the transports' other two AppSync calls, and criterion 1 (no `aws-amplify/data`
import anywhere) required them to move too, so they got `/api/skills/state` and a `GET` on the kind
route. The design left route names to this ticket.

**Files.**
- Routes (new): `app/api/skills/{state,ledger,profile,landmarks}/route.ts`,
  `app/api/runs/[activityId]/{ledger,kind}/route.ts`, `app/api/log/route.ts`. All `withNoStore`,
  all `force-dynamic`. Tests: `app/api/skills/skills-routes.test.ts`,
  `app/api/runs/[activityId]/activity-routes.test.ts`, `app/api/log/route.test.ts`.
- Server readers (new): `lib/skills/server.ts`, `lib/runs/ledger-server.ts`, `lib/run-kind/server.ts`,
  on `lib/aws-server.ts` (`customOutput`, a module-scope document client, a paging `queryAll`).
  Test: `lib/skills/server.test.ts` (key conditions and filters carry the uid; paging; the
  activity-keyed reads are filtered on `userId` and never `Limit`ed, since DynamoDB applies `Limit`
  before a filter).
- Invoke (new): `lib/http/invoke-as-user.ts`. Builds `{ ...args, userId }` with `userId` last, so a
  body field cannot override it, and maps a handler error to the GraphQL-shaped
  `{ errors: [{ message }] }` the transports already parse: `REFUSED:` → 422, `BUSY:` → 503, anything
  else → 502 with a generic message (the detail is logged server-side, not returned).
- `lib/http/origin.ts` (the shared file, byte-identical to `0330`'s) and `lib/http/origin.test.ts`.
  `lib/http/json-body.ts` (16 KB bound, JSON-object check, `pick` of named fields),
  `lib/http/route-params.ts` (`notFound`, `badRequest`, `opaqueId`: a skill or activity id, bounded,
  no `#` so it cannot change a composite-key prefix), `lib/http/same-origin-json.ts` (the browser
  side: same-origin, `no-store`, inside `withApiTimeout`).
- Transports rewritten: `lib/log/transport.ts`, `lib/skills/transport.ts`,
  `lib/runs/ledger-transport.ts`, `lib/run-kind/transport.ts`. `lib/skills/wire.ts` (new) holds the
  paths and `LEDGER_ROWS` for both sides. `currentUid()` still reads `aws-amplify/auth`; that is
  `0332`'s.
- Lambdas: `amplify/functions/caller.ts` (new) + `caller.test.ts`; both handlers call `callerOf`.
- `amplify/backend.ts`: three statements on the SSR compute role and five `custom` outputs
  (`skillStateTableName`, `profileTableName`, `landmarkTableName`, `logWorkoutFunctionName`,
  `setActivityKindFunctionName`); `amplify_outputs.example.json` carries placeholders.
  Test: `amplify/ssr-model-read-grant.test.ts`.
- `lib/security-headers.ts` + test, `next.config.ts` comment: AppSync leaves `connect-src`.
- `lib/http/no-appsync-in-browser.test.ts`: the grep for criterion 1. A grep, not an ESLint rule,
  because the old transports used `await import()` and `typeof import()`, which
  `no-restricted-imports` does not see.
- `package.json`/`package-lock.json`: `@aws-sdk/client-lambda` moves from a dev-only transitive dep
  to a direct dependency, pinned at the 3.1121.0 already locked (`--package-lock-only`; npm also
  wrote eight `inBundle` entries it had been omitting).
- Docs: `01` §1's Client-facing data row and its capability-19 note; `08` §5.5's `defineData`
  bullet, rewritten with an amendment note. Both cite D-472.

**Decisions made here.**
- **Grants are `dynamodb:Query` only**, including for the two single-row reads (`Profile` by `id`,
  `Activity` by `id`): a `Query` on the hash key reads the same row, and the role already held
  `Query` on T3, so no `GetItem` was added. Statements `QueryXpLedgerForSkillsAndRunCard` (T4
  `byActivity`, `bySkill`) and `QueryModelTablesForSkills` (T2, T1, `Landmark` base tables), plus
  the existing `QueryActivityForLatestRun` and `QueryXpLedgerByUserAndSeqForRunTally`.
  `InvokeMutationFunctions` is `lambda:InvokeFunction` on the two function ARNs. The synth test pins
  all of it, including that no other statement on the role can invoke any Lambda and none grants
  `Scan`/`GetItem`/a write on a model table.
- **The handlers accept both event shapes until `0334`.** A direct invoke is `{ userId, ...args }`;
  an AppSync event is recognised by `arguments` and still yields `identity.sub`. Why keep it: the
  mutations stay compiled until `0334`, and a `/log` tab loaded before this deploy would otherwise
  send its queued entry through AppSync, get `REFUSED:NOT_OWNER`, and `lib/log/queue.ts` would drop
  it for good. A client cannot inject a top-level `userId` into an AppSync event (everything a
  client sends is under `arguments`), and an event with `arguments` never reads a top-level
  `userId`. `0334` deletes the branch with the mutations.
- **The POST bodies are picked, not passed through.** `/api/log` forwards exactly the SDL's five
  arguments; the kind route forwards only `kind` and takes `activityId` from the path. With AppSync
  gone from the path, the SDL no longer enforced "measured work only", so the route does.
- **Order in the POST routes:** Origin check, then session, then body. A foreign `Origin` is 403
  before anything is read or invoked; no `Origin` is served (per the shared file's reasoning).

**Not measured yet.** `/log`'s confirmation latency (Lambda invoke via the SSR compute replacing the
AppSync hop) needs the deploy; the post-deploy smoke test records it.

**Found, not fixed (another ticket's section).** `08` §5.3's Headers row still lists "the AppSync
endpoint" in `connect-src`. `0330` owns §5.3 in this wave, so it was left for the orchestrator to
amend at merge.

**Recorded at merge (orchestrator):** the three proposed decisions became **D-475**.
