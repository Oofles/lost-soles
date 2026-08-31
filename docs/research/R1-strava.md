# R1 — Strava API Research Brief

**Project:** Lost Soles (fog-of-war running gamification webapp)
**Researched:** 2026-08-30
**Governing documents read in full (not summarized from memory):**
- [Strava API Agreement (2026)](https://www.strava.com/legal/api) — effective **June 1, 2026**
- [Strava API Policy (2026)](https://www.strava.com/legal/api_policy) — effective **June 1, 2026**, incorporated by reference into the Agreement
- [Strava API Brand Guidelines](https://developers.strava.com/guidelines/) — last revised September 29, 2025
- [Strava Terms of Service (2026)](https://www.strava.com/legal/terms)
- [developers.strava.com](https://developers.strava.com/docs/) + the raw Swagger specs (`swagger.json`, `stream.json`, `activity.json`, `sport_type.json`, `map.json`)

> **Critical context:** Strava rewrote its developer terms effective **June 1, 2026** — three months ago. The old single "API Agreement" was split into a thin **Agreement** plus a much more restrictive **API Policy**. Most blog posts, Stack Overflow answers, and library docs you will find describe the pre-2026 regime. Anything written before June 2026 about what you may store is **stale**. This brief is based on the live text as of 2026-08-30.

---

## VERDICT

### Q: Can Lost Soles legally and technically store Strava GPS traces indefinitely and render them as fog-of-war on a MapLibre/OSM map?

**Three separate answers, because the question has three separable parts:**

---

**1. Storing Strava-API-sourced GPS traces indefinitely — NO. Clearly prohibited. Confidence: HIGH (95%).**

This is not ambiguous under the 2026 Policy. Four independent clauses each forbid it:

> **§6.2 Cache and Retention** — "You may not retain Strava Data in your cache for longer than seven (7) days. […] Except for such limited caching, you may not store Strava Data, or provide or display Strava Data or any associated service, to any third party other than the Strava user using your Developer Application."

> **§5.7 No Aggregating, Caching, or Storing User or Geographic Information** — "You may not use or access the Strava API Materials to **aggregate, cache, or store geographic location information** or other user information accessible via the Strava API, except as expressly permitted by Section 6.2."

> **§5.5 No Scraping, Bulk Export, Harvesting, or Automated Extraction** — "You may not bulk-export Strava Data, including by **accumulating Strava Data through repeated authorized API calls into a corpus, dataset, archive, or database** that exceeds the operational scope of your Developer Application. You may not store Strava Data, **or any data derived from Strava Data, in any Persistent Index.** The foregoing prohibits indefinite storage in vector stores, embedding stores, search indexes, knowledge graphs, retrieval-augmented data stores, **archives, and any other storage configured to enable subsequent retrieval, query, or use.** The seven-day cache permitted under Section 6.2 is not a Persistent Index, provided that the cache is operated as a transient cache…"

> **§7.4 Deletion Obligation** — on user revocation, account deletion, user request, your cessation of API use, or termination, you must "promptly and permanently delete […] all Strava Data and all Personal Data derived from Strava Data" within **thirty (30) days**.

A fog-of-war map is, definitionally, an ever-growing archive of geographic location data accumulated through repeated API calls and configured for subsequent retrieval. It is the exact thing §5.5 and §5.7 name. There is no reading of these clauses under which an indefinite Strava-API-fed trace store is compliant.

The "derived data" escape hatch is explicitly closed. §5.5 covers "any data derived from Strava Data"; §5.4 states "The restrictions in this Section apply to data derived from Strava Data and to output that incorporates or was generated using Strava Data." So you cannot argue that a rasterized reveal-mask or a set of H3 cells is a new, non-Strava artifact. It is derived from Strava Data and inherits the restriction.

Note the 7-day cache rule is **not new** — near-identical language existed in the pre-2024 agreement ("No Strava Data shall remain in your cache longer than seven days") and was famously under-enforced; large apps like intervals.icu visibly retain history for years. What is new in 2026 is (a) the explicit "Persistent Index" language that forecloses the derived-data workaround, (b) the explicit geographic-data clause §5.7, and (c) Strava's stated intent to actually enforce, backed by §6.2 of the Agreement ("Strava […] shall be entitled to inspect and audit your Developer Applications for the purpose of verifying compliance"). Do not plan around non-enforcement.

---

**2. Rendering that data on MapLibre / OpenStreetMap tiles instead of Strava's map — YES, THIS IS FINE. Confidence: HIGH (90%).**

**This is the good news, and it is the opposite of what the project brief feared.** I grepped the complete text of both the Agreement and the Policy for `map`, `tile`, `polyline`, `geograph`, and `location`. There is **no clause anywhere in the current Strava API Agreement, API Policy, or Brand Guidelines that restricts which map provider or tile source you render Strava-derived data on.** The only hits are §5.7 (quoted above, about *storing*, not *rendering*) and a Personal Data definition mentioning "geolocation."

The historic restriction the brief was worried about does not exist in the current text. What *does* exist — and what the November 2024 change was actually about — is **§2.3 / §6.1 Display Limited to the Authenticated User**: you may show a given user's Strava data only to that user, never to other users, even if public on Strava. That is a *who-can-see-it* rule, not a *what-basemap* rule. For a single-user app this is trivially satisfied.

So: MapLibre GL JS + OSM/Protomaps/MapTiler basemaps are unobjectionable. The map stack is not the problem. **The retention is the problem.**

---

**3. The same app, fed by the user's own bulk data export instead of the API — YES, LEGAL, INDEFINITELY. Confidence: HIGH (90%).**

The Policy contains an explicit, unconditional carve-out:

> **§6.6 User Bulk Data Export** — "Each Strava user has the right to access and export the user's own Strava data, free of charge, through the Bulk Data Export Tool published on the Strava service. **Nothing in this Agreement is intended to limit or condition that user-facing right.**"

Combined with two other facts:

- **§2.3(i) of the Agreement** defines the regulated category narrowly: *"'Strava Data' means all data you access or collect **from the Strava API Materials**"*. A GPX/FIT/TCX file that the user downloads from their own account and hands to your app was not accessed from the API Materials. Under §2.3(ii) it is **"Developer Application Data"** — "all other data you access or collect in connection with any of your Developer Applications" — which the retention clauses in §5.5, §5.7, and §6.2 do **not** cover. (Note §6.4 "Retention Limited to Purpose" does mention "Data" generically, which includes Developer Application Data — but the purpose here *is* permanent map exploration, so retention for that purpose is within its terms.)
- **Strava ToS §6** — "You will remain the owner of intellectual property rights (such as copyright) in your Content," where Content expressly includes "routes, segments, or other data."

The cleanest possible posture: **do not register a Strava API application at all.** If you never accept the API Agreement, it never binds you, and ingesting your own exported GPX files is simply you processing files you own on hardware you control. Nothing in Strava's user-facing ToS restricts what a user does with their own exported activity files.

---

### Bottom line for architecture

> **Build the permanent fog-of-war store on user-supplied activity files (bulk export + ongoing per-activity export, or direct-from-device GPX/FIT). Treat the Strava API — if you use it at all — as an optional, ephemeral convenience layer with a hard 7-day TTL, never as the system of record.**

This is not a workaround that merely dodges enforcement; it is a genuinely different legal footing that Strava's own Policy §6.6 explicitly declines to condition.

### Ambiguities I am flagging rather than resolving

- **§6.4 "Retention Limited to Purpose"** says: "Except as expressly permitted by Section 6.2, you may not retain Data, and you may use and retain Data only so long as necessary for the purpose for which it was originally obtained." "Data" here is the union of Strava Data *and* Developer Application Data. A hostile reading stretches this over user-uploaded files too. I think the better reading is that §6.4's first clause is scoped to Strava Data (it is in "Section 6 Data Rights and Retention," directly under the cache rule) and that the second clause is a purpose-limitation, not a duration cap — and a lifelong exploration map's purpose *is* permanent retention. But it is not airtight, and it is one reason to prefer never registering an app.
- **Whether a hybrid is safe.** If you *do* register an API app and *also* ingest user-uploaded files, the provenance of any given trace becomes a factual question you'd have to defend in an audit (Agreement §6.2 gives Strava audit rights). If you go hybrid, keep a hard provenance column on every trace row and never let API-sourced rows into the permanent store. Cleaner still: don't go hybrid.
- **No Strava staff member has ever publicly answered the "can I store longer than 7 days" question.** Community threads asking this have gone unanswered since 2015 ([google groups](https://groups.google.com/g/strava-api/c/PJnl2Xlb1ow), [community hub](https://communityhub.strava.com/developers-api-7/storing-activity-data-for-more-than-7-days-11716)). There is no informal blessing to rely on.
- **§5.2 "No Competing or Imitating Applications."** Strava ships a Personal Heatmap and a Global Heatmap. A personal fog-of-war exploration map is arguably adjacent to the Personal Heatmap feature. §5.2 is written broadly ("in any manner that is competitive to Strava or the Strava Platform") and §5 opens with "Strava shall determine **in its sole discretion**" whether you comply. A private single-user app is a negligible practical risk, but there is no bright line here. See §6.5 below.

---

## 1. OAuth

Source: [developers.strava.com/docs/authentication](https://developers.strava.com/docs/authentication/)

### Flow
Standard OAuth 2.0 authorization-code grant.

1. **Authorize** — `GET https://www.strava.com/oauth/authorize` (web) or `https://www.strava.com/oauth/mobile/authorize` (mobile), with `client_id`, `redirect_uri`, `response_type=code`, `scope`, optional `state`, optional `approval_prompt=force`.
2. **Exchange** — `POST https://www.strava.com/oauth/token` with `client_id`, `client_secret`, `code`, `grant_type=authorization_code`.
   Response: `access_token`, `refresh_token`, `expires_at` (unix), `expires_in` (seconds), `athlete` summary, and the granted `scope` list.
3. **Refresh** — `POST https://www.strava.com/oauth/token` with `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token`.

### Scopes (exact names)

| Scope | Grants |
|---|---|
| `read` | public segments, public routes, public profile data, public posts, public events, club feeds, leaderboards |
| `read_all` | private routes, private segments, private events |
| `profile:read_all` | all profile info regardless of the user's visibility setting |
| `profile:write` | update weight and FTP |
| `activity:read` | activity data for activities visible to Everyone and Followers |
| **`activity:read_all`** | **everything in `activity:read`, plus privacy-zone data and "Only You" activities** |
| `activity:write` | create manual activities and uploads; edit any activity |

**For Lost Soles you want `activity:read_all`.** `activity:read` alone silently drops any activity the user has set to "Only You" and, critically, returns **privacy-zone-redacted** GPS — Strava truncates the start/end of traces inside a user's privacy zones. For a fog-of-war map that means a permanent unexplored donut around the user's home. `activity:read_all` is the only scope that returns un-redacted streams. Scopes are comma-separated in the authorize URL; users can decline individual scopes, so always check the returned `scope` field rather than assuming.

### Token lifetime & refresh behavior
- **Access tokens expire six (6) hours after creation.** Use the returned `expires_at` rather than assuming.
- Refresh tokens are **rotating**: "The refresh token may or may not be the same refresh token used to make the request." Every refresh response may carry a new `refresh_token`, and once it does, the previous one is invalid. **You must persist the refresh token transactionally on every refresh** — a lost write here permanently orphans the connection and forces re-authorization. This is the single most common integration bug.
- Practical implication for a serverless design: refresh tokens are long-lived mutable state. Store them in Secrets Manager or a DynamoDB row with a conditional write, never in an env var.

### Deauthorization / revocation
- Legacy: `POST https://www.strava.com/oauth/deauthorize` with the `access_token`.
- **Recommended as of June 1, 2026:** `POST https://www.strava.com/oauth/revoke`, authenticated with **HTTP Basic Auth using client credentials**.

Revocation is a §7.4 trigger — see §6.6 below.

---

## 2. Activity and Stream Data

### Activity endpoints
- `GET /athlete/activities` — the athlete's activities, paginated. Params: `before`, `after` (unix epoch), `page`, `per_page` (max 200). Returns `SummaryActivity` objects. This is your backfill and reconciliation workhorse.
- `GET /activities/{id}` — `DetailedActivity`, with `include_all_efforts` param.
- `GET /activities/{id}/streams` — the real prize.
- `GET /activities/{id}/laps`, `/zones`, `/comments`, `/kudos`.

### The Streams endpoint

`GET https://www.strava.com/api/v3/activities/{id}/streams`
Requires `activity:read` scope; requires `activity:read_all` for "Only Me" activities.

**Parameters (from the authoritative `swagger.json`):**
- `keys` — **required**, CSV array, minItems 1.
- `key_by_type` — **required**, boolean, "Must be true." (Set it to `true` and the response is an object keyed by stream type rather than a bare array. There is effectively no other supported mode.)

**All eleven valid stream types (the complete `StreamType` enum):**

`time`, `distance`, `latlng`, `altitude`, `velocity_smooth`, `heartrate`, `cadence`, `watts`, `temp`, `moving`, `grade_smooth`

Note there is **no `power` key** — it is `watts`. And **no `temperature`** — it is `temp`.

**Data formats:**

| Key | Element type | Unit |
|---|---|---|
| `time` | integer | seconds since start |
| `distance` | float | meters (cumulative) |
| `latlng` | `[lat, lng]` float pair | WGS84 degrees |
| `altitude` | float | meters |
| `velocity_smooth` | float | meters/second |
| `heartrate` | integer | bpm |
| `cadence` | integer | rpm |
| `watts` | integer | watts |
| `temp` | integer | °C |
| `moving` | boolean | — |
| `grade_smooth` | float | percent |

All streams for a given activity are **index-aligned and equal length** — element *i* of `latlng` corresponds to element *i* of `time`, `altitude`, etc. This is what makes the streams format so much better than a GPX for your purposes: you can zip them into a single array of point records with no interpolation.

**Every stream object carries three metadata fields** (`BaseStream` in `stream.json`):
- `original_size` — integer, number of data points
- `resolution` — enum `low` | `medium` | `high`, "the level of detail (sampling) in which this stream was returned"
- `series_type` — enum `distance` | `time`, "the base series used in the case the stream was downsampled"

### ⚠️ Resolution options: a correction

**`resolution` and `series_type` are response metadata only. They are NOT request parameters on the activity streams endpoint in the current API.** I verified this against the live `swagger.json`: the only parameters on `getActivityStreams` are `id`, `keys`, and `key_by_type`. Older documentation, older client libraries (stravalib, stravaj, many blog posts), and even the prose on some of Strava's own doc pages still describe `resolution=low|medium|high` and `series_type=` as query params — **they were removed and are silently ignored.**

**Practical consequence, and it is a good one: activity streams always return at full recording resolution.** You get every point the device recorded — typically 1 Hz, so a 45-minute run is ~2,700 points. You cannot ask for less, and you don't want to. The `resolution: "high"` you see in the response is confirming you got everything.

(For comparison: `/segments/{id}/streams` accepts only `distance`, `latlng`, `altitude`; `/segment_efforts/{id}/streams` accepts all eleven; `/routes/{id}/streams` takes no `keys` at all.)

### Summary polylines on the activity object — and why they are not good enough

The `SummaryActivity` and `DetailedActivity` objects both carry a `map` field of type `PolylineMap`:

```json
{ "id": "a12345", "polyline": "...", "summary_polyline": "..." }
```

- **`summary_polyline`** — present on both summary and detailed representations. Google Encoded Polyline Algorithm Format, precision 5.
- **`polyline`** — the full-resolution polyline, but per the schema, "only returned on detailed representation of an object," i.e. only from `GET /activities/{id}`, not from the list endpoint.

**Precision comparison — this matters a lot for fog-of-war:**

| | Points for a typical 10 km run | Accuracy |
|---|---|---|
| `latlng` stream | ~2,700 (1 Hz) | full device precision |
| `map.polyline` (detailed) | full path | ~1.1 m quantization from precision-5 encoding |
| `map.summary_polyline` | **~100–300** | Ramer–Douglas–Peucker simplified; **tens of metres of cross-track error on curves**, corners cut, switchbacks collapsed to straight lines |

`summary_polyline` is built for drawing a thumbnail of a route in a feed card at 200 px wide. It is a decimated curve, and RDP decimation deletes exactly the detail that fog-of-war reveal depends on — a tight loop through a park becomes a chord across it, revealing terrain you never ran and failing to reveal terrain you did.

**Recommendation:** use it only as a cheap bounding-box / dedupe / preview signal. The reveal mask must be computed from the full `latlng` stream (API path) or from the GPX/FIT trackpoints (export path).

**Cost note:** `summary_polyline` is free — it arrives on the list endpoint, 200 activities per call. The `latlng` stream costs **one API call per activity**. That asymmetry drives the rate-limit math in §4.

---

## 3. Webhooks / Push Subscriptions

Source: [developers.strava.com/docs/webhooks](https://developers.strava.com/docs/webhooks/)

### Setup — a two-step handshake

**Step 1.** `POST https://www.strava.com/api/v3/push_subscriptions` with `client_id`, `client_secret`, `callback_url`, `verify_token` (any string you choose).

**Step 2.** Before that POST returns, Strava synchronously issues a `GET` to your `callback_url` with three query params:

| Param | Value |
|---|---|
| `hub.mode` | always `subscribe` |
| `hub.challenge` | random string you must echo |
| `hub.verify_token` | the token you supplied — **compare it and reject on mismatch** |

You must reply **HTTP 200 within two seconds**, `Content-Type: application/json`, body exactly:

```json
{"hub.challenge": "<the value received>"}
```

Note the dot in the JSON key — it is literally `hub.challenge`, not `hub_challenge`. This trips people up.

Only if that succeeds does the POST return your `subscription_id`.
Management: `GET /push_subscriptions` to view, `DELETE /push_subscriptions/{id}` to remove.

### Event payload

```json
{
  "object_type": "activity" | "athlete",
  "object_id": 1360128428,
  "aspect_type": "create" | "update" | "delete",
  "updates": { "title": "...", "type": "...", "private": "true" },
  "owner_id": 134815,
  "subscription_id": 120475,
  "event_time": 1516126040
}
```

- `updates` is populated only on `update` events, and **only for title, type, and privacy changes**. There is no event for "the user corrected the GPS trace" or "distance changed."
- For `object_type: "athlete"`, the only meaningful event is a deauthorization: `updates` contains `{"authorized": "false"}`. **This is your §7.4 deletion trigger — wire it up.**
- **The payload contains no activity data.** It is a pointer. You must call `GET /activities/{id}` and `/streams` to get anything useful, which costs rate limit.

### Delivery guarantees — weak, plan for it

- Your endpoint must return **HTTP 200 within two seconds** or the delivery is considered failed.
- Strava retries **up to three times total**. After that the event is dropped, permanently and silently.
- There is **no replay mechanism and no dead-letter queue on Strava's side.**

**This is not an at-least-once delivery system you can build a system of record on.** You need a periodic reconciliation sweep over `GET /athlete/activities?after=<watermark>` to catch drops. Treat webhooks as a latency optimization, never as the sole ingestion path.

### Limits
- **One subscription per application.** Not per athlete — a single subscription delivers events for every athlete who has authorized your app. Since you get exactly one, its callback URL is effectively permanent infrastructure; changing it means delete + recreate.
- Scope interaction: `activity:read_all` is required to receive events for "Only You" activities. For apps with only `activity:read`, a privacy change surfaces as a synthetic `delete` or `create` rather than an `update`.

### What a serverless endpoint must do

The 2-second budget is the entire design constraint. A cold-start Lambda behind API Gateway can exceed it.

1. **Two routes on one URL.** `GET` → validation handshake (must be public, unauthenticated — Strava sends no credentials). `POST` → event receipt.
2. **Verify then acknowledge, in that order, immediately.** Check `hub.verify_token` on GET. On POST, validate the payload shape and `subscription_id`, then return 200 **before doing any work.**
3. **Never fetch Strava data inside the request.** Write the event to SQS/EventBridge/DynamoDB and return. Do the token refresh, activity fetch, and stream fetch in an async consumer.
4. **HTTPS on port 443 with a valid certificate chain.** Self-signed and misconfigured intermediate certs are the most common handshake failure. AWS API Gateway with an ACM cert is fine. (Strava publishes no source IP list, so IP allowlisting is not available — authenticate via `verify_token` and payload validation instead.)
5. **Provisioned concurrency or a lightweight runtime** to stay inside 2 s on cold start.
6. **Idempotency.** Retries mean you will receive the same `object_id`/`aspect_type` more than once. Key on `(object_id, aspect_type, event_time)`.

---

## 4. Rate Limits

Source: [developers.strava.com/docs/rate-limits](https://developers.strava.com/docs/rate-limits/)

### Current numbers

**Default (1-athlete "single-player" apps):**

| Bucket | 15-minute | Daily |
|---|---|---|
| Overall | 200 | 2,000 |
| Read / "non-upload" | 100 | 1,000 |

**Upgraded (10-athlete tier, self-service from the API dashboard):**

| Bucket | 15-minute | Daily |
|---|---|---|
| Overall | 400 | 4,000 |
| Read / "non-upload" | 200 | 2,000 |

"Non-upload" = everything except `POST /activities`, `POST /uploads`, and `activities#upload_media`. **Every call Lost Soles makes is a read call**, so the read bucket is the one that binds: effectively **100 per 15 min / 1,000 per day**, or 200 / 2,000 upgraded.

### Scaling model — this is the important part

**Limits are per-application, not per-athlete.** The quota is attached to your `client_id` and is shared across every athlete who has authorized your app. Adding a second user does not add quota; it splits the existing quota. With 5 friends on the 10-athlete tier you have 2,000 reads/day *total*, not 2,000 each.

### Headers

Four response headers, each `int,int` = `15min,daily`:
- `X-RateLimit-Limit` / `X-RateLimit-Usage` — overall bucket
- `X-ReadRateLimit-Limit` / `X-ReadRateLimit-Usage` — read bucket

Read these on every response and back off proactively. Exceeding a limit returns **HTTP 429**.

### Resets
- 15-minute windows reset on natural boundaries: :00, :15, :30, :45.
- Daily limits reset at **midnight UTC**.

### Backfill math — the practical constraint

Streams cost **1 call per activity**. A runner with 8 years of history at ~200 runs/year has ~1,600 activities:

- Activity list: 1,600 ÷ 200 per page = **8 calls**. Trivial.
- Streams: **1,600 calls.**

At 1,000 reads/day that is a **~2-day backfill**; at 2,000/day, ~1 day. Entirely feasible — but it must be a **resumable, checkpointed, rate-limit-aware background job**, not a synchronous "connect your account" flow. Budget ~70% of the daily quota for backfill and reserve the rest for webhooks and interactive use.

Steady state is trivial: one activity per day = ~2 calls per day.

---

## 5. App Approval and the Developer Program

Sources: [getting started](https://developers.strava.com/docs/getting-started/), [API Policy §3](https://www.strava.com/legal/api_policy), [Strava's announcement](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428)

### Is there a review process? Yes, but not for you.

**Access Tiers, per Policy §3.3:**

- **(a) Standard Tier**, two levels:
  - Applications **limited to 10 registered Strava users** — "generally intended for hobbyists, side projects, and early development"
  - Applications **limited to 9,999 registered Strava users** — "generally intended for growing apps with a substantial user base"
- **(b) Extended Access Tier** — 10,000+ users, "admitted on a case-by-case basis" and approved by Strava.

### The athlete cap — yes, it is real, and it starts at 1

New applications launch in **"single-player mode": athlete capacity of 1.** Only your own Strava account can authenticate. This is the historical cap the project brief remembered, and it is still in force.

**Raising it to 10 is self-service.** From the API Settings dashboard at `strava.com/settings/api` you can upgrade directly to a 10-athlete capacity with no review, no form, and no waiting. Strava's own announcement describes Standard Tier as "up to 10 athletes, self-managed, **no formal review**."

**For Lost Soles this is a non-issue.** 1 primary user + 2–5 friends = 6 at most, comfortably inside the self-service 10 cap. You will never touch the review process.

Beyond 10, you submit a form; per Policy §3.6, "Admission to the Strava Developer Program is at Strava's discretion and is not guaranteed. Strava does not commit to a fixed review-time service-level agreement." Developers report opaque rejections with minimal feedback.

### ⚠️ NEW as of 2026: a paid Strava subscription is required

**Standard Tier developers must maintain an active Strava subscription** (~$11.99/month in the US) to keep API access. Policy §3.3: "Standard Tier Applications are subject to subscription requirements as published on the Strava developer site, **including a requirement that the developer or specified end users maintain an active Strava subscription.**"

Effective **June 1, 2026** for new developers and **June 30, 2026** for existing ones. Extended Access Tier partners are exempt. This is a genuine recurring cost of the API path that the export path does not have.

### Other dated changes to plan around

| Date | Change |
|---|---|
| **2026-06-01** | New tiers, Agreement, and Policy in effect; intermediary/proxy platform access cut off |
| **2026-06-30** | Subscription requirement binds existing Standard Tier developers |
| **2026-09-01** | **Club Activities, Club Admins, Club Members, and Segments Explore endpoints deprecated** (two days from now) |
| **2027-06-01** | Migrate to new base URL `https://www.api-v3.strava.com` and move auth tokens from form params into **request headers** |

None of the deprecated endpoints matter for Lost Soles. The 2027 base-URL and header-auth migration does — if you build on the API at all, use `Authorization: Bearer` headers from day one and keep the base URL in config.

---

## 6. THE CRITICAL PART — Agreement and Brand Guidelines

### 6.1 May activity data and GPS streams be stored persistently, and for how long?

**No. Maximum seven (7) days, as a transient cache only.**

Full text of **Policy §6.2 Cache and Retention**:

> "You may not retain Strava Data in your cache for longer than seven (7) days. If your Developer Application checks for a resource (for example, a segment) and that resource is no longer available from Strava, you must remove it from your cache immediately, regardless of how frequently your cache is refreshed. Except for such limited caching, you may not store Strava Data, or provide or display Strava Data or any associated service, to any third party other than the Strava user using your Developer Application."

Reinforced by **§5.5** (no "Persistent Index"; no "accumulating Strava Data through repeated authorized API calls into a corpus, dataset, archive, or database"), **§5.7** (no storing geographic location information), and **§6.4** ("you may use and retain Data only so long as necessary for the purpose for which it was originally obtained").

**Scope note that closes the obvious loophole:** §5.5's Persistent Index prohibition covers "Strava Data, **or any data derived from Strava Data**." §5.4's closing sentence: "The restrictions in this Section 5.4 apply to data derived from Strava Data and to output that incorporates or was generated using Strava Data." A tile pyramid, an H3 cell set, a rasterized reveal mask, or a simplified polyline computed from Strava streams is all squarely covered.

### 6.2 Restrictions on displaying Strava data on non-Strava maps or third-party tiles?

**None. No such restriction exists in the current text.** Verified by full-text grep of the Agreement, the Policy, and the Brand Guidelines for `map`, `tile`, `polyline`, `geograph`, and `location`. The only geographic clause is §5.7, which restricts *storage*, not *rendering*, and says nothing about map providers.

**MapLibre GL JS with OSM, Protomaps, MapTiler, or self-hosted vector tiles is fully permitted.**

The restriction that *does* exist, and which people often mis-remember as a map restriction, is the **audience** rule:

> **Policy §2.3 Display Limited to the Authenticated User** — "Strava Data provided by a specific Strava user may be displayed or disclosed in your Developer Application only to that user. You may not display or disclose Strava Data related to other users, even if such data is publicly viewable on the Strava Platform."

> **Policy §6.1 Scope of Data Access** — "Unless your Developer Application has an athlete capacity of 9,999 or less, you may display or disclose to an end user only the specific Strava Data related to that end user."

(§6.1 is oddly drafted — read literally, an app with capacity ≤9,999 is *exempt* from §6.1, but §2.3 states the same rule with no capacity carve-out and controls regardless. Don't rely on the §6.1 wording.)

**Design consequence for Lost Soles:** each user's fog-of-war must be private to that user. A shared/combined map where friends see each other's revealed territory, a leaderboard showing another user's explored area, or any social overlay of Strava-sourced traces **violates §2.3.** If you want multiplayer territory mechanics, either (a) source those traces from user file uploads rather than the API, or (b) get explicit per-user consent and — even then — note §5.13 and §5.10 make third-party disclosure of API-sourced data risky "even if a user of your Developer Application consents."

### 6.3 Restrictions on derived data, aggregations, heatmaps?

**Yes, and they are broad.**

> **§5.4 No Aggregation, Analytics, or De-Identified Processing** — "You may not process or disclose Strava Data—even publicly viewable Strava Data—including in an aggregated, de-identified, or anonymized manner, for the purposes of analytics, analyses, customer insight generation, or product or service improvements. You may not combine Strava Data with other customer data for these or any other purposes. The restrictions in this Section 5.4 apply to data derived from Strava Data and to output that incorporates or was generated using Strava Data."

> **§5.6 No Reverse Engineering or Derivative Works** — includes "Modify or create derivative works based upon the Strava API Materials." (Note: "API Materials," not "Strava Data" — this clause is about the API/SDK itself, not your visualizations. §5.4 and §5.5 are the ones that bite.)

§5.4 is aimed at analytics/insight-generation businesses, and a single user's personal exploration map is not obviously "customer insight generation." But combined with §5.7 (no aggregating geographic information) and §5.5 (derived data in a Persistent Index), **a persistent per-user heatmap or reveal-mask built from API data is not defensible.** Also note Strava's November 2024 press framing explicitly called out third parties "surfacing athlete information in public feeds **or heatmaps**."

Additionally relevant even though it isn't your use case:

> **§5.3 No AI/ML Training, Fine-Tuning, Grounding, Evaluation, Embedding, or Retrieval-Augmented Generation** — prohibits use of Strava Data in "the development, training, evaluation, or operation of any AI Application," extending to "any data derived from, aggregated from, anonymized from, or generated using Strava Data" and to "ingestion into a context window or working memory."

This is worth internalizing: **if Lost Soles ever adds an LLM feature** (an AI coach, a natural-language activity summarizer, a generated quest description that references your runs), **feeding it API-sourced Strava data is expressly prohibited.** Strava's sanctioned path is their own first-party Strava MCP (§3.5), which is licensed only for a subscriber's own personal use and explicitly "not authorized for … any commercial or third-party access." Data from the user's own file export is outside "Strava Data" and outside this clause.

### 6.4 Attribution requirements

Attribution is **optional** — but *if* you attribute, you must do it exactly right.

> **Policy §4.2** — "**If you choose** to give attribution to Strava within your Developer Application, you must comply with the Brand Guidelines in doing so. […] Strava determines whether you are in compliance."

From the [Brand Guidelines](https://developers.strava.com/guidelines/) (rev. 2025-09-29):

- **Connect with Strava button** — apps using it for OAuth must link to `https://www.strava.com/oauth/authorize` or `.../oauth/mobile/authorize`. Orange or white, EPS/SVG/PNG, 48px @1x / 96px @2x.
- **"Powered by Strava" / "Compatible with Strava" logos** — orange, white, or black; horizontal and stacked. These two phrases are the **only** permitted ways to state interoperability.
- **Never** imply Strava developed or sponsored your app. Logos must be "completely separate and apart from (and should not appear more prominently than)" your app's name/logo. Never use any part of a Strava logo as your app icon. Never modify, alter, or animate.
- **Linking back** to a source activity must use the exact text **"View on Strava"**, legible, and styled as a link via bold, underline, or orange `#FC5200`.
- **Naming** — Policy §4.1: "You must not use any Strava Mark, or any confusingly similar mark, as the name or part of the name or icon of your Developer Application." "Lost Soles" is clean.
- Strava name in prose must not be larger or more prominent than surrounding text or your app name.
- **§4.4 Third-Party Attribution** — if you display anything derived from **Garmin-sourced** data, you must attribute Garmin per Garmin's brand guidelines. Relevant if the user records on a Garmin watch.
- **§4.6** — no press release mentioning Strava without prior written consent.

**Recommendation:** on the file-upload path, don't mention Strava at all beyond a plain-text instruction telling the user how to export their data. No logo, no attribution, no trademark surface area, nothing for Strava to determine compliance on.

### 6.5 Prohibition on gamification or competing with Strava?

**No clause names gamification.** There is no prohibition on XP, levels, loot, monsters, or quests.

The clause to be aware of is the general competition bar:

> **§5.2 No Competing or Imitating Applications; No Benchmarking** — "You may not use the Strava API Materials in any manner that is competitive to Strava or the Strava Platform, including in connection with any application, website, or other product or service that includes, features, endorses, or otherwise supports a third party that provides services competitive to Strava's products and services. You may not use the Strava API Materials to create an application that imitates the look, imagery, or brand identity of Strava or the Strava Platform. You may not use or access the Strava API Materials to monitor the availability, performance, or functionality of the Strava Platform or for any other benchmarking or competitive analysis purpose."

And the Agreement's own highlights section: *"You may not create applications that compete with or replicate Strava functionality."*

Section 5 opens: *"Strava shall determine **in its sole discretion** whether your Developer Application's use of the Strava API Materials complies with this Section and the Agreement."*

**Assessment:** RPG gamification is not a Strava product and is not competitive. The fog-of-war map is closer to the line, since Strava ships both a Personal Heatmap and a Global Heatmap — but "imitates the look, imagery, or brand identity" is about visual imitation, which a game-styled fog overlay is not. Practical risk to a private app with ≤6 users is negligible. But the sole-discretion language means there is no safe harbour, and this is a second independent reason to prefer the export path, where §5.2 does not apply at all.

Also note **Agreement §9.2**: Strava may build competing products freely and nothing restricts them from doing so.

### 6.6 Data deletion when a user disconnects

**Policy §7.4 Deletion Obligation** — full text of the triggers:

> "Upon (a) a Strava user's request, (b) a Strava user's revocation of your Developer Application's authorization to access the user's Strava account, (c) a Strava user's deletion of the user's Strava account, (d) your cessation of use of the Strava API Materials, or (e) termination of this Agreement, you must promptly and permanently delete the following from your Developer Application and from all systems, networks, and servers under your control:
> (i) in the case of clauses (a) through (c), **all Strava Data and all Personal Data derived from Strava Data** relating to the requesting or revoking user; and
> (ii) in the case of clauses (d) and (e), all Strava Data and all Personal Data derived from Strava Data, **regardless of user.**
> Deletion under this Section 7.4 must be completed expeditiously but in any event **within thirty (30) days** […] You must certify deletion to Strava in writing on request."

Supporting clauses:
- **§2.5 Deletion upon End-User Request** — "You must delete all Data about an end user in your possession or control upon that end user's request, or upon the end user's termination or cancellation of the Developer Application's access […] You must also provide the user with **written confirmation of successful deletion.**"
- **§6.3 Reflecting User Deletions** — "You may not continue displaying or disclosing in your Developer Application any Strava Data that a Strava user has deleted from Strava. Deletions must be reflected in your Developer Application expeditiously but in all cases **within forty-eight (48) hours.**"
- **§2.1 Authentication and Consent** — before accessing any data you must disclose (i) types of data collected, (ii) collection methods, (iii) how to withdraw consent, (iv) how to request deletion, (v) confirmation when deletion completes.
- **§2.2 End-User Access to Collected Data** — users must be able to access the data you've collected about them on request.
- **§7.3 Developer Privacy Policy** — you must publish a GDPR/UK-GDPR-compliant privacy policy at a prominent link.
- **§8.3 Breach Notification** — notify `legal@strava.com` within **24 hours** of discovering any breach.

**Note the interaction with 6.1 that makes the API path unusable, independent of the 7-day rule:** §7.4(b) means that the moment the user disconnects, the *entire fog-of-war state* must be destroyed within 30 days, because it is "Personal Data derived from Strava Data." A years-long exploration record that evaporates on disconnect is not the product. **§6.3's 48-hour rule compounds it:** if the user deletes one activity on Strava, you must un-reveal that territory within 48 hours — which means retaining per-activity provenance and being able to subtract a trace from an accumulated mask. Under the export path none of this applies: those files are the user's own property, already in their possession.

### 6.7 Differences for a personal or single-user app?

**None whatsoever. This is important and worth stating plainly.**

I searched the entire Agreement and Policy. There is **no hobbyist exemption, no personal-use carve-out, no single-user exception** to any of §5.4, §5.5, §5.7, §6.2, §6.4, or §7.4. Policy §3.3 acknowledges apps "generally intended for hobbyists, side projects, and early development" — but only to describe an *access tier* (10 users, self-service). It attaches **no relaxation of the data rules**. Hobbyists get a smaller quota and a subscription bill, not more freedom.

The only thing that genuinely differs for personal use is:
- **§3.5 Strava MCP** — subscribers may use Strava's own MCP to interact with their own data via their own AI application, "in connection with their personal use of their own Strava data." This is Strava's designated answer to "I just want to analyze my own data," and Strava's developer-program announcement points personal-analytics users there. It is an interactive query surface, **not a bulk ingestion or persistence mechanism**, and it does not help build a fog-of-war store.
- **§6.6 User Bulk Data Export** — the real carve-out, discussed in §8 below.

Community threads asking Strava directly whether personal projects may store data long-term have gone unanswered for a decade. **Do not assume an unwritten exemption exists.**

---

## 7. Practical Gotchas

### Activity type taxonomy — two parallel enums

Every activity carries **both** `type` (legacy, 37 values) and `sport_type` (current, 56 values). Strava's docs mark `type` deprecated in favour of `sport_type`. **Always branch on `sport_type`.**

Running-relevant `sport_type` values: **`Run`, `TrailRun`, `VirtualRun`**. Also possibly `Walk`, `Hike` depending on how generous your fog rules are.

`sport_type` values with no `type` equivalent (they collapse to `Workout` in the legacy field): `Badminton`, `Basketball`, `Cricket`, `Dance`, `EMountainBikeRide`, `GravelRide`, `HighIntensityIntervalTraining`, `MountainBikeRide`, `Padel`, `PhysicalTherapy`, `Pickleball`, `Pilates`, `Racquetball`, `Squash`, `TableTennis`, `Tennis`, `TrailRun`, `VirtualRow`, `Volleyball`. Note `TrailRun` is in that list — **an app reading only `type` sees trail runs as plain `Run`**, which is survivable, but the general lesson is that `type` is lossy.

### Strength / bodyweight workouts — the bad news for pushups, situps, planks

**Strava has no concept of reps, sets, or exercise-level detail.** There is no rep count, no exercise name, no sets field, anywhere in the API. The relevant `sport_type` values are:

- `WeightTraining` — the closest fit
- `Crossfit`
- `HighIntensityIntervalTraining`
- `Workout` — the generic catch-all
- `Pilates`, `Yoga`, `PhysicalTherapy`

A pushup/situp/plank session surfaces as, at best, a `WeightTraining` or `Workout` activity with a `name` string, an `elapsed_time`, and essentially nothing else. `distance` will be 0. There will be no GPS.

**Consequence: Strava cannot be the source of truth for the pushups/situps/planks feature.** Your options are (a) parse the user's free-text activity `name` (fragile, e.g. "Pushups 3x20"), or (b) — far better — **build native in-app logging for bodyweight workouts.** They are the one part of Lost Soles that doesn't need Strava at all: a simple form ("50 pushups, 3 sets") writing straight to your own DB, with no terms, no rate limits, and no retention ceiling. Do that.

### Manual activities and activities with no GPS

- `manual: true` — user-created, no uploaded file. **`map.summary_polyline` will be an empty string or the `map` object will lack it, and `/streams` will return 404 or a stream set with no `latlng`.**
- `trainer: true` — recorded on a stationary machine (treadmill, turbo trainer).
- **`VirtualRun`** — treadmill runs synced from Zwift, Peloton, a footpod, etc.
- Indoor runs recorded on a watch may have `time`, `distance`, `heartrate`, and `cadence` streams but **no `latlng` stream at all**.

**Your ingestion pipeline must treat "activity exists but has no latlng stream" as a normal, frequent outcome — not an error.** Check for the `latlng` key's presence before indexing into it. These activities should still award XP and count toward distance goals; they simply reveal no fog. Requesting `keys=latlng` for an activity that has none returns a stream set without that key (or a 404 for fully streamless manual activities) — handle both.

Also: a GPS run through a tunnel or urban canyon produces `latlng` points that jump hundreds of metres. **Filter on implausible point-to-point speed before revealing fog**, or a single bad fix paints a corridor across the city.

### Privacy zones — the fog-of-war-specific trap

If the user has configured Strava **privacy zones** (typically around home and work), activities fetched with only `activity:read` have their traces **truncated at the zone boundary**. The start and end of nearly every run will be missing. On a fog-of-war map this produces a permanent, conspicuous unexplored hole exactly where the user lives.

**`activity:read_all` returns the un-redacted trace.** This is the single strongest reason to request it. On the file-export path, the user's own downloaded originals are never redacted.

### Duplicate handling

- `activity.id` is the natural primary key from the API and is stable.
- **`external_id`** — the identifier supplied at upload time (often the device filename, e.g. `garmin_push_123456789`). Useful for correlating an API activity with the same activity in a file export.
- **`upload_id` / `upload_id_str`** — the upload that produced the activity. Use `upload_id_str`: **`upload_id` is an int64 that exceeds JavaScript's `Number.MAX_SAFE_INTEGER`** and will be silently corrupted by `JSON.parse` in the browser or in Node. The same hazard applies to `activity.id` for recent activities — **handle all Strava IDs as strings in JS.**
- **Cross-source duplicates are the real risk for Lost Soles.** If the same run arrives both via a GPX file upload and via the API, you will double-reveal. Dedupe on a composite key: `(athlete_id, start_date rounded to the minute, round(distance), round(elapsed_time))`. Do not rely on filename.
- Webhook retries mean the same `create` event arrives up to 3 times — key on `(object_id, aspect_type)`.

### Timezone handling

- **`start_date`** — UTC, ISO-8601, always trustworthy. **Use this as the storage/sort key.**
- **`start_date_local`** — the same instant expressed in the activity's local wall-clock time, but serialized with a **`Z` suffix that is a lie.** `2026-03-14T07:30:00Z` in this field means 7:30 a.m. local, not UTC. Naively parsing it as UTC and converting will double-shift. Parse it as a *naive local datetime*.
- **`timezone`** — a string like `"(GMT-08:00) America/Los_Angeles"`. **It is not a bare IANA identifier** — you must strip the `(GMT±HH:MM) ` prefix before feeding it to a tz library.
- `utc_offset` (on `DetailedActivity`) is offset seconds at activity time.

**For a fitness game, streaks and "runs this week" must be computed in the user's local time**, or a late-evening run in a negative-UTC-offset timezone lands on the wrong day and breaks a streak. Use `start_date_local`'s date component for all game-logic day bucketing, and `start_date` for ordering and dedupe.

---

## 8. The Fallback Path — and why it should be the primary path

### Strava Bulk Data Export

**Explicitly protected by Policy §6.6:** "Each Strava user has the right to access and export the user's own Strava data, free of charge, through the Bulk Data Export Tool published on the Strava service. **Nothing in this Agreement is intended to limit or condition that user-facing right.**"

**How:** Settings → "My Account" → "Download or Delete Your Account" → "Request Your Archive" → confirm by email. Available **only on the Strava website**, not the mobile app. Delivery is typically a few hours; up to ~10 days for very large accounts. ([Help Center](https://support.strava.com/hc/en-us/articles/216918437-Exporting-your-Data-and-Bulk-Export))

**Archive contents:**
- `activities/` — **one file per activity**, in whatever format it was originally recorded: `.gpx`, `.fit.gz`, or `.tcx.gz` (FIT and TCX are gzipped; GPX usually is not).
- `activities.csv` — the summary index: activity id, date, name, type, distance, elapsed time, **and the filename of the corresponding track file**. This is your join key and your manifest.
- Plus profile, gear, clubs, routes, segments, comments, kudos, media as CSVs.

The per-activity originals are the **same bytes the device uploaded** — full resolution, no privacy-zone redaction, no simplification. Strictly better fidelity than the API for your purposes.

**Ongoing (post-backfill):** individual activities can be exported one at a time from the activity page ("Export GPX" / "Export Original"), so the user can add new runs without re-requesting a full archive. Requesting a fresh full archive periodically also works.

### File formats

| Format | Contents | Notes |
|---|---|---|
| **GPX** | `<trkpt lat lon>` + `<ele>` + `<time>`; HR/cadence only via the `gpxtpx` TrackPointExtension namespace | XML, verbose, universally supported. Best target format. |
| **TCX** | Garmin XML. Includes HR, cadence, watts, distance, laps natively | Richer than GPX, still XML |
| **FIT** | Garmin binary. Everything — HR, cadence, power, laps, per-record timestamps, device metadata. Most compact and most complete | Needs a parser: `fit-file-parser` / `@garmin/fitsdk` (JS), `fitparse` / `fitdecode` (Python), or convert with `fit2gpx`/GoldenCheetah |

**Recommendation:** accept all three at the ingestion boundary and normalize immediately to a single internal trace representation (`[{t, lat, lng, ele, hr?, cad?}]`) — which, not coincidentally, is exactly the shape Strava's index-aligned streams produce. That way both ingestion paths converge on one internal format and the rest of the system is source-agnostic.

### Is direct file upload a viable path with no terms attached?

**Yes — and it is the correct architecture for Lost Soles.**

The reasoning:

1. **The Agreement only binds API users.** It is entered into by registering for and using the Strava API Materials. If Lost Soles never registers an app, you never accept it and it never applies.
2. **Even if you do register an app**, "Strava Data" is defined at Agreement §2.3(i) as "all data you access or collect **from the Strava API Materials**." A file the user downloads from their own account and uploads to your app was not accessed from the API Materials. It falls under §2.3(ii) "Developer Application Data," which the retention prohibitions in §5.5, §5.7, and §6.2 do not reach.
3. **Policy §6.6 explicitly declines to condition** the user's export right.
4. **Strava ToS §6** confirms the user owns the IP in their Content, which expressly includes "routes, segments, or other data."
5. **Strava's own developer-program announcement** reiterates: *"every Strava athlete can still access and download their data for free, at any time."*

**Even cleaner:** for ongoing activity capture, the GPX/FIT file can come **directly from the recording device or platform** — Garmin Connect export, Apple Health / HealthKit, watchOS, COROS, a phone GPS recorder — with Strava never in the loop at all. Strava then becomes purely a one-time historical-backfill source via bulk export.

**Costs of the export path, stated honestly:**
- Manual user action to get data in (mitigated by a good drag-and-drop uploader, and by the fact that this is a single-user app whose user is you).
- No push/webhook automation — no automatic ingestion moments after a run.
- You must write FIT/TCX/GPX parsers rather than consuming clean JSON.

**Benefits:**
- Permanent retention, lawfully.
- Full fidelity, no privacy-zone redaction, no RDP simplification.
- No rate limits, no 10-athlete cap, no $11.99/month subscription requirement.
- No deletion-on-disconnect cliff, no 48-hour deletion mirroring, no audit exposure.
- No §5.2 competition risk, no §5.3 AI restriction if you later add LLM features.
- No dependency on a developer program that has changed its terms materially twice in 18 months.

### Recommended hybrid, if you want API convenience

If the ergonomics of automatic ingestion matter enough:

- **Permanent store** (traces, fog mask, XP, game state): fed **exclusively** by user-uploaded files. Never contains API-sourced data.
- **Ephemeral layer** (optional): Strava OAuth + webhooks used purely as a **notification and nudge** mechanism — "you logged a 10 km run on Strava 3 minutes ago, upload the file?" Store only the activity id, timestamp, and a 7-day TTL, and let DynamoDB TTL enforce §6.2 automatically.
- Hard column-level provenance on every trace row; a schema constraint that API-sourced rows cannot enter the permanent tables.

This is defensible, but it doubles the surface area and re-imports the subscription requirement, the audit exposure, and the §6.4 ambiguity. **For a single-user app, the pure file-upload path is simpler, cheaper, and strictly safer. Recommend it.**

---

## Sources

- [Strava API Agreement (2026)](https://www.strava.com/legal/api) — effective 2026-06-01
- [Strava API Policy (2026)](https://www.strava.com/legal/api_policy) — effective 2026-06-01
- [Strava API Brand Guidelines](https://developers.strava.com/guidelines/) — rev. 2025-09-29
- [Strava Terms of Service (2026)](https://www.strava.com/legal/terms)
- [Strava API v3 Documentation](https://developers.strava.com/docs/)
- [Authentication](https://developers.strava.com/docs/authentication/)
- [Rate Limits](https://developers.strava.com/docs/rate-limits/)
- [Webhook Events API](https://developers.strava.com/docs/webhooks/)
- [Webhook example walkthrough](https://developers.strava.com/docs/webhookexample/)
- [Getting Started](https://developers.strava.com/docs/getting-started/)
- Raw Swagger specs: [swagger.json](https://developers.strava.com/swagger/swagger.json), [stream.json](https://developers.strava.com/swagger/stream.json), [activity.json](https://developers.strava.com/swagger/activity.json), [sport_type.json](https://developers.strava.com/swagger/sport_type.json), [activity_type.json](https://developers.strava.com/swagger/activity_type.json), [map.json](https://developers.strava.com/swagger/map.json)
- [An Update To Our Developer Program](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428) — Strava official, 2026
- [New Strava API Update, what the message means](https://communityhub.strava.com/developers-api-7/new-strava-api-update-what-the-message-means-13433)
- [Storing activity data for more than 7 days?](https://communityhub.strava.com/developers-api-7/storing-activity-data-for-more-than-7-days-11716)
- [API usage terms clarification (google groups, unanswered since 2015)](https://groups.google.com/g/strava-api/c/PJnl2Xlb1ow)
- [Updates to Strava's API Agreement (press, Nov 2024)](https://press.strava.com/articles/updates-to-stravas-api-agreement)
- [API Agreement Update & How Data Appears on 3rd Party Apps](https://support.strava.com/hc/en-us/articles/31798729397773-API-Agreement-Update-How-Data-Appears-on-3rd-Party-Apps)
- [Exporting your Data and Bulk Export](https://support.strava.com/hc/en-us/articles/216918437-Exporting-your-Data-and-Bulk-Export)
- [Strava API Pricing in 2026: New Fees and Developer Changes](https://appsforstrava.com/blog/strava-developer-program-changes-2026)
- [Strava just pulled a Reddit on its developer community — Notebookcheck](https://www.notebookcheck.net/Strava-just-pulled-a-Reddit-on-its-developer-community.1312468.0.html)
