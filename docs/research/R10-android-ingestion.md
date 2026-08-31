# R10 — Android Ingestion for Lost Soles

**Status:** COMPLETE
**Date:** 2026-08-30

## RECOMMENDATION

### Is the user's instinct that "it needs to be an Android app" correct?

**Yes — but almost certainly not an Android app *we write*, and almost certainly not a run
*recorder*.** The instinct is right that the web platform cannot do this (Q3 is a hard no).
The instinct is wrong if it implies building a second full native codebase. The realistic
outcomes are (a) install someone else's open-source APK and point it at our endpoint, or
(b) a ~400-line Kotlin bridge that reads Health Connect and POSTs. Both are small.

### Ranked by (reliability x automation) / build cost

**1. Kotlin "Health Connect bridge" — IF Strava writes routes (§1c-bis).**
One screen, no GPS code, no foreground service, no background-location permission, no Play
Store, ~1–2 days. User keeps recording with Strava exactly as they do today; opening Lost
Soles syncs everything new. Retention is legally clean (Google imposes no time limit).
**Blocked on one 5-minute check the user can run tonight.** If that check passes, stop
reading — this is the answer.

**2. GPSLogger + one ingest endpoint — works today, no unknowns.**
Sideloaded F-Droid app that already POSTs finished GPX (or per-point JSON with custom
headers/auth) to an arbitrary HTTPS endpoint. Our only work is the endpoint, which the
source-agnostic adapter architecture needs anyway. Either run it in *continuous* mode —
which for a fog-of-war map is arguably better than run-only, since it reveals every street
you ever walked — or start/stop it alongside Strava. **This is the highest-certainty path
and should be prototyped first regardless**, because it validates the ingest endpoint that
every other path also needs.

**3. OpenTracks + auto-export folder + Syncthing.** Proper activity semantics, real
workout recorder, could replace Strava for recording entirely. Needs a file-sync hop or a
small upstream PR to add a webhook. Medium effort, high reliability.

**4. Capacitor shell + background-geolocation plugin.** Only if the user actually wants
Lost Soles to *be* the run tracker. 2–4 days, reuses the Next.js frontend, but inherits
WebView fragility and OEM battery-killer whack-a-mole.

**5. Kotlin native recorder.** Most reliable recording, 1–2 weeks, a genuine second
codebase. Only justified if this becomes the product's core.

**6. PWA `share_target` for GPX.** Build it — it's half a day and it's the manual repair
hatch — but it is **not** an automation path: **Strava has no GPX export in its mobile app
at all**, so the "share from Strava" flow the brief imagined does not exist.

**7. PWA foreground recording.** Do not build. It will lose runs. See §3a.

### Suggested plan

1. **Tonight (5 min):** check Health Connect → App permissions → Strava for "Exercise route".
2. **This week:** build the ingest endpoint (`POST /api/ingest` accepting GPX + a JSON point
   batch, behind a static bearer token) — every path needs it. Point GPSLogger at it. You now
   have automatic ingestion with zero Android code.
3. **If step 1 passed:** commission the ~400-line Kotlin bridge and switch the primary
   channel to Health Connect, keeping GPSLogger as belt-and-braces.
4. **Backfill history from the Strava bulk export** regardless — Health Connect only
   reliably serves the last 30 days, and the bulk export is legally clean forever.

### Comparison table

| Path | Build effort | Reliability | Automation | Play Store exposure | Legal/retention |
|---|---|---|---|---|---|
| **Kotlin HC bridge** (if Strava writes routes) | ~1–2 days, ~400 LOC, no GPS code | High — reads what Strava already recorded with a real GPS stack | High: user opens app, everything since last sync lands. Not *zero*-touch (foreground consent, §1b) | **None if sideloaded.** Health-apps declaration only bites on Play publish | Best. Google sets no retention limit; not Strava's API. Product risk: Strava can stop writing routes. |
| **GPSLogger → our endpoint** (continuous mode) | ~1 day (endpoint only); zero Android code | High — mature, battle-tested, buffers offline | **Highest — truly zero-touch** | **None.** F-Droid/APK, never on Play | Clean: our own recording, our own data. Privacy surface is large (logs everything, not just runs). |
| **GPSLogger → our endpoint** (start/stop per run) | ~1 day | High | Medium — 2 taps to start, 2 to stop | None | Clean |
| **OpenTracks + auto-export + Syncthing** | ~2–3 days (sync plumbing) | High | Medium-high — automatic after each recording, but user records in OpenTracks not Strava | None | Clean |
| **Capacitor + background-geolocation plugin** | ~2–4 days + licence (or ship debug build) | Medium — WebView fragility, OEM killers | High once running | None if sideloaded; if published, foreground-service-only design avoids the background-location declaration | Clean |
| **Kotlin native recorder** | ~1–2 weeks | Highest | High | None if sideloaded; yearly target-SDK treadmill if published | Clean |
| **PWA `share_target` (GPX in)** | ~0.5 day | High for what it is | **Low — Strava mobile cannot export GPX at all**; ~6–8 taps via the website | None | Clean (bulk export / own files) |
| **PWA foreground `watchPosition` + wake lock** | ~1 day | **Low — loses runs** | Low — screen must stay on and app in front for 45 min | None | Clean |
| *(baseline)* **Strava API** | already known | High | High | n/a | **7-day retention cap** — the thing we're routing around |

### Confidence and open questions

- **HIGH:** ExerciseRoute exists and carries real GPS; the 30-day read window and
  `READ_HEALTH_DATA_HISTORY`; Google imposes no retention time limit; Strava has no mobile
  GPX export; PWAs cannot record in the background; GPSLogger can POST to a custom endpoint;
  sideloading removes all Play obligations.
- **MEDIUM:** exact permission constant spelling (`READ_EXERCISE_ROUTE` vs `..._ROUTES`);
  whether "Always allow" genuinely permits foreground reads of another app's routes without
  a per-route dialog; internal-testing carve-outs.
- **UNVERIFIED / OPEN — resolve before committing to path 1:**
  1. **Does Strava write routes to Health Connect?** (5-minute device check, §1c-bis.)
  2. Same question for Samsung Health / Garmin Connect / Nike Run Club.
  3. Is there a "Google Health API" announcement in 2026 that changes Health Connect's
     status? Nothing in Google's own docs suggests deprecation.
- **Method note:** this session's WebSearch quota was exhausted before the first query, so
  all findings come from direct fetches of primary documentation (developer.android.com,
  support.google.com, MDN, project READMEs). Search-engine fetches were blocked by
  CAPTCHA/403. Where I could not reach a primary source I have said so rather than guessed.


## Q1 — Health Connect / Google Health API exercise routes

### 1a. Does `ExerciseRoute` exist and carry real GPS? — YES. Confirmed.

Exercise routes are **not a standalone data type**. They are an optional field on
`ExerciseSessionRecord` (the "Exercise" data type). Source:
https://developer.android.com/health-and-fitness/health-connect/features/exercise-routes

Each route is a list of `ExerciseRoute.Location`:

```kotlin
ExerciseRoute.Location(
    time = Instant,              // per-point timestamp
    latitude = Double,           // real GPS lat
    longitude = Double,          // real GPS lng
    horizontalAccuracy = Length,
    verticalAccuracy = Length,
    altitude = Length,
)
```

That is a full polyline with timestamps + altitude + accuracy — i.e. **everything a GPX
trace has**, and everything the fog-of-war map needs. Confidence: HIGH.

### 1b. Permissions and the consent flow

Two permissions exist (note the singular/plural inconsistency in Google's own docs — the
feature page says `READ_EXERCISE_ROUTES` plural for read, the data-types page says
`READ_EXERCISE_ROUTE` singular; verify against the actual SDK constant
`HealthPermission.PERMISSION_READ_EXERCISE_ROUTES` at build time):

- `android.permission.health.READ_EXERCISE_ROUTES` — read routes
- `android.permission.health.WRITE_EXERCISE_ROUTE` — write routes

There are **two access models**, and this is the crux:

1. **Session owner** (the app that wrote the session) reads its own route directly.
2. **Third-party app** reading *someone else's* route (our case — Strava wrote it):
   the read returns an `ExerciseRouteResult` which is one of `Data`, `NoData`, or
   **`ConsentRequired`**.

Verbatim from the docs:

> "When your app runs in the background and tries to read an exercise route created by
> another app, Health Connect returns an `ExerciseRouteResult.ConsentRequired` response,
> even if your app has **Always allow** access to exercise route data."

and

> "we strongly recommend that you request routes upon deliberate user interaction with
> your app, when the user is actively engaged with your app's UI."

**Interpretation (MEDIUM-HIGH confidence):** a blanket "Always allow" grant of
`READ_EXERCISE_ROUTES` does let you read other apps' routes — **but only in the
foreground**, with the user actively in your UI. Silent background harvesting of Strava's
routes is explicitly blocked; in the background you get `ConsentRequired` and must
prompt the user with a one-time-per-route dialog. So "fully automatic, user never opens
the app" is **not** achievable for third-party routes. "User opens Lost Soles, tap, all
new runs sync" **is** achievable with a single up-front grant.

This is the single most important caveat in this whole document.

### 1c. Platform retention window — the 30-day rule

Health Connect restricts an app to reading **only the last 30 days** of another app's
data by default. Reading older data requires the separate, additional permission
`android.permission.health.READ_HEALTH_DATA_HISTORY`.
Source: https://developer.android.com/health-and-fitness/guides/health-connect/plan/data-types
and https://developer.android.com/health-and-fitness/guides/health-connect/develop/read-data

Note the nuance: this is a **read-window** limit, not a storage-lifetime limit. Health
Connect itself keeps records until the user or the writing app deletes them; Google's
own on-device retention default has historically been 30 days for some paths, so
**do not assume anything older than 30 days will still be there.** For Lost Soles this
means:
- Backfill of history via Health Connect is unreliable → use the Strava bulk export for
  the historical map (already established as legal to keep forever).
- Health Connect is the **incremental / ongoing** channel: sync at least monthly, ideally
  every time the user opens the app. A 30-day-plus gap = permanently lost runs.


### 1c-bis. **Does Strava actually write routes to Health Connect? — THE PIVOTAL OPEN QUESTION**

**I could not verify this from primary sources.** My web-search budget was exhausted at the
start of this session and Strava's help-centre URLs for Health Connect returned 404 to
direct fetching. I am not going to guess and dress it up as a finding.

What I can say:
- Strava added Health Connect support on Android (replacing its Google Fit integration,
  which Google is sunsetting at end of 2026). That much is well established.
- **Many fitness apps write only *summary* records** — an `ExerciseSessionRecord` with type,
  duration, distance, calories, heart rate — and omit the optional `exerciseRoute` field.
  Writing routes requires the separate `WRITE_EXERCISE_ROUTE` permission and is opt-in
  engineering work. **Whether Strava does it is genuinely 50/50** and it is the single fact
  on which the whole Health Connect path turns.
- Strava has a clear *commercial* incentive not to: its API policy exists specifically to
  stop third parties accumulating its GPS corpus, and writing full routes into an open
  OS-level store undercuts that. Weigh that against the possibility they shipped it without
  thinking about it.

**Do not spend another hour of research on this. The user can settle it in five minutes:**

> Open **Settings → Security & privacy → Health Connect** (Android 14+) or the Health
> Connect app → **App permissions → Strava** → look for **"Exercise route"** in the list of
> permissions Strava has been granted. If "Exercise route" (write) appears and is on,
> Strava writes routes. Cross-check under **Data and access → Activity → Exercise** that
> recent Strava runs are listed.

For a definitive answer, install Google's **Health Connect Toolbox** sample app (or the
Kotlin bridge from §4a as a throwaway) and read one Strava session, checking whether
`exerciseRouteResult` comes back as `Data` or `NoData`.

**Other writers — status (all UNVERIFIED this session, ranked by my prior):**

| App | Writes exercise sessions to HC? | Writes *routes*? |
|---|---|---|
| **Samsung Health** | Yes, deep HC integration on Samsung devices | **Most likely yes** — Samsung was an HC co-designer with Google and its own workout records carry GPS. Best prior of the group. |
| **Strava** | Yes | **Unknown — the pivotal question above.** |
| **Garmin Connect** | Yes (steps, HR, sleep, activities) | Unlikely-to-unknown. Garmin's posture (closed API, paused applications per prior research) suggests they don't volunteer route data. |
| **Nike Run Club** | Partial / historically weak HC support | Unlikely. |
| **Whoop** | Yes for recovery/strain/sleep | **Almost certainly not** — the Whoop strap has no GPS; routes would come from the phone only, and it's not a mapping product. Irrelevant to a runner anyway. |

Note the asymmetry that makes this cheap to try: **if any one of these writes routes, the
user has a fully automatic path.** And **OpenTracks-style recorders can be made to write
routes to Health Connect themselves**, which turns Health Connect into a universal bus even
if Strava never plays along.

### 1d. Health Connect status in 2026 — healthy, not deprecated

- Health Connect ships as the Jetpack library `androidx.health:health-connect`; **1.1.0 is
  stable** as of the docs page last-updated 2026-02-03.
  Source: https://developer.android.com/health-and-fitness/guides/health-connect
- Compatible with **Android SDK 28 (Pie) and higher**. On Android 14+ it is built into the
  OS (no separate APK needed); on older devices it's the Health Connect app from Play.
- **Google Fit APIs are supported only until the end of 2026** — Health Connect is the
  official successor and migration target. So the direction of travel is *toward*
  Health Connect, not away from it.
- I found **no evidence of a "Google Health API" replacing or deprecating Health Connect**
  in Google's own developer documentation. CONFIDENCE: MEDIUM — my web-search budget was
  exhausted this session, so I could only check primary docs, not announcement blogs. If
  the user has seen a specific "Google Health API" announcement, treat this as an OPEN
  QUESTION, but note that even if a new API appears, Health Connect is the on-device data
  store underneath it and route data would still live there.

### 1e. Play Store policy and whether a personal / sideloaded app qualifies

**The declaration requirement is a *publishing* requirement, not a runtime one.** From
Google's own request-access page:

> "This process must be completed for all publishing requests, both for a new app that has
> not been published yet, or when updating an existing, already published app that now uses
> a different set of data types."

Source: https://developer.android.com/health-and-fitness/guides/health-connect/publish/request-access

Key structural fact: **Health Connect permissions are granted by the user in the Health
Connect settings UI on the device. There is no Play-side runtime gate.** The declaration
form is enforced by Play Console at *review* time. Therefore:

- **Sideloaded APK (adb install / direct APK): no declaration, no review, no Play
  involvement at all.** Health Connect will show your app in its permission list and the
  user can grant `READ_EXERCISE_ROUTES` and `READ_HEALTH_DATA_HISTORY` like any other app.
  CONFIDENCE: HIGH on the mechanism, MEDIUM on there being zero future gating — Google has
  progressively tightened this surface and *could* add a Play-signature check.
- **Internal testing track:** this still goes through Play Console and the App content →
  Health apps declaration form is still surfaced. Internal testing has historically had
  *lighter* review than production, but the health declaration is part of "App content"
  and applies to the app record, not the track. Treat "internal testing skips the health
  declaration" as **UNVERIFIED — do not plan around it.** Sideloading is the safe bet.
- **Is a personal app eligible on the merits?** Yes. The Play health policy's approved use
  cases explicitly include apps that let users "directly journal, report, monitor, and/or
  analyze" physical activity. A personal running map is squarely inside that. The friction
  is paperwork (privacy policy URL, per-data-type justification), not eligibility.
  Source: https://support.google.com/googleplay/android-developer/answer/9888170

### 1f. Retention — the good news

**Google's Health Connect policy imposes NO retention time limit on data a reading app has
lawfully read.** The policy requires disclosure and a user-facing delete path
("User help documentation explaining how users can manage and delete their data from the
app, and what happens to the data when an account is deactivated and/or deleted"), plus
bans on selling health data to advertisers/brokers/data-brokers. It does **not** say
"delete after N days".
Source: https://support.google.com/googleplay/android-developer/answer/9888170

This is a materially better legal position than the Strava API, whose policy caps retention
of API-sourced GPS at 7 days.

### 1g. Does Strava's ToS reach data Strava wrote into Health Connect? — honest assessment

**The argument in our favour:** Strava's API Agreement governs *the API*. Health Connect is
not Strava's API; it is an OS-level data store on the user's own device, into which Strava
writes at the user's instruction. We never authenticate to Strava, never accept their API
terms, never receive an API key. The data arrives from Android, and the Android platform's
own policy (above) permits indefinite retention. This is the same posture as the bulk
export, which prior research already established is legal to keep forever.

**The weaknesses — state these plainly, don't oversell:**
1. **Strava's consumer Terms of Service still bind the user**, and they are broader than
   the API Agreement. If Strava's ToS contains a clause restricting redistribution or
   commercial use of "Content" the user uploaded, a Strava lawyer could argue it reaches
   any egress path. In practice consumer ToS almost always grant the *user* rights to their
   own data, and GDPR/CCPA portability rights are on our side.
2. **Strava controls the tap.** If Strava decides third-party apps siphoning routes out of
   Health Connect is competitive harm, they can simply stop writing routes to Health
   Connect in the next app update, with no notice and no recourse. This is a *product*
   risk, not a legal one, and it is the more likely failure mode.
3. **The "user's own on-device data" argument does not survive commercialisation well.**
   For a personal app it is unimpeachable. If Lost Soles ever becomes a multi-user product
   whose core value is Strava-sourced traces, "we just read Health Connect" starts to look
   like deliberate circumvention of the API's 7-day rule, and a cease-and-desist becomes
   plausible. Design the adapter so this channel is swappable.
4. **Attribution is recorded.** Health Connect records the origin package of every record.
   You will know the data came from `com.strava`, and so would anyone auditing.

**Verdict:** for the user's own personal use, the Health Connect path is clearly better
legal ground than the Strava API. It is not a magic bypass for a commercial product.

---

## Q2 — Existing open-source Android app pointed at our own endpoint

### WINNER: **GPSLogger for Android** (mendhak, GPLv2)

Source: https://gpslogger.app/ · code: https://github.com/mendhak/gpslogger

This does exactly what Q2 asks for, out of the box, with **zero Android code written by us**:

- Records to **GPX, KML, CSV, NMEA**.
- **"Custom URL"**: fires HTTP requests to an arbitrary endpoint with configurable
  **HTTP method, headers, body template, and basic auth** — i.e. we can POST JSON to
  `https://lostsoles/api/ingest` with a bearer token in a header. Per-point streaming.
- **HTTP POST of the finished file**: it can auto-send the completed GPX file to a custom
  HTTPS endpoint when a logging session ends (also FTP/SFTP/Dropbox/Drive/OwnCloud/OSM/email).
- Ships a first-class **Dawarich integration**, which is itself just "POST points to a
  self-hosted endpoint with an API key" — proof the custom-endpoint path is real and used.
- Actively maintained; distributed via **F-Droid and GitHub APKs, not Google Play**
  (it was pulled from Play over proprietary-library rules). So: **sideload, no Play review,
  no Play policy exposure whatsoever.**

**Cost to adopt: build one HTTPS endpoint on Amplify that accepts a GPX (or GPSLogger's
JSON body template) and hands it to the existing normalized Activity+Trace adapter.**
That is backend work we need anyway. Android-side cost is a settings screen the user fills
in once.

**The catch — and it's a real one:** GPSLogger is a *location logger*, not a *run recorder*.
It has no concept of "an activity". Two ways to live with that:
- **(a) Manual start/stop** alongside Strava. Two taps at the start of a run, two at the
  end. Better than exporting after every run, worse than truly automatic. GPSLogger can be
  started/stopped by Tasker/Automate intents, so it can potentially be chained to Strava's
  start — but Strava exposes no reliable public broadcast, so this is fragile.
- **(b) Log continuously** at a coarse interval (e.g. a point every 30–60 s, or distance-
  filtered) and let the backend segment it. For a **fog-of-war map this is arguably
  superior** — it reveals every street you ever walked, not just the ones you ran. It is
  also strictly more automatic than anything else in this document: zero user action, ever.
  Costs: battery, and a much bigger privacy surface (it logs your commute, your home, your
  everything). Worth prototyping — for the specific mechanic Lost Soles has, this may be
  the actual right answer rather than a compromise.

### Runners-up

| App | Records activities? | POST to arbitrary HTTPS? | Verdict |
|---|---|---|---|
| **OpenTracks** (OpenTracksApp/OpenTracks, GPLv3, actively maintained) | **Yes** — a proper workout recorder, GPX 1.1 / KML / KMZ export, BLE sensors | **No built-in HTTP/webhook.** It has "export automatically after each recording (e.g., to sync via Nextcloud)" — i.e. auto-write the GPX to a folder, which you then sync with Nextcloud/Syncthing. Also has a **public API for start/stop by another app** (Tasker/Automate) and a **Dashboard API** for live track display. | **Strong second.** Best *activity* semantics of anything here, and would let the user drop Strava for recording entirely. Getting the file to our endpoint needs a folder-sync hop (Syncthing → server → ingest watcher), or a small PR to add a webhook. Source: https://github.com/OpenTracksApp/OpenTracks |
| **OwnTracks** | No — continuous location, MQTT or HTTP mode | **Yes**, HTTP mode POSTs JSON location objects to any endpoint | Viable as a continuous-logging alternative to GPSLogger (b); no activity concept, less flexible body templating |
| **Dawarich companions** | No — continuous location | Yes, that is literally the design (API key + self-hosted endpoint); GPSLogger and Overland are the standard clients | Confirms the pattern; use GPSLogger directly rather than adopting Dawarich's stack |
| **PhoneTrack** (Nextcloud) | No — continuous location, session-oriented | Yes, logs to a configurable URL | Works, but Nextcloud-shaped; GPSLogger is more configurable |

**Conclusion for Q2: yes, this path exists and it is cheap.** GPSLogger + one ingest
endpoint is the lowest-build-cost automatic option in this entire document, and it has
zero Play Store exposure because it's sideloaded from F-Droid.

---

## Q3 — What a PWA actually gets on Android in 2026

### 3a. Foreground tab + `watchPosition` + Screen Wake Lock for a 45-minute run: **NO. Don't.**

The Screen Wake Lock API is explicitly scoped to *visible, active* documents. MDN:

> "Only active documents can acquire screen wake locks and previously acquired locks are
> automatically released when document becomes inactive."

Source: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API

Concretely, here is what breaks on a real 45-minute run:

1. **Phone goes in a pocket / armband and the user taps the power button** → document hidden
   → wake lock released → Chrome throttles then freezes the tab → `watchPosition` stops
   firing. You get a trace that ends 90 seconds into the run.
2. **Any app switch** — answering a call, skipping a track in Spotify, replying to a
   message, or Strava's own screen coming to front — hides the tab. Same outcome. You have
   to reacquire on `visibilitychange`, and the gap in between is simply lost.
3. **Screen must stay on and unlocked for 45 minutes.** That is a large battery cost, a
   hot phone, and a screen your leg will press buttons on. Wake lock is also released by
   the OS under **power-save mode or low battery** — exactly the conditions at the end of a
   long run.
4. **Android may discard the tab entirely under memory pressure.** Unless you write every
   single point to IndexedDB as it arrives, a discard loses the whole run. Even with
   IndexedDB, the trace stops at the discard.
5. **`watchPosition` accuracy in a browser is worse than a native fused-location client.**
   No `PRIORITY_HIGH_ACCURACY` fused provider tuning, no sensor fusion with the
   accelerometer, coarser and less frequent fixes.
6. There is **no service-worker geolocation**. Service workers cannot access
   `navigator.geolocation` at all, and Background Sync / Periodic Background Sync cannot
   sample location. There is no web API on Android that records GPS with the screen off.
   Full stop.

**Verdict: a PWA cannot record runs on Android. This is not a "mostly works with caveats"
— it is a hard platform limit.** It is fine as a *display* surface (the fog-of-war map
itself is a perfect PWA), just not as a *recorder*.

### 3b. `share_target` — the manifest feature works; the Strava half does not

**The web platform side is real and confirmed.** A manifest `share_target` with
`"method": "POST"`, `"enctype": "multipart/form-data"` and a `files` param declaring
`".gpx"` registers an installed PWA in the Android system share sheet, and the file arrives
in the service worker's `fetch` handler as `FormData`. MDN gives exactly this pattern.
Chrome on Android is the primary (essentially only) implementation — MDN flags it as
"limited availability / experimental" because Safari and Firefox don't support it, which is
irrelevant for an Android-only user. The PWA **must be installed to the home screen** for
the share target to register.
Source: https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/share_target

**But the "export GPX from Strava" half is dead on mobile.** From Strava's own support docs:

> "Navigate to one of your Activity pages and from the more (ellipses) menu, select
> 'Export GPX'."

and, decisively:

> "Please note that exporting your data is only available on the Strava website."

Source: https://support.strava.com/hc/en-us/articles/216918437-Exporting-your-Data-and-Bulk-Export

**The Strava Android app has no GPX export and therefore nothing to put in the share
sheet.** The real flow would be: open strava.com in Chrome (not the app) → find the
activity → ellipsis → Export GPX → file lands in Downloads → open Files → share → Lost
Soles. That is roughly **six to eight taps plus navigation, after every single run** — the
exact motivation-killer the user named. **This is not a 2-tap flow. Do not build the
product around it.**

Where `share_target` *is* genuinely worth 30 minutes of work:
- **Paired with OpenTracks or any recorder that can share a GPX from its own share sheet**
  — then it really is 2 taps and it's a legitimate fallback path.
- As a **manual repair tool**: bulk-export files, a run the automatic pipeline missed, a
  GPX from a friend's watch. Cheap, useful, no downside. Build it, just don't rely on it.

---

## Q4 — Cheapest viable native companion app

### 4a. The Android permission picture — and the big cost-saver

Two very different apps are possible here, with wildly different permission burdens:

**App type A — the "bridge": reads Health Connect, POSTs to our endpoint. No GPS at all.**
- Permissions: `android.permission.health.READ_EXERCISE`,
  `android.permission.health.READ_EXERCISE_ROUTES`,
  `android.permission.health.READ_HEALTH_DATA_HISTORY`, INTERNET.
- **No `ACCESS_FINE_LOCATION`. No `ACCESS_BACKGROUND_LOCATION`. No foreground service.
  No Doze exemption. No OEM battery-killer problem** — it only runs when the user opens it
  (which, per §1b, is required anyway for third-party route reads).
- This is a **one-screen app**: "Sync now", a last-synced timestamp, a sign-in token.
  Realistically **300–600 lines of Kotlin**. This is the cheapest native thing that could
  possibly work.

**App type B — the "recorder": records the run itself with GPS.**
- `ACCESS_FINE_LOCATION` (runtime), `FOREGROUND_SERVICE`, and from Android 14 (API 34)
  **`FOREGROUND_SERVICE_LOCATION`** with `android:foregroundServiceType="location"` on the
  service, plus `POST_NOTIFICATIONS` on Android 13+ for the mandatory ongoing notification.
- **You do NOT need `ACCESS_BACKGROUND_LOCATION`** if the user starts the run in your UI
  and you launch the foreground service while the app is visible. That is the whole design
  of a run tracker. Avoiding that one permission is what lets you **skip Google Play's
  background-location declaration and demo video entirely.** (CONFIDENCE: HIGH on the
  Android rule; verify against the manifest merger at build time.)
- **Doze**: a foreground service survives Doze. You do not strictly need
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, though prompting for it improves reliability on
  aggressive OEMs. Play heavily restricts that permission's use; a sideloaded app doesn't
  care.
- **OEM battery killing is the real enemy**, not AOSP. Samsung, Xiaomi/MIUI/HyperOS,
  OnePlus/OPPO/ColorOS, Huawei and Vivo kill foreground services aggressively despite the
  documented contract. Mitigations: ongoing notification, request battery-optimisation
  exemption, write every fix to a local DB immediately so a kill costs seconds not the run,
  and tell the user to whitelist the app. See dontkillmyapp.com for per-OEM steps. **Budget
  real time for this** — it is the #1 source of "my run got cut in half" bug reports for
  every independent tracker.

### 4b. Play Store exposure — what sideloading buys you

**Background-location declaration** (only relevant to app type B if you needed
`ACCESS_BACKGROUND_LOCATION`, which you shouldn't): requires a Permissions Declaration
Form, a **≤30-second video** showing the feature activating from the background plus the
disclosure dialog and runtime prompt, a prominent in-app disclosure, and a hosted privacy
policy. Reviewers judge whether foreground-only would suffice — for a run tracker, they'd
likely say it would. Crucially, the policy states:

> "Note that app bundles or APKs across all active release tracks (including closed and
> open tracks) are subject to review."

Source: https://support.google.com/googleplay/android-developer/answer/9799150

So **closed and open testing tracks do NOT let you skip this.** Internal testing is not
named in that sentence, which is suggestive but not a guarantee — do not bet on it.

**Target API level treadmill**: from **31 August 2026**, new apps and updates must target
**Android 16 (API 36)** to be submitted to Play; existing apps need API 35 to stay
available to new users on new devices. But:

> "Permanently private apps that are restricted to users in a specific organization and
> intended for internal distribution only" are exempt.

Source: https://support.google.com/googleplay/android-developer/answer/11926878

**Sideloading (direct APK / F-Droid-style install) removes every one of these obligations:
no declaration, no demo video, no health-apps form, no annual target-SDK deadline, no
review.** The costs are: no auto-update (write a tiny "new version available" check, or use
Obtainium against a GitHub releases repo), the user must enable install-from-unknown-
sources once, and Play Protect will show a scary dialog on first install. For a single
technically-competent user, this is unambiguously the right distribution channel, and it
should be the default assumption for everything in this document.

### 4c. Capacitor vs Kotlin vs Flutter

**Capacitor wrapping the existing Next.js frontend**
- Mechanically it works: `server.url` in `capacitor.config` can point the WebView straight
  at the live Amplify deployment, so you keep **one** frontend codebase and the app is a
  thin native shell. (A static export also works but loses SSR; pointing at the live URL is
  the pragmatic choice.)
- Background-geolocation plugins, 2026 status:
  - **`@transistorsoft/capacitor-background-geolocation`** — the serious one. Motion-API
    driven (accelerometer/gyro/magnetometer) so it stops the GPS when you're stationary;
    handles the foreground service, Doze, persistence and **built-in HTTP auto-upload to a
    custom endpoint with retry** (which is exactly our ingest contract). Repo is MIT but
    **"A license is required for RELEASE builds on both iOS and Android"** — the SDK is
    "fully functional in DEBUG builds — no license required". *For a sideloaded personal
    app you can ship the debug build and pay nothing*, which is a legitimate, if slightly
    cheeky, route. A release licence is a few hundred dollars one-time.
    Source: https://github.com/transistorsoft/capacitor-background-geolocation
  - **`@capacitor-community/background-geolocation`** — free, MIT, genuinely maintained
    (v1.2.26, supports Capacitor 3–7). Simpler: it gives you a location stream and requires
    the mandatory notification. **Important gotcha it documents itself: "Android throttles
    HTTP requests after 5 minutes in the background", so you must buffer locally and upload
    with a native HTTP plugin rather than `fetch` from the WebView.**
    Source: https://github.com/capacitor-community/background-geolocation
- **Effort: ~2–4 days** for a working recorder (Capacitor init, plugin wiring, permissions,
  notification, local buffer, upload). **Ongoing maintenance: low-to-moderate** — you inherit
  Capacitor's and the plugin's upgrade cadence, and if you ever publish to Play you're on
  the yearly target-SDK treadmill. If you sideload, you can simply not upgrade for years.
- **Risk:** a WebView-hosted UI running a 45-minute GPS session is more fragile than native,
  and the JS side can be killed while the native service survives — all state must live
  native-side or in the plugin's own store, not in the WebView.

**Kotlin native**
- For **app type A (the Health Connect bridge)** this is *by far* the cheapest option:
  the Health Connect client is a first-party Kotlin/Jetpack library, there is no Capacitor
  plugin worth using for it, and the whole app is one screen. **Effort: ~1–2 days for an
  AI agent, ~300–600 lines.** Ongoing maintenance: near zero (Health Connect 1.1.0 is
  stable; the API surface won't churn).
- For **app type B (the recorder)**: `FusedLocationProviderClient` + a foreground service +
  Room + WorkManager upload. **Effort: ~1–2 weeks** including OEM battery testing. It is a
  genuine second codebase, but a *small and boring* one — the surface is ~5 files and it
  will not need to track your web app's evolution at all.

**Flutter**
- **Don't.** It's a third toolchain with no code reuse from the Next.js frontend, and the
  best background plugin (`flutter_background_geolocation`) is the same Transistor Software
  product under the same licence. Strictly dominated by both alternatives here.

**Ranking for Q4: Kotlin bridge (type A) ≪ Capacitor recorder ≈ Kotlin recorder ≪ Flutter.**
