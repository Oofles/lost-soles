# R8 — StatsHunters vs. the 2026 Strava Terms: A Recheck

**Date:** 2026-08-30
**Purpose:** Resolve the apparent contradiction between R1's finding (indefinite storage of Strava-API GPS data is prohibited) and the observable fact that https://statshunters.com/ does exactly that today.
**Method:** Independent verbatim re-fetch of both Strava legal documents; primary-source investigation of StatsHunters and the wider tile/street-hunting category; search for community reaction.

---

## CORRECTED VERDICT

**The earlier finding STANDS on the text. It was, however, wrong about one factual sub-claim, and it under-weighted the gap between what the terms say and what Strava enforces.**

In five parts:

1. **On the written terms: R1 was correct, and I verified every quotation verbatim.** All four clauses exist, at the section numbers R1 gave, with the wording R1 gave. The API Policy is real, is separate from the API Agreement, and carries `Effective Date: June 1, 2026`. §6.6's bulk-export carve-out is real and quoted accurately. Nothing was hallucinated or mis-numbered. A permanent fog-of-war store fed by the Strava API is, on the plain text, prohibited several times over.

2. **R1's one clear error: it claimed §5.7 (the geographic-location clause) was "new in 2026." It is not.** Near-identical language — "You may not... use or access the Strava API Materials to aggregate, cache, or store geographic location information or other user information accessible via the Strava API" — was being quoted by developers on the Strava API Google Group in **September 2022**, and the 7-day cache/retention rule was being asked about there as far back as **June 2015**. R1 correctly flagged the 7-day rule as old but incorrectly flagged §5.7 as new. This matters, because it changes the answer to the user's objection.

3. **The StatsHunters objection is answered by non-enforcement, not by a misreading.** StatsHunters, VeloViewer and intervals.icu have been operating under substantively the same written prohibition for at least four years, and in the 7-day cache rule's case for over a decade. They are not exempt; they are unenforced. This was noticed and stated publicly on Strava's own community forum in **August 2024**, naming those three apps specifically, with no Strava response. The correct conclusion is not "R1 misread the terms" but **"the terms have long said one thing and Strava has long done another, and in 2026 Strava began enforcing — but on athlete caps and tiers, not on retention."**

4. **Two findings that partly vindicate the user's instinct, and that R1 did not have.** First, per a second-hand but specific report, Strava's own **November 2024** compliance sweep told StatsHunters *"Your application has not been identified as being in violation with our updated API Agreement"* — i.e. Strava looked at an app that permanently stores GPS polylines and cleared it. Second, the **only** public product decision in the whole category attributed to these clauses comes from the developer of Ride Every Tile, who declined to build Strava sync at all and wrote: *"Although much of the API agreement appears to be ignored by both the Strava and developer sides currently, that may change in the future and it is not something I currently want to risk."* That is an outside developer independently reaching this document's exact conclusion.

5. **The most useful finding is architectural, not legal.** The category leaders — **Wandrer (4 sources) and CityStrides (7 sources)** — are multi-source. Dawarich treats Strava as a file import. Fog of World never touched it. **StatsHunters, the app the objection was built on, is the only single-source app in the survey and the most fragile one in the category.** Source-agnostic ingestion is already mainstream practice here, and it happens to also be the compliant architecture.

**Practical consequence for Lost Soles is unchanged from R1, but the reasoning is now firmer and better supported:** build the permanent store on user-supplied files (bulk export / direct GPX-FIT), keep ingestion source-agnostic, and treat the Strava API as one replaceable adapter. What changed is the *risk profile*. The realistic near-term threat to a 6-user app is **not a retention audit**. It is the 10-athlete cap, a reviewer misapplying a broad clause (§5.16 was flagged against an app that plainly isn't an abstraction layer), the June 2027 base-URL migration, and Strava's general posture toward small developers ahead of an IPO.

**One thing this document cannot tell you:** Reddit was completely inaccessible to every tool in both research passes (403 to fetchers, blocked to tooling, search budget exhausted). If a retention-specific uproar happened on r/Strava, I would not have seen it. Everything else — Hacker News, the Strava developer forum, GitHub, the trade press — shows the same pattern: loud complaints about the paywall and the caps, near-total silence on retention.

---

## PART 1 — Independent verification of the terms

I fetched both documents directly (`curl`, 2026-08-30), stripped the HTML, and read them end to end. Sources:

- API Agreement: https://www.strava.com/legal/api — page title **"API Agreement (2026)"**, `Effective Date: June 1, 2026`
- API Policy: https://www.strava.com/legal/api_policy — page title **"API Policy (2026)"**, `Effective Date: June 1, 2026`

These are genuinely two separate documents. The Policy states: *"this Strava API Policy (the 'Policy'), which is incorporated by reference into, and forms part of, the Strava API Agreement... In the event of a conflict between this Policy and the Agreement, the Agreement controls."*

### (a) Did a rewrite take effect 2026-06-01? — **CONFIRMED.**

Both documents carry `Effective Date: June 1, 2026`. Strava announced it in the Insider Journal ("An Update To Our Developer Program", https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428) — that thread is **closed for replies**, which is itself notable. The structure is new: the Policy is a fresh document with nine sections, and the Agreement was slimmed to fourteen.

### (b) The four clauses — **ALL FOUR CONFIRMED VERBATIM, at the stated section numbers.**

> **§6.2 Cache and Retention.** "You may not retain Strava Data in your cache for longer than seven (7) days. If your Developer Application checks for a resource (for example, a segment) and that resource is no longer available from Strava, you must remove it from your cache immediately, regardless of how frequently your cache is refreshed. Except for such limited caching, you may not store Strava Data, or provide or display Strava Data or any associated service, to any third party other than the Strava user using your Developer Application."

> **§5.7 No Aggregating, Caching, or Storing User or Geographic Information.** "You may not use or access the Strava API Materials to aggregate, cache, or store geographic location information or other user information accessible via the Strava API, except as expressly permitted by Section 6.2."

> **§5.5 No Scraping, Bulk Export, Harvesting, or Automated Extraction.** "You may not use web scraping, web harvesting, web data extraction methods, or any other automated means to extract data from the Strava Platform. You may not bulk-export Strava Data, including by accumulating Strava Data through repeated authorized API calls into a corpus, dataset, archive, or database that exceeds the operational scope of your Developer Application.
>
> You may not store Strava Data, or any data derived from Strava Data, in any Persistent Index. The foregoing prohibits indefinite storage in vector stores, embedding stores, search indexes, knowledge graphs, retrieval-augmented data stores, archives, and any other storage configured to enable subsequent retrieval, query, or use. The seven-day cache permitted under Section 6.2 is not a Persistent Index, provided that the cache is operated as a transient cache and is not used to enable any prohibited purpose under this Section 5.5."

> **§7.4 Deletion Obligation.** "Upon (a) a Strava user's request, (b) a Strava user's revocation of your Developer Application's authorization..., (c) a Strava user's deletion of the user's Strava account, (d) your cessation of use of the Strava API Materials, or (e) termination of this Agreement, you must promptly and permanently delete... (i) in the case of clauses (a) through (c), all Strava Data and all Personal Data derived from Strava Data relating to the requesting or revoking user; and (ii) in the case of clauses (d) and (e), all Strava Data and all Personal Data derived from Strava Data, regardless of user. Deletion under this Section 7.4 must be completed expeditiously but in any event within thirty (30) days... You must certify deletion to Strava in writing on request."

R1 was accurate on all four. No hallucination, no mis-numbering.

**Two supporting clauses R1 cited that I also confirm**, because they close the "it's derived data, not Strava data" escape:

> **§5.4 No Aggregation, Analytics, or De-Identified Processing.** "You may not process or disclose Strava Data—even publicly viewable Strava Data—including in an aggregated, de-identified, or anonymized manner, for the purposes of analytics, analyses, customer insight generation, or product or service improvements. You may not combine Strava Data with other customer data for these or any other purposes. The restrictions in this Section 5.4 apply to data derived from Strava Data and to output that incorporates or was generated using Strava Data."

> **§6.4 Retention Limited to Purpose.** "Except as expressly permitted by Section 6.2, you may not retain Data, and you may use and retain Data only so long as necessary for the purpose for which it was originally obtained."

And the audit right R1 cited, which is in the **Agreement**, not the Policy:

> **Agreement §6.2.** "Strava, or a third party agent working at our direction and subject to confidentiality obligations, shall be entitled to inspect and audit your Developer Applications for the purpose of verifying compliance with this Agreement."

*(Note the collision: "§6.2" means the cache rule in the Policy and the audit right in the Agreement. Cite carefully.)*

### (c) The §6.6 bulk-export carve-out — **CONFIRMED VERBATIM.**

> **§6.6 User Bulk Data Export.** "Each Strava user has the right to access and export the user's own Strava data, free of charge, through the Bulk Data Export Tool published on the Strava service. Nothing in this Agreement is intended to limit or condition that user-facing right."

R1's reading of this stands, and the supporting definitional argument also stands. Agreement §2.3(i): *"'Strava Data' means all data you access or collect **from the Strava API Materials**"* — a file the user downloads from their own account and hands to your app was not collected from the API Materials, so it falls under §2.3(ii) "Developer Application Data", which §5.5, §5.7 and §6.2 do not reach. §6.4 remains the residual ambiguity R1 flagged; that flag was correct and I have nothing that resolves it.

### (d) Subscription requirement and athlete caps — **CONFIRMED, with detail R1 partly missed.**

Policy §3.3 defines the tiers:

> "(a) **Standard Tier**..., inclusive of two levels: Developer Applications limited to **10 registered Strava users** (generally intended for hobbyists, side projects, and early development); and Developer Applications limited to **9,999 registered Strava users**...; (b) **Extended Access Tier**..., generally inclusive of Developer Applications serving **10,000 users or more and approved by Strava**. Extended Access Tier Applications are admitted on a case-by-case basis and **are not subject to subscription requirements**...
>
> Standard Tier Applications are subject to subscription requirements as published on the Strava developer site, including a requirement that the developer or specified end users maintain an active Strava subscription. Subscription requirements may change from time to time, and **Strava may grandfather, exempt, or comp Developer Applications in its discretion.**"

That last sentence is the only textual hook for a grandfathering hypothesis, and it is scoped to **subscription requirements only** — not to retention.

The developer docs (https://developers.strava.com/docs/getting-started/) confirm the operational picture:

- "All new applications start in **single-player mode**... A Strava subscription is a prerequisite for creating an app."
- Self-serve upgrade from the API dashboard raises you to **athlete capacity of 10**, read limits 200/15min and 2,000/day, overall 400/15min and 4,000/day.
- Beyond 10 athletes requires submitting the app for review.

Dates and price, per Strava's announcement and https://appsforstrava.com/blog/strava-developer-program-changes-2026: new developers from **June 1, 2026**; existing developers from **June 30, 2026**, with three months of subscription free. The price is the ordinary Strava membership, **$11.99/mo in the US**, not a separate developer fee. Extended Access is exempt. Also announced: Club endpoints and Segments Explore endpoints deprecated **Sept 1, 2026**; migration to a new API base URL by **June 1, 2027**.

**The important correction here for Lost Soles: R1 said the athlete cap "starts at 1." It effectively starts at 1 (single-player) but self-serves to 10 with no review.** A community moderator confirmed this on 2026-08-04: *"single-user use actually is a thing of the past since everyone can update to 10 users without review."* (https://communityhub.strava.com/developers-api-7/long-term-running-totals-13760) **A 6-user app fits inside the no-review tier.**

### What is actually new in 2026 vs. what is old

This distinction is the crux of the whole question, and R1 got it half right.

| Clause | New in 2026? | Evidence |
|---|---|---|
| §6.2 seven-day cache limit | **OLD.** Present in substance since at least 2015. | Developers debating the "Retention" clause on the Strava API Google Group from **Jun 15, 2015** onward (https://groups.google.com/g/strava-api/c/PJnl2Xlb1ow) |
| §5.7 no aggregating/caching/storing geographic location info | **OLD — R1 was wrong to call this new.** | Quoted near-verbatim by a developer in that same thread on **Sep 8, 2022**, alongside the observation that it contradicts the caching-encouraged Retention section |
| §6.2's "you may not store Strava Data... to any third party other than the Strava user" | **OLD.** | Quoted from the then-current agreement in a Community Hub thread of **Jul 31, 2024** (https://communityhub.strava.com/developers-api-7/storing-activity-distance-in-private-database-1921) |
| Display limited to the authenticated user (§2.3 / §6.1) | **New in Nov 2024**, not 2026. | https://press.strava.com/articles/updates-to-stravas-api-agreement (Nov 19, 2024) |
| AI/ML prohibition (§5.3) | **Introduced Nov 2024, massively expanded 2026** (now covers grounding, RAG, embeddings, evaluation, inference-time ingestion). | Same press release; compare current §5.3 |
| §5.5 "Persistent Index" language | **GENUINELY NEW in 2026.** | The vocabulary — vector stores, embedding stores, retrieval-augmented data stores — is AI-era drafting that could not predate 2023. I could not obtain a pre-2026 text to prove this by direct comparison (see limitations), so this is a strong inference, not a verified diff. |
| §5.4 aggregation/analytics/de-identified processing ban | **Probably new in 2026.** Same limitation. |
| §5.16 abstraction layers / MCP servers / pass-through proxies ban | **GENUINELY NEW in 2026.** | MCP did not exist in prior agreements; Strava launched its own first-party MCP (§3.5) at the same time |
| §3.3 Access Tiers + subscription requirement | **GENUINELY NEW in 2026.** | The June 2026 announcement |
| §7.4 30-day deletion + written certification | **Tightened in 2026.** |

**So: the two clauses that most directly kill a fog-of-war map — §6.2 and §5.7 — are not new. They are among the oldest and least-enforced provisions in Strava's developer terms.** What 2026 added was §5.5's explicit foreclosure of the derived-data workaround, plus an enforcement apparatus (tiers, review, subscription, audit, deletion certification) that did not previously exist.

### Limitation I must flag

**I could not access web.archive.org from this environment** (blocked at both the network and tool level), so I could not perform a direct textual diff of the pre-2026 and 2026 agreements. My "old vs. new" table is built from contemporaneous developer quotations of the older text in dated forum posts, plus Strava's own Nov 2024 press release. That is good evidence for the clauses developers happened to quote (§6.2, §5.7) and weaker evidence for the ones nobody quoted. **Anyone revisiting this should pull the archived pre-2026 agreement and diff it properly.**

---

## PART 2 — StatsHunters, investigated directly

`statshunters.com` is a Laravel + Vue single-page app; the served HTML is an empty shell, so page-level fetching returns nothing. **I therefore went to primary sources: the application's own JavaScript bundle (`/js/app.js`) and its public FAQ API endpoint (`https://www.statshunters.com/api/faq`, HTTP 200, ~20KB JSON).** Everything below is quoted from StatsHunters' own code and content, fetched 2026-08-30.

### Who runs it

> "I'm **Stan Ansems** and started with StatsHunters because I wanted to have a nice heatmap of my bike rides. After a while I added photos, statistics, badges and more. **I build it just for fun** and why not share the fun with others."
> — the `/about` page, extracted from the app bundle. The route metadata reads `"StatsHunters is a project of Stan Ansems"`.

> "**I started StatsHunters just for fun and hope I can keep it free for everyone.** If you want to support StatsHunters you can help by donating."
> — FAQ, "How can I support StatsHunters?"

**It is a one-person hobby project, not a business.** The bundle contains zero occurrences of "subscription", "premium", or "pro account"; it contains 24 occurrences of "donate" and 15 of "paypal". Support channels are personal and singular throughout the FAQ — *"please let me know and I can change the badge"*, *"don't hesitate to contact me."* Announcements go out through a Strava club (https://www.strava.com/clubs/334054), not a blog. Strong Netherlands signal: dedicated "Long term NL challenge", "Dutch provinces" and "Dutch regions" map layers.

### How it gets data — **Strava API only. This is the key finding.**

I checked the multi-source hypothesis directly and it is **false**:

> "**StatsHunters uses the Strava API to import your activity data.** However, Strava enforces rate limits on how many API requests can be made. **These limits apply across all StatsHunters users, not just your account.** There are two types of limits: Daily Limit... Short-Term Limit..."
> — FAQ, "Why is my data not updating immediately? (Hit Strava limits)"

> "When you first connect your Strava account, it may take some time for all your activities to load... When an activity is added on Strava it will be pushed to StatsHunters and it will be processed asap."
> — FAQ, "Not all my activities are imported"

The only OAuth connection offered is Strava: *"If you used StatsHunters before or want to start using it, **connect with Strava** to start."* An email/password login exists for legacy users, but **the "Register a new user" panel is rendered with `v-show: false` — self-serve email registration is disabled.** There is no Garmin, Komoot, Wahoo, Polar, Suunto, Ride with GPS or Coros ingestion, and no GPX/FIT upload path.

**This is worth being precise about, because it is easy to get wrong.** Two things in the app *look* like multi-source support and are not:

1. A list `[{Garmin},{Karoo},{Strava},{Wahoo},{Sigma},{Zwift},{Suunto},{iGPSPORT}]` appears in the bundle — this is the **recording-device label** on an activity (`activity.device`), used for filtering and for the Garmin attribution footer. It is not an ingestion source.
2. The FAQ lists "Supported websites: Strava, Komoot, Brouter, Bike Router, Ride with GPS, Garmin, Cycle.travel, Mapy.cz, Locusmap, Hammerhead, Dynamic.watch" — but that is the **StatsHunters browser extension**, which *overlays your tiles onto those sites' route builders*. Data flows out, not in.

**So StatsHunters is a pure Strava-API-fed, permanently-storing application. It has not migrated. Hypothesis 5 is dead for this app.**

### Confirmation that it stores GPS indefinitely, in its own words

> "**By default StatsHunters saves a less precise line of the activity to save space.** If you want to update an activity because it is not correct... 1. **Update activity precision: It will download the extended GPS data from Strava.**"
> — FAQ, "How to update activity precision for tiles/heatmap"

That is an explicit description of a permanent, server-side, simplified-polyline archive of every activity — with on-demand re-fetch of full-resolution GPS streams. It is exactly what §5.5 calls a "corpus, dataset, archive, or database" and §5.7 calls storing "geographic location information."

### It is non-compliant on at least four independent axes, self-documented

This is not a close call, and the retention clause is not even the most flagrant one.

1. **§7.4 deletion on revocation — flatly contradicted in the FAQ:**
   > "If you '**revoke access**' on the Strava website new data will not be synced, but **existing data will not be removed**."
   > — FAQ, "How can I delete my StatsHunters account?"

   Policy §7.4(b) requires permanent deletion of all Strava Data within 30 days upon "a Strava user's revocation of your Developer Application's authorization." StatsHunters says in writing that it does the opposite. Deletion is user-initiated only, via the settings page.

2. **§6.1 / §2.3 display limited to the authenticated user — violated by club heatmaps:**
   > "Your activities will be visible on **club heatmaps**, this can be disabled on your settings page." (FAQ, "Who has access to my data?")
   > "Join a club on Strava and invite others to join StatsHunters, to get a **Club heatmap and leaderboards** of Eddington number and total distance."

   §2.3: *"Strava Data provided by a specific Strava user may be displayed or disclosed in your Developer Application only to that user."* The setting is **opt-out** ("Hide my data in club heatmaps"), not opt-in.

3. **§5.4 aggregation/analytics — contradicted by its own privacy policy:**
   > "**Aggregated and Anonymized Data:** We may aggregate and anonymize the information we collect to create statistical data that does not identify any individual. This data may be used for **research, analytics**, and other purposes."

   §5.4: *"You may not process or disclose Strava Data—even publicly viewable Strava Data—including in an aggregated, de-identified, or anonymized manner, for the purposes of analytics, analyses, customer insight generation, or product or service improvements."*

4. **§6.2 / §5.5 / §5.7 retention** — the original question. Obviously violated.

### The privacy policy states no retention period at all

I extracted the full text of `/privacy` from the bundle. It is nine short generic sections (Information We Collect / Use / Sharing / Security / Third-Party Links / Children's Privacy / Changes / Contact / Delete your data). Salient points:

- **It never mentions Strava. Not once.**
- **It states no retention period whatsoever** — no "we keep activity data for N years", nothing.
- §9 is the only deletion provision: *"If you want to delete your data, you can delete your account on the settings page and all your data will be removed."* User-initiated only.
- It does not contain the disclosures Policy §2.1 requires (types of data collected, collection methods, how to withdraw consent, confirmation that deletion completed), nor the Usage Data statement §6.5 requires developers to include.

### One genuinely compliant detail — and what it proves

The footer renders a "**data by** [Garmin logo]" block, gated on `hasGarmin` (true when any activity has `device == 1`). **That is Policy §4.4 in action:** *"If your Developer Application displays information derived from Garmin-sourced data, you must display attribution to Garmin in the form and manner required by Garmin's brand guidelines."*

This matters: **StatsHunters is a live, registered Strava API developer that tracks and implements Strava's Policy requirements when it is aware of them.** It is not an abandoned app running on a forgotten key. It complies where compliance is cheap and visible, and does not comply where compliance would destroy the product.

### Corroborating detail from an independent second pass

A parallel investigation (different tooling, overlapping but not identical sources) confirmed everything above and added:

- **Identity and location.** Stan Ansems, **Waalre, North Brabant, Netherlands** — per the Strava club listing (https://www.strava.com/clubs/statshunters) and the Firefox add-on author record (https://addons.mozilla.org/api/v5/addons/addon/statshunters/). Personal accounts: x.com/stanansems, bsky.app/profile/stanansems.bsky.social.
- **Age.** Domain `statshunters.com` **registered 2019-03-09** (Verisign RDAP). Earliest YouTube video, "Introduction into StatsHunters.com", **2019-02-02**. Browser extension created 2021-05-16. *(The video slightly predates the domain registration; unreconciled.)* So roughly **seven years old**.
- **Still actively developed.** Firefox extension v3.3.9 shipped **2026-08-23**; the developer was answering support questions on Bluesky on **2026-08-25**, discussing Strava API summary-vs-extended payload behaviour. This is not a coasting app — it is being maintained *against the current API*, two months after the new terms took effect.
- **Strava OAuth `client_id=1033`** — a very low, apparently early registration. Suggestive of long standing; I have no documentation that Strava client IDs are sequential or that a low one confers status, so treat as weak.
- **There is no Terms of Service at all.** No `/terms` route; the string "terms of service" appears zero times in the bundle. The privacy statement is the only legal page.
- **Retention of *private* activities after the fact.** @statshunters.bsky.social, **2026-03-13**: *"The already pulled private activities are not removed from StatsHunters. You need to remove them manually."* Compare Policy §6.3, which requires deletions to be reflected "within forty-eight (48) hours."
- **Scale proxies** (no first-party count is public; `/api/stats/*` returns `{"error":"Not allowed"}` unauthenticated): Chrome extension **10,000 users** (Chrome's rounded bucket), Firefox extension **2,006 daily users**, Strava club **5,585 members**. All three are opt-in subsets, so actual connected athletes are likely well above these — plausibly but not verifiably past the 9,999 Standard Tier ceiling.

### The single most important data point: Strava told StatsHunters it was compliant

In the comments on DC Rainmaker's November 2024 article about the API agreement changes (https://www.dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html), commenter "ols" reported on **2024-11-21**:

> "Statshunters is in the clear: **'Your application has not been identified as being in violation with our updated API Agreement.'**"

This is second-hand — a user quoting an email he says StatsHunters received — and I could not verify it independently. **But if accurate it is decisive**, because it means Strava ran a compliance sweep against its own agreement, looked at an app that indefinitely stores GPS polylines and renders cross-user club heatmaps, and **affirmatively cleared it**. That is not tolerance-through-inattention; that is Strava's own compliance function reading its own retention clauses as not applying to this pattern. It is the strongest single piece of evidence in favour of the user's objection, and I weight it accordingly in Part 4. Two caveats: it concerns the **2024** agreement, not the 2026 one, and 2026 added §5.5's Persistent Index language that did not exist then.

### Partnership status and the June 2026 change

- **I found no evidence of any formal Strava partnership, allowlist entry, or partner-directory listing.** Absence of evidence here is weak — Strava does not publish its Extended Access allowlist — but nothing in StatsHunters' own materials claims partner status.
- **I found no statement anywhere from StatsHunters about the June 2026 terms change.** There is no blog and no news page; the in-app changelog endpoint (`/api/updates`) is auth-gated. The 3.5 MB application bundle contains **zero** occurrences of "2026", "API Agreement", "new Strava terms" or "Extended Access" — no banner, no warning, no migration notice. The Bluesky feeds carry only routine support answers. Its privacy policy is unchanged boilerplate. **The app behaves as though nothing happened.**
  - **Caveat, and it is a real one:** StatsHunters' own stated announcement channel is its Strava club (FAQ: *"New features and changes will be announced via the StatsHunters Strava club"*), and **club posts require a Strava login to read.** Neither pass could see them. If an announcement exists, that is where it is. Reddit was also entirely inaccessible (403 to fetchers, blocked to tooling), so there is **no Reddit evidence in this document at all.** Read "no announcement found" with those two gaps in mind.
- **On scale — flagged as uncertain.** Its announcements Strava club (https://www.strava.com/clubs/334054) shows **5,585 members**. That is an opt-in subset, not the user count, so it is a weak lower bound only; the true connected-athlete count could be anywhere from low thousands to low hundreds of thousands. The FAQ's admission that rate limits are shared "across all StatsHunters users" and that the app can fall "significantly behind... due to many users" implies it is regularly saturating a single app-level quota, which points to a large population. **If it is above 9,999 it sits in the Extended Access Tier**, where — per a forum exchange on 2026-07-29 in which a developer with 51,559 users discovered they were already in Extended Access — apps land *automatically* by user count rather than by application. **Extended Access exempts an app from the subscription requirement (§3.3(b)). It does not exempt it from Sections 5, 6 or 7.** If it is *below* 9,999, it is in Standard Tier and squarely bound by everything.
- **On age:** I could not establish a founding date from primary sources, and **web.archive.org was unreachable from this environment**, so I could not date the site directly. Treat any specific founding year as unverified.

---

## PART 3 — The category, surveyed

**Every app in this category is alive as of 2026-08-30. None shut down. None restricted signups. None announced anything about the June 2026 terms.** But the survey turned up the single most useful finding in this document, which is not about survival at all — it is about *architecture*.

| App | Status (Aug 2026) | Data sources | Public statement on June 2026 terms |
|---|---|---|---|
| **Wandrer.earth** | Alive, signups open; Pro price raised $30→$40/yr in May 2026 | **Strava, Garmin, RideWithGPS, Coros** | None. Last news post 2026-04-11 |
| **CityStrides** | **Alive and actively developed** — Release 1514 shipped 2026-08-22; signups open. **It did not shut down.** | **Seven sources: Strava, Garmin, Coros, Polar, Suunto, Runkeeper, MapMyFitness** | None found |
| **Squadrats** | Alive; Chrome extension updated 2026-08-12, ~20,000 users | Strava (site bot-protected, not fully inspectable) | None found |
| **VeloViewer** | Alive; "© VeloViewer 2012-2026"; still selling Pro and World Tour packages | Strava-centric | None found |
| **StatsHunters** | Alive, actively maintained (see Part 2) | **Strava only** | None found |
| **Ride Every Tile** | Alive — **deliberately has no Strava sync at all** | File-based | **Yes — see below. The one explicit statement in the whole category.** |
| **Dawarich** | Alive (self-hosted) | Strava as **file import** only, plus Google Takeout, OwnTracks, GPX, FIT | n/a — no live API integration |
| **Fog of World** | Alive, **not Strava-dependent** | GPX/KML import, Dropbox/OneDrive sync | Unaffected |
| **Smashrun** | Alive, Strava integration working Jul 2026 | Strava + others | None found |
| **RunGap** | Alive; Strava among ~50 supported services | Many | None found |
| **Heatflask** | Alive, working Jul 2026 | Strava | None found |
| **Terrarium** | **Unverified.** `terrarium.app` returns HTTP 402 `DEPLOYMENT_DISABLED` (unpaid Vercel deployment). I could not confirm this is the app meant, or that it was ever a Strava explored-territory app. **Do not read this as a shutdown finding.** | — | — |

### The finding that matters most: the category leaders are multi-source

**Wandrer and CityStrides — the two largest street-completion apps, the closest commercial analogues to Lost Soles — both ingest from four to seven independent providers. Strava is one adapter among several, not the foundation.** CityStrides in particular supports Strava, Garmin, Coros, Polar, Suunto, Runkeeper and MapMyFitness.

I cannot prove *why* they are built that way, and I want to be careful not to over-read it: multi-source support is also just good product (users are spread across ecosystems, and Garmin-native users never touch Strava). But whatever the motivation, the effect is exactly the resilience Lost Soles needs. **If Strava revokes Wandrer's token tomorrow, Wandrer still works.** That is the design R1 recommended and the design this survey independently validates as category-standard practice among the serious players.

StatsHunters is the outlier here: single-source, no fallback, one person. It is the *least* resilient app in the category, not a model to copy.

### The one developer who publicly designed around the retention rule

**Ride Every Tile** (https://rideeverytile.com/faq) is the only public product decision in the entire category explicitly attributed to these clauses — and its FAQ says the quiet part out loud:

> "Unfortunately the rules that developers have to agree to in order to use the Strava API are very strict. You are told **not to cache rider data for more than 7 days** or to do anything that might compete with a Strava feature now or in the future. **Although much of the API agreement appears to be ignored by both the Strava and developer sides currently**, that may change in the future and it is not something I currently want to risk."

That is an independent developer, unprompted, reaching precisely the conclusion this document reaches: the clauses are real, they are widely ignored **by both sides**, and a cautious builder designs around them anyway. It is the best single corroboration I found for the whole analysis, and it is the posture I recommend in Part 5.

## PART 3b — Community reaction: what I found on Strava's own developer forum

This was the task's designated falsification test: *"a retention ban of this severity would have caused visible uproar... the absence of any uproar would be strong evidence the previous agent's reading is wrong."*

**Result: there is loud, sustained uproar — but it is about athlete caps, the subscription paywall, and the review process. Retention is a quiet, recurring, and consistently unanswered question.** Both halves of that sentence matter.

I enumerated the current thread list on https://communityhub.strava.com/developers-api-7 (1,423 topics). Of roughly 80 recent threads, the dominant genre by a wide margin is athlete-capacity pleading: "Request to increase athlete limit", "Reached 10 athlete limit but capacity increase declined twice", "Four athlete capacity requests, four template declines", "Rejected twice with no feedback after weeks of full compliance — is this the norm?", "Declined athlete-cap applications: template-only responses leave no way to improve", "Student hobby project — request for API subscription exception", "Account completely locked after expired payment".

### The retention question is being asked, repeatedly, in exactly our terms — and Strava does not answer

**"Long term running totals"** (2026-07-31, https://communityhub.strava.com/developers-api-7/long-term-running-totals-13760). A developer asks precisely our question:

> "Our app currently computes and stores a long-term running total per user (e.g. cumulative mileage since a bike component was last serviced), derived by summing Strava activity distances over time. Section 5.5 of the API Policy prohibits storing 'Strava Data, or any data derived from Strava Data, in any Persistent Index,' and Section 6.2 limits caching of Strava Data to 7 days. Does this restrict indefinite storage of a computed running total like this, or does it apply only to cached copies of raw API responses?"

The only reply (a community volunteer, not staff, 2026-08-04): *"That total would be 'derived from Strava data'. But you could get this value also fresh from Strava with the activity list."* **No Strava staff member responded.** Note this is a *scalar* — one number. If a cumulative distance total is too much to persist, a multi-year GPS tile mask certainly is.

**"Policy clarification: coach access to athlete data and activity retention in a coaching platform"** (2026-08, https://communityhub.strava.com/developers-api-7/policy-clarification-coach-access-to-athlete-data-and-activity-retention-in-a-coaching-platform-13858):

> "Section 6.2 limits caching of Strava Data to seven days and states that, except for limited caching, Strava Data may not be stored. Does this mean that a training-management application cannot persist Strava-originated activity information as part of the athlete's historical training record, even when the athlete explicitly connected Strava for this purpose? If persistent storage is not permitted, should all Strava-originated activity information be treated exclusively as transient data and removed within seven days?"

No staff reply.

**"Clarification requested: deterministic personal coaching analysis under API Policy Sections 5.4 and 6.2"** (2026-08, .../clarification-requested-deterministic-personal-coaching-analysis-under-api-policy-sections-5-4-and-6-2-13846). Developer explicitly notes they do not even request GPS: *"Routes, GPS coordinates and polylines are not requested or stored."* They still ask whether §6.2 permits retaining derived summaries past seven days, and add: *"Since Developer Support redirected this question to the Community Hub, is there a formal channel through which we can obtain written permitted-use clarification before launching a small pilot?"* No staff reply.

**"API Policy clarifications before submitting for review"** (2026-08-24, .../api-policy-clarifications-before-submitting-for-review-13864): *"Does the seven-day limit cover data an athlete has deliberately imported into their own account in our app? If so, may we retain the derived values (points, ranking) beyond seven days, provided we delete the underlying Strava values?"* Zero replies.

### The pattern is a decade old

This is the single most important contextual finding. The same question was asked on the Strava API Google Group and never answered by Strava:

- Kieren Johnstone, **Jun 15, 2015** — asks whether the Retention clause forbids storing retrieved data in one's own database.
- Antony Smith, **Jul 9, 2015** — bumps it.
- AMZ75, **Sep 11, 2019** — asks again.
- Ross Wang, **Sep 8, 2022** — identifies the exact contradiction: the Retention section encourages caching while another clause says *"You may not... use or access the Strava API Materials to aggregate, cache, or store geographic location information or other user information accessible via the Strava API."*

**No Strava representative ever replied in that thread.** (https://groups.google.com/g/strava-api/c/PJnl2Xlb1ow)

### The August 2024 thread that names the apps

This is the closest thing to a direct answer to the user's objection, and it predates the 2026 rewrite by two years. In https://communityhub.strava.com/developers-api-7/storing-activity-distance-in-private-database-1921 (2024-07-31), a developer asks whether storing date, distance and athlete name for a 10-person group violates the terms, noting the agreement said *"your Developer Applications are prohibited from storing any Strava Data."*

A community member (handle "ActivityFix", 2024-08-01) replies with four arguments, the third of which is the entire answer to the StatsHunters puzzle:

> Established third-party fitness apps — **StatsHunters, VeloViewer, intervals.icu** — reportedly store data without apparent enforcement action.

That is a community member's observation, not Strava guidance, and it was not endorsed by staff. But it establishes that **the "these apps do it, so it must be allowed" reasoning was already circulating in 2024 under substantively the same clauses.** The apps' existence proves non-enforcement, not permission.

### What the press and wider community reacted to

- **Notebookcheck, "Strava just pulled a Reddit on its developer community", 2026-06-02** (https://www.notebookcheck.net/Strava-just-pulled-a-Reddit-on-its-developer-community.1312468.0.html). Entirely about the **subscription paywall** and the elimination of intermediary platforms. Quotes a maintainer saying the announcement "effectively kills the project." Strava's stated rationale: *"developer applications are up 448% year-to-date, with AI companies scraping the platform, abusing the API through intermediary layers."* **The article does not mention retention, the 7-day cache, GPS storage bans, or athlete caps at all.**
- **appsforstrava.com** (https://appsforstrava.com/blog/strava-developer-program-changes-2026). Covers pricing, tiers, endpoint deprecations, anti-scraping, the official MCP. **Does not discuss retention, the 7-day cache, or the Persistent Index clause.** Notes the developer community grew from 185,000 to 241,000 members year over year.
- **Hacker News: no uproar whatsoever.** The three stories posted June 1–2, 2026 scored **13, 4 and 5 points**, with 0–1 comments each ([48367662](https://news.ycombinator.com/item?id=48367662), [48359512](https://news.ycombinator.com/item?id=48359512), [48357213](https://news.ycombinator.com/item?id=48357213)). For calibration, the October 2025 Strava-v-Garmin lawsuit drew 444 points and 105 comments. Across every HN comment mentioning "Strava API" since June 2026, exactly **one** references the change — *"now Strava wants me to pay to use their API lol"* ([49090684](https://news.ycombinator.com/item?id=49090684)). **Zero HN comments mention caching, retention, or geographic storage.**
- **TechCrunch, 2026-06-01: "Strava declares war on scrapers ahead of IPO"** (https://techcrunch.com/2026/06/01/strava-declares-war-on-scrapers-ahead-of-ipo/). Framing is scrapers and AI. No mention of retention.
- **Client libraries filed only technical issues.** [stravalib](https://github.com/stravalib/stravalib/issues) opened issues for endpoint deprecations, the base-URL migration, oauth/revoke, and the subscription 403 ([#730](https://github.com/stravalib/stravalib/issues/730), [#736](https://github.com/stravalib/stravalib/issues/736)). **No retention issue exists in any Strava client library I checked.**
- **github.com/r-huijts/strava-mcp issue #53** — "Strava API 2026 changes: required migration before June 1 2027 + Sept 2026 endpoint deprecations". Framed around migration and deprecations. (An MCP server is now flatly banned by §5.16, which is that project's real problem.)

**Interpretation.** The absence of retention-specific uproar is not evidence the clauses don't exist — I read them myself. It is evidence that (i) the retention clauses are *old*, so nobody experienced them as a June 2026 change, and (ii) the community had already collectively decided, over a decade, that these clauses are dead letters. The clauses that generated genuine outrage — the paywall, the caps, the MCP ban — are the ones that were both new *and* immediately enforced.

### Enforcement in 2026 is real, and it is aimed elsewhere

Strava is unmistakably enforcing in 2026, but on tiers and capacity, not storage:

- **Retroactive downgrades.** 2026-08-06: *"My api application suddenly allows the number of connected sports talents to be changed from 9999 to 1, and the number of currently connected sports talents to 1. What is the situation?"* (.../13792) — zero replies.
- **Systematic denial of capacity increases.** A developer with 5+ years of paid subscription, two applications, both declined with the same five-reason template, no indication which reason applied (2026-08-07, .../declined-athlete-cap-applications-template-only-responses-leave-no-way-to-improve-13800). He identifies the trap precisely: *"An application sits at its limit, so new users can't connect, so the integration can't accumulate the usage that would demonstrate it deserves a higher limit."*
- **Mass 403s on July 1** as the subscription requirement bit: apps flipping to `{"resource":"Application","field":"Status","code":"Inactive"}` ([stravalib #730](https://github.com/stravalib/stravalib/issues/730); [forum 13625](https://communityhub.strava.com/developers-api-7/standard-tier-with-9-999-athletes-allowed-to-connect-but-getting-forbidden-since-july-1-13625)).
- **§5.16 flagged against an app that plainly isn't an abstraction layer.** RunMirror (Client ID 8313) was rejected twice as an "abstraction layer" despite being a direct single-athlete OAuth integration with no AI and no proxying; still unresolved as of 2026-08-22 ([13745](https://communityhub.strava.com/developers-api-7/section-5-16-clarification-twice-flagged-as-abstraction-layer-need-to-understand-what-to-fix-13745)). **This is the enforcement pattern most relevant to Lost Soles** — not retention, but a reviewer misapplying a broad clause to a small personal app with no appeal.
- **No confirmed graduations.** 2026-08-24, "Has anyone here had an application approved to move beyond the initial 10-athlete limit since the June 2026 changes?" (.../13861) — five replies, all community, **not one confirmed example of a new app graduating from 10 athletes to anything larger since June 1, 2026.**
- **Extended Access is automatic at scale, not applied for.** A developer with 51,559 connected users learned they were already in Extended Access (.../extended-access-level-13749, 2026-07-29). Community reading: Extended Access means 10,000+ users and is "only granted on very special circumstances."

That last point matters for the StatsHunters question. **Incumbents at scale were placed in Extended Access; new small apps are capped at 10 and being refused growth.** The 2026 changes lock the door behind the incumbents rather than evicting them.

---

## PART 4 — Reconciling the contradiction

The user's objection was excellent and deserved a real test. The answer is that **there was never a contradiction between the terms and StatsHunters' existence — only between the terms and Strava's behaviour.** Here is each hypothesis against the evidence I actually found.

### H1 — The previous agent misread the terms. **REJECTED. Confidence: very high (98%).**
I fetched both documents and read them end to end. All four clauses exist verbatim at the section numbers R1 gave, plus §5.4 and §6.4 which reinforce them. R1's only factual error was calling §5.7 "new in 2026" when it dates to at least 2022 — an error that makes the situation *less* alarming, not more, but does not change the legal reading. R1 also correctly anticipated the core of this answer in its own "Ambiguities" section: it noted the 7-day rule was old, that intervals.icu retains history for years, and that no Strava staff member has ever answered the storage question. Credit where due.

### H2 — The clauses are narrower in effect than they read. **MOSTLY REJECTED, one live sub-reading. Confidence: high (85%) that they are as broad as they look.**
The two candidate narrowings both fail on the text:

- *"'Cache' is a term of art meaning transient storage, so a deliberate archive isn't a cache."* This works against §6.2 alone but is precisely what §5.5 was written to close: *"You may not store Strava Data, or any data derived from Strava Data, in any Persistent Index... The foregoing prohibits **indefinite storage** in... **archives, and any other storage configured to enable subsequent retrieval, query, or use.**"* You cannot escape by calling your store an archive rather than a cache; "archive" is named.
- *"'Aggregate... geographic location information' targets heatmaps ACROSS users, not per-user maps."* This is the strongest version of the objection — and the reported 2024 compliance clearance of StatsHunters suggests Strava's own compliance staff may read it that way. It is genuinely plausible for §5.7 read alone — the clause sits beside §5.4's cross-user analytics prohibition, and Strava's own enforcement concern has historically been global heatmap reconstruction. **But §5.7 says "aggregate, cache, **or store**" disjunctively.** Even if "aggregate" means cross-user, "store geographic location information" does not. And §6.2 carries no cross-user qualifier at all.

**The one sub-reading I cannot rule out**, and which I flag honestly: §5.5's bulk-export sentence contains the qualifier *"that exceeds **the operational scope of your Developer Application**."* A defender could argue that for an app whose declared operational scope *is* a lifelong exploration map, the accumulation does not exceed that scope. This is a real textual hook. It does not, however, reach the *second* paragraph of §5.5 (the Persistent Index sentence, which carries no such qualifier), nor §6.2, nor §5.7. So it narrows one clause of four. I would not build a company on it; for a private six-person app it is a reasonable good-faith position to hold if ever asked.

### H3 — These apps are grandfathered, individually licensed, or have negotiated exceptions. **UNSUPPORTED and unlikely as an explanation of the past. Confidence: moderate (70%) that no retention exception exists.**
The only grandfathering language in the entire Policy is §3.3's *"Strava may grandfather, exempt, or comp Developer Applications in its discretion"* — and it is **scoped to subscription requirements**, not to Sections 5–7. Extended Access Tier admission is discretionary and case-by-case, which leaves room for individually negotiated partner agreements, and Strava does not publish its allowlist, so I cannot disprove this for any specific app. But it cannot explain the *history*: StatsHunters, VeloViewer and intervals.icu were storing data for years before any tier system existed, under terms that already forbade it, and Strava's public forum question about exactly that went unanswered from 2015 to 2022. **Grandfathering doesn't explain a decade of silence.**

### H4 — These apps are technically in violation and Strava tolerates or hasn't enforced it. **ACCEPTED. This is the answer. Confidence: high (90%).**
The evidence is direct and multi-sourced:

- StatsHunters' own FAQ and privacy policy document violations of §7.4, §6.1/§2.3, §5.4 and §6.2/§5.5/§5.7 — four independent axes, in writing, on a public page, unchanged after June 2026.
- The same three apps were named as visibly non-compliant-but-unenforced on **Strava's own community forum in August 2024**, with no staff response.
- Developers have asked Strava the storage question in public in **2015, 2019, 2022, July 2026 and August 2026** and have **never once received an answer from Strava staff.**
- Strava's Developer Support actively **redirects** these questions to the community forum, where nobody with authority answers them (see the coaching-analysis thread).

And the strongest item of all, reported second-hand from Strava's **November 2024** compliance sweep: StatsHunters was told *"Your application has not been identified as being in violation with our updated API Agreement."* If that report is accurate, Strava did not merely fail to notice — **it looked and cleared the app.**

This is not a legal permission, and it is not a safe harbour you can invoke. It is a decade-long pattern of Strava writing maximalist terms it does not police, while declining to say so. The written terms function as a weapon held in reserve, not as an operative rulebook.

**Refinement prompted by the 2024 clearance.** That data point pushes some weight from "Strava tolerates violations" toward "Strava's own compliance function does not read these clauses as covering per-user visualisation apps at all." Those are different worlds. In the first, you are exposed and lucky; in the second, the clauses are aimed at scrapers, data brokers, cross-user heatmap reconstruction and AI ingestion, and a personal exploration map was never the target. **I think the truth is a blend, and I cannot separate them from outside.** The evidence for the second reading is the 2024 clearance and the fact that §5.4/§5.5 sit in a section visibly drafted against scraping and AI. The evidence against it is that the clauses say what they say, that §6.2 has no cross-user qualifier, and that §5.5's Persistent Index paragraph — **added after that 2024 clearance** — reads like a deliberate closing of exactly this gap. A 2024 clearance is not a 2026 clearance.

### H5 — These apps migrated to user-upload / bulk-export / multi-source ingestion. **REJECTED for StatsHunters, but TRUE for the category leaders. Confidence: high (90%) on both halves.**
I checked this specifically because it was the most reassuring hypothesis, and the answer splits:

- **StatsHunters: no.** It offers **no** GPX/FIT activity upload, **no** Garmin/Komoot/Wahoo/RWGPS OAuth, and states plainly that it "uses the Strava API to import your activity data." Its device-brand list and its browser extension's site list both *look* like multi-source support and are not. It has not migrated and has no fallback.
- **Wandrer, CityStrides, Dawarich, Fog of World: yes.** Wandrer pulls from Strava, Garmin, RideWithGPS and Coros. CityStrides pulls from **seven** providers. Dawarich treats Strava as a *file import*, not a live API integration. Fog of World never touched Strava.

**This is an important correction to my own framing.** The user's objection was built on StatsHunters, which happens to be the most Strava-dependent app in the category. The apps that most resemble what Lost Soles wants to be — permanent street/tile completion maps with years of accumulated coverage — are precisely the ones that **do not depend on Strava alone.** Whether they did that for legal reasons or purely for product reasons I cannot establish. Either way, it is the same architecture, and it is what I recommend.

### H6 — Enforcement is selective; large apps get letters, small ones don't. **PARTIALLY ACCEPTED, but inverted from the usual expectation. Confidence: moderate-high (75%).**
2026 enforcement is real and vigorous — but it runs on **access tiers, not retention**, and it falls **hardest on the small and new**:

- Apps are being **retroactively downgraded** from 9,999 to 1 connected athlete with no explanation (2026-08-06).
- Athlete-capacity increases are being **declined with a five-reason template** that doesn't say which reason applied; developers who rewrote their apps against the Agreement line by line were declined again identically.
- As of 2026-08-24, **nobody on the forum could name a single app that graduated past 10 athletes since June 1, 2026.**
- Meanwhile an app with **51,559 users was sitting in Extended Access automatically**, subscription-exempt.

The 2026 changes **lock the door behind the incumbents rather than evicting them.** StatsHunters is safe not because it is compliant but because it is established, and — being a free, donation-funded, non-commercial, non-AI project that Strava users like — it is nobody's enforcement priority. A new app attempting the same thing today would never get past ten users to find out.

### Synthesis

> **The terms have said "no persistent storage" since 2015. Strava has never enforced that clause against per-user visualisation apps, has never answered a single public question about it in eleven years, and did not begin enforcing it in 2026 either. What Strava did in 2026 was add an AI-era foreclosure (§5.5), a paywall, and a hard cap on new entrants — and it is enforcing the cap, not the clause.**

So the earlier finding was right about the law and should have been more explicit that "prohibited" and "at risk" are different claims. The user's instinct — *someone is visibly doing this, so something is off* — was also right: what was off is that R1 stated a written-terms conclusion in a register that implied practical danger.

---

## PART 5 — Practical bottom line for a 6-user personal app

### Three questions that must not be collapsed into one

| Question | Answer |
|---|---|
| **Does building a permanent Strava-API-fed fog-of-war map violate the written terms?** | **Yes. Unambiguously, on four independent clauses.** No serious argument otherwise. |
| **Is that violation likely to be enforced against a 6-user private app?** | **No. Very unlikely.** Sub-1% over a multi-year horizon, on the evidence. Strava has never enforced this clause against anyone in eleven years, has no visibility into your storage layer, does not audit six-user apps, and is currently pointing its enforcement machinery at athlete caps and AI intermediaries. |
| **Could it break the app one day?** | **Yes, and this is the real risk.** Not via a lawyer's letter — via an API change, an endpoint deprecation, a tier reshuffle, a retroactive cap downgrade, or the June 2027 base-URL migration. Strava has demonstrated in 2026 that it will change the rules under live apps with little notice and no appeal. |

**The dominant risk is discontinuity, not liability.** The worst realistic outcome of a terms violation at this scale is that Strava revokes your API token. That costs you your *ingestion pipeline*. It only costs you your *map* if you built the map so that Strava is the system of record.

### What the tier rules actually mean for six users

Good news, and it corrects R1: **a 6-user app fits inside the no-review tier.**

- New apps start in single-player mode; you self-serve upgrade from the API dashboard to an **athlete capacity of 10 with no review** ("everyone can update to 10 users without review" — community moderator, 2026-08-04).
- Rate limits at that level: 200 reads/15min, 2,000 reads/day; 400/15min and 4,000/day overall. Ample for six people.
- You need an active Strava subscription — which the owner already pays for. **The $11.99/mo is not a marginal cost for this project.**
- **You must never need an eleventh user.** The evidence from August 2026 is that the 10→9,999 path is effectively closed to new apps. Design as though 10 is a hard ceiling forever, because for a new entrant it currently is.

### Risk of the alternative paths

**Bulk export / user-supplied files — genuinely lower risk, not merely stealthier.** Policy §6.6 declines to condition the user's export right; Agreement §2.3(i) defines "Strava Data" as data collected *from the API Materials*, so files the user downloads themselves fall outside the retention clauses entirely. The cleanest posture, as R1 said, is **not to register an API application at all** — an agreement you never accept never binds you. Residual risks are real but different in kind: §6.4's generic "Data" wording is a hostile-reading hook (R1 flagged this; I could not resolve it); bulk export is manual and slow, so the UX is worse; and Strava could degrade or rate-limit the export tool, though doing so would collide with GDPR portability obligations.

**Hybrid — avoid, or be disciplined.** If you both register an API app and ingest user files, provenance becomes a factual question under Agreement §6.2's audit right. If you do it anyway: hard provenance column on every trace row, and nothing API-sourced ever enters the permanent store.

**A pragmatic middle path worth naming.** Use the API strictly as a *notifier and fetcher* — webhooks tell you an activity exists, you pull the stream, you derive your reveal mask, and you **discard the raw Strava payload**. Keep only the derived tile/H3 coverage set. This does *not* make you compliant (§5.5 explicitly covers "any data derived from Strava Data", and §5.4 says the same), and I want to be clear that it is not a legal fix. But it materially shrinks what you hold, it makes an honest §7.4 deletion tractable, and it is the design most defensible in good faith if you are ever asked. Combine it with real deletion-on-revoke and a privacy policy that actually says what §2.1 requires, and you are doing better than every incumbent in this category.

### Does Strava remain a good long-term foundation? **No — and the reasons are strategic, not legal.**

The user's instinct to look elsewhere is well founded, and the 2026 evidence supports it more strongly than the retention clauses do:

1. **The growth path is closed.** Ten athletes, no demonstrated route beyond it since June 2026, template denials with no feedback, and a documented catch-22 (capped apps can't accumulate the usage that would justify a higher cap). If Lost Soles ever becomes something other than a six-person app, Strava is a dead end.
2. **The rules move under you, retroactively.** Apps downgraded 9,999→1 without explanation. Club and Segments-Explore endpoints deprecated Sept 1, 2026. Base-URL migration mandated by June 1, 2027.
3. **The relationship is adversarial in tone.** The developer-program announcement thread is closed for replies. Direct policy questions are bounced from support to a forum where staff do not answer. Eleven years of unanswered storage questions is not an accident.
4. **The written terms are a loaded gun on the shelf.** Non-enforcement is a fact about Strava's current priorities, not a right you hold. That is a bad thing to build a decade-long personal archive on top of — and a *permanent* map is, by definition, a decade-long bet.
5. **Strategic direction is inward.** §5.16 bans third-party MCP servers and abstraction layers while §3.5 establishes Strava's own MCP as "the sole authorized first-party agent-mediated interface." Strava is consolidating, not opening.
6. **There is an IPO in the frame.** TechCrunch's June 1, 2026 headline was "**Strava declares war on scrapers ahead of IPO**." A company tightening data control on the way to a listing does not loosen it afterwards. Expect the ratchet to keep turning in one direction.
7. **Broad clauses are being misapplied to small apps.** RunMirror — a direct single-athlete OAuth integration with no AI and no proxying — was rejected **twice** under §5.16 as an "abstraction layer." **This is the failure mode most likely to hit Lost Soles**, and note that it is not retention: it is a reviewer applying a sweeping clause to an app that plainly isn't the target, with template feedback and no appeal.

**Recommended posture, which is R1's conclusion reached by a firmer route:**

> **Make user-supplied activity files the system of record.** Design the ingestion layer source-agnostic from day one — GPX/FIT in, tiles out — so Strava, Garmin, Apple Health, or a phone recorder are all just adapters. Then, if you want the convenience, add the Strava API as a *replaceable adapter* on top, sized for ≤10 athletes, holding nothing you would mind deleting.

**This is not a defensive crouch; it is what the category leaders already do.** Wandrer ingests from four providers, CityStrides from seven, Dawarich treats Strava as a file import, Fog of World never touched it. The only single-source app in the survey is StatsHunters — the one the objection was built on, and the most fragile app in the category. And Ride Every Tile's developer publicly chose to forgo Strava sync entirely for exactly the reason under discussion. **Source-agnostic ingestion is the mainstream architecture here, and it happens to also be the compliant one.**

The point is not to dodge Strava's terms. It is that **an app whose core promise is "this map is permanent" must not depend on a party that reserves the right to make you delete it within 30 days.** That is true regardless of whether Strava ever exercises the right.

---

## Confidence summary

| Claim | Confidence |
|---|---|
| The four clauses exist verbatim as R1 quoted them, effective 2026-06-01 | **99%** — read directly |
| §6.6 bulk-export carve-out exists as quoted | **99%** — read directly |
| §6.2 and §5.7 are NOT new in 2026 (R1's error) | **90%** — dated developer quotations of the older text; not a direct diff |
| §5.5 "Persistent Index", §5.16, §3.3 tiers ARE new in 2026 | **85%** — inference from drafting vocabulary and the June 2026 announcement; **not verified by diff, because web.archive.org was unreachable** |
| StatsHunters is Strava-API-only, one-person, donation-funded, stores GPS indefinitely | **95%** — its own FAQ and JS bundle |
| StatsHunters is non-compliant on §7.4, §6.1, §5.4 and §6.2/5.5/5.7 | **90%** — self-documented |
| The explanation is non-enforcement (H4), not exemption (H3) or migration (H5) | **90%** |
| Enforcement risk to a private 6-user app is negligible | **90%** |
| Category leaders (Wandrer, CityStrides) are multi-source, not Strava-only | **90%** |
| No app in this category shut down or was enforced against over retention | **85%** |
| Strava is a poor long-term foundation for a permanent-map product | **85%** |

## Method and limitations

- Both legal documents fetched directly via `curl` on 2026-08-30 and read in full after HTML stripping; every quotation above is from that text, not from memory or search snippets.
- StatsHunters characterised from its own `/js/app.js` bundle and its public `/api/faq` JSON endpoint, because the site is a client-rendered SPA that returns an empty shell to fetchers.
- Strava community forum threads enumerated from the live topic index and fetched individually.
- **web.archive.org was unreachable from this environment at both the network and tool level.** The old-vs-new clause analysis therefore rests on contemporaneous developer quotations in dated forum posts rather than a direct textual diff. **This is the single biggest gap in this document and the first thing to close on a revisit.**
- **Reddit was completely inaccessible in both research passes** — reddit.com and old.reddit.com return HTTP 403 to fetchers under every user-agent tried, and the tooling blocks both domains. **There is no Reddit evidence anywhere in this document.** r/Strava, r/running and r/cycling are unchecked.
- **StatsHunters' own announcement channel — its Strava club — requires a Strava login to read.** If it made a statement about the 2026 terms, that is where it would be, and neither pass could see it. The owner has a Strava subscription and can check this in about two minutes; it is the cheapest open question in this document.
- Squadrats and VeloViewer are bot-protected or JS-only with no reachable blog or changelog, so "no public statement found" is weaker for them than for the others.
- My WebSearch quota was exhausted partway through, so later work relied on direct fetches of known URLs plus delegated agents.
- Nothing here is legal advice.

## Open questions worth closing

1. **Read the StatsHunters Strava club feed** (https://www.strava.com/clubs/334054) while logged in. Cheapest, highest-value check available; would settle whether the category's most Strava-dependent app said anything at all about June 2026.
2. **Diff the pre-2026 API Agreement against the 2026 one** from an environment that can reach web.archive.org. This is the biggest evidentiary gap here and would firm up the whole old-vs-new table.
3. **Check r/Strava** for June–August 2026 reaction, from anywhere Reddit is reachable.
4. **Look at strava.com/apps while logged in** to see whether StatsHunters (client_id 1033) appears in the directory and whether it is at capacity.
5. **Ask Strava directly, in writing, via developers@strava.com** whether a personal per-user exploration map may retain derived coverage beyond seven days. Eleven years of unanswered forum questions suggest no reply will come — but a written non-answer is itself useful, and a written answer would be decisive.

## Sources

- https://www.strava.com/legal/api — API Agreement (2026), effective 2026-06-01
- https://www.strava.com/legal/api_policy — API Policy (2026), effective 2026-06-01
- https://developers.strava.com/docs/getting-started/ — tiers, single-player mode, rate limits, subscription prerequisite
- https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428 — the June 2026 announcement (closed for replies)
- https://press.strava.com/articles/updates-to-stravas-api-agreement — Nov 19, 2024 changes (display-to-owner, AI ban)
- https://groups.google.com/g/strava-api/c/PJnl2Xlb1ow — 2015–2022 storage/retention questions, never answered by Strava; §5.7 language quoted Sep 2022
- https://communityhub.strava.com/developers-api-7/storing-activity-distance-in-private-database-1921 — Jul/Aug 2024; names StatsHunters, VeloViewer, intervals.icu as storing without enforcement
- https://communityhub.strava.com/developers-api-7/long-term-running-totals-13760 — Jul 31 2026, §5.5/§6.2 question, no staff answer
- https://communityhub.strava.com/developers-api-7/policy-clarification-coach-access-to-athlete-data-and-activity-retention-in-a-coaching-platform-13858
- https://communityhub.strava.com/developers-api-7/clarification-requested-deterministic-personal-coaching-analysis-under-api-policy-sections-5-4-and-6-2-13846
- https://communityhub.strava.com/developers-api-7/api-policy-clarifications-before-submitting-for-review-13864
- https://communityhub.strava.com/developers-api-7/declined-athlete-cap-applications-template-only-responses-leave-no-way-to-improve-13800
- https://communityhub.strava.com/developers-api-7/has-anyone-here-had-an-application-approved-to-move-beyond-the-initial-10-athlete-limit-since-the-june-2026-changes-13861
- https://communityhub.strava.com/developers-api-7/extended-access-level-13749 — 51,559-user app auto-placed in Extended Access
- https://communityhub.strava.com/developers-api-7/my-api-application-suddenly-allows-the-number-of-connected-sports-talents-to-be-changed-from-9999-to-1-...-13792
- https://www.notebookcheck.net/Strava-just-pulled-a-Reddit-on-its-developer-community.1312468.0.html — Jun 2, 2026
- https://appsforstrava.com/blog/strava-developer-program-changes-2026
- https://github.com/r-huijts/strava-mcp/issues/53
- https://www.statshunters.com/api/faq — StatsHunters FAQ (primary)
- https://www.statshunters.com/js/app.js — StatsHunters application bundle (about page, privacy statement, routes, data sources)
- https://www.strava.com/clubs/334054 — StatsHunters Strava club, 5,585 members
- https://www.dcrainmaker.com/2024/11/stravas-changes-to-kill-off-apps.html — comment #395 (2024-11-21) reporting StatsHunters cleared under the 2024 agreement
- https://rideeverytile.com/faq — the one public product decision attributed to the 7-day cache rule
- https://wandrer.earth/ and https://news.wandrer.earth/updates — multi-source (Strava, Garmin, RideWithGPS, Coros)
- https://community.citystrides.com/t/updates-on-august-22-2026-release-1514/30089 — CityStrides alive, Release 1514, seven data sources
- https://github.com/Freika/dawarich — Strava as file import
- https://fogofworld.app/ — GPX/KML, no Strava dependency
- https://veloviewer.com/ · https://chromewebstore.google.com/detail/squadrats-route-planning/mkcobabnclhdodfhajlagglahfhkeeon
- https://www.welovecycling.com/wide/2026/04/14/tile-hunting-which-platform-is-best-for-you/ — Apr 2026 category comparison, no mention of API disruption
- https://techcrunch.com/2026/06/01/strava-declares-war-on-scrapers-ahead-of-ipo/
- https://news.ycombinator.com/item?id=48367662 · =48359512 · =48357213 · =49090684 — the near-total absence of HN reaction
- https://github.com/stravalib/stravalib/issues/730 — July 1 subscription 403s
- https://communityhub.strava.com/developers-api-7/section-5-16-clarification-twice-flagged-as-abstraction-layer-need-to-understand-what-to-fix-13745 — RunMirror
- https://support.strava.com/en-us/articles/15401526-strava-api-and-mcp-faq — does not address caching, retention, or Persistent Index
- https://addons.mozilla.org/api/v5/addons/addon/statshunters/ · https://rdap.verisign.com/com/v1/domain/statshunters.com
