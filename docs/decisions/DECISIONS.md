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

- ~~**D-145** **Total Level ceiling is 693, not 594.** Adding Vigil as a fifth activity skill moved
  it. `04-game-design.md` §1.2 still states the old figure and must be corrected.~~ → **STRUCK.**
  Superseded by **D-192**: the ceiling is stated as ARITHMETIC — enabled rows × `maxLevel` — and
  never as a number. 693 was itself falsified by Roving and Cadence (`0157`) within the day.
  D-145's *method* was right; its number was incidental and is now wrong. Struck in place at the
  capability `04` re-audit (2026-09-08), because D-192 recorded the supersession only at its own
  end, and a reader arriving here found 693 stated flatly with nothing to warn them.
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

---

## CI ordering: severity, not cost  (2026-09-02, ticket 0140)

- **D-177** **`gate.yml` is ordered by SEVERITY, not by cost, and the docs-index check runs last.**
  It stays **blocking** — `continue-on-error` was considered and rejected.
  - **The failure this fixes.** `build-index.mjs --check` sat before `npm run build`. GitHub Actions
    steps are fail-fast, so from `ac977fd` (2026-09-01 03:48) a stale `docs/INDEX.md` turned the
    whole job red and **`npm run build` and both bundle-leak scans never ran** — fifteen consecutive
    pushes with capability `02`'s own secret-in-bundle check dark behind a documentation nit. The
    alarm was red the entire time, which is worse than it being off: a red build that always means
    the same trivial thing is a red build nobody reads. That is exactly the reflex **D-172** (0137)
    names as more dangerous than the flake itself.
  - **Why not `continue-on-error: true`.** It would make the job green on a stale index, which lets
    the index rot silently. `docs/INDEX.md` exists so a session can `sed -n` straight to a section
    (**D-151**) and its own header says a stale index is worse than none, because it sends you to
    the wrong lines *confidently*. Non-blocking is the wrong direction: the check is correct, its
    **position** was wrong.
  - **The rule, stated so new checks inherit it.** Anything whose failure means *"something unsafe
    shipped"* runs before anything whose failure means *"a document is untidy."* Cheapest-first is
    the normal instinct and it is wrong here, precisely because the cheapest checks tend to be the
    least serious, and fail-fast then lets them mask the most serious. New steps go above the
    hygiene block unless they are hygiene.
  - **This does not weaken the gate.** A stale index still fails the job. What changed is that the
    checks that matter now report their own verdict first, which is the property `0137` established
    for guards generally: a guard that cannot be seen to have run is not a guard.
  - **Scope.** `amplify.yml` is untouched — it never carried the index check, and the LOCK
    (**D-163**) should not start failing deploys over documentation. The index is an alarm concern.

- **D-178** **`build-index.mjs --check` is read-only.** It wrote `docs/.index-summaries.json` on
  every run, including `--check`, because the sidecar write sat above the `--check` branch. A
  checker that mutates the thing it checks left a dirty tree behind an apparently read-only command
  — which on CI means a verification step is also a mutation step, and locally means `--check`
  reports on a file it has just rewritten. Both writes now happen only on the regenerate path.
  Nothing is lost: the comparison is built in memory and never needed the sidecar on disk. Raised in
  `0140`'s own Notes as "worth deciding"; decided.


---

## The capture endpoint's guards fail closed  (2026-09-02, ticket 0019)

- **D-179** **When the capture endpoint's guard store cannot answer, the capture is refused with a
  503 and no commit.** The rate limiter and the idempotency check both live in DynamoDB
  (`LostSolesCaptureGuard`), and if DynamoDB is unreachable neither can report a verdict. The
  endpoint does **not** commit anyway with the limits switched off.
  - **This is D-176 applied to a live request path.** "The counter says you are under the limit" and
    "the counter could not be read" are different facts, and a control that produces the same
    outcome for both has failed open on exactly the burst it exists to stop. Same for idempotency:
    "this key is unused" and "the store could not say" must not both mean "commit it".
  - **The cost is real and was weighed, not overlooked.** A capture is a note dictated once at mile
    six with no second copy, and this decision says a DynamoDB outage bounces it. The counter-
    argument — prefer the note, log loudly, accept a duplicate file at triage — was put to the
    operator and rejected. 503 is a *retryable* status, ticket `0022`'s queue is what retries it,
    and the failure is loud rather than silent.
  - **What is NOT fail-closed, deliberately.** `releaseIdempotencyKey` swallows its own errors. It
    runs on a path that is already returning a failure, and replacing a useful 429 with an opaque
    500 because the cleanup failed would be strictly worse for the operator. The 24-hour TTL is the
    backstop.
  - **The same reasoning already governs the pre-commit hook** (`0137`, D-176) and
    `check-auth-posture.mjs`. This is that rule reaching the first control that runs while a user is
    waiting on it, which is where the temptation to fail open is strongest.

- **D-180** **A resource the Next.js SSR compute reads is named by a LITERAL on both sides, and the
  two are asserted equal by a test.** `LostSolesCaptureGuard` is given an explicit `tableName` in
  `amplify/backend.ts` and the identical literal in `lib/tickets/capture-store.ts`.
  - **Because the SSR compute has no configuration channel.** It is not a `defineFunction` Lambda,
    so it has no CloudFormation output, no `secret()` resolution and no env var it may use — 0017's
    standing rule forbids Amplify environment variables, and 0018 hit the same wall and answered it
    with SSM. A CDK-generated table name cannot reach the reader at all.
  - **Generalises beyond this table.** Every machine-only resource in `01-architecture.md` §2 that
    the SSR compute (rather than a `defineFunction` Lambda) must reach inherits this: name it
    explicitly, state the literal once per side, and assert the agreement in a test. A drift between
    the two is a runtime `ResourceNotFoundException` on a request that mattered — cheap to catch in
    the suite, expensive to discover in production.
  - **The cost, stated because it will bite someone.** An explicit table name is unique per account
    and region, so **`ampx sandbox` cannot coexist with the `main` branch's stack** for any table
    named this way. Acceptable at one branch and one operator (and `0131` already has the sandbox
    stack broken for unrelated reasons), but it is a real constraint on ever running two
    environments, and the answer then is a name suffixed per environment plus a way to tell the
    reader which it is — which is the configuration channel that does not exist today.

---

## Operator validation is for judgement, not for verification  (2026-09-02, tickets 0019, 0147)

- **D-181** **A criterion earns the `(operator)` prefix only when a human eye or hand is the ONLY
  instrument that can answer it.** Anything reachable with AWS credentials, `curl`, or a script —
  deployed infrastructure state, HTTP status codes, IAM and DynamoDB and GitHub behaviour, whether a
  build deployed — is the agent's job and must not be routed to a human.
  - **This NARROWS D-169; it does not repeal it.** The mechanism stands exactly as written:
    `(operator)` still blocks a close, is still never the agent's to tick, and still requires a
    dated result recorded on the criterion itself. What changes is the test for *earning the
    prefix*, which was never stated and so defaulted to "anything the agent could not personally
    confirm."
  - **The diagnosis, because it explains why this got out of hand.** Operator validation did not
    grow from a judgement that backend correctness needs a human. It grew because the agent had **no
    AWS credentials**, so every infrastructure question had one available answer: ask the operator.
    `0019` is the clean case — it shipped demanding four manual steps, and once the operator supplied
    `--profile devault` the agent ran all four in about ninety seconds. Two of them proved things no
    unit test could: a real DynamoDB conditional refusal at exactly the cap, and GitHub's actual
    `422 "sha" wasn't supplied`. The manual steps were a workaround for a constraint, mistaken for a
    control.
  - **The operator's stated position**, which is a product decision and not a concession: *"If you
    can do a smoke test, I'm willing to accept the risk that the production system will work.
    Operator validation should encompass design functions and things that you legitimately need my
    manual effort on."* The cost being paid down is real — *"I've barely got a functional web
    page"* — and it is the right thing to optimise, because a fitness app nobody can look at is not
    safer for having been triple-checked at the API layer.
  - **THE BURDEN MOVES, IT DOES NOT DISAPPEAR.** This is the failure mode to guard against: an agent
    that verifies less because it is no longer required to write a manual step. A ticket closing
    with neither an operator check nor a smoke test is strictly worse than what this replaces. The
    evidence still gets written down, in `## Operator validation`, naming what was run and what it
    proves — see `0019` for the shape.
  - **What keeps the prefix.** Anything visual or experiential: fog legibility (**D-051**), the
    post-run moment, the plinth, map performance on a real phone over real cell data. And anything
    needing a **production** Cognito session, which the agent must not have — a second production
    account fires `08-security-privacy.md` §2.4 Trigger A, and `0130` exists so troubleshooting
    never requires one.
  - **`docs/capabilities/AUDIT.md` §3 keeps its real-run requirement** for `08-map-and-fog-renderer`,
    `09-xp-engine-and-ledger` and `12-post-run-moment`, where "load the map and import a run" is the
    only honest check. It stops being a blanket rule everywhere else.
  - **A smoke test is not a weaker unit test — it reaches strictly further.** A stubbed client
    asserts the right `ConditionExpression` *string* was sent; only the real table proves DynamoDB
    accepts it. A reserved word used without an `ExpressionAttributeName` passes every unit test and
    fails in production. That is the class of bug this trade buys, and it is a better class than the
    one it gives up.

---

## A triage batch is one commit, so the clean-tree guard excepts tickets/  (2026-09-02, ticket 0023)

- **D-182** **The `triage-*` commands relax D-158's clean-tree guard for paths under `tickets/`,
  and only there.** Uncommitted work anywhere else still refuses.
  - **The conflict.** D-158 makes every file-moving command refuse a dirty tree, so a ticket
    transition cannot be committed on top of unrelated work in flight. `07-ticketsmith.md` §4.5/8
    requires a triage batch to land as **one** commit — `tickets: triage inbox (N items)`. Those two
    rules are incompatible as literally written: by construction the second capture in a batch runs
    with the first already written to disk, so it sees a dirty tree and refuses.
  - Before this, `triage-move` excepted only the single file it was itself moving. That is right for
    `close`, which transitions one ticket, and wrong for triage, which transitions N. The batch was
    therefore impossible without `--allow-dirty` on every item after the first — and a guard reached
    for routinely has stopped being a guard, which is the failure D-158's own comment warns about.
  - **The relaxation is faithful to what D-158 protects.** Its stated concern is a commit that
    "mixes a ticket transition with whatever else was in flight." The other transitions in a triage
    batch are not *whatever else* — they are the same unit of work, going into the same commit by
    design. An edit sitting uncommitted in `src/` or a design doc still blocks, and there is a test
    asserting exactly that.
  - **Scope, stated narrowly.** This applies to `triage-move`, `triage-merge`, `triage-decline` and
    `triage-defer`. `close` keeps the strict per-file guard: closing two tickets in one commit is
    not a thing the workflow does, and D-150 says each close is its own commit.
  - The cost, accepted: a triage batch *can* now sweep an unrelated stray edit to a ticket file into
    its commit. Ticket files are the things triage is editing, the diff is reviewed before the
    commit either way, and the alternative was a routine `--allow-dirty` that suppresses the guard
    entirely rather than narrowing it.

---

## A non-browser client authenticates with a verified bearer ID token  (2026-09-02, ticket 0149)

- **D-183** **A client that cannot hold a Cognito session cookie authenticates with
  `Authorization: Bearer <Cognito ID token>`, verified server-side against the production pool's
  JWKS.** The `sub` is read from the verified payload and checked against `OWNER_USER_IDS`, exactly
  as the cookie path does.
  - **The gap.** `0019` satisfied §6.4/1 ("a valid Lost Soles session") with cookies, and
    `08-security-privacy.md` §5.3 forbids taking a uid from a body, query string or header. Neither
    document said what a **non-browser** client does, and a Tasker HTTP task cannot hold a session
    cookie — so the capture endpoint was unreachable from the phone that is the entire point of
    capability `03` (roadmap §4.1). This is a gap in the design, not a defect in `0019`.
  - **Why this satisfies §5.3 rather than bending it.** §5.3's rule is about trusting an *asserted*
    identity. A signature verified against a public key fetched from the issuer is not an
    assertion — the identity still comes from Cognito, and the header is merely how it travels.
    The route re-derives `sub` from a verified JWT, which is what §5.3 actually asks for.
  - **A shared-secret header was considered and REJECTED.** It would have been trivial for the
    device, and it is the wrong trade three ways: it is a second auth path to a repository write
    primitive; the server would trust a header value outright, which is the thing §5.3 names; and
    it cannot be revoked for one device without rotating it for every client. A Cognito refresh
    token is revocable per token (`EnableTokenRevocation` is on) and per user
    (`AdminUserGlobalSignOut`).
  - **The trust anchor is hard-coded**, like `OWNER_USER_IDS` and for the same two reasons: these
    are identifiers, not credentials, and a fail-closed control should not depend on something that
    can be unavailable at runtime. `amplify_outputs.json` must **never** be the source — on a
    development machine it names the sandbox pool, whose only user is a throwaway whose password is
    in SSM.
  - **Verification runs in both the middleware and the route.** The duplicate is a JWKS cache hit
    and it is deliberate: one more exclusion in the middleware matcher would otherwise turn the
    endpoint's authorization off silently. A check whose correctness depends on a regex somewhere
    else is not a check.
  - The cost, accepted: a 1-hour ID token means the device re-runs `REFRESH_TOKEN_AUTH` before a
    capture that was queued offline for longer, rather than replaying a stale token. `0022` owns
    that, and the 30-day refresh token behind it is `0151`.

---

## The phone capture path is declined; the endpoint stands alone  (2026-09-03, tickets 0020, 0021, 0022)

- **D-184** **The Android quick-capture tile, the Assistant routine and the task-side offline retry
  queue are DECLINED.** `POST /api/tickets/capture` stays exactly as built (`0018`, `0019`, `0149`,
  `0150`, `0151`, `0152`). What is dropped is the *phone automation client in front of it*, not the
  endpoint. Capability `03` closes with three declines named in its audit record.
  - **The trigger.** The operator, reading `0020` cold, could not tell what capability `03` was for
    and asked whether it displaced the Strava import. It does not — `03` captures *development
    ideas about Lost Soles*, and run data is capability `05` — but two things made that unreadable,
    and both are real findings rather than a misreading.
  - **Finding 1: `0020` quoted roadmap §4.1 out of its scope.** §4.1's "the endpoint, not the UI, is
    the real product" is a claim about *two ticket-capture interfaces* — the HTTP endpoint beats the
    `/dev/tickets` sheet that arrives in capability `17`. Lifted into a ticket with none of the
    surrounding paragraph it reads as a claim about **Lost Soles**, which directly contradicts
    `00-vision.md`. Both copies are corrected.
  - **Finding 2: the plan named a paid dependency and never priced it.** `0020` and
    `docs/capabilities/03-capture-tile.md` recommend MacroDroid. Neither the ticket, the roadmap nor
    this register records that it is not free. A project on a ~$3/mo infrastructure budget (D-081)
    does not take a recurring subscription for a convenience feature, and the plan should have
    surfaced that when it was authored rather than at install time on the operator's phone.
  - **Why decline rather than defer.** `deferred` (D-174) is for work waiting on the *world* to
    change. Nothing here is waiting: a free client exists (HTTP Shortcuts — open source, quick
    settings tiles, arbitrary HTTP requests). The operator's judgement is that a phone-automation
    client is not worth its setup, maintenance and phone-wipe-reproduction cost for a channel that
    already works from a laptop. That is a decision, not a wait, and `deferred` would have misfiled
    it as one — leaving three tickets to re-litigate at every `recheck`.
  - **What this costs, stated plainly.** Between now and capability `17`, a post-run idea goes to a
    notes app and is hand-carried into `tickets/inbox/`, or is sent with `tools/capture/capture.sh`
    from a laptop. That is the D-092 gap §4.1 scheduled `03` early to close, and it is reopened
    until `17`. **D-092 reverts to being satisfied at `17`, not at `03`** — which is what D-092's own
    wording ("from the app UI") said in the first place. §4.1's claim to satisfy it at `03` was
    always a stretch: a MacroDroid macro is not an app UI.
  - **The endpoint was not wasted and is not orphaned.** It is the write path `17`'s sheet will POST
    to, it is exercised on every push by `0150`'s smoke test, and `tools/capture/capture.sh` is
    retained as its only non-browser client and its "is it the phone or the endpoint?" diagnostic.
  - **Reversing this is cheap, and the door is left open deliberately.** The endpoint, the bearer
    auth path (D-183) and a working reference client all survive. Rebuilding the tile means
    re-filing one ticket against `docs/capabilities/03-capture-tile.md`, which is kept, banner and
    all, for exactly that reason.

---

## The one push notification is declined; the plinth carries it  (2026-09-03, ticket 0096)

- **D-185** **`0096`, the "your run is on the map" push notification, is DECLINED.** Capability `14`
  ships webhook ingest, subscription management, token refresh and the nightly reconcile — the
  automatic path is unaffected. What is dropped is the *push* on the end of it.
  - **The ticket made this case itself and it is worth quoting rather than paraphrasing:** *"The
    plinth is the fallback, not the notification's backup singer. Everything that works with push
    must work identically without it."* One of its own acceptance criteria required an end-to-end
    run of the whole flow **with push disabled**, working identically. A feature whose spec mandates
    a fully-supported path without it is a feature the MVP can ship without.
  - **What replaces it: nothing, because `0087` already does the job.** The home plinth's
    `1 new run — tap to open` line is the same signal on the same tap, one app-open later. The cost
    is that you find out when you open the app rather than being told — which for a *reporting*
    notification (D-013 permits reporting, forbids asking) is a small delay, not a lost capability.
  - **What it saves.** Web push is the only remaining piece of the MVP that needs the phone
    *configured* rather than merely *opened*: a PWA install, a notification permission grant, a
    service worker, VAPID keys and a delivery path whose behaviour — as `0096` itself notes — "is
    the only part whose behaviour is outside our control." Against an operator goal of using the app
    sooner with less setup, that is the worst ratio left in the plan.
  - **The D-013 reasoning survives the decline and still binds.** If a notification is ever revived
    it must *report*, never *ask*: no streaks, no "you haven't logged today", no "unclaimed ground
    near you". The frontier line's exclusion (`06-ui-ux.md` §3.2, beat 5) stands regardless.
  - **Related but explicitly NOT declined: capability `17-tickets-ui`.** The operator confirmed on
    2026-09-03 that a ticket-management page in the web UI is wanted — see D-186. This decision is
    about push delivery alone.

---

## `AckResult` carries intents, not jobs  (2026-09-03, ticket 0026)

- **D-187** **`accept()` returns `commands: IngestCommand[]`, not `jobs: IngestJob[]`.**
  `01-architecture.md` §3 specified the latter. It cannot express a deletion.
  - **The defect.** Phase 1's entire job is to *classify an inbound payload* and hand back what
    should happen. Two of the four things that can happen are not jobs: a source-side delete
    (`retract`) and a revoked authorisation (`disconnect`) have nothing to fetch and nothing to
    archive. `IngestCommand` was defined with exactly those four variants in the same section of
    the same contract that gave `accept()` a return type able to carry only two of them.
  - **Why it was invisible.** `contracts/ingestion-contract.md` §3 specified `SourceAdapter` and
    `IngestCommand` in full but only *referenced* `AckResult`, `InboundRequest` and `IngestJob`.
    D-140's reconciliation compared the two docs where they overlapped; this gap was in neither
    doc's overlap, so nothing was there to conflict. **A type that only one document defines is
    not thereby agreed — it is unreviewed.**
  - `commands` subsumes the old field: `ingest` and `reingest` each wrap an `IngestJob`. An empty
    array keeps its old meaning — accepted and intentionally dropped.
  - **Also settled by this decision**, all recorded in contract §3 rather than left to be
    re-derived per adapter:
    1. **`InboundRequest` carries `rawBody: Buffer`, never parsed JSON.** A webhook signature is
       computed over the exact bytes sent; a `JSON.parse` + `stringify` round trip reorders keys
       and drops whitespace, so a body parsed before verification can never be verified. Parsing
       is the adapter's job, *after* the signature check.
    2. **`IngestJob` uses `source: SourceId` and `meta`**, not `01`'s `adapter: AdapterId` and
       `payload`. `AdapterId` does not exist in the built domain — conflict 1 settled on
       `SourceId`. `ingestKey` and `enqueuedAt` are kept from `01`: both are source-agnostic and
       load-bearing (`02-data-model.md` §8 reconstructs an `IngestJob` from an S3 key during the rebuild drill).
    3. **`IngestJob.command` is the narrow `"ingest" | "reingest"`, not `IngestCommand`.** As
       specified the two types were mutually recursive through a value: `IngestCommand`'s
       job-carrying variants hold an `IngestJob`, so a job holding a full command nests without
       end. `retract` and `disconnect` carry no job and cannot appear there.
  - **Supersedes nothing settled.** D-140 reconciled `Activity`/`Trace`/`SourceAdapter`; these
    three types were outside its scope. `01-architecture.md` §3 is marked SUPERSEDED in place,
    with the reasoning, rather than edited to look as though it had been right.

---

## The D-100 boundary check does not exempt test files  (2026-09-03, ticket 0027)

- **D-188** **`check-boundaries.mjs`'s allowlist stays `src/adapters/<source>/` +
  `src/adapters/registry.ts`. Test files are NOT exempt, and `0027`'s criterion 3 — which said the
  allowlist should be "exactly `src/adapters/strava/`, `__fixtures__/` and test files" — is amended
  rather than implemented.**
  - **Why the criterion was wrong.** `0025` built on the opposite guarantee, and said so in
    `src/domain/activity.types.test.ts`: *"the domain's own tests should not name a vendor, and
    `check-boundaries.mjs` enforces that."* A blanket test-file exemption would make
    `src/domain/anything.test.ts` free to name Strava, and D-100 is about **dependency**, which a
    test can express as readily as a module — a test that asserts on a Strava-shaped field is
    describing a domain that has one.
  - **The adapter's own tests are already covered** by the directory exemption: they live in
    `src/adapters/<source>/` and are exempt by path, not by being tests. So the criterion's real
    need was already met, and the exemption it asked for only added reach.
  - **`__fixtures__/` is deferred to `0038`, not refused.** A real checked-in Strava API response
    will be full of the vendor's name and genuinely needs the exemption. But that directory does
    not exist today, and `0038` is the ticket that creates it. **An allowlist entry for a path that
    does not exist is dead config** — it cannot be tested, nothing proves it is spelled right, and
    it silently pre-authorises whatever later occupies that name.
  - **`registry.ts` is an exemption the criterion omitted and cannot drop**: `01-architecture.md`
    §3 T2 requires that replacing the adapter touch "one directory + ONE line in
    `src/adapters/registry.ts`", so that line must be allowed to name the source it selects.
  - **Consistent with D-166 and D-167**, which each narrowed this check by finding a shape that
    cannot express a dependency (an SSM parameter name; a bare union member). This decision refuses
    a *widening* on the same test, and the test is the same one: can the exempted shape express a
    dependency? A test file can.

---

## Cycling is a first-class skill that does not open the map  (2026-09-04, ticket 0157)

- **D-189** **Two cycling skills ship in `v1` — `roving` (with a trace) and `cadence` (without) —
  at 35 XP/km, and NEITHER reveals ground or earns Cartography. `revealsGround` is a new required
  field on every activity skill row, and `wayfaring` is the only `true` in the file.**
  - **The operator's reasoning, in their words:** *"The main motivation is still running, so while
    I want extra exercise skills when I do bike, the only skill that should count for Cartography
    is currently running."* The map is the reward for running; a bike must not be able to collect it.
  - **The numbers that make it a real question, not a preference.** Cartography is tuned to parity
    with Wayfaring on purpose (04 §3.2): 6.5 cells/km × 15 XP ≈ 97.5 against running's 100, so *a
    kilometre of new ground is worth roughly double*. A bike covers about three times the distance
    for comparable effort, so a typical ride would have yielded **~2,900 Cartography XP against a
    run's ~870** — cycling would have become the dominant way to train the novelty skill, which
    D-012 names as the core motivator for running.
  - **P1 was checked and does not settle this.** *"Any distance covered with a trace attached
    reveals ground and earns XP"* rules out gating on **shape, minimum or GPS quality**, and rules
    out distinguishing runs from walks. It was written about not silently discarding effort, not
    about which disciplines own the map. D-189 is a deliberate, recorded narrowing of it, and P1's
    actual prohibitions all stand.
  - **THE REJECTED MIDDLE OPTION, and why it is worse than either end: reveal the ground but award
    no Cartography.** Because the map never re-fogs (D-020), cycling through a neighbourhood would
    **permanently destroy that ground's discovery value** — running the same streets later earns
    nothing, because the ground is no longer new. It eats the map without paying for it. Either
    cycling counts fully or it does not touch the map at all; anything between is strictly worse
    than both ends. Recorded because it is the option that sounds most reasonable.
  - **Why a field and not code.** "Only `[run, walk, hike]` reveal" is a hardcoded list of kinds —
    the `switch` D-031 forbids and D-141 was written to remove. Selection became data; revelation
    had to as well. `revealsGround` is a property of the **skill**, so a future skill that should
    open the map — rucking, trail running, a walking skill split out of Wayfaring — sets one field
    and needs no code. A test asserts a second `true` row validates cleanly, so the field cannot
    degrade into a disguised special case for running.
  - **It does not contradict 04 §1.3's refusal of `grantsDiscovery`.** That refusal is about Vigil,
    where the answer already falls out of `hasTrace: false` and the flag would restate it. Roving
    is the case it does not cover: a real trace, real cells, and a decision that exists nowhere
    else in the data. §1.3 is amended in place with this distinction rather than left to read as a
    contradiction.
  - **No default, deliberately.** Required on every activity row. The map never re-fogs, so a cell
    revealed because a line was forgotten is revealed for ever — and whichever way a default fell
    it would be wrong for half the rows.
  - **Rate: 35 XP/km**, the operator's choice of the speed-ratio anchor (100/3, cycling covering
    ~3× the distance for comparable effort). A ~25 km ride is ~875 XP, alongside a typical run
    (885) and strength session (840) under §3.2's session-parity principle. `cadence` takes the
    identical rate, exactly as D-132 gave Vigil full Wayfaring XP rather than half.
    > **AMENDED 2026-09-04 (ticket `0158`) — the rate is 60 XP/km. The 35 above is superseded and
    > left standing so the mistake is visible.**
    >
    > 35 was derived from the speed ratio and sanity-checked against an **assumed** 25 km ride.
    > At the operator's actual typical ride of **15 km** it pays 525 XP — under 60% of a run,
    > which is not session parity by any reading. 885/15 = 59, rounded to **60** for legibility
    > (a clean 3/5 of running; a 15 km ride lands at 900 against a run's 885).
    >
    > **The lesson, not the number:** the rate was chosen against a distance nobody had checked.
    > The operator's own reading of the file caught it within a day, which is the D-181 argument
    > for keeping a human on the legibility step rather than only on the correctness one. The
    > test that now guards it asserts *the principle* — a typical ride within 10% of a typical
    > run — with `TYPICAL_RIDE_KM` named as a constant, so changing the rate without revisiting
    > the assumption fails and says why.
  - **Consequences elsewhere:** `kind: ride` matched no skill at all before this, so a recorded
    bike ride scored zero — this closes a live gap. Total Level's ceiling moves from 8 rows to 10
    (`0031` owns §1.2's number). `0047` must honour `revealsGround` when it writes `ExploredCell`,
    or the field is inert data and the decision silently does not happen.
  - **Not decided here: rucking.** A ruck is a walk with a weighted pack and nothing in the
    ingestion contract distinguishes them, so it needs a discriminator, not a row. Walking and
    hiking already reveal and earn Cartography — they are `wayfaring`'s `match.kinds`.

---

## The totality check is strict for known kinds and exempt for `other`  (2026-09-04, ticket 0029)

- **D-190** **`02-data-model.md` §3.8 check 3 — "zero matches for measurable work fails the build"
  — is narrowed: it is enforced for the five KNOWN `ActivityKind` values and NOT for `other`.**
  - **Why the literal wording could not ship.** `other` is the catch-all kind, and no distance
    skill claims it. That is deliberate, and §3.7 says so in the same document: *"Pool swimming
    (distance with no GPS) is not a new kernel — it is `match: { kinds: [other], requiresTrace:
    false, measure: distanceKm }`, i.e. another Vigil."* An `other` activity gets its own row when
    somebody adds one. Read literally, check 3 would therefore have failed the build on the
    correct, shipped ruleset from the moment the check was written.
  - **The deeper reason it is not a loophole.** Requiring a skill for `other` means requiring a
    skill for *every activity nobody has classified yet*, which is not a property any ruleset can
    hold — the kind exists precisely to absorb what the taxonomy does not cover. A check whose
    passing condition is unreachable does not get satisfied; it gets deleted.
  - **What is still strict, and it is the part that matters.** `run`, `walk`, `hike` and `ride`
    must each have exactly one distance skill at every `hasTrace` value. That is the case worth
    protecting: a broken `match` block means real runs are recorded with real distance and score
    **nothing**, silently. `strength` is excluded separately, by nature — a distance skill for
    strength would be the bug, not the fix.
  - **The exemption is named in code and asserted by a test**, not achieved by weakening the rule
    until it stops complaining. A check that silently tolerates a gap is the check that stops
    finding them. A test asserts the shipped file validates clean *because* of the narrowing, so
    the day someone removes it the failure is legible.
  - **Found by writing `0157`,** not by writing this ticket: the cycling rows made it obvious that
    `other` + trace has no distance skill, which was already true and had never been surfaced.
    Recorded then as a known gap in a test, and settled here.

---

## One `measure` per skill row  (2026-09-04, ticket 0031)

- **D-191** **A skill row carries exactly one `measure`. A skill that genuinely owns two
  quantities is two rows.** `04-game-design.md` §1.3 carried this as an open item — *"whether
  `match` becomes a list or `measure` accepts a set"* — and it is now settled by the matcher that
  shipped in `0029`, not by preference.
  - **A set has no defined behaviour.** `selectActivitySkills` groups candidates **by `measure`**
    and returns one skill per distinct measure (`02-data-model.md` §3.4). That grouping is what
    lets one strength session train Might *and* Fortitude while a run trains one distance skill.
    A row with two measures belongs to two groups and wins or loses each independently — so it
    could be selected for one of its measures and not the other, and there is no sensible
    tie-break for a row that is half-selected.
  - **The cost of the answer is one line and one `displayOrder`**, which is the same trade the
    schema makes everywhere else: the general mechanism is rows, and the answer to "one row must
    do two things" is two rows. `02` §3.7's closed set of four kernels is the same principle a
    layer down.
  - Enforced, not just written: `doc-schema.test.ts` asserts every activity row in §1.3's example
    has a single string `measure`, and the schema types `measure` as one value rather than a list.

---

## The Total Level ceiling is computed, never stated  (2026-09-04, ticket 0031)

- **D-192** **`04-game-design.md` §1.2 states the ARITHMETIC — enabled rows × `maxLevel` — and no
  longer states a number. Supersedes the figure in D-145.**
  - **The number has been wrong three times.** Published as **594** (6 rows), corrected to **693**
    when Slayer was counted, then falsified again by Vigil (`0028`) and by Roving and Cadence
    (`0157`). At `v1` it is 9 × 99 = **891**, and that figure will go stale too.
  - **Every one of those falsifications was a data-only change** — the exact changes D-031
    promises are free. So a hardcoded total is not merely a stale fact; it is a **standing
    contradiction of the project's central structural claim.** Adding a skill cannot both be "a
    row and zero code" and require editing a number in a design doc.
  - **D-145's method was right and its number was incidental.** `09-roadmap.md` §5.1 already asked
    for the ceiling to be *"computed in code as `skillCount × 99`, never a literal"*. This decision
    applies the same rule to the prose, which is where all three errors actually lived.
  - **It also resolves an ambiguity nobody had noticed:** §5.1 said 693 "already counts seven",
    while §1.2's seven was *six MVP skills plus Slayer*. Two different sevens. Counting **enabled**
    rows removes it — Slayer ships `enabled: false` and does not count until it is enabled.
  - Knock-on, recorded rather than fixed: the Total Level milestone ladder (§4.3) was designed
    against a 594 ceiling and ends at 500, leaving a 391-point gap at the top. Adding rungs is a
    pacing decision and belongs to `0063`.

---

## A design doc cites the ruleset; it never restates a row  (2026-09-04, capability `04` audit)

- **D-193** **No design document may restate a per-row value from `rules/xp-rules-vN.yaml` —
  a rate, a unit, a flag, a skill count, or a total derived from them — as a bare fact. It
  cites the file, states the arithmetic, or carries a dated snapshot that says it is one.
  Generalises D-192 from the Total Level ceiling to every value the ruleset owns.**
  - **The evidence is that D-192 was not enough.** `0031` fixed the ceiling three weeks after
    it had been wrong three times, and reasoned the general case correctly. Six hours later the
    capability `04` drift audit found the *same failure* in three more places, all missed
    because `0031` was scoped to a number rather than to the pattern: `04` §1.1 still advertised
    Roving at **35 XP/km** after `0158` rescaled it to 60; `04` §3.2 — the session-parity table
    `0158` reasoned *from* — had no Vigil, Roving or Cadence row at all; `02` §3.2 listed `unit`
    as a closed set of four that omitted `share`, contradicting §3.7 of its own document and the
    shipped file.
  - **Every one of those was introduced by a change D-031 promises is free.** Vigil (`0028`),
    the cycling pair (`0157`) and the rescale (`0158`) were each a row or a number in one YAML
    file. If each also silently invalidates a table in a design doc, then "a workout type is a
    data row and nothing else" is false in practice while remaining true in the code — the
    worst of both, because the code keeps passing its tests while the documentation quietly
    rots into a trap for the next reader.
  - **Four divergences in one capability, over the budget of three**, and all four were the same
    shape. That is the signal AUDIT.md's budget exists to raise: the design is stale, not the
    code. The code was correct in every single case.
  - **What this permits, so the rule is usable.** Naming a skill and what it trains on is fine —
    that is the *design*, and it changes when the design changes. Quoting its `xpPerUnit` is not,
    unless the passage is arguing about that number, in which case it is dated and marked as a
    snapshot the way `04` §1.2's ceiling table now is. The test: *if a one-line YAML edit would
    falsify this sentence, it must not be a bare assertion.*
  - **Not enforceable by a script today, and that is recorded rather than papered over.**
    `doc-schema.test.ts` already asserts `04` §1.3's example matches the shipped file field by
    field — the mechanism exists and covers exactly one passage. Extending it to prose tables is
    a real ticket, not a line in a decision; until it is written this holds by review, which is
    the weakest kind of enforcement and the reason the failure recurred in the first place.

- **D-194** **An adapter's OAuth routes are generic `[source]` routes; the vendor half lives on a
  registered `OAuthConnector`.** Ticket `0032`. Supersedes nothing; it settles a question
  `contracts/ingestion-contract.md` §3 never asked, because §3 specifies the four *ingest* phases
  and says nothing about how a connection is made in the first place.
  - **The forcing constraint.** `0032`'s criterion 9 said every file it added would live under
    `src/adapters/strava/`. That is not buildable: the App Router serves routes from `app/`, and
    an OAuth handshake is three HTTP endpoints — start, callback, disconnect. The criterion was
    amended rather than satisfied, and this is the shape that replaced it.
  - **What was rejected: `app/api/auth/strava/…`.** It is what the redirect URI in
    `03-integrations.md` §2.2 reads like, and it fails D-100/D-121.1 — `check-boundaries.mjs`
    fires on a Strava import or literal anywhere under `app/`, and it is right to. Writing the
    route to dodge those patterns while still being about one vendor would be evasion of a gate
    rather than compliance with it.
  - **What was chosen.** `app/api/auth/[source]/{start,callback,disconnect}` resolve the segment
    through `registry.ts` and hold no vendor's name. The URL still renders as
    `/api/auth/strava/callback`, which is what the provider's app settings match against, so
    nothing external changes. The vendor half — authorize URL, code exchange, scope judgement,
    revocation — is an `OAuthConnector` in `src/adapters/strava/oauth.ts`.
  - **Why a SECOND registry rather than `SourceAdapter.oauth`.** The connector ships now, because
    nothing else in capability `05` can be tested until a real token exists; the four ingest
    phases arrive across `0034`-`0037`. Registering a `SourceAdapter` today would mean one whose
    `normalize`, `fetchRaw`, `accept` and `listSince` throw — `getAdapter("strava")` returning an
    object that claims to satisfy the contract and does not. `OAUTH_CONNECTORS` lives in the same
    blessed file, so `registry.ts` is still the only module outside an adapter's directory that
    names a concrete adapter, and `registry.test.ts` still asserts that. Folding `oauth` onto
    `SourceAdapter` when the real adapter registers is a refactor with the tests already green.
  - **The rule this sets for every future adapter**: anything the vendor decides — a URL shape, a
    scope name, a token response, an error's meaning — is on the connector. Anything the app
    decides — the nonce, its storage, the redirect target, who is signed in — is in the generic
    route. A file under `app/` that needs to know which provider it is talking to has found a
    missing connector member, not an exception.

---

## One raw archive object per ingest, not three  (2026-09-04, ticket `0035`)

- **D-194** **The raw archive stores ONE content-addressed object per ingest, holding every
  response the adapter fetched, at the key `contracts/ingestion-contract.md` §2 specifies.
  `03-integrations.md` §3.2's three-object layout — `manifest.json` + `summary.json` +
  `streams.json` under `raw/v1/user=…/source=…/date=…/<id>/r<rev>/` — is SUPERSEDED and must not
  be built.**
  - **The design contradicted itself and nothing had noticed, because nothing had built it.**
    `contracts/ingestion-contract.md` §2 gives `RawArchiveRef` a single `key`, a single `sha256`
    and a single `contentType`, and `NormalizedIngest.raw` is one ref or null. `03-integrations.md`
    §3.2 lays out three files per activity under a Hive-partitioned, revisioned prefix. Both are
    load-bearing text in documents an implementer is told to trust. D-140 already settles which
    wins — the contract, wherever `01` or `03` disagree — so this decision is not a new choice so
    much as the first time the existing rule had to be applied and written down.
  - **The corroborating evidence is ticket `0039`**, which builds the archive and restates the
    contract's layout verbatim, including the `sha256` content-addressing that makes the write
    naturally idempotent. Two of the three artefacts agreed before this ticket asked.
  - **What forced the question.** `fetchRaw` returns one `{ body, contentType, ext }` and Strava
    needs TWO calls — the activity detail and the streams. A three-object layout would have meant
    widening the adapter contract, `RawArchiveRef`, `NormalizedIngest.raw`, `0036` and `0039`. A
    design session, not a ticket.
  - **How two responses become one object without being modified.** The envelope
    `{"schemaVersion":1,"source":"…","detail":<bytes>,"streams":<bytes|null>}` is built by
    CONCATENATING BUFFERS, never by parsing and re-serialising, so each response appears
    contiguously and unchanged — same whitespace, same key order, same digits. §3.1 rule 2's
    "byte-for-byte, unmodified" holds in the strong sense: an int64 id in the archive is the int64
    id the wire carried, because nothing ever turned it into a number. A malformed response
    therefore produces a malformed envelope, which is correct — the archive holds what arrived,
    and a wrapper that repaired a bad payload would destroy the only evidence of what went wrong.
  - **`"streams": null` is a fact, not an absence.** It distinguishes "we looked and there is no
    trace" from "we never looked", and a replay from the archive needs to tell those apart.
  - **What is lost, stated honestly.** §3.2's Hive partitioning (`date=`, `source=`) made an
    Athena sweep cheap and made "delete everything `source=strava` for this user" one prefix
    delete. The contract's key keeps `<source>` as a path segment, so the deletion posture
    survives; the `date=` partition does not. Nobody has needed it, `02-data-model.md` §8.5 does
    not depend on it, and `0104`'s rebuild drill walks the whole prefix. If an Athena sweep is
    ever wanted, it is a manifest built over the archive, not a re-layout of it.
  - **`03-integrations.md` §3.2 is amended in place** with a pointer here, rather than left to
    contradict the contract for the next reader — D-153's rule that the code or the doc changes,
    never neither.

- **D-195** **`GAP_THRESHOLD_MS` is 30 seconds.** Ticket `0036`.
  - **It had never been given a value.** `docs/contracts/ingestion-contract.md` §2,
    `01-architecture.md` §3 and `src/domain/activity.ts` all name the constant, all describe what
    it protects — the fog renderer must not draw a corridor across a gap, distance must not be
    summed across one — and none of them says how long a gap is. It was carried as a symbol
    through three documents and two rounds of reconciliation without anyone noticing it was
    undecided, because a symbol reads as settled.
  - **30 seconds, from the sample rate.** `05-fog-of-war.md` §2.2 records Strava's `latlng`
    stream as nominally ~1 Hz. Thirty consecutive missing samples is a stop, a tunnel or a
    dropout. It is not a watch throttling under tree cover, which is the false positive that
    matters here.
  - **Why the false positive is the one to avoid.** D-020 makes over-revealing permanent and
    under-revealing recoverable, which normally argues for the conservative choice — but a
    spurious gap is not under-revealing. It is a break drawn into a route that was continuous:
    the *"dotted corridor"* §9.5 warns about, on a favourite route, visible every time the
    operator opens the map. A threshold too long merely delays noticing a real dropout; a
    threshold too short manufactures one.
  - **§9.5 says to measure before tuning** — *"measure it on the user's real first 20 runs before
    touching the constants"* — so this is a defensible starting value and explicitly not a
    finding. It lives as one named, commented constant in `src/adapters/strava/normalize.ts` so
    that changing it later is one line and one re-derivation from the archive (D-101).

- **D-196** **A pure `normalize()` gets its clock from `ref.archivedAt` and its `revision` from
  the adapter-private `job.meta` — never from `Date.now()` and never invented.** Ticket `0036`.
  - **The problem.** `Activity` carries three values a normalizer cannot compute from the
    payload: `ingestedAt`, `SourceRef.fetchedAt` and `revision`. `0036` says *"`revision` is
    taken from `job`, not invented"* and describes `job` as carrying `fetchedAt` — but
    `IngestJob` (D-140, contract §3) carries neither. The instruction was right about the
    principle and wrong about where the values live.
  - **`ingestedAt` and `fetchedAt` both come from `ref.archivedAt`.** The archive PUT happens
    immediately after the fetch and strictly *before* `normalize` runs (`0039`, D-121.2), so
    `archivedAt` is the closest true fetch instant a pure function can observe. `job.enqueuedAt`
    was the alternative and is wrong: it is the moment the job was *queued*, before anything was
    fetched, and it understates by however long the queue was backed up. Adding a real
    `fetchedAt` to `RawArchiveRef` would be more precise and would change the domain contract,
    `0035` and `0039` for a distinction measured in milliseconds — rejected as not worth it, and
    recorded here so it is a considered rejection rather than an oversight.
  - **`revision` goes in `StravaIngestMeta`, not on `IngestJob`.** Only the re-ingest path has
    anything to say about it. A field on the generic job type would put one adapter's concern
    into the shape every adapter's queue messages share — the D-100 boundary moving into the
    queue, which is the failure `check-boundaries.mjs` exists to catch and could not catch here,
    because the word would be innocent. This is the same call `hasGpsHint` already gets. Absent
    means 1: a first ingest genuinely is revision 1, and throwing would make every `create` job
    carry a constant.
  - **Why this is worth a decision at all.** The rebuild drill (`02-data-model.md` §8.3 step 2)
    replays the S3 archive years later with Strava unreachable and asserts the same cell count
    and the same Total XP come back. Every one of these three values is a place a wall clock
    would slip in and quietly make the drill impossible — and the drill is what proves D-101's
    reversibility is real rather than claimed. The T4 harness traps the clock at runtime;
    `normalize.test.ts` additionally walks the module's import graph statically, because a trap
    only catches the branch the fixture took.

- **D-197** **The trace outlier gate is 12.5 m/s on foot, PER-`ActivityKind`, as a data table —
  and rejection counts are recorded as provenance rather than logged.** Ticket `0037`.
  - **§2.2's 8 m/s was measured against real traces and found too tight.** `05-fog-of-war.md`
    §9.5 instructs *"measure it on the user's real first 20 runs before touching the
    constants"*; eight runs and 21,225 fixes settled it. At 8 m/s the gate rejected six fixes —
    implied speeds 8, 8, 9, 9, 9 and 13 m/s — and **caught zero GPS jumps.** The failure §2.2
    exists to prevent ("points that jump hundreds of metres") is ~200 m/s at the observed
    ~0.5 Hz cadence, and it did not occur once in the data. Meanwhile the operator's fastest
    ACCEPTED fix was 7.6 m/s, so "comfortably above any human running pace" was a 5% margin.
  - **The cost of the tight gate was not neutral.** Every rejection also writes a `gaps` entry
    (D-198), so 8 m/s was manufacturing six breaks in traces that were continuous — which is
    precisely the *"dotted corridor"* §9.5 warns about, on the routes the operator runs most.
    A gate that discards real fixes is not the safe direction; it is a different harm.
  - **12.5 m/s (45 km/h) splits the observed data along §2.2's own reasoning.** That section
    appeals to what a human can run; the men's 100 m world record peaks at ~12.4 m/s. 12.5
    admits all five plausible bursts and still rejects the 13 m/s fix, which nobody has ever
    run. It leaves a 64% margin over this operator's observed maximum, against 5%, and remains
    an order of magnitude below any real jump.
  - **§2.2 specified one number and only for one kind** — *"~8 m/s for a run
    (~29 km/h — comfortably above any human running pace, below GPS jump magnitudes)"* — and said
    nothing about anything else. That reads complete until you check what else reaches the
    sanitizer.
  - **The silence about other kinds was load-bearing, and rides do reach it.** `rules/xp-rules-v1.yaml` has two enabled rows
    matching `kinds: [ride]`. §2.6's table calls `Ride` *(ignored)*, but that column is about
    ingest policy and the YAML is the thing that actually decides — D-141 means the rules file
    wins, and it says rides count. A cyclist holds 8 m/s (29 km/h) without trying, so a single
    gate set for a person on foot destroys five fixes out of six on an ordinary descent.
    Measured, not argued: `sanitize.test.ts` asserts exactly that, so the cost of the
    alternative is a test rather than a claim.
  - **A data table, not a `switch`** (D-031/D-141). Adding a kind is a row, and a missing row is
    caught by a test rather than silently becoming `x > undefined`, which is `false` — a missing
    gate would accept everything.
  - **What the gate is not.** It is not a classifier: it never touches `Activity.kind`, and a run
    containing walk breaks stays one run, because walking is *slower* and the gate only fires on
    impossibly fast. It is also not a speed limit — the two populations it separates are three
    orders of magnitude apart (a real GPS jump is ~200 m/s at this trace's measured cadence), so
    its exact value matters far less than its existence.
  - **"Log rejection counts" became "record" them, on `SourceRef.meta`.** `normalize()` is pure
    (D-196) and cannot log; a `console.log` there would be the first side effect on the migration
    seam. `meta` is already typed `Record<string, string | number | boolean>` and already called
    provenance by the contract. Two things come free that a log line would not have given: the
    count is durable, so "a sudden rise" is a query over stored activities rather than a
    CloudWatch search that ages out, and it survives a replay from the archive. Omitted entirely
    rather than set to `0` when nothing was rejected — an absent key means "nothing to say",
    where a `0` on a treadmill run would claim a clean trace that never existed.

- **D-198** **`Trace.gaps` marks anything a corridor must not be drawn across — a time gap OR a
  sanitation break — and there is no second field.** Ticket `0037`. Amends
  `contracts/ingestion-contract.md` §2, `01-architecture.md` §3 and `src/domain/activity.ts`.
  - **The contract defined `gaps` too narrowly to hold what §2.2 requires.** It said
    *"[startIdx, endIdx] pairs marking gaps > GAP_THRESHOLD_MS"*, which is a statement about
    TIME. §2.2 separately requires the sanitizer to *"break the trace into segments"* when an
    implausible fix is dropped — and a fix dropped between two 2-second samples produces a break
    that crosses no time threshold at all. Under the original wording that break had **nowhere
    to be recorded**, so the renderer would have drawn straight through it.
  - **One field, not two.** `Trace.breaks` alongside `gaps` was the alternative and is cleaner to
    describe, but both fields answer exactly one question — *may a corridor be drawn across
    this?* — and every consumer would have to honour both. The fog renderer forgetting one, or
    the distance summer forgetting the other, writes a permanent scar onto a map that never
    re-fogs (D-020). A single field cannot be half-honoured.
  - **Indices are into the SANITIZED `points` array.** Indices into the original stream would
    point at fixes nothing downstream ever holds.
  - **Sanitation runs before anything is measured.** `gaps`, `bbox` and `pointCount` all describe
    the trace that will be projected to H3, so measuring the unsanitized array would put a
    rejected fix inside the bounding box and report a count nothing ever sees. `simplified` is
    the deliberate exception — it is a claim about what the SOURCE sent, so it is measured
    against the original length; conflating the two would make every sanitized trace look
    decimated.
  - **Why the doc changed rather than the code** (D-153). The narrow definition was written
    before any sanitizer existed, in a document that in the same section asks for segments. It
    was not a decision that sanitation breaks should be invisible; it was a definition that had
    never met the requirement standing four paragraphs away from it.

- **D-199** **Real fixtures, synthetic geometry: a committed fixture carries the provider's
  response SHAPE and never its coordinates.** Ticket `0168`. Enforces
  `08-security-privacy.md` §7.2; amends ticket `0038`. Standing rule for **every** adapter,
  not a Strava exception.
  - **The rule was never missing — it was unenforced.** §7.2 already reads *"Real GPS traces,
    GPX/FIT fixtures from actual runs, or a dump of `ExploredCell`"* must never be committed,
    and *"Test fixtures are **synthetic coordinates**"*, and it even names how it breaks:
    *"this is the repo-hygiene rule most likely to be broken by someone being helpful."*
    Ticket `0038` then instructed precisely that — capture real responses *"redacted of
    tokens, **not of shape**"*, ~2,700 `latlng` points each — into a public repository. Two
    documents, one flat contradiction, and nothing that could run. **A rule nobody can execute
    is a sentence in a document.** `0168` was filed as "08 is missing a line"; it was not.
    The doc was right and the ticket was wrong, which is the reverse of the usual finding and
    worth recording as such.
  - **What "synthetic geometry" means precisely**, because "make up a fixture" is how the
    project ends up asserting its own design docs back at itself (`0165`: 76 green tests built
    from `03-integrations.md`'s worked example, while the live service refused every grant).
    Capture the **real** response. Keep every non-geometric field exactly as it arrived —
    the field set, the stream keys, the point **count**, the 1 Hz cadence, index alignment
    across streams, `original_size`, the gap and signal-loss structure, the int64 ids. Replace
    **only** the coordinates, generated along a synthetic path near Point Nemo. The fixture
    stays a real captured response in every respect the code can observe.
  - **Rejected: capture real, then relocate and rotate as a rigid body.** `0168`'s own Notes
    preferred this and it is the higher-fidelity option — but a rigid transform preserves the
    **route shape**, and a route shape is matchable against OpenStreetMap. A distinctive loop
    moved to the South Pacific is still a description of the streets the operator runs on.
    It also required amending §7.2, and amending a settled security rule to make a ticket
    easier is the thing the working agreement forbids.
  - **Point Nemo (`-48.876, -123.393`), and the guard is an ALLOWLIST.** The obvious check —
    "no coordinate near where the operator runs" — is unwritable: expressing it requires
    committing where the operator runs, which is the leak, written into the repo in order to
    prevent the leak. Inverting it costs nothing and fails **closed** on any geometry it has
    never seen, including an adapter that does not exist yet.
  - **`scripts/check-fixture-geography.mjs` runs on three surfaces**, and the pre-commit hook
    is the one that matters: it is the last point upstream of an irreversible act. A leaked
    credential is revoked in an afternoon; a leaked home address in a public repo's history is
    permanent, and **gitleaks does not know what a latitude is** — a real GPS track trips none
    of §7.3's credential patterns, because it is just numbers.
  - **It covers every coordinate carrier, not the one the first version checked.** The guard
    began life inside `normalize.test.ts` looking at `streams.latlng.data` alone, so a fixture
    could have passed it while publishing the operator's front door twice over in
    `detail.start_latlng` / `end_latlng`, and a third time as an encoded `summary_polyline`.
    An encoded polyline is not less of a location for being unreadable to a human.
  - **An undecodable polyline string fails CLOSED**, which caught a real fixture on the check's
    first run: `run-continuous.json` carried the placeholder `"omitted"`. Not a leak, but
    nothing in the scanner can prove that, and *"I could not read it"* must never resolve to
    *"clean"* (D-176). The fixture was given genuine encoded synthetic geometry instead, which
    also made it a more faithful copy of what Strava actually returns.

- **D-200** **The fidelity floor is a SAMPLING RATE — `0.3` points/second as a median
  interval — not points-per-km, and an absent `time` stream fails it outright.** Ticket
  `0038`. Amends `contracts/ingestion-contract.md` §5 check 5 (canonical) and
  `03-integrations.md` §2.5.
  - **The specified metric could not separate the two populations, and the number that
    justified it was wrong.** `0038` reasoned: *"At 1 Hz a 6 min/km run gives ~360
    points/km; `summary_polyline` would give ~10-30. Set the floor well below the former
    and far above the latter."* Measured against real captured responses from the connected
    account rather than estimated:

    | | points/km | points/second |
    |---|---|---|
    | real full streams (87 runs, 2 rides, 12 walks) | 182 – 684 | 0.94 – 0.99 |
    | real `summary_polyline` | **20 – 49** | 0.047 – 0.110 |
    | real `map.polyline` | 37 – 56 | — |

    The decimated figure is more than twice the assumed one, and it is wrong in the unsafe
    direction — a floor set "far above 30" would have passed a real `summary_polyline`.
  - **Points-per-km is a function of speed; a sampling rate is not.** At 1 Hz, 100
    points/km is exactly 36 km/h, so a floor placed in the 49–182 gap refuses a fast
    descent as though it were corrupt. `xp-rules-v1.yaml` already carries `kinds: [ride]`
    (D-197), so that is a supported activity and not a hypothetical. The rate separates the
    same two populations by 9–21×, with 0.3 sitting ~3× from each side.
  - **The MEDIAN interval, not the mean.** The mean is `duration / points`, which any pause
    destroys: a 20-minute run, a two-hour stop, 20 minutes more is a full-resolution 1 Hz
    trace whose mean rate is under the floor. A mean would refuse to ingest a real run
    because the operator stopped for lunch. A gap moves a few intervals to the end of a
    sorted list and leaves the median alone. Every gap this system already models (D-198)
    has that shape.
  - **An absent `time` stream is itself the failure, and this is half the check.**
    `buildTrace` derives each timestamp as `startedAt + (offsetS ?? i) * 1000` — with no
    `time` stream it counts off the ARRAY INDEX and fabricates a flawless 1 Hz cadence. A
    trace decoded from a `summary_polyline` has no time stream, so it would have arrived
    with perfectly spaced synthetic timestamps and cleared the rate floor comfortably: the
    check reporting "clean" for precisely the input it exists to reject. Found while
    writing the test, not while writing the check.
  - **It throws.** `0038`: *"a loud failure, not a warning: by D-020 a bad reveal cannot be
    un-drawn."* Refusing one activity costs a re-run; ingesting a decimated one costs the
    map, permanently.
  - **It supersedes `Trace.simplified` for traces below the floor.** `simplified` was the
    earlier, weaker answer to D-121 — mark the trace and let something downstream decide —
    and nothing downstream ever did. The flag keeps its job for a trace that is decimated
    but still dense enough to draw; below the floor, refusing is the only safe answer.
    `normalize.test.ts` now asserts both halves against two separate fixtures.

- **D-201** **A fix earns the sanitation anchor by being corroborated: one plausible step.**
  Ticket `0172`. Amends `03-integrations.md` §2.2.
  - **§2.2 specified the filter and never said where it starts.** "Reject a point whose
    implied speed from the previous **accepted** point exceeds the gate" presumes the last
    accepted point is real, and at index 0 that presumption has no evidence behind it —
    `p0` is accepted because it is first, not because anything corroborated it. `0037`
    implemented the literal reading and recorded the consequence in a test rather than
    quietly improving it, which is why there was an assertion to invert here.
  - **The rule.** `p0 -> p1` plausible → start at `p0` (the ordinary trace; the only branch
    a clean stream ever takes). Implausible, but `p1 -> p2` plausible → `p1` is corroborated
    and `p0` is not, so `p0` is the outlier: discard it and start at `p1`. Neither plausible
    → nothing is corroborated and the evidence does not name a culprit, so fall back to §2.2
    as written. **Guessing in the third branch would trade a known behaviour for an
    arbitrary one.**
  - **Lookahead depth 1, and raising it is not free.** A deeper lookahead buys robustness
    against several consecutive bad fixes and pays by being able to discard a genuine start
    — a run that legitimately begins with a sprint out of a doorway looks, from far enough
    away, like a lead-in of noise. Depth 1 can discard at most the FIRST fix, bounding the
    cost of being wrong at exactly one point: the same fix the unpatched algorithm would
    have kept and built a whole wrong trace on.
  - **Rejected: re-anchor after N consecutive rejections.** Needs a magic N, and would
    re-anchor inside a genuine long tunnel — the one place the trace must *not* be stitched
    back together, because a corridor drawn across a dropout reveals ground that may not
    have been run.
  - **Rejected: median of the first k fixes.** More robust, and it can **move the recorded
    start of the run** — which is a worse failure than the one it fixes, since the start
    point is where the operator's front door is.
  - **The damage it repairs, measured rather than asserted.** A 400 m cold fix against a
    12.5 m/s gate rejects the first ~32 seconds of a trace (400 / 12.5), and takes the
    *entire* trace when the trace is shorter than that — the ticket's 10-point reproduction
    is the short case. Sweeping 53 real activities found exactly **one** bad first fix in
    six years (`19831578054`: 12.7 m/s at index 1), and it is marginal rather than a 400 m
    cold start, so the severe case is real but has not yet occurred on this account.
  - **Fixed in `sanitize.ts`, not per adapter.** Every "compare against the previous
    accepted value" filter has this weakness at its boundary, so D-112 (GPSLogger) and
    D-113 (Health Connect) inherit it the moment they share this file.
  - **No `break` is recorded for a discarded lead-in.** `breaks` marks ground a corridor
    must not be drawn ACROSS (D-198), and nothing precedes the first accepted fix — the
    same reasoning that leaves a run of rejections at the very end of a trace unmarked.

- **D-202** **The Strava app's Authorization Callback Domain stays the bare parent
  `devaultsecurity.com`. Accepted risk, not a fix — and it has a re-open trigger.**
  Ticket `0163`, operator decision 2026-09-06.
  - **What is actually exposed.** Strava matches the configured domain **or any subdomain of
    it**, so every `*.devaultsecurity.com` host is a legitimate destination for this app's
    authorization codes. Confirmed by probe on 2026-09-04 and again on 2026-09-06:
    `other.devaultsecurity.com/cb` and the bare parent both answer `302`, while
    `notsoles.devaultsecurity.com.evil.example` and `attacker.example` answer `400` — Strava
    handles suffix confusion correctly, so the exposure is exactly the sibling set and
    nothing wider.
  - **Why it was not fixed.** The Authorization Callback Domain field **is not present on
    the current `https://www.strava.com/settings/api` page** for this app (client id
    `276053`), verified by the operator while logged in. The ticket assumed a one-field
    edit; there is no field. This is a finding about the ticket, not an obstacle routed
    around.
  - **Why accepting is defensible, measured rather than asserted.** Reaching the codes
    requires an attacker to *receive* a redirect at some `*.devaultsecurity.com` host, which
    requires either content control on an existing sibling or a DNS record for a new one —
    and the operator controls the zone. Checked on 2026-09-06:

    | | |
    |---|---|
    | Live siblings | `www`, `github`, `linkedin`, `mastodon`, `twitter`, `ctf` — six, all S3-hosted static sites |
    | Anonymous write to any of them | **403 on all six** — no attacker-writable sibling |
    | Dangling DNS / claimable bucket | none — every subdomain's bucket exists in account `286588821906` |
    | Names with no DNS (e.g. `other.`) | unusable by an attacker; they would need the zone |

    Add the two mitigations already in place — `0032`'s start route builds `redirect_uri`
    from `APP_ORIGIN` and **never** from the request, so the app cannot be induced to emit a
    crafted one, and the flow is state-checked via `LostSolesOAuthState` — and the residual
    path is a hand-built authorize URL the operator personally follows to a host the
    attacker would already have had to compromise.
  - **THE RE-OPEN TRIGGER, in the shape 08 §2.4 uses for D-123.** This risk is **not
    static**; it is low only because of the table above. Re-open `0163` and narrow the
    domain — by whatever mechanism Strava then offers, including recreating the app — if
    **any** of these fire:
    1. **A new host is deployed under `*.devaultsecurity.com`** that serves content this
       operator does not fully control (a third-party page builder, a CI preview domain, a
       hosted status page, anything with user-supplied content).
    2. **Any sibling bucket becomes writable** by a principal outside the account, or a
       subdomain's DNS is left pointing at a resource that no longer exists — a dangling
       record is a claimable bucket and turns this from theoretical into live.
    3. **A second user is provisioned** (08 §2.4 TRIGGER A already gates this), because the
       blast radius stops being one person's location history.
    4. **The Strava app is ever recreated or the field reappears** — then it costs nothing,
       and "it was free" is reason enough.
  - **What was NOT accepted.** Nothing about the app's code changed and nothing should: the
    `[source]` routes, the `APP_ORIGIN`-derived redirect URI and the state check all stay as
    they are. This decision is scoped to one field on a third-party settings page.

- **D-203** **`01-architecture.md`'s pre-implementation route path and adapter module tree are
  corrected to what was built, because in both cases the code is the more D-100-conformant of the
  two readings.** The `05-strava-adapter` drift audit, 2026-09-06 (divergences 3 and 4 of four).
  - **One shape, two symptoms.** `01-architecture.md` was written before any code existed and
    guessed at structure in two places. The build settled both differently, and settled them
    *better* — each guess had quietly named a vendor or a file where the boundary did not need
    one. Recorded as one decision because the amendment is one amendment; recorded as **two**
    divergences in the audit because they are two places a reader is misled, and the `04` audit's
    refusal to fold divergences to buy a passing budget applies here too.
  - **The callback route.** This document (§2's component diagram, §7's secrets table and IAM
    grant, §7's "what never reaches the client"), `08-security-privacy.md` §3, and
    `capabilities/02-deploy-and-auth.md` all read **`/api/strava/callback`**. The built route is
    **`app/api/auth/[source]/callback`**, and the parameterization is the point: no route in the
    tree carries a vendor name, so adding GPSLogger (D-112) or Health Connect (D-113) adds a
    registry entry and not a route. `03-integrations.md` §2.2's authorize URL and D-202 already
    used the built path — three documents disagreed with two, and the two were right.
  - **`strava/types.ts`.** §3's module tree promised *"`types.ts` — Strava's wire shapes. NOTHING
    outside this directory imports it"*. No such file exists. The adapter instead declares
    **deliberately partial** interfaces at each point of use, because a file declaring the
    vendor's whole schema must be edited every time Strava adds a field, and `adapter.ts`'s
    `StravaSummaryActivity` and `normalize.ts`'s detail/stream shapes want different subsets.
  - **The rule the deleted file was carrying survives intact, and is now stated where it belongs.**
    "Nothing outside `src/adapters/strava/` may import a Strava-shaped type" is D-100; it never
    depended on the types living in one file. It is enforced by `scripts/check-boundaries.mjs`
    (clean) and `scripts/check-adapter-deletion.mjs`, and ticket `0156` measured it: deleting the
    adapter stubs **19 modules and breaks exactly one file**, `registry.ts`. A layout convention
    was mistaken for the invariant; the invariant is a CI check.
  - **What this decision does NOT do.** It changes no code and supersedes no settled decision. It
    is the `design-was-wrong` half of D-153's rule — *if the code diverged from the design, either
    the code changes or the doc changes, never neither* — applied twice to the same document.

- **D-204** **`fetchRaw` returns a `schemaHint` alongside `contentType` and `ext`, and all three
  are declared by the adapter rather than inferred from the bytes.** Ticket `0039`, 2026-09-06.
  - **The gap.** `01-architecture.md` §3 has always required archived object metadata to carry
    `adapter`, `externalId`, `userId`, **`schemaHint`** and the app version, so that "a backfill
    five years from now can identify what it is looking at without a database". `schemaHint`
    existed in that sentence and nowhere else — not in `contracts/ingestion-contract.md` §3, not
    in `src/adapters/types.ts`, not in the Strava adapter. The first ticket that had to write the
    metadata is the first ticket that noticed.
  - **On the return, not on the adapter.** `readonly schemaHint` beside `readonly id` was the
    smaller change and is wrong: an adapter may archive more than one payload shape. A file-upload
    source (D-101, the Strava bulk export path) archives a GPX for one job and a FIT for the next,
    and a single static field would have to lie about one of them — in the metadata that exists
    precisely to stop a future reader from guessing.
  - **It names the ARCHIVE's shape, not the vendor's.** `"strava/raw-envelope@1"` describes the
    envelope `raw-envelope.ts` seals — two responses concatenated inside a wrapper this repo
    invented (ticket `0035`) — not Strava's API version. A change in what the adapter archives
    bumps it; a change in what Strava returns does not. It is derived from the envelope's own
    `SCHEMA_VERSION` so the two cannot drift, because a hint reading `@1` over version-2 bytes is
    worse than no hint at all.
  - **Declared, never sniffed, and that is the load-bearing half.** The archive must not look at
    the bytes for any reason (§3.1 rule 2). Content-type sniffing is the plausible convenience
    that breaks it, and the case where sniffing and declaring disagree is exactly the payload that
    arrived malformed — the one whose archived description must be a faithful record of what the
    source *claimed*, not a guess about what it sent.
  - **Contract amended, not worked around.** D-140 makes `contracts/ingestion-contract.md` §3 win
    over `01`/`03`, so a field `01` requires and the contract omits is a defect in the contract.
    §3 now carries it, and `src/adapters/types.ts` transcribes it.

- **D-205** **I-3's "overwrite" is enforced by making an overwrite non-destructive, not by
  refusing one — S3 versioning plus a `DeleteObjectVersion` deny, with a conditional PUT as the
  second mechanism.** Ticket `0039`, 2026-09-06.
  - **Why the literal reading is unbuildable.** `02-data-model.md` I-3 asks for a bucket policy
    that denies "`s3:DeleteObject`/**overwrite**" on `raw/*`. There is no IAM condition key that
    distinguishes a PUT onto an existing key from the first PUT of a new one, so any policy able
    to refuse the second would refuse the first — the archive could never write anything. This is
    not a gap in AWS to route around; it is a property of how S3 authorises writes.
  - **What was built instead, in two independent layers.** (1) **Structural**: versioning is on
    (`amplify/storage/resource.ts`) and the bucket policy denies **both** `s3:DeleteObject` and
    `s3:DeleteObjectVersion`. An overwrite can therefore only *add* a version; the original bytes
    remain readable and cannot be removed by any principal but the break-glass role. This half
    holds against code that never runs ours. (2) **At the writer**: `archiveRaw` PUTs with
    `IfNoneMatch: "*"` and treats the resulting 412 as success, so the common case — an SQS
    redelivery of the same activity — leaves exactly one object with exactly one version.
  - **`DeleteObjectVersion` is the one that is easy to omit,** and omitting it would have made
    versioning decorative: on a versioned bucket `DeleteObject` writes a delete marker and hides
    the object, while `DeleteObjectVersion` destroys bytes. A policy denying only the first reads
    as protection and prevents nothing permanent.
  - **Why not Object Lock,** which would give genuine write-once semantics: `01-architecture.md`
    §3 already ruled it out at this scale, and enabling it requires recreating the bucket — which
    on the one artifact no rebuild can reproduce is a larger risk than the one being closed.
  - **The archive was also actively deletable before this,** which is the finding that made the
    ticket bigger than its title. The deployed bucket had versioning **off** and CDK's
    auto-delete-objects custom resource armed, so an `ampx` teardown would have emptied `raw/`
    under a live role holding `s3:DeleteObject*` bucket-wide. `keepOnDelete: true` retires both.
    The accepted cost is that a torn-down stack now leaves the bucket behind — the same trade
    `LostSolesSourceAccount` records, in the same direction.
  - **I-3 is not amended.** Its intent — `raw/` objects cannot be destroyed except by the deletion
    role — is fully met. Only the mechanism differs from the one its `[S]` column names, and this
    decision is what the column should be read against.

- **D-206** **`attempts` is incremented by its own write, outside the score gate's conditional
  update, so that it counts DELIVERIES and not successful claims.** Ticket `0040`, 2026-09-06.
  - **The contradiction.** `02-data-model.md` T8 specifies `attempts` as "`ADD 1` per delivery;
    ≥ 4 means the DLQ has it", and specifies the score gate as an `UpdateItem` carrying a
    `ConditionExpression` on `status`. Those cannot both be satisfied by one write: **a DynamoDB
    conditional update whose condition fails writes nothing at all**, including its `ADD`. Fold
    the increment into the gate and the delivery that loses the race — precisely the redelivery
    worth counting — leaves no trace. `attempts` would silently become "successful claims", and
    the sentence about the DLQ would be false in the one situation it exists to describe.
  - **What was built.** `recordDelivery` is a separate `UpdateItem`, issued before the claim and
    conditional only on `attribute_exists(ingestKey)`. The claim keeps its status condition
    untouched. Two writes per message, ~800 a year at this volume, comfortably inside the free
    tier — and in exchange `attempts` means what T8 says, and `0044` has a real signal to alarm on
    rather than a number that undercounts exactly when something is going wrong.
  - **Why not increment on the failure path instead** (one write on the happy path, two on a
    duplicate): it puts the counter on an error path, where a second failure loses the count with
    nothing to notice it. The counter exists to make trouble visible; siting it where trouble
    already is makes it least reliable when it matters most.
  - **The `attribute_exists` guard is not defensive dressing.** `UpdateItem` UPSERTS. An unguarded
    `ADD attempts :one` would CREATE a receipt for a job that never passed the accept gate — a
    phantom row in the table whose entire purpose is recording what was accepted. On a correct
    path this cannot happen (`0043` accepts before it enqueues, and SQS's 14-day retention is far
    inside the 90-day TTL), so it throws rather than being tolerated.
  - **T8 is not amended.** Its intent — a per-delivery counter whose value distinguishes a first
    attempt from one about to be dead-lettered — is met exactly. Only the write layout differs
    from what a single-`UpdateItem` reading of the row implies, and this decision is what that
    row should be read against.

- **D-207** **The ingest pipeline writes `Activity` rows as raw DynamoDB items and is therefore
  responsible for Amplify's own item conventions — `__typename`, `owner`, `createdAt`,
  `updatedAt`.** Ticket `0041`, 2026-09-06.
  - **The coupling no document states.** `02-data-model.md` §2.1 makes `Activity` one of the five
    `defineData` models, so its table is created and read through AppSync. `01-architecture.md` §4
    step 15 has the worker write it with `TransactWriteItems`, alongside the `IngestReceipt`
    transition. Both are right and neither mentions the consequence: **an AppSync mutation cannot
    take part in a DynamoDB transaction**, so the write must be raw — and a raw write bypasses the
    resolver that would normally add Amplify's bookkeeping fields.
  - **Why it cannot be avoided by writing through AppSync instead.** That would split the
    `Activity` put from the receipt's DONE transition, which is exactly the window T8 layer 3
    exists to close: *"XP and the receipt commit or fail together."* A crash between two calls
    leaves a scored activity whose receipt still reads `PROCESSING`, the next delivery reclaims it
    as stale, and the run is scored twice on a ledger that can only add (D-135). The atomicity is
    worth more than the decoupling.
  - **Why not make `Activity` a CDK table** and own the shape outright: §2.1 reason 3 answers it —
    hand-rolling resolvers for a client-facing model is "a large, permanent tax paid to optimise a
    bottleneck that does not exist". `Activity` is read by the app on every screen; `SourceAccount`
    and `IngestReceipt` are not, which is why those three are CDK and this one is not.
  - **The failure it prevents is silent, which is the reason it is a decision and not a detail.**
    A row missing `__typename` comes back from AppSync with a null type and the generated client
    discards it; a row missing the non-null `createdAt`/`updatedAt` fails field resolution on read.
    Either way the row is present in DynamoDB and **invisible in the app, with nothing erroring** —
    the worst available failure, and one no amount of DynamoDB-side inspection would explain.
  - **`createdAt`/`updatedAt` come from `activity.ingestedAt`, not from the clock.** The ticket
    asks that re-persisting the same activity write identical bytes; a `new Date()` in the item
    builder makes that impossible to assert honestly, and "identical apart from the two fields that
    always differ" is not the property worth having. `activityItem` is therefore a pure function of
    the activity, and the byte comparison is a real test rather than a hope.
  - **What keeps it honest.** The field set is pinned by a unit test and, at close, was verified by
    writing a row through the real table and reading it back — because the shape is Amplify's to
    define and could change under a version bump. If Gen 2 ever adds a required bookkeeping field,
    this is the module that has to learn about it.

- **D-208** **`IngestJob` carries `startedAt` — the activity's own start date, not the job's.**
  *(Ticket `0043`. Amends `contracts/ingestion-contract.md` §3, which ticket `0026` settled, and
  reopens the exact key set `src/adapters/adapter-interface.types.test.ts` guards.)*
  - **The gap.** `lib/sources/list-since-watermark.ts` is written entirely in terms of activity
    start dates: `nextListSinceWatermark` takes `confirmed` and `unconfirmed` as ISO start dates,
    and its crash-recovery rule pins the watermark **below the oldest activity that was listed and
    not enqueued**. Both of its callers — the manual Sync (`0043`) and the scheduled sweep
    (`0095`) — are generic. Neither could obtain a start date, because `IngestJob` had none.
  - **Where it was instead.** The Strava adapter put `startedAt` in `meta`, with the comment *"THE
    WATERMARK BOUNDARY — the consumer needs it to work out how far it got, and it is on the job
    because the job is the only thing that survives the trip through the queue."* The intent was
    exactly right and the location was exactly wrong: the contract types `meta` as `unknown`
    specifically so that nothing generic reaches into it, so the consumer it was placed there for
    is the one caller forbidden to read it.
  - **Why it is not a vendor concept smuggled in.** Every source has "when did this activity
    happen". The domain's `Activity` already carries `startedAt`, and a reconciliation watermark is
    meaningless without one — the field is what the rule was always *about*. Contrast the three
    that stayed in `meta`: `aspectType` is one provider's webhook vocabulary, `hasGpsHint` is an
    inference from one provider's list response, and `sportType` is one provider's taxonomy. None
    of those has a generic reader; this one has two.
  - **Why not read `meta.startedAt` structurally instead.** It would have worked today and cost
    nothing, and it is the option that quietly ends the boundary. `check-boundaries.mjs` cannot
    catch it — `startedAt` is an innocent word — so the rule "every adapter must name this field
    identically inside an opaque blob" would be enforced by nothing at all. D-100 survives because
    the things it forbids are refused by a build, not by a convention.
  - **Why not use `enqueuedAt` as a proxy.** It is correct in the success case and silently wrong
    in the one that matters: on a sweep that dies halfway, every job carries roughly the same
    `enqueuedAt`, so the boundary would land at *now − overlap* instead of below the oldest
    un-enqueued activity. That is the permanent-data-loss case
    `list-since-watermark.ts`'s header describes, on a map that by D-020 never re-fogs.
  - **What keeps it honest.** The exact-key-set guard was not deleted, it was amended in place with
    the reasoning attached, so `aspectType` and `ownerId` still stop the build. `startedAt` was
    removed from `StravaIngestMeta` in the same change rather than left in both places — one field,
    one writer, and no way for the two to disagree.

- **D-209** **A `FAILED` receipt is reclaimable at the score gate. `maxReceiveCount` bounds
  retries; the receipt does not.**
  *(Ticket `0044`. Supersedes the reasoning ticket `0040` attached to `markFailed` — that
  `claimForScoring` matches `PROCESSING` only, so "a recorded failure is a decision and should be
  visible rather than quietly retried forever". The visibility half stands and is now
  `recordFailure`. The lock half is withdrawn.)*
  - **What was wrong with it.** A `FAILED` receipt that no delivery may claim makes a **DLQ redrive
    a silent no-op** — and the redrive is the operator's entire documented recovery path
    (`01-architecture.md` §4, and this ticket's own scope note: *"the operator's recovery path at
    this milestone is 'redrive the DLQ message from the SQS console'"*). The redriven message
    resolves credentials, fetches, archives, normalizes, loses the claim to the very `FAILED`
    status it was sent back to repair, throws, and returns to the DLQ looking exactly like the
    original failure. The one control the operator has would report success and change nothing.
  - **Why "retried forever" was never what the exclusion prevented.** This table has never bounded
    retries and `ingest-receipt.ts` says so in the same paragraph: *"The SQS redrive policy, not
    this table, is what governs retries."* `maxReceiveCount: 3` is unchanged, so a receipt
    reclaimed from `FAILED` gets whatever deliveries the queue still owes it and no more. What the
    exclusion actually bounded was the operator's ability to intervene at all.
  - **The `REMOVE` is the clearing step, and it is on the claim rather than on success.** A claim
    wipes `failedUserId`, `failedAt`, `errorClass` and `rawArchived` together, which drops the row
    out of the sparse `failedByUser` index. So the Sync line stops reporting a failure the moment a
    retry is genuinely underway and reports it again if `recordFailure` writes the fields back.
    Clearing on success instead would leave the report standing through the whole retry, which is
    the state the operator is least able to interpret: broken, or being fixed?
  - **`DONE` is still not reclaimable, and that is the line that matters.** It is the one status
    written inside the ingest transaction alongside the XP award (T8 layer 3), so reclaiming it
    would reopen the double-award window the whole receipt exists to close. `recordFailure` is
    guarded `<> DONE` for the same reason from the other direction.
  - **What keeps it honest.** The condition and the `REMOVE` list are both asserted in
    `src/pipeline/ingest-receipt.test.ts`, including that `:done` never enters the claim's
    condition. Layer 4 — the explored set is a set — remains the backstop that makes any reclaim
    safe regardless.

- **D-210** **Terminal ingest failures are dead credentials, plus anything that fails on the last
  delivery the queue allows. Nothing else writes `FAILED`.**
  *(Ticket `0044`. The decision ticket `0042` deliberately left open: *"it has to decide
  deliberately WHICH failures are terminal rather than marking all of them."*)*
  - **Two ways in, and only two.** `SourceNeedsReauthError` and `SourceNotConnectedError` are
    terminal on the first delivery because no retry can repair them — a human has to
    re-authorize — and waiting three deliveries to say so costs up to ~48 minutes of visibility
    timeouts during which the screen says nothing is wrong. Everything else becomes terminal only
    on receive number `maxReceiveCount`, because that message is about to reach the DLQ and a
    failure nobody records on its way there is the silence this ticket exists to end.
  - **Why not mark every failure.** The Sync line would report a failure the queue is about to
    retry successfully — true for ninety seconds and then a lie, on the one surface the operator
    has for knowing whether their data arrived.
  - **Why not mark only on the last delivery.** It is simpler and it delays criterion 5: a revoked
    authorization is the one failure the settings screen can actually repair, and it should say so
    the first time it is known rather than three deliveries later.
  - **`ReceiptNotClaimableError` is never terminal, and this one is a correctness point rather
    than a preference.** It means another invocation holds a live `PROCESSING` claim.
    `recordFailure` is guarded `<> DONE`, so marking here would stamp `FAILED` over a working
    import and report it broken to the operator while it succeeded behind them.
  - **The delivery count comes from SQS, not from the receipt.** `attempts` only ever increases, so
    a redriven message arrives with `attempts` already at 3 and would be judged terminal before it
    had tried anything — defeating D-209. `ApproximateReceiveCount` resets on a redrive, because
    the move re-sends the message, so it answers the question actually being asked: how many
    chances are left for *this* attempt at recovery.
  - **What keeps it honest.** `MAX_RECEIVE_COUNT` is restated in the handler because a bundled
    Lambda cannot import a CDK construct; `process-activity-stack.test.ts` asserts the two numbers
    agree, the same guard `PROCESSING_STALE_MS` carries against the Lambda timeout.

- **D-211** **The cross-source natural key is a coarse start-time ANCHOR plus a tolerance
  comparison, not a hash of rounded components.**
  *(Ticket `0169`. Rewrites `03-integrations.md` §2.7's formula, amends `02-data-model.md` T3,
  GSI2's projection rationale, AP-10 and I-22. §8.3's "never change the `dedupeKey` derivation
  without a full rebuild" applies and was honoured — see *the rebuild*, below.)*
  - **The bug.** §2.7 hashed `[userId, floor(start/60), round(distance/50), round(elapsed/30)]`.
    **Those are buckets, not tolerances, and the difference is the bug:** two recordings collide
    only when every component lands in the same bucket, so two that straddle a boundary do not
    collide *however close they are*. 3310 m and 3330 m are 20 m apart and round to 66 and 67.
    The start time was worst — `floor` has no centring, so a two-second disagreement between a
    phone and a watch missed one time in thirty.
  - **Why it is a class of bug and not a tuning problem.** `sha256` destroys locality by design,
    so an exact-match lookup on a hashed composite can only ever ask *"same bucket?"* and never
    *"close enough?"*. No choice of bucket size fixes that; it only moves the boundary.
  - **The second finding, which is why the obvious fix was rejected.** `0169` proposed probing the
    adjacent buckets, which would have left the stored derivation alone and avoided a rebuild.
    It is not enough: two devices disagree on distance *proportionally*, and 3% of a 10 km run is
    300 m — six buckets of 50 m. Probing ±1 would still have split a long run. **The buckets were
    too fine as well as misaligned**, and that only became visible once the boundary case was
    being reasoned about properly.
  - **What the components actually do.** Start times agree to within a few minutes (both clocks
    are NTP-synced; the spread is how long the user takes to start the second device). Distance
    disagrees proportionally. Elapsed disagrees by however long sat between the two start presses.
    So the key anchors on the *only* component that agrees, and the rest are compared with real
    tolerances: ±5 min start, ±5 min elapsed, ±max(100 m, 3%) distance.
  - **Why the anchor is 30 minutes when the tolerance is 5.** The anchor is not trying to
    discriminate — `isSameActivity` does that. Its only job is to keep the candidate set small,
    and at ~400 activities a year a 30-minute window holds one activity or none on almost every
    day. Keeping the tolerance well under *half* the bucket is what bounds the probe to two keys
    and guarantees a duplicate is never two buckets away; a test asserts the relationship rather
    than the two constants separately.
  - **An absent distance abstains rather than vetoes.** It is legitimately absent for treadmill
    runs, strength work and manual entries, and two sources disagree about whether they report it
    at all. Treating a missing value as a disagreement would split exactly the activities with the
    least other evidence to go on.
  - **The kind is deliberately not compared.** Two sources routinely classify one session
    differently — a trail run against a run — and the mapping tables that reconcile that are
    per-source data (D-031/D-141). A kind veto would split duplicates over a disagreement about
    vocabulary, which is the failure this decision removes. Adding one later is a decision with
    its own reasoning, not a condition to append quietly.
  - **It moved out of the adapter, and that was already a violation.** `computeDedupeKey` was
    private to `src/adapters/strava/`, where a second adapter could not reach it and would have
    had to reimplement it. `0169` criterion 3 says it plainly: *"two implementations of a dedupe
    key is worse than a coarse one."* It now lives in `src/domain/dedupe-key.ts` beside
    `computeActivityId`, source-agnostic, for the reason that module records — `activity.ts` is
    types only, so importing an `Activity` type can never drag `node:crypto` into a client bundle.
  - **The rebuild §8.3 demands was ten rows.** Every stored activity predates any real use and is
    smoke-test data; raw is archived under D-101, so a replay is always available. This was the
    cheapest moment this change will ever have, which is the argument `0169` made for doing it now
    rather than when Health Connect lands.
  - **What keeps it honest.** `src/domain/dedupe-key.test.ts` sweeps a whole anchor window rather
    than sampling points, asserting that a duplicate anywhere inside the tolerance is found
    wherever the run starts. **That sweep caught an off-by-one in the first version of the probe**
    — a duplicate stored exactly the tolerance ahead was missed because the edge test was `>`
    rather than `>=`. A sampled test would have passed. The adapter's own test now asserts it uses
    the shared derivation rather than asserting a literal hash, which would have passed equally
    well against a reintroduced private copy.
  - **What this decision does NOT do: none of it is enforced yet.** The lookup that would use any
    of this does not exist — contract §3's step 3 `DEDUPE` is unimplemented and nothing queries
    GSI2. I-22 claimed otherwise and has been corrected. Ticket `0179` is the lookup; until it
    lands, cross-source duplication is prevented only by there being one source.

---

## The fog projection's split rules  (2026-09-07, ticket `0045`)

- **D-212** **`traceToCells` splits on `Trace.gaps` BEFORE anything else, and its teleport
  gate is the ingestion sanitizer's per-kind table by reference — never a restated number.**
  *(Amends `05-fog-of-war.md` §2.2, which is otherwise normative. Discharges the obligation the
  `05-strava-adapter` drift audit placed on this ticket, 2026-09-06, divergence 2.)*
  - **Two findings, one section, one cause: §2.2 was written before anything existed, and two
    later decisions overtook it without anyone re-reading it.**
  - **`gaps` is not in §2.2 at all.** Its pseudocode takes a bare list of points. `Trace.gaps`
    arrived with **D-198** and carries the only question this function asks — *may a corridor be
    drawn across here?* — merging a time interval past `GAP_THRESHOLD_MS` (30 s, D-195) with a
    sanitation break where a fix was dropped between two accepted ones. D-198 put both in one
    field **precisely so that no consumer could honour one and forget the other**, and this is a
    consumer. `01-architecture.md` §11 has always said *"no cell is emitted across a `gaps`
    interval"*; nothing said where that happened. It happens here.
  - **It goes first because it is strictly stronger than §2.2's own step 3.** A 30-second
    interval breaks the trace regardless of distance; step 3 requires 250 m **and** 120 s. Every
    split step 3 would make across a dropout, `gaps` has already made — so on a normalised trace
    step 3 is expected never to fire. **It is kept anyway**, as defence in depth: this is a
    domain function, it does not get to assume its caller sanitized anything, and the cost of
    being wrong is a permanent scar on a map that never re-fogs (D-020).
  - **The teleport gate: 12.0 was wrong, in D-197's own terms.** §2.2 specifies
    `TELEPORT_SPEED = 12.0`; D-197 set the sanitizer to **12.5 m/s** for foot activities after
    measuring 21,225 fixes across eight real runs. A trace reaching `traceToCells` has already
    passed that gate, so 12.0 could only ever fire in the band **12.0–12.5** — on exactly the
    fixes D-197 deliberately decided to KEEP, having found that a tighter gate caught zero GPS
    jumps and rejected five plausible human bursts. And firing is not free: the split writes a
    break into the corridor, the *"dotted corridor"* §9.5 warns about. **Shipping 12.0 would
    have re-introduced, one module later, the precise defect the sanitizer was re-measured to
    remove.**
  - **So the two gates are ONE gate with ONE owner**, and the table moved to `src/domain/geo.ts`
    to make that expressible. It could not stay in the adapter: `src/domain/` may not import
    from `src/adapters/` — `check-boundaries.mjs`'s STRICT tier fails on the import path, and it
    is right to — so the dependency inverted, which is the direction D-100 wanted anyway.
    Restating `12.5` in `fog.ts` was the alternative and is the two-owners-of-one-value failure
    **D-193** names; the test asserts the *identity*
    `TELEPORT_SPEED_MS === MAX_IMPLIED_SPEED_MS.run` rather than the value, so the next
    measurement cannot move one and not the other.
  - **No `ActivityKind` parameter, and that is a deliberate narrowing rather than an oversight.**
    Exactly one skill row carries `revealsGround: true` (**D-189**) and its `match` names the
    three on-foot kinds, which all hold the same gate. Wheeled activities never reach this
    function. A test asserts those three agree, so the day one of them diverges the build says
    so — which is the point at which `traceToCells` has to grow the parameter.
  - **What this does NOT change.** Steps 1, 2, 4 and 5 of §2.2 stand as written, `REVEAL_R_M`
    and the exact filter remain ticket `0046`'s, and `12.0` is left visible in §2.2's constant
    block marked superseded rather than quietly overwritten.

- **D-213** **A synthetic fixture must preserve the trace's EXTENT, not only its step lengths.**
  *(Ticket `0045`. Corrects the implementation of D-199, not the decision.)*
  - **The defect, measured.** `synthesise()` drew an **independent** random bearing per step.
    That is a diffusive random walk: extent grows with √n, not n. `real-run-outdoor` is a
    genuine **6,069 m** run and its synthetic geometry occupied a box of **98 m × 154 m** —
    about the area of ONE H3 res-10 cell. The whole run projected to **2 cells**, against
    `0045` criterion 10's requirement of 40–130.
  - **Why nothing caught it for a capability and a half.** Every existing consumer measures
    something a scribble satisfies: the fidelity floor (D-200) measures a sampling *rate*, the
    sanitizer (D-197) measures step *lengths*, `bbox` was only ever asserted to contain its own
    points, and the geography guard asks whether coordinates are near Point Nemo — a tighter
    scribble passes it more easily. **The fog projection is the first consumer that measures
    extent, and it is the one that cannot tolerate the fixture being wrong.** This is the shape
    to watch for: a fixture is only as real as the properties something has actually checked.
  - **The fix is a correlated bearing, and it does not weaken D-199.** The turn per step is now
    bounded per metre travelled, so the track meanders like a route instead of diffusing like
    noise — 58 res-10 cells over the same 6,069 m. Step lengths, point counts, timestamps,
    `original_size` and every non-geometric field are untouched. **The bearings still carry no
    information from the real track**, which is the property D-199 rejected rigid
    relocate-and-rotate to protect: a route *shape* is matchable against OpenStreetMap, and a
    generated meander is not a route shape.
  - **Regenerated without re-capturing, and that is exact rather than approximate.**
    `make-strava-fixture.mjs --resynthesise <name>` re-runs the transform on a committed fixture
    with no network call and no credentials. `synthesise` reads exactly one thing from its input
    — the step length between consecutive points — and every committed fixture already carries
    the real ones, because preserving them is the invariant of the transform that wrote it. The
    seed comes from `detail.id`, so a re-synthesis and a re-capture of the same activity agree.
  - **It is a branch in the capture script rather than a script of its own**, deliberately:
    `rewriteGeometry` decodes an encoded line, and `adapter.test.ts` holds a short, individually
    named allowlist of files permitted to do that. A second module would have had to be added to
    it. One transform, one privileged file.
  - **The turn rate was measured, not chosen by taste.** 0.03 rad/m yields 58 cells over
    6,069 m, against 49 for a hand-built 6 km rectangular circuit; rates from 0.01 to 0.05 all
    land in the same band. It is a named constant so the next person to widen it knows what it
    was measured against.

- **D-214** **The domain may import exactly ONE third-party package — `h3-js` — named and
  justified in `contract-drift.test.ts`, with its dependency-free claim asserted rather than
  trusted.** *(Ticket `0045`.)*
  - **The test was broader than the design.** `contract-drift.test.ts` asserted the domain
    imports "only `node:` builtins and its own siblings", written when `src/domain/` held three
    types-only modules and nothing had needed a library. But `01-architecture.md` §11 specifies
    `h3-js` **by name** for this exact step — *"in-process, `h3-js` (pure JS, bundles cleanly)"*
    — and `05-fog-of-war.md` §2.2's normative pseudocode is written in H3 primitives throughout.
    A domain that may not import it cannot implement §2.2 at all. Same shape as **D-167**: a
    rule stated more broadly than the thing it protects, discovered the first time someone tried
    to build against it.
  - **What the rule actually protects is DIRECTION and PORTABILITY, and neither is weakened.**
    Nothing may point out of the domain at an adapter, the pipeline, the UI or a cloud SDK — all
    five of those assertions are untouched — and `normalize()` must run in a Lambda, a browser
    and a replay harness alike. Measured: `h3-js@4.5.0` has **zero** dependencies and zero peer
    dependencies, is the version R3 §627 pinned, and R3 records it working in browser and
    Lambda. It is a compiled geometry kernel, not a layer.
  - **An allowlist of named entries, not a category.** "Pure libraries are fine" is a rule that
    admits the second and third package without anyone deciding to; a list of one makes adding
    the second a visible edit with a reason attached. Same discipline `adapter.test.ts` applies
    to its two polyline decoders and `check-boundaries.mjs` to its three narrowings — and the
    same instruction attached: **if a fourth is wanted, the question is whether it belongs in
    the domain at all, not whether to raise the number.**
  - **The dependency-free claim is a test, not a comment.** A transitive dependency arriving in
    a minor bump is exactly the drift the file is named for, and a portability argument nobody
    re-checks is a portability argument that expires.

- **D-215** **Cartography is 13 XP per new cell, not 15, because the reveal radius was never
  50 m and the measured density is 7.67 cells/km.** *(Ticket `0046`. Operator-authorised
  widening of that ticket's scope — see its Resolution.)*
  - **Two documents disagreed and one of them was doing arithmetic.** `05-fog-of-war.md` §2.3
    has always specified **65 m**, justified against res 10's 65.7 m inradius. `04-game-design.md`
    §10 said *"Reveal radius is assumed at 50 m, giving 6.5 cells/km"*, §6.2 gave the Lantern a
    50 m base, and §3.2 then tuned Cartography's rate **against that 6.5** to reach parity with
    Wayfaring's 100 XP/km. So the stale assumption was not a stray sentence; it was an input to
    a live rate. `0046` criterion 8 pointed at `09-roadmap.md`, which had already been corrected
    by the `06` audit — the surviving 50 m was in the document that mattered more.
  - **7.67 cells/km, measured, not derived from area.** The corridor is one cell wide, so the
    density is set by res 10's 131.4 m centre spacing rather than by cell area: 1,000 / 131.4 ≈
    7.6. Measured mean over 60 straight 5 km lines at one-degree bearing increments: **7.67**.
    The real 6.0 km fixture yields 45 cells — 7.5 cells/km. (An area-based estimate gives 8.6
    and is wrong, because it assumes the corridor tiles perfectly; §2.3's corner-clip removal is
    why it does not. See D-216.)
  - **The rate was cut to hold XP-PER-KILOMETRE constant, which is the quantity §3.2 actually
    tuned.** 7.67 × 13 = 99.7, against the old 6.5 × 15 = 97.5 and Wayfaring's 100. Everything
    §3.2 and §3.3 state per kilometre therefore survives untouched — the parity claim, and the
    ~31 XP/km steady-state floor that §3.3 calls "the mechanism that makes the whole system
    survive year five". Only the per-*run* cell counts moved, and §8.2's worked example was
    recomputed with them (55 cells → 64; 375 XP → 383).
  - **Why not leave 15 and accept the drift.** 15 × 7.67 = 115 XP/km, which makes a kilometre of
    new ground worth 215 XP against Wayfaring's 100 and quietly makes Cartography the dominant
    skill. §3.2 calls cross-discipline fairness "the biggest judgment call in §3"; letting it
    move 15% because a radius in a different document was never reconciled is not a decision,
    it is an accident.
  - **Pre-ship, so D-135 and the D-142 XP floor are not engaged.** No ledger row exists and no
    XP has been displayed. `04` §10's own rule is what licensed this: *every Cartography number
    scales linearly with the reveal radius*, so **after ship this same change would be a
    rebalance with a ratchet, not an edit.** Change the radius before ship or not at all.

- **D-216** **At `REVEAL_R_M = 65` the filtered cell set is a strict subset of the cells the
  path entered, the corridor is contiguous at `gridDisk(c, 2)` and not always at
  `gridDisk(c, 1)`, and step 4's k=1 candidate disc contributes nothing.** *(Ticket `0046`.)*
  - **It is a theorem, not a measurement.** 65 m is below res 10's 65.7 m inradius, so if a
    cell's centre is within 65 m of the path then the nearest path point lies inside that
    cell's inscribed circle — inside the cell. Step 5 can therefore only ever *remove*. It
    follows that §2.2's step 4 `gridDisk(c, 1)` cannot contribute a cell of its own at this
    radius, confirmed on the real fixture: 0 revealed cells were not entered.
  - **The disc stays anyway.** It stops being redundant the moment `REVEAL_R_M` is raised past
    65.7, and the cost is one call per densified point. Deleting it would make the pipeline
    silently wrong for a future radius rather than merely wasteful for this one.
  - **§2.3's "to within rounding, the cell you ran through" was optimistic: it is 18% fewer.**
    The 6.0 km fixture enters 58 cells and reveals 45. The direction is always *under*-revealing,
    which §9.4 and D-020 make the recoverable one, and the missing cells are genuinely the
    corner clips §2.3 asks step 5 to remove — but 18% is not rounding, and D-215's rate depends
    on saying so.
  - **Dropping a corner-clipped cell can break the chain, and `0046` criterion 6 was amended
    to ring 2 because of it.** Two cells entered in sequence can be left two rings apart when
    the one between them is dropped. Measured: ring-1 isolation at 8 of 60 bearings (≤3 cells);
    **ring-2 isolation at none**, and none on either real fixture. Ring 2 keeps every tooth the
    criterion wanted — a spike, a scatter, or a second parallel street each fail it just as hard.
  - **Why this is not treated as a defect to fix.** The alternative — unioning the filtered set
    with the cells the path entered — would guarantee contiguity, but by the theorem above it
    reduces to *exactly* `gridDisk(c, 0)`, making `REVEAL_R_M` decorative and step 5 a no-op.
    A hole is also invisible on screen: §4.1's renderer splats ~102 m discs, so a neighbour
    covers it. It is real in the data and in XP, and a later run at a different GPS offset
    fills it.

- **D-217** **The ruleset ships to the ingest Lambda as a generated `rules/xp-rules-v*.json`,
  committed beside its YAML and gated by `--check`.** *(Ticket `0047`.)*
  - **The worker had no way to read the rules at all, and it is not allowed to guess.** D-189
    makes `revealsGround` the field that decides whether an activity's cells are written, and
    a cell written by mistake is permanent (D-020) — so "read it if you can" is not an option
    the design leaves open. But `src/rules/load.ts` resolves `rules/` from `import.meta.url`,
    which after esbuild bundling points at the bundle rather than at the repo, and T5 — the
    `RuleSkill` table the browser reads (02 §3.3) — is not seeded until capability 09 (ticket
    `0060`). Both channels the design assumed were unavailable.
  - **JSON specifically, because esbuild inlines a JSON import with no loader and no bundling
    configuration.** Every other option changes how Amplify builds the function: a YAML text
    loader, a `bundling` override, or copying `rules/` into the artefact. This one is a plain
    `import` and nothing about the build had to move.
  - **The YAML remains the authority.** It is what a human edits and what `02` §3.3 names. The
    `.json` is a build artefact of it, byte-equivalent by construction, and the generator
    preserves key order so a rules diff stays readable.
  - **COMMITTED, not gitignored, and `--check` in CI is what makes that safe.** An artefact
    regenerated at deploy time can differ between the tree a reviewer reads and the bytes that
    ship. Committing both halves means a rules change shows both in one diff — which is the
    point, since D-031 promises that adding a workout type is a data row and a reviewer should
    be able to see the whole row. `scripts/build-rules-json.mjs --check` runs on both CI
    surfaces (D-163), and `reveals-ground.test.ts` asserts the same equality in `npm test` so
    the drift is caught before the push rather than by it.
  - **Validated at cold start, not at build.** The handler runs `assertValidRuleSet` on import,
    so a malformed ruleset fails the cold start with one clear error instead of failing each
    activity differently deep inside the matcher. The generator deliberately does not validate:
    a build step that silently refuses to emit is harder to debug than a runtime that refuses
    to start.
  - **This is a bridge, and it says so.** The import pins v1 by path. Replay against an older
    `rulesVersion` (04 §7.6) needs T5 and belongs to capability 09 — which is why
    `processActivity` takes the registry as an ARGUMENT: that day changes one line in the
    handler and nothing in the pipeline.

- **D-218** **The `generation` counter is a THIRD item type in T6, `U#<uid>#GEN`, allocated by
  an atomic `ADD`.** *(Ticket `0049`.)*
  - **The design named a mechanism that no longer exists.** `05` §7.3 and `02` §6.4 both say
    `generation` is *"bumped by the ingest Lambda inside the same transaction as the cell
    writes"*. D-144/I-10 moved the cell writes OUT of `TransactWriteItems` — 40–130 cells
    against a 100-item cap — so there is no such transaction to bump inside. Same shape of
    staleness as AP-15, corrected by `0048`, and found the same way: by trying to implement it.
  - **The obvious replacement is unsafe, and not theoretically.** Reading
    `manifest.generation` and adding one is a read-modify-write. The ingest queue is a standard
    SQS queue with `batchSize: 1` and no reserved concurrency, so a Sync that pulls five
    activities runs five workers for one user at once. Two of them read 41 and both write
    `explored-r10.42.bin` — two different cell sets under one name, served
    `Cache-Control: immutable`. Nothing recovers from that, because `immutable` is a promise
    the CDN and the browser have already believed.
  - **`ADD generation :one` is monotonic by construction, not by condition.** The increment
    happens inside DynamoDB, so there is no value a caller could supply that lowers it and no
    read for a concurrent writer to race. Two simultaneous callers get 42 and 43, never 42
    twice. A missing attribute is treated as 0, so a user's first call returns 1 with no
    bootstrap write and no existence check — which is why the worker needs no `GetItem` grant
    and nothing ever reads the counter back.
  - **`raiseGenerationTo` is the conditional half, and it exists for the drill.** `02` §8.3
    step 7 rebuilds into new, empty tables and must *"set `generation` = the step-0 generation
    + 1, never 1"*. Its `ConditionExpression` is I-11 made executable: called with a value at
    or below the current one it writes nothing and returns `false`, which turns "attempt to
    lower it" into a test rather than a review comment.
  - **A third item type in a table `02` T6 calls a bounded exception at two.** It is added
    there rather than in a ninth table for the reasons that bounded the exception: same job,
    same path, same partition-key convention — and T6 is the one table carrying `RETAIN` and
    point-in-time recovery, which is exactly the durability a counter that must never go
    backwards wants. A separate table for a single number would be the laziness §2.1 argues
    against, inverted. `#GEN` shares no partition with `#C#` or `#AGG#`, so no existing
    `Query` can return it and `assertNoCellWrites` is unaffected.
  - **The manifest stays authoritative for what the client fetches** (`02` §6.4), and
    `Profile.exploredGeneration` stays the mirror `0051` repairs. This item is authoritative
    for a different question — which numbers have ever been handed out — and that is the one
    immutability turns on.

- **D-219** **The manifest PUT is conditional on the ETag its merge base was read from, and a
  412 re-merges. The `LSFL` sidecar carries a header.** *(Ticket `0049`.)*
  - **A unique generation is not enough on its own.** D-218 stops two concurrent workers
    writing the same filename. It does not stop them merging from the same base: A and B both
    read generation 41, A publishes 42 = blob41 + runA, B publishes 43 = blob41 + runB — and
    runA's cells are gone from 43 and from every generation after it. T6 still holds them, so
    this is not a re-fog and D-020 holds; the *payload* has silently lost ground, and only an
    AP-17 repair would bring it back.
  - **`IfMatch` makes the merge chain linear, as a precondition rather than as a convention.**
    The loser gets a 412, discards its work, and re-merges against what the winner published.
    `IfNoneMatch: "*"` is the same precondition spelled for a key that must not yet exist, so
    two bootstraps cannot both win either.
  - **This is why the allocator is a counter and not "manifest + 1".** The loser's blob 43 is
    an orphan — `02` §6.4 already calls orphan blobs harmless and garbage-collected — and a
    counter guarantees no later run ever writes DIFFERENT bytes to that same immutable name.
    With "manifest + 1" the retry would compute 43 again and overwrite it, and anything that
    had already fetched 43 would hold wrong bytes under a year-long cache header.
  - **The sidecar's header is not in `05` §7.2, and is added.** §7.2 describes
    `explored-lastrun-r10.bin` as bare parallel u16s whose length is implied by the set's
    `count`. That shape's failure mode is invisible: a client holding cells for generation 41
    that fetches the sidecar for 42 is off by however many cells the run added, and every
    cold-territory verdict past the insertion point is attributed to the wrong hexagon.
    Nothing errors. 20 bytes carrying `version`, `res`, `generation` and `count` make it
    unrepresentable — the same discipline §6.4 already imposes on `version` and `res`.
  - **A sidecar that does not decode is dropped, not thrown.** It feeds one optional overlay
    (§8.5, D-133) and nothing else, so failing an ingest over it would block the map to
    protect a cosmetic layer. It is reported on the result as `sidecarRebuilt` rather than
    swallowed, because a `true` there means something upstream wrote a bad object — and T6
    still holds the real days for an AP-17 repair to restore.

- **D-220** **The delta object is named by `toGen` alone, and the client walks the chain
  BACKWARDS.** *(Ticket `0051`.)*
  - **The documented name cannot be constructed by the client that needs it.** `02` §6.1 and
    `05` §7.3 both tabulate `deltas/<fromGen>-<toGen>.bin`, and §6.5 tells the client to
    *"chain multiple deltas when several generations behind, validating each."* A client knows
    exactly one of those two numbers — its own cached generation, the `from` end. For the
    single hop the manifest spells out (`deltasFrom` → `generation`) it works by accident;
    the chain does not, and never could.
  - **D-219 made it worse rather than exposing something old.** Before the manifest CAS,
    generations would have been contiguous and `toGen = fromGen + 1` would have walked the
    chain by arithmetic. The counter burns a number whenever a worker loses the race, so
    41 → 42 → 44 is reachable and the guess is wrong exactly when concurrency happened.
  - **Named by `toGen`, the walk needs nothing but the manifest.** Fetch the delta for
    `manifest.generation`, read `fromGen` out of the `LSFD` header, repeat until it matches the
    cached generation or drops below `deltasFrom`. Gaps are invisible: the walk follows what
    was written rather than what the numbers imply. `fromGen` stays in the header where it
    already was, so the format does not change — only the key.
  - **The same walk is what makes GC free of a listing.** Nothing in the delivery layer needs
    `s3:ListBucket`, which matters because bucket-level grants cannot be scoped to a prefix the
    way object-level ones can, and a list grant would let the worker enumerate every user's
    blobs. The GC does not even walk: it deletes the arithmetic range
    `(previousGeneration − 20, generation − 20]`, which is one key in the ordinary case and
    covers burned numbers with a harmless no-op delete.
  - **`deltasFrom` is `generation − 20`, not `previousGeneration`.** GC only ever deletes hops
    at or below that, so a client cached exactly there still finds every hop above it, and one
    cached a step lower is correctly told to take the full blob. Erring high is safe (an
    unnecessary 300 KB immutable GET, which `02` §6.5 already calls the correct outcome);
    erring low would send a client after an object that has been deleted.

- **D-221** **An out-of-order activity DEFERS its undecidable cells rather than failing, and
  out-of-order is detected at the cell, not against a watermark.** *(Ticket `0050`.)*
  - **`0048`'s throw was the wrong end of the trade, and building the replay path is what
    showed it.** `05` §3.4 says a negative `at − lastRunAt` *"should assert/log rather than pass
    silently. If a negative delta reaches the classifier, the replay queue has a bug."* `0048`
    read that as "throw", which sent the activity to the DLQ — so the ground never reached the
    map, the redrive failed identically every time, and a historical backfill (the case §3.4
    names **first**) was unusable until the replay consumer shipped. Which it has not.
  - **The cell becomes a fourth `Discovery` class, `"deferred"`, worth zero.** It is counted in
    `deferredCellCount` on T3 and it marks the user for a fold. The activity completes: its
    cells are written, its receipt reaches `DONE`, and the map gains the ground.
  - **The under-award is the safety property, not a placeholder.** D-135: XP never decreases and
    corrections may only add. Zero now means a later fold can only ever raise the number —
    never lower one the user has already seen. The alternative §3.4 warns against, guessing
    "cooled", looks identical today and is permanently wrong.
  - **Detection is at the CELL.** §3.4 defines out-of-order as *"the incoming `startedAt`
    precedes an already-scored activity"*, which needs a per-user high-water mark nothing
    stores. It is also stricter than the truth: incremental scoring and the canonical fold
    differ **only when the late activity shares a cell with a later one** — which is exactly
    when that cell's `lastRunAt` is ahead of it, which is exactly what the classifier's existing
    `BatchGetItem` already returns. A run that predates others but crosses none of their ground
    scores identically either way, and is correctly not deferred.
  - **The marker is a `min` on the fog control item** (`U#<uid>#GEN`), so the fold starts at the
    earliest activity that needs one and two backfills in flight cannot stomp each other. Not
    an SQS enqueue: the consumer is `0103`'s (the drill's fold) and `0066`'s (the XP half), both
    in later capabilities, and a message sent to nothing is worse than an obligation recorded
    durably.
  - **`OutOfOrderScoringError` survives, and its home moved.** The FOLD may never produce one:
    its input is sorted, so a negative delta there is a sorting bug in the one function whose
    entire contract is that it is sorted (I-14). That is worth failing loudly for, and
    `fold.ts` is where it now throws.

- **D-222** **`traceRejectCounts` is `{accuracy, duplicate, nonFinite, segments}`, not
  `{speedGate, accuracy, duplicate}`.** *(Ticket `0180`.)*
  - **`speedGate` describes something that does not happen in this layer.** `02` T3 named it
    before D-212 drew the distinction: §2.2 step 3 does not DROP an implausible sample, it
    **splits the trace** either side of it, so "samples rejected by the speed gate" has no
    value to report. Every other key in the column is a per-sample count; that one would have
    had to be a count of splits under a name that says samples.
  - **And the per-sample speed-gate count that genuinely exists is not the fog's.** The adapter
    sanitizer (`0037`) drops fixes on `MAX_IMPLIED_SPEED_MS` and reports how many, and that
    number already reaches T3 inside `source.meta.rejectedPoints`. Copying it into
    `traceRejectCounts` would be two owners for one number — the duplication D-193 names — on a
    row that already carries it.
  - **`segments` replaces it, and is honest about not being a drop count.** It is what the
    teleport gate actually produces, and it is a real diagnostic on its own: a recording that
    arrives as one trace and leaves as eleven pieces has something wrong with it even when
    nothing was rejected.
  - **`nonFinite` was added.** `clean()` already dropped `NaN`/`Infinity` coordinates silently.
    The count should always be zero, and a non-zero value is an adapter bug — which is exactly
    the kind of thing worth a column rather than a silent `continue`.
  - **The counts ride on the `Set`, not beside it.** `traceToCells` returns
    `Set<H3Index> & { rejects }` — a plain Set with one extra property, not a subclass and not a
    `{cells, rejects}` tuple. `0045` and `0046` specify that return type precisely and their
    tests passed unchanged; a tuple would have rewritten every call site to widen a contract
    that did not change a single classification.

- **D-223** **A directory under `src/adapters/` is an adapter unless it is a conventional
  test-support directory, and the exclusion comes with a replacement rule.** *(Ticket `0155`.)*
  - **`0155` needed a second adapter that is not one.** Cross-adapter equivalence
    (`contracts/ingestion-contract.md` §5 check 3) compares the primary against a synthetic
    adapter replaying the same run through a different code path. `0027` specified exactly that
    — *"land the harness now with a second, synthetic fixture adapter"* — because waiting for a
    real one means waiting for capability `10`, and the harness's whole value is being already
    written on the day the primary is swapped.
  - **Two structural guards discovered it by directory and treated it as real.**
    `registry.test.ts` asserts the registry answers for every adapter directory, and
    `check-adapter-deletion.mjs` asserts deleting any adapter breaks only `registry.ts`. Both
    failed — correctly, by their own rules, applied to something that is not an adapter.
  - **Excluded by NAME, and the name is the argument.** `__fixtures__`, `__snapshots__`,
    `__mocks__`. A real adapter is never called any of those, so the exclusion cannot widen by
    accident the way a heuristic could.
  - **An exclusion without a replacement rule is a gap, so there is one.** Dropping
    `__fixtures__` from the adapter rules means the import guard stops watching it, and a
    fixture adapter names no vendor so `check-boundaries.mjs` would not fire either — leaving a
    second, unregistered ingest path reachable from production code. `registry.test.ts` now
    asserts the fixture adapter is imported only by test files and is never registered.
  - **The same ticket found the same shape of hole in a different guard.**
    `check-fixture-geography.mjs` read only `.json`, so the checked-in `.gpx` — 2,537 real-shaped
    fixes — would have gone unscanned and the tree would have reported clean (D-199, and this
    repo is public). It now reads GPX too, and its own self-test caught the first
    implementation requiring `lat` before `lon`: GPX does not fix attribute order, so
    `<trkpt lon="…" lat="…"/>` would have walked straight past.

- **D-224** **An invariant is cited when an `I-n` appears in the NAME of a `describe`/`it`/`test`,
  never merely somewhere in a test file.** *(Ticket `0161`.)*
  - **The old rule counted prose, and prose is free.** `0133` scanned test files for `/\bI-\d+\b/`.
    A sweep satisfiable by typing `I-7` into a comment measures nothing — it measures that somebody
    typed `I-7`. `0133` had already been bitten by the weak form once, when its own fixture rows
    activated the sweep against the real backlog, and fixed it by narrowing **where** it looked
    (`src|app|lib|scripts`) rather than **what counts**.
  - **A title is bound to an assertion that runs.** It appears in vitest's output, so "what covers
    I-9?" is answered by running the suite rather than by grepping and reading. Deleting or renaming
    the test removes the citation, which is the only reason D-225's regression check can mean
    anything: a comment survives the deletion of the code it describes, and would keep vouching for
    coverage that no longer exists.
  - **It cost nothing to adopt.** At the time of the change 15 invariants appeared somewhere in a
    test file and 9 appeared in a test name; the codebase had already reached for the strong form on
    its own (`it("stores all three time fields (I-13)")`, `describe("cells are written BEFORE the
    transaction (I-10, D-144)")`). The rule ratified an existing idiom rather than imposing one.
  - **Comments keep their job.** `explored-cells.test.ts` explains *why* I-8 forbids an
    unconditional `SET` in twelve lines of prose that no test name could carry. The rule says prose
    is not evidence of coverage, not that prose is unwelcome.

- **D-225** **The invariant sweep is a RATCHET with a high-water mark, and goes all-or-nothing only
  when `0116` declares the set complete.** *(Ticket `0161`. Supersedes `0133`'s binary trigger.)*
  - **`0133`'s trigger was `na` until the first citation, then all thirty or fail.** The first
    correct citation therefore armed a gate nothing could satisfy: `0116` — "a test, or a written
    reason it cannot have one, for each of the thirty" — sits in capability `18`, and correctly so,
    because most of the thirty are about the fog, the ledger and the rebuild drill. The sweep went
    red in capability `04` and would have stayed red through `17`.
  - **A gate that cannot go green until the last capability is not a gate.** It is a row everyone
    learns to scroll past — the exact failure `0133`'s own reasoning invoked when it chose `na` over
    thirty red rows on an empty repo. The right lesson was applied at the wrong end of the timeline.
  - **The mechanism: `docs/capabilities/invariant-citations.json`.** It holds the set ever cited
    plus a `complete` flag. The row FAILs on a **lost** citation, PASSes otherwise with the count
    and with the sentence naming what would change the verdict, and becomes all-or-nothing the day
    `0116` sets `"complete": true`. **`0116`'s remit is untouched** — this decision fixes the gate's
    timing, it does not do the sweep or shrink what `0116` must still deliver.
  - **The mark rises only in `audit --record`, and says so out loud.** The moment a capability is
    declared done is the right moment to raise a bar, and it keeps a single writer. Raising it on
    every `audit` run would let a citation appear and vanish between two audits with nothing to
    show for it; never raising it would protect only what `0161` happened to freeze. A deliberate
    removal goes through the existing `--force "<reason>"`, which writes the reason into the
    capability doc rather than hiding it.
  - **A corrupt ratchet file FAILs rather than reading as an empty one.** An unreadable high-water
    mark means a lost citation passes unnoticed, which is worse than the bug this fixed. The same
    instinct as `NA`-with-a-reason: "could not check" must never render as "checked".

- **D-226** **The pmtiles basemap is hosted on a dedicated public-read S3 bucket behind our OWN
  CloudFront distribution, not on Cloudflare R2.** Supersedes the R2 choice in `01-architecture.md`
  §1, §8 Risk 1 and inventory row 20. *(Ticket `0052`.)*
  - **The risk R2 was chosen to eliminate is real, but it was sized for a different app.** §8 Risk 1
    prices Amplify Hosting egress at $0.15/GB after 15 GB free and reasons from a map-heavy app
    pulling **100 GB/month = $15/month**, 3–5× the whole D-083 budget. That figure assumes many
    users. Measured against this one: the Florida extract is **1.1 GB stored**, and `pmtiles`
    range-requests only the tiles in view — urban vector tiles run 30–100 KB and a phone viewport
    holds under a dozen, so a hard 30-second pan moves 2–6 MB. Forty sessions a month is **~200 MB,
    call it 1 GB with cold caches.** That is inside Amplify's free 15 GB, and *past* it would bill
    **about $0.15/month.** R2 was buying insurance against a volume a single user cannot generate.
  - **The mitigation ladder always had a second rung, and this is it.** R5 §cost-risk and §8 both
    list "(b) S3 + your own CloudFront distribution (cheaper per GB than Amplify's markup)" as the
    sanctioned fallback. This is not a shortcut around the design; it is the design's own second
    choice, taken because the premise for the first did not hold.
  - **CloudFront's 1 TB/month egress and 10M requests are ALWAYS-free, not 12-month free.** That
    matters more here than the headline price: Risk 2 records genuine ambiguity over whether
    Amplify Hosting's allowances expired with the account's first year. The always-free tier carries
    no such ambiguity, so the fallback is *less* exposed to the unresolved question than the thing
    it replaces. Usage is ~1 GB and a few thousand requests against those ceilings.
  - **What R2 actually cost, weighed honestly.** A second vendor and a card; a long-lived credential
    outside the `devault` profile, in a project where **O-005 was a credential leak**; a manual
    provisioning step outside Amplify/CDK, which is exactly the kind of step that rots unrecorded;
    and then a choice between `r2.dev`, which Cloudflare rate-limits and documents as not for
    production, or moving `devaultsecurity.com`'s nameservers off Route 53 — a change enormously
    larger than the ticket that would have caused it. Set against saving at most $0.15/month.
  - **Serving on the distribution's default `*.cloudfront.net` hostname is load-bearing, not lazy.**
    It needs no ACM certificate and no Route 53 record, so it walks around the retired
    S3/CloudFront/ACM architecture whose teardown R5 (lines 142, 354) records as **unverified** and
    names as the precondition for `CNAMEAlreadyExistsException`. Tiles are a machine-read asset
    behind a URL in one config module; nobody types this hostname.
  - **The rule that was actually load-bearing survives intact: tiles NEVER route through Amplify
    Hosting.** That is what §8 Risk 1 was protecting and it is unchanged. What changed is which of
    its own two listed alternatives carries it.
  - **This is the fifth use of the CDK escape hatch**, against the four `01-architecture.md` §2
    sanctions and `amplify/backend.ts` enumerates. The count in that comment is updated rather than
    left to drift.

- **D-227** **The desktop browser is the primary VIEWING surface; the Android phone is the primary
  CAPTURE device.** Partially supersedes D-124, which said "desktop browser is a secondary target
  for planning and admin". *(Operator, during ticket `0053`'s validation, 2026-09-09.)*
  - **The operator's own framing, stated twice and unprompted:** *"I plan to use this app primarily
    through a browser on my computer, not trying to view it through a phone. Phone for tracking the
    runs, and computer for viewing all the data via the webapp."*
  - **D-124's platform half is untouched and still correct.** Capture shortcuts, share targets and
    companion tooling remain **Android** — Tasker/MacroDroid HTTP tasks, PWA `share_target`, never
    iOS Shortcuts. The run is recorded on the phone and always was. What flips is only which screen
    the *data* is read on.
  - **What this changes in practice, and it is mostly about evidence rather than code.** Twenty open
    tickets carry an `## Operator validation` step naming "the 6.8in Android phone". Most of them
    are asking a question about legibility or layout that is now better asked of a desktop browser,
    and a validation performed on the wrong surface is worse than none — it reports a pass for a
    screen nobody uses. **Default the validation surface to the desktop browser.** Keep the phone
    where the check is genuinely phone-specific: capture, the share target, sunlight legibility for
    a mid-run glance, and **the USE step of a capability audit, which D-153 defines as an actual
    run** and which does not change.
  - **It does NOT reprioritise the fog or the map.** D-051 (legibility beats atmosphere) is
    surface-independent and if anything easier to satisfy on a large screen. The DPR cap, the
    perf budget in `05` §6.4 and ticket `0059`'s mid-range-Android harness all stand: the phone
    remains the *worst* case even when it is not the *common* case, and a renderer tuned for it
    is not wasted work.
  - **`06-ui-ux.md` is written phone-first and now has a stale premise.** §1 opens with D-124's
    primacy, the IA is built around a thumb-arc plinth, and desktop is one paragraph (§4.8) of
    adaptation. That is a real doc/intent divergence, but it is a **design session**, not an edit
    to make in passing during a renderer ticket — the two references that state the primacy
    outright are amended to point here, and ticket `0187` carries the pass.

- **D-228** **The browser fetches the explored set from this app's own origin, not from S3.**
  Supersedes the delivery half of `01-architecture.md` §5, which had a server component minting a
  presigned `getUrl()` on `explored-r10.bin`. *(Agent, ticket `0054`, 2026-09-09.)*
  - **The blocking reason is an identity mismatch that has always been there.** The ingest worker
    writes `users/<uid>/…` where `<uid>` is the Cognito **user-pool `sub`** (`02` T1: *"the `<uid>`
    in every S3 key"*). `amplify/storage/resource.ts` grants the browser `users/{entity_id}/*`,
    where `{entity_id}` is the **identity-pool identity id** — a different string. No browser
    credential has ever covered a single object in the delivery layer. `0049` found this and
    assigned it to `0054`; this is that decision.
  - **The second reason is D-220, and it rules out presigning even if the identity matched.** The
    delta chain is walked BACKWARDS: a client learns hop *N−1*'s key only after reading hop *N*'s
    `LSFD` header. Presigning a chain is therefore one round trip to this app **per hop**, to save
    transferring ~350 bytes each. Served inline, the whole retained chain is ~7 KB in one response.
  - **What it costs.** One transfer of ~370 KB through the SSR compute role, per generation change,
    per client — and only when the delta chain does not reach. `02` §6.2 already treats the varint
    size as the floor and gzip's gain over it as near-nothing, so decompressing server-side and
    serving plain bytes gives that back at no meaningful size cost while removing a whole class of
    double-encoding failure.
  - **What it does NOT change.** `generation` is still the only cache key; the immutable objects are
    still immutable and are served `private, max-age=31536000, immutable` from
    `/api/fog/blob/<gen>`; `manifest.json` is still the only mutable object and is still revalidated
    on every load, now as an `ETag` of the generation with a genuine **304**. `05` §7's prohibition
    stands untouched and is worth restating because this decision looks superficially like a breach
    of it: *"do not build a tile server, do not build a spatial index service, do not build a
    per-viewport query API."* This is none of those. It is one request that returns the whole set,
    exactly as designed — the bytes simply take one more hop.
  - **`private`, not `public`, on both routes.** The app sits behind a CDN and both responses
    describe one person's map. This is the one new security-relevant property the change introduces,
    and it is the reason the change is cheap rather than free.
  - **The grant is read-only and asymmetric, deliberately.** The SSR compute role gets `s3:GetObject`
    on `users/*` and nothing else — no `PutObject`, no `DeleteObject`, no bucket-level `List`. Every
    write to the delivery layer belongs to `processActivity`. A map that can never re-fog (D-020) is
    exactly the kind of artifact to keep a reader away from write verbs, and
    `amplify/fog-delivery-read-grant.test.ts` asserts it in the synthesized template.
  - **`raw/*` remains unreachable from the app.** The archive has no read path through any
    browser-facing grant, which is I-3's disposition and does not change here.

- **D-229** **Operator validation is for PERCEPTION only. Everything else the agent proves itself,
  and a validation step may never require the operator to construct a scenario, use the phone, or go
  for a run.** Narrows how D-181 is applied and amends D-153's USE step.
  *(Operator, after ticket `0054`, 2026-09-09.)*
  - **The operator's own framing, after the third occurrence:** *"When you want me to validate
    whether I like the layout of something, or check to see whether it's actually rendering how you
    expect — those are fine and expected operator validation tasks. When it's to validate whether the
    app shows a note saying it's offline, forcing me to create that scenario? That's unnecessary."*
    And: *"I'm not going to consistently keep running so you can have a run to sync and import for
    testing. The whole point of the app is to encourage me to run and see gamified progress, not
    encouraging me to run so you can accomplish a low-risk validation task."*
  - **D-181 was right and was being applied wrongly.** It says a criterion earns `(operator)` only
    when a human eye or hand is the *only* instrument that can answer it. The failure mode is
    reading that as *"a human eye CAN see it"* — which is true of nearly everything and turns the
    section into a checklist. `0054` closed a four-item list of which one item was a real question:
    one asked the operator to reproduce by hand a scenario an already-passing unit test covers, one
    asked for a phone measurement, and one asked them **to go running** so a delta could be watched
    landing.
  - **What earns `(operator)`.** Taste and perception, on the desktop browser (D-227): does the fog
    read, does the card land, is the layout right, is it rendering the way the ticket intended.
    Roughly: *would two competent people disagree about the answer by looking at it?*
  - **What never earns it.** (a) **Constructing a scenario** — going offline, syncing from a second
    device, waiting for an expiry, switching accounts. If it is worth testing it is worth faking, in
    a test or against throwaway AWS resources, which `0049` and `0054` both show is cheap.
    (b) **Re-verifying what the suite already proves.** (c) **Anything on the phone**, unless the
    ticket is *about* phone capture — D-227 already made the desktop browser the viewing surface and
    this closes the remaining gap. (d) Status codes, headers, IAM, DynamoDB, S3, logs — D-181
    already assigned these to the agent and they stay there.
  - **D-153's USE step is amended.** It defines a capability audit's USE step as *"an actual run with
    the build on the phone"*. That is now: **exercise the capability with real data through the real
    path, by whatever means does not require the operator to go running** — the manual adapter
    (`0069`), a replayed archived activity, or a synthetic activity through the ingest queue. A real
    run is welcome evidence when one happens to exist; it is never a precondition for closing an
    audit. The original wording made the project's own purpose into a chore, which is D-013's
    complaint pointed at the wrong target.
  - **The governing reason, stated so it is not re-litigated: this is a single-user hobby project
    aiming at MVP.** Usable soon beats exhaustively proven. A bug the operator hits in real use is
    cheaper to fix than a validation ritual that delays real use — and real use is the only thing
    that produces the runs the whole system is for.

- **D-230** **The `MAX`-into-`R8` spike is decided on the desktop browser, and the residual
  "does ANGLE on a real Android GPU honour it" risk is knowingly accepted and deferred to `0059`.**
  Resolves the conflict between ticket `0118` (written 2026-08-30, requires the real device) and
  D-227/D-229 (both 2026-09-09, which moved validation off the phone).
  *(Operator, during ticket `0118`, 2026-09-09.)*
  - **The conflict was real and not a misreading.** `0118` criterion 5 says *"Run on the real target
    device, not only desktop Chrome and not only an emulator"*, and `05-fog-of-war.md` §9.6 names the
    unvalidated assumption precisely: *"unvalidated: `MAX` blending against `R8` on older Android GPUs
    via ANGLE. Verify on a real mid-range Android device in the first week of implementation."*
    D-229(c) says anything on the phone never earns `(operator)` unless the ticket is about phone
    *capture*. This ticket is about phone *rendering* — inside neither the rule nor its exception.
  - **The operator's own framing, asked before any code was written:** *"if it can be validated on the
    web browser I don't need extra validation on the phone — I'm ok to keep that low-risk. If it's only
    a phone thing, then that's fine."*
  - **What the desktop browser genuinely settles, and it is more than it sounds.** The technique
    itself: that `R8` is renderable, that `gl.blendEquation(gl.MAX)` unions rather than sums, that
    MapLibre's `prerender` tolerates a foreign framebuffer, that the projection prelude compiles, that
    no GL state leaks. Those are properties of the code and the API, not of one driver, and every one
    of them was a way this could have failed.
  - **What it does NOT settle, stated plainly so it is not later claimed as proven.** One specific
    thing: Qualcomm/Mali ANGLE honouring `MIN`/`MAX` blending into a single-channel normalised target.
    That is a driver conformance question and only the device answers it.
  - **Why accepting it is cheap, which is the whole argument.** The failure, if it comes, is *loud and
    local*: the fog looks wrong on the phone in a way nobody could miss, and the fix — a `MAX`-free
    mask, or the `05` §4.6 raster escape hatch — is a change to the mask pass, not to the data model,
    the scoring, the ledger or the delivery format. Nothing downstream of `0055` is built on the blend
    equation. Contrast the risk the spike DID retire: a wrong answer there would have invalidated the
    whole two-pass architecture, which is why it was worth a ticket of its own.
  - **It is deferred, not dropped, and it has a named owner.** `0059` is a perf harness against the
    §6.4 budget **on a real mid-range Android phone**, and D-227 kept that standing explicitly — *"the
    phone remains the worst case even when it is not the common case, and a renderer tuned for it is
    not wasted work"*. The probe built for `0118` is ~40 lines and `0059` can carry it, so the device
    check costs that ticket almost nothing when it arrives with a device in hand anyway.
  - **The `0118` page self-asserts numerically for exactly this reason.** It prints one `GO`/`NO-GO`
    line and the unmasked GPU string, so if the operator ever does open it on the phone the task is
    "read one line" rather than "judge a rendering". A deferred risk with a two-second check attached
    is a different thing from a deferred risk with a procedure attached.
  - **This narrows §9.6's instruction rather than contradicting it.** §9.6 says verify on a real
    device "in the first week of implementation, before the rest of the layer is built on the
    assumption". What is preserved is the ordering claim that mattered: the *technique* is verified
    before `0055` builds on it. What is relaxed is which GPU does the verifying first.

- **D-231** **The mask's disc falloff starts at 0.60 of the radius, not 0.45 — and the threshold that
  guards it is derived from `0056`, never chosen.** `05-fog-of-war.md` §4.2 shipped
  `1.0 - smoothstep(0.45, 1.0, d)`; a real corridor on a real screen showed it as a chain of discs
  with a crease at every join. *(Operator, on first sight of `?fog=mask`, during ticket `0055`,
  2026-09-10.)*
  - **The arithmetic is three lines and nobody did it.** Adjacent H3 res-10 centres are 131.4 m
    apart, so their midpoint is 65.7 m from each; the disc radius is `1.35 x 75.9` = 102.5 m, so that
    midpoint sits at **0.64 of the radius** — outside a flat core of 0.45, a third of the way up the
    ramp. Coverage at every junction was **0.72 of peak**.
  - **This is the scalloping §4.1 promises `revealScale = 1.35` removes.** The scale was not the
    problem and raising it would have been the wrong fix: it would have masked a falloff bug by
    inflating the territory, past R4's 1.6 bound, on a map where over-revealing is permanent.
  - **`0056` would have made it worse, not hidden it, and this is the part worth remembering.** §4.3
    thresholds at `smoothstep(0.30, 0.72, coverage + noise)` with the noise swinging ±0.15, so a seam
    needs **≥ 0.87** to stay fully revealed at every phase. At 0.72 the seams sat exactly ON the upper
    threshold: they would have pulsed in and out of the mist as the noise drifted, giving a chain of
    breathing pinch points along every route — a defect that presents as a noise problem, in a pass
    that had not been written yet.
  - **0.60 rather than 0.65 or 0.70.** The seam measures 0.98 on a real GPU at 0.60 and saturates by
    0.65, but §4.3's noise displaces the boundary by roughly `amplitude x (1 - inner) x radius`, so a
    steeper ramp buys nothing and costs wisp depth. 0.60 keeps 40% of the radius as feather.
  - **Nothing about the revealed ground changes.** The disc still ends at 102.5 m; only the shape of
    the ramp inside it moves. `REVEAL_R_M = 65` in `src/domain/fog.ts` — what counts as explored,
    permanently, under D-020 — is untouched, and `check-fog-render-boundary.mjs` still keeps the two
    apart.
  - **THE TEST THAT SHOULD HAVE CAUGHT THIS PASSED IT, AND THAT IS THE REAL FINDING.**
    `tools/fog-harness` asserted `seam >= 179/255` — a number chosen while writing the harness to sit
    clearly above the deliberate sabotage case, derived from nothing. It passed 0.72 and reported
    `ok`. A threshold calibrated against what the code currently produces cannot fail; it only
    records. The floor is now `SEAM_FLOOR = 0.87`, computed in `lib/fog/mask.ts` from §4.3's own
    constants, and the harness prints that derivation beside the measurement. **Generalises: a
    numeric guard must come from the thing that consumes the value, not from the thing that produces
    it.**
  - **It took a person, and no amount of testing would have replaced them.** Both halves of `0055`'s
    verification were green — 55 unit tests and a GPU harness with sabotage cases on every probe —
    because both were asking whether the code did what it was written to do. The operator asked
    whether it looked right. That is D-181's whole argument, arriving on schedule.

