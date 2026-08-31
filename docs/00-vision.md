# Lost Soles — Vision

**Status:** settled. This is the document the others answer to.
**Last updated:** 2026-08-30
**Companion:** `docs/decisions/DECISIONS.md` — every `D-xxx` cited here is confirmed.

If a later design doc, ticket, or implementation choice contradicts this file, this file
wins until you deliberately change it here. That is the whole point of it existing.

---

## 1. What this is

Lost Soles is a fitness tracker where running physically reveals a permanent fog of war over
a real street map, wrapped in a Runescape-style per-skill progression system. Every run you
record uncovers the ground you actually covered — hex cell by hex cell (H3 resolution 10,
D-115) — and that ground stays uncovered forever (D-120). Running trains Wayfaring; new
territory trains Cartography; total volume trains Constitution; pushups, situps and planks
train their own skills; all of it rolls up into a Total Level (D-030 through D-033). It runs
on a private AWS account, costs a few dollars a month (D-083), ingests runs automatically so
there is nothing to maintain (D-013), and it is built for exactly one person: you.

---

## 2. Who it's for and why it exists

**It is for you.** Not "you plus a future audience." Not "you, as a first user." You. The
multi-user ceiling is roughly five friends or family members, someday, and even that is a
maybe (D-014). Every trade-off in this project should be resolved by asking what makes *your*
next run better, not what would make the app defensible, marketable, or fair.

The motivational thesis has three parts, and they are load-bearing. Getting any of them wrong
produces an app you abandon in four months, the way you abandoned the last two.

### 2.1 You are driven by personal accomplishment, not competition

The reward that works on you is *the record of what you did*. A number that went up because
of something you personally did. A shape on a map that is larger than it was last week. It is
not "beating someone." It is not "being seen." The satisfaction is private and cumulative
(D-011).

This is why the fog map is the right core mechanic. The map is a physical artifact of your
own history. Nobody else's map exists in the frame. When you look at it, the only comparison
available is *you, earlier*.

### 2.2 You are motivated by novelty — new places, not the same loop

The thing that gets you out the door is going somewhere you have not been (D-012). Not
"three miles." Not "zone 2 for forty minutes." *That street over there, which I have never
run down.* The same loop, however scenic, decays into a chore.

The design consequence is enormous and easy to under-serve: the app's job is not to tell you
how far you ran. It is to **make unexplored ground legible and tempting.** A blank patch of
fog three blocks from your door is the product's core call to action. The number of meters is
a side effect.

This is also why the map must stay a real, legible street map (D-051). If atmosphere makes
the streets unreadable, the app can no longer answer "where should I go today?" — and if it
cannot answer that, the novelty engine is dead and it is just a scorecard.

### 2.3 You need near-zero upkeep

You will not do a daily check-in. You will not curate a task list. You will not tick boxes,
maintain streaks, or "manage" the app. This is not laziness; it is an observed fact about the
last four years of your life, and the design has to take it as a hard constraint rather than
a preference to be nudged (D-013).

The target state: **you run, and later that day you open the app and the run is already
there, already scored, already drawn on the map.** Ingestion is automatic (D-121: Strava API
adapter for MVP, behind a swap-in-one-module boundary). The only manual action the MVP asks
of you is logging strength work, and that is forced by reality — no API on earth exposes reps
and sets (D-060) — and is reduced to one tap (D-062).

---

## 3. What we learned from the apps you abandoned

This section is the heart of the document. Each app taught something specific. Each lesson
is written as a constraint we can be held to, not as a vibe.

### 3.1 Habitica — loved it, used it for years, abandoned it because it became a job

You genuinely liked Habitica. That is what makes it the most important data point: this was
not a bad app or a bad fit of taste. It failed because it tried to gamify *all of life*, and
a system that gamifies all of life must be *told* about all of life. Every habit you wanted
to track was a thing you had to create, maintain, remember, and check off. The maintenance
cost grew monotonically. Motivation did not. Eventually the ledger flipped and you stopped.

The failure mode is worth naming precisely, because it is seductive and it will try to get
into this project through the side door: **Habitica's upkeep was not a bug, it was the
mechanic.** The checking-off *was* the game. Any feature here that makes the *act of using
the app* the game is a re-run of that failure.

> **CONSTRAINT H1 — Lost Soles does one thing.** It tracks physical activity and turns it
> into map and levels. It is not a to-do list, not a journal, not a habit tracker, not a
> meal log, not a sleep tracker. Scope creep toward "life" is the specific disease that
> killed the predecessor.

> **CONSTRAINT H2 — The app demands nothing daily.** No check-ins, no chores, no dailies, no
> streaks, no decay, no penalty for absence (D-013). Miss three weeks and the app is exactly
> as pleased to see you as if you had run yesterday. Nothing you own degrades. Nothing you
> built is lost. The map never re-fogs (D-120) *precisely* because re-fogging is a decay
> mechanic and decay mechanics are punishment for absence.

> **CONSTRAINT H3 — Every feature must justify its upkeep cost, in writing.** For any
> proposed feature, the question is not "is this cool?" but "what does this ask the user to
> do, ever, that they would not otherwise do?" A feature with a nonzero recurring ask needs
> to be paying for it several times over.

> **CONSTRAINT H4 — If a feature requires the user to remember it, it is suspect.** Anything
> that only works if you remember to start it, stop it, set it, curate it, or come back to
> it is presumed dead on arrival. This is why combat resolves automatically at import time
> rather than as battles you play (D-041) — manual turn-based combat *is* the Habitica trap
> wearing a sword.

### 3.2 Runescape — not abandoned. The inspiration.

Runescape is here because its progression model solved a problem the fitness apps did not:
**it made progress legible and made every session count toward something specific.**

What actually works in it, mechanically:

- **Per-skill leveling.** You do not have one undifferentiated "score." You have Woodcutting
  and Fishing and Attack. When you spend an hour, you know exactly which number moved. That
  specificity is what makes a session feel like it *counted*, versus feeling like it was
  absorbed into an average. → Per-activity skills, 1:1 with exercises (D-031).
- **One action trains several things.** Real actions are not single-purpose, and the
  progression should reflect that. A run is Wayfaring *and* Cartography *and* Constitution
  (D-030, D-032). This is why the system is hybrid rather than flat.
- **A Total Level.** One number that sums everything and represents "how far along am I,
  overall" — legible at a glance, impossible to game by specializing (D-033).
- **The XP curve itself is the motivation.** Early levels come fast; later ones are earned.
  Nobody has to be told this is satisfying.
- **Modularity.** Runescape added skills over decades without rebuilding the game. Adding a
  workout type here must be adding a skill, not a schema migration (D-031).

> **CONSTRAINT R1 — Every session must move at least one named, specific number.** If you
> can finish a workout and not be able to say which skill it trained, the progression design
> has failed. "Points" or a single score is not acceptable.

> **CONSTRAINT R2 — Adding a new exercise type is a configuration-shaped change.** New
> workout type ⇒ new skill ⇒ no redesign of the home screen (which is exactly why logging
> lives behind one "Add workout" button rather than per-exercise buttons — D-061).

### 3.3 INTVL — liked it, two specific things drove you off

**Failure one: it only counted a run if you closed the loop.** Out-and-backs did not count.
Running to the end of a street and turning around did not count. This is a route-shape
requirement, and it is disqualifying for two independent reasons: it punishes the most
natural way to explore an unfamiliar area (go until it stops being interesting, turn around),
and it silently deletes work you actually did. Nothing corrodes trust in a tracker faster
than doing the work and being told it did not happen.

**Failure two: social competition demotivated you.** Put in a feed against people with more
free time to train, the honest read of the leaderboard was "you are losing," and the honest
response to that was to stop looking. Competition against people with more hours in the day
is not motivating; it is a correctly-interpreted signal that the game is unwinnable
(D-011).

> **CONSTRAINT I1 — Every meter run counts. No route shape requirements, ever.** Out-and-
> backs, dead ends, half-finished runs, treadmill-adjacent wanderings, a walk to the shop
> with the tracker on — all of it reveals ground and all of it earns XP. There is no
> geometric condition, no minimum distance, no minimum duration, no "valid run" gate. The
> only reason a meter does not fully count is the explicitly-designed re-run discount
> (D-120: half XP for known ground, zero discovery credit inside 6 months, 50% discovery
> credit after) — and note that even then it *counts*, it is just worth less than new ground.
> That is a novelty incentive, not a validity gate. The distinction matters: a discount tells
> you where to go next; a gate tells you your run did not happen.

> **CONSTRAINT I2 — No leaderboards, no feeds, no social comparison, no sharing surface.**
> Not "off by default." Not present. There is no other person's number visible anywhere in
> this app. If friends/family are ever added (D-014), they get *separate* maps, not a shared
> ranking — and note that adding any share or screenshot surface reopens the privacy
> decision D-123, which currently stores full-fidelity traces including your home with no
> masking at all.

---

## 4. Design principles

Nine principles. Each one is written to be *usable in an argument* — every one names things
it rules out. A principle that cannot reject a feature is decoration.

### P1. Every meter counts

Any distance covered with a trace attached reveals ground and earns XP. No shape requirement,
no minimum, no validity gate (Constraint I1).

- **Rules out:** loop-closure requirements; "minimum 1km to count"; GPS-quality gates that
  silently discard a run; auto-pause logic that decides parts of your run were not real;
  distinguishing "runs" from "walks" for purposes of *revealing map* (they both reveal —
  GPSLogger running continuously would reveal every street walked, and that is a feature,
  D-112).
- **Deliberately not ruled out:** the D-120 re-run discount. Known ground is worth *less*,
  never *nothing*. Discount ≠ gate.

### P2. The app opens after the run, not during it

The phone stays in your pocket. Lost Soles is a place you go to *see what happened*, not a
thing you operate while exercising.

- **Rules out:** in-run screens, live pace displays, real-time coaching, audio cues, mid-run
  interaction of any kind, and — decisively — us building our own run recorder in the PWA
  (D-110: wake lock dies when the tab hides; a pocketed phone loses the trace in ~90 seconds).
- **Consequence:** the post-run reveal is the single most important moment in the product.
  That is where the budget goes. It should feel like opening a chest.

### P3. No upkeep, ever

The app never asks for maintenance. Absence is never punished (Constraints H1–H4).

- **Rules out:** streaks, dailies, decay, re-fogging, "you haven't run in 5 days" nags,
  weekly goals you must set, anything with an expiry, any list the user must curate, any
  feature whose value depends on the user remembering to use it.
- **Test:** if the app sat untouched for two months, does anything get *worse*? If yes, cut
  the thing that got worse.
- **Corollary on notifications:** a notification that says "your run is on the map" is
  acceptable — it reports something that already happened. A notification that asks you to
  do something is not.

### P4. The map is the product

Everything else — skills, XP, levels, eventual combat — decorates the map. When the map and
another feature conflict, the map wins.

- **Rules out:** atmosphere that costs street legibility (D-051 is non-negotiable; hence the
  atlas/adventure toggle, D-052, and the parchment-basemap-with-dark-fog direction, D-053,
  chosen because dark-on-dark destroys reveal contrast); simplified geometry that misdraws
  where you went (D-121 mitigation 4: full `latlng` stream, never `summary_polyline`);
  privacy truncation that permanently blanks the map around home (D-121 mitigation 3:
  `activity:read_all`, not `activity:read`); any home screen where the map is not the first
  thing you see.
- **Also rules out:** an app that is beautiful but cannot answer "where should I run today?"

### P5. Progress must be visible in a glance

Open the app, look for two seconds, know whether you are further along than last time.

- **Requires:** Total Level and the map shape, both readable without scrolling or tapping.
- **Rules out:** progress that only exists inside a stats page; achievements that must be
  hunted for; a home screen that leads with today's numbers rather than cumulative ones.
  Today's numbers are transient; the point of this app is the accumulation.

### P6. Novelty is the reward

Unexplored ground is the currency. The app's persuasive job is to make the fog look
interesting.

- **Requires:** new territory is always worth strictly more than repeated territory (D-120);
  Cartography exists as a first-class meta-skill (D-032); fog edges near you are visually
  prominent.
- **Rules out:** rewarding repetition (no "ran your usual loop 10 times" badge); training-
  plan structures that prescribe repeating a route; anything that makes the optimal strategy
  "run the same efficient loop."
- **Note on the 6-month re-arm (D-120):** returning to a neglected part of town earns 50%
  discovery credit. That is deliberately generous enough to pull you back to forgotten
  neighbourhoods and deliberately never as good as genuinely new ground. Hold that ordering.

### P7. Your data outlives any vendor

Every trace you generate is yours, stored by you, in a form that survives the disappearance
of every third party involved.

- **Requires:** source-agnostic ingestion — normalized `Activity` + `Trace`, every source an
  adapter behind that contract (D-100); raw traces archived to S3 at ingest, unconditionally
  (D-101, D-121 mitigation 2); Strava confined behind the adapter boundary so swapping it
  touches exactly one module (D-121 mitigation 1).
- **Rules out:** any design where a vendor's API response *is* the domain model; any feature
  that cannot be recomputed from the S3 archive; any dependency whose loss would cost you
  map territory. An app that promises a *permanent* map cannot rest on a party that reserves
  the right to force deletion in 30 days (D-100). Strava is a convenience, never a
  foundation (D-102).
- **Standing implication:** the watch decision is not blocking and never becomes blocking
  (D-103). Hardware is a new adapter, not a rewrite.

### P8. Automatic beats manual; manual beats nothing

Prefer ingestion that happens without you. Where automation is genuinely impossible, make
the manual path one tap and put it behind a single door.

- **Requires:** automatic run ingest (D-121); strength logging in-app because no API exposes
  reps or sets — forced, not chosen (D-060); one "Add workout" button opening one page with
  a row per type, so future workout types never clutter the home screen (D-061); one-tap
  quick log, with the data model accommodating sets from day one even though the UI does not
  yet (D-062).
- **Rules out:** manual file upload as a *primary* ingestion path — it becomes a chore, and
  worse, Strava has no mobile GPX export, so it would require a desktop after every run
  (D-111, and the share-sheet import rejection). Also rules out per-exercise buttons on the
  home screen, and any logging flow longer than a tap for the common case.

### P9. Build for one user; do not pay the tax of many

This is a private app on a private AWS account for one person (D-014, D-123). Take the
simplifications that come with that.

- **Permits, deliberately:** no home-location masking, full-fidelity traces (D-123); no
  moderation, no abuse handling, no onboarding funnel, no account recovery theatre, no
  accessibility-of-scale work beyond what you personally need, no marketing surface.
- **Rules out:** generic multi-tenancy, admin consoles, feature flags for cohorts, analytics
  on user behaviour, A/B tests, anything justified by "users might."
- **Cost discipline is part of this:** target a few dollars a month (D-083). This rules out
  a NAT Gateway at ~$33/mo — ten times the entire budget — and therefore rules out any
  Lambda needing both VPC attachment and internet (D-081), and rules out Postgres/PostGIS;
  explored territory is H3 cells in DynamoDB (D-082).
- **Standing condition:** D-123 must be reopened the moment friends/family accounts or any
  share/screenshot feature appears. Note it in `08-security-privacy.md`.

---

## 5. What success looks like

Concrete, falsifiable, checkable by one person with the app in hand. Set a calendar reminder
for six months after launch and answer these honestly.

### S1. Six-month retention — the only test that really matters

**Are you still opening it, unprompted, six months after MVP launch?**
Measure: at least one *voluntary* app-open per week in the 26th week. Voluntary means you
opened it to look at the map, not because you were debugging it or showing someone.

This is the test both Habitica and INTVL failed. Everything else on this list is a leading
indicator of this one.

### S2. It changed where you run

**Has the map altered your route choices?**
Measure: in month 6, at least a third of your runs start or pass through ground you chose
*because it was fogged*. Proxy metric the app can compute: percentage of monthly distance
on newly-discovered cells, sustained above a threshold rather than collapsing toward zero as
convenient nearby ground fills in.

If your routes are statistically identical to what you would have run without the app, the
novelty engine (P6) is not working, however pretty the map is.

Watch for the natural decay pattern: local ground eventually fills, and new discovery
requires driving somewhere or running further. If discovery collapses in month 4, that is
the signal to invest in route planning (D-070) — the deferred feature that exists precisely
for this failure mode.

### S3. Upkeep stayed at zero

**Count the actions the app required of you in six months that you would not otherwise have
taken.**
Measure: excluding strength quick-logs (which are forced, D-060), the count should be under
ten for the entire period. Re-authing Strava, fixing a failed import, correcting a mis-scored
run — each of those is one. If this number is climbing, P3 is eroding and you are on the
Habitica path again.

### S4. You trust it

**Has a run ever been silently dropped, mis-drawn, or under-counted?**
Measure: zero unexplained missing runs. Zero occasions where you looked at the map and
thought "but I definitely ran there." A tracker that loses work is worse than no tracker,
because you stop believing the parts that are correct. This is the INTVL failure (I1)
generalised.

### S5. The archive is real

**Could you rebuild the entire map from S3 tomorrow with Strava switched off?**
Measure: actually do this once, as a drill, before month six. Not "is the code written" —
run it. If the answer is uncertain, P7 is aspirational rather than true, and the permanence
promise at the centre of the product is a bluff.

### Explicit non-measures

Not success: total distance run. Weight. Pace improvement. Number of features shipped. Any
comparison to another person. Uptime. These are either someone else's product or not the
point.

---

## 6. Explicit non-goals

Things this app will never be. Each with the reason, so that a future proposal that sounds
different but is one of these in disguise can still be identified.

### N1. Not a social network

No feed, no followers, no likes, no comments, no sharing, no leaderboards, no clubs, no
challenges against other people.

*Why:* social comparison against people with more time to train is the specific thing that
demotivated you off INTVL (D-011, Constraint I2). The motivator here is personal
accomplishment (§2.1), and the presence of anyone else's number changes what the app *means*
even if you never look at it. The ~5-person ceiling in D-014 is separate accounts with
separate maps — coexistence, not comparison.

*Disguises to watch for:* "just share a screenshot of your map"; "a combined family map";
"an optional friends tab"; anything with the word *challenge*.

### N2. Not a coaching or training-plan app

No prescribed workouts, no periodisation, no target paces, no heart-rate zones, no "your
plan for this week," no readiness scores, no form advice.

*Why:* a plan is an obligation, and obligations are upkeep (P3). Worse, plans prescribe
repetition — intervals on a known route, the same long run each Sunday — which is directly
opposed to novelty as the reward (P6). It would also make the app a thing that tells you
what to do, when the entire point is that it tells you what you *did*.

*Disguises:* "suggested next run"; "weekly goal"; "you should run 10% further." Note that
route *planning* (D-070) is not this — it answers "where," never "whether" or "how hard."

### N3. Not a general habit tracker

No custom habits, no to-dos, no reminders you configure, no journalling, no mood, no water
intake, no sleep, no diet.

*Why:* this is precisely, exactly how Habitica ate itself (§3.1, Constraint H1). Gamifying
all of life means being told about all of life, and being told is upkeep that grows without
bound. Lost Soles tracks physical activity that can be turned into map and levels. Anything
else is out.

*Disguises:* "just one extra skill for reading"; "a generic custom-activity type"; "an
optional notes field on each day." The generic-activity request is the dangerous one — it
converts a fitness app into a habit tracker in a single feature.

### N4. Not a competitive platform

No ranking, no percentiles, no segments, no PBs presented as a contest, no global stats, no
"you are in the top X%."

*Why:* same root as N1, but worth stating separately because it can arrive without any other
people involved — competing against your own past times is still competition, and it makes
runs *worse* rather than *new* the goal. Progress here is measured in ground covered and
levels gained (P5, P6), which are monotonic and cannot be lost. A PB you fail to beat is a
loss condition, and this app has no loss conditions.

*Disguises:* "segment leaderboards, but only against yourself"; "a fitness score that can go
down."

### N5. Not a product for other people

No public launch, no signups, no landing page, no pricing, no support burden, no App Store
listing, no terms of service, no roadmap owed to anyone.

*Why:* every one of those is upkeep (P3) and every one of them forces generality that costs
you the simplifications you are entitled to (P9): no home-location masking (D-123), sideload
rather than Play-store distribution for any companion app (D-114), a few dollars a month of
infrastructure (D-083). Making it a product would break its economics, its privacy posture,
and its scope in one move.

*Disguises:* "we should make this open-source-ready"; "it wouldn't be much extra work to
support arbitrary users"; "what if someone else wanted this?" The answer to the last one is:
they can build their own.

### N6. Not a device or a run recorder

We do not build a GPS recording app, and we do not build watch firmware.

*Why:* D-110 settled it on the evidence — a PWA cannot hold a trace in a pocket, and
building a real Android recorder is a project the size of this one. Recording is an adapter
concern (D-100, D-112, D-113), and hardware is a Whoop-replacement purchasing decision, not
a legal or architectural necessity (D-117). Deferred indefinitely, and correctly so.

---

## 7. The one-sentence test

Every future feature proposal must pass this sentence:

> **Does it make an unexplored street more tempting, or a finished run more satisfying to
> look at — without asking me to do anything I would not otherwise do?**

How to use it: the clause before the dash is the *value* test — a feature must serve either
novelty (P6) or the post-run reveal (P2, P5), and if it serves neither it is not this app's
feature no matter how good it is. The clause after the dash is the *cost* test, and it is an
absolute veto, not a trade-off (P3, Constraints H2–H4). A feature that adds real value and a
recurring ask still fails.

Two worked examples, for calibration:

- *"Notify me when I'm near unexplored ground."* Value: yes, directly serves novelty. Cost:
  none — it reports, it does not request. **Passes** (subject to it not becoming a nag).
- *"Weekly distance goal you set each Sunday."* Value: marginal, and it rewards volume over
  novelty. Cost: a recurring action, every week, forever. **Fails twice.**

---

## 8. Scope summary

### MVP — IN (D-122)

- Strava API ingest via the source-agnostic adapter boundary (D-121, D-100), with all four
  non-negotiable mitigations: adapter isolation, S3 raw-trace archive, `activity:read_all`
  scope, full `latlng` stream.
- Fog-of-war rendering over a real street map, H3 resolution 10 (D-115), permanent reveal
  (D-120).
- Both map modes: atlas and adventure, with a toggle (D-052, D-053).
- The full hybrid skill system: all activity skills — Wayfaring, Might, Fortitude, Endurance
  (D-031) — plus Cartography and Constitution (D-032), XP and levels, and Total Level
  (D-033).
- XP/discovery rules per D-120: half XP on known ground; zero discovery credit inside 6
  months; 50% discovery credit after 6 months. Cells carry `lastRunAt`, not a presence bit.
- The "Add workout" quick-log page — one button, one page, one row per type, one tap
  (D-061, D-062), with the data model accommodating sets from day one.
- The ticket system, from day one (D-090): `/tickets` command (D-091), phone-friendly
  in-app ticket creation into `tickets/inbox/` (D-092, D-093).

### MVP — OUT (D-122)

- **Combat** — both map encounters and boss quests. Consequently the **Slayer** meta-skill
  is also out; it has nothing to train on until combat exists.
- **Novelty route planning** — plan a run by target distance and start point, prioritising
  new territory (D-070).
- **Equipment and loot.**

### Deferred ≠ cancelled

All three of the OUT items are confirmed-good ideas with a decision behind them, waiting on
a foundation rather than on approval. They are cut from MVP to get a working map in front of
you sooner, not because they lost an argument.

- **Combat** (D-040, D-041): map creatures in fogged regions, plus longer-running boss quests
  that accept damage from *any* workout so non-running days still count. Resolves
  automatically at import time — never a game you play (D-041), because that is the Habitica
  trap. Brings Slayer online. Note D-042 originally guessed map encounters would make MVP;
  D-122 supersedes that.
- **Route planning** (D-070): confirmed in-scope by you, drove research track R7. This is the
  designated answer to the S2 failure mode — when local ground fills in and discovery decays,
  this is the feature that fixes it. Expect to want it around month 4–6.
- **Equipment / loot**: no decision record yet beyond being deferred. When it comes up, it
  faces §7 like anything else, and it should be watched hard for upkeep (inventory management
  is Habitica-shaped).

### Also deferred, deliberately

- **Additional ingestion adapters**: Health Connect bridge (D-113, pending the O-004 check on
  whether Strava writes *routes*) or GPSLogger (D-112), then a watch vendor if hardware is
  bought (D-117, and any watch must not need daily charging — O-001).
- **Friends/family accounts** (D-014). Reopens D-123 (home-location privacy) if it happens,
  and runs into Strava's athlete cap (D-121) — which is the real practical risk of the Strava
  adapter, and which does not bite until this arrives.
- **Sets, reps, rest timer** in strength logging (D-062) — schema ready, UI later.

---

## Change policy

Contradicting anything above requires editing this file and recording the reversal in
`docs/decisions/DECISIONS.md` with a new `D-xxx`. Silent drift is how the last two apps got
abandoned.
