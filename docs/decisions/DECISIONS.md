# Lost Soles — Decision Log

Running record of settled decisions. Anything here is CONFIRMED by the user unless
marked PROVISIONAL. Research findings live in `docs/research/`.

Last updated: 2026-08-30

---

## Process

- **D-001** Nothing gets built until the full plan + ticket backlog exists and the user signs off.
- **D-002** Planning proceeds in phases: research (done) → clarifying rounds → design docs → ticket backlog.
- **D-003** Design docs are split by concern so no single session must hold the whole plan in context.

## Product

- **D-010** App name: **Lost Soles**. Fantasy/RPG theme, pun on "soles".
- **D-011** Primary purpose is *self*-motivation. Explicitly NOT competitive/social —
  the user rejected INTVL partly for pushing competition against people with more time to run.
- **D-012** Core motivator is **novelty**: running new places, not repeating routes.
- **D-013** **Low-upkeep is a hard design constraint.** The user abandoned Habitica because
  maintenance cost exceeded motivation. No daily check-ins, no chores, no streak punishment.
  Ingestion should be automatic wherever possible.
- **D-014** Multi-user is minimal: the owner plus up to ~5 friends/family, someday.

## Fog of war  (Round 1)

- **D-020** Revealed territory is **permanent forever**. The map only ever grows. Append-only data model.
- **D-021** Re-running previously explored ground grants **half XP**.
- **D-022** **6-month discovery cooldown**: ground run within the last 6 months yields no
  discovery credit. Ground last run >6 months ago becomes eligible for discovery again.
  (Territory stays visually revealed the whole time — only *discovery* credit re-arms.)
  → NEEDS CONFIRMATION: exact reading of the user's wording. See Round 3.

## Progression  (Round 1)

- **D-030** **Hybrid skill system**: per-activity skills 1:1 with exercises, PLUS meta skills.
  One action can train multiple skills, Runescape-style.
- **D-031** Activity skills (working names): Wayfaring (running), Might (pushups),
  Fortitude (situps), Endurance (planks). Adding a workout type adds a skill — must be modular.
- **D-032** Meta skills (working names): Cartography (new territory), Slayer (monsters),
  Constitution (total volume).
- **D-033** A **Total Level** aggregates all skills, as in Runescape.

## Combat  (Round 1)

- **D-040** **Both** map encounters and boss quests.
  Map creatures inhabit fogged regions and are encountered by running into/near them.
  A longer-running boss/quest accepts damage from *any* workout, so non-running days still count.
- **D-041** Combat resolves automatically from skills + gear at import time. Not a game the user plays.
  (Rejected: manual turn-based battles — that is the Habitica upkeep trap.)
- ~~**D-042** PROVISIONAL: map encounters likely land in MVP~~ → **STRUCK.** Superseded by
  D-122: ALL combat (map encounters AND boss quests) is out of MVP.

## Presentation  (Round 2)

- **D-050** Art direction: **dark fantasy — ink, parchment, lantern-light, gold leaf, deep navy.**
- **D-051** **The map must remain a real, legible street map.** Non-negotiable: the user needs to
  see actual streets to decide where to run. Atmosphere may never cost legibility.
- **D-052** **Two map modes**: "atlas" (high-legibility, for planning) and
  "adventure" (full atmosphere, for admiring the map). A toggle.
- **D-053** Research independently converged on a **parchment basemap with dark fog** rather than
  dark-on-dark, because dark basemap + dark fog destroys reveal contrast. Consistent with D-051.

## Workout logging  (Round 2)

- **D-060** Strength work (pushups/situps/planks) is logged **in-app**. No API anywhere exposes
  reps or sets — not Strava, not Whoop, not Fitbit. This is forced, not chosen.
- **D-061** UI: an **"Add workout" button**, NOT per-exercise buttons on the home screen.
  It opens a dedicated page with multiple quick-log entries, one row per workout type.
  Chosen specifically so adding future workout types does not clutter the home screen.
- **D-062** One-tap quick log for MVP. Sets/reps/rest-timer deferred, but the data model
  must accommodate sets from day one.

## Route planning  (added by user during Round 1 confirmation)

- **D-070** Feature: **plan a run by target distance + start point, prioritizing new territory.**
  Confirmed as in-scope. Drove research track R7.

## Data & platform

- **D-080** PROVISIONAL: Hosting stays **AWS Amplify Gen 2**, subdomain of devaultsecurity.com,
  source in GitHub, fully cloud-hosted. No local server. (User preference; research confirms fit.)
- **D-081** Avoid VPC-attached Lambdas. A Lambda needing both VPC and internet forces a
  **NAT Gateway at ~$33/mo**, ~10x the entire target budget.
- **D-082** No Postgres/PostGIS. Explored territory as **H3 cells in DynamoDB**.
- **D-083** Target running cost: a few dollars a month. Research estimate ~$1-5/mo all-in.

## Tickets

- **D-090** A ticketsmith-derived system ships with the project from day one.
- **D-091** `/tickets` command is required.
- **D-092** Manual ticket creation from the app UI is required (phone-friendly).
- **D-093** PROVISIONAL: markdown in the repo is the single source of truth; the phone UI only
  ever *creates* (into `tickets/inbox/`), the agent only ever *edits/numbers/moves*.
  Disjoint write sets ⇒ no merge conflicts, no sync engine.

## Ingestion architecture  (from R8)

- **D-100** **Ingestion is source-agnostic.** The internal contract is a normalized
  `Activity` + `Trace`. Every source (Strava, file upload, a watch vendor, an Android
  companion, manual entry) is an **adapter** behind that contract.
  Rationale: every surviving app in this category is multi-source — Wandrer 4, CityStrides 7,
  Dawarich file-import, Fog of World never used Strava. StatsHunters is the ONLY single-source
  app in the category and the most fragile. An app promising a *permanent* map must not depend
  on a party that reserves the right to force deletion in 30 days.
- **D-101** **User-supplied files are the system of record.** Original GPX/FIT is retained
  in S3. Anything API-sourced is reproducible/replaceable, never the only copy.
- **D-102** Strava is permitted as a *convenience adapter*, not a foundation.
  Verified risk profile: violates written terms (yes, unambiguously); enforced against a
  6-user app (<1%); could break one day (yes — and 2026 enforcement targets ATHLETE CAPS,
  not storage: apps downgraded 9,999→1 without notice, nobody has graduated past 10 athletes
  since 2026-06-01). Failure mode is friends being locked out, not data deletion.
- **D-103** Because of D-100, **the watch/device decision is no longer blocking.** It can be
  made later and added as an adapter without touching the rest of the system.

### R8 corrections to R1
- R1 wrongly called §5.7 "new in 2026". It dates to at least Sept 2022; the 7-day cache rule
  to 2015. Genuinely new in 2026: §5.5 "Persistent Index", §5.16 (MCP/proxy ban), §3.3 (tiers).
- All four clauses (§6.2, §5.7, §5.5, §7.4) and the §6.6 export carve-out were re-verified
  verbatim against the live documents. R1's textual reading stands.

---

## OPEN — blocking design

- **O-001** ~~Run ingestion path~~ → RESOLVED IN PRINCIPLE by D-100..D-103 (source-agnostic
  adapters). What REMAINS open is only *which adapter ships first in MVP*, pending R9/R10.
  User rejected: manual file upload as the *primary* path (becomes a chore), and knowingly
  violating Strava's terms.
  User constraint: **any watch must not need daily charging.** Loved Whoop's ~14-day battery;
  abandoned a Pixel Watch over daily charging.
- ~~**O-002** H3 resolution~~ → RESOLVED: res 10. See D-115.
- **O-003** MVP cut line. To be settled in Round 3.

---

## Ingestion adapters — concrete findings  (from R10, 2026-08-30)

- **D-110** **PWA run-recording is REJECTED.** Screen Wake Lock is auto-released when the tab
  hides, there is no service-worker geolocation, and a pocketed phone loses the trace in ~90s.
  The user's instinct that it "needed to be an Android app" was correct.
- **D-111** **Share-sheet GPX import is REJECTED.** `share_target` works, but **Strava has no
  GPX export in its mobile app** — export is website-only, per Strava support docs. The
  "manual file upload" option offered in Round 2 would have required a desktop after every run.
- **D-112** **GPSLogger is the recommended first adapter.** F-Droid, GPLv2, maintained. Already
  POSTs finished GPX (or per-point JSON w/ custom method, headers, auth) to an arbitrary HTTPS
  endpoint. Zero Android code written by us; we build only the ingest endpoint that D-100
  requires anyway. Bonus: run continuously it reveals every street *walked*, not just runs.
- **D-113** **Health Connect is the preferred long-term adapter**, pending one check.
  `ExerciseRoute` carries full GPS (lat/lng/alt/accuracy/timestamp per point).
  **Google imposes NO retention limit** on lawfully-read data — only disclosure + a delete path.
  Constraints: reads capped to last 30 days without `READ_HEALTH_DATA_HISTORY`; background reads
  of another app's route always return `ConsentRequired`, so sync happens on app-open, not
  silently (acceptable).
  → **BLOCKED ON USER CHECK:** does Strava write *routes* (not just summary sessions) to
  Health Connect? Verify at: Health Connect → App permissions → Strava → look for "Exercise route".
- **D-114** **Sideload any companion app.** Removes the Play health declaration, the
  background-location demo video, and the yearly target-SDK deadline entirely.
- **D-115** H3 **resolution 10** (resolves O-002). R4's soft-disc splatting means hex geometry
  never appears visually, so res 11's 4.4x data cost buys nothing.

### R10 method caveat
WebSearch quota was exhausted for that agent; findings come from primary docs only
(developer.android.com, Play policy, project READMEs). Not cross-checked against community reports.

### Device path (from R9)
- **D-116** Garmin's developer API is CLOSED (business-only; new applications paused in 2026;
  the unofficial `garth` workaround died 2026-03-27 to Cloudflare TLS fingerprinting).
- **D-117** A watch purchase is a **Whoop-replacement decision**, NOT a legal necessity.
  Candidates: Suunto Race 2 ($499, ~14d, real webhook API, non-commercial allowed);
  Polar Vantage M3 ($399, self-serve API, no retention cap, but ~6d battery);
  Garmin Instinct 3 Solar ($399, ~17d, best hardware, no API). Deferred indefinitely.

---

## Round 3 answers — CONFIRMED  (2026-08-30)

- **D-120** **Fog/XP rules, FINAL.** The map NEVER re-fogs; revealed ground is visible forever.
  - Re-running previously explored ground: **half XP** to the activity skill (Wayfaring).
  - Ground run within the last **6 months**: **zero** discovery credit.
  - Ground last run **more than 6 months ago**: re-arms for **partial discovery credit at 50%**.
    Rewards returning to a long-neglected part of town without ever making it as valuable as
    genuinely new ground.
  - Supersedes the provisional D-022.
  - Implication for the data model: each explored cell needs a `lastRunAt` timestamp, not just
    a presence bit, and discovery scoring is a function of `now - lastRunAt`.

- **D-121** **MVP ingestion = Strava API adapter.** User's explicit decision, made with full
  knowledge of the retention terms (R1/R8) and after rejecting it once in Round 2.
  Stated reasoning: buying dedicated hardware is the eventual plan; Strava unblocks MVP now.
  - I advised against it. User reaffirmed. Building it.
  - **Practical risk is the athlete cap, not deletion**: apps have been downgraded 9,999→1
    without notice, and nobody has graduated past 10 athletes since 2026-06-01. This only
    bites when friends/family are added, which is out of MVP scope anyway.
  - **Required mitigations, non-negotiable:**
    1. Strava lives strictly behind the D-100 adapter boundary. No Strava types leak into the
       domain model. Swapping adapters must touch exactly one module.
    2. **Archive every raw trace to S3 at ingest.** When the user migrates to owned hardware,
       nothing is lost and the replacement adapter can backfill from the archive.
    3. Ship `activity:read_all` scope, not `activity:read` (R1: the lesser scope returns
       privacy-zone-truncated traces that would permanently blank the map around home).
    4. Use the full `latlng` stream, never `summary_polyline` (R1: Douglas-Peucker simplified
       to ~100-300 pts vs ~2,700; corners cut, loops collapsed to chords).
  - Post-MVP adapter order: Health Connect bridge (D-113) or GPSLogger (D-112), then a
    watch vendor if hardware is purchased (D-117).

- **D-122** **MVP SCOPE = map + fog + full hybrid skill system + strength logging.**
  IN: Strava ingest, fog of war rendering, both map modes, all activity + meta skills,
      XP/levels, the "Add workout" quick-log page, ticket system (required from day one per D-090).
  OUT of MVP: combat (map encounters AND boss quests), novelty route planning, equipment/loot.
  - Note: Cartography and Constitution meta-skills are IN. Slayer is OUT (no combat yet).

- **D-123** **No special home-location privacy handling.** Single-user app, private AWS account,
  map shown only to the owner. Full-fidelity traces stored, nothing truncated or masked.
  - REVISIT TRIGGER: if friends/family accounts or any share/screenshot feature is ever added,
    this decision must be reopened. Note it in `08-security-privacy.md` as a standing condition.

## Remaining open

- **O-003** ~~MVP cut line~~ → RESOLVED by D-122.
- **O-004** Does Strava write *routes* to Health Connect? User check pending (D-113).
  NOT blocking — only affects post-MVP adapter choice.
- **O-005** ⚠️ **SEVERITY CORRECTED 2026-08-30.** `~/devaultsecurity/.claude/settings.local.json`
  contains a **complete AWS credential pair** — both the access key id and the secret access key,
  in plaintext, inside the command strings the permission allowlist matches on. 6 occurrences of
  the id, of which **5 also carry the secret**. One key, repeated.
  - The initial scan grepped only for the `AKIA` id pattern and therefore under-reported this as
    "6 occurrences of an access key ID". **An id alone is unusable; an id plus secret is a working
    credential.** The corrected reading is one step more serious.
  - Still **not tracked and not in git history** — nothing has reached GitHub. `.claude/` is not
    gitignored, so it remains one `git add .` from exposure.
  - **Additional exposure:** part of the secret was printed to a Claude Code session transcript
    during the 2026-08-30 inspection. Nothing left the machine, but it is now in one more place
    than it was, which removes the justification for a leisurely soak.
  - **Revised remediation: create the replacement key and DEACTIVATE the old one the same day**
    (was: deactivate after 24h of normal use). Ticket 0002 steps 4-9 are unchanged.
  - Unrelated to Lost Soles; in scope because the mechanism is identical and the same tooling runs
    on the same machine.

  ### ✅ CLOSED 2026-08-30 — ticket 0002

  - **Rotated.** Operator created a replacement key via the IAM console and configured it as
    profile `devault` in `~/.aws/credentials` (`0600`). Verified: `sts get-caller-identity` returns
    `arn:aws:iam::286588821906:user/cli-user`.
  - **Old key deleted.** The inlined key is no longer present in IAM at all.
  - **Gitignored.** `.claude/` and `*.local.json` added to `~/devaultsecurity/.gitignore`, committed
    as `81a79b0`. Verified by staging: `git add -A` now stages **0** files under `.claude/`.
  - **De-inlined.** All credential material removed from `settings.local.json`; allowlist went 33 →
    28 entries. The two `Bash(export AWS_…_KEY="…")` entries were **deleted outright** — allowlisting
    the act of exporting a credential is the anti-pattern itself, not something to rewrite. The five
    amplify entries now match on prefix patterns (`Bash(aws amplify get-job:*)`,
    `Bash(aws amplify list-jobs:*)`). Repo-wide sweep for `AKIA[0-9A-Z]{16}` returns nothing.
  - **CloudTrail verdict: NEAR-MISS CONFIRMED, with a stated limit.** Zero events attributable to
    the old key in the 90-day lookback. No evidence of use, let alone misuse. **But CloudTrail's
    default retention is 90 days and the key existed far longer — this is absence of evidence, not
    evidence of absence.** Recorded honestly rather than as a clean bill of health. §8 incident
    playbook not invoked.
  - **Root cause, and why it matters more than the instance:** there was **no configured AWS profile
    on the machine at all**. The key was inlined because there was nowhere else to put it — every
    command needed credentials pasted inline, and the permission allowlist recorded those command
    strings verbatim. The allowlist became a credential store by accident. Creating a real profile
    is therefore the class fix, not hygiene.
  - **Class fix status: PARTIAL.** A profile now exists, so credentials have a proper home. IAM
    Identity Center (short-lived credentials, no standing `AKIA…` on the laptop) was **not** adopted
    — a long-lived key still exists, it is just stored correctly. Revisit under 0122.
  - **Follow-on filed:** **0122** — a second, dormant access key on `cli-user` created 2022-12-06 is
    still Active with no CloudTrail activity. Separate finding, not part of O-005.

- **D-154** **Standing rule, from O-005.** A credential value never appears in a configuration file,
  and tool/agent configuration directories are gitignored from a repository's first commit.
  Config holds **references** — a profile name, an SSM parameter path, an env var name — never the
  material. Binding on permission allowlists, MCP definitions, editor and agent settings.
  Required content for the Lost Soles `.gitignore`, implemented by ticket 0004:
  `.claude/`, `*.local.json`, `.env*`, with an explicit `!` un-ignore for
  `.claude/skills/tickets/` reviewed on the way in.

- **D-124** **Target platform is Android.** The user runs with an Android phone (established in
  Round 2 / R10). Any capture shortcut, companion app or share-target design must be Android:
  Tasker/MacroDroid HTTP tasks, Google Assistant routines, PWA `share_target`. **Not** iOS
  Shortcuts / Siri. Desktop browser is a secondary target for planning and admin.

---

## Round 4 answers — game balance & fog UI  (2026-08-30, CONFIRMED)

- **D-130** **XP curve = `4L²` to advance from L to L+1.** Cumulative `C(L) = 2(L−1)L(2L−1)/3`,
  `C(99) = 1,274,196`. Cubic, NOT exponential.
  - **Runescape's curve was evaluated and REJECTED** with the user's real mileage: RS is
    `XP ∝ 2^(L/7)` and works in-game only because income grows ~100x from L1→L99. Real running
    volume is flat for life (~1,841 km in year 1 and year 15 alike). Fed real numbers, the RS
    curve yields level 52 in year one and **level 99 in 126 years**. Rescaling XP/km cannot fix
    it — that shifts all levels equally. Diagnostic ratio `XP(99)/XP(50)`: RS 128.6, ours 7.88.
  - Progression: 1mo Wayfaring 22 · 2mo 27 (the hook target) · 1yr 47, Total 225 ·
    3yr Total 315 · 10yr Total 462 · **99 Wayfaring at 11.9 years**.
  - Rates: 100 XP/km · pushup 4 · situp 3 · plank 1.5/sec · new H3 cell 15 ·
    Constitution = 1/3 of activity XP (pattern lifted from RS Hitpoints).
  - To rescale the whole timeline, change the one constant: `3L²` → 99 in 8.9y, `5L²` → 14.9y.

- **D-131** **Strength-skill pacing left as-is.** 99 Might ≈ 27 years at modest volume is
  ACCEPTED as honest. Skill levels mean the same thing across disciplines; the remedy for a
  slow bar is more pushups, not cheaper XP. Rejected: rebalancing strength rates upward, and
  per-skill curve constants (which would make levels non-comparable across skills).

- **D-132** **GPS-less running trains a SEPARATE activity skill**, at full XP, with zero
  discovery credit and no map reveal.
  - Proposed name **Vigil** (running hard while going nowhere). Naming is provisional — the
    mechanic is confirmed, the word is not.
  - Covers treadmill, track-in-a-gym, and any run whose trace is absent or rejected.
  - **This is the modular skill system's first real test (D-031): adding it must be a DATA ROW,
    not code.** If implementing Vigil requires a code change, the skill schema is wrong.
  - Outdoor and indoor progress are tracked separately; neither dilutes the other.

- **D-133** **Cold-territory display: atlas mode ONLY** (D-052).
  - Adventure mode stays pure known/unknown for atmosphere.
  - Atlas mode renders explored ground past the 6-month cooldown differently (cooler/dimmer/
    faintly misted) so rediscovery-eligible ground is visible when planning.
  - Rationale: the information is only useful while deciding where to run, so it earns its place
    only in the planning view. Avoids a third visual state competing with the reveal edge.

- **D-134** **Gear grants NO XP multipliers.** Combat power, lantern reveal radius, and
  appearance only. XP-bearing gear silently compounds against the D-130 curve and makes the
  user's own history non-comparable across time. (Decided by Claude; reversible.)

- **D-135** **Replay never lowers already-displayed XP.** Corrections may only add. A downward
  correction on a run the user already celebrated is worse than a small permanent inaccuracy.
  (Decided by Claude; reversible. Resolves an open question from 05-fog-of-war §9.3.)

## Contract reconciliation

- **D-140** `01-architecture.md` and `03-integrations.md` were written in parallel and defined
  `Activity`/`Trace`/`SourceAdapter` independently, conflicting in 8 places. **The canonical
  merged contract is `docs/contracts/ingestion-contract.md` — that file wins.** Both source docs
  carry a banner pointing to it. Key resolutions: absolute epoch-ms timestamps (not relative);
  three time fields UTC + naive-local + IANA (an offset is not a timezone — DST); `activityId` =
  sha256(user, source, externalId) not ULID (deterministic ⇒ idempotent replay); `kind` on the
  activity but `skill` in the game layer; `listSince` MANDATORY (covers silently dropped webhooks).

---

## Skill schema defect found by the Vigil test  (2026-08-30)

- **D-141** **The skill-as-data schema in `04-game-design.md` §1.3 is DEFECTIVE as written and
  must be amended before any scoring code exists.**
  - Defect: Wayfaring (outdoor running) and Vigil (GPS-less running, D-132) are **byte-identical**
    in every field of the §1.3 schema — same `kind: activity`, `logMode: trace`, `unit: km`,
    `xpPerUnit: 100`. Nothing in a row states *which activities feed it*, so a scorer would need
    `activity.hasTrace ? "wayfaring" : "vigil"` — the exact hardcoded switch D-031 forbids.
  - Root cause: the schema covers measurement, rating, propagation and presentation, but not
    **SELECTION**.
  - Fix: add a declarative `match` block (`kinds`, `requiresTrace`, `sources`, `measure`) plus
    `matchPriority`, using only types already in `contracts/ingestion-contract.md`.
  - With `match`, adding Vigil is **one YAML row, zero code** — D-031 satisfied.
    D-132's "zero discovery credit / no reveal" clause needs no field: `hasTrace: false` ⇒ no
    trace ⇒ no cells ⇒ no Cartography, which falls out of `05-fog-of-war.md` §3.6.
  - **`match` must land in `xp-rules-v1.yaml` BEFORE any scoring code is written.** The backlog
    must carry a ticket to amend `04-game-design.md` §1.3, and CI must carry the D-132 test
    permanently (`02-data-model.md` §3.8).
  - **Value of the exercise: this defect was caught in planning rather than in ticket ~15, where
    every subsequently-added workout type would have compounded the switch statement.**

- **D-142** **XP ledger enforces D-135 inside the ledger, not by clamping.** Append-only, one row
  per (activity, skill, reason), each carrying `xpRulesVersion`; `SkillState` is a pure SUM.
  A replay deletes only `isFloor: false` rows, and any shortfall against the pre-replay waterline
  is written as a deterministic `retained_floor` row. Keeps `displayedXp == SUM(ledger)` true,
  makes retention auditable and idempotent, and prevents compounding across successive rebalances.
  `levelHighWater` is a SECOND ratchet — the XP floor covers rate changes, not curve changes.

- **D-143** **One documented exception to D-101's "everything is reconstructible from raw":**
  D-135 requires knowing what was *displayed*, which is not derivable from raw files.
  `snapshots/skillstate/` is therefore also system-of-record. Recorded in `02-data-model.md` §8.2.

- **D-144** Cell writes sit OUTSIDE the ingest transaction (DynamoDB's 100-item cap vs 40-130 cells
  per run). The failure mode is deliberately **"map ahead of XP"**, never the reverse.

## Knock-on effects of D-132 (Vigil) found by the UI/UX pass

- **D-145** **Total Level ceiling is 693, not 594.** Adding Vigil as a fifth activity skill moved
  it. `04-game-design.md` §1.2 still states the old figure and must be corrected.
- **D-146** **Adding a skill mints a free Total Level point.** It must NEVER fire a level-up
  celebration. Any future workout type hits this. Guard it at the notification layer, not the
  scoring layer. (`06-ui-ux.md` §5.4, §10.5.)
- **D-147** Cold territory (D-133) is rendered on a DIFFERENT PERCEPTUAL CHANNEL from the reveal
  edge — frontier = warm luminance, cold ground = cool desaturation — and the cold wash is clipped
  two cell-widths *inside* the coverage mask so the two can never touch. This is how D-050
  atmosphere and D-051 legibility are both satisfied. Continuous from month 5.
- **D-148** Gold leaf is a FILL and a RULE, never body text (2.1:1 on parchment). Gold type only
  at >=24sp or on navy. All floating chrome is OPAQUE — translucent chrome is illegible against a
  surface that swings from #F5EDD9 to #0B1020 within one screen.

---

## Working agreement — session, git, and audit  (2026-08-30, user-directed)

- **D-150** **Auto-commit and push to `main` after every ticket close and every meaningful change.**
  User-directed, standing authorization — no per-commit confirmation needed.
  - Solo repo, no branch protection, no PR flow for ordinary work. `main` is the only branch.
  - Commit message: `NNNN: <ticket title>` plus the `## Resolution` summary; ticket file moves to
    `tickets/closed/` in the same commit as the code it describes.
  - **The one carve-out:** a commit that would push a secret is never made. `gitleaks protect
    --staged` (0004) runs first; a hit stops the commit rather than prompting.
  - Rationale: the ticket file and the code that satisfies it must be one atomic unit of history,
    or `git log` stops being a usable record of why anything exists.

- **D-151** **Session protocol: clear context at capability boundaries, not at every ticket.**
  - Within a capability, do **2–3 tickets per session** — they touch the same files and cite the
    same design sections, so re-orienting per ticket is pure waste.
  - Clear **between capabilities**, and mid-capability whenever context passes ~50%.
  - **The ticket's `## Resolution` IS the context handoff.** Written properly, clearing costs
    nothing; written lazily, clearing loses the session. This is why 07-ticketsmith makes
    Resolution mandatory.
  - **Never read a whole design doc.** They run 1,000–1,700 lines. Tickets cite sections; read by
    section. `docs/INDEX.md` (0120) exists to make that cheap.
  - Exception: for the three overrun-risk capabilities (`08`, `09`, `12`) clear per ticket — they
    are where a stale mental model does the most damage.

- **D-152** **Ask before implementing anything the plan does not cover.**
  User-directed. If a ticket's acceptance criteria do not settle a question, or implementation
  reveals the design was wrong, **stop and ask** rather than choosing and proceeding.
  - Never silently expand a ticket's scope — file a new ticket (`source: agent`).
  - A design doc that turns out to be wrong is a finding, not an obstacle: surface it, get a
    decision, record it as a new `D-xxx`, then continue.

- **D-153** **Every capability closes with a drift audit.** See `docs/capabilities/AUDIT.md`.
  A capability is not done when its tickets are closed; it is done when the audit passes.
  **The governing rule: if the implementation diverged from the design doc, either the code
  changes or the doc changes — never neither.** Silent divergence is the drift.

---

## Capability `00` close audit — divergences  (2026-08-30, D-153)

- **D-155** **Pre-commit hook is `.githooks/pre-commit` + `core.hooksPath`, NOT husky + lint-staged.**
  Ticket 0004's criterion named husky; husky requires a `package.json` that does not exist until
  0012, and creating one early collides with the project init. `.githooks` satisfies the intent
  (a pre-commit hook running `gitleaks protect --staged`), is version-controlled, applies to every
  clone, and needs no npm dependency. Resolution class: **design was wrong**, criterion amended.
  Revisit after 0012 only if husky buys something `.githooks` does not.

- **D-156** **GitHub secret scanning and push protection are UNAVAILABLE and will not be enabled.**
  Both require GitHub Advanced Security, which a private personal repo does not have. Verified: the
  API accepts `PATCH security_and_analysis` with a 200 and the status silently remains `disabled`.
  Making the repo public to obtain them is not a trade worth making for a repo holding a lifetime
  GPS history (`08-security-privacy.md` §2). Resolution class: **design was wrong**, criterion
  amended in 0004.
  - **This is not a like-for-like loss, and the compensating control is specific.** §7.3 wanted push
    protection because the capture endpoint (capability `03`) commits **dictated prose from a phone
    through the GitHub API**, bypassing the local pre-commit hook entirely. That gap is real and is
    now a requirement on **ticket 0019**: the endpoint scans its own payload for the five patterns
    and rejects, rather than committing and cleaning up after — a secret committed and later removed
    is still in history.
  - Remaining layers: pre-commit hook (laptop commits) and CI gitleaks (after the fact, on push).

- **D-157** **The 2022 access key on `cli-user` is deactivated.** `get-access-key-last-used` is
  decisive: last used **2022-12-06T04:49**, one hour 46 minutes after creation, and never again —
  3 years 8 months dormant. Deactivated 2026-08-30 (reversible). Deletion follows a 24-48h soak
  under ticket 0122. The live `devault` profile was verified working immediately after.

---

## Ticket tooling — Q-07-1 and Q-07-3 settled  (2026-08-30, tickets 0007/0008)

- **D-158** **Mutating commands that `git mv` refuse to run on a dirty working tree**
  (settles Q-07-3). `close` and `triage-move` refuse; `start`, `block`, `unblock` and `create`
  do not.
  - Rationale: the two refusing commands move a file and are expected to be followed by their own
    commit. Running them over unrelated changes produces a commit that mixes a ticket transition
    with whatever else was in flight, and the ticket file then no longer travels with the code that
    satisfied it — which is the whole point of D-150.
  - The other four only edit a file in place and are routinely run mid-session with app code
    already dirty. Refusing there would be friction with no benefit.
  - `--allow-dirty` is the escape hatch on both refusing commands, so the operator is never stuck.
  - Both the refusal and the override are covered by tests: a refusal that is not tested is a
    refusal that gets bypassed by accident.

- **D-159** **`tickets/index.json` is COMMITTED, not gitignored** (settles Q-07-1).
  - It is derived and deleting it is always safe, so either choice is defensible. Committed wins
    because the in-app ticket UI (capability `17`) reads a cache built from it — committing means a
    cold start has the index immediately rather than having to run the script or rebuild from 120+
    file reads.
  - Cost: it appears in diffs on every ticket transition. Acceptable — it is generated
    deterministically and sorted, so the diff is small and readable rather than churn.
  - `.gitignore` must NOT list it. Every mutating command regenerates it as its last step, so a
    stale committed index is a bug in the command, not an expected state.

- **D-160** **Tests use `node:test`, not vitest.** vitest requires a `package.json` and an
  `npm install` that do not exist until 0012; `node --test` is built in and runs today. Same
  reasoning as D-155 (`.githooks` over husky): take the zero-dependency option that works now,
  revisit when the project has a package manifest. 44 tests currently pass.

- **D-161** **`size: l` stays a WARNING in `validate`, and a REFUSAL in `next`.** Settled while
  closing 0011, which asked whether `l` should be promoted to an error.
  - `validate` warns only when an `l` ticket is *in the ready set* (`size === "l" && isReady(...)`),
    so a large ticket sitting behind unmet dependencies is silent. `next` refuses to hand one over
    at all, exits 1, and tells the operator to split it.
  - Rationale: enforcement belongs at the **moment of pickup**, where the operator is already
    thinking about the ticket and can act on it. Making `l` a hard error would fail validation over
    a ticket nobody will touch for six weeks, and the only way to get a green run would be to split
    tickets speculatively — which is worse planning, not better.
  - This also means a clean `validate` does **not** assert the backlog is free of `l` tickets. That
    is intended: `l` is a smell recorded honestly (0006 is the standing example), and the system's
    job is to stop you *starting* one, not to stop you *writing one down*.
  - Consequence: `validate` reporting zero warnings is not evidence that no `size: l` exists. When
    auditing, check `l` tickets directly rather than inferring their absence from a clean run.

---

## Capability `02` — first application code  (2026-08-31, ticket 0012)

- **D-162** **`amplify.yml` installs with `npm install --no-save`, NOT `npm ci`.** Supersedes the
  literal `npm ci --cache .npm --prefer-offline` written in `01-architecture.md` §6. The intent of
  §6 — install from the committed lockfile, reproducibly, in a clean environment — is unchanged;
  only the command changes, and only because `npm ci` does not work.
  - **`npm ci` cannot install Amplify Gen 2 at all today.** Reduced to a two-line `package.json`:
    `{"@aws-amplify/backend": "^1.24.0"}` alone exits 1; `{"@aws-amplify/backend-cli": "^1.9.0"}`
    alone exits 0. `@aws-amplify/data-construct@1.17.7` and
    `@aws-amplify/graphql-api-construct@1.22.2` ship internally inconsistent **bundled** dependency
    trees — a bundled `@opentelemetry/resources@2.0.0` pinning `@opentelemetry/core@2.0.0` sits
    beside a bundled `core@2.8.0`, and the same shape recurs for
    `@aws-amplify/plugin-types@1.12.1` → `@aws-cdk/toolkit-lib@1.19.0`. `npm install` tolerates a
    bundled subtree; `npm ci` validates it strictly and refuses with ~95 `Missing … from lock file`
    lines.
  - **Ruled out, each tested rather than assumed:** npm **9.9.3 / 10.5.0 / 10.8.2 / 10.9.2 / 11**
    all fail identically, so it is not the local Node 23. `@aws-amplify/backend`
    **1.20 / 1.21 / 1.22 / 1.23 / 1.24** all fail, because every one caret-resolves to the same
    broken tarballs. **`overrides` cannot fix it** — an override does not rewrite the contents of a
    bundled tarball; pinning the constructs to their last self-consistent releases
    (`data-construct@1.17.3`, `graphql-api-construct@1.21.4`) made the missing-entry list *larger*.
    `--install-strategy=nested` did not help.
  - **What `--no-save` buys and what it costs.** Verified from a fresh clone: it installs from the
    committed lock, leaves `package-lock.json` **byte-identical** (same md5 before and after), and
    `next build` succeeds. What is lost is `npm ci`'s hard guarantee that the build FAILS when
    `package.json` and the lockfile have drifted apart. That guarantee is worth having, which is
    why this is a temporary retreat with a ticket attached and not a new preference.
  - **Deliberately NOT chosen:** `npm ci || npm install --no-save`. It would self-heal once upstream
    republishes, but it also silently swallows a genuine lock desync — the exact failure `npm ci`
    exists to catch. A visible, documented substitution beats an invisible fallback.
  - **Revert path: ticket 0128.** Re-test `npm ci` against a two-line reproduction; when it exits 0,
    restore §6's command verbatim and close D-162 as superseded.

---

## Capability `02` — the correctness gate  (2026-08-31, ticket 0013)

- **D-163** **The GitHub Actions gate is an alarm; `amplify.yml` is the lock.** Branch protection is
  declined, and every check therefore runs in **both** places. Amends `01-architecture.md` §6 CI,
  which assumed a PR gate, and amends ticket 0013's criteria 7–9.
  - **Why no branch protection.** D-150 settled that this is a solo repo: `main` is the only branch
    and every ticket closes by pushing straight to it. GitHub's "require status checks" cannot
    express *"run the checks and tell me"* — on a protected branch it rejects any push whose commit
    has not already passed them, which is unsatisfiable for a direct push and so forces a PR per
    ticket. That is the ceremony D-150 exists to refuse. Protection was also **unavailable** at the
    time of writing (private repo, free personal account: the protection and rulesets APIs both
    return `403 Upgrade to GitHub Pro or make this repository public`), but the repo went public
    under 0122/0013 and protection is now merely **declined**, not blocked. The distinction matters:
    reversing this is a policy change, not a purchase.
  - **The consequence, stated honestly.** A red run on `main` blocks nothing. It is a notification,
    and notifications get ignored — this was not hypothetical: `docs-index` had been failing on
    `main` for four consecutive pushes over ~10 hours, since `30438db`, and nobody noticed. That is
    the entire argument for the second copy.
  - **Therefore the deploy path carries the same checks.** `amplify.yml`'s frontend build runs the
    D-100 boundary check, `typecheck`, `lint` and `test` before `build`, cheapest first. A failed
    Amplify build leaves the previous deployment live, so this — not GitHub — is what actually
    stops bad code reaching `soles.devaultsecurity.com`. **The two lists must be kept in step**;
    a check added to one and not the other is a check that only half exists.
  - **Superseded if** a second contributor ever appears. Review by a second human is a real reason
    for a PR flow; gating a solo trunk against oneself is not.

- **D-164** **`npm run lint` is `eslint . --max-warnings 0`.** Found while proving the gate could go
  red: it could not. `next/typescript` sets `@typescript-eslint/no-unused-vars` and most of its rule
  set to severity **warn**, and `eslint` exits 0 on warnings — so `npm run lint` passed on an unused
  variable and would have passed on almost any lint fault. The gate was decorative in exactly the way
  0013 was written to prevent, and had shipped that way in 0012.
  - The cost is real and accepted: every future warning blocks the build and the deploy. For a
    project whose stated position is that a gate slow or soft enough to be resented is a gate that
    gets bypassed, a warning nobody must act on is worse than no rule at all.

- **D-165** **The repository is public.** Changed 2026-08-31 during ticket 0013, user-directed:
  *"I actually don't mind this being a public repo — I'd rather show it off vs. worrying about
  someone taking my work, I like the open-source mindset."*
  - **Pre-flight, run before the flip and not after.** Going public publishes **all history**,
    permanently and cloneably, so the check had to cover history rather than the working tree:
    `gitleaks detect --log-opts=--all` over all 24 commits found **no leaks**; no `.env`, `*.pem`,
    `*.key`, `credentials` or `amplify_outputs.json` was ever committed (`.env.example` is, by
    design); and the one open security finding — the dormant 2022 access key of **0122** — was
    confirmed already `Inactive`, so the repo discloses a *remediated* weakness rather than a live
    one. 0122's remaining delete is a soak formality due 2026-09-01.
  - **Knowingly published, and judged acceptable:** AWS account `286588821906` and two ACM
    certificate ARNs (identifiers, not credentials — AWS does not treat an account id as secret),
    and the operator's commit email, which is permanently public and will be scraped.
  - **What it bought, beyond the intent.** GitHub **secret scanning and push protection** are free
    only on public repos and are now enabled — this is 0004's third scanning layer, which could not
    be turned on while the repo was private and free, and it matters specifically because the
    capture endpoint (capability `03`) commits dictated prose from a phone into `tickets/inbox/`
    with no human re-read. Actions minutes also become unmetered.
  - **What it deliberately did NOT change.** Branch protection became *available* at this moment
    (the API moved from `403 Upgrade to GitHub Pro` to `404 Branch not protected`). It is still
    declined, for the reasons in D-163. The change makes that a standing choice rather than a
    platform limit, which is the honest way to hold it.

- **D-166** **An SSM parameter name is not a Strava-shaped type — D-100's tier-2 grep excludes
  SCREAMING_SNAKE `STRAVA_*` tokens.** Found during ticket 0017, the first time anything in the repo
  referenced the secret registry: `secret("STRAVA_WEBHOOK_VERIFY_TOKEN")` failed
  `scripts/check-boundaries.mjs`, because the tier-2 pattern `strava[A-Za-z0-9_]` matches `STRAVA`
  followed by an underscore. **This clarifies D-100's scope; it does not weaken it.**
  - **The collision was between two parts of the design, not between the design and convenience.**
    `01-architecture.md` §7 fixes the spelling of those four keys, and `secret('STRAVA_CLIENT_SECRET')`
    inside a `defineFunction` environment block is how capability 05 wires the adapter's credentials
    — that block is the *correct* home for it. As written, the gate made the §7 registry
    unreferenceable from anywhere in the repo.
  - **SCREAMING_SNAKE is the discriminator, and it is a real one.** A type is PascalCase, a variable
    is camelCase; an all-caps `STRAVA_*` token is an environment or parameter key and nothing else.
    The redaction is case-**sensitive** for exactly that reason, so `stravaId` and `StravaActivity`
    are untouched. `strava_client_secret` in lowercase still fires.
  - **The STRICT tier gets no exclusion at all.** A `STRAVA_ANYTHING` in `src/domain` or
    `src/pipeline` still fails: the domain has no business reading a source's credentials either.
    That asymmetry is the whole reason this is a narrowing rather than a hole.
  - **Implemented by redacting the blessed token and testing what is left**, so a line carrying both
    a secret key name and a genuine violation still fires. Four self-test cases cover it in both
    directions — blessed in BROAD, caught in STRICT, caught when mixed, caught in lowercase.
  - **This is the second narrowing of the same tier**, after 0016's settings copy (`note="Strava
    re-auth, ..."`). Both were false positives on legitimate code, found within two tickets of the
    check landing. The pattern holds: a gate with false positives is a gate that gets bypassed, and
    the fix each time was to make the rule say what it actually means rather than to exempt a path.
    An exemption on `amplify/functions/` was considered and rejected — that directory will hold every
    ingestion Lambda, which is precisely where a Strava-shaped type reaching the pipeline would do
    the most damage.

- **D-167** **D-100 is about dependency, not vocabulary. The domain may NAME its sources in one
  union; it may not DEPEND on any of them.** Found during ticket 0025, on the first attempt to
  transcribe `contracts/ingestion-contract.md` §2 into `src/domain/activity.ts`. **This clarifies
  D-100's scope; it does not weaken it.**
  - **The check was never satisfiable, in its own document, from the day it was written.**
    `01-architecture.md` §3 defines T1 as a grep for `strava` over `src/domain` that must return
    nothing — and **220 lines earlier, in the same section**, declares
    `export type AdapterId = | "strava" | … | (string & {})` as living in
    `src/domain/activity.ts`, annotated *"an opaque tag; the domain never branches on it."* The
    canonical contract later inherited the grep verbatim, so §2 and §5.1 of that file contradict
    each other too. Neither contradiction was introduced by reconciliation; both were latent from
    the start, and only surfaced when someone first tried to write the file.
  - **Naming is not depending.** Nothing in the domain reads that union member, and the
    `(string & {})` widening means adding a source still never requires editing the domain — so
    T2 ("swapping the primary source touches one directory and one registry line, zero lines in
    `src/domain/`") holds unchanged. That is the operational test, and it is untouched.
  - **Blessed: exactly one shape, in exactly one place.** A line consisting only of union members
    (`| "name"`, optionally several, optionally with a trailing comment), only under
    `src/domain/`. Everything capable of expressing a dependency still fails **in the same file** —
    a Strava-shaped field, a branch on a source id, an import from an adapter, `summary_polyline` —
    each with its own self-test case. The same union line in `src/pipeline/` or `app/` still fires.
  - **This is the third narrowing of this one check in a day** — 0016's settings copy, D-166's
    secret key names, and now this. Recorded together deliberately, because three exceptions to a
    rule usually means the rule is stated wrong rather than that reality keeps being exceptional.
    Here the diagnosis is consistent across all three: **a text search for a word is standing in
    for a rule about dependencies.** It is kept because it is free, runs in both CI surfaces with no
    toolchain, and has caught real things. **If a fourth narrowing is needed, replace the mechanism
    — an import-graph and identifier check — rather than adding another pattern.** That is the
    trigger, written down so the next person does not have to notice the pattern themselves.
  - **Not fixed in the transcription.** Ticket 0025 is explicit that a contract problem found while
    transcribing must be surfaced, not quietly repaired in the copy. It was raised, decided, and
    corrected **in the contract and in `01-architecture.md` §3 first**; only then was the domain
    file written. A domain that quietly disagrees with its contract is worse than either being
    wrong, because the disagreement is invisible.

---

## Standing credentials  (2026-09-01, ticket 0122)

- **D-168** **`cli-user` keeps its single standing access key; IAM Identity Center is declined for
  now.** Settled while closing 0122, which asked whether the user should exist at all once Lost
  Soles deploys. Operator-directed.
  - **What Identity Center would buy:** short-lived credentials, so a leaked key expires on its own
    rather than needing to be noticed. That is a real advantage and it is the reason the question
    was asked rather than assumed away.
  - **What it costs here:** account-level SSO setup, an `aws sso login` in the path of every deploy,
    and a re-pointed `devault` profile — permanent ceremony on a single-operator hobby account with
    exactly one human, one workstation and a ~$3/mo budget. The threat it defends against is a key
    leaking; the defences already in place against *that* are the ones that have actually fired —
    the pre-commit hook and CI gitleaks (D-159 layers), which caught a real key id on the project's
    first commit.
  - **The dormant-key problem was a hygiene failure, not an architecture failure.** A key created
    in 2022, used for 106 minutes and forgotten is what happens when nobody ever lists the keys.
    Identity Center would have prevented it; so does looking. The standing key is kept **on the
    condition that it stays singular** — `cli-user` has one key, and a second one appearing is
    itself the signal that something is wrong.
  - **Reverse this if any of these become true:** a second human needs account access; a CI system
    outside GitHub Actions needs AWS credentials; or the key needs to live anywhere other than
    `~/.aws/credentials` on the one workstation. Any of the three makes a standing key the wrong
    shape, and this decision should be superseded rather than stretched.
  - **Rotation:** the live key was created 2026-08-31. Rotate on or before **2027-08-31**, or
    immediately on any suspected exposure. Recorded here because a rotation date nobody wrote down
    is how the 2022 key happened.

---

## Operator-verifiable criteria  (2026-09-01, ticket 0124)

- **D-169** **A criterion prefixed `(operator)` blocks a close until a human has run it, and its
  tick must carry a dated result.** Settled while closing 0124, which was itself filed by 0123.
  - **The failure it answers.** Ticket `0010` carried the criterion *"typing `/tickets` shows the
    skill"*, identified it in `## Notes` as operator-verifiable only, **ticked it anyway**, and
    closed. The skill's frontmatter was invalid YAML; it never registered and shipped inert for days
    until `0123` found it. Nothing in the format or the tooling could tell the two kinds of tick
    apart — a box the agent ticked because it did the work, and a box the agent ticked because only
    a human could have, are the same character in the same file.
  - **The mechanism.** `(operator)` in the criterion text, bare or bolded, any case. `close` refuses
    while such a criterion is unchecked and names the legitimate path — leave the ticket open,
    commit the work, close in a later session. `close` and `validate` both refuse one ticked without
    `— verified YYYY-MM-DD: <result>`. `validate` applies that in **every** folder, so a pre-tick is
    an error where it is written rather than a post-mortem after the close.
  - **Why the marker lives in the text, not in frontmatter.** An `operator_criteria: [2, 3]` index
    list rots silently the first time a criterion is reordered — the numbers still resolve, just to
    the wrong lines. Text survives reordering, quoting and copy-paste, and reads correctly in any
    markdown viewer.
  - **Why the refusal message differs from the ordinary one.** "Do the work, or amend the criterion
    and say why" is advice an agent can act on alone. For an operator criterion, acting on it alone
    means ticking the box — the exact `0010` failure. The refusal therefore names a different path,
    the one `0123` actually took and which worked.
  - **What this does not buy, stated so nobody relies on it.** It does not make a false tick
    impossible; an agent willing to tick a box is willing to type a date. It makes the claim
    explicit, dated and permanent, next to the criterion it concerns — the same standard
    `## Operator validation` prose is already held to (D-153, §3.5). This is a legibility mechanism,
    not a security boundary.
  - **Opt-in by construction.** No ticket written before this carries the marker, so the rule landed
    across 121 existing tickets with `validate` clean. `0010` is deliberately **not** amended:
    rewriting a closed ticket to satisfy a rule invented afterwards makes the record look better
    than the history was, and `0123`'s Resolution is more useful intact.

---

## Required body sections  (2026-09-01, ticket 0126)

- **D-170** **`07-ticketsmith.md` §4.7 gains the body-section rules; §3 governs, and the validator
  now enforces what it says.** Settled while closing 0126, which was filed by 0011's
  deliberate-error injection pass.
  - **The disagreement.** §3.3 makes `## Description`, `## Acceptance criteria`, `## Notes` and
    `## Operator validation` normative for *every* ticket. §4.7's validation-rule list carried no
    rule for them — body structure was checked only on `closed` tickets and on `type: bug`. Both
    halves were implemented faithfully; they simply disagreed. A ticket file with valid frontmatter
    and **no body at all** validated clean, and so did an open ticket with `## Operator validation`
    renamed away.
  - **§3 wins**, because it is the half that describes what a ticket *is*. The rule list is
    downstream of the format, not a second opinion on it. Recorded as an amendment to §4.7 rather
    than a silent extension of the validator — the validator implementing more than the doc
    authorises is the same class of drift in the other direction.
  - **Expressed as a table, not another branch.** `SECTION_RULES` in `tickets.mjs` maps a condition
    (always / `type: bug` / `type: design` / `folder: closed`) to the sections it requires. `create`
    already emitted sections per type; the validator not requiring them is how the two drifted
    apart unnoticed, and there is now a test asserting that everything `create` emits, `validate`
    accepts, for all six types.
  - **Inbox items are exempt from every section rule** (§2.3). This fixed a live trap rather than a
    theoretical one: the `bug` rule previously ran in *every* folder, so capturing "fog flickers
    when panning" as a `type: bug` from the phone — the single most likely thing to capture on a
    run — turned the whole backlog red. Proven against the current code before the change.
  - **A ticket promoted by `triage-move` now fails `validate` until its sections are written, and
    that is kept deliberately.** Operator-directed, and the alternative was considered: appending a
    `- [ ] TODO` skeleton the way `create` does would keep the workflow green, at the cost of an
    unfinished triage validating clean. A green tick on an empty criterion is D-169's failure in
    another costume. A promoted capture is not yet a ticket; the error is the gate, and the cost is
    that triage must be finished before committing rather than abandoned halfway.
  - **No ticket in the backlog needed fixing.** All 133 validated clean immediately, as 0011's audit
    predicted — the rule formalises what hand-authoring already did.

---

## The audit's three verdicts  (2026-09-01, ticket 0133)

- **D-171** **An audit check reports `pass`, `fail` or `n/a` — and an `n/a` must name what would make
  it applicable.** Settled while building the mechanical half of `/tickets audit` (0133), the first
  of the three tickets 0121 was split into.
  - **Why a third verdict at all.** Most of `AUDIT.md` targets application code that does not exist
    yet: no Vigil test (`0030`), no `rules/`, no fog blob, no XP ledger, no `src/pipeline`. A
    two-verdict audit has to call those checks green, and then the audit reports a pass while having
    checked almost nothing. Capability `01`'s hand-run audit had already named the failure —
    *"a checklist that is 60% dishonest ticks is worse than no checklist"* — and marked its
    inapplicable rows **n/a** by hand. This makes that discipline mechanical.
  - **The reason is the load-bearing part**, not the verdict. `n/a` with no reason is
    indistinguishable from a skip, and a skip is how a check disappears permanently. Every `n/a`
    names its activation condition — "no vigil test exists yet, ticket 0030 puts it permanently in
    CI", "activates as soon as one test names an `I-n`" — so the audit doubles as the list of what
    the project has not yet earned the right to check. A test asserts every `n/a` carries one.
  - **This is D-169 in a second place.** There, a ticked criterion had to carry a dated result so
    "a human checked it" could not masquerade as "the agent ticked it". Here, a check that could not
    run must not masquerade as one that passed. The same distinction, one layer up: **the output
    must preserve the difference between *checked* and *could not check*.**
  - **`n/a` never fails the run.** It is not a soft failure and must not become one, or the pressure
    to tick it green returns immediately.
  - **The invariant sweep self-activates.** It parses the `I-n` rows from `02-data-model.md` §9 and
    checks which are cited by a test. While no test cites any, it is `n/a` rather than 30 failures —
    noise on a repo with no domain model would train everyone to ignore the row, which is the same
    outcome as not having it. It goes live the moment the first test names an invariant.
  - **The command writes nothing and gates nothing.** That is 0134 (the recorded result, the
    divergence list, the drift budget) and 0135 (`next` refusing across a capability boundary). A
    green table from 0133 is explicitly **not** a passed audit, and the command prints that in its
    own output so the distinction cannot be lost by someone reading only the table.

---

## The audit record  (2026-09-01, ticket 0134)

- **D-172** **An audit result is recorded in the capability doc as a one-line
  `<!-- audit-record {json} -->` comment, and the record is append-only.** Settled while building
  0134, the second of the three tickets 0121 was split into.
  - **Why a JSON comment and not a parsed prose section.** `0135` has to answer *"did capability N
    pass its audit?"* with no human in the loop, and the answer gates work. Parsing prose for it is
    how the record starts lying: someone rewords a heading and a capability silently becomes
    unaudited — or worse, silently becomes audited. The comment renders invisibly in markdown,
    cannot collide with the write-up around it, and survives any amount of editing to the prose it
    sits under. The human-readable write-up is still written; it is just not the machine's source
    of truth.
  - **Append-only.** A re-audit adds a line and the last one stands. The project's instincts are
    append-only everywhere it matters (D-020 cells, D-135 XP), and an audit history that can be read
    backwards is worth more than a current-value field — *when* a capability started passing is
    exactly the question asked after drift is found.
  - **The divergence list must be asserted, never omitted.** `--record` refuses without either at
    least one `--divergence` or an explicit `--no-divergences`. A §2 that found nothing and a §2
    that never happened produce the same empty output, and the whole value of the audit is that
    those two must not be indistinguishable. Same shape as D-169 and D-171: **the record must
    preserve the difference between a negative finding and no finding.**
  - **Every divergence carries a resolution and a reference** — `code-was-wrong` with the ticket id,
    or `design-was-wrong` with the `D-xxx`. AUDIT.md's governing rule allows no third option, so an
    unreferenced divergence is refused: it is the "we'll remember" the rule exists to forbid.
  - **REFLECT is checked for substance, not for a heading.** Every capability doc ships with
    `## Reflection` already present, holding `_Filled in at the REFLECT step, after USE._` —
    checking the heading exists would have passed every capability from the day its doc was created.
    The check strips italic placeholder lines and requires real content, and it accepts the section
    at any heading depth because capability `00` keeps its real reflection at `### §6 Reflection`
    inside its hand-run audit.
  - **`--force` records `verdict: forced`, never `pass`**, with its reason in the doc. Skipping is
    made visible rather than impossible (0121's note). A forced audit that recorded as a pass would
    be worse than no audit, because it would satisfy `0135`'s gate.

---

## The capability gate  (2026-09-01, ticket 0135)

- **D-173** **`next` refuses to advance into a capability whose predecessors have not passed their
  audit.** Settled while building 0135, the last of the three tickets 0121 was split into. This is
  the criterion 0121's own notes call the one that gives the audit teeth: *"without it the audit is
  advisory and will be skipped precisely when it matters most."*
  - **A `next` refusal, not a readiness rule.** Same placement as the `size: l` refusal (D-161):
    enforcement goes where the operator is already paying attention. A backlog that failed
    `validate` because an audit was outstanding would train everyone to ignore `validate`.
  - **"Every lower capability", not "the immediately previous one"** — so skipping a capability
    cannot launder the gap. It also yields the "never blocked from finishing" property for free: a
    capability is never below itself, so work *inside* the capability you are in is never gated. You
    are blocked from advancing, never from finishing.
  - **The blocker reported is the EARLIEST gap, not the nearest.** Capabilities are built in order
    and audited in order, so the earliest outstanding audit is the one that can actually be done
    next. The first implementation reported the nearest — which sends you to audit `02` while `01`
    is still outstanding, and lands you back at the same refusal one capability later. Changed on
    reading the output rather than the code.
  - **A `forced` verdict lifts the gate exactly as `pass` does.** `--force` exists to make skipping
    *visible*, not impossible (0121, D-172); a force that still blocked would be a refusal with
    extra steps. The record says which it was, and `verdict: forced` is never written as `pass`.
  - **A capability with a doc but no tickets does not gate.** There is nothing to audit.
  - **`next --all` still lists the whole backlog**, gated entries marked. The gate refuses to hand
    over work; it does not hide the backlog, because an operator who cannot see what is waiting will
    reach around the gate rather than through it.
  - **Enforcement begins at capability `02`.** `00` and `01` predate the command that audits them;
    that bootstrap gap is closed by 0121's retroactive run rather than by pretending they were
    gated all along.

---

## A fifth ticket status: `deferred`  (2026-09-01, ticket 0136)

- **D-174** **Work that is specified, correct, and waiting on something outside the project gets
  its own status — `deferred` — and is excluded from the capability close gate.** Settled while
  building 0136, which was filed the day capability `02`'s audit could not pass and no honest route
  existed around it. `0128` (restore `npm ci` once Amplify Gen 2 stops shipping inconsistent bundled
  tarballs) is unworkable through no fault of its own; it held capability `02` open, and D-173's
  gate then held **eight** high-priority tickets across five later capabilities. An npm packaging
  defect in someone else's tarball was the critical path of the whole project.
  - **`blocked` is waiting on a ticket in this backlog; `deferred` is waiting on the world.** That
    sentence is the whole distinction and it is in both format docs. `blocked_by` holds ticket ids
    and a close clears it automatically; there is no honest ticket id for "npm fixes its tarballs",
    and filing a placeholder so that `blocked_by` has something to hold is the exact dishonesty
    this status removes. The other three statuses lie about such a ticket too: `open` claims it is
    available, `closed` claims criteria are met, `inbox` claims untriaged.
  - **Not a `--force`.** `audit --force` existed and would have cleared `02` that day. It records
    `verdict: forced` for the *whole* capability, which permanently understates a capability whose
    design conformance and operator validation were fine — one npm bug should not put an asterisk on
    all of its tickets forever. Forcing also trains the reflex that the gate is negotiable, which is
    precisely what D-153 was written to prevent.
  - **Excluded from `capability-tickets-closed`, but NAMED in the audit record.** The check ignores
    deferred tickets; the written record and the `audit-record` JSON list them by id. A capability
    that passed with three deferrals must never read as one that passed clean. Same instinct as
    D-169, D-171 and D-172: the record must distinguish "found nothing" from "did not look".
  - **A mandatory reason and a mandatory re-check, both enforced by `validate`.** The reason names
    the third party; the re-check is the cheap test that says the wait is over. A deferral with no
    reason is indistinguishable from a ticket nobody got to. A deferral with no re-check is a wait
    with no end condition — which is how a ticket goes quiet for a year.
  - **The re-check is runnable shell, not prose** — settled against the alternative at the start of
    0136, as the ticket's own notes asked. `0128`'s was already three shell lines, and a check that
    only a human can evaluate is one nobody evaluates. It lives in a fenced block in a `## Deferred`
    body section rather than a frontmatter field, because the frontmatter parser is deliberately
    flat and one-line and a real re-check is not.
  - **`recheck` reports and never acts.** It runs every deferred ticket's block, prints the verdict,
    and exits 0 whichever way it went — a failing re-check is the expected case, so this is a report
    and not a gate. Leaving the state is `resume`, typed by someone who read the output. Automatic
    un-deferring was the tempting version and it is the same failure by a different door: a ticket
    that silently returns to the backlog is a ticket nobody looks at.
  - **`deferred` lives in `open/`, exactly as `blocked` does.** The folder is the coarse state —
    untriaged / live / done — and a deferred ticket is still live work, just not available. No
    fourth folder, no change to the documented layout.
  - **`resume` renames the `## Deferred` heading rather than deleting the section.** What was waited
    on, and why, is worth keeping. The rename is also load-bearing: without it a second deferral
    would parse the first one's stale fenced block and `recheck` would run the wrong test.

---

## Auth: Auth.js with Google is the final state; Cognito until the game is complete  (2026-09-01, ticket 0129)

- **D-175** **Lost Soles will move from Cognito to Auth.js with Google sign-in, for real
  cross-subdomain SSO across `devaultsecurity.com` — after `15-two-map-modes-and-cold-territory`
  and before `16-rebuild-drill`. Until then Cognito stays, unchanged, with no identity provider.**
  Decided by the operator on 2026-09-01, on the costing in 0129.
  - **This supersedes `08-security-privacy.md` §5.1's reasoning on social IdPs, and does not
    re-affirm it.** §5.1 ruled them out as adding "an external trust dependency to buy nothing for
    six known humans." The premise was wrong in one specific way: it never weighed **one sign-in
    across the operator's own suite of apps on one domain**, because at the time nothing else was
    on that domain. That is a real benefit to the actual and only user, and it is named here rather
    than dismissed. §5.1 is annotated in place — the original reasoning stays visible.
  - **What is superseded is the *conclusion*, not the *posture*.** §5.1's actual subject —
    `selfSignUpEnabled: false`, `allowUnauthenticatedIdentities: false`, no anonymous principal —
    is untouched and non-negotiable. See the allowlist mapping below.
  - **Option 1 — Google as a federated IdP on Lost Soles' own Cognito pool — is rejected outright,
    permanently.** It takes on the external trust dependency §5.1 warned about and delivers **no
    SSO at all**, because `school-hub` authenticates with Auth.js cookies rather than Cognito: the
    operator would still sign in twice. It is the worst of the three options and should not be
    revisited.
  - **Why not now.** The migration's difficulty is concentrated in two places — browser access to
    S3 (`allow.entity("identity")` has no meaning without an identity pool) and the browser's
    AppSync subscriptions (`01-architecture.md` §4 step 17; a cookie does not sign a WebSocket
    handshake). Both are decisions that cannot be made well before the data model exists at all:
    capability `04` is where `Activity`, `XpLedgerEntry` and `ExploredCell` are defined. Migrating
    first means designing an authorization story against a schema nobody has written.
  - **Why not later, either.** `16-rebuild-drill` and `18-mvp-hardening` are the capabilities a
    later auth swap would invalidate — hardening and drilling a stack about to be deleted is work
    done twice. Slotting the migration before them is what makes the ordering forced rather than
    arbitrary.
  - **`selfSignUpEnabled: false` maps to `AUTH_ALLOWED_EMAILS`.** This is the load-bearing sentence
    for whoever does the migration. Google sign-in with no allowlist is a public registration
    endpoint wearing a different hat — the exact hole §5.1 calls the single most important line in
    the auth config. `school-hub`'s Auth.js config already carries the allowlist; it is not
    optional here.
  - **Three constraints on every capability built in between**, so the door stays open cheaply:
    the session is read in the `(app)/layout.tsx` gate and nowhere else; model authorization stays
    uniform `allow.owner()` with no bespoke per-model rules; and the two known migration costs are
    flagged on the tickets that create them (S3 client access in `07`/`08`, subscriptions in `14`).
  - **`scripts/check-auth-posture.mjs` keeps asserting `no federated identity providers`.** It is
    still true and still worth enforcing until the migration commit rewrites it against the new
    posture. It is rewritten, never deleted — and 0014's criterion 3 is annotated as superseded in
    that same commit, not before.
  - **This is not `deferred` (D-174).** `deferred` is for work waiting on the world. This waits on
    us, on a schedule we chose, which `depends_on` and a capability slot already express. Using the
    new status here would have been its first abuse.

---

## A guard must be able to prove it ran  (2026-09-01, ticket 0137)

- **D-176** **Every automated control must be able to distinguish "I ran and found nothing" from
  "I never ran", and must fail CLOSED on the second.** Settled while fixing three fail-open paths
  found in one file on one day. Each was a different spelling of the same mistake, and none of them
  was reported by anything: `staged=$(git diff --cached …)` discarded the exit status, so a git that
  could not answer and an empty staging area were the same empty string; `check-skills.mjs` printed
  "nothing to check" and exited 0 when its scan root did not exist, which is also what a root
  resolved to the wrong place looks like; and layer 1 asked `command -v gitleaks`, which answers
  *"is there a file called gitleaks"* and not *"is there a working scanner"* — a 19-byte `exit 0`
  stub satisfied it for a whole session in complete silence.
  - **This is D-169/D-171/D-172's rule one level down.** Those say the audit RECORD must distinguish
    "found nothing" from "did not look". D-176 says the CONTROL must, at runtime, or the record is
    faithfully recording a lie. A green tick over an unscanned commit is worse than no tick.
  - **The dangerous failure is the quiet one.** A missing gitleaks blocks loudly and gets installed
    within a minute. A *broken* gitleaks waves everything through and is discovered by accident, if
    at all. So presence is never the question — liveness is: the scanner must report a version.
  - **A guard's own liveness check may not depend on another external tool.** The version check is
    a bash `[[ =~ ]]` builtin, not a pipe into `grep`. Piping made a missing `grep` report as a
    broken `gitleaks`, which is this same defect displaced one level: the operator is told which
    control failed, and told wrong.
  - **`0125` fixed the syntax of this and left the semantics.** That ticket rewrote a bare
    `[ -z "$staged" ] && exit 0` into an explicit `if` block so no scripted edit could strand the
    layers below it, and wrote a comment saying so — three lines above the line where `git failed`
    and `nothing staged` remained the same value. A structural fix to a semantic bug reads as done.
    The test that would have caught it — a stub `git` that errors on `diff` — is the one 0125 did
    not write, and is now in the suite.
  - **The test harness is held to the same standard.** `command -v` in the hook's test also answers
    for shell functions and returns a bare NAME for them; symlinking that produced a dangling link,
    so the hook printed `grep: command not found` and exited 0 — the harness manufacturing the exact
    fail-open it exists to detect. It now requires an absolute path and throws by name when a tool
    the hook needs did not resolve.
  - **A shell PIPELINE is not a predicate.** `if cmd | grep -q PAT` was used as the layer-3 gate
    and inside layer 2, and under `set -o pipefail` it answers "false" for four different reasons,
    only one of which is "no match": `grep -q` exits at the FIRST match and SIGPIPEs whatever is
    still writing into it, so pipefail reports 141 *having matched*; a fork may not be taken; the
    grep may not exec. Measured, not theorised — `set -o pipefail; echo "$(seq 1 200000)" | grep -q
    '^1$'` returns 141, and the layer-3 gate misses 200/200 with a 250KB input. **In layer 2 this
    was a live miss**: a credential on line 1 of any file bigger than the pipe buffer went
    unreported. Where a check can be a builtin (`case`, `[[ =~ ]]`, a here-string), it must be — and
    where a pipeline is genuinely needed, the last stage must consume all of its input and the
    stages' statuses must be read individually from `PIPESTATUS`.
  - **Blocking is the default even where it is inconvenient.** `check-skills.mjs` now exits 1 on an
    absent `.claude/skills/` with no escape flag. The pre-commit hook only invokes it when a
    `SKILL.md` is staged, so an absent skills directory at that moment is self-contradictory, and
    the one CI workflow that calls it runs on a tree that carries the directory.

---

## Capability `02` close audit — divergences  (2026-09-02, D-153)

- **D-176** **`01-architecture.md` §5 and §6 are amended to match what shipped; the code stands.**
  The capability `02` close audit found four divergences, one over the drift budget of three, and
  the operator reviewed all four and accepted the implementation in every case. Two were the design
  doc being stale, and both are in the same document for the same reason: **§5 and §6 were written
  before any code existed and were never re-annotated once it did**, while §7 and §6's own
  branch-model bullet *were* (the "Corrected …" convention is used three times elsewhere in that
  file). A section that is confidently wrong is worse than one that is absent, which is the same
  argument `docs/INDEX.md` makes about itself.
  - **§6's `amplify.yml` block** specified `npm ci` and omitted six guards that are actually on the
    deploy path. `npm ci` is D-162, already recorded, with revert ticket `0128`; the guards arrived
    with 0014/0016/0017/0132. Amended with a correction block, and — the load-bearing part —
    **`amplify.yml` itself is now named as the authority on the deploy path**, because it is the
    LOCK (D-163) and it is commented per-command.
  - **§5's App Router tree** described `(public)`/`(app)` route groups, a `/sign-in` route, `/map`,
    `/activities` and `settings/sources/`. None shipped. `06-ui-ux.md` §1.2 is now stated as
    **normative for the IA**, since it is the document that reasoned about it and §4.1 settles the
    largest difference ("there is no map screen"). §5 also wrote `lib/domain/` while **§3 of the
    same document** wrote `src/domain/`; §3 is right, it is what `0025` built, and it is what
    `check-boundaries.mjs` enforces.
  - **The other two divergences were the code being wrong** and are filed rather than fixed here,
    so neither is absorbed into an audit: `0142` (the design-token gate does not scan `src/`) and
    `0143` (08 §5.3's security headers are in no ticket in the backlog).
  - **On the budget.** Four is over three, so the audit records `forced`, not `pass` — the script
    permits no other outcome and that is correct. It is recorded honestly rather than argued down
    to three by folding §5 and §6 into one finding: they are two wrong statements a reader would
    act on separately. The prescribed remedy for a busted budget is a DESIGN session on the
    affected doc, and the amendments above **are** that session, scoped to the two sections the
    audit actually found — `01-architecture.md` is otherwise sound and its §3, §4 and §7 have all
    been re-read and confirmed against the code in this audit.

