# R9 — Devices & Vendor APIs: leaving Strava as the data source

**Research date:** 2026-08-30
**Project:** Lost Soles — permanent fog-of-war running map
**Question:** Strava's June 2026 API terms forbid indefinite retention of API-sourced GPS (see R1). Should the user change recording device/ecosystem to get an automatic, retention-friendly data path?
**Method:** Primary sources fetched and read on 2026-08-30 — vendor developer portals, API licence agreements (Garmin's PDF read in full), product spec pages. Battery figures cross-checked against DC Rainmaker, the5krunner's spec database, and The Run Testers, with vendor claims distinguished from independent measurements throughout.

---

## RECOMMENDATION

### The tension this brief resolves

**The best watches have the worst API access, and the vendor with the best API access makes the weakest-battery watch.** Garmin wins on hardware and is completely closed. Polar is the only self-serve API and its Vantage M3 ranks **14th of 15** on battery. Resolving that trade is the whole job.

**Answer: apply to Suunto first — it is the only vendor that scores well on both.**

| Priority | Device | Ecosystem | Battery (your usage) | Cost |
|---|---|---|---|---|
| **1. Target** | **Suunto Race 2** | Suunto API — gated, **but form is open**; 2-week review | **~14 d — matches your Whoop** | $499 |
| **2. Guaranteed fallback** | **Polar Vantage M3** | Polar AccessLink — **self-serve, no gate** | ~6 d — clears your bar, nothing more | $399 |
| **3. If you'd rather have the best watch** | **Garmin Instinct 3 Solar 45mm** | ❌ **API closed** — manual export chore | **~17 d**, more with sun | $399 |

### The honest catch, stated plainly up front

> **Garmin's developer API is not available to you.** It is business-only — *"it is only for business use"*, personal applications rejected — **and new applications are paused entirely as of 2026**, with the form removed and no reopening date. Worse, **the unofficial workaround everyone recommends stopped working in March 2026**: Garmin changed its auth flow and added Cloudflare TLS fingerprinting, and `garth` — the library the entire unofficial Python ecosystem depended on — was deprecated by its maintainer on 2026-03-27. New logins simply fail. **Do not plan on Garmin.** This is the most important finding in this brief, and it is the opposite of what most online advice will tell you.

### The four-line version

1. **Polar is the only mainstream sports-watch vendor whose API an individual can self-serve into** — free, no company, no NDA, no approval gate — and its licence has **no retention cap at all**, unlike Strava's seven-day rule. That makes it the guaranteed fallback.
2. **But Polar's battery is the worst in the survey (~6 days, rank 14/15).** It clears "not daily charging" and nothing more. **Suunto Race 2 gets you ~14 days — Whoop parity — *and* a real webhook API whose application form is still open.** That is why Suunto leads, and why applying costs you two free weeks to find out.
3. **Battery is not the binding constraint you think it is.** Every dedicated sports watch except the Apple and Pixel clears "not daily charging." **The scarce resource is API access.** Your Pixel Watch complaint generalises: always-on AMOLED is the killer, and MIP-display watches (Instinct 3 Solar, Enduro 3) are the ones that genuinely beat Whoop.
4. **You may not need to switch at all.** Strava's restrictions attach only to *API-sourced* data; your own **bulk export is legal to keep forever** (R1 §6.6). If you tolerate a periodic manual export, this costs $0 and nothing can revoke it. **Buy a watch to buy automation and to replace Whoop — not to become legal.**

**The cost re-frame:** Whoop 2026 runs **$199/yr (One) to $359/yr (Life)** — your ~$30/mo implies the top tier. A $399-499 watch pays for itself in **14-18 months** against the mid tier, then runs free, *and* records your runs. DC Rainmaker's August 2026 accuracy testing found **"there's just no meaningful difference between these companies"** on sleep and HRV — so the swap costs you little in data quality.

### Do this, in order

| # | Action | Cost | Why |
|---|---|---|---|
| 1 | **Never register a Strava API application** | $0 | If you never accept the agreement, it never binds you (R1). Cheapest risk elimination available. |
| 2 | **Seed the map once from your Strava bulk export** | $0 | Legal indefinitely. Full running history on day one — the *one* manual step, ever. |
| 3 | **Apply to Suunto's partner programme this week** | $0, ~2 weeks | The only route to Whoop-class battery *and* automation. Ask about retention terms before committing. |
| 4 | **Buy Suunto Race 2 if accepted, else Polar Vantage M3** | $399-499 | Automatic webhook ingestion, dual-band GPS, offline maps, credible sleep tracking. |
| 5 | **Archive every raw FIT on arrival, before parsing** | $0 | Insurance against Polar §8.4 / Suunto's unpublished retention terms. |
| 6 | **Connect the vendor app → Strava; let Whoop lapse** | −$199-359/yr | Keep the social feed, drop the subscription. |

---

## PART 1 — Developer API terms, ranked by data-retention freedom

### 1.0 How I ranked these

Four questions decide it, in this order:

1. **Can *you*, an individual with no company, get access at all?** A perfect API you cannot obtain is worth zero.
2. **Does it deliver GPS route data** (FIT/GPX with lat/lon samples), not just summaries?
3. **Does the agreement permit indefinite retention?** This is where Strava fails (R1: §6.2 seven-day cache cap, §5.5 "Persistent Index" ban, §5.7 no storing geographic information).
4. **Is delivery automatic** (webhook/push) or does it need polling or manual export?

### 1.1 The ranking table

| Ecosystem | Individual dev access? | GPS route data? | Indefinite retention allowed? | Auto push/webhook? | Cost | Overall |
|---|---|---|---|---|---|---|
| **Polar** (AccessLink) | ✅ **Yes — self-serve.** Register with a Polar Flow account at `admin.polaraccesslink.com`; no human approval gate | ✅ Yes — FIT, TCX, **GPX**, plus raw lat/lon route samples | 🟡 **Effectively yes.** No retention cap anywhere in the agreement. Must delete *tokens* on user disconnect (§3.3); must delete data if the *agreement* terminates (§8.4) | ✅ Yes — webhooks on exercise / sleep / activity / continuous HR, plus pull-notification fallback | Free (§6; right to charge reserved) | 🥇 **Best obtainable** |
| **Garmin** (Connect Dev Program) | ❌ **No.** Business-only *and* **new applications are paused as of 2026** | ✅ Yes — Activity API serves full `.FIT`, GPX, TCX | ✅ **Yes — the best terms of any vendor here** (see §1.2) | ✅ Yes — Ping/Pull or Push | Free (§10.1) | ⛔ **Best terms, unobtainable** |
| **Suunto** (apizone) | ❌ Companies/organisations only — *"we do not provide this for personal use"* — **but the form is still open** | ✅ Yes — FIT files with GPS tracks | ❓ Not published; terms sit behind the partner agreement | ✅ Yes — New Workout / New Route / 24-7 Activity / Sleep | Not disclosed | 🟡 Gated, softer gate than Garmin |
| **Wahoo** (Cloud API) | ✅ Yes — agreement explicitly contemplates a **sole proprietor aged 18+** | ✅ Yes — `workouts_read`, `routes_read` scopes | ❌ **No.** Explicit *"Wahoo Data Retention"* clause: delete on 48h notice; delete on user request/termination | ✅ Yes | Free; right to charge reserved | 🟡 Open but wrong terms — **and no running watch** |
| **COROS** | 🟡 Partner onboarding requiring *"an authorized technical representative"* + **company details** | 🟡 Official MCP **explicitly withholds GPS route**; OAuth API is partner-gated and undocumented publicly | ❓ Not published | ❓ Not published | Not disclosed | 🟠 Opaque |
| **Amazfit / Zepp** | ❌ No public developer API at all | ❌ Not via any public API | n/a | ❌ | n/a | ⛔ Dead end |
| **Apple Watch** | 🟡 Free Apple dev account, but… | ❌ **HealthKit is iOS/watchOS-native only.** No REST, no cloud, no server-side API | n/a once on your own server | ❌ Requires shipping a native iOS app that POSTs to your backend | $99/yr to keep a build installed past 7 days | ⛔ **Kills a web app** |
| **Samsung / Wear OS** | 🟡 Samsung Health Data SDK | 🟡 *"Exercise location"* is supported — but **on-device Android SDK only**, no cloud pull | n/a | ❌ Native Android app required | Free | ⛔ Same native-app problem |

**Read the table this way:** the top two rows are the only ones that deliver route data automatically under retention terms compatible with a permanent fog-of-war map — and **one of them is closed.** That is the entire finding of Part 1.

### 1.2 Garmin — the painful details

**One line: Garmin has the best data-retention terms in the industry and you cannot have them.**

**Eligibility — business only; individuals are rejected.** The Program FAQ states the program *"is only for business use."* Integration documentation is blunter: you must apply as a **legal entity** (company, university, hospital, research institution) — *personal applications are rejected* — with a **company-domain email** (no Gmail), a public website, and a privacy policy.
- https://developer.garmin.com/gc-developer-program/program-faq/
- https://ghurt.org/garmin-api-for-personal-use (2026-07-15): *"Garmin does not offer a personal API. The Garmin Connect Developer Program requires applicants to be a legal entity — a company, university, hospital, or research institution — and personal-use applications are rejected."*

**Applications are currently PAUSED.** Per the Garmin Connect Developer Program team on Garmin's own developer forums: *"the application form for new partners has been removed, and new API access requests are paused with no projected reopening date."*
- https://www.themomentum.ai/blog/garmin-developer-program-closed-roadmap — published **2026-07-15**, last updated **2026-08-27**
- Corroborated: https://openwearables.io/docs/providers/garmin-api-integration — *"The Garmin Connect Developer Program is currently on hold."* Existing accounts keep working; new ones cannot be created.
- **My own check (2026-08-30):** I fetched https://developer.garmin.com/gc-developer-program/ and its overview page directly. **Neither contains a "Request Access" button, application form, or application link** — only a generic Contact link and the line *"Stay tuned for more updates on the program."* Consistent with the form having been removed. Note Garmin has published no press release; there is no official statement beyond the forum reply.

**What you would get if the door reopened (worth knowing — see §3.8):**
- **Activity API** is the right one: *"Activity data files (.FIT, GPX, .TCX formats) available for complete activity details"*, with a choice of *"Ping/Pull or Push Architecture."* https://developer.garmin.com/gc-developer-program/activity-api/
- **Health API** is all-day metrics (HR, sleep, steps) — **not** route data. **Connect IQ** is a *separate, still-open* program for on-watch apps, watch faces and data fields; it does **not** give you a server-side data feed, so it is not a route around the freeze.
- **Cost: free.** Agreement §10.1: *"no license fees or other payments will be due under this Agreement in exchange for the rights granted."* §10.1–10.2 reserve the right to charge later on 30 days' notice, and to charge for request volume above limits.
- **Retention: excellent — better than anyone else surveyed.** The agreement's Standard Contractual Clauses annex specifies the *"period for which data will be retained"* as **"for duration of the end user maintaining an account with data importer or until end user exercises rights to delete personal data, whichever comes first."** That is precisely the fog-of-war model: keep it as long as the user keeps their account. And §9.5's termination duty — *"cease using, destroy and permanently erase … all copies of the API and Garmin Brand Features"* — names **the API and brand assets, not the user data**. Contrast Strava §5.5, which explicitly names archives and derived data.
- **Practical limit even for partners:** backfill returns roughly the last month, and each data type *"can usually be backfilled only once"*, with backfill disabled by default in the consent screen. So **no deep historical map from the API regardless of who you are.**
- Source PDF, read in full (FRM-0952 Rev. B): https://developerportal.garmin.com/sites/default/files/Garmin%20Connect%20Developer%20Program%20Agreement.pdf

**And the unofficial route just broke. This matters more than anything else in this brief.**
- **`garth`** — the Python library that handled Garmin SSO for essentially the whole unofficial ecosystem, including `python-garminconnect` — was **deprecated 2026-03-27**. The maintainer: *"Garmin recently changed their auth flow, breaking the mobile auth approach that Garth and other libraries using Garth depend on… I'm not in a position where I can dedicate the time to adapt Garth to these changes."* https://github.com/matin/garth/discussions/222
- Garmin tightened Cloudflare bot protection with **TLS fingerprinting**. Existing saved sessions keep working until their token expires; **new logins do not work at all.**
- Community patches exist — browser User-Agent override, Playwright headless auth, TLS-impersonation forks, `garmin-connect-mcp`. All are cat-and-mouse against an actively hostile Cloudflare configuration, and all are outside Garmin's terms. **Building Lost Soles' only ingestion path on one of these is building on sand**, and it fails the "no chore after every run" requirement the moment it breaks.

**Non-API Garmin routes, honestly assessed:**
- **Garmin Connect → Dropbox auto-export does not exist natively.** Garmin has never shipped it; the long-running feature request confirms only third-party workarounds. https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/164529/upload-fit-file-to-dropbox-automatically — *caveat: that thread is ~2016-2017 and I could not re-verify current Garmin Connect settings within budget, so treat "still no native export" as high-confidence, not certain.*
- **Third-party sync brokers** — FitnessSyncer and tapiriik can push Garmin activities to Dropbox as FIT files automatically; FitnessSyncer generally needs a paid tier for ongoing automatic sync. These are pre-existing Garmin partners so are probably unaffected by the new-application freeze — but you would be depending on a third party's continued partner status. https://www.fitnesssyncer.com/support/garmin-connect
- **USB mass storage** — every Garmin watch exposes `/GARMIN/ACTIVITY/*.FIT`. Fully legal, fully yours, zero terms accepted. But it is a manual chore, which is the thing you are trying to eliminate.

### 1.3 Polar — the quiet winner on access

**This is the only mainstream sports-watch vendor where an individual can self-serve their way to a GPS-bearing, webhook-driven API.**

- **Signup:** create a Polar Flow account → https://admin.polaraccesslink.com → fill in application details → create an OAuth2 client → receive client ID and secret. The docs say plainly: *"Any registered Polar Flow user can create API client to AccessLink by filling application details."* **No partner review, no NDA, no company-domain email, no brand-fit committee.** https://www.polar.com/accesslink-api/
- **Data:** training sessions plus **FIT, TCX and GPX export**, and route samples with latitude/longitude. Also sleep stages, Nightly Recharge, continuous HR — i.e. the Whoop-replacement metrics come from the same integration.
- **Webhooks:** yes — push on new exercise, sleep, activity and continuous HR, with pull-notification polling as a fallback.
- **Cost:** free. Agreement §6: *"At the moment Polar offers the use and activation of Polar API's free of charge. However, Polar reserves the right to charge fees from time to time at its discretion."*
- **Actively maintained, not a zombie endpoint.** AccessLink v3's changelog has an entry dated **13.01.2026** (previous: 18.08.2025). A newer **AccessLink Dynamic API v4** also exists, likewise self-serve, with 15 OAuth2 scopes covering training sessions, sleep, daily activity, continuous HR, routes and Nightly Recharge. https://www.polar.com/polar-api-v4/ There is **no deprecation notice on either.**

**Retention — the part that decides this brief.** I read the Polar API License Agreement, version dated **22 August 2025**: https://www.polar.com/en/legal/polar-api-agreement

- **There is no retention period cap.** Nothing resembling Strava's seven-day cache rule, and no "Persistent Index" prohibition. This is the single most important sentence in Part 1.
- **§3.3** — on member request, or when the member's relationship with you ends, you must cease access, revoke the token, and *"delete related token(s) from Your database(s) and server(s)."* Read that carefully: **the deletion duty is scoped to the *tokens*, not to the historical activity data.**
- **§8.4 — this is the catch.** *"If and when this Agreement is terminated… You shall cease the use of Licensed Materials… and You shall destroy and delete all copies of the Licensed Materials and Data."* Polar may terminate on 30 days' notice (§8.2) and may suspend access *"for any or no reason, with immediate effect"* (§8.3). So retention is indefinite **while the agreement stands**, not unconditionally. Mitigation in §3.3 of Part 3.
- **§2.1/§2.2** — licence is for *"proprietary application or services development"*; you may not create *"a service similar to or competing with Polar Ecosystem."* A personal fog-of-war map is not a Polar competitor. Lost Soles is comfortably clear.

**Real limitation — short history window.** AccessLink exposes only **the last ~30 days of exercises** (general lookback 365 days; activity queries capped at 28-day ranges), and only data uploaded after you registered. This is **fine for a webhook pipeline** — each run arrives within minutes and you keep it forever in your own store — but there is **no historical backfill**. See Part 3 for the fix (seed once from Strava's bulk export).

### 1.4 Suunto

A genuinely good API behind a door that is closed to individuals — but less firmly than Garmin's, and **the door is still there.**

- **Eligibility, verbatim:** *"We can provide access to companies/organizations that are building tools/apps/services for commercial & non-commercial usage. However we do not provide this for personal use."* https://apizone.suunto.com/faq
- **Note the nuance that makes this worth a shot:** **non-commercial is explicitly permitted.** The disqualifier is *personal* use, not absence of revenue. A free public app with a website and privacy policy is not obviously outside this. Review criteria are *brand fit, customer interest, and innovation mindset* — a marketing judgement, not a legal one.
- **The application form is open.** I fetched https://www.suunto.com/welcomepartners on 2026-08-30: it still presents a live *"Apply now"* button — unlike Garmin, which has removed its form entirely.
- **Process:** *"The applications are reviewed on weekly bases, so you have to wait few days prior getting the acceptance. There is maximum two week waiting period."* Faster and more transparent than Garmin ever was.
- **Data:** workouts and daily activity. *"FIT files has most comprehensive dataset from each workout"* — GPS tracks, HR, R-R, power, altitude, laps, summary. OAuth2.
- **Webhooks:** yes — New Workout, New Route, 24/7 Activity, 24/7 Sleep. https://apizone.suunto.com/webhooks
- **Retention: unknown.** Not published; the terms live inside the partner agreement you only see after acceptance. **This is an unquantified risk** — do not assume Polar-like freedom.
- **Cost:** not disclosed publicly.

**Verdict: the only realistic non-Polar backup.** Worst case you lose two weeks and learn nothing painful.

### 1.5 Wahoo

Open to individuals, **wrong retention terms**, and — decisively — Wahoo does not currently make a GPS running watch worth buying (ELEMNT is bike computers; the RIVAL watch has effectively been left behind). Included for completeness.

- **Eligibility:** genuinely open. The Public API Agreement's representations contemplate *"If you are a sole proprietor, that you are at least 18 years of age"* — **individuals are eligible**, which is rare here. Access is request-and-approve via the Developer Portal; Wahoo asks for *"as much information as you can about your application."* https://developers.wahooligan.com/cloud
- **Data:** `workouts_read` and `routes_read` scopes; FIT-based workout files.
- **Retention — disqualifying.** The agreement contains an explicit **"Wahoo Data Retention"** section: *"you agree, promptly upon request and without waiting for a cache refresh to occur, to delete any Wahoo Data remaining in your cache that Wahoo requests you delete and to do so promptly and in all events within forty-eight (48) hours"*, and *"All Data about an end user in your possession or control must be deleted by you upon such end user's request or upon such end user's termination."* That is a Strava-shaped kill switch on your map. https://www.wahoofitness.com/wahoo-api-agreement
- **2026 change:** from **2026-01-01**, applications are limited to 10 unrevoked access tokens per user.
- **Cost:** free today; right to charge reserved.

### 1.6 COROS

Best-in-class batteries, **worst-in-class data transparency.** This is the biggest disappointment in the survey, because on hardware COROS would otherwise be the obvious pick for this user.

- **Official API: partner-gated.** COROS grants OAuth 2.0 access to platforms meeting *"standard security and operational requirements"*, via an onboarding process requiring *"an authorized technical representative"* to submit **company details**, technical contacts, and OAuth redirect URIs. Application form: https://support.coros.com/hc/en-us/articles/17085887816340-Submit-an-API-Application — *that page returned HTTP 403 to my fetches; these details come from COROS's own help-centre summary text surfaced in search. **Medium confidence** — if you are seriously considering COROS, email them and ask directly whether an individual can be approved.*
- **The MCP server is not a substitute, and this is the killer.** COROS shipped the first official MCP server from a major endurance brand (**2026-05-13**, updated 2026-05-31), exposing 15 endpoints across profile, activities, daily health, HRV/recovery and training plans. But it **explicitly withholds route data**: *"The AI cannot list the streets a workout passed through, draw the route, or compare elevation profiles between two sessions."* Second-by-second streams are withheld too. **An interface that cannot draw the route cannot feed a fog-of-war map.** https://the5krunner.com/2026/05/13/coros-mcp-ai-data/
- **Unofficial export:** `xballoy/coros-api` bulk-exports Training Hub activities to FIT/TCX/GPX/KML/CSV — but warns in its own README: *"⚠️ This repository is using a **non-public API** from COROS Training Hub that could break anytime."* https://github.com/xballoy/coros-api
- **Manual export** from COROS Training Hub to FIT/GPX works and is yours by right. Auto-sync exists to a fixed partner list (Strava, TrainingPeaks and others), **not to arbitrary endpoints of your choosing.**

### 1.7 Amazfit/Zepp, Apple, Samsung — brief

- **Amazfit / Zepp:** **no public developer API.** Zepp exposes no queryable server-side API to third parties; integration is limited to a fixed partner list (Strava, adidas Running, Relive, Apple Health, Google Fit) plus Health Connect. Cheap watches, superb battery, **no programmatic path**. Anything in the wild extracting Zepp data is reverse-engineered.
- **Apple Watch:** **HealthKit is an iOS/watchOS-native framework with no REST, cloud, or server-side API.** https://developer.apple.com/documentation/healthkit To get route data off an Apple Watch into a web app you must build and ship a native iOS companion app that reads `HKWorkoutRoute` and POSTs to your backend, plus $99/yr Apple Developer Program to keep a build installed beyond 7 days. **This is the single biggest architectural mismatch for a web-based Lost Soles** — and the Apple Watch fails the battery test outright anyway.
- **Samsung / Wear OS:** the Samsung Health Data SDK supports an *"Exercise location"* data type, but it is an **on-device Android SDK** (Samsung Health 6.30.2+, Android 10+, no emulator support) with **no mechanism for your server to pull data**. https://developer.samsung.com/health/data/overview.html Same native-app requirement as Apple.

### 1.8 Health Connect — flag only (separate agent owns this)

Not researched in depth here per the brief. Two things to hand over:

1. **Vendors documented as writing to Health Connect:** Amazfit/Zepp (explicitly expanded Health Connect sync with user-selectable metrics), Samsung Health, Polar Flow, Suunto. **Garmin Connect's Health Connect write support I could not verify within budget.**
2. **The decisive question for that agent:** Health Connect defines an `ExerciseRoute` type, but **writing it is optional and many vendors write only `ExerciseSession` summaries.** "Vendor X supports Health Connect" is *not* the same as "vendor X supplies GPS traces." That distinction determines whether Health Connect is a viable universal sink for Lost Soles at all.

---

## PART 2 — Device recommendations, battery-life first

### 2.0 The finding that reframes everything

**Always-on AMOLED is what kills battery, and vendor "smartwatch mode" claims almost always assume gesture-to-wake, not always-on.** DC Rainmaker measured the Forerunner 970 draining in **~2.5 days** with always-on display at default brightness, against Garmin's 7-day AOD claim — a ~65% shortfall. His verdict: *"Garmin needs to redefine their brightness levels."* ([DCR FR970 in-depth](https://www.dcrainmaker.com/2025/06/garmin-forerunner-970-in-depth-review-brillance.html))

**The watches that genuinely deliver Whoop-like endurance are the MIP/transflective ones** — Instinct 3 Solar, Enduro 3, COROS Pace 3 — because MIP is always-on at essentially zero power cost. That is the structural insight that should drive the hardware decision. Your Pixel Watch complaint generalises: it was an always-on AMOLED problem.

Figures below are labelled **(claim)** vs **(measured)**. Measured figures come from DC Rainmaker, the5krunner's spec database, and The Run Testers.

### 2.1 Comparison table

| Model | Release | Smartwatch battery (claim / measured) | GPS battery | Multiband? | Sleep vs Whoop | Price |
|---|---|---|---|---|---|---|
| **Garmin Instinct 3 Solar 45mm** | Jan 10, 2025 | 28 d / unlimited w/ solar (claim); 7-9 d no sun worst case, 28-35 d mixed (indep.) | 40 h GPS · **24 h multiband** (40 h solar) | ✅ **+ SatIQ** | 🟢 Strong — Body Battery + Training Readiness | **$399** |
| **Garmin Instinct 3 Solar 50mm** | Jan 10, 2025 | **40 d / unlimited w/ solar** (claim) | 60 h · **34 h multiband** | ✅ + SatIQ | 🟢 Strong | $449 |
| **Garmin Instinct 3 AMOLED** | Jan 10, 2025 | 18 d claim → **7 d always-on** | 32 h · 38 h all-sat | ✅ + SatIQ | 🟢 Strong | $449/$499 |
| **Garmin Instinct E** | Jan 10, 2025 | 14-16 d (claim) | 21-24 h · 14-16 h all-sat | ❌ single-band | 🟡 **No Training Status/Load** | $299 |
| **Garmin Forerunner 70** | **May 15, 2026** | 13 d claim / **5 d always-on** | 23 h claim → **18.6 h measured** | ❌ | 🟢 Strong | $249.99 |
| **Garmin Forerunner 170** | **May 15, 2026** | 10 d claim / **4 d always-on** | 20 h claim → **18.75 h measured** | ❌ | 🟢 Strong | $299.99 |
| **Garmin Forerunner 265** | Mar 2023 | 13-15 d claim / **~4 d measured AOD** | 20-24 h · 14-16 h multiband (beat spec) | ✅ | 🟢 Strong | ~$349 street |
| **Garmin Forerunner 570** | May 2025 | 10-11 d claim / **no independent measurement exists** | 18 h · 13-14 h multiband | ✅ | 🟢 Strong | $549.99 |
| **Garmin Forerunner 970** | May 2025 | 15 d claim / **~2.5 d measured AOD** | 26 h · 19 h multiband | ✅ | 🟢 Strong | $749.99 |
| **Garmin Vivoactive 6** | Apr 2025 | 11 d claim / **5 d always-on** | 21 h · 17 h all-sat | ❌ | 🟡 Moderate | $299.99 |
| **Garmin Enduro 3** ⚠️ | Aug 2024 | 36 d/90 d solar claim → **~26 d measured** | 120 h · **60 h multiband** | ✅ | 🟢 Strong | ~$749 street |
| **Garmin Fenix 9 / 9 Pro** ⚠️ | **Aug 25, 2026** | 10-31 d by size — **claim only, 5 days old** | 30 h · 81 h max-battery | ✅ | 🟢 Strong | $999-$1,399 |
| **Garmin Fenix 8 / 8 Pro** ⚠️ | 2024/2025 | 10-29 d — claims only | 35-62 h multiband | ✅ | 🟢 Strong | Clearing |
| **COROS Pace 4** | 2026 | 20 d claim → **10 d measured (raise-to-wake), 5 d (AOD)** | **31 h dual-band** | ✅ | 🟡 EvoLab is load-led, thin sleep analytics | **$249.99** |
| **COROS Pace 3** ⚠️ | Aug 2023 | 17 d (claim, MIP) | 38 h · **only 15 h dual-freq** | ✅ | 🟡 | **Discontinued Feb 2026** |
| **Suunto Run** | 2025 | 12 d (claim) | 20 h multiband | ✅ | 🟠 Weaker | $249.99 |
| **Suunto Race 2** | **Aug 2025** | **16 d (claim)** | **55 h dual-frequency** | ✅ | 🟡 DCR: sleep/wake times *"correctly nailed"* | **$499** steel / $599 Ti |
| **Suunto Vertical 2** | Sep 2025 | 20 d (claim) | 65 h claim → **~50 h measured** | ✅ | 🟡 Moderate | ~$599-699 |
| **Polar Vantage M3** | Oct 2024 | **7 d (claim)** — weakest here | 30 h · 70 h eco | ✅ dual-freq | 🟢 Good — Nightly Recharge well-regarded | $399 |
| **Amazfit T-Rex 3** | Sep 2024 | **27 d typical / 13 d heavy** (claim) | 42 h accurate · 72-180 h | ✅ 6 constellations | 🟠 **68.3 g / 48.5 mm — poor sleep watch** | $279.99 |
| **Apple Watch / Pixel Watch** | — | ❌ ~1-2 days | ❌ | ✅ | 🟢 | — |

### 2.2 Days between charges for *your* usage — the ranking that matters

~4 h/week GPS (multiband where available) + 24/7 wear with sleep tracking, notifications on, **gesture-wake not always-on**.

| Rank | Watch | Est. days between charges |
|---|---|---|
| 1 | Instinct 3 Solar 50 mm | **~24 d** (more with sun) |
| 2 | Enduro 3 ⚠️ | ~21 d |
| 3 | **Instinct 3 Solar 45 mm** | **~17 d** (more with sun) |
| 4 | Suunto Vertical 2 | ~16 d |
| 5 | **Suunto Race 2** | **~14 d — matches your Whoop** |
| 6 | Amazfit T-Rex 3 | ~12 d |
| 7 | **COROS Pace 4** | **~11-12 d** |
| 8 | COROS Pace 3 ⚠️ | ~10 d |
| 9 | Suunto Run | ~9 d |
| 10-13 | FR70 / Vivoactive 6 / FR265 / FR170 | ~7-8 d (FR265 **~4 d with AOD**) |
| **14** | **Polar Vantage M3** | **~6 d — weakest on this list** |
| 15 | Forerunner 970 | **~2.5 d with AOD** — effectively disqualified |

**Ranks 1-7 beat or match your Whoop's 14 days.** Everything above rank 13 clears "not daily charging." **Note where the Polar Vantage M3 lands: dead last but one.** It clears your hard requirement and nothing more — that is the price of its API, and you should see the number plainly.

### 2.3 The three picks

#### 🏆 BEST OVERALL HARDWARE — **Garmin Instinct 3 Solar 45 mm ($399)**

**~17 days without sun, longer with any outdoor running — longer than your Whoop.** The MIP display is why: no always-on penalty, no brightness slider to babysit, no gap between claim and reality. 52 g, genuinely wearable overnight (the 50 mm's extra 6 g produces *"a noticeable difference in comfort during all-day wear"* per Treeline). True dual-frequency multiband with SatIQ — *"dramatically improved location accuracy, especially in challenging environments like urban canyons and dense forests"*, which matters for a permanent map, since a wandering trace paints wrong streets you can't easily un-paint.

**Correction to my earlier draft: the Instinct 3 *does* have multiband.** I had this wrong.

**Compromise: no onboard maps.** DCR's headline criticism — *"every other watch in the $400-500 price range now includes maps."* You get breadcrumb navigation and GPX/course import. For 3-8 miles in a new city with a pre-loaded route that's usually enough; for on-watch route *discovery* it isn't. HR sensor is Gen 4, not Elevate v5.

**And the catch that outranks all of this: Garmin's API is closed to you (Part 1).** This is the best watch here and the worst ecosystem. Buy it only if you accept a manual-export chore.

#### 💰 BEST VALUE — **COROS Pace 4 ($249.99)**

The Run Testers call it *"the best value running watch on the market."* **Measured 10 days raise-to-wake / 5 days always-on** against a 20-day claim — so 10 is your real number, ~11-12 at your volume. **31 h dual-band GPS — more multiband endurance than the $749 Forerunner 970.** *"Accurate GPS tracks during our runs and bike rides, including at city events."*

**At 32 g it is the lightest serious GPS watch here** — *"extremely light and thin… very comfortable to wear 24/7."* That matters enormously for a Whoop refugee whose benchmark is a featherweight strap.

**Turn off the always-on display** — that one setting is the difference between 5 days and 10.

**Catch: COROS's API is partner-gated and its own MCP explicitly refuses route data.** Manual export or nothing.

#### 🔋 BEST BATTERY *with a usable API* — **Suunto Race 2 ($499)**

**This is the pick that resolves the brief's central tension, and it is why it now leads the recommendation.**

**16 days claimed / ~14 days realistic — matching your Whoop exactly** — plus **55 h dual-frequency GPS**, AMOLED, and **offline maps**. DCR's review title is *"finally accurate"*, and he found it *"correctly nailed"* sleep and wake times.

**Uniquely, it is the only long-battery watch here with a real, sanctioned webhook API** delivering FIT files with GPS tracks — and **Suunto's application form is still open** (verified 2026-08-30).

The pure battery king is the **Instinct 3 Solar 50 mm** (~24 days, $449) — but 58 g and 50 mm is a lot of watch to sleep in, and Garmin's API is shut. The Race 2 gets you Whoop-parity battery *and* a door you can actually knock on.

### 2.4 Do not buy right now

- ⚠️ **Garmin Enduro 3** — Enduro 4 leaked in Connect app code (Jun 17, 2026) and **cleared the FCC Jun 18, 2026** (A05216). Expected *"potentially landing in September"*. Do not spend $749-899 today.
- ⚠️ **Garmin Fenix 8 / 8 Pro** — superseded by **Fenix 9 / 9 Pro, launched Aug 25, 2026**. Current discounts are inventory clearance.
- ⚠️ **Garmin Fenix 9** — five days old, **zero independent data**. Given the 970's 65% AOD shortfall, distrust AMOLED claims until measured. Also $999+.
- ⚠️ **COROS Pace Pro** — a **Pace 4 Pro** (W337) hit a regulatory filing **Aug 5, 2026**; such filings *"typically indicate a launch within weeks."* The Pace 4 itself is safe; the current Pace Pro is not.
- ⚠️ **COROS Pace 3 — discontinued Feb 2026**, and its dual-frequency mode is only 15 h, the weakest multiband endurance in the table. *(This corrects my earlier draft, which named it a value pick.)*
- ⚠️ **Forerunner 55 / 165 — discontinued**, replaced by FR70 / FR170 (May 2026).
- ⚠️ **The Epix line is dead** — delisted Jan 2025, absorbed into Fenix AMOLED.
- ⚠️ **Forerunner 970 / 570** — the always-on trap. The 570 has *no* independent measurement: DCR — *"I never quite got around to finishing my Forerunner 570 review."* At $549 with no onboard maps (DCR: *"baffling"*), worst value here.
- ⚠️ **Amazfit T-Rex 3** — 27-day claim is real, but **68.3 g / 48.5 mm** is a poor overnight companion, and **Zepp has no developer API at all** (Part 1).
- ❌ **Apple Watch / Pixel Watch** — disqualified on battery before the API question arises.

### 2.5 Whoop replacement — better news than expected

DC Rainmaker published an accuracy deep-dive on **2026-08-03** testing Garmin's Cirqa band against **Whoop 5.0**, Fitbit Air, Amazfit Helio and Polar Loop ([link](https://www.dcrainmaker.com/2026/08/accuracy-deep-dive-garmin-cirqa-whoop-fitbit-air-amazfit-helio-polar-loop-testing.html)):

- Sleep onset and wake detection: **no meaningful gap** — *"most devices picked these up within 5 minutes of falling asleep."*
- Overnight HRV: all devices trended together.
- His conclusion on 2026 raw accuracy: **"there's just no meaningful difference between these companies."**
- He **declined to compare sleep *stages*** at all — even gold-standard devices are *"accurate at best ~80% of the time."* Whoop's stage breakdown is not the precision instrument its marketing implies.

On interpretation, Garmin's Training Readiness/Status are *"Garmin's biggest advantage over every one of their rivals"* — more sophisticated than Whoop's single Recovery Score.

**Cost correction:** Whoop 2026 pricing is **$199/yr (One) to $359/yr (Life)** ([the5krunner, 2026-08-06](https://the5krunner.com/2026/08/06/cirqa-vs-whoop-comparison/)) — your ~$30/mo implies the top tier. A $399-499 watch pays for itself in **14-18 months** against the mid tier, then runs free, *and* records your runs — collapsing two devices into one.

**Ranking for your purposes:** Garmin (Body Battery + Sleep Coach + Training Readiness) > Polar Nightly Recharge > COROS EvoLab > Suunto ≈ Amazfit. Garmin also handles pushups/situps/planks properly — strength profile with automatic rep counting, which Whoop lacks.

**Note the tension this creates:** Garmin is the best Whoop replacement and has the worst API access. Suunto is mid-tier on recovery analytics but is the only long-battery watch with an open API door.

---

## PART 3 — Synthesis: *"If Strava isn't going to support this long-term, what are my options?"*

### 3.1 First, restate the problem precisely

R1 established the key distinction, and everything here follows from it:

> Strava's restrictions attach to **"Strava Data" — data accessed *from the Strava API Materials*.** Files a user exports from their own account are **"Developer Application Data"**, which the retention clauses do not cover. §6.6 explicitly preserves the user's export right: *"Nothing in this Agreement is intended to limit or condition that user-facing right."*

So the problem is **not** "Strava won't let me keep my runs." It is: **"the only *automatic* Strava path — the API — caps retention at 7 days, and the only *unlimited* Strava path — bulk export — is manual."**

That reframe matters, because it means you are not shopping for a *legal* solution. You are shopping for an **automatic** one. Every option below is legal; they differ in how much chore they impose and how fragile they are.

### 3.2 The five real options

| # | Option | Automatic? | Indefinite retention? | Cost | Fragility |
|---|---|---|---|---|---|
| **A** | Keep Strava phone app, ingest via **manual bulk export** | ❌ Manual chore per run (or a periodic batch) | ✅ Yes, unambiguously (R1 §6.6) | $0 | 🟢 None — nobody can revoke it |
| **B** | Keep Strava, use the **API**, retain anyway | ✅ | ❌ Violates §5.5/§5.7/§6.2 | $0 | 🔴 Terms violation + audit clause §6.2 |
| **C** | **Polar watch → AccessLink webhook → Lost Soles** | ✅ Fully | ✅ No cap in the agreement | Watch (~$300-400) | 🟡 Polar can terminate (§8.2/§8.3) |
| **D** | **Garmin/COROS watch → unofficial scraping** | ✅ until it breaks | ✅ (no terms accepted, but also no permission) | Watch | 🔴 `garth` already dead; Cloudflare TLS fingerprinting |
| **E** | **Garmin/COROS/Suunto watch → sync broker or USB → your app** | 🟡 Semi (broker) / ❌ (USB) | ✅ Your own files | Watch + maybe ~$5-10/mo broker | 🟡 Depends on a third party's partner status |

**Option B is off the table** — R1 rates the prohibition at 95% confidence across four independent clauses, and §6.2 of the Agreement gives Strava an audit right. Don't build the whole project on a clause you're knowingly breaking.

**Option D is off the table as a primary path.** This is the honest bad news of this brief: the workaround everybody on the internet recommends for Garmin **stopped working in March 2026**. `garth` is deprecated, Garmin added TLS fingerprinting to its Cloudflare config, and new logins fail. Patched forks exist and will keep existing, but you would be signing up to maintain an adversarial scraper forever as the *foundation* of your app. That is the opposite of "no chore after every run."

### 3.3 The cleanest fully-automatic path with indefinite retention

**Polar. It is the only vendor where every box is genuinely ticked and obtainable today.**

```
Polar watch
   └─(auto, BLE)→ Polar Flow app / Polar Flow cloud
         ├─(AccessLink webhook, seconds later)→ Lost Soles backend
         │      • pull FIT or GPX + lat/lon route samples
         │      • write to your own Postgres/PostGIS, keep forever
         │      • also pull sleep + Nightly Recharge for the RPG "rest" mechanic
         └─(Polar Flow → Strava connector)→ Strava, for the social feed
```

Why this and not the others:

- **It is the only one an individual can actually sign up for.** No company, no NDA, no partner review, no company-domain email. Any Polar Flow user creates an OAuth2 client at `admin.polaraccesslink.com`. Garmin's door is *closed*; Suunto's says *"we do not provide this for personal use"*; COROS wants an *"authorized technical representative"* and company details.
- **It has no retention cap.** I read the agreement (22 Aug 2025). Nothing resembles Strava's 7-day cache or Persistent Index language. §3.3's deletion duty is scoped to **tokens**, not history.
- **It genuinely pushes.** Webhooks on new exercise, sleep, activity, continuous HR — so a run lands in Lost Soles minutes after you stop it, with zero user action. That is the requirement.
- **It is actively maintained.** AccessLink v3 changelog has an entry dated **13.01.2026**, and a v4 "Dynamic API" exists. This is not an abandoned endpoint.

**Be honest about the catch (there are three):**

1. **§8.4 termination clause.** *"If and when this Agreement is terminated… You shall destroy and delete all copies of the Licensed Materials and Data."* Polar may terminate on 30 days' notice (§8.2) or suspend *"for any or no reason, with immediate effect"* (§8.3). So this is **indefinite retention at Polar's continued sufferance**, not a permanent right. **Mitigation, and you should do this from day one: the moment a FIT arrives via AccessLink, also archive the raw file to your own storage.** Files you hold that a user exported/owns are outside the API-sourced category, exactly as R1 argued for Strava. Belt and braces.
2. **No historical backfill.** AccessLink exposes only ~30 days of exercises. Your fog-of-war map starts empty from the day you integrate. **Fix: seed it once from your existing Strava bulk export** (legal indefinitely per R1 §6.6) — you get your whole running history as the initial reveal mask, then Polar keeps it current automatically. This is a genuinely nice property: *one* manual step, ever.
3. **You are buying into Polar's hardware**, which is not the battery champion of the field (see Part 2). The Vantage M3 gives you **~6 real days** between charges — **rank 14 of 15 in Part 2's table, the weakest watch surveyed** — that clears "not daily charging" comfortably, but it is well short of your Whoop's 14 days, and COROS, Suunto, Amazfit and the Garmin Instinct all beat it comfortably. **This is the single genuine sacrifice in the recommendation, and you should go in knowing it.**

### 3.3a The one alternative worth trying first — Suunto

There is a version of this where you don't sacrifice the battery, and it costs two weeks to find out.

**Suunto Race 2 (Aug 2025, $499) claims 16 days and works out to ~14 real days at your usage — genuine Whoop parity** — plus 55 h of dual-frequency GPS, offline maps, and **a real webhook API delivering FIT files with GPS tracks.** DC Rainmaker's review is titled *"finally accurate"*, and he found it *"correctly nailed"* sleep and wake times. The only thing standing between you and it is the FAQ line *"we do not provide this for personal use."*

But note what that line does and does not say. **Non-commercial use is explicitly permitted** — the disqualifier is *personal* use, not absence of revenue. Review is a brand-fit judgement, turnaround is two weeks maximum, and **the application form is still open** (I checked on 2026-08-30; Garmin's, by contrast, has been removed).

**So sequence it this way, before spending any money:**

1. **Apply to the Suunto partner programme now.** Present Lost Soles as a free, public, non-commercial app — give it a landing page and a privacy policy first. Cost: an afternoon and a two-week wait.
2. **If accepted** — ask them directly about data retention before you commit, since Suunto does not publish those terms. If retention is acceptable, buy the **Suunto Race 2** and you get Whoop-class battery *and* full automation.
3. **If rejected or the retention terms are bad** — buy the **Polar Vantage M3** and take the guaranteed path. You drop from ~14 days to ~6 (rank 14 of 15 in Part 2) and gain certainty. That is a real loss, which is precisely why step 1 is worth the two weeks.

You cannot lose by trying Suunto first, and the upside is that the one real compromise in this brief disappears.

### 3.4 Does the hybrid work? (keep Strava socially, watch vendor feeds the app)

**Yes — and it is the correct architecture, not a compromise.** It works for a precise legal reason:

- Lost Soles' data comes from Polar's API, not Strava's. It is not "Strava Data."
- **Do not register a Strava API application at all.** R1's cleanest posture: *"If you never accept the API Agreement, it never binds you."* Nothing in Strava's user-facing ToS restricts what your watch vendor does with your runs, or what you do with data you got elsewhere.
- Strava still gets your runs for kudos and the social feed, via **Polar Flow's built-in Strava connector** (Strava is on Polar's compatible-apps list). *Confidence note: I confirmed Strava is a supported Polar Flow connection but could not fetch Polar's specific auto-sync support article — verify the sync is automatic-on-connect rather than per-activity before committing.*

The only thing you lose versus today is that Strava becomes a *sink*, not a *source*. Which is exactly what you want, since being a source is the thing Strava's terms forbid.

### 3.5 Do you even need to switch devices?

**Strictly: no. Practically: probably yes, but not for the reason you think.**

The honest case for **not** buying anything (Option A): the Strava bulk export path is free, permanently legal, and unkillable. If you batch-export monthly and drop the zip on Lost Soles, the fog-of-war map works perfectly for $0. **If your real constraint were only "indefinite retention," you would already be done and this whole brief would be unnecessary.**

The case **for** a watch is that it solves four problems at once, and only one of them is Strava:

1. **Automation.** The stated whole point. A watch + Polar API removes the chore permanently.
2. **You stop carrying a phone on runs.** Phone-based Strava recording means the phone comes with you, every time.
3. **It replaces Whoop.** This is the financially decisive one — see §3.6.
4. **Battery.** A watch you charge weekly is strictly less friction than a phone you charge nightly *and* must remember to start the app on.

**A caveat on the "just use the phone" alternative you might be considering:** recording directly inside Lost Soles as a PWA is *much* harder than it looks. Browsers throttle or suspend the Geolocation API when the screen locks or the tab backgrounds; there is no reliable background-location story on the mobile web. Do not plan on a browser-based recorder as the primary capture path. (A native Android app writing to/reading from Health Connect is a more plausible phone-based route — flagged for the Health Connect agent, since it also determines whether *any* vendor writes the `ExerciseRoute` type rather than just session summaries.)

### 3.6 The Whoop-replacement maths — this changes the cost answer entirely

You are planning to let the Whoop subscription lapse. At roughly **$30/month that is $360/year**.

**Any watch in Part 2's shortlist pays for itself in under 14 months, and most in under 12.** Reframed properly, the question is not "should I spend $350 on a watch" — it is "should I keep paying $360/yr for a device that has no GPS and cannot feed my map, when $350 once buys me GPS, route data, an API, *and* the recovery metrics?"

On the quality of the swap, be realistic:
- **Sleep staging and HRV-based recovery**: Whoop is a leader here, and a watch's optical sensor on a bonier wrist position is generally a step down in *precision*. Polar's **Nightly Recharge** and **Sleep Plus Stages** are among the better watch-based implementations (Polar's sleep research pedigree is genuinely strong), and Garmin's Body Battery is the most *usable* version of the concept.
- **What you actually lose**: Whoop's strain-vs-recovery coaching loop, and 24/7 comfort — a screenless band is more pleasant to sleep in than any watch.
- **What you gain**: GPS, route data, an API, structured workouts, and no subscription.
- **For an RPG "rest bonus" mechanic**, a watch's recovery score is entirely good enough. You need a number from 1-100 that trends correctly, not clinical-grade HRV.

**Verdict: yes, dropping Whoop for a watch is a good trade for this user**, and the saved subscription should be counted against the watch price when judging affordability.

### 3.7 What I'd actually do

1. **Seed the map once from your existing Strava bulk data export.** Free, legal forever, and gives you a full history on day one. Do this regardless of what device you end up on.
2. **Do not register a Strava API application.** Ever. It is the single cheapest risk-elimination move available, and it costs you nothing you want.
3. **Apply to Suunto's partner programme this week** (§3.3a) — free, two-week turnaround, and the only route to keeping Whoop-class battery *and* full automation.
4. **Buy the watch the answer points to** — Suunto Race 2 if accepted with sane retention terms, otherwise **Polar Vantage M3** — and build the webhook ingester. Budget a weekend: OAuth2, one webhook endpoint, FIT/GPX parsing.
5. **Archive every raw FIT the moment it arrives**, before parsing. This is your insurance against Polar §8.4 / Suunto's unpublished equivalent.
6. **Connect the vendor's app → Strava** so nothing changes socially.
7. **Let Whoop lapse** once the watch's sleep data has a few weeks of history you trust.

### 3.8 If you'd rather buy on hardware quality and accept more chore

Entirely defensible, and I won't pretend otherwise: **Garmin and COROS make better running watches than Polar, and COROS makes far better batteries.** If the watch matters more to you than the automation, buy the Garmin or COROS from Part 2 and accept Option A/E — export in batches, or run a sync broker. The map still works. You just keep a small recurring chore, which is the exact thing you said you wanted to eliminate.

**Watch for a Garmin reopening.** Garmin's freeze is a pause, not a policy change — the terms behind it are the best in the industry (retention *"for duration of the end user maintaining an account"*). If the application form returns and you are willing to stand up a minimal LLC/website/privacy policy, Garmin becomes the best answer in this brief. Check https://developer.garmin.com/gc-developer-program/ every few months.
