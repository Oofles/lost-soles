# 03 — Integrations & Data Ingestion

> ⚠️ **The interfaces below were superseded on 2026-08-30.** `01-architecture.md` and
> `03-integrations.md` were written in parallel and defined `Activity`/`Trace`/`SourceAdapter`
> independently, conflicting in eight places. The reconciled canonical contract lives in
> [`contracts/ingestion-contract.md`](contracts/ingestion-contract.md) — **that file wins.**
> The text here is retained for its surrounding reasoning.

**Status:** design, pre-implementation. No code exists.
**Authority:** `docs/decisions/DECISIONS.md`. Every `D-xxx` below is settled and user-confirmed.
**Research:** `docs/research/R1-strava.md`, `R8-statshunters-strava-recheck.md`,
`R10-android-ingestion.md`, `R9-devices-and-vendor-apis.md`, `R2-wearables.md`.

> **Note on `01-architecture.md`:** at the time this document was written, `docs/01-architecture.md`
> did not exist. The `Activity` / `Trace` interfaces in §1 are therefore **defined here** and the
> architecture document **must match them exactly** when it is written. If they diverge, this
> document's §1 is the one to change — but change both, in the same commit.

## Contents

1. The adapter contract
2. Strava adapter (MVP)
3. Raw archive (S3)
4. Post-MVP adapters
5. Wearables ruled out
6. Migration playbook

---

# 1. The adapter contract

**D-100:** ingestion is source-agnostic. The internal contract is a normalized `Activity` +
`Trace`. Every source — Strava, GPSLogger, a Health Connect bridge, a watch vendor, manual
entry, a file drop — is an **adapter** behind that contract. Everything in sections 2 and 4 of
this document is one implementation of this single interface.

**D-121 mitigation 1 is a hard architectural rule:** no Strava type, field name, enum value, or
error code appears anywhere outside `adapters/strava/`. Swapping adapters must touch exactly one
module. The test for this is mechanical: `grep -ri strava src/ --exclude-dir=adapters` must
return nothing but comments.

## 1.1 Types

```ts
// ---- identity -------------------------------------------------------------

/** Lost Soles internal activity id. ULID. Ours, never a vendor's. */
type ActivityId = string;

type SourceId =
  | 'strava'          // §2  — MVP (D-121)
  | 'gpslogger'       // §4.2 (D-112)
  | 'healthconnect'   // §4.1 (D-113)
  | 'manual'          // §4.3 (D-060/D-061)
  | 'fileupload'      // GPX/FIT drop, incl. Strava bulk export (D-101)
  | 'suunto'          // §4.4 (D-117), contingent on hardware
  | 'polar';          // §4.4 (D-117), contingent on hardware

/** 1:1 with the activity skills of D-031. Adding a workout type adds a member. */
type ActivitySkill = 'wayfaring' | 'might' | 'fortitude' | 'endurance';

// ---- the contract ---------------------------------------------------------

interface Activity {
  activityId: ActivityId;
  userId: string;

  /** Provenance. Load-bearing: drives archive layout, dedupe, and migration. */
  source: SourceId;
  /** The source's own id for this activity. ALWAYS a string — see §2.7 on int64. */
  sourceActivityId: string;

  skill: ActivitySkill;
  /** The vendor's own type string, verbatim, for debugging and re-mapping. Never branched on
   *  outside the adapter. e.g. 'TrailRun', 'ExerciseSessionRecord:EXERCISE_TYPE_RUNNING'. */
  sourceTypeRaw: string;

  /** UTC instant. Storage and sort key. Always trustworthy. */
  startedAt: string;              // ISO-8601 with a real Z
  /** Naive local wall clock. NO timezone suffix. All game-day bucketing uses this (§2.7). */
  startedAtLocal: string;         // 'YYYY-MM-DDTHH:mm:ss'
  /** Bare IANA id or null. e.g. 'Europe/London'. Never a '(GMT+00:00) ' prefixed string. */
  timezone: string | null;

  elapsedSeconds: number;
  movingSeconds: number | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;

  /** False is a NORMAL outcome: treadmill, manual entry, strength work. Not an error. */
  hasTrace: boolean;
  traceRef: string | null;        // S3 key of the normalized trace, or null

  /** S3 key of the untouched source payload. §3. Null only for `manual`. */
  rawArchiveKey: string | null;

  /** D-062: sets/reps deferred from the MVP UI, but the model carries them from day one. */
  sets: WorkoutSet[];

  /** Composite natural key for cross-source dedupe. §2.7. */
  dedupeKey: string;
  ingestedAt: string;             // ISO-8601 UTC
  /** Monotonic per (source, sourceActivityId). Bumped on every re-ingest of an edit. */
  revision: number;
}

interface WorkoutSet {
  exercise: string;               // 'pushup' | 'situp' | 'plank' | future
  reps: number | null;
  durationSeconds: number | null; // planks
  weightKg: number | null;
}

interface Trace {
  activityId: ActivityId;
  source: SourceId;
  points: TracePoint[];
  pointCount: number;
  /** [minLng, minLat, maxLng, maxLat]. Cheap prefilter before H3 projection. */
  bbox: [number, number, number, number];
}

interface TracePoint {
  lat: number;                    // WGS84 degrees
  lng: number;
  /** Seconds since activity start. NOT an absolute timestamp — sources disagree on epoch. */
  t: number;
  altM: number | null;
  /** Metres, if the source reports it (Health Connect, GPSLogger do; Strava does not). */
  accuracyM: number | null;
}
```

## 1.2 The adapter interface

```ts
interface SourceAdapter {
  readonly id: SourceId;

  /** Enumerate candidate activities newer than a watermark. Push adapters may return empty
   *  and rely on events; every adapter MUST still implement this, because it is the
   *  reconciliation sweep that covers dropped webhooks (§2.3). */
  listSince(userId: string, watermark: string): AsyncIterable<SourceActivityRef>;

  /** Fetch one activity in full. Returns the raw payload alongside the normalized form so
   *  the pipeline can archive the raw BEFORE it trusts the normalization (§3). */
  fetch(ref: SourceActivityRef): Promise<{
    activity: Activity;
    trace: Trace | null;
    raw: { bytes: Uint8Array; contentType: string; ext: string };
  }>;

  /** Optional push path. Returns intents, never side effects. */
  handleEvent?(event: unknown): Promise<IngestCommand[]>;
}

type IngestCommand =
  | { kind: 'ingest';  ref: SourceActivityRef }
  | { kind: 'reingest'; ref: SourceActivityRef }   // edit — supersede, bump revision
  | { kind: 'retract'; source: SourceId; sourceActivityId: string }
  | { kind: 'disconnect'; source: SourceId; userId: string };
```

## 1.3 The pipeline every adapter feeds

```
adapter.fetch()
  → 1. ARCHIVE raw bytes to S3            (§3 — before anything else touches them)
  → 2. NORMALIZE to Activity + Trace       (inside the adapter; vendor types die here)
  → 3. DEDUPE on dedupeKey                 (§2.7 — cross-source, not just intra-source)
  → 4. SANITIZE trace                      (speed-gate implausible jumps, §2.7)
  → 5. PROJECT to H3 res 10 cells          (D-115)
  → 6. SCORE fog + XP                      (D-120: full / half / 50% re-arm)
  → 7. PERSIST Activity + cell deltas      (DynamoDB, D-082; append-only, D-020)
```

Steps 3–7 are shared and know nothing about sources. Step 1–2 is the adapter. That boundary is
the whole of D-100, and §6 is the proof that it holds.

**`retract` is not a delete.** D-020 makes revealed territory permanent. Retracting an activity
removes it from the activity ledger and from XP totals; it does **not** re-fog cells. Cell
`lastRunAt` (D-120) is recomputed from the surviving activities that touch that cell. If no
activity survives for a cell, the cell keeps its `revealed` bit and loses its `lastRunAt`
recency — it stays visible forever, and re-arms for discovery credit. This is deliberate and it
is what makes §2.8's legal exposure survivable.

---

# 2. Strava adapter — MVP

**D-121.** The user made this call with full knowledge of R1 and R8. It was advised against and
reaffirmed. The four non-negotiable mitigations from D-121 are implemented in §2.2 (scope),
§2.4 (streams), §1.1/§1.2 (adapter boundary), and §3 (archive).

**Registration prerequisites, before any code:**
- A Strava account with an **active paid subscription**. Since 2026-06-01 (new developers) /
  2026-06-30 (existing), Standard Tier API access requires one — Policy §3.3. ~$11.99/mo US.
  The user already pays this, so it is not a marginal project cost (R8), but it is now a
  *dependency*: letting the subscription lapse kills API access.
- App created at `strava.com/settings/api`. New apps launch at **athlete capacity 1**
  ("single-player mode"). Self-serve upgrade to 10 from the same dashboard, no review, no form.
  Do the upgrade at registration time even though MVP is single-user, so the capability is
  banked before any policy change closes it (§2.8).
- Use `Authorization: Bearer` headers for every call from day one, and keep the API base URL in
  config. R1: on **2027-06-01** Strava mandates the new base `https://www.api-v3.strava.com`
  and moves auth tokens out of form params into headers. Building it the old way buys a
  migration you did not need.

## 2.1 Endpoints used

| Purpose | Call |
|---|---|
| Authorize | `GET https://www.strava.com/oauth/authorize` |
| Token exchange / refresh | `POST https://www.strava.com/oauth/token` |
| Revoke | `POST https://www.strava.com/oauth/revoke` (Basic auth, client credentials) |
| Reconciliation sweep | `GET /api/v3/athlete/activities?after=&page=&per_page=200` |
| Activity detail | `GET /api/v3/activities/{id}` |
| **Trace** | `GET /api/v3/activities/{id}/streams?keys=...&key_by_type=true` |
| Webhook subscription | `POST /api/v3/push_subscriptions`, `GET`, `DELETE /{id}` |

Nothing else. Club, Segment-Explore, and leaderboard endpoints are out of scope and several
were deprecated 2026-09-01 anyway.

## 2.2 OAuth

**Scope is `activity:read_all`. Not `activity:read`.** (D-121 mitigation 3.)

R1, §7 "Privacy zones": with only `activity:read`, Strava truncates traces at the boundary of
any privacy zone the user has configured — typically home and work. The start and end of nearly
every run is silently missing. On a fog-of-war map that is a **permanent unexplored donut
exactly where the user lives**, on a map that by D-020 never re-fogs. There is no repair short
of re-ingesting from another source. `activity:read_all` returns the un-redacted stream and is
also the only scope that returns "Only You" activities at all — and it is required to receive
webhook events for them (§2.3).

**Flow.**

1. **Authorize.** Browser to:
   ```
   https://www.strava.com/oauth/authorize
     ?client_id=<id>
     &redirect_uri=https://lostsoles.devaultsecurity.com/api/auth/strava/callback
     &response_type=code
     &scope=activity:read_all
     &state=<CSRF nonce, stored server-side with a short TTL>
     &approval_prompt=auto
   ```
   The redirect URI's **host must match the "Authorization Callback Domain"** configured in the
   Strava app settings — that field is a bare domain, no scheme, no path, no port. Set it to
   the app's subdomain of `devaultsecurity.com` (D-080). `localhost` is accepted as a separate
   value for development; you cannot have both at once on one app, so register a second
   throwaway Strava app for local dev rather than flipping the production one.

2. **Callback.** `?code=...&scope=activity%3Aread_all&state=...`. Verify `state`. Then
   **verify the returned `scope` string actually contains `activity:read_all`** — users can
   decline individual scopes on the consent screen and Strava will happily hand you a token
   with less than you asked for. If `read_all` is missing, do **not** store the token: show a
   dedicated error explaining that without it the map will have a hole around home, and offer
   re-authorization with `approval_prompt=force`.

3. **Exchange.** `POST https://www.strava.com/oauth/token`
   with `client_id`, `client_secret`, `code`, `grant_type=authorization_code`.
   ```json
   { "token_type": "Bearer", "expires_at": 1794700000, "expires_in": 21600,
     "refresh_token": "...", "access_token": "...",
     "athlete": { "id": 134815, "username": "...", ... },
     "scope": "activity:read_all" }
   ```

**Token lifetime and refresh — the single most common integration bug.**

- Access tokens expire **6 hours** after creation. Use the returned `expires_at`, never a
  hardcoded TTL.
- **Refresh tokens rotate.** Strava's docs: "The refresh token may or may not be the same
  refresh token used to make the request." Any refresh response may carry a *new*
  `refresh_token`, and the moment it does, the old one is dead.
- **Therefore: persist the new refresh token transactionally, before using the new access
  token for anything.** A crash between "refreshed" and "wrote the new refresh token" orphans
  the connection permanently and forces the user through OAuth again. Write it with a DynamoDB
  conditional update keyed on the previous token value, so two concurrent refreshes cannot both
  win. Do not put refresh tokens in environment variables — they are long-lived *mutable*
  state. Secrets Manager or a dedicated DynamoDB `Connection` row (D-080/D-081: no VPC, so
  both are plain HTTPS calls from Lambda).
- Refresh proactively at `expires_at - 300s`, not reactively on 401. A 401 mid-webhook-consume
  costs a retry you did not need.
- Serialize refreshes per connection with a short-lived lock row. Two Lambdas refreshing the
  same connection at once is the realistic way to lose the rotation race.

**Revocation.** `POST https://www.strava.com/oauth/revoke` with HTTP Basic auth using the
client credentials (recommended since 2026-06-01; the legacy `POST /oauth/deauthorize` with the
access token still exists). Revocation also arrives *inbound* as a webhook — see §2.3 — and is
a §7.4 deletion trigger. See §2.8 for what we actually do about that.

## 2.3 Webhooks

**Subscription creation** (once, ever — you get exactly one subscription per application):

```
POST https://www.strava.com/api/v3/push_subscriptions
  client_id=<id>
  client_secret=<secret>
  callback_url=https://lostsoles.devaultsecurity.com/api/webhooks/strava
  verify_token=<a long random string we generate and store>
```

**Before that POST returns**, Strava synchronously issues a `GET` to `callback_url`:

```
GET /api/webhooks/strava?hub.mode=subscribe
                        &hub.challenge=15f7d1a91c1f40f8a748fd134752feb3
                        &hub.verify_token=<the token we supplied>
```

You must reply **HTTP 200 within 2 seconds**, `Content-Type: application/json`, body exactly:

```json
{"hub.challenge": "15f7d1a91c1f40f8a748fd134752feb3"}
```

> **TRAP — the JSON key is literally `hub.challenge`, with a dot.** Not `hub_challenge`, not
> `hubChallenge`. Every serialization framework that maps struct fields to camelCase will get
> this wrong. Emit the string by hand if you have to. R1 flags this as a common failure.

Compare `hub.verify_token` against the stored value and return 400 on mismatch — this GET route
is necessarily public and unauthenticated, because Strava sends no credentials. Only if the
handshake succeeds does the POST return `{"id": 120475}`, the subscription id.

Management: `GET /push_subscriptions` (with `client_id`/`client_secret`) to inspect,
`DELETE /push_subscriptions/{id}` to remove. Because there is one subscription per app and its
`callback_url` is fixed at creation, **the callback URL is permanent infrastructure**. Choose a
stable path behind a stable custom domain now; changing it later means delete + recreate, and
there is a window with no events during which reconciliation is the only ingestion path.

**Event payload (POST):**

```json
{
  "object_type": "activity",
  "object_id": 1360128428,
  "aspect_type": "create",
  "updates": {},
  "owner_id": 134815,
  "subscription_id": 120475,
  "event_time": 1516126040
}
```

- `updates` is populated only on `aspect_type: "update"`, and **only for title, type, and
  privacy changes**. There is no event for "the user fixed the GPS trace" or "distance changed".
- `object_type: "athlete"` has exactly one meaningful form: deauthorization, carrying
  `updates: {"authorized": "false"}`. **Wire this up** — it is the §7.4 trigger and the
  `disconnect` IngestCommand.
- **The payload contains no activity data.** It is a pointer. Getting anything useful costs
  API calls against the rate limit (§2.5).

**The 2-second acknowledgement requirement is the entire design constraint.**

Return 200 **before doing any work**. The handler does exactly this, in order:

1. Parse the body. Validate `subscription_id` matches ours and `owner_id` maps to a known
   connection. (Cheap, in-memory / one DynamoDB GetItem at most.)
2. `PutItem` the raw event into a DynamoDB `webhook_events` table (or `SendMessage` to SQS),
   keyed `(object_id, aspect_type, event_time)`.
3. Return `200` with an empty body.

Everything else — token refresh, `GET /activities/{id}`, `GET /streams`, S3 archive,
normalization, H3 projection — happens in an **async consumer** triggered off that queue.
Never call Strava from inside the webhook request.

Practical notes for the Amplify Gen 2 / Lambda deployment (D-080, D-081):
- A cold-start Lambda behind API Gateway can and does blow the 2-second budget. Keep the
  handler's bundle tiny (no AWS SDK v2, no ORM, no heavy validation library) and consider
  provisioned concurrency of 1 if cold starts prove marginal. At ~1 event/day the function is
  *always* cold — this is not a hypothetical.
- **Do not attach this Lambda to a VPC** (D-081). It needs internet and would force a NAT
  Gateway at ~$33/mo, ~10x the entire target budget (D-083).
- HTTPS on 443 with a valid full certificate chain. API Gateway + ACM is fine. Strava publishes
  no source IP range, so IP allowlisting is unavailable — `verify_token` and payload shape are
  the whole authentication story for the GET, and for the POST it is payload validation plus
  the fact that the pointer is useless without our own OAuth token.

**Delivery guarantees are weak. Plan for loss.**

- 200 within 2s or the delivery is failed.
- Strava retries **up to three times total**, then drops the event **permanently and silently**.
- **No replay mechanism. No dead-letter queue on Strava's side.**

Therefore webhooks are a *latency optimization*, never the ingestion path of record. Every
adapter must implement `listSince` (§1.2), and for Strava a **scheduled reconciliation sweep**
runs on EventBridge:

- Every 6 hours: `GET /athlete/activities?after=<watermark - 48h>&per_page=200`, page through,
  and enqueue an `ingest` for any `id` not already in the activity ledger. The 48-hour overlap
  absorbs clock skew and late edits.
- Nightly: the same sweep with a 14-day window, as a slower net.
- Cost: 1–2 calls per sweep (§2.5). Negligible.

## 2.4 Fetching the trace

```
GET https://www.strava.com/api/v3/activities/{id}/streams
    ?keys=latlng,time,altitude
    &key_by_type=true
Authorization: Bearer <access_token>
```

`keys` is **required** (CSV, minItems 1). `key_by_type` is **required and must be `true`** —
there is effectively no other supported mode; it makes the response an object keyed by stream
type instead of a bare array.

Response shape:

```json
{
  "latlng":   { "data": [[51.5074,-0.1278],[51.5075,-0.1279], ...],
                "series_type": "distance", "original_size": 2711, "resolution": "high" },
  "time":     { "data": [0,1,2,3, ...], "series_type": "distance",
                "original_size": 2711, "resolution": "high" },
  "altitude": { "data": [12.4,12.4,12.6, ...], ... }
}
```

All streams for an activity are **index-aligned and equal length** — element *i* of `latlng`
corresponds to element *i* of `time` and `altitude`. This is strictly better than parsing a GPX:
zip them into `TracePoint[]` with no interpolation, no XML, no schema variance.

The complete `StreamType` enum, for reference — note the two naming traps:
`time`, `distance`, `latlng`, `altitude`, `velocity_smooth`, `heartrate`, `cadence`, `watts`,
`temp`, `moving`, `grade_smooth`.
**There is no `power` (it is `watts`) and no `temperature` (it is `temp`).**

> ### TRAP — `resolution` and `series_type` are response metadata, NOT request parameters.
>
> R1 verified this against the live `swagger.json`: the **only** parameters on
> `getActivityStreams` are `id`, `keys`, and `key_by_type`. Older Strava documentation prose,
> older client libraries (**stravalib**, **stravaj**, and essentially every blog post on the
> subject) still describe `resolution=low|medium|high` and `series_type=distance|time` as query
> parameters. **They were removed and are now silently ignored.** Passing them does nothing —
> no error, no effect. If you are debugging "why won't it downsample", the answer is that it
> cannot, and you are looking at the wrong layer.
>
> The consequence is good: **activity streams always return at full recording resolution.** You
> get every point the device recorded, typically 1 Hz — a 45-minute run is ~2,700 points. The
> `"resolution": "high"` in the response is confirming you got everything.

> ### TRAP — never use `summary_polyline`. (D-121 mitigation 4.)
>
> `SummaryActivity.map.summary_polyline` is tempting because it is **free** — it arrives on the
> list endpoint, 200 activities per call, zero extra rate limit — while the `latlng` stream
> costs **one API call per activity**. Do not take the trade.
>
> | | Points, typical 10 km run | Fidelity |
> |---|---|---|
> | `latlng` stream | **~2,700** (1 Hz) | full device precision |
> | `map.polyline` (detailed rep. only) | full path | ~1.1 m quantization (precision-5 encoding) |
> | `map.summary_polyline` | **~100–300** | Ramer–Douglas–Peucker simplified; **tens of metres of cross-track error on curves**; corners cut; switchbacks and loops collapsed to straight chords |
>
> RDP decimation deletes precisely the detail fog-of-war depends on. A tight loop through a park
> becomes a chord across it: it reveals ground the user never ran, and fails to reveal ground
> they did. And by D-020 **both errors are permanent** — the map never re-fogs, so a bad reveal
> is a scar you cannot remove without rebuilding from the archive.
>
> `summary_polyline` has exactly two legitimate uses here: a cheap bounding-box prefilter, and a
> "does this activity have GPS at all" signal on the list endpoint before you spend a stream
> call. Both are allowed. Rendering it, or projecting it to H3, is not.

**Do not fetch streams for activities with no GPS.** Check the list-endpoint signals first
(`manual === true`, or an empty/absent `map.summary_polyline`) and skip the stream call. This is
both a rate-limit saving and correctness — see §2.6.

## 2.5 Rate limits and the budget

**Limits are per-application, not per-athlete.** The quota attaches to the `client_id` and is
shared across every athlete who has authorized the app. Adding a second user does not add
quota — it *splits* the existing quota. This is the single most misunderstood fact about the
Strava API and it drives the whole backfill design.

| Tier | Read (non-upload), 15 min | Read, daily | Overall, 15 min | Overall, daily |
|---|---|---|---|---|
| Default (1 athlete) | 100 | **1,000** | 200 | 2,000 |
| Upgraded (10 athletes, self-serve) | 200 | **2,000** | 400 | 4,000 |

"Non-upload" means everything except `POST /activities`, `POST /uploads`, and media upload.
**Every call Lost Soles makes is a read**, so the read bucket is the only one that ever binds.

**Headers on every response** — read them, do not model the budget locally:

```
X-RateLimit-Limit:      200,2000      # overall:  15min,daily
X-RateLimit-Usage:      12,431
X-ReadRateLimit-Limit:  100,1000      # read:     15min,daily
X-ReadRateLimit-Usage:  12,431
```

Resets: 15-minute windows on natural boundaries (:00, :15, :30, :45); daily at **midnight UTC**.
Exceeding a limit returns **HTTP 429**.

### Budget math — 1 user (MVP)

*Steady state.* 1 activity/day.
- Webhook fires → 1 × detail + 1 × streams = **2 calls**.
- Reconciliation: 4 sweeps/day × ~1 page = **4 calls**.
- Token refresh: not a read-bucket call, but count it — ~4/day at 6h TTL.
- **Total ≈ 6–10 reads/day against 1,000.** Under 1% of quota. The steady state is free.

*Backfill.* 8 years at ~200 runs/year ≈ 1,600 activities.
- Activity list: 1,600 ÷ 200 per page = **8 calls**.
- Streams: **1,600 calls** (one per activity — this is the whole cost).
- At 1,000 reads/day with 70% budgeted for backfill (700/day): **~2.3 days**, resumable.
- On the upgraded 10-athlete tier (2,000/day, 1,400 for backfill): **~1.2 days**.

Backfill is therefore a **checkpointed background job**, never a synchronous "connect your
account" flow. State per user: `{ cursor, lastActivityId, completed, failedIds[] }` in DynamoDB.
It must survive being killed at any point and resume from the cursor.

> Backfill is the one place where the raw archive (§3) pays for itself immediately: 1,600 stream
> calls are expensive and slow to re-acquire, and after 2026 they may not be re-acquirable at
> all. Archive first, normalize second.

### Budget math — 6 users (post-MVP, D-014)

Requires the self-serve 10-athlete upgrade: **2,000 reads/day, 200 per 15 min, shared**.

- Steady state: 6 users × ~1.5 activities/day × 2 calls = **18**, plus 4 sweeps/day × 6 users ×
  ~1 page = **24**. **~42 reads/day of 2,000.** Still trivial.
- Backfill: 6 × 1,600 = **9,600 stream calls**. At 1,400/day of budget that is **~7 days**, and
  it must be **serialized one user at a time** — a fan-out that runs six backfills concurrently
  will hit the 200-per-15-minutes ceiling within the first minute and spend the rest of the week
  in backoff. A single global backfill worker with a per-user FIFO is the correct shape.
- Head-room check: the 15-minute read ceiling of 200 is the tighter constraint. A backfill
  worker should pace at **≤180 calls per 15 minutes**, leaving 20 for webhooks and interactive
  traffic. That is one call every ~5 seconds — deliberately slow, and correct.

### Backoff and retry

```
on response:
  read X-ReadRateLimit-Usage / -Limit
  if usage_15min > 0.90 * limit_15min:  pause the backfill worker until the next :00/:15/:30/:45
  if usage_daily > 0.90 * limit_daily:  pause the backfill worker until 00:00 UTC

on 429:
  do NOT retry immediately, and do NOT exponential-backoff blindly — the window is fixed.
  sleep until the next quarter-hour boundary + 5s jitter, then retry once.
  if the daily bucket is the exhausted one, sleep until 00:00 UTC + jitter.

on 5xx / network:
  exponential backoff, 1s → 2s → 4s → 8s, max 5 attempts, full jitter.

on 401:
  refresh the token once (transactionally, §2.2) and retry once. A second 401 means the
  authorization is dead — emit `disconnect` and stop; do not loop.

on 404 for /streams:
  this is NOT an error. It means the activity has no streams (manual activity). §2.6.
```

The interactive path (a user pressing "sync now") and the backfill worker draw on the same
bucket. Give the interactive path a reserved floor — the backfill pauses at 90%, so the last
10% is implicitly the interactive reserve. Never let backfill consume the final slice.

## 2.6 Activity type mapping

**Always branch on `sport_type`, never on `type`.** Every activity carries both: `type` is the
legacy enum (37 values, deprecated) and `sport_type` the current one (56 values). `type` is
lossy — a `TrailRun` appears as plain `Run` in `type`, and 19 modern sport types collapse to the
single value `Workout`.

| Strava `sport_type` | Lost Soles `skill` | Trace expected? | Notes |
|---|---|---|---|
| `Run` | `wayfaring` | yes | the main case |
| `TrailRun` | `wayfaring` | yes | full credit; invisible in `type` |
| `VirtualRun` | `wayfaring` | **no** | Zwift / Peloton / footpod. Distance + XP, zero fog. |
| `Walk`, `Hike` | `wayfaring` | yes | **Policy call, flagged:** these reveal fog and grant Wayfaring XP. D-012's motivator is novelty of *place*; ground covered on foot is ground explored. If the user disagrees, this is a one-line change in the adapter's map — nowhere else. |
| `Workout`, `WeightTraining`, `Crossfit`, `HighIntensityIntervalTraining` | *(ignored)* | no | See below. |
| everything else (`Ride`, `Swim`, `Yoga`, …) | *(ignored)* | — | Archived to S3 (§3) but not ingested. Cheap to enable later; the raw payload is already kept. |

**Unknown `sport_type` values must not crash the adapter.** Strava adds sport types. Default to
"ignored", log the raw string in `sourceTypeRaw`, and archive the payload anyway. A new sport
type is a backlog ticket, not a page.

### Indoor / treadmill runs with no GPS

**This is a normal, frequent outcome and must not be an error path.**

Signals, in the order you will encounter them:
- `manual: true` — user typed it in on Strava. `map.summary_polyline` is an empty string or the
  `map` object lacks it entirely. `GET /streams` returns **404** or a stream set with no
  `latlng` key.
- `trainer: true` — recorded on a stationary machine.
- `sport_type: "VirtualRun"` — treadmill sync from Zwift/Peloton/footpod.
- A watch-recorded indoor run: has `time`, `distance`, `heartrate`, `cadence` streams and
  **no `latlng` key at all**. This one has no flag on the summary object — you find out when
  the stream response comes back without the key.

Handling:
```
1. If manual === true OR summary_polyline is empty/absent → skip the stream call entirely.
2. Otherwise fetch streams. Then:
   - 404                          → hasTrace = false, traceRef = null.  Not an error.
   - 200 without a `latlng` key   → hasTrace = false, traceRef = null.  Not an error.
   - 200 with `latlng`            → build the Trace.
3. Either way, write the Activity: it still awards Wayfaring XP and counts toward
   Constitution (D-032) volume. It simply reveals no fog and earns no Cartography.
```
Check for the *presence* of the `latlng` key before indexing into it. `streams.latlng.data[0]`
on a treadmill run is the crash you will ship if you skip this.

### Manual Strava activities

Treated exactly as above: a real `Activity` with `hasTrace: false`, `rawArchiveKey` pointing at
the archived summary JSON, and no trace. They are the user's own record of a run that happened;
they earn XP. They just cannot reveal ground, because there is no evidence of which ground.

### Strength work is NOT ingested from Strava

**D-060 is forced, not chosen.** Strava has no concept of reps, sets, or exercise-level detail
anywhere in the API. A pushup session surfaces at best as a `WeightTraining` or `Workout`
activity with a free-text `name`, an `elapsed_time`, `distance: 0`, and nothing else. Parsing
`"Pushups 3x20"` out of a title is exactly the kind of fragile heuristic that produces silent
wrong data in a permanent, append-only ledger (D-020).

So: **Might, Fortitude and Endurance (D-031) are fed only by in-app manual entry** (§4.3,
D-061). Strength-shaped Strava activities are archived and ignored. If a user logs the same
session both in Strava and in Lost Soles, only the Lost Soles one counts — which is the correct
outcome and requires no dedupe logic, because the Strava one never enters the ledger.

### Trace sanitation

A run through a tunnel or an urban canyon produces `latlng` points that jump hundreds of metres.
**Filter on implausible point-to-point speed before projecting to H3.** One bad fix paints a
revealed corridor across the city, and D-020 makes it permanent.

- Reject a point whose implied speed from the previous accepted point exceeds ~8 m/s for a run
  (~29 km/h — comfortably above any human running pace, below GPS jump magnitudes). Drop the
  point, keep the previous, continue.
- Do not interpolate across the gap; a straight line through a dropout also reveals ground that
  may not have been run. Break the trace into segments and project each independently.
- Log rejection counts per activity. A sudden rise means a hardware or firmware change worth
  knowing about.

## 2.7 Idempotency, edits, deletions, and dedupe

**All Strava IDs are strings. Always.**
`upload_id` is an int64 that exceeds `Number.MAX_SAFE_INTEGER` and is **silently corrupted by
`JSON.parse`** in Node and in the browser — no error, just a wrong number. `activity.id` has the
same hazard for recent activities. Use `upload_id_str` where Strava provides it, and parse
webhook and API bodies so that ids stay strings (a reviver, or a JSON parser with a bigint/string
mode). `sourceActivityId` in the contract (§1.1) is typed `string` for exactly this reason.

**Webhook replay.** Strava retries up to three times. Deduplicate on
`(object_id, aspect_type, event_time)` at the queue-write step: a conditional `PutItem` with
`attribute_not_exists(pk)` on the `webhook_events` table. A duplicate write is a no-op, not an
error. Give those rows a DynamoDB TTL of ~30 days.

**Idempotent ingest.** Downstream, `ingest` is keyed on `(source, sourceActivityId)` and is
itself idempotent: if the Activity already exists at the same `revision`, do nothing and do not
re-spend the stream call. The consumer must be safe to run twice on the same event, because SQS
is at-least-once and so is Strava.

**Edits.** `aspect_type: "update"` carries `updates` populated **only for title, type, and
privacy changes**. There is no event for a corrected GPS trace or a changed distance.
- `updates.type` changed → re-map the skill (§2.6). If it moved out of the running set, `retract`.
- `updates.private` → irrelevant to us. We hold `activity:read_all` and display only to the
  owner (Policy §6.1, trivially satisfied by D-014/D-123).
- `updates.title` → cosmetic; update the stored name, do not re-fetch streams.
- **Trace corrections are invisible.** Nothing tells you. The nightly 14-day reconciliation
  sweep (§2.3) is the only defence: compare `distance` and `elapsed_time` against the stored
  Activity and `reingest` on mismatch. Accept that an edit older than 14 days will be missed.
- On `reingest`: archive the new raw payload under a **new** object version (§3), write a new
  `revision`, recompute cell contributions. Never mutate the archived original.

**Deletions.** `aspect_type: "delete"` → `retract` (§1.3). The activity leaves the ledger and
XP totals; **territory stays revealed** (D-020). Cell `lastRunAt` is recomputed from surviving
activities. See §2.8 for why this is also the honest answer to Policy §6.3's 48-hour rule.

**Deauthorization.** `object_type: "athlete"` with `updates: {"authorized": "false"}` →
`disconnect`. Delete the stored tokens immediately, stop all polling for that user, mark the
connection dead. §2.8 covers what happens to the data.

**Cross-source dedupe.** This is the real risk once §4 adapters land, not now. If the same run
arrives via both Strava and GPSLogger, naive ingestion double-reveals and double-counts XP.

```
dedupeKey = sha256([
  userId,
  floor(startedAt_epoch / 60),        // start time to the minute
  round(distanceMeters / 50),         // 50 m buckets
  round(elapsedSeconds / 30),         // 30 s buckets
].join('|'))
```

On collision, **keep the higher-fidelity trace** (more points; ties broken by source priority
`healthconnect > gpslogger > suunto/polar > fileupload > strava > manual`) and record the loser
as a `duplicateOf` pointer so the archive stays complete. **Never dedupe on filename.**
`external_id` (often the device filename, e.g. `garmin_push_123456789`) is useful as a
*corroborating* signal when correlating an API activity with the same activity in a bulk export
— use it to raise confidence, never as the key on its own.

**Timezones.**
- `start_date` — real UTC, ISO-8601, trustworthy. This is `Activity.startedAt`, and the storage
  and sort key.
- `start_date_local` — local wall-clock time **serialized with a `Z` suffix that is a lie.**
  `2026-03-14T07:30:00Z` in this field means 07:30 *local*. Parsing it as UTC and converting
  double-shifts it. Strip the `Z` and store it as a naive datetime in `startedAtLocal`.
- `timezone` — a string like `"(GMT-08:00) America/Los_Angeles"`. **Not a bare IANA id.** Strip
  the `(GMT±HH:MM) ` prefix before handing it to any tz library.
- **All game-day bucketing uses `startedAtLocal`'s date component.** A 22:30 run in a
  negative-offset timezone lands on the wrong day if bucketed by UTC. Given D-013 (low upkeep,
  no streak punishment) the blast radius is smaller here than in most fitness apps, but "runs
  this week" and any daily aggregate still need to be local.

## 2.8 The honest risk register

This section exists so that the Strava decision (D-121) is a **monitored** risk rather than a
future surprise. It is written to be re-read, not to be reassuring.

### What is true

| Question | Answer |
|---|---|
| Does a permanent Strava-API-fed fog-of-war map violate the written terms? | **Yes. Unambiguously, on four independent clauses.** There is no serious argument otherwise. |
| Will that be enforced against a 6-user private app? | **Very unlikely. Sub-1% over a multi-year horizon** (R8, 90% confidence). |
| Could it break the app anyway? | **Yes — and this is the real risk.** Not via a lawyer's letter. Via a tier reshuffle, a cap downgrade, an endpoint deprecation, or the 2027 base-URL migration. |

The four clauses (all verified verbatim against the live documents by R8, effective 2026-06-01):

- **Policy §6.2 Cache and Retention** — no retention beyond **7 days**.
- **Policy §5.7 No Aggregating, Caching, or Storing User or Geographic Information** — cannot
  "aggregate, cache, or store geographic location information", except per §6.2.
- **Policy §5.5 No Scraping, Bulk Export, Harvesting** — bans "accumulating Strava Data through
  repeated authorized API calls into a corpus, dataset, archive, or database", and bans storing
  Strava Data "**or any data derived from Strava Data**, in any Persistent Index", explicitly
  including "archives, and any other storage configured to enable subsequent retrieval".
- **Policy §7.4 Deletion Obligation** — on user request, revocation, account deletion, our
  cessation of API use, or termination: delete all Strava Data and all Personal Data derived
  from it within **30 days**, and certify deletion in writing on request.

Two supporting clauses close the obvious escape hatch: **§5.4** ("The restrictions in this
Section 5.4 apply to data derived from Strava Data and to output that incorporates or was
generated using Strava Data") and **§6.4** (retention limited to purpose). So the argument "our
H3 cell set is a new artifact, not Strava Data" **does not work**. A set of revealed H3 cells is
derived data and inherits the restriction. Do not build a compliance story on it.

Two more that bite operationally: **§6.3** requires reflecting a user's Strava-side deletion
within **48 hours**, and **Agreement §6.2** (note the section-number collision with Policy §6.2)
gives Strava the right to "inspect and audit your Developer Applications for the purpose of
verifying compliance."

### R8's corrections to R1 — recorded so nobody re-litigates them

- R1 called §5.7 "new in 2026". **It is not.** Near-identical language was being quoted by
  developers in **September 2022**, and the 7-day cache rule as far back as **June 2015**.
- Genuinely new in 2026: §5.5's **"Persistent Index"** language, **§5.16** (MCP/proxy/abstraction-
  layer ban), and **§3.3** (the tier structure).
- StatsHunters, VeloViewer and intervals.icu are **not exempt; they are unenforced.** They have
  operated under substantively this prohibition for years. In Strava's own November 2024
  compliance sweep, StatsHunters — an app that permanently stores GPS polylines — was reportedly
  told it "has not been identified as being in violation". That is a fact about Strava's
  priorities, not a right anyone holds.

### The real exposure is the athlete cap, not deletion (D-102, D-121)

This is the part to internalize. The 2026 enforcement machinery is pointed at **tiers and caps**,
not at storage:

- Apps have been **downgraded from 9,999 athletes to 1 without notice or explanation**.
- **Nobody has demonstrably graduated past 10 athletes since 2026-06-01.** The 10→9,999 path is
  effectively closed to new entrants, with template denials, no feedback, and a documented
  catch-22 (a capped app cannot accumulate the usage that would justify raising the cap).
- **RunMirror — a plain single-athlete OAuth integration with no AI and no proxying — was
  rejected twice under §5.16 as an "abstraction layer."** This is the failure mode most likely
  to hit Lost Soles: a broad clause misapplied by a reviewer to an app that plainly is not the
  target, with no appeal.
- Direction of travel is one-way: §5.16 bans third-party MCP servers while §3.5 establishes
  Strava's own MCP as "the sole authorized first-party agent-mediated interface", the developer
  announcement thread is **closed for replies**, and TechCrunch's 2026-06-01 headline was
  "Strava declares war on scrapers ahead of IPO."

**Failure mode, stated plainly: friends get locked out. Data does not get deleted.** The worst
realistic outcome of the terms violation at this scale is a revoked API token — which costs the
*ingestion pipeline*, not the map, precisely because §3's archive means Strava is not the system
of record (D-101).

### Trigger conditions — migrate when any of these fire

Review this list quarterly. Any single trigger means "start §6's migration playbook", not
"panic". Two or more means do it now.

| # | Trigger | How it shows up | Response |
|---|---|---|---|
| **T1** | Athlete capacity downgraded (10 → 1, or our tier changed) | Second user's OAuth starts failing; dashboard shows a lower cap | Immediate. Friends/family is off the table on Strava. Migrate. |
| **T2** | Any compliance email from Strava, however mild | Email to the developer contact | Immediate. Do not reply improvising — read §7.4 first, decide what we are actually willing to delete, then respond. |
| **T3** | App suspended or rejected under §5.16 or §5.2 | 401/403 on all calls; dashboard status change | Immediate. This is the RunMirror failure mode. |
| **T4** | The user wants to add friends/family (D-014) | Product decision | Migrate *first*. Do not spend the 10-athlete cap discovering it has been silently reduced. |
| **T5** | Hardware purchased (D-117) | User buys a Suunto/Polar | Planned migration. This is the expected, happy path. |
| **T6** | 2027-06-01 base-URL + header-auth migration approaches | Calendar | Decide by **2027-03-01** whether to do the migration work or use the deadline as the exit. |
| **T7** | Strava subscription lapses or its price moves materially | Billing | API access dies with the subscription. Either renew or migrate; there is no third option. |
| **T8** | Streams endpoint changes shape, deprecates, or starts returning decimated data | Ingest errors; point counts drop from ~2,700 to a few hundred | Immediate — a silent fidelity drop is the worst case, because D-020 makes bad reveals permanent. **Alarm on mean points-per-km falling below a floor.** |

**Monitoring to build in MVP** (this is what converts the register from a document into a
control):
- CloudWatch alarm: any 401/403 from Strava that is not resolved by one refresh.
- CloudWatch alarm: mean `pointCount / distanceKm` for a rolling 7-day window dropping below
  ~120 (a 1 Hz run at ~5:30/km is ~330 points/km; a floor of 120 catches decimation without
  false-firing on fast running or 5-second recording).
- CloudWatch alarm: reconciliation sweep finding activities the webhooks missed, more than
  twice in a week — the push path is degrading.
- A dated note in the ticket system for **2027-03-01** (T6) and a recurring quarterly ticket to
  re-read this table.

### What we do about §7.4 and §6.3, honestly

We are not going to pretend to comply with a clause we are knowingly violating (D-121). But we
also should not be gratuitously non-compliant, and the design happens to make partial good faith
cheap:

- **On deauthorization or an explicit user deletion request:** delete tokens immediately, stop
  all polling, delete the Strava-sourced *activity records* and the *raw archive objects whose
  `source` is `strava`*. What we retain is the derived H3 cell set — which §5.4/§5.5 do cover, so
  this is mitigation, not compliance. It is stated here as a deliberate, documented choice rather
  than an oversight. D-020's permanence is a product promise to the user, and it wins.
- **On §6.3 (48h reflection of Strava-side deletions):** implemented for real, via the `delete`
  webhook and the `retract` command. The activity disappears from the ledger inside minutes.
  Territory does not re-fog.
- **Publish a privacy policy** at a prominent link (Policy §7.3) and disclose, per §2.1: what
  is collected, how, how to withdraw consent, how to request deletion, and confirmation on
  completion. This is cheap, is required, and is the sort of thing a reviewer actually looks at.
- **Attribution:** optional under Policy §4.2 — but *if* used, it must be exactly right per the
  Brand Guidelines. Recommendation: use the official **"Connect with Strava"** button on the
  OAuth entry point (required if you use it for OAuth at all: orange or white, 48px @1x /
  96px @2x, linking to `https://www.strava.com/oauth/authorize`) and nothing else anywhere.
  No "Powered by Strava" logo, no Strava marks in the app name or icon (Policy §4.1 — "Lost
  Soles" is clean), no links back to activities. Minimum trademark surface area. Note §4.4: if
  Garmin-sourced data is ever displayed, Garmin attribution is separately required.

### The counterfactual, recorded once

R1 and R8 both concluded that the **bulk data export** path is on genuinely different legal
footing, not merely stealthier: Policy §6.6 states the user's export right and that "Nothing in
this Agreement is intended to limit or condition that user-facing right", and Agreement §2.3(i)
defines "Strava Data" as data collected *from the API Materials* — so a file the user downloads
themselves is §2.3(ii) "Developer Application Data", which §5.5/§5.7/§6.2 do not reach. The
cleanest posture available was to never register an API application at all.

**The user considered this and chose the API (D-121).** It is recorded here because §6's
migration path runs straight through it: the bulk export is how history gets rebuilt, and it is
legal to keep forever.

---

# 3. The raw archive

**D-121 mitigation 2, and D-101.** *"Archive every raw trace to S3 at ingest. When the user
migrates to owned hardware, nothing is lost and the replacement adapter can backfill from the
archive."*

**Treat this as load-bearing, not as a nice-to-have.** It is the single mechanism that makes the
Strava decision reversible. Without it, D-121 is a bet that Strava stays available; with it,
D-121 is a convenience with an exit. Every trigger in §2.8 is survivable *only* because of this
bucket. If a ticket ever proposes "skip the archive for now, add it later", the answer is no —
the traces you did not archive are the ones you cannot get back.

## 3.1 Rules

1. **Archive before normalize.** The raw bytes hit S3 before the adapter's parser is trusted
   with them. A parser bug must never cost data; it must only cost a replay.
2. **Archive byte-for-byte, unmodified.** No reformatting, no pretty-printing, no key reordering,
   no stripping of fields we currently ignore. The whole value is that a future adapter can find
   something in there that we did not know we needed.
3. **Archive everything the adapter fetched, including activities we ignore** (rides, swims,
   strength-shaped workouts, §2.6). The marginal cost is kilobytes; the option value is a future
   skill (D-031: "adding a workout type adds a skill — must be modular").
4. **Append-only.** Objects are never overwritten. An edited activity (§2.7) writes a new
   `revision` prefix. Bucket versioning is on as a second line of defence, not as the mechanism.
5. **Never delete on ingest failure.** A failed normalization leaves the raw object and a
   `failed` marker. Replay later.

## 3.2 Bucket and layout

One bucket, private, versioned, SSE-S3 (or SSE-KMS if the extra ~$1/mo is acceptable under
D-083), block-all-public-access, no website hosting, no CORS.

```
s3://lostsoles-raw-archive-<accountid>-<region>/

raw/v1/
  user=<userId>/
    source=<sourceId>/
      date=<YYYY-MM-DD>/                 # UTC date of Activity.startedAt
        <sourceActivityId>/
          r<revision>/
            manifest.json                # always
            summary.json                 # strava: SummaryActivity or DetailedActivity
            streams.json                 # strava: the raw key_by_type stream response
            activity.gpx                 # gpslogger / fileupload
            activity.fit                 # watch vendor
            session.json                 # healthconnect: serialized ExerciseSessionRecord
```

`date=` is a Hive-style partition on purpose: it makes an S3 Select / Athena sweep over the
archive cheap if it is ever needed, and it keeps prefixes from growing into a single hot
directory. `source=` is the partition that matters for migration (§6) and for the §2.8 deletion
posture — "delete everything `source=strava` for this user" is one prefix delete.

`r<revision>` starts at `r0`. An edit that triggers `reingest` writes `r1`, and so on. The
highest revision is authoritative; lower ones are history and are never removed.

**`manifest.json`** — the one file we author, and the index a future adapter reads:

```json
{
  "schemaVersion": 1,
  "userId": "01J...",
  "source": "strava",
  "sourceActivityId": "1360128428",
  "revision": 0,
  "fetchedAt": "2026-08-30T09:14:22Z",
  "adapterVersion": "strava@1.0.3",
  "scopeGranted": "activity:read_all",
  "startedAt": "2026-08-30T06:31:04Z",
  "startedAtLocal": "2026-08-30T07:31:04",
  "timezone": "Europe/London",
  "sourceTypeRaw": "TrailRun",
  "distanceMeters": 10412.3,
  "elapsedSeconds": 3298,
  "hasTrace": true,
  "pointCount": 2711,
  "bbox": [-0.1401, 51.4998, -0.1103, 51.5211],
  "dedupeKey": "sha256:...",
  "artifacts": [
    { "key": "summary.json", "bytes": 4213,   "sha256": "...", "contentType": "application/json" },
    { "key": "streams.json", "bytes": 188402, "sha256": "...", "contentType": "application/json" }
  ],
  "normalizedActivityId": "01J...",
  "normalizationStatus": "ok"
}
```

`sha256` per artifact so a replay can prove the bytes are intact. `adapterVersion` so a replay
knows which parser produced the current normalized form — this is what lets a bug fix be applied
retroactively to eight years of history.

## 3.3 Format and encoding

- **Store the source's native format.** Strava streams are JSON, so JSON. GPX is XML, so XML.
  FIT is binary, so binary. Do not transcode on the way in; transcoding is a lossy decision made
  at the worst possible time.
- **gzip the JSON and XML artifacts** (`Content-Encoding: gzip`, keep the logical extension).
  A 2,700-point `streams.json` is ~180 KB raw and ~25–35 KB gzipped. FIT is already compact;
  leave it alone.
- **`manifest.json` is never gzipped** — it must be readable with a single `aws s3 cp` and no
  ceremony, at 3am, in a migration.

## 3.4 Lifecycle, cost, and durability

- **No expiration rule. Ever.** Nothing in this bucket has a TTL. Add an explicit
  `Deny s3:PutLifecycleConfiguration` in the bucket policy for anything but the transition rule
  below, so a future convenience change cannot quietly add one.
- Transition to **S3 Standard-IA at 90 days**, **Glacier Instant Retrieval at 1 year**. The
  archive is written once and read almost never (only on migration or replay), which is exactly
  the IA/GIR access pattern.
- **Cost:** 1,600 activities × ~30 KB gzipped ≈ **50 MB**. Eight years of future running at
  ~250 activities/year adds ~7.5 MB/year. At S3 Standard $0.023/GB-month this is **well under
  $0.01/month**; it never becomes a line item against D-083's few-dollars-a-month target. The
  archive is, in cost terms, free. There is no argument for skipping it.
- **Versioning on**, with a noncurrent-version transition to Glacier at 30 days. MFA-delete is
  overkill for a single-user app; a bucket policy denying `s3:DeleteObject` to everything except
  a named break-glass role is proportionate and cheap.
- The archive is the only copy of some data. Enable **S3 replication to a second region** only
  if the user later says the map is irreplaceable enough to justify roughly doubling a
  sub-cent-per-month bill. Flag as a ticket, not a blocker.

## 3.5 Backfilling a future adapter from the archive

This is the procedure §6 depends on, so it is specified here rather than described.

**The replay adapter is not a special case.** It is an ordinary `SourceAdapter` (§1.2) whose
`listSince` enumerates S3 prefixes instead of calling an API:

```ts
class ArchiveReplayAdapter implements SourceAdapter {
  // id is the ORIGINAL source, not 'archive' — provenance is preserved through a replay.
  listSince(userId, watermark) {
    // ListObjectsV2 over raw/v1/user=<userId>/source=<s>/date>=<watermark>/
    // yielding one ref per <sourceActivityId>/ at its highest r<n>.
  }
  fetch(ref) {
    // GetObject manifest.json → verify sha256s → GetObject the artifacts
    // → hand the bytes to the ORIGINAL source's parser, unchanged.
  }
}
```

**The critical property: replay reuses the original adapter's *parser*, not its *transport*.**
So the Strava adapter is really two pieces that must be separable from day one:

```
adapters/strava/
  client.ts     # OAuth, HTTP, rate limits, webhooks   ← dies at migration
  parse.ts      # bytes → Activity + Trace              ← survives forever, used by replay
```

`parse.ts` must be a pure function of `(bytes, manifest) → { Activity, Trace }` with no network,
no clock, no credentials. If it is, a replay of the entire archive is a local operation with no
Strava dependency at all, runnable years after the token is dead. **This is the single most
important structural requirement in this document**, because it is the difference between "we
have the old bytes somewhere" and "we can rebuild the map".

**Full-rebuild procedure** (also the disaster-recovery procedure, and the way a fog-scoring bug
gets fixed retroactively):

```
1. Snapshot the current DynamoDB cell table (point-in-time recovery, or an export to S3).
2. Rebuild into a NEW table, never in place:
     for each user:
       for each source prefix, in `dedupeKey` priority order (§2.7):
         for each activity, ordered by manifest.startedAt ASC:
           parse → dedupe → sanitize → project H3 res 10 → score
   Ordering by startedAt ascending is required: D-120's discovery scoring is a function of
   `now - lastRunAt`, so cells must be visited in chronological order or the half-XP and
   6-month re-arm rules produce different answers.
3. Diff the new table against the snapshot. Investigate any cell that LOST its revealed bit —
   by D-020 that is impossible and indicates a parser regression.
4. Cut over by alias/config, keep the old table for 30 days.
```

A full rebuild of 1,600 activities is a few minutes of Lambda time and costs nothing. **Run it
on a schedule — quarterly — even when nothing is wrong.** An untested restore path is not a
restore path, and this one is the entire justification for D-121.

---

# 4. Post-MVP adapters

Each of these is specified to the point where it is a ticket rather than a research project.
Order per D-121: Health Connect (D-113) or GPSLogger (D-112) first, then a watch vendor if
hardware is bought (D-117). R10's own recommendation is to **build GPSLogger first regardless**,
because it validates the ingest endpoint that every other path also needs.

## 4.1 Health Connect bridge (D-113)

**What it is:** a small sideloaded Kotlin app (~400 LOC, one screen, no GPS code, no foreground
service, no background-location permission) that reads `ExerciseRoute` records out of Android's
Health Connect and POSTs them to our ingest endpoint (§4.2 — the same endpoint).

**Sideload it (D-114).** Never publish to Google Play. Sideloading removes the Play health-apps
declaration, the background-location demo video, and the annual target-SDK deadline **entirely**.
Distribution is an APK the user installs once.

### O-004 — the open question, and the exact check

**`ExerciseRoute` is an optional field on `ExerciseSessionRecord`, not a standalone data type.**
Many fitness apps write only *summary* sessions (type, duration, distance, calories, heart rate)
and omit the route, because writing routes requires the separate `WRITE_EXERCISE_ROUTE`
permission and is opt-in engineering work. **Whether Strava writes routes is genuinely unknown**
(R10 rates it 50/50) and it is the single fact the entire path turns on. Note the perverse
incentive: Strava's whole API policy exists to stop third parties accumulating its GPS corpus,
and writing full routes into an open OS-level store undercuts that.

**The exact check for the user — five minutes, on the phone:**

> 1. **Settings → Security & privacy → Health Connect** (Android 14+), or open the standalone
>    **Health Connect** app.
> 2. **App permissions → Strava.**
> 3. Look for **"Exercise route"** in the list of permissions Strava has been granted. If
>    "Exercise route" (write) appears and is switched on, **Strava writes routes** and this path
>    is live.
> 4. Cross-check under **Data and access → Activity → Exercise** that recent Strava runs are
>    actually listed.

For a definitive answer rather than an inferred one, install Google's **Health Connect Toolbox**
sample app (or build the §4.1 bridge as a throwaway first) and read one Strava session, checking
whether `exerciseRouteResult` comes back as `Data` or `NoData`.

**If the answer is no:** this path is dead for Strava-recorded runs and GPSLogger (§4.2) or a
watch vendor (§4.4) becomes the post-MVP adapter. The bridge is still worth building later if
the user ever records in Samsung Health, which R10 rates as the best prior in the group for
actually writing routes.

### Data shape

```kotlin
ExerciseRoute.Location(
    time = Instant,               // per-point timestamp
    latitude = Double,            // WGS84
    longitude = Double,
    horizontalAccuracy = Length,  // → TracePoint.accuracyM
    verticalAccuracy = Length,
    altitude = Length,            // → TracePoint.altM
)
```

That is everything a GPX has, plus per-point accuracy that GPX usually lacks — **strictly higher
fidelity than a Strava stream**, which carries no accuracy at all. It maps onto `TracePoint`
(§1.1) with no loss.

### Permissions and constraints — all four matter

- **Permission constants:** `android.permission.health.READ_EXERCISE_ROUTES` (read) and
  `WRITE_EXERCISE_ROUTE` (write). **Google's own docs are inconsistent on singular vs plural** —
  the feature page says `READ_EXERCISE_ROUTES`, the data-types page says `READ_EXERCISE_ROUTE`.
  Resolve it at build time against the actual SDK constant
  `HealthPermission.PERMISSION_READ_EXERCISE_ROUTES`. Do not trust either doc page.
- **`ConsentRequired` on background reads.** Verbatim from the docs: *"When your app runs in the
  background and tries to read an exercise route created by another app, Health Connect returns
  an `ExerciseRouteResult.ConsentRequired` response, **even if your app has Always allow access**
  to exercise route data."* Reading a *third party's* route (our case — Strava wrote it) returns
  one of `Data`, `NoData`, or `ConsentRequired`.
  **Design consequence: sync happens on app-open, not silently.** "User never touches the phone,
  runs appear" is not achievable for third-party routes. "User opens Lost Soles, everything new
  syncs" is, with a single up-front grant. Given D-013 (low upkeep is a hard constraint) this is
  acceptable — it is one tap, not a chore — but it must be designed for, not discovered.
  Google's own guidance agrees: *"request routes upon deliberate user interaction with your app,
  when the user is actively engaged with your app's UI."*
- **30-day read window.** Without `android.permission.health.READ_HEALTH_DATA_HISTORY`, an app
  can read only the **last 30 days** of another app's data. This is a *read-window* limit rather
  than a storage-lifetime limit, but do not assume anything older is still there. Two
  consequences: (a) **historical backfill never comes from Health Connect** — it comes from the
  Strava bulk export or from our own archive (§3); (b) **a gap of more than 30 days between syncs
  permanently loses runs.** The app must nag if it has not synced in ~21 days, and the sync
  watermark must be surfaced in the UI.
- **Google imposes NO retention limit** on data lawfully read through Health Connect. The
  requirements are disclosure and a delete path — not a 7-day cache, not a 30-day deletion
  obligation. **This is the whole point of the path:** it is the same Strava-recorded run,
  arriving through a channel with no retention ceiling. (D-113.)

### Bridge sketch

```
[Screen: one button, one status line]
  "Last synced: 2026-09-14 08:02 · 12 runs imported"
  [ Sync now ]

on Sync now:
  1. ensure READ_EXERCISE_ROUTES (+ READ_EXERCISE, READ_DISTANCE) granted
  2. readRecords(ExerciseSessionRecord, TimeRangeFilter.after(lastSyncedAt ?: now-29d))
  3. for each session:
       getExerciseRoute(session.metadata.id)
         → Data          : build the point list
         → NoData        : summary-only activity, hasTrace=false
         → ConsentRequired: surface the system consent dialog (we are in the foreground)
  4. POST each session to /api/ingest as JSON (schema below), bearer token from settings
  5. advance lastSyncedAt only on a 2xx per session — never optimistically
```

Ships as an APK. Settings screen: endpoint URL + bearer token, entered once.

## 4.2 GPSLogger HTTP endpoint (D-112)

**GPSLogger** (mendhak, GPLv2, F-Droid + GitHub APKs, actively maintained, *not* on Google Play
— so no Play review, no Play policy exposure). It already POSTs finished GPX files, or per-point
JSON with a configurable method, headers, body template and basic auth, to an arbitrary HTTPS
endpoint. **We write zero Android code.** Our only work is the ingest endpoint — which D-100
requires anyway, which every other adapter reuses, and which is therefore the correct first
thing to build.

### Endpoint spec

```
POST https://lostsoles.devaultsecurity.com/api/ingest
Authorization: Bearer <per-device static token>
Content-Type: application/gpx+xml   |   application/json
```

Two accepted bodies:

**(a) Finished GPX file** — GPSLogger's "auto-send finished file" path. Body is the GPX
document. `Content-Type: application/gpx+xml` (accept `application/xml` and
`application/octet-stream` too; GPSLogger's exact header is a config detail, so be liberal).

**(b) Per-point JSON batch** — GPSLogger's "Custom URL" path with a body template:

```json
{ "deviceId": "pixel-8",
  "points": [
    { "lat": 51.5074, "lon": -0.1278, "time": "2026-09-14T07:31:04Z",
      "alt": 12.4, "acc": 4.0, "spd": 2.9 }
  ] }
```

**Responses:** `202 Accepted` with `{"accepted": <n>, "batchId": "..."}` on success (we have
archived the bytes and queued the work — we have *not* finished normalizing).
`401` on a bad token. `413` over 10 MB. `400` on unparseable body, with a plain-text reason —
GPSLogger surfaces the response, and debugging this from a phone is otherwise miserable.

**Auth:** a static bearer token per device, generated in the Lost Soles UI, stored hashed, shown
once, revocable individually. Not the user's session credential. Rate limit to something
generous but finite (e.g. 120 requests/minute per token) so a misconfigured 1-second logging
interval cannot run up an AWS bill against D-083. Log the source IP; do not allowlist it (mobile
IPs churn).

**Handler shape:** identical discipline to the Strava webhook (§2.3) — validate the token,
**write the raw body to S3 (§3) first**, enqueue, return 202. No parsing in the request path.
There is no 2-second rule here, but the pattern is the same and the code should be shared.

### GPX parsing

Parse `<trkpt lat lon>` with child `<ele>` and `<time>`; segment on `<trkseg>` boundaries.
Compute `t` as seconds since the first point of the activity. Be tolerant: namespace prefixes
vary, `<time>` is sometimes absent (fall back to index × the configured logging interval, and
mark `timeSynthetic: true` in the manifest), and extension elements differ by producer. The same
parser serves `fileupload` — a Strava bulk export is GPX, so **this parser is also the migration
tool of §6**. Write it accordingly: pure, no I/O, heavily tested against real files.

### The activity-segmentation problem, and why continuous mode may be *better*

**GPSLogger is a location logger, not a run recorder — it has no concept of "an activity."** Two
ways to live with that:

- **(a) Manual start/stop** alongside Strava. Two taps at the start of a run, two at the end.
  Each session is one activity, cleanly. Better than exporting after every run; worse than
  automatic; and it is exactly the kind of small recurring chore D-013 warns about.
- **(b) Continuous logging** at a coarse interval (a point every 30–60 s, or distance-filtered),
  with the **backend doing the segmentation**: split on time gaps > ~20 minutes or on long
  stationary periods, then classify each segment by mean speed.
  For a fog-of-war map this is **arguably superior to run-only recording**: it reveals every
  street the user ever *walked*, not just ran, and it is strictly more automatic than anything
  else in this document — zero user action, ever, which is the purest possible expression of
  D-013.

**Say the privacy consequence out loud, because it is the real cost:** continuous logging records
the commute, the school run, the shops, the pub, the doctor. It is a complete movement history,
not a workout log. D-123 currently accepts full-fidelity storage with no home-location masking on
the grounds that this is a single-user app in a private AWS account — that reasoning still holds
here, but continuous logging **materially enlarges what "full fidelity" means**. Two consequences:
(1) D-123's stated revisit trigger — friends/family accounts, or any share/screenshot feature —
becomes considerably more urgent if continuous mode is on; (2) walked ground should probably grant
Cartography (D-032) but not Wayfaring (D-031) XP, or a walk to the shops silently levels the
running skill. Both are product calls for the ticket; neither changes the ingest contract.

## 4.3 Manual entry

Two distinct paths, one UI.

**(a) Runs without GPS.** A run happened; there is no trace. Fields: date, local start time,
duration, optional distance. Produces an `Activity` with `source: 'manual'`, `hasTrace: false`,
`rawArchiveKey: null` (there are no source bytes to archive — the form submission *is* the
source; archive the submitted JSON anyway for symmetry, under
`raw/v1/.../source=manual/.../submission.json`). Awards Wayfaring XP and Constitution volume;
reveals no fog. This is the repair hatch for a dead watch battery, and it is the same code path
as a treadmill run arriving from Strava (§2.6) — which is a useful check that the contract is
right.

**(b) Strength workouts — D-060/D-061.** The primary path for Might, Fortitude and Endurance,
and **forced, not chosen**: no API anywhere exposes reps or sets. Not Strava, not Whoop, not
Fitbit.

Per D-061 the UI is a single **"Add workout" button** on the home screen — *not* per-exercise
buttons — opening a dedicated page with one quick-log row per workout type. This is chosen
specifically so that adding a future workout type does not clutter the home screen, which follows
from D-031's "adding a workout type adds a skill — must be modular". The exercise list must
therefore be **data, not layout**: a config array that both the UI rows and the `ActivitySkill`
mapping read from.

D-062: one-tap quick log for MVP; sets, reps and a rest timer are deferred — **but the data model
carries `WorkoutSet[]` from day one** (§1.1). A one-tap log writes a single set with a default
rep count; a future UI writes several. No migration, because the shape was right from the start.

These activities never have a trace, never touch S3 beyond the submission record, never hit a
rate limit, and are subject to no third party's terms. They are the one part of Lost Soles that
is entirely ours.

## 4.4 Watch vendor (D-117) — sketch only

**Contingent on a hardware purchase that is deferred indefinitely.** D-103: because of D-100 the
device decision is no longer blocking and can be made later without touching the rest of the
system. Do not build this speculatively.

**Garmin is closed (D-116).** The developer API is business-only, personal applications are
rejected, and **new applications are paused entirely as of 2026** with the form removed and no
reopening date. The unofficial workaround died on **2026-03-27**: Garmin added Cloudflare TLS
fingerprinting and `garth` — the library the entire unofficial Python ecosystem depended on —
was deprecated by its maintainer. New logins simply fail. **Do not plan on Garmin**, regardless
of what online advice says. If the user buys an Instinct 3 Solar anyway (best hardware, ~17 day
battery), ingestion is manual FIT export — a chore, and a D-013 problem.

| Candidate | API | Battery | Price | Adapter viability |
|---|---|---|---|---|
| **Suunto Race 2** | Gated but the application form is open; ~2-week review; **real webhook API**; non-commercial use allowed | ~14 d (Whoop parity) | $499 | **First choice.** Webhook + FIT download maps cleanly onto §1.2. |
| **Polar Vantage M3** | **Self-serve AccessLink, no gate**, and **no retention cap in the licence** | ~6 d | $399 | **Guaranteed fallback.** Polling rather than push, which is fine at this volume. |
| **Garmin Instinct 3 Solar** | **None** (D-116) | ~17 d | $399 | Manual FIT export only. |

**Adapter sketch (either vendor):** OAuth for the connection; webhook (Suunto) or scheduled poll
(Polar) for `listSince`; `fetch` downloads the **FIT** file; archive the FIT bytes verbatim
(§3.3 — do not transcode); parse FIT records to `TracePoint[]`. FIT parsing is the only genuinely
new code — everything downstream of `parse.ts` already exists. Estimated one adapter module, no
changes anywhere else. **That estimate is the claim §6 tests.**

**Framing, from R9:** a watch purchase is a **Whoop-replacement decision, not a legal necessity.**
Whoop runs $199–$359/yr; a $399–499 watch pays for itself in 14–18 months against the mid tier and
then runs free, *and* records the runs. DC Rainmaker's August 2026 testing found no meaningful
accuracy difference between vendors on sleep and HRV. Buy a watch to buy automation and to replace
Whoop — not to become compliant.

---

# 5. Wearables and platforms ruled out

Recorded so that nobody re-researches these. Each was investigated (R2, R9, R10) and rejected for
a concrete, checkable reason.

## Whoop — REJECTED as a trace source

- The **WHOOP Developer Platform v2** is genuinely open: free, self-serve, no partner gate,
  10-member cap on an unapproved app (enough for D-014's six people). None of that is the problem.
- **The workouts endpoint carries no GPS and no route.** The Whoop band has **no onboard GPS at
  all**, so there is nothing to expose. A Whoop workout is strictly worse than the same workout
  arriving from Strava — which is where it goes anyway.
- **No reps or sets either**, so it does not help D-060.
- **The API Terms of Use forbid building a permanent local database of WHOOP data.** A permanent
  XP ledger recording "recovery was 68% on 2026-08-30" is arguably a violation — the same class of
  problem as Strava's, on a data type that contributes nothing to the map.
- **Residual option, explicitly not in MVP:** recovery, HRV, resting HR and sleep are things
  Strava does not expose, and could feed a "stamina / rest bonus" game mechanic. If that is ever
  built, store only *derived* game state ("Rest Bonus tier: 3") and re-fetch raw values on demand.
  Nice-to-have flavour, never a blocker. Note also R9's framing: the watch decision (§4.4) is
  really a **Whoop-replacement** decision, so this API may well be moot.

## Fitbit / Google Health API — REJECTED

- The **Fitbit Web API is decommissioned September 2026** — this month. Building on it now would
  be building on something already gone.
- Its replacement, the **Google Health API**, puts *every* scope behind Restricted-scope review
  **plus an annual paid CASA security audit**. That is enterprise-grade overhead for a
  few-dollars-a-month hobby app (D-083), and it is a recurring cost and a recurring deadline.
- **The Fitbit Air has no GPS anyway**, so even a frictionless API would contribute nothing to
  the fog-of-war map.

## Apple Health — REJECTED (structural, not a preference)

HealthKit has no web API. Data is reachable only from a **native iOS/watchOS app on the device**,
which for a web app (D-080) means building and distributing an iOS app purely as a data courier,
with an Apple Developer Program membership and App Store review attached. If the user is ever on
iOS, the realistic path is the same as §4.2 — a third-party recorder POSTing to `/api/ingest` —
not a HealthKit integration.

## Health Connect as a *native* dependency — SCOPED, not rejected

Distinguish two things. **Health Connect the data store is in scope** (§4.1, D-113). What is
ruled out is any expectation that a *web* app can read it: Health Connect is an Android
system-level API with no web surface, so it always requires the sideloaded Kotlin bridge (D-114).
That is why §4.1 is a small native app and not an API integration.

## PWA run recording — REJECTED (D-110)

The user's instinct that "it needs to be an Android app" was **correct**. A PWA cannot record a
run:

- **Screen Wake Lock is auto-released when the tab hides.** Pocket the phone and the lock dies.
- **There is no service-worker geolocation.** `watchPosition` requires a live foreground document.
- A pocketed phone loses the trace in roughly **90 seconds**.

Do not revisit this. The workaround set (keep the screen on, keep the app in front for 45
minutes) is not a workaround, it is a defect.

## Share-sheet GPX import — REJECTED (D-111)

`share_target` works fine as a web platform feature. The blocker is on Strava's side:
**Strava has no GPX export in its mobile app at all** — export is website-only, per Strava's own
support documentation. The imagined "finish run → share to Lost Soles" flow **does not exist**.
Getting a GPX out of Strava on a phone is roughly six to eight taps through the mobile website.

Build the `share_target` handler anyway — it is about half a day and it is the **manual repair
hatch** for a file that arrives from anywhere else (a friend's export, an old archive, a watch's
companion app). Just do not mistake it for an automation path. The equivalent conclusion from R10
is that "manual file upload as the *primary* path" was correctly rejected in O-001: it becomes a
chore, and D-013 makes chores fatal.

---

# 6. Migration playbook

The purpose of this section is to make D-100's boundary **falsifiable**. If migration cannot be
described as a short, concrete list of changes, the boundary is not real and §2 has quietly become
the architecture.

## 6.1 Trigger

Any row in §2.8's trigger table. The expected happy path is **T5** — the user buys a Suunto Race 2
or a Polar Vantage M3 (§4.4, D-117). The unhappy paths are T1 (cap downgrade — friends locked out)
and T3 (suspension under §5.16, the RunMirror failure mode).

**Migrate before the trigger where you can.** T4 in particular: if friends and family are being
added, migrate *first* rather than discovering mid-onboarding that the 10-athlete cap has been
silently reduced to 1.

## 6.2 Steps

```
D-14   Buy the hardware. Record with BOTH the new device and Strava for two weeks.
       Overlap is deliberate: it produces paired traces of the same runs, which is the
       only way to validate the new parser against a known-good reference (§6.4).

D-10   Build the vendor adapter (§4.4): client.ts (OAuth + webhook/poll + FIT download)
       and parse.ts (FIT → Activity + Trace). One new directory under adapters/.
       Nothing outside adapters/ is touched. If that claim fails, stop — the boundary
       leaked and the leak must be fixed before the migration, not during.

D-7    Run both adapters live. Cross-source dedupe (§2.7) is now doing real work for the
       first time: the same run arrives twice, and the dedupeKey must collapse them with
       the vendor trace winning on source priority. Watch the duplicateOf counts.
       Zero duplicates is a BUG, not a success — it means the key is too tight.

D-0    Request the Strava bulk data export from the website. It is legal to keep forever
       (Policy §6.6, verified verbatim by R8), and it is the clean-provenance replacement
       for the API-sourced archive. Delivery is asynchronous — hours to days. Request it
       BEFORE disconnecting anything.

D+1    Ingest the bulk export through the `fileupload` adapter, reusing the GPX parser
       already written for §4.2. Every activity now exists with clean provenance,
       deduped against the existing rows.

D+2    Disable the Strava adapter: DELETE /push_subscriptions/{id}, then
       POST /oauth/revoke (Basic auth, client credentials). Delete the stored tokens.
       Do NOT delete the raw archive yet — see §6.5.

D+3    Full rebuild from the archive (§3.5) into a new table, chronologically ordered,
       and diff against the live table. Any cell that LOST its revealed bit is a
       parser regression by D-020 and must be investigated before cutover.

D+30   Post-migration review. Delete the `source=strava` archive prefix only if the
       §7.4 posture in §2.8 calls for it and the bulk-export ingest is verified complete.
```

## 6.3 What changes, and what does not

**Changes — one directory, one config value:**

| | |
|---|---|
| `adapters/strava/` | deleted, or left in place and disabled by config |
| `adapters/suunto/` (or `polar/`) | **new** — `client.ts` + `parse.ts`, ~2 files |
| `SourceId` union (§1.1) | one member added, one possibly removed |
| Source-priority list in the dedupe rule (§2.7) | one line |
| The webhook route for Strava | removed; the vendor's added |
| Secrets: Strava client id/secret | removed; vendor credentials added |
| Config: `ENABLED_ADAPTERS` | edited |

**Does not change — and this list is the whole point of D-100:**

- The `Activity` and `Trace` interfaces (§1.1). Not one field.
- The ingest pipeline steps 3–7 (§1.3): dedupe, sanitation, H3 projection, fog scoring,
  persistence. They have never known what a source is.
- The H3 res-10 cell table (D-115, D-082) and every revealed cell in it. **The map does not
  flicker.** Not one cell re-fogs; not one `lastRunAt` moves.
- The skill and XP system (D-030/D-031/D-032/D-033) and every level the user has earned.
- D-120's fog rules — half XP on re-run, zero discovery inside 6 months, 50% re-arm beyond it.
- The map renderer, both modes (D-052).
- The route planner (D-070), when it exists.
- The strength-logging path (§4.3) — it never touched Strava at all.
- The ingest endpoint (§4.2) and the raw archive (§3), which are source-shaped by design.

**The user-visible change is a settings screen and a two-week overlap. Nothing else.** If a
migration ticket ever proposes touching the cell table or the XP ledger, that is the signal that
the boundary leaked, and the fix is to restore the boundary rather than to proceed.

## 6.4 How the archive backfills history

Two independent sources of history, and using both is the belt-and-braces:

1. **The S3 raw archive (§3).** Every trace ever ingested, in its original bytes, replayable by
   `ArchiveReplayAdapter` (§3.5) with **no Strava dependency** — because `parse.ts` is a pure
   function and the transport is a separate file. This works even if the Strava account is gone,
   the token is revoked, and the app is suspended. It is the backstop that makes every §2.8
   trigger survivable.
2. **The Strava bulk data export.** Clean provenance — Policy §6.6 states the user's export right
   and that "Nothing in this Agreement is intended to limit or condition that user-facing right",
   and Agreement §2.3(i) scopes "Strava Data" to data collected *from the API Materials*, so
   exported files are §2.3(ii) Developer Application Data and fall outside the retention clauses
   entirely. Ingest it through the `fileupload` adapter and every historical activity acquires a
   provenance that does not depend on the API at all.

**Do both.** Ingest the bulk export, let dedupe (§2.7) collapse it against the archived rows, and
verify the counts match. Divergence between the two is the highest-value bug report the system can
produce — it means either the API adapter missed activities (check the reconciliation sweep) or the
export is incomplete (check with Strava). Either way, better to find out during a planned migration
than during an unplanned one.

**The two-week overlap in §6.2 is the parser validation.** Paired traces of the same run from two
independent devices give a direct check that the FIT parser and the stream parser produce
comparable point counts, comparable bounding boxes, and — the number that actually matters — the
same set of H3 cells. Diff the cell sets. A systematic offset is a coordinate-system bug; a
systematic *shortfall* is a decimation bug of exactly the kind §2.4 warns about.

## 6.5 Do not delete the archive

Even after migration, `source=strava` objects in the raw archive are the only copy of some
historical traces — the bulk export covers activities Strava still holds, which is not necessarily
everything the archive holds (an activity deleted on Strava is gone from the export but present in
our archive). §2.8 sets out the honest position on §7.4. Whatever is decided there, decide it
**deliberately, at D+30, with the bulk-export ingest verified complete** — not casually, as
cleanup, during the migration itself.

---

## Appendix — decision references used

D-013 (low upkeep), D-014 (≤6 users), D-020 (permanent reveal, append-only), D-031/D-032
(skills), D-060/D-061/D-062 (strength logging, "Add workout" page, sets from day one),
D-080/D-081/D-083 (Amplify, no VPC Lambdas, cost target), D-082/D-115 (DynamoDB, H3 res 10),
D-100 (source-agnostic adapters), D-101 (user files are the system of record), D-102/D-103
(Strava as convenience adapter; device decision unblocked), D-110/D-111 (PWA recording and
share-sheet import rejected), D-112 (GPSLogger), D-113 (Health Connect), D-114 (sideload),
D-116 (Garmin closed), D-117 (watch candidates), D-120 (fog/XP rules), D-121 (Strava MVP +
four mitigations), D-122 (MVP scope), D-123 (no home-location masking, with a revisit trigger).

Open: **O-004** (does Strava write routes to Health Connect — §4.1 has the exact check).
