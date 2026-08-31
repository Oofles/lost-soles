# R2 — Wearables as Data Sources (WHOOP & Fitbit Air)

**Research date:** 2026-08-30
**Project:** Lost Soles — fog-of-war running map + Runescape-style per-skill XP
**Context:** Strava is the primary ingestion path (see R1). This brief evaluates whether the
user's WHOOP (active subscription) and a possible **Fitbit Air** purchase justify direct
integrations.

---

## RECOMMENDATION

### Build order

| Priority | Integration | Verdict | Why |
|---|---|---|---|
| **P0** | **Strava only** | Build | Already the plan. It is the *only* source of GPS route polylines for fog-of-war, and both wearables feed into it. |
| **P1 (optional, post-MVP)** | **WHOOP API v2** — recovery + sleep + cycle only | Build *only if* you want RPG "stamina/rest" mechanics | Free, open self-serve signup, no partner gate, 10-user dev cap is fine for you + 2-5 friends. Gives recovery score, HRV, RHR, sleep — **none of which Strava exposes**. |
| **SKIP** | **WHOOP workouts endpoint** | Skip | No GPS, no route, no sets/reps. Strictly worse than the same workout arriving via Strava. |
| **SKIP** | **Fitbit / Google Health API** | Skip for now | The Fitbit Web API is **decommissioned September 2026** (i.e. within weeks). Its replacement, the Google Health API, puts *every* scope behind Restricted-scope review + an annual paid CASA security audit. Massive overhead for a hobby app. The Fitbit Air has **no GPS** anyway. |

### The one-line answer

**Treat both wearables as "sync to Strava, we read Strava."** Neither device has onboard GPS,
so neither can contribute anything to the fog-of-war feature that Strava does not already
deliver better. The *only* reason to touch WHOOP directly is to pull recovery/sleep/strain for
game-mechanic flavour — and that is a genuinely nice-to-have, not a blocker.

### Caveat that may kill even the P1

WHOOP's API Terms of Use forbid building a permanent local database of WHOOP data
(see "Terms of service constraints" below). A gamified XP ledger that permanently stores
"recovery was 68% on 2026-08-30" is arguably a violation. Mitigation: store only *derived*
game state (e.g. "Rest Bonus tier: 3") and re-fetch raw values on demand. Read the terms
yourself before committing.

---

## WHOOP

### 1. Public developer API — yes, open, self-serve

The **WHOOP Developer Platform** is live and open to individual developers. No partner
program gate for standard member-data access.

- Docs: https://developer.whoop.com/docs/introduction/
- API reference: https://developer.whoop.com/api/
- Base URL: `https://api.prod.whoop.com`
- **Current version: v2** (launched 2025-07-01). v1 webhooks have been removed; a v1→v2
  activity-id mapping endpoint was added 2025-11-01.
  Changelog: https://developer.whoop.com/docs/api-changelog/
- **Cost: free.** "Access to and use of the APIs is currently provided at no charge," with
  WHOOP reserving the right to charge later with notice.
  https://developer.whoop.com/api-terms-of-use/

**Access tiers:**
- *Unapproved / development app*: capped at **10 WHOOP members**. No approval needed.
  This is more than enough for you + 2-5 friends and family.
- *Approved app*: needs WHOOP API ToS compliance, testing with ≥1 member, accurate dashboard
  metadata (name, contact email, privacy policy URL), adherence to Design & Brand Guidelines,
  and a submitted approval request.
  https://developer.whoop.com/docs/developing/app-approval/
- A separate **client-credentials "Trusted Partner"** flow exists for lab-grade health
  partners — irrelevant here.

### 2. OAuth, scopes, endpoints

**Flow:** OAuth 2.0 Authorization Code, Bearer access tokens.

**Scopes:**
```
read:recovery
read:cycles
read:workout
read:sleep
read:profile
read:body_measurement
```

**Endpoints (v2):**

| Endpoint | Returns |
|---|---|
| `GET /v2/activity/workout` / `/{workoutId}` | `sport_name`, `sport_id`, `start`, `end`, `score_state`, and a `score` object: `strain`, `average_heart_rate`, `max_heart_rate`, `kilojoule`, `percent_recorded`, `distance_meter`, `altitude_gain_meter`, `altitude_change_meter`, `zone_durations` |
| `GET /v2/cycle` / `/{cycleId}` | day strain, `kilojoule`, avg/max HR |
| `GET /v2/recovery`, `GET /v2/cycle/{cycleId}/recovery` | `recovery_score`, `resting_heart_rate`, `hrv_rmssd_milli`, `spo2_percentage`, `skin_temp_celsius` |
| `GET /v2/activity/sleep` / `/{sleepId}` | sleep stage summary, sleep performance %, sleep consistency %, `respiratory_rate` |
| `GET /v2/user/profile/basic` | name, email |
| `GET /v2/user/measurement/body` | height, weight, max HR |

v2 resources use **UUID** identifiers (v1 used integers).

Note: there is **no continuous / intraday heart-rate stream endpoint**. You get per-workout
aggregates and zone durations, not a HR time series.

### 3. GPS / route data — **NO. This is decisive.**

**The WHOOP API exposes no GPS, no coordinates, no polyline, no route geometry, and no
location data of any kind.** The workout response carries `distance_meter` and
`altitude_gain_meter` as scalars only. Verified against the current v2 API reference
(https://developer.whoop.com/api/) and the full changelog — no changelog entry has ever
mentioned GPS, location, or routes.

This is consistent with the hardware: **WHOOP 5.0 has no built-in GPS.** WHOOP support
confirms it "cannot independently track your route, pace, elevation etc without using your
phone's GPS." Route data only exists when the phone was carried and "Track Route" was on.
https://x.com/WHOOP/status/1992008615692034395

**Consequence: WHOOP cannot power the fog-of-war feature, directly or indirectly.** Any WHOOP
run that *does* have a route got it from the phone, and that same route reaches you through
Strava with a decodable polyline.

### 4. Strength training detail — minimal

Strength Trainer activities became available via `/workout` on **2024-05-01**. But they arrive
as a normal workout record: a `sport_name` plus strain/HR/calorie aggregates. **No sets, no
reps, no per-exercise breakdown, no movement list.**

For pushups/situps/planks XP this is close to useless — you would get "a strength session
happened, strain 8.4," not "42 pushups." The XP system will need manual entry or a different
source regardless. WHOOP adds nothing here.

### 5. Rate limits, webhooks, ToS

**Rate limits:** 100 requests/minute, 10,000 requests/day per client. `429` on exceed.
Increases available on request via the Developer Dashboard.
https://developer.whoop.com/docs/developing/rate-limiting/

**Webhooks:** six events — `recovery.updated`, `recovery.deleted`, `sleep.updated`,
`sleep.deleted`, `workout.updated`, `workout.deleted`. Creates are published as `updated`.
- HTTPS POST to your configured URL; retried 5 times over ~1 hour; expects 2XX.
- Signed with `X-WHOOP-Signature` + `X-WHOOP-Signature-Timestamp`: HMAC-SHA256 of
  `timestamp + raw_body`, base64-encoded.
- WHOOP recommends responding within ~1 second and running a reconciliation job for misses.
- https://developer.whoop.com/docs/developing/webhooks/

*Amplify note:* this needs a real HTTPS endpoint. On AWS Amplify that means an API
Gateway + Lambda function URL, and the HMAC check must run on the **raw** body before any
JSON parsing/re-serialization.

**Terms of service — the important constraint:**
From https://developer.whoop.com/api-terms-of-use/ —
- You may not "build databases, or otherwise create permanent copies of WHOOP Data."
- You must not "keep cached copies longer than permitted by the cache header."
- On termination you must stop using the APIs and delete cached/stored content.
- Data must be encrypted in transit and at rest; HTTPS required.
- No selling, renting, leasing, redistributing or syndicating access.
- No competing with WHOOP directly or indirectly.
- No personal-use exemption — hobby apps are held to the same restrictions.

The "no permanent copies" clause is a real design constraint for a persistent RPG that wants
a durable stat ledger. See the caveat in the Recommendation.

### 6. WHOOP → Strava — yes, automatic, and mostly sufficient

WHOOP has native Strava integration.
https://support.strava.com/en-us/articles/15401735-whoop-and-strava

- Cardio activities auto-upload to Strava. **Strength Trainer and Recovery Activities are
  excluded.**
- Uploaded payload includes activity type, elapsed time, calories, heart rate data, activity
  strain, and *either* recovery score or sleep hours depending on the chosen display format
  (these land in the activity description/name, not as structured API fields).
- **GPS route uploads only if** "Track Route" in Strain Target was enabled, or the
  GPS-enabled activity was imported into WHOOP via Apple Health. Strava then derives distance
  and pace from that GPS.
- Requires WHOOP's 4-day calibration to be complete (Strain Target unlocks day 5).
- Strava documents this as one-way (WHOOP → Strava). WHOOP has separately announced
  Strava → WHOOP import bringing GPS, distance, pace, power and cadence into WHOOP
  (https://x.com/WHOOP/status/2064769576697487719) — so the direction may now be
  bidirectional. Either way, irrelevant for us: we read Strava.

**Verdict on necessity:** For workouts, **Strava is a fully sufficient conduit** — it carries
strictly more (the route polyline) plus everything WHOOP's own workout endpoint has. A direct
WHOOP integration is *only* justified by recovery/sleep/HRV/RHR, which Strava does not expose
in structured form.

---

## FITBIT

### 1. Fitbit Air — real, launched May 2026, **no GPS**

Announced by Google and confirmed on the Google Store.
https://blog.google/products-and-platforms/devices/fitbit/fitbit-air/

- **Price:** $99.99 (Special Edition $129.99); UK £84.99. Bands from $34.99.
- **Availability:** announced 2026-05-07, on shelves **2026-05-26**.
- **Form factor:** screenless "pebble" module that slots into a swappable band. Google's
  smallest tracker.
- **Battery:** up to 7 days; 5-minute fast charge gives a full day.
- **Water resistance:** 50 m.
- **Sensors:** 24/7 heart rate, heart rhythm monitoring with AFib alerts, SpO2, resting heart
  rate, HRV, sleep stages and duration.
- **Requires:** Google Account + the **Google Health app**. Android 11+ / iOS 16.4+.
  Ships with a 3-month Google Health Premium trial; Health Coach features need the sub.

**GPS: none.** No GPS is listed in the announcement, and coverage is consistent —
"There is no GPS built into the device. Outdoor workouts use connected GPS from a phone, so
runners and cyclists will still need to carry their handset if they want route tracking."
https://gadgetsandwearables.com/2026/05/06/google-fitbit-air-launch/

**Activity types:** automatically detects and saves activities in the background (they appear
in Google Health for confirm/edit/delete). Tracks heart rate, steps, Active Zone Minutes,
distance, calories 24/7. Dozens of manual workout types are selectable — but **because there
is no screen, every manual workout must be started from the phone app.**
https://www.androidcentral.com/wearables/fitbit/does-fitbit-air-support-automatic-activity-detection

> For Lost Soles: a screenless, GPS-less tracker is the *worst* possible shape for a
> fog-of-war app. You must carry the phone for any route at all — at which point the phone
> (via Strava) is the actual GPS source and the Air is contributing only heart rate.

### 2. Fitbit Web API state in 2026 — **being decommissioned this month**

**The legacy Fitbit Web API is turned down in September 2026.** This is the single most
important fact in this section, and it is days away.

- Cloud/server access moves to the new **Google Health API**
  (`https://health.googleapis.com`, **v4**). https://developers.google.com/health
- On-device Android access moves to **Health Connect**.
- Migration guide: https://developers.google.com/health/migration
- "In September 2026, the legacy Fitbit Web API will be turned down and will no longer sync
  data to or from Fitbit users." Existing OAuth tokens **do not transfer** — every user must
  re-consent under Google OAuth 2.0.
- Legacy Fitbit Account users (i.e. anyone who never migrated to a Google Account) cannot
  access the Google Health API at all.
- Third-party writeups confirm the timeline and the breakage:
  https://sahha.ai/blog/fitbit-api-sunset-migration/ ,
  https://www.thryve.health/blog/fitbit-api-deprecation

**Do not build against the Fitbit Web API. It is dead.**

### 3. Google Health API — what's actually available

Genuinely a better API than the one it replaces, if you can get through the gate.

- **31 data types** exposed via four read methods — `list` (raw/intraday points),
  `reconcile` (merged across sources), `rollUp` (physical time windows), `dailyRollUp`
  (civil-time windows) — plus `patch` (create/update logs) and `batchDelete`.
  https://developers.google.com/health/data-types
- **Intraday is now default.** ~5-second-resolution heart rate is available through standard
  methods; one reported test query returned 8,728 samples for a single day. Under the old
  Fitbit API this required a **special access application with written justification** — that
  barrier is gone. https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api
- **GPS routes: yes, and in TCX.** The exercise data type "handles detailed location history
  and GPS route coordinates as a separate stream," retrieved via the `exportExerciseTcx`
  custom method with `?alt=media`, gated behind the scope
  `https://www.googleapis.com/auth/googlehealth.location.readonly`.
  https://developers.google.com/health/data-types/workouts
- **Exercise data type** contains: session interval with timezone offsets, `exerciseType`,
  active duration excluding pauses, summary metrics (calories, distance, steps, HR, pace,
  speed, elevation gain), pause/resume/start/stop events, and lap/split summaries.
  Types named in docs include `RUNNING`, `WALKING`, `BIKING`, `AEROBIC_WORKOUT`.
- **No strength-training set/rep detail** in the exercise data type.
- Each data point carries **provenance** (device model, platform, recording method) — useful
  for de-duping against Strava.
- Scope pattern: `https://www.googleapis.com/auth/googlehealth.{scope}` with `.readonly` /
  `.writeonly` variants, e.g. `.activity_and_fitness.readonly`, `.sleep.readonly`.
  https://developers.google.com/health/migration/api-specifications
- **Rate limits/quotas: not publicly documented.** Both Google's spec page and independent
  writeups flag this as an open question.
- Gotcha: mixing legacy `fitness.*` scopes with new `googlehealth.*` scopes causes auth
  failures; do **not** pass `include_granted_scopes=true`.

### 4. The access barrier — this is what kills it

**Every Google Health API scope is classified as Restricted.** That triggers:

1. **OAuth app verification** — Google reviews app identity and scope justifications.
2. **An annual third-party security assessment (CASA)**, based on OWASP ASVS, confirming you
   handle user data securely and can delete it on request. You receive a Letter of Validation.
   Re-verification and re-assessment required **every 12 months**.
   - **2–3 weeks** for tier-2 apps, **4–6 weeks** for tier-3.
   - **Fees of $500–$4,500 USD payable to the assessor**, depending on complexity.
   - https://developers.google.com/health/app-verification
   - https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
3. No published SLA on the review queue.

**The escape hatch:** verification has documented exceptions, and **personal use is one of
them** — "if you are the only user of your app or if your app is used by only a few users, all
of whom are known personally to you." Such apps click through the unverified-app warning
screen. Apps left in **Testing** publishing status are restricted to designated test users.

**Unverified apps are capped at 100 users.**

So Lost Soles (1 primary user + 2-5 friends) *technically qualifies* for the personal-use
exception and would never hit the 100-user cap. But you'd be shipping an app that shows every
user a scary unverified-app interstitial, on an API whose quotas are undocumented, to read
data from a device with no GPS. Not worth it.

### 5. Fitbit → Strava — yes, natively

https://support.strava.com/en-us/articles/15401979-fitbit-and-strava

- Fitbit and Strava support a **native connection**. Eligible new GPS-based workouts send
  from Fitbit to Strava automatically; Strava-tracked runs and rides feed Fitbit all-day stats.
- **Legacy limitation:** only GPS-tracked activities sync. Walks, all-day activity, and gym
  sessions do **not** appear in Strava.
- **Improving under Google Health:** as the Fitbit app transitions to the Google Health app,
  the Strava connection is being updated — once on Google Health, "any new activities, with
  and without GPS, will sync automatically from Google Health to Strava."
- Third-party bridges exist as fallbacks (FitToStrava, FitBridge, Health Sync, SyncMyTracks)
  if the native path has gaps.

---

## COMPARATIVE ANALYSIS

### Does either wearable justify a direct integration?

**No, not for the core game loop.**

The fog-of-war feature needs one thing: **route geometry**. Sources of it:

| Source | Route geometry? | Notes |
|---|---|---|
| Strava API | **Yes** — polylines on activities | Already the P0 integration |
| WHOOP API | **No** — none, ever | Scalars only (`distance_meter`, `altitude_gain_meter`) |
| Google Health API | Yes — TCX via `exportExerciseTcx` | But behind Restricted-scope review + CASA |
| WHOOP hardware | No onboard GPS | Phone-dependent |
| Fitbit Air hardware | No onboard GPS | Phone-dependent |

Both devices are *phone-tethered* for GPS. The phone is the real GPS source in every case, and
the phone's route reaches you via Strava. **A direct wearable integration cannot beat Strava
for the map.** For workouts generally, Strava is a strict superset of what WHOOP's workout
endpoint offers.

### Data Strava does NOT provide — and what a fitness RPG could do with it

Strava exposes workout-level metrics (including `suffer_score` on the activity summary and
`has_heartrate` on activity detail) but **does not expose resting heart rate, HRV, sleep,
body composition, stress scores, or any continuous non-workout biometric data.** It is an
activity platform, not a recovery platform.
https://openwearables.io/blog/strava-api-developer-guide-activities-heart-rate-gps-data

This is the *only* genuine argument for a direct WHOOP integration:

| Game concept | Metric needed | Obtainable? | Source |
|---|---|---|---|
| **Energy / Stamina bar** (regenerates overnight, spent on activity) | `recovery_score` (0–100) | **Yes — clean fit** | WHOOP `GET /v2/recovery`. Maps 1:1 onto a 0–100 stamina bar with zero transformation. |
| **Rest Bonus** (Runescape-style banked XP multiplier for sleeping well) | sleep performance %, sleep duration, stage summary | **Yes** | WHOOP `GET /v2/activity/sleep` |
| **Difficulty / XP multiplier** on a workout | `strain` (0–21) | **Yes** | WHOOP workout `score.strain`, or day-level `GET /v2/cycle`. Note Strava's `suffer_score` is a rough substitute you already get free. |
| **Constitution / long-term character stat** | `resting_heart_rate`, `hrv_rmssd_milli` | **Yes** | WHOOP recovery response. A dropping RHR over months is a beautiful "your character got stronger" signal Strava cannot give you. |
| **Debuff / overtraining warning** | recovery trend + strain ratio | **Yes**, derived | Compute from cycle + recovery |
| **Per-exercise skill XP** (pushups, situps, planks) | sets, reps, movement names | **NO — from any wearable** | WHOOP Strength Trainer gives only strain/HR aggregates. Google Health exercise type has no set/rep fields. Fitbit Air has no screen to log from. **This will be manual entry.** |
| **Sleep consistency streak** | sleep consistency % | Yes | WHOOP sleep response |
| **SpO2 / skin temp flavour stats** | `spo2_percentage`, `skin_temp_celsius` | Yes | WHOOP recovery response |

**Honest assessment:** recovery-as-stamina and sleep-as-rest-bonus are the two mechanics with
real design payoff, and WHOOP is the only source for them here. They are also entirely
optional to a shipped v1. Build the map and the XP system first; add WHOOP recovery as a
"phase 2 flavour layer" if the game still feels like it needs it. And check the ToS
"no permanent copies" clause before you design a schema around it.

### Apple Health / Google Health Connect as a universal ingestion layer

Attractive in theory — they aggregate everything (WHOOP, Fitbit, phone GPS, third-party apps)
into one place, and Health Connect is explicitly the on-device destination Google is pushing
Fitbit developers toward.

**The practical barrier is fatal for a web app:** both are **on-device, native-only APIs**.
- **Apple HealthKit** is an iOS/watchOS framework. There is no HealthKit web API, no server
  API, and no OAuth flow. Data never leaves the device except through an app you write in
  Swift and ship through the App Store.
- **Health Connect** is an Android on-device datastore accessed through an Android SDK. Its
  cloud-shaped sibling is the Google Health API — which is the Restricted-scope, CASA-audited
  path described above.

For a browser-based app on AWS Amplify, neither is reachable. Using them would require
building and distributing a companion native app whose only job is to read the local health
store and POST it to your backend — which is far more work than the entire rest of Lost Soles,
and puts you in App Store / Play Store review. Commercial aggregators (Terra, Thryve, Sahha,
Rook) exist precisely to solve this, but they are paid B2B services and absurd overkill for
one user.

**Conclusion: Strava is the correct universal ingestion layer for a web app.** It is the one
major fitness platform with a genuine, self-serve, server-to-server OAuth web API, and both
wearables under consideration already push into it.

---

## OPEN QUESTIONS / THINGS TO VERIFY LATER

1. **WHOOP ToS "no permanent copies"** — read the full text at
   https://developer.whoop.com/api-terms-of-use/ and decide whether storing derived game
   state (rather than raw metrics) satisfies it. This is the main legal risk of the P1.
2. **Google Health API quotas** — undocumented as of this research. If Fitbit is ever
   revisited, this needs an answer.
3. **WHOOP ↔ Strava directionality** — Strava's help article says one-way; WHOOP has
   announced Strava→WHOOP import. Confirm empirically once you have both connected, mainly to
   avoid an activity round-tripping and creating a duplicate.
4. **Duplicate detection** — if the user ever has WHOOP *and* a phone recording the same run,
   Strava may receive two activities. Plan a de-dup rule (start time ± window + duration)
   before it corrupts the XP ledger or double-reveals map fog.
5. **Fitbit Air purchase decision** — nothing in this research recommends it *for this
   project*. It contributes no GPS and its data reaches you via Strava anyway. Buy it for
   non-project reasons if you want to; do not buy it expecting to build against it.

## SOURCES

**WHOOP**
- https://developer.whoop.com/docs/introduction/
- https://developer.whoop.com/api/
- https://developer.whoop.com/docs/api-changelog/
- https://developer.whoop.com/docs/developing/app-approval/
- https://developer.whoop.com/docs/developing/rate-limiting/
- https://developer.whoop.com/docs/developing/webhooks/
- https://developer.whoop.com/api-terms-of-use/
- https://x.com/WHOOP/status/1992008615692034395 (WHOOP 5.0 has no built-in GPS)
- https://x.com/WHOOP/status/2064769576697487719 (Strava → WHOOP import)
- https://support.strava.com/en-us/articles/15401735-whoop-and-strava
- https://www.whoop.com/us/en/thelocker/how-whoop-and-strava-work-together/

**Fitbit / Google Health**
- https://blog.google/products-and-platforms/devices/fitbit/fitbit-air/
- https://store.google.com/product/google_fitbit_air
- https://gadgetsandwearables.com/2026/05/06/google-fitbit-air-launch/
- https://www.androidcentral.com/wearables/fitbit/does-fitbit-air-support-automatic-activity-detection
- https://developers.google.com/health
- https://developers.google.com/health/migration
- https://developers.google.com/health/migration/api-specifications
- https://developers.google.com/health/data-types
- https://developers.google.com/health/data-types/workouts
- https://developers.google.com/health/app-verification
- https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- https://sahha.ai/blog/fitbit-api-sunset-migration/
- https://www.thryve.health/blog/fitbit-api-deprecation
- https://tryterra.co/blog/everything-you-need-to-know-about-google-health-new-api
- https://support.strava.com/en-us/articles/15401979-fitbit-and-strava
- https://developer.android.com/health-and-fitness/health-connect/migration/fit

**Strava (for comparison)**
- https://openwearables.io/blog/strava-api-developer-guide-activities-heart-rate-gps-data
