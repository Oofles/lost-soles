# 01 — System Architecture

> ⚠️ **The interfaces below were superseded on 2026-08-30.** `01-architecture.md` and
> `03-integrations.md` were written in parallel and defined `Activity`/`Trace`/`SourceAdapter`
> independently, conflicting in eight places. The reconciled canonical contract lives in
> [`contracts/ingestion-contract.md`](contracts/ingestion-contract.md) — **that file wins.**
> The text here is retained for its surrounding reasoning.

**Project:** Lost Soles
**Status:** Design. No code exists. This document is what an implementer builds from.
**Date:** 2026-08-30
**Authority:** `docs/decisions/DECISIONS.md`. Every `D-xxx` cited here is settled and
user-confirmed. Nothing in this document may contradict it. Research backing lives in
`docs/research/` (R1, R3, R5, R8, R9, R10).

**Companion docs (not yet written):** `02-data-model.md`, `03-progression.md`,
`04-map-rendering.md`, `05-ingestion-adapters.md` (detail), `08-security-privacy.md`.

---

## Contents

1. [Stack decision](#1-stack-decision)
2. [AWS topology](#2-aws-topology)
3. [The adapter architecture](#3-the-adapter-architecture)
4. [Data flow — one activity, end to end](#4-data-flow--one-activity-end-to-end)
5. [Frontend architecture](#5-frontend-architecture)
6. [Environments and deploy](#6-environments-and-deploy)
7. [Secrets](#7-secrets)
8. [Cost model](#8-cost-model)
9. [Conventions](#9-conventions)
10. [Rejected alternatives](#10-rejected-alternatives)
11. [Known tensions](#11-known-tensions-the-decision-log-creates)

---

## 1. Stack decision

| Layer | Choice | Confirmed by |
|---|---|---|
| Hosting + CI/CD | **AWS Amplify Gen 2**, `soles.devaultsecurity.com` | D-080 |
| Framework | **Next.js 15, App Router**, SSR + route handlers | R5 (deliberate divergence from house Astro) |
| Auth | **Cognito** user pool, Essentials tier, email + passkey, self-signup OFF | R5 §3 |
| Client-facing data | **AppSync + DynamoDB** via `defineData` | R5 §4 |
| Machine-only data | **DynamoDB tables created through the CDK escape hatch** | §2 below |
| Object storage | **S3** via `defineStorage` (raw trace archive, `explored.bin`) | D-101, D-121.2 |
| Compute | **Lambda** — Node 22, pure-JS deps only | R5 §5 |
| Queue | **SQS** standard + DLQ, added via CDK | R5 topology |
| Basemap tiles | **pmtiles on Cloudflare R2** (zero egress) | R5 cost risk |
| Geo model | **H3 res 10 cells in DynamoDB**. No PostGIS, no VPC. | D-082, D-115, D-081 |

### Why Next.js and not Astro

The house stack at `devaultsecurity` is Astro 4 + SolidJS, static output, no SSR adapter.
Lost Soles needs auth-gated SSR, server route handlers (the Strava OAuth callback, the
future `/api/ingest`), and a React-ecosystem map component. Amplify Hosting supports
Next.js 12–15 with **no adapter and no Lambda packaging** — SSR, ISR, middleware,
`generateMetadata`, `next/image` all managed. Astro SSR on Amplify works only through a
**community-maintained** adapter and the `.amplify-hosting/deploy-manifest.json` spec. For
an app the user wants to still be building in two years, a community adapter on the deploy
path is the wrong risk. Next.js it is.

Amplify's Next.js support has three gaps worth knowing up front, none blocking:

- **No on-demand ISR** (`revalidatePath` / `revalidateTag` do not work). This matters here:
  a Strava webhook cannot invalidate a cached page. §4 and §5 design around it with an
  AppSync subscription plus client refetch.
- **No edge API routes.** Not needed.
- **No streaming / `unstable_after`.** Not needed.

### This is the user's first Gen 2 backend — what that means

R5 read the existing repo directly. `devaultsecurity` is:

- Astro 4 + SolidJS + Tailwind 3, static output, npm, unpinned Node.
- A **Gen 1, hosting-only `amplify.yml`** — 16 lines of the stock Astro static preset:
  `npm ci` → `npm run build`, artifacts from `dist`, cache `node_modules`. **No `backend:`
  phase, no `appRoot`, no headers/redirects block.**
- **No `amplify/` directory. No `backend.ts`. No `amplify_outputs.json`. No
  `team-provider-info.json`. No `aws-exports.js`. No `@aws-amplify/*` packages anywhere.**

So the account has Amplify Hosting pointed at a GitHub repo and nothing else. Everything
below is new territory for this user, and the plan must budget for it:

1. **The `amplify/` directory itself** — `backend.ts` plus `auth/`, `data/`, `storage/`,
   `functions/*/resource.ts`. TypeScript-defined infrastructure, not `amplify add`.
2. **`npx ampx sandbox`** — a personal, ephemeral cloud backend per developer, deployed on
   file save. There is no local emulator; the sandbox is real AWS resources. Expect the
   first `sandbox` run to take several minutes and to require bootstrapping CDK in the
   account (`cdk bootstrap`) once.
3. **A `backend:` phase in `amplify.yml`** running `npx ampx pipeline-deploy --branch
   $AWS_BRANCH --app-id $AWS_APP_ID`. The existing `amplify.yml` has none because there is
   no backend to deploy. This is a new file shape, not an edit of the old one.
4. **Secrets as a first-class concept** — `npx ampx sandbox secret set`, resolved by
   `secret()` at synth time from SSM Parameter Store, namespaced per branch. See §7.
5. **The CDK escape hatch.** Gen 2 backends *are* CDK. This project uses that fact in four
   specific places (§2). The user has never written CDK; those four places should be the
   only CDK in the codebase, and each one is documented inline.
6. **IAM blast radius.** A Gen 2 backend deploy creates roles, tables, buckets, and a
   CloudFormation stack per branch. Gen 1 hosting created essentially nothing. Deploys will
   now fail for IAM reasons that never came up before.

Two Gen-2-era facts that make this the right time: Gen 1 entered maintenance mode
**2026-05-01** and reaches **end of life 2027-05-01**, and Gen 1 and Gen 2 **cannot be mixed
in one app**. Lost Soles is a new app, so there is nothing to migrate — but it also means
the existing `devaultsecurity` app stays exactly as it is. Two Amplify apps, one Route 53
hosted zone, different subdomains. That is explicitly supported (§6).

---

## 2. AWS topology

### Hard constraints this topology exists to satisfy

- **D-081 — no VPC-attached Lambdas.** `defineFunction` does not expose VPC config, and you
  do not want it. A Lambda that needs both a VPC (to reach RDS/Aurora) *and* the public
  internet (to call Strava) requires a **NAT Gateway at ~$0.045/hr ≈ $33/month** before a
  byte moves — roughly **10× the entire target budget** (D-083). This single fact rules out
  Aurora, RDS, and anything else that lives in a subnet. Every Lambda here is
  internet-facing and VPC-free.
- **D-082 — no Postgres/PostGIS.** Explored territory is H3 cells in DynamoDB. It is a set
  of discrete integers, not arbitrary geometry, and R3's volume math (§below) says the whole
  thing fits in a browser tab.
- **D-083 — a few dollars a month.** Every resource below is chosen because it is free or
  near-free at 1–5 users.

### Component diagram

```
                       ┌──────────────────┐
   Strava ────POST────▶│ Lambda Function  │   authType: NONE, 128 MB, 3 s timeout
   (webhook)  <2 s ack │ URL              │   GET  = hub.challenge echo
                       │ strava-webhook   │   POST = verify → dedupe → SQS → 200
                       └────────┬─────────┘
                                │ SendMessage
                                ▼
                       ┌──────────────────┐
                       │ SQS              │──── on failure ──▶ ActivityIngestDLQ
                       │ ActivityIngest   │
                       └────────┬─────────┘
                                │ event source (batchSize 1)
                                ▼
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ Lambda process-activity   2048 MB · 900 s · Node 22 · no VPC              │
  │   fetch raw ─▶ archive to S3 ─▶ normalize ─▶ H3 res 10 ─▶ diff ─▶ XP      │
  └──┬────────────┬──────────────┬───────────────┬──────────────┬─────────────┘
     │            │              │               │              │
     │ https      │ PutObject    │ Batch RW      │ Query/Update │ GraphQL mutation
     ▼            ▼              ▼               ▼              ▼
  Strava      ┌────────┐   ┌────────────┐  ┌───────────┐  ┌──────────────┐
  API v3      │ S3     │   │ DDB        │  │ DDB       │  │ AppSync      │
  (internet)  │ storage│   │ Explored   │  │ Source-   │  │ + DDB models │
              │ bucket │   │ Cell       │  │ Account   │  │ (Amplify     │
              └───┬────┘   │ Ingest     │  │ (tokens)  │  │  Data)       │
                  │        │ Receipt    │  └───────────┘  └──────┬───────┘
                  │        └────────────┘                        │
                  │                                     subscription (wss)
                  ▼                                              │
       users/<uid>/explored-r10.bin                              │
                  │  presigned GET                               │
                  ▼                                              ▼
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ Amplify Hosting compute — Next.js 15 App Router                           │
  │   SSR shell · /api/strava/callback · (post-MVP) /api/ingest               │
  │   soles.devaultsecurity.com  ·  ACM cert  ·  Route 53 (existing zone)     │
  └───────────────────────────┬───────────────────────────────────────────────┘
                              │  Cognito session (Essentials, passkey)
                              ▼
                       Browser: MapLibre GL + Set<h3Cell> in memory
                              │
                              └── HTTP range GETs ──▶ Cloudflare R2 (pmtiles, $0 egress)

  Scheduled (EventBridge, no VPC):
    token-refresh     every 4 h   → refresh Strava tokens nearing expiry
    nightly-reconcile every day   → poll for activities the webhook dropped
```

### Resource table

Every resource, what it does, and what would make it cost money.

| # | Resource | Logical name | Created by | Purpose | Cost driver |
|---|---|---|---|---|---|
| 1 | Amplify Hosting app | `lost-soles` | Console + `amplify.yml` | Next.js SSR, CDN, CI/CD, auto-SSL | Build minutes; SSR requests; **data transfer out @ $0.15/GB after 15 GB** |
| 2 | Cognito user pool | `defineAuth` | `amplify/auth/resource.ts` | Identity. Email + passkey. `allowUnauthenticatedIdentities: false`, self-signup disabled | MAU (10,000 free, non-expiring) |
| 3 | Cognito identity pool | `defineAuth` | same | S3 `entity('identity')` scoping | Always free |
| 4 | AppSync GraphQL API | `defineData` | `amplify/data/resource.ts` | Client-facing reads/writes + **real-time subscriptions** | $4.00/M ops; $2.00/M real-time updates |
| 5 | DynamoDB (Amplify-managed) | `Profile`, `Skill`, `Activity`, `WorkoutEntry`, `Region`, `Ticket` | `defineData` models | Game state the client reads | WRU $0.625/M, RRU $0.125/M, 25 GB free storage |
| 6 | DynamoDB (CDK) | `LostSolesExploredCell` | `backend.createStack` | H3 res-10 cell set. `PK = U#<uid>#C#<res6parent>`, `SK = <res10cell>` | WRU — ~80–130 writes/run |
| 7 | DynamoDB (CDK) | `LostSolesSourceAccount` | `backend.createStack` | Per-user OAuth access/refresh tokens + `expiresAt`. **Not in AppSync.** | Negligible |
| 8 | DynamoDB (CDK) | `LostSolesIngestReceipt` | `backend.createStack` | Idempotency ledger. `PK = ingestKey`, TTL 90 d | Negligible |
| 9 | S3 bucket | `defineStorage` → `lost-soles-storage` | `amplify/storage/resource.ts` | Raw trace archive (D-101, D-121.2), `explored-r10.bin`, aggregates | $0.023/GB-mo; PUT $0.005/1k |
| 10 | SQS queue + DLQ | `ActivityIngestQueue`, `ActivityIngestDLQ` | `backend.createStack` | Decouples the 2-second webhook ack from a multi-second fetch+normalize | 1M requests/mo free |
| 11 | Lambda | `strava-webhook` | `defineFunction` + CDK Function URL | GET handshake, POST enqueue. 128 MB, 3 s | 1M req + 400k GB-s free |
| 12 | Lambda Function URL | on #11 | **CDK escape hatch** | Public HTTPS endpoint, `authType: NONE` | Free (no API Gateway) |
| 13 | Lambda | `process-activity` | `defineFunction` | The pipeline. 2048 MB, 900 s, SQS event source | GB-seconds |
| 14 | Lambda | `token-refresh` | `defineFunction`, `schedule: 'every 4h'` | Refresh Strava tokens before expiry | Negligible |
| 15 | Lambda | `nightly-reconcile` | `defineFunction`, `schedule: 'every day'` | Backstop poll — catches anything the webhook lost | Negligible |
| 16 | EventBridge rules | auto | `schedule` on #14/#15 | Cron | Free at this volume |
| 17 | SSM Parameter Store | `/amplify/<app-id>/<branch>-branch-<hash>/*` | `secret()` | Static secrets (§7) | Standard params free |
| 18 | ACM certificate | Amplify-managed | Domain association | TLS for `soles.devaultsecurity.com` | Free |
| 19 | Route 53 hosted zone | `devaultsecurity.com` | **Already exists** | DNS. Do NOT create a second zone | $0 marginal |
| 20 | Cloudflare R2 bucket | `lost-soles-tiles` | Outside AWS | pmtiles basemap, fetched by HTTP range from the browser | **$0 egress** — that is the entire reason it exists |

Deliberately **absent**: VPC, NAT Gateway, RDS/Aurora, RDS Proxy, API Gateway, ECS/Fargate,
WAF ($15/mo/app), Secrets Manager ($0.40/secret/mo), any tile server, any always-on compute.

### Why the cell store is not an Amplify Data model

`ExploredCell`, `SourceAccount`, and `IngestReceipt` are created as raw CDK
`dynamodb.Table` constructs, not `defineData` models. Three reasons:

1. **The client never queries cells.** It downloads `explored-r10.bin` from S3 once per
   session and does every query in memory (§5). Putting the cell table behind AppSync would
   add $4.00/M operations for a path nobody uses.
2. **Tokens must not be reachable from a client-authenticated GraphQL API at all.** No auth
   rule is safer than no API. Only `process-activity` and `token-refresh` get IAM grants.
3. **Write volume is machine-generated.** ~100 conditional writes per run from one Lambda.
   AppSync resolvers add latency and cost with no benefit.

Everything the *client* reads — profile, skills, XP, activity list, workout log — stays in
`defineData`, where declarative `allow.owner()` rules and real-time subscriptions earn their
cost.

### The CDK escape hatch — where and why

Amplify Gen 2 backends are AWS CDK. `defineBackend()` returns an object exposing every
generated construct, and `backend.createStack(name)` creates an arbitrary nested
CloudFormation stack. AWS is explicit that **you own the correctness and security of
anything added this way** — Amplify will not validate it. Keep it to these four uses:

```ts
// amplify/backend.ts
import { defineBackend } from "@aws-amplify/backend"
import { FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda"
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources"
import * as sqs from "aws-cdk-lib/aws-sqs"
import * as ddb from "aws-cdk-lib/aws-dynamodb"
import { Duration, RemovalPolicy } from "aws-cdk-lib"

const backend = defineBackend({
  auth, data, storage,
  stravaWebhook, processActivity, tokenRefresh, nightlyReconcile
})

// (1) ESCAPE HATCH — Function URL. defineFunction has no `url` property.
//     This is the 2-second-ack endpoint. See "Strava's 2-second deadline" below.
const webhookUrl = backend.stravaWebhook.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE
})

const custom = backend.createStack("LostSolesCustom")

// (2) ESCAPE HATCH — SQS. Amplify has no queue primitive.
const dlq = new sqs.Queue(custom, "ActivityIngestDLQ", {
  retentionPeriod: Duration.days(14)
})
const queue = new sqs.Queue(custom, "ActivityIngestQueue", {
  visibilityTimeout: Duration.minutes(16),          // > processActivity's 15 min timeout
  deadLetterQueue: { queue: dlq, maxReceiveCount: 3 }
})
backend.processActivity.resources.lambda.addEventSource(
  new SqsEventSource(queue, { batchSize: 1 })       // one activity per invocation
)
queue.grantSendMessages(backend.stravaWebhook.resources.lambda)

// (3) ESCAPE HATCH — machine-only tables, deliberately outside AppSync.
const exploredCell = new ddb.Table(custom, "ExploredCell", {
  partitionKey: { name: "pk", type: ddb.AttributeType.STRING },
  sortKey:      { name: "sk", type: ddb.AttributeType.STRING },
  billingMode:  ddb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN,              // D-020: the map only ever grows
  pointInTimeRecovery: true
})
const ingestReceipt = new ddb.Table(custom, "IngestReceipt", {
  partitionKey: { name: "ingestKey", type: ddb.AttributeType.STRING },
  billingMode:  ddb.BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "ttl"
})
// + SourceAccount, same shape.

// (4) Surface what the frontend and functions need.
backend.addOutput({ custom: {
  activityQueueUrl: queue.queueUrl,
  stravaWebhookUrl: webhookUrl.url
}})
```

Grants (explicit, least-privilege — Amplify grants nothing to CDK-created tables for you):

```ts
exploredCell.grantReadWriteData(backend.processActivity.resources.lambda)
ingestReceipt.grantReadWriteData(backend.processActivity.resources.lambda)
ingestReceipt.grantReadWriteData(backend.stravaWebhook.resources.lambda)
sourceAccount.grantReadWriteData(backend.processActivity.resources.lambda)
sourceAccount.grantReadWriteData(backend.tokenRefresh.resources.lambda)
// strava-webhook gets NO access to sourceAccount or exploredCell. It only enqueues.
```

### Strava's 2-second deadline — the precise design

Strava requires the subscription `POST` be acknowledged **within 2 seconds** or it retries
and eventually disables the subscription. The endpoint is therefore a **dedicated Lambda
behind a Function URL**, not a Next.js route handler:

- **Why not a Next.js route handler.** Amplify Hosting compute cold starts on an SSR bundle
  that carries React, the map libraries' server halves, and the whole App Router runtime.
  A cold start on that bundle can plausibly exceed 2 seconds. It also **redeploys every time
  the frontend deploys**, so a routine UI change can drop a webhook. Unacceptable for the
  one endpoint with a hard external SLA.
- **Why a Function URL and not API Gateway.** Function URLs are free, add no hop, and need
  no custom domain. API Gateway costs $1.00–3.50/M requests and buys throttling and WAF
  features this app does not need.
- **Why `authType: NONE`.** Strava cannot sign requests or present IAM credentials. Auth is
  in-band: the `hub.verify_token` on the GET handshake, and on POST an `owner_id` →
  `SourceAccount` lookup that discards events for unknown athletes. The endpoint is public;
  treat it as such — it does no work an attacker can weaponise beyond enqueuing a job for an
  athlete ID we already know, and the idempotency ledger (§4) bounds even that.
- **What the handler does, and nothing more** (target p99 well under 500 ms):

```
GET  ?hub.mode=subscribe&hub.challenge=X&hub.verify_token=T
     → constant-time compare T against secret("STRAVA_WEBHOOK_VERIFY_TOKEN")
     → 200 { "hub.challenge": X }

POST { object_type, object_id, aspect_type, owner_id, event_time, subscription_id }
     → if object_type !== "activity" → 200, drop
     → if aspect_type === "delete"   → 200, enqueue a tombstone job (never delete cells: D-020)
     → ingestKey = sha256(`strava:${owner_id}:${object_id}:${aspect_type}`)
     → ConditionalPut IngestReceipt {ingestKey, status:"QUEUED"}  if attribute_not_exists
     →   on ConditionalCheckFailed → 200 immediately (replay; already handled)
     → SendMessage to ActivityIngestQueue
     → 200
```

No Strava API call, no token refresh, no S3, no h3 import. The handler bundle should be
a few kilobytes. **All slow work happens after the ack, in `process-activity`.**

### The 15-minute wall

`process-activity` is capped at Lambda's 900 s maximum. For MVP that is enormous headroom —
R3 measures a 5-mile run at ~80–130 res-10 cells and the whole regeneration of
`explored.bin` at under 100 ms even at the 5-year worst case. The wall only becomes real for
two post-MVP features, both explicitly out of MVP scope (D-122): OSM map-matching over a
metro extract, and the routing engine. Those are container workloads (OSRM/Valhalla need
multi-GB extracts and GB of resident RAM) and cannot live in Amplify under any
configuration. See §11.

---

## 3. The adapter architecture

> **D-100.** Ingestion is source-agnostic. The internal contract is a normalized `Activity`
> + `Trace`. Every source — Strava, Health Connect, GPSLogger, a watch vendor, a file
> upload, manual entry — is an **adapter** behind that contract.
>
> **D-121.** MVP ingestion is the Strava API adapter, with non-negotiable mitigations:
> Strava lives strictly behind the boundary; **every raw trace is archived to S3 at ingest**;
> `activity:read_all` scope; the full `latlng` stream, never `summary_polyline`.

The rationale is not aesthetic. Every surviving app in this category is multi-source
(Wandrer 4 sources, CityStrides 7, Dawarich file-import, Fog of World never used Strava).
StatsHunters is the only single-source app in the category and the most fragile. An app that
promises the user a **permanent** map (D-020) must not depend on a party that reserves the
right to force deletion in 30 days. And per D-121, the practical risk is the athlete cap —
apps downgraded 9,999→1 without notice, nobody graduating past 10 athletes since
2026-06-01 — which bites the moment friends are added (D-014).

The boundary also does something quieter and more valuable: it makes **D-103** true. The
watch purchase (D-117) stops being a blocking architectural decision and becomes a
shopping decision, because a new device is a new directory under `src/adapters/`.

### Module layout — the boundary is a directory boundary

```
src/
  domain/                 ← NO source-specific type may appear anywhere in here.
    activity.ts             Activity, Trace, GeoPoint, ActivityKind
    ids.ts                  AdapterId, ActivityId, UserId
    xp.ts                   XP + discovery-credit rules (D-120)
    fog.ts                  trace → H3 cells, set diff
  pipeline/               ← Orchestration. Imports domain/ and the registry. Never an adapter.
    processActivity.ts
    archive.ts
    persist.ts
  adapters/
    types.ts                SourceAdapter<TCreds>, IngestJob, RawArchiveRef
    registry.ts             the ONLY file that names concrete adapters
    strava/                 ← MVP.  Swapping the primary source replaces this directory.
      adapter.ts
      client.ts             Strava HTTP, token refresh
      types.ts              Strava's wire shapes. NOTHING outside this directory imports it.
      normalize.ts          pure: streams JSON → { activity, trace }
      __fixtures__/         checked-in real responses
    gpslogger/              ← post-MVP (D-112)
    health-connect/         ← post-MVP (D-113)
    manual/                 ← in MVP for strength work (D-060/D-061); no Trace
```

### The domain contract

`src/domain/activity.ts` — this file is the contract. It has no imports from `adapters/`.

```ts
/** Which adapter produced this. An opaque tag; the domain never branches on it. */
export type AdapterId =
  | "strava"
  | "gpslogger"
  | "health-connect"
  | "file-upload"
  | "manual"
  | (string & {})           // widened: adding a source must not require editing the domain

export type ActivityKind =
  | "run" | "walk" | "hike" | "ride"
  | "strength"                                   // D-060: reps/sets, no Trace
  | "other"

/** One GPS sample. The only geospatial primitive the domain knows. */
export interface GeoPoint {
  /** WGS84 degrees. */
  lat: number
  lng: number
  /** Epoch milliseconds, UTC. Absolute, never relative to activity start. */
  t: number
  /** Metres. Present only if the source provides it — never synthesised. */
  altM?: number
  /** Horizontal accuracy, metres. Used to reject junk samples. Absent = unknown, not zero. */
  accuracyM?: number
}

/**
 * A trace is an ordered, de-duplicated, monotonic-in-time point list.
 * Adapters guarantee those three properties; the pipeline asserts them.
 */
export interface Trace {
  points: GeoPoint[]
  /**
   * Ordered [startIndex, endIndex] pairs marking gaps > GAP_THRESHOLD_MS
   * (tunnel, pause, signal loss). The fog renderer must not draw a corridor
   * across a gap, and distance must not be summed across one.
   */
  gaps: Array<[number, number]>
  /** True if the source is known to be lossy/simplified. Strava summary_polyline would be
   *  true — which is exactly why D-121.4 forbids using it. */
  simplified: boolean
}

/** Pointer to the immutable raw bytes archived at ingest. D-101, D-121.2. */
export interface RawArchiveRef {
  bucket: string
  /** raw/<uid>/<adapterId>/<externalId>/<sha256>.<ext> */
  key: string
  contentType: string
  bytes: number
  sha256: string
  archivedAt: string        // ISO 8601
}

/** Where it came from. The ONLY place a source is named in the domain. */
export interface SourceRef {
  adapter: AdapterId
  /** Opaque to the domain. Strava activity id, HC record uuid, GPSLogger session id, uuid. */
  externalId: string
  fetchedAt: string
  /** Free-form, never read by domain logic. For debugging and future backfill only. */
  meta?: Readonly<Record<string, string | number | boolean>>
}

export interface Activity {
  /** sha256(`${userId}:${adapter}:${externalId}`). Stable across re-ingest. */
  activityId: string
  userId: string
  kind: ActivityKind
  /** ISO 8601 with offset — the local offset matters for "which day did I run". */
  startedAt: string
  elapsedS: number
  movingS?: number
  /** Metres, from the source if given, else computed from the Trace. */
  distanceM?: number
  elevationGainM?: number
  /** Free-text title from the source. Display only. */
  name?: string
  source: SourceRef
  raw: RawArchiveRef
  /** D-060/D-062: present only for kind === "strength". Sets modelled from day one. */
  sets?: Array<{ exercise: string; reps?: number; durationS?: number; weightKg?: number }>
}

/** What an adapter hands the pipeline. Nothing else crosses the boundary. */
export interface NormalizedIngest {
  activity: Activity
  /** Absent for strength/manual entries. */
  trace?: Trace
}
```

### The adapter interface

`src/adapters/types.ts`:

```ts
import type { AdapterId, NormalizedIngest, RawArchiveRef } from "@/domain/activity"

/** What the webhook/endpoint layer produces and the queue carries. Serialisable. */
export interface IngestJob {
  ingestKey: string          // idempotency key, computed at accept()
  userId: string
  adapter: AdapterId
  externalId: string
  /** Adapter-private hints (aspect_type, a point batch, an S3 key of an uploaded file). */
  payload: unknown
  enqueuedAt: string
}

export interface AckResult {
  /** HTTP status and body to return to the source, immediately. */
  status: number
  body?: unknown
  /** Zero or more jobs to enqueue. Empty = accepted and intentionally dropped. */
  jobs: IngestJob[]
}

export interface SourceAdapter<TCreds = unknown> {
  readonly id: AdapterId

  /**
   * PHASE 1 — runs in the public endpoint. Latency-critical (Strava: <2 s).
   * Must NOT call the source API, refresh tokens, or touch S3.
   * Pure validation + job construction.
   */
  accept(req: InboundRequest): Promise<AckResult>

  /**
   * PHASE 2 — runs in process-activity. May call the network.
   * Returns the raw bytes EXACTLY as the source gave them. No transformation.
   * The pipeline archives these to S3 before normalize() is ever called (D-121.2).
   */
  fetchRaw(job: IngestJob, creds: TCreds): Promise<{ body: Buffer; contentType: string; ext: string }>

  /**
   * PHASE 3 — PURE. No network, no AWS SDK, no clock, no randomness.
   * This is the seam. It is unit-testable from a checked-in fixture with zero mocking,
   * and it is the only place a source's wire format is understood.
   */
  normalize(raw: Buffer, ref: RawArchiveRef, job: IngestJob): NormalizedIngest

  /** Optional: refresh rotating credentials. Called by token-refresh. */
  refreshCredentials?(creds: TCreds): Promise<TCreds>

  /** Optional: enumerate historical activities for backfill from the S3 archive or the source. */
  listHistorical?(userId: string, since: string, creds: TCreds): AsyncIterable<IngestJob>
}
```

`src/adapters/registry.ts` — **the one file that names concrete adapters**:

```ts
import { stravaAdapter } from "./strava/adapter"
import { manualAdapter } from "./manual/adapter"

export const adapters = {
  strava: stravaAdapter,
  manual: manualAdapter
} as const satisfies Record<string, SourceAdapter<never>>

export const PRIMARY_ADAPTER: AdapterId = "strava"   // D-121. One line.
```

### How each source plugs into the same contract

**Strava (MVP, D-121).** Function URL → `accept()` validates `hub.verify_token` / builds a
job from `{owner_id, object_id, aspect_type}`. `fetchRaw()` refreshes the token from
`SourceAccount` if needed, then `GET /activities/{id}` plus
`GET /activities/{id}/streams?keys=latlng,time,altitude&key_by_type=true` with
**`activity:read_all` scope (D-121.3)** — `activity:read` returns privacy-zone-truncated
traces that would permanently blank the map around home, which is unrecoverable under D-020.
It returns the concatenated JSON verbatim. `normalize()` zips `latlng[i]` with
`time[i]` (Strava's `time` stream is **seconds since start** — add it to `start_date` to get
absolute `t`), sets `simplified: false`, and marks gaps where consecutive `time` deltas
exceed the threshold. **`summary_polyline` is never touched (D-121.4)** — it is
Douglas-Peucker simplified to ~100–300 points against ~2,700 in the stream, cutting corners
and collapsing loops to chords.

**GPSLogger over HTTP (D-112).** No webhook — GPSLogger POSTs directly to
`POST /api/ingest` (a Next.js route handler; latency-tolerant, no 2-second SLA) behind a
static bearer token. Two body shapes, both supported by GPSLogger's "Custom URL" and
"HTTP POST of the finished file" features: a finished **GPX document**, or **per-point JSON**
from a body template. `accept()` writes the body to a staging S3 key and returns a job
pointing at it — the endpoint stays fast and the raw bytes are already durable.
`fetchRaw()` reads that key back. `normalize()` parses GPX `<trkpt lat lon><ele><time>` or
the JSON batch into `GeoPoint[]`. In continuous mode, a session boundary is a gap over
`SESSION_GAP_MS`, so one POST can yield several `Activity` records. Note the bonus R10
flags: run continuously, it reveals every street *walked*, not just run.

**Health Connect bridge (D-113, preferred long-term).** A sideloaded ~400-line Kotlin app
(D-114 — sideloading removes the Play health declaration, the background-location demo
video, and the yearly target-SDK deadline) reads `ExerciseSessionRecord` +
`ExerciseRoute`, whose `Location` carries lat/lng/altitude/accuracy/timestamp per point —
i.e. **already the shape of `GeoPoint`**. It POSTs to the same `/api/ingest` with
`adapter: "health-connect"`. `normalize()` is close to an identity function. Constraints
that belong in the adapter, not the domain: reads are capped to the last 30 days without
`READ_HEALTH_DATA_HISTORY`, and background reads of another app's route always return
`ConsentRequired`, so sync is on app-open rather than silent. Neither fact escapes the
adapter directory. **Blocked on O-004** — does Strava write *routes*, not just summary
sessions, to Health Connect? Not blocking MVP.

**A watch vendor (D-117, deferred indefinitely).** Suunto and Polar both expose webhooks;
the shape is identical to Strava — a Function URL or `/api/ingest` route, `accept()`,
`fetchRaw()` against the vendor API, `normalize()` from FIT or the vendor's JSON. Garmin's
developer API is closed (D-116) and the `garth` workaround died 2026-03-27 to Cloudflare TLS
fingerprinting, so a Garmin purchase means the file-upload adapter, not an API adapter.
**Because of D-100 this decision does not touch the architecture.** That is the point.

**Manual entry (in MVP, D-060/D-061).** Strength work — pushups, situps, planks — has no
API anywhere that exposes reps or sets. Not Strava, not Whoop, not Fitbit. This is forced,
not chosen. The manual adapter has no `fetchRaw` network call: the "raw" archived artifact
is the submitted form payload as JSON, so even hand-entered data has an immutable record.
It emits `kind: "strength"` with `sets`, and **no `Trace`** — which is precisely why `trace`
is optional on `NormalizedIngest` rather than a required empty array.

**File upload (repair hatch).** GPX/FIT/TCX from a Strava bulk export or a watch. R10 kills
the tempting share-sheet path: `share_target` works, but **Strava has no GPX export in its
mobile app at all** (website only), so the flow imagined in Round 2 would have required a
desktop after every run. Build it anyway as the backfill and repair path — it is half a day,
and it is what turns the S3 archive into a recovery mechanism.

### The test that proves the boundary is right

Not a design intention. Four checks, all mechanical, all in CI:

**T1 — No Strava-shaped type in the domain.** A grep gate:

```bash
# fails the build on any hit
rg -n --ignore-case 'strava|polyline|athlete|activity:read|hub\.challenge' \
   src/domain src/pipeline && exit 1 || exit 0
```

Reinforced by an ESLint `no-restricted-imports` rule making `src/adapters/*/**` unreachable
from `src/domain/**` and `src/pipeline/**` — the pipeline may import `adapters/types.ts` and
`adapters/registry.ts`, never a concrete adapter's internals.

**T2 — Swapping the primary source touches exactly one module.** The acceptance criterion,
stated as a diff constraint: replacing Strava with GPSLogger as the primary source must
produce a diff confined to

- `src/adapters/gpslogger/` (added), and
- **one line** in `src/adapters/registry.ts` (`PRIMARY_ADAPTER`).

Zero lines in `src/domain/`, `src/pipeline/`, `src/components/`, the DynamoDB schema, or the
XP rules. If a swap requires touching a fifth file, the boundary is in the wrong place and
the architecture is wrong. **Write this test before writing the Strava adapter**, using the
manual adapter as the second implementation so there are always two from day one — a
contract with one implementation is not a contract.

**T3 — Cross-adapter equivalence.** The same physical run, ingested from two sources (a
Strava streams fixture and the GPX of the same activity), must produce the **same H3 res-10
cell set** within a small symmetric-difference tolerance for endpoint truncation. This
catches unit errors, timestamp-base errors, and lat/lng ordering — the three bugs that
otherwise silently corrupt a permanent, append-only map.

**T4 — `normalize()` is pure.** Each adapter's normalize is called in a test with no network
and no AWS SDK available, from a checked-in fixture, and asserted against a snapshot. If it
needs a mock, it is doing work that belongs in `fetchRaw()`.

### D-121 mitigation: archive raw before normalize

**Every raw trace is written to S3 before normalization runs.** In the pipeline this is
ordered, not concurrent, and the archive PUT must succeed before `normalize()` is called:

```
fetchRaw()  →  PutObject raw/<uid>/<adapter>/<externalId>/<sha256>.json  →  normalize()
```

Rules:

- **Verbatim bytes.** Whatever the source returned, unmodified. No pretty-printing, no
  field-stripping, no re-encoding. The `sha256` in the key makes the object
  content-addressed and the write naturally idempotent.
- **Immutable.** S3 Object Lock is unnecessary at this scale, but the bucket policy denies
  `DeleteObject` on `raw/*` to every principal except an explicit break-glass role, and
  versioning is on. D-101 makes these the system of record; anything API-sourced is
  reproducible or replaceable, never the only copy.
- **Self-describing.** Object metadata carries `adapter`, `externalId`, `userId`,
  `schemaHint`, and the app version, so a backfill five years from now can identify what it
  is looking at without a database.
- **Why it matters.** When the user moves to owned hardware (D-117) — or if Strava's athlete
  cap bites (D-121) — the replacement adapter's `listHistorical()` reads `raw/` and replays
  the entire history through the *new* normalize. Nothing is lost when the hardware changes.
  Without this, a re-normalization (say, an H3 resolution change, or a bug fix in gap
  detection) would be impossible and the permanent map would be permanently wrong.

Archive volume is trivial: R3 measures ~15 KB gzipped per run, 208 runs/year → **~40 MB over
five years**, about **$0.001/month**.

---

## 4. Data flow — one activity, end to end

The user finishes a run. Strava's app uploads it. Then:

| # | Hop | AWS service | Detail |
|---|---|---|---|
| 1 | Strava POSTs the event | — | `{object_type:"activity", object_id, aspect_type:"create", owner_id, event_time}`. **Must be acked in <2 s.** |
| 2 | Endpoint receives | **Lambda Function URL** → `strava-webhook` (128 MB) | `authType: NONE`. `accept()` validates shape, ignores non-activity objects. |
| 3 | Dedupe | **DynamoDB** `IngestReceipt` | `ingestKey = sha256("strava:<owner_id>:<object_id>:<aspect_type>")`. `PutItem` with `ConditionExpression: attribute_not_exists(ingestKey)`. On `ConditionalCheckFailedException` → return 200 and stop. **This is the replay gate.** |
| 4 | Enqueue | **SQS** `ActivityIngestQueue` | `SendMessage` carrying the `IngestJob`. |
| 5 | Ack | — | `200` returned. Steps 2–5 target **p99 < 500 ms**. Nothing above touches Strava's API. |
| 6 | Dequeue | **SQS → Lambda** `process-activity` (2048 MB, 900 s, `batchSize: 1`) | Standard SQS is at-least-once, so step 12 re-checks the receipt. |
| 7 | Credentials | **DynamoDB** `SourceAccount` | Read `{accessToken, refreshToken, expiresAt}` for `owner_id`. If `expiresAt` is within 5 min, refresh inline via `refreshCredentials()` and write back. |
| 8 | Fetch raw | **Internet → Strava API v3** (no VPC — D-081) | `GET /activities/{id}` + `GET /activities/{id}/streams?keys=latlng,time,altitude&key_by_type=true`, scope `activity:read_all` (D-121.3). Never `summary_polyline` (D-121.4). |
| 9 | **Archive raw** | **S3** `raw/<uid>/strava/<id>/<sha256>.json` | **D-121.2. Happens before any parsing.** Verbatim bytes, content-addressed, versioned, delete-denied. If this PUT fails, the message goes back to the queue — we never normalize data we have not archived. |
| 10 | Normalize | in-process, **pure** | `stravaAdapter.normalize(raw, ref, job)` → `{ activity, trace }`. First and last point where a Strava wire type exists. |
| 11 | Trace → cells | in-process, `h3-js` (pure JS, bundles cleanly) | `latLngToCell(p.lat, p.lng, 10)` per sample, `k=0`, deduped. **Resolution 10 (D-115)** — R4's soft-disc splatting means hex geometry never appears visually, so res 11's 4.4× data cost buys nothing. A 5-mile run is **~80–130 cells**. No cell is emitted across a `gaps` interval. |
| 12 | Idempotency re-check | **DynamoDB** `IngestReceipt` | `UpdateItem ... SET status="PROCESSING" ... ConditionExpression: status = "QUEUED"`. A redelivered message loses this race and exits **before any XP is written**. |
| 13 | Diff against explored | **DynamoDB** `ExploredCell`, `BatchGetItem` | Read the ~80–130 candidate cells (`PK = U#<uid>#C#<res6parent>`, `SK = <res10cell>`; res-6 parents keep it to a handful of partitions). Partition each candidate into `new` / `stale` / `fresh` by `lastRunAt` — see below. |
| 14 | Score XP | in-process, `src/domain/xp.ts` | Deterministic pure function of `(cells, distanceM, kind, now)`. Server-side only: **never let the client claim XP.** |
| 15 | Persist | **DynamoDB** `TransactWriteItems` | Atomic: `Activity` record + `Skill` XP increments + `IngestReceipt` → `status="DONE"` guarded by `status = "PROCESSING"`. Cell upserts follow via `BatchWriteItem` (idempotent by construction). |
| 16 | Regenerate the blob | **S3** `users/<uid>/explored-r10.bin` + `explored-agg.json` | Delta-varint-encoded sorted cell IDs, gzipped. <100 ms even at the 5-year worst case. Written with a fresh ETag. |
| 17 | Notify | **AppSync mutation → subscription over WebSocket** | `process-activity` calls an IAM-authed mutation on `Activity`; the browser holds `onCreateActivity` / `onUpdateProfile` subscriptions and refetches. **This exists because Amplify does not support on-demand ISR** — there is no `revalidatePath` to call from a webhook. |
| 18 | Client updates | Browser | Refetch `explored-r10.bin` (ETag-conditional), rebuild the `Set`, redraw the fog. |

### Fog and XP scoring (D-120) — why cells carry a timestamp, not a bit

D-120 is final and supersedes the provisional D-022. **The map never re-fogs**; revealed
ground is visible forever (D-020). What re-arms is *discovery credit*:

| Cell state at ingest | Discovery credit (Cartography) | Activity-skill XP (Wayfaring) |
|---|---|---|
| Not in `ExploredCell` — genuinely new | **100%** | full rate |
| Present, `lastRunAt` **within 6 months** | **0%** | **50%** (D-120) |
| Present, `lastRunAt` **more than 6 months ago** | **50%** — re-armed | **50%** (D-120) |

> "Rewards returning to a long-neglected part of town without ever making it as valuable as
> genuinely new ground." — D-120

The data-model implication is stated in the decision itself: **each explored cell needs a
`lastRunAt` timestamp, not just a presence bit**, and discovery scoring is a function of
`now - lastRunAt`. So the item is:

```
PK: U#<uid>#C#<res6ParentCellId>
SK: <res10CellId>
    firstSeenAt   ISO 8601   -- never mutated. D-020: the map only grows.
    firstRunId    string     -- provenance
    lastRunAt     ISO 8601   -- MUTATED on every visit. The D-120 clock.
    visitCount    number     -- ADD 1
```

The write is `UpdateItem` with `SET lastRunAt = :now, firstSeenAt = if_not_exists(firstSeenAt, :now), firstRunId = if_not_exists(firstRunId, :rid) ADD visitCount :one`.
`firstSeenAt` is immutable by construction; the D-120 clock is a separate attribute. A
presence-bit model could not express any of the three rows above.

Zoom-out aggregates (`PK: U#<uid>#AGG#<res>`, `SK: <parentCellId>`, res ∈ {6,7,8}) are
recomputed in the same invocation and folded into `explored-agg.json`.

### Idempotency — webhook replay must not double-award XP

Strava redelivers. SQS standard is at-least-once. Lambda retries. There are therefore
**four** independent layers, and the design assumes all of them will fire:

1. **Receipt-at-accept (step 3).** Conditional `PutItem` on `ingestKey`. Kills duplicate
   deliveries before they ever reach the queue. Cheap, and it protects the 2-second budget.
2. **Receipt state machine (step 12).** `QUEUED → PROCESSING → DONE`, each transition a
   conditional update. A redelivered SQS message finds `PROCESSING` or `DONE` and exits
   before scoring. A crashed invocation leaves `PROCESSING`; a `processingStartedAt` older
   than the 15-minute timeout is reclaimable by the next attempt, which is why the state
   carries a timestamp.
3. **The XP write is transactional (step 15).** `TransactWriteItems` bundles the `Activity`
   put, the `Skill` XP `ADD`s, and the receipt transition to `DONE` with a
   `ConditionExpression` on the previous state. **XP and the receipt commit or fail
   together.** There is no window in which XP is awarded and the receipt is not advanced.
4. **Cell writes are idempotent by construction (step 13/15).** The explored set is a *set*.
   `delta = newCells \ exploredSet` is empty on a replay, so a re-run of the same activity
   yields zero new cells and zero discovery credit **even if every other layer failed**.
   R3: "Replaying the same run is a guaranteed no-op." This is the backstop that makes the
   whole thing safe.

Two more properties worth stating because they are easy to get wrong:

- **XP is derived and stored, not recomputed on read.** `xpAwarded` and `newCellCount` are
  written onto the `Activity` record so the number is stable and auditable. Recomputing XP
  from cells at read time would make a user's history change under them when the rules
  change.
- **`aspect_type: "delete"` never deletes cells.** D-020 makes revealed territory permanent.
  A delete event tombstones the `Activity` record (hidden from the activity list, XP
  reversed only if the receipt shows it was awarded) and leaves `ExploredCell` untouched.
  Ground that was genuinely run stays run.

### Failure handling

- 3 receive attempts, then the **DLQ** (14-day retention). A CloudWatch alarm on
  `ApproximateNumberOfMessagesVisible > 0` on the DLQ is the only alarm this app needs.
- Strava 401 → refresh once, retry once, then fail to the DLQ. Do not loop; a revoked
  authorization must surface as a visible "reconnect Strava" state, not a retry storm.
- Strava 429 (rate limit) → return the message to the queue with a delay. At 3–5 runs/week
  this should never fire.
- **`nightly-reconcile`** is the backstop for events that never arrived at all (subscription
  disabled, Lambda cold, network): it lists activities since the last successful ingest and
  enqueues anything missing. Because of the receipt table, enqueuing something already
  processed costs one conditional write and nothing else.

---

## 5. Frontend architecture

### The fact that drives the whole design

From R3: five years of the stated usage pattern (3–5 runs/week, 3–8 mi/run) produces
**~150,000 H3 res-10 cells in the absolute worst case** — zero route overlap, which will
never happen — and realistically 15k–50k, because a home-based runner re-runs the same
streets constantly. That is **1.2 MB of raw 64-bit cell IDs**. Sorted H3 IDs in one metro
share their high bits, so delta encoding + varint gets to ~2–3 bytes per cell, and gzip on
top lands the whole thing at **~300–450 KB over the wire**.

**So ship the entire explored set to the client.** One HTTP GET at app load. Every query —
viewport fog, "% explored," "unexplored near me," new-cell counts — becomes an in-memory
`Set` operation with zero network round-trips, zero server cost, and instant pan/zoom.

This is not a scaling compromise that we grow out of. At this volume it is **strictly better
than any server-side approach**, and it deletes an enormous amount of architecture:

- **No tile server.** Nothing to run, nothing to pay for, nothing to keep alive.
- **No viewport queries.** No `?bbox=` endpoint, no debounce on `moveend`, no loading
  states, no partial-render flicker.
- **No spatial index service**, no per-zoom API, no cache invalidation strategy for fog.
- **The fog works offline** once loaded.

Budget check: 450 KB × ~30 sessions/month × 5 users ≈ 68 MB/month of S3 egress. Rounding
error.

### App Router structure

```
app/
  layout.tsx                    root: fonts, theme, <AmplifyProvider>
  (public)/
    page.tsx                    marketing-less landing / sign-in redirect
    sign-in/page.tsx            Cognito hosted or Authenticator (passkey-first)
  (app)/
    layout.tsx                  AUTH GATE (server). Fetches session, profile, skills,
                                and mints the presigned URL for explored-r10.bin.
                                Wraps children in <ExploredProvider>.
    page.tsx                    Dashboard: Total Level, skill grid, recent activities
    map/page.tsx                THE MAP. Server shell + dynamic(() => .., {ssr:false})
    log/page.tsx                "Add workout" quick-log page (D-061)
    activities/page.tsx
    activities/[id]/page.tsx
    settings/
      sources/page.tsx          connect/disconnect adapters; Strava OAuth entry point
  api/
    strava/callback/route.ts    OAuth code exchange. Latency-tolerant (R5) — a route
                                handler is correct HERE, unlike the webhook.
    ingest/route.ts             post-MVP: GPSLogger / Health Connect bridge (D-112/D-113)
    explored/route.ts           issues a short-lived presigned S3 GET (or 304)

components/
  map/                          MapCanvas, FogLayer, ModeToggle (atlas | adventure, D-052)
  skills/                       SkillCard, XpBar, TotalLevel
  log/                          QuickLogRow  (one row per workout type, D-061)
  ui/                           primitives; cn() everywhere

lib/
  domain/         ← the SAME modules the Lambdas import. Single source of XP truth.
  fog/            explored.bin codec, h3 helpers, viewport → cells
  consts.ts       ALL metadata, nav, skill definitions, map style config (house convention)
  types.ts
  utils.ts        cn() = twMerge(clsx(...))
```

`lib/domain/` is shared between the Next.js app and `amplify/functions/*`. Both are
TypeScript, both bundle with esbuild, so the XP rules and the H3 helpers exist **once**. A
`tsconfig` path alias (`@/domain/*`) declared in **exactly one place** — R5 found the
existing repo declares aliases twice, in `tsconfig.json` and `astro.config.mjs`, and they
have drifted out of sync.

### Where the map lives, and how the explored set reaches it

**Renderer: MapLibre GL JS**, client-only. `next/dynamic` with `ssr: false` — WebGL has no
server rendering and attempting it wastes SSR duration. The map component is the one place
in the app that is genuinely client-heavy; everything else is a server component.

**Basemap: pmtiles from Cloudflare R2** via `pmtiles` + a MapLibre protocol handler, fetched
by HTTP range request. Not from Amplify Hosting — that egress bills at $0.15/GB (§8).
D-051 is non-negotiable: **the map must remain a real, legible street map.** D-052's two
modes are two MapLibre style objects over the *same* tiles — "atlas" (high-legibility, for
planning where to run) and "adventure" (full parchment/ink/gold-leaf atmosphere, D-050).
A style swap, not a data swap. R3/R4 converged on a **parchment basemap with dark fog**
rather than dark-on-dark, because a dark basemap plus dark fog destroys reveal contrast
(D-053).

**The delivery path for the explored set:**

1. `(app)/layout.tsx` (server component) reads the Cognito session and calls
   `getUrl()` on `users/<uid>/explored-r10.bin`, producing a short-lived presigned GET.
2. `<ExploredProvider>` (client) fetches it once, on mount, with
   `If-None-Match: <cached etag>`. Cached in **IndexedDB** keyed by ETag, so a returning
   session usually gets a `304` and pays nothing.
3. Decode delta-varint → `BigUint64Array` → `Set<string>` of res-10 cell IDs. R3 measures
   `Set` construction at ~50 ms for 150k entries. Held in a React context for the session.
4. Every consumer reads that `Set` synchronously:

```ts
// fog rendering — a world-covering dark polygon with explored area as interior rings
const visible = viewportCells.filter(c => explored.has(c))
const holes   = cellsToMultiPolygon(visible, true)   // dissolves shared edges → organic outline
const fog     = { type: "Polygon", coordinates: [WORLD_RING, ...holes.flat()] }

// "% explored" of a region — denominator precomputed and cached, it never changes
const pct = polygonToCells(region, 10).filter(c => explored.has(c)).length / denom

// "unexplored near me" — a 4 km disk is ~2,977 cells; sub-millisecond
const unexplored = gridDisk(latLngToCell(lat, lng, 10), k).filter(c => !explored.has(c))
```

`cellsToMultiPolygon` dissolves shared edges, so a contiguous explored blob renders as one
smooth outline rather than a visible honeycomb — this is what makes the fog look organic
rather than hexagonal. At low zoom, substitute the res 6/7/8 parent aggregates from
`explored-agg.json` so the far-out view is a coverage gradient instead of static.

**Live updates.** When `process-activity` finishes, the AppSync subscription fires (step 17).
The client refetches `explored-r10.bin` — the ETag has changed — and rebuilds the `Set`. The
XP/skill numbers come through the subscription payload directly. This is the workaround for
Amplify's missing on-demand ISR: **the server cannot invalidate a page, so the client is
told to refetch.**

**Trust boundary, restated.** The client holds the explored set but never *computes* it.
Cells and XP are derived server-side at ingest and the stored set is authoritative. With 1–5
trusted users this is theoretical, but the cost of doing it right is zero, and it means a
future "share your map" feature does not require re-architecting the trust model.

### Rendering the strength-log page

`(app)/log/page.tsx` is deliberately its own page reached by a single **"Add workout"**
button, **not** per-exercise buttons on the home screen (D-061) — chosen so that adding a
future workout type (D-031: adding a workout type adds a skill) does not clutter the home
screen. One `QuickLogRow` per workout type, rendered from `consts.ts`, one tap to log
(D-062). The submitted payload goes through the **manual adapter** like every other source,
so it is archived to S3 and scored by the same XP code path.

---

## 6. Environments and deploy

### Repository and branches

- **Repo:** `github.com/Oofles/lost-soles`, **public** since 2026-08-31 (was private; changed
  under ticket 0013 — see D-165). GitHub secret scanning and push protection are enabled, which
  is only free on a public repo and is why 0004's third scanning layer exists at all.
- **Default branch: `main`.** A deliberate divergence: `devaultsecurity` uses `master`.
  R5's advice is to *decide once and be consistent*, because Amplify branch names drive both
  deploy targets and per-branch secret namespaces. `main` for the new repo.
- **Branch model:** trunk-based. `main` is production. ~~Work happens on short-lived
  `feat/*` / `fix/*` branches merged by PR.~~ No long-running `develop`.
  **Superseded by D-150:** `main` is the *only* branch and every ticket closes by pushing straight
  to it. There is no PR flow and no branch protection — see **D-163** for why, and for the
  consequence that `amplify.yml`, not GitHub, is what actually gates production.
- **`.gitignore` from commit one:** `node_modules/`, `.DS_Store`, `.env*`, `.amplify/`,
  `amplify_outputs.json`, `.claude/*.local.json`, build artifacts. R5 found
  `node_modules/` (2,229 files), a 19 MB `public.tar.gz`, and `.DS_Store` all tracked in the
  existing repo despite `.gitignore`. Do not inherit that.

### Environments

| Environment | Backend | Frontend | Domain |
|---|---|---|---|
| **Local sandbox** | `npx ampx sandbox` — a real, personal cloud backend, redeployed on save | `next dev` on `localhost:3000` reading `amplify_outputs.json` | — |
| **PR preview** | Amplify preview environment, **its own backend stack and its own secret namespace** | Amplify-hosted | `pr-<n>.<app-id>.amplifyapp.com` |
| **Production** | `main` branch backend stack | Amplify Hosting compute | **`soles.devaultsecurity.com`** |

There is no separate staging environment. At 1–5 users, PR previews with real isolated
backends are staging, and a third permanent environment is cost and ceremony for nobody.

Note that each environment gets its own Cognito user pool, its own DynamoDB tables, and its
own S3 bucket. Test data never touches production, and **the sandbox has no Strava webhook
subscription** — Strava allows one subscription per application. For local webhook work,
either point the single subscription at the sandbox temporarily, or replay archived S3
fixtures through `process-activity` directly. The second is better and is one more reason
the raw archive exists.

### `amplify.yml`

The existing site's `amplify.yml` is 16 lines of the stock Astro static preset with **no
`backend:` phase** (§1). Lost Soles needs a genuinely different file:

```yaml
version: 1
backend:
  phases:
    build:
      commands:
        - npm ci --cache .npm --prefer-offline
        - npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID
frontend:
  phases:
    preBuild:
      commands:
        - nvm use            # .nvmrc — pin Node, do not inherit the unpinned setup
        - npm ci --cache .npm --prefer-offline
    build:
      commands:
        - npm run typecheck  # tsc --noEmit — REAL, not the dead script pattern
        - npm run lint       # eslint — REAL, actually installed and configured
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - "**/*"
  cache:
    paths:
      - .next/cache/**/*
      - .npm/**/*
      - node_modules/**/*
```

`ampx pipeline-deploy` runs in the `backend` phase and must succeed before the frontend
build; `amplify_outputs.json` is generated by it and consumed by `next build`.

**Deployment skew protection** (GA March 2025, free, zero-config) should be enabled — it
prevents 404s when a user's cached bundle requests assets from a superseded deploy. Free.
**Skip WAF** — $15/month per app plus WAF charges, ~5× the entire budget, protecting an app
with five users behind Cognito.

### PRE-FLIGHT — audit CloudFront before touching DNS

**R5 flagged this as a real risk and it must be step zero.** The `devaultsecurity` repo
history shows an **abandoned S3 + CloudFront + ACM architecture, retired over unresolvable
SSL certificate problems, whose teardown was never verified.** If a CloudFront distribution
anywhere in the account still carries a `devaultsecurity.com` alias — or if a stale Route 53
record points at a dead distribution — adding `soles.devaultsecurity.com` fails with
**`CNAMEAlreadyExistsException`**, and Amplify's validation polling backs off to *hours*
after the first attempt. Getting this right on the first try is worth an hour of auditing.

Run before creating the domain association:

```bash
# 1. Any distribution claiming a devaultsecurity.com alias?
aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Quantity>\`0\`].{Id:Id,Status:Status,Enabled:Enabled,Aliases:Aliases.Items,Domain:DomainName}" \
  --output table

# 2. Stale records in the EXISTING hosted zone (do not create a second zone)
aws route53 list-hosted-zones-by-name --dns-name devaultsecurity.com
aws route53 list-resource-record-sets --hosted-zone-id <ZONE_ID> \
  --query "ResourceRecordSets[?Type=='CNAME'||Type=='A'||Type=='CAA']" --output table

# 3. Orphaned or failed ACM certs (must be us-east-1 for CloudFront)
aws acm list-certificates --region us-east-1 --output table
```

Then, in order:

1. **Resolve anything the audit finds.** Disable, wait for the distribution to leave
   `InProgress`, then delete. Remove stale CNAME/ALIAS records. A disabled-but-existing
   distribution still holds the alias.
2. **Check CAA.** If a CAA record exists on `devaultsecurity.com` and does not trust an
   Amazon CA, ACM cannot issue and you get HTTPS errors with a confusing message. Fix the
   CAA *first* — fixing it afterwards requires deleting and re-adding the domain in Amplify,
   which causes downtime for the whole domain.
3. **Check the existing app's auto-subdomain setting.** If `devaultsecurity`'s Amplify app
   has automatic subdomain creation enabled for branch deploys, a branch named `soles` on
   *that* app would collide with ours. Check before naming branches.
4. **Use the existing hosted zone.** Do **not** create a new hosted zone for the subdomain —
   that introduces an NS delegation nobody needs and is a classic source of stuck
   validation. One Route 53 zone can back many Amplify apps on different subdomains; this is
   explicitly supported and same-account (cross-account requires an AWS support ticket).
5. **Claim only `soles`.** Amplify offers by default to map both the apex and `www` with a
   redirect. **Remove both.** The apex and `www` belong to the existing site.
6. Expect the CloudFront URL itself to 404 — Amplify routes by `Host` header, so only the
   app URL or the custom domain work. That is not a bug.

### CI

`devaultsecurity` has **no CI**: its only workflow is a dead Hugo→S3 deployer triggering on
`main` in a repo whose default is `master`, still carrying the placeholder role ARN
`arn:aws:iam::123456789012:role/MyHugoProject_S3Deployer`. Amplify's build is the only gate,
and it runs neither lint, typecheck, nor tests.

For Lost Soles, gate on PR with a GitHub Actions workflow that runs `tsc --noEmit`, ESLint,
and `vitest` — including the four boundary tests from §3 (T1–T4). The same commands run in
the Amplify build so a direct push to `main` cannot bypass them. An app doing geometry math,
OAuth token handling, and permanent append-only writes is exactly the kind that needs type
checking on the deploy path.

**One inherited warning worth heeding:** the existing repo's history (`ed8095b`, `8b4270d`,
`8d97534`) shows repeated failures where **Amplify's clean `npm ci` environment was stricter
than local** — path aliases that resolved locally did not resolve in CI, and a whole
`src/layouts` directory was missing from a commit. Expect the same class of bug. Verify
every new path alias and confirm every new file actually landed in the commit before
assuming a deploy will pass.

---

## 7. Secrets

Two stores, chosen by **rotation frequency and ownership**. Static application config goes
in SSM; per-user rotating credentials go in DynamoDB.

### SSM Parameter Store, via Amplify's `secret()`

Set with `npx ampx sandbox secret set <KEY>` (sandbox) or in the Amplify console (branch
environments). Stored at `/amplify/shared/<app-id>/<key>` or
`/amplify/<app-id>/<branch>-branch-<hash>/<key>`, and `secret('KEY')` resolves the correct
one per environment automatically. **Standard parameters are free.**

| Key | Used by | Notes |
|---|---|---|
| `STRAVA_CLIENT_ID` | `/api/strava/callback`, `process-activity`, `token-refresh` | Semi-public (it appears in the OAuth authorize URL) but kept server-side anyway — no reason to build the habit of leaking it |
| `STRAVA_CLIENT_SECRET` | callback + token refresh | **Never leaves a Lambda.** |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | `strava-webhook` GET handshake | Compared in constant time |
| `INGEST_BEARER_TOKEN` | `/api/ingest` | Post-MVP (D-112/D-113). Rotate by changing the parameter and the device config |
| `TILES_BASE_URL` | client build | Not a secret; listed here because it is environment-varying config. Use an env var, not `secret()` |

**Environment variables are NOT secrets.** Amplify renders them in plaintext into build
artifacts, readable by anyone with `get-app` access on the app. Anything sensitive uses
`secret()`.

**Secrets Manager is deliberately not used** — $0.40/secret/month is real money against a
$3–5 budget, and its rotation machinery buys nothing here.

### DynamoDB `LostSolesSourceAccount` — per-user, rotating

Strava's OAuth refresh tokens rotate on **every** refresh. They are per-user data with a
lifecycle, not application config; SSM is the wrong shape and Secrets Manager is the wrong
price.

```
PK: USER#<uid>
SK: SOURCE#strava                        (SOURCE#health-connect, SOURCE#polar, ...)
    adapter          "strava"
    externalUserId   "<strava athlete id>"     -- webhook owner_id lookup
    accessToken      encrypted-at-rest
    refreshToken     encrypted-at-rest
    expiresAt        epoch seconds
    scopes           ["activity:read_all"]     -- D-121.3
    connectedAt / lastRefreshedAt / lastSyncAt
    status           "active" | "revoked" | "error"
```

- The table is **created in CDK and is not an Amplify Data model** — it is not exposed
  through AppSync at all, so no auth rule can be misconfigured into leaking it. Access is by
  IAM grant to exactly three principals: `process-activity`, `token-refresh`, and the
  `/api/strava/callback` route handler's execution role.
- Encryption at rest with an AWS-managed key is the default and is sufficient here. If the
  user later wants defence in depth, a customer-managed KMS key adds ~$1/month — note it,
  do not build it.
- A **GSI on `externalUserId`** lets the webhook map Strava's `owner_id` to a user without a
  scan. (`strava-webhook` itself gets **no** grant on this table — it only needs to enqueue,
  and the lookup happens in `process-activity`. Keep the public endpoint's IAM surface as
  close to empty as possible.)
- `token-refresh` runs `every 4h`, queries for `expiresAt < now + 6h AND status = "active"`,
  refreshes, and writes back. Strava access tokens live 6 hours, so a 4-hour cadence never
  races the expiry.

### What never reaches the client

Everything above. Concretely:

- **No OAuth token of any kind is ever sent to the browser.** The Strava OAuth code exchange
  happens entirely inside `/api/strava/callback`; the browser only ever sees a redirect and
  a "connected" boolean on the profile.
- **No client secret, no verify token, no ingest bearer token** appears in a client bundle.
  A CI check greps the built `.next/static` output for the literal values of the secret keys
  and fails the build on a hit — cheap, and it catches the one mistake that actually matters.
- **The client never talks to Strava.** All source API traffic originates from Lambda.

What **is** public by design and must not be mistaken for a leak: `amplify_outputs.json`
contains the Cognito user pool ID, app client ID, identity pool ID, and the AppSync
endpoint. These are public identifiers, protected by the user pool's policy and AppSync auth
rules, not by obscurity. `amplify_outputs.json` is still gitignored (it is generated
per-environment), but its presence in the client bundle is correct.

### Standing conditions

- **D-123**: no special home-location privacy handling. Single-user app, private AWS
  account, map shown only to the owner; full-fidelity traces are stored, nothing truncated
  or masked. **REVISIT TRIGGER: if friends/family accounts or any share/screenshot feature
  is ever added, this decision must be reopened.** Record it as a standing condition in
  `08-security-privacy.md`.
- **O-005**, unrelated to Lost Soles but blocking in practice: an AWS access key appears
  inline in `~/devaultsecurity/.claude/settings.local.json`, which is untracked but **not
  gitignored** — one `git add .` from permanent exposure. Rotate the key, strip the entries,
  gitignore `.claude/*.local.json` in both repos, and use an AWS named profile or SSO
  instead. Do this before the first deploy.

---

## 8. Cost model

All figures us-east-1, verified 2026-08-30 (R5 §8). Assumes 1 primary user, ≤5 ever,
3–5 runs/week, ~30 sessions/month/user.

| Line item | Assumption | Monthly |
|---|---|---|
| Amplify build minutes | ~30 builds × 3 min = 90 min (1,000 free) | **$0.00** |
| Amplify hosting storage | < 1 GB (5 GB free) | **$0.00** |
| Amplify data transfer out | ~3 GB (15 GB free) — **tiles are NOT on this path** | **$0.00** |
| Amplify SSR requests | ~50k (500k free) | **$0.00** |
| Amplify SSR duration | ~2 GB-hr (100 GB-hr free) | **$0.00** |
| Cognito | 5 MAU, Essentials (10,000 MAU free, **non-expiring**) | **$0.00** |
| AppSync | ~100k query/mutation ops @ $4.00/M | **$0.40** |
| DynamoDB writes | ~300k WRU @ $0.625/M (a *year* of cell writes is ~27k) | **$0.19** |
| DynamoDB reads | ~1M RRU @ $0.125/M | **$0.13** |
| DynamoDB storage | < 1 GB (25 GB free tier, confirmed to have survived the July 2025 Free Tier overhaul) | **$0.00** |
| Lambda | ~2k invocations, ~40k GB-s (1M req + 400k GB-s free, perpetual) | **$0.00** |
| SQS | ~2k requests (1M free) | **$0.00** |
| S3 — raw archive + `explored.bin` | ~5 GB @ $0.023 + requests | **$0.17** |
| SSM Parameter Store | Standard parameters | **$0.00** |
| EventBridge | 2 rules, ~200 invocations | **$0.00** |
| ACM certificate | Public cert for CloudFront/Amplify | **$0.00** |
| Route 53 hosted zone | `devaultsecurity.com` already exists | **$0.00 marginal** |
| Cloudflare R2 — pmtiles | 10 GB stored @ $0.015/GB-mo; **egress $0.00** | **$0.15** |
| **Total** | | **≈ $1.05 / month** |

R5's estimate before the R2 line was **~$0.90/month**. **Budget $3–5/month** to absorb
variance. That leaves roughly 4× headroom, which is what makes it safe to be relaxed about
the small stuff and rigid about the two things below.

### Risk 1 — pmtiles egress

Amplify data transfer out is **$0.15/GB after 15 GB free**. A map-heavy app pulling 100 GB a
month would cost **$15/month** — 3–5× the entire budget, from tiles alone. A basemap can be
100 MB–2 GB, and a single browsing session pulls tens of megabytes.

**Mitigation, and it is designed in rather than bolted on: pmtiles live on Cloudflare R2,
which has zero egress fees**, fetched by HTTP range request straight from the browser.
This is a genuinely good hybrid even inside an otherwise-all-AWS stack, and it is the single
line item most worth being deliberate about. Fallbacks in order: (b) a public S3 bucket with
our own CloudFront distribution, cheaper per GB than Amplify's markup; (c) keep tiles small
and cache aggressively. Do **not** serve tiles through Amplify Hosting.

The explored-set blob is a different matter: 450 KB × ~30 sessions × 5 users ≈ 68 MB/month,
and most of those are `304`s. It stays on S3 via Amplify Storage.

### Risk 2 — free-tier perpetuity is genuinely ambiguous

Sources disagree on whether Amplify Hosting's allowances (1,000 build min, 5 GB storage,
15 GB transfer, 500k SSR requests, 100 GB-hr SSR duration) are **perpetual** or tied to the
**12-month AWS Free Tier**. The `devaultsecurity` account is well past 12 months, so if they
are 12-month allowances, this app pays for them from day one.

**Action: verify in the AWS Billing console before committing.** Worst case — every
allowance chargeable — is **~$2–4/month more**, landing at ~$3–5 total. Still inside budget,
but it is the difference between "free" and "the whole budget," so know which it is.

Two allowances are *confirmed* non-expiring and worth relying on: **Cognito's 10,000 MAU**
and **Lambda's 1M requests + 400,000 GB-seconds**.

### What would actually blow the budget

Named so nobody wanders into one:

- **A NAT Gateway: ~$33/month.** ~10× the budget, for a component that moves no data on its
  own. This is what D-081 exists to prevent.
- **Aurora Serverless v2: $6–12/month compute + $1–3 storage**, before the NAT Gateway that
  a Strava-calling Lambda would require, before the $11–15/month RDS Proxy that Amplify
  recommends and that **disables auto-pause entirely**. 10–50× over. D-082.
- **RDS `db.t4g.micro`: ~$12/month** compute alone, Single-AZ, before storage and backups.
  The cheapest always-on managed Postgres on AWS, still 3–4× the budget.
- **Amplify WAF: $15/month per app** plus WAF charges.
- **AWS Secrets Manager: $0.40/secret/month** — five secrets is $2/month for something SSM
  does free.
- **Tiles through Amplify egress: up to $15/month.** See Risk 1.

---

## 9. Conventions

R5 read `/home/vivicat/devaultsecurity/` directly. These are that repo's actual conventions,
split into what to carry over and what to fix.

### Adopt — match the house style

- **npm + `package-lock.json`.** No pnpm, no yarn. The existing repo has a v3 lockfile and
  nothing else.
- **TypeScript strict**, with `strictNullChecks` set explicitly rather than assumed from a
  preset.
- **Tailwind, class-based dark mode** (`darkMode: ["class"]`).
- **`cn()` = `twMerge(clsx(...))`** in `lib/utils.ts`, used for every conditional class.
  Already the house helper; keep the same name and signature.
- **A centralized, typed `consts.ts`.** All site metadata, nav, and — new here — skill
  definitions, workout types, map style config, and XP constants live in
  `lib/consts.ts` as UPPERCASE-keyed exported objects typed from `lib/types.ts`. **Nothing
  hardcoded in components.** R5 called this out explicitly as worth replicating, and it
  matters more here than it did there: D-031 requires that adding a workout type (and its
  skill) be a modular, one-place change.
- **One `BaseHead`-equivalent** owning all SEO/meta: canonical URL, OG tags,
  `summary_large_image`, font preloads. One component, one place.
- **Formatting: 2-space indent, double quotes, no semicolons.** Enforced by Prettier this
  time rather than left to convention.
- **External links always `target="_blank" rel="noopener noreferrer"`.**
- **Amplify Hosting from GitHub as the only deploy path**, with Route 53 + Amplify auto-SSL.
  The auto-SSL is the reason the user chose Amplify originally; do not undermine it.

### Diverge — deliberately, and for stated reasons

| Diverge on | Existing | Lost Soles | Why |
|---|---|---|---|
| Framework | Astro 4 + SolidJS, static | **Next.js 15 App Router**, SSR | Adapter-free first-class Amplify support; auth-gated SSR and route handlers are required (§1) |
| Node version | **Unpinned** — no `engines`, no `packageManager`, no `.nvmrc` | **Pinned** via `.nvmrc` + `engines` + the Amplify build-image setting | An unpinned Node in a hosted build is a latent build-breaker that fires at the worst time |
| Linting | `lint` / `lint:fix` scripts calling `eslint .` — **eslint is not installed and no config exists**. Both scripts are dead | **ESLint flat config + Prettier, actually installed, actually run in CI and in the Amplify build** | Do not ship a dead script and call it linting |
| Type checking | `build` is plain `astro build` with **no `astro check`**, despite `@astrojs/check` being a dependency — removed in commit `bf140fa "Fix Amplify build: Skip TypeScript type checking"` | **`tsc --noEmit` runs in CI and in the Amplify build** | Geometry math, OAuth token handling, and permanent append-only writes. Silencing the type checker to make a build pass is how the map gets permanently wrong |
| Path aliases | Declared **twice** — `tsconfig.json` wildcard and `vite.resolve.alias` in `astro.config.mjs` — and **out of sync** (`@styles` missing from one) | **Declared in exactly one place** | R5 traced real CI-only build failures to alias drift |
| `amplify.yml` | Gen 1, hosting-only, no `backend:` phase | **`backend:` phase running `ampx pipeline-deploy`** | There is a backend now |
| Branch | `master` | **`main`** | Decide once; branch names drive deploy targets and secret namespaces |
| CI | None (one dead workflow with a placeholder role ARN) | **PR gate: typecheck + lint + vitest**, including boundary tests T1–T4 | §3 depends on T1–T4 being enforced, not aspirational |

### Do not replicate

Tracked `node_modules/` (2,229 files), a committed 19 MB `public.tar.gz`, committed
`.DS_Store`, 225 stale files under a gitignored directory, boilerplate `README.md` /
`CONTRIBUTING.md` / `LICENSE` inherited from an unrelated project, and a dependency
(`@astrojs/sitemap`) that is referenced by two files but never wired into `integrations`, so
the sitemap it advertises does not exist. Clean `.gitignore` and an honest `README.md` from
commit one.

---

## 10. Rejected alternatives

| Alternative | Rejected because |
|---|---|
| **Aurora Serverless v2** | $6–12/mo compute + $1–3 storage even at min 0 ACU, plus **~$33/mo NAT Gateway** the moment a Lambda needs both the DB and Strava, plus $11–15/mo RDS Proxy that then **disables auto-pause**; 15–30 s resume after idle. 10–50× budget. **D-081, D-082, D-083.** |
| **PostGIS (anywhere: RDS, Aurora, Neon)** | Explored territory is a set of discrete integers, not arbitrary geometry — DynamoDB models it for ~$0 and the whole dataset fits in a browser tab. Amplify Data maps `point`/`linestring` to `a.string()` with no spatial operators or filters. **D-082.** Revisit only for true geometry ops (polygon dissolve, road snapping, isochrones) — and then reach for **Neon's free tier over public TLS**, called directly from a Lambda, bypassing Amplify Data entirely. No VPC, no NAT. |
| **Vercel + Neon** | Hobby is non-commercial and caps cron at 1/day; Pro is $20/seat/mo — 4–7× the whole budget for zero capability win, while splitting the stack across two vendors and two billing relationships and abandoning an AWS account already in use. |
| **Cloudflare Workers + D1** | D1 is SQLite: **no PostGIS, no SpatiaLite, no spatial index**, 10 GB hard cap per database, and Workers' CPU limits are hostile to the geometry job. $5/mo Workers Paid on top. **Rejected for the app — adopted for tiles**, where R2's free egress is the single best cost decision available (§8). |
| **A routing container (OSRM / Valhalla on Lightsail, Hetzner, or ECS Fargate)** | Multi-GB OSM extracts, a graph build measured in minutes to hours, and several GB of resident RAM. Not a Lambda and not an Amplify workload under any configuration, and $5–7/mo minimum doubles-to-triples the budget. Route planning (D-070) is **out of MVP** (D-122); when it lands, prefer a hosted routing API (Mapbox Directions, OpenRouteService) and skip the infrastructure entirely. |
| **SST / raw CDK on AWS** | Maximum control, but you rebuild hosting, CI/CD, cert management, and preview environments — the exact things that drove the move *to* Amplify. Gen 2 already *is* CDK where it matters (§2). |
| **Astro + community SSR adapter** | Amplify SSR for Astro depends on a community-maintained adapter and the `.amplify-hosting` deploy spec. A community adapter on the deploy path of a project meant to last years is the wrong risk. |
| **Next.js route handler for the Strava webhook** | SSR-bundle cold starts risk Strava's hard **2-second** ack deadline, and the handler would redeploy on every frontend change. See §2. |
| **Buffered-polygon-union fog (turf)** | Best-looking on run #1, catastrophic by run #300: hundreds of thousands of vertices, multi-MB payloads, JSTS topology exceptions on degenerate geometry, non-idempotent and unbounded. |
| **Raster bitmap fog tiles** | Every insert is a read-modify-write of every touched tile, "% explored" becomes pixel counting, and it contributes nothing to route planning. H3 does everything it does, plus the routing math. |
| **PWA run recording** | Screen Wake Lock is auto-released when the tab hides, there is no service-worker geolocation, and a pocketed phone loses the trace in ~90 s. **D-110.** |
| **Share-sheet GPX import as the primary path** | `share_target` works, but **Strava has no GPX export in its mobile app** — export is website-only. The flow would require a desktop after every run. **D-111.** Build it as a repair hatch, not a path. |
| **Single-table Amplify Data model for cells/tokens** | The client never queries cells (§5), so AppSync's $4.00/M ops would buy nothing; and OAuth tokens should not be reachable from a client-authenticated API at all. CDK tables with explicit IAM grants instead (§2). |
| **AWS Secrets Manager** | $0.40/secret/month for rotation machinery this app does not use. SSM Parameter Store standard parameters are free. |
| **Amplify WAF** | $15/month per app plus WAF charges, ~5× the budget, protecting five users already behind Cognito. |

---

## 11. Known tensions the decision log creates

The constraints are right, but three of them have real costs. Stating them so nobody
rediscovers them mid-implementation and thinks something is broken.

**1. D-070 (route planning) has no home under D-081 + D-082.** Novelty route planning needs
an OSM road graph, map-matching, and a loop-constrained arc-orienteering solve. That is a
container workload with multi-GB extracts and GB of resident RAM — it cannot be a Lambda
(15-minute wall, no container images through `defineFunction`), and it cannot be in a VPC
without a NAT Gateway. The architecture above therefore has **no place to put D-070**, and
this is not an oversight. D-122 puts route planning out of MVP, which defers the problem
honestly. When it comes back, the only budget-compatible answers are (a) a hosted routing
API called over HTTPS from a Lambda, or (b) accept a $5–7/month box beside the Amplify app,
roughly doubling the running cost. The cheap H3-only version — "cluster the unexplored
res-10 cells within a `gridDisk` and show the densest zones near you" — needs **no OSM data
at all**, runs in the browser in under a millisecond against the already-loaded `Set`, and
should ship first regardless. It may well be enough.

**2. "% explored" is two different numbers and the honest one needs data we do not have.**
H3 area coverage counts buildings and back yards nobody can run through, so it will read as
a discouragingly small percentage. The number the user actually wants is **% of streets**,
which is the metric Wandrer built a product on — and that requires OSM way-segment matching,
which is the same container workload as tension 1. For MVP, surface H3 coverage as
"territory" and do not label it "streets." Keep the two metrics distinctly named so adding
the street metric later does not silently redefine a number the user has been watching.

**3. No on-demand ISR means the server cannot tell a page it is stale.** Amplify does not
support `revalidatePath` / `revalidateTag`, so a webhook landing at 06:40 cannot invalidate
a cached dashboard. The workaround (an AppSync subscription plus client refetch, §4 step 17)
is fine and arguably better UX, but it means **the dashboard must be a live client
component, not a cached server-rendered page** — a structural constraint on §5, not a
detail. Do not design a page whose freshness depends on server-side invalidation.

**One place the constraints turned out to cost nothing:** D-082's "no Postgres" looks like a
sacrifice and is not. R3's volume math means the entire five-year explored set fits in
~300–450 KB gzipped, so refusing a database bought a *simpler* system — no tile server, no
viewport queries, no spatial index, instant pan and zoom — rather than a compromised one.
The constraint and the best design happen to agree.

---

## Open items carried into implementation

- **O-004** — does Strava write *routes* (not just summary sessions) to Health Connect?
  A five-minute device check: Health Connect → App permissions → Strava → look for
  "Exercise route." Not blocking MVP; only decides the post-MVP adapter order (D-113 vs
  D-112).
- **O-005** — rotate the AWS access key in `~/devaultsecurity/.claude/settings.local.json`
  and gitignore it. Do this before the first deploy (§7).
- **Verify the Amplify Hosting free-tier perpetuity** in the AWS Billing console (§8).
- **Run the CloudFront / Route 53 / ACM audit** before creating the domain association (§6).
