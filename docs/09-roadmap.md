# 09 — Roadmap: The Build Order

**Status:** final design document. Planning is complete; no code exists.
**Authority:** `docs/decisions/DECISIONS.md`. Every `D-xxx` cited below is settled.
Nothing in this document may contradict it. Where this document *guesses*, it says so.
**Unit of work:** the **capability** (`07-ticketsmith.md` §1.1) — a coherent operator-facing
change, describable in one sentence, designable in one focused session, decomposing into
**3–8 tickets**, useful on its own. Each cycles **DESIGN → TICKET-WRITE → BUILD → USE →
REFLECT**. Phases in §1 are sets of capabilities; they are not a second epic concept.

> **Scope is fixed by D-122 and is not reopened here.**
> IN: Strava ingest, fog-of-war rendering, both map modes, the full hybrid skill system
> (Wayfaring, Vigil, Might, Fortitude, Endurance + Cartography, Constitution), XP/levels,
> the "Add workout" quick-log page, the ticket system.
> OUT: all combat (map encounters *and* boss quests), novelty route planning, equipment/loot.

## Contents

1. The shape of the build
2. **The first-usable milestone**
3. Capability breakdown
4. Sequencing calls that need justifying
5. Carry-forward corrections
6. Post-MVP phases
7. Honest sizing
8. Risks to the schedule
9. Definition of done for MVP

---

## 1. The shape of the build

Four phases. Nineteen capabilities. Each phase ends at a **coherent** state — not necessarily
shippable, but never half-wired: no capability leaves a dangling import, a stubbed contract that
lies about its type, or a table written by nothing and read by nothing.

| Phase | Name | Capabilities | Ends coherent at |
|---|---|---|---|
| **0** | **Ground Truth on Disk** | `00` `01` | A repo, a signed-off backlog, and a working `/tickets`. No runtime. The methodology is fully operational (07 §7.3 Step 0) |
| **1** | **The Spine** | `02` `03` `04` `05` `06` `07` `08` | **FIRST USABLE (§2).** A real Strava run imports and reveals real territory on a real map at `soles.devaultsecurity.com` |
| **2** | **The Game Made Visible** | `09` `10` `11` `12` `13` | XP, levels, skills, strength logging and the post-run moment. The app is now the product described in `00-vision.md` |
| **3** | **Trustworthy and Complete** | `14` `15` `16` `17` `18` | D-013 satisfied (nothing to do after a run), the rebuild drill executed for real, both map modes, MVP done per §9 |

**Why this order and not "verticals first".** The temptation is to build one skill end to end
(Wayfaring: ingest → XP → a level bar) and repeat. That is wrong here for one specific reason:
**the fog is the product** (`00-vision.md` P4, D-051). The map is the home screen (`06-ui-ux.md`
§1.2 — "there is no map screen"). A vertical slice through the skill system produces a number on
a page; a vertical slice through the fog produces the thing the user opens the app for. Phase 1
is therefore the *fog* vertical, and the skill system — which is larger, better specified, and
carries no technical uncertainty — waits until Phase 2.

**Coherence at each phase boundary, stated concretely:**

- **End of Phase 0.** Nothing runs. `tickets/open/` holds the whole backlog, `scripts/tickets.mjs
  validate` passes over it, `/tickets list` prints a table. An agent can be handed the repo and
  work it.
- **End of Phase 1.** The app deploys, one user logs in, presses **Sync**, and their last Strava
  runs become revealed ground. XP is not computed. There is no skills page, no `/log`, no
  animation, no webhook. Nothing is broken — those routes do not exist yet. The `xp-rules-v1.yaml`
  file exists and is validated by CI but nothing reads it for scoring.
- **End of Phase 2.** Every route in the `06-ui-ux.md` §1.2 screen map exists except
  `/dev/tickets`. Sync is still manual. The ledger is live and `displayedXp == SUM(ledger)` holds.
- **End of Phase 3.** Automatic ingest, both map modes, the tickets UI, and a rebuild drill that
  has actually been run against the live archive.

---

## 2. THE FIRST-USABLE MILESTONE

> **The milestone: end of capability `08-map-and-fog-renderer`.**
> The user opens `soles.devaultsecurity.com` on their Android phone, signs in, taps **Sync**,
> and watches the streets they actually ran come out of the fog.
>
> **Everything in Phases 0 and 1 exists only to reach this point. Nothing that is not on the
> critical path to it may be built before it.**

### 2.1 Why this is the governing constraint

D-013 is a *hard design constraint*, and the Habitica lesson behind it (`00-vision.md` §3.1) is
that the user abandoned a system whose maintenance cost exceeded its motivation. The corollary
for the build is not about the user's daily upkeep — it is about the build's own. **A working
thing the user actually uses beats a complete thing still being built.** A half-built Lost Soles
that reveals territory is a system that generates its own feedback (`07-ticketsmith.md` §3.5:
"USE" fits this project unusually well — the operator *is* the user). A fully-designed Lost Soles
still three months from its first import is a second Habitica: a project that became a job.

So the milestone is placed at the earliest point that is **honest**, not the earliest point that
is demoable. "Honest" means the reveal is real: real GPS from a real run, real H3 res-10 cells,
real permanent append-only storage (D-020), real raw archive in S3 (D-121.2). A faked reveal over
a screenshot would arrive two weeks sooner and be worth nothing, because it would not have proved
a single one of the things that could actually sink this project.

### 2.2 The critical path, exactly

Seven capabilities, in this order, and nothing else:

```
02 deploy-and-auth ──┐
                     ├─► 05 strava-adapter ──► 06 ingest-pipeline ──► 07 fog-projection
04 domain-contract ──┘                                                      │
                                                                            ▼
                                                              08 map-and-fog-renderer
                                                                            │
                                                                   FIRST USABLE ★
03 ticket-capture-endpoint ── (off the critical path, see §4.1)
```

`03` is deliberately *not* on the path but is scheduled inside Phase 1 anyway; §4.1 explains why.

### 2.3 What is deliberately ugly or missing at the milestone

Stated plainly, so nobody mistakes it for a defect and files a ticket:

**Missing entirely**
- **No XP, no levels, no skills.** `xp-rules-v1.yaml` exists and CI validates it (D-141), but
  nothing scores. The number of skills displayed is zero.
- **No `/log` page.** Strength work cannot be recorded at all (D-060/D-061 land in Phase 2).
- **No post-run moment.** No lantern, no fog burning back along the route, no tally, no level-up
  cards. The map just *is* revealed the next time you look at it. `06-ui-ux.md` §3 calls this
  "the most important screen in the app"; it is not built yet, and that is the single biggest
  thing being consciously deferred.
- **No webhook.** Ingest is a **manual Sync button** running `listSince` (§4.5). D-013 is
  therefore *violated* at this milestone — there is one thing to do after a run. It is one tap,
  it is temporary, and it is fixed in capability `14`.
- **No second map mode.** One rendering, tuned toward atlas legibility (D-051 is
  non-negotiable and cheap; D-052's adventure atmosphere is not). No cold-territory channel
  (D-133/D-147) — at week one there is no six-month-old ground to render.
- **No `/dev/tickets` UI**, no chronicle, no settings screen, no run detail page.
- **No notifications.** Nothing tells you the run landed. You open the app and it is there.

**Present but ugly**
- **Unstyled chrome.** The `06-ui-ux.md` §8 token system is *defined* (it costs one file) but
  applied only to the map and one button. No parchment ledger, no gold leaf, no plinth.
- **The basemap is a stock Protomaps `light` flavour**, not the parchment fork. The fog is
  correct; the ground underneath it is generic. This is a deliberate split: the fog shader is
  the hard part and the palette fork is a colour-table edit that can happen any time after.
- **Sign-in is the raw Amplify UI component.** Email + password, passkeys later.
- **One user.** Self-signup off, account created by hand in the Cognito console (`08-security-
  privacy.md` §5.4). No provisioning flow.
- **No error surface.** A failed import fails into CloudWatch. The user finds out because the map
  did not change.

**Explicitly *not* compromised, even at this milestone** — these are cheap now and expensive
to retrofit:
- `activity:read_all` scope and the full `latlng` stream, never `summary_polyline` (D-121.3/.4).
- Raw trace archived to S3 **before** normalize, every time (D-121.2, `01-architecture.md` §3).
- Deterministic `activityId = sha256(user, source, externalId)` and the `IngestReceipt`
  idempotency ledger (D-140, `02-data-model.md` T8). Replay must be safe from the first import.
- No Strava type outside `src/adapters/strava/`, enforced by the CI grep (D-100,
  `contracts/ingestion-contract.md` §5).
- Cells carry `lastRunAt`, not a presence bit (D-120). Getting this wrong is unrecoverable —
  the timestamps cannot be invented later.

---

## 3. Capability breakdown

Nineteen capabilities in dependency-respecting order. Ticket titles are titles only — full
tickets, with acceptance criteria in the `07-ticketsmith.md` §3 format, are authored in Phase 0.
Each capability gets a doc at `docs/capabilities/NN-name.md` (07 §7.2).

`▸` marks a ticket whose omission would break the milestone or an invariant.

---

### PHASE 0 — Ground Truth on Disk

#### `00-preflight-and-repo` — 6 tickets
*Get the account and the repository into a state where the first deploy can succeed on the first
try, and where a secret cannot be committed.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **CloudFront / Route 53 / ACM pre-flight audit** | Run the three `aws` queries in `01-architecture.md` §6, resolve every orphaned `devaultsecurity.com` alias, stale CNAME and failed cert. See §4.4. |
| 2 | ▸ **Rotate the O-005 AWS key and gitignore the agent config** | The key in `~/devaultsecurity/.claude/settings.local.json`. Not leaked; one `git add .` from leaking (`08-security-privacy.md` §7.4). |
| 3 | **Repository skeleton per 07 §7.2** | `tickets/{inbox,open,closed}`, `docs/capabilities/`, `prompts/`, `.claude/skills/tickets/`, `CLAUDE.md`. |
| 4 | ▸ **`.gitignore` and secret scanning, before the first commit** | `08-security-privacy.md` §7.1 list verbatim, plus gitleaks in the PR workflow (§7.3). |
| 5 | **Copy TicketSmith `WORKFLOW.md` / `TEMPLATE.md` / three prompt files** | MIT, retain notice. Two edits only: point at `docs/decisions/`, add the `inbox` state. |
| 6 | ▸ **Author the full MVP backlog into `tickets/open/`** | 07 §7.3 Step 1. The unglamorous session with no tooling. Do **not** seed `tickets/inbox/` (§7.4). |

**Depends on:** nothing. **Done when:** the audit output is pasted into the capability doc with
every finding resolved; `git log` shows a clean initial repo; ~112 tickets exist as files; the
user has signed off (D-001).

#### `01-ticket-system` — 5 tickets
*The system bootstraps itself. Built in the first implementation session by an agent following
the hand-written methodology, with no `/tickets` to help it.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **`tickets.mjs`: parse, index, list, validate** | Frontmatter parse, `index.json` generation, the §4.7 validator. Decides Q-07-1 (index committed vs ignored — lean committed). |
| 2 | ▸ **`tickets.mjs`: allocate, create, start, block, close, triage-move** | ID allocation, `git mv`, the `tickets(#NNNN):` commit. Decides Q-07-3 (dirty-tree refusal). |
| 3 | **Dependency resolution, `next`, and cycle detection** | `depends_on` / `blocked_by` as data, `--ready` filter, cycle detection fails the validator. |
| 4 | ▸ **`/tickets` skill: `SKILL.md` + `reference.md`** | Project skill with subcommands (07 §4.1–4.3), not a bare command file. |
| 5 | ▸ **Validate the entire hand-authored backlog and fix what it finds** | 07 §7.5.1 predicts this finds something. Expect it to. |

**Depends on:** `00`. **Done when:** `/tickets list` prints the whole backlog as one table;
`/tickets next` returns a ticket with no unmet `depends_on`; `validate` is clean; the capability
is closed *using the system itself*, with `## Operator validation` filled in (07 §3.5).

---

### PHASE 1 — The Spine

#### `02-deploy-and-auth` — 6 tickets
*A URL that serves a signed-in page, and a pipeline that will not let broken code reach it.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **Next.js 15 App Router + Amplify Gen 2 backend skeleton** | `amplify/backend.ts`, `defineAuth`, `defineData`, `defineStorage`, `amplify.yml`. |
| 2 | ▸ **GitHub Actions PR gate: `tsc --noEmit`, ESLint, `vitest`** | Same commands in `amplify.yml` so a push to `main` cannot bypass them (`01-architecture.md` §6 CI). |
| 3 | ▸ **Cognito: email sign-in, self-signup OFF, unauthenticated identities OFF** | `08-security-privacy.md` §5.1 — the two lines that matter. Owner account created by hand. |
| 4 | ▸ **Domain association `soles.devaultsecurity.com`** | Existing hosted zone only; claim `soles` alone, drop apex and `www`. Gated on `00`/1. |
| 5 | **App shell, route stubs, and the design-token file** | The seven `06-ui-ux.md` §1.2 routes exist as stubs; `§8.2/8.3` tokens land as CSS variables now so nothing is restyled twice. |
| 6 | **Secrets via SSM `secret()` and a client-bundle leak test** | `01-architecture.md` §7; a test that greps the built bundle for the §7 forbidden list. |

**Depends on:** `00`, `01`. **Done when:** `https://soles.devaultsecurity.com` serves an
authenticated page; a red test blocks a merge; no secret appears in `.next/static`.

#### `03-ticket-capture-endpoint` — 7 tickets
*Closes the D-092 gap without any UI. Deliberately early — see §4.1.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **`POST /api/tickets/capture` → commit to `tickets/inbox/`** | Server-side GitHub integration, fine-grained PAT (07 §6.2). Writes only; never edits. |
| 2 | ▸ **Endpoint hardening** | Shared secret, body size cap, rate limit, no path traversal in the slug (07 §6.4, §6.5). |
| 3 | ▸ **Android quick-capture: Tasker/MacroDroid HTTP task on a QS tile** | D-124. Dictate → POST → done, phone locked. Documented in the capability doc with the exact task export. |
| 4 | **Google Assistant routine as a second capture path** | Same endpoint. Optional; drop it if the Tasker tile is enough. |
| 5 | **Capture-queue semantics for offline** | 07 §5.3; at this stage the queue lives in the Android task's retry, not in the app. |
| 6 | **`/tickets triage` handles inbox files end to end** | Assign `id`, `slug`, `size`, `capability`, `depends_on`; `git mv` to `open/` (07 §2.3, §4.5). |
| 7 | **Runbook: rotating the PAT** | `08-security-privacy.md` §8.2. |

**Depends on:** `01`, `02`. ~~**Done when:** an idea dictated to the phone at the end of a run
appears as a file in `tickets/inbox/` on GitHub within 5 seconds, without unlocking the phone, and
`/tickets triage` turns it into a numbered open ticket. **D-092 is satisfied here**, not at `17`.~~
**Revised 2026-09-03, D-184 — rows 3, 4 and 5 are declined. Done when:** an authenticated
`POST /api/tickets/capture` appears as a file in `tickets/inbox/` on GitHub within 5 seconds, and
`/tickets triage` turns it into a numbered open ticket. **D-092 is satisfied at `17`**, not here.

#### `04-domain-contract-and-rules` — 7 tickets
*The boundary, and the rules file. Nothing that touches an activity may be written before this.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **`src/domain/activity.ts` — `Activity`, `Trace`, `GeoPoint`, `ActivityKind`** | Transcribe `contracts/ingestion-contract.md` §2 exactly. Absolute epoch-ms; three time fields (UTC + naive-local + IANA). That file wins over 01 and 03 (D-140). |
| 2 | ▸ **`src/adapters/types.ts` + `registry.ts`** | `SourceAdapter<TCreds>`, `IngestJob`, `RawArchiveRef`, `listSince` MANDATORY (D-140). `registry.ts` is the only file naming concrete adapters. |
| 3 | ▸ **The four boundary CI tests (T1–T4)** | `contracts/ingestion-contract.md` §5. Includes the grep that fails the build on any Strava identifier outside `src/adapters/strava/` (D-100, D-121.1). |
| 4 | ▸ **`rules/xp-rules-v1.yaml` WITH the `match` block and `matchPriority`** | D-141. **Before the first line of the scorer.** See §4.2. All seven MVP skills as rows: Wayfaring, Vigil, Might, Fortitude, Endurance, Cartography, Constitution. |
| 5 | ▸ **`selectActivitySkills` matcher + the totality/determinism seed-time checks** | `02-data-model.md` §3.4, §3.8; invariant I-26. Ambiguity is a deploy failure, not a 6am-Sunday failure. |
| 6 | ▸ **The Vigil test, permanently in CI** | D-132/D-141: adding Vigil is a YAML row and zero code. `02-data-model.md` §3.5, §3.8. |
| 7 | **Doc corrections: D-145 and the §1.3 `measure` open item** | See §5. |

**Depends on:** `02`. **Done when:** `tsc` passes with zero `any` in `src/domain/`; the four
boundary tests are green; the matcher returns exactly one skill per `measure` across the full
`ActivityKind` × `hasTrace` grid; adding a Vigil row required no diff outside `rules/`.

#### `05-strava-adapter` — 7 tickets
*The only module that knows Strava exists.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **OAuth connect flow with `activity:read_all`** | D-121.3 — the lesser scope returns privacy-zone-truncated traces that would permanently blank the map around home. |
| 2 | ▸ **`client.ts`: token storage in `LostSolesSourceAccount` + refresh** | `02-data-model.md` T7. Not in AppSync; never reaches the client. |
| 3 | ▸ **`listSince(since)`** | Mandatory per D-140 and the manual-sync path (§4.5). |
| 4 | ▸ **Fetch the full `latlng` stream** | D-121.4 — never `summary_polyline`; Douglas-Peucker cuts corners and collapses loops to chords. |
| 5 | ▸ **`normalize.ts` — pure, no network, no clock** | Streams JSON → `{ activity, trace }`. Required to be pure by the rebuild drill (`02-data-model.md` §8.3 step 2). |
| 6 | ▸ **Activity-kind mapping, indoor/no-GPS handling, trace sanitation** | `03-integrations.md` §2.6. A no-GPS run must produce `hasTrace: false` and fall to Vigil *by the matcher*, not by a branch. |
| 7 | **Checked-in real-response fixtures + rate-limit backoff** | `__fixtures__/`; `03-integrations.md` §2.5 budget and backoff. |

**Depends on:** `04`. **Done when:** given a real Strava activity id, the adapter returns a
`{activity, trace}` with ~2,700 points; `normalize` is called in a test with `Date.now` and
`fetch` stubbed to throw and still passes; the boundary grep is green.

#### `06-ingest-pipeline` — 6 tickets
*Archive first, normalize second, persist third — and never twice.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **`pipeline/archive.ts` — raw to S3 BEFORE normalize** | D-121.2. Key `raw/<uid>/<source>/<externalId>/<sha256>.<ext>` — self-describing, which is what makes the drill possible. |
| 2 | ▸ **`IngestReceipt` idempotency ledger (T8)** | Deterministic `activityId = sha256(user, source, externalId)`; replay must not double-award. `01-architecture.md` §4. |
| 3 | ▸ **`pipeline/persist.ts` — write the `Activity` row (T3)** | Inside the transaction. Cells are not (D-144). |
| 4 | ▸ **`process-activity` Lambda + SQS queue + DLQ** | 2048 MB / 900 s. Queue exists now even though only Sync enqueues to it; `14` adds the webhook producer. |
| 5 | ▸ **Manual `Sync` action** | Server action → `listSince` → enqueue. The stopgap the milestone runs on (§4.5). |
| 6 | **Failure handling and DLQ visibility** | `01-architecture.md` §4 failure handling; a failed job is visible somewhere a human looks. |

**Depends on:** `05`. **Done when:** pressing Sync twice in a row produces one `Activity` row,
one raw object, and one receipt; deleting the `Activity` row and re-syncing rebuilds it
identically.

#### `07-fog-projection-and-cells` — 7 tickets
*Trace → H3 → permanent territory. The invariants here cannot be fixed later.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **`domain/fog.ts` — trace → H3 res-10 cell set** | `05-fog-of-war.md` §2.2. Res 10 canonical, never mixed (D-115). |
| 2 | ▸ **Reveal radius (65 m) and corridor fill** | §2.3. Note: every Cartography number scales linearly with this (04 §10) — changing it later is a rebalance. |
| 3 | ▸ **`ExploredCell` writes with `lastRunAt`, outside the ingest transaction** | D-120, D-144. Failure mode is deliberately "map ahead of XP", never the reverse. DynamoDB's 100-item cap vs 40–130 cells/run. |
| 4 | ▸ **Discovery classification: new / cold (>6mo, 50%) / warm (<6mo, 0%)** | D-120. Pure function of `now - lastRunAt`; unit-tested at the boundaries. Feeds `09`, not consumed yet. |
| 5 | ▸ **`explored-r10.bin` generation + `manifest.json` generation counter** | `05-fog-of-war.md` §7.1, `02-data-model.md` §6. Regeneration does not re-read the table (§2.10). |
| 6 | ▸ **Same-run edge cases, out-of-order and backfilled activities, idempotency** | `05-fog-of-war.md` §3.3–3.5. |
| 7 | **Cache invalidation contract between the Lambda and the browser** | `02-data-model.md` §6.4. |

**Depends on:** `06`. **Done when:** a real run produces 40–130 cells; re-processing the same run
changes zero cells and zero timestamps; the blob round-trips to the exact same cell set; a cell
run 7 months ago classifies cold and one run 5 months ago classifies warm.

#### `08-map-and-fog-renderer` — 8 tickets  ★ FIRST USABLE
*The single most technically uncertain capability in the project (§8).*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **pmtiles basemap on Cloudflare R2 + `@protomaps/basemaps` `light`** | Zero egress — the entire reason R2 exists (`01-architecture.md` §1, §8 Risk 1). Stock palette for now. |
| 2 | ▸ **MapLibre GL JS 6.x shell as the home route** | `maplibre-gl@6.6.0`, plain, no deck.gl. DPR capped at 2. |
| 3 | ▸ **Blob loader/decoder: `explored-r10.bin` → typed array of cells** | `05-fog-of-war.md` §7. |
| 4 | ▸ **Custom WebGL2 layer, pass 1: coverage mask** | Instanced soft radial discs at ~1.35× circumradius, unioned with `gl.blendEquation(gl.MAX)`, half-res `R8` FBO. Discs, never hexagons (§4.1). |
| 5 | ▸ **Pass 2: noisy composite** | Full-screen triangle, `smoothstep` perturbed by 3-octave fBm, warm rim glow, `u_maxOpacity` 0.94. |
| 6 | ▸ **Layer order + run polyline overlay** | Fog above basemap *and its labels*; route above the fog; warm cream `#fff2d0` core with amber glow. |
| 7 | ▸ **Zoom bucketing and viewport culling** | `05-fog-of-war.md` §6.1–6.2. This is what makes year-five volume survive. |
| 8 | ▸ **Perf harness against the §6.4 budget on a real mid-range Android phone** | 30 fps cap, `document.hidden` pause, `prefers-reduced-motion` static render. |

**Depends on:** `07`, `02`. **Done when:** ★ **the user imports a real run and sees real
territory revealed** — and the §6.3 frame budget is met on the actual phone, measured, not
assumed. If it is not met, `08` is not done; do not proceed to Phase 2 on a renderer that stutters.

---

### PHASE 2 — The Game Made Visible

#### `09-xp-engine-and-ledger` — 8 tickets
*The first line of the scorer. It may not be written until `04`/4 has shipped (D-141, §4.2).*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **The scorer: activity → per-skill unit counts, via `selectActivitySkills`** | Grouped by `measure`; one strength session trains Might *and* Fortitude (`02-data-model.md` §3.4). No `switch` on skill id, ever. |
| 2 | ▸ **Ground multipliers** | New 100%, re-run half XP to the activity skill, cold ground 50% discovery credit, warm 0% (D-120, D-021). |
| 3 | ▸ **`XpLedgerEntry` (T4): append-only, one row per (activity, skill, reason), each with `xpRulesVersion`** | D-142. `SkillState` is a pure SUM (T2). |
| 4 | ▸ **Level maths: `4L²` to advance, `C(L) = 2(L−1)L(2L−1)/3`, `C(99) = 1,274,196`** | D-130. Cubic, not exponential. Rates: 100 XP/km · pushup 4 · situp 3 · plank 1.5/s · new cell 15. |
| 5 | ▸ **Meta-skill propagation: Cartography and Constitution** | Cartography from new cells (04 §3.3); Constitution = 1/3 of activity XP (§3.4). `feeds` in the ruleset — data, not code. |
| 6 | ▸ **Total Level = Σ level(skill), Total XP = Σ xp(skill)** | Headline number on the home screen. Ceiling is **computed** — enabled rows × `maxLevel`, never a literal (D-192, §5.1). |
| 7 | ▸ **Replay job: delete non-floor rows, write `retained_floor`, `ReplayRun` audit row, `levelHighWater` ratchet** | D-135, D-142. Corrections may only add. Two ratchets: XP floor covers rate changes, `levelHighWater` covers curve changes. |
| 8 | ▸ **`snapshots/skillstate/` writer** | D-143 — the one documented exception to D-101. What was *displayed* is not derivable from raw. |

**Depends on:** `04`, `07`. **Done when:** the `04-game-design.md` §8.2 and §8.3 worked examples
reproduce to the XP; `displayedXp == SUM(ledger)` holds after a replay; a replay with a *lower*
rule set produces a `retained_floor` row and no visible decrease.

#### `10-add-workout` — 5 tickets
*D-060 is forced, not chosen: no API anywhere exposes reps or sets.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **`/log` route: one row per workout type, one tap to log** | D-061/D-062. **Not** per-exercise buttons on the home screen — that is what this decision protects against. |
| 2 | ▸ **The `manual` adapter** | `src/adapters/manual/` behind the same contract; no `Trace`. Strength work is never ingested from Strava. |
| 3 | ▸ **`WorkoutEntry` shape that accommodates sets from day one** | D-062: sets/reps/rest-timer deferred, the data model is not. |
| 4 | **Row anatomy and interaction rules** | `06-ui-ux.md` §6.4: sweaty thumbs, one-handed reach on a large Android phone (§9.2, §9.3). |
| 5 | ▸ **A new workout type arrives as a YAML row only** | §6.5 — the page renders rows from the ruleset. Proven by adding a Pull-ups row in a test and diffing: zero code. |

**Depends on:** `09`. **Done when:** logging 30 pushups and 20 situps in one session awards Might,
Fortitude *and* Constitution correctly, and adding a seventh activity skill requires no `.tsx` diff.

#### `11-skills-panel` — 5 tickets

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **`/skills` panel: every skill, level, bar, Total Level headline** | `06-ui-ux.md` §5.2. |
| 2 | ▸ **`/skills/:skillId` detail sheet** | §5.5. |
| 3 | **Rules that keep it readable in year ten** | §5.3 — the panel must survive 15 skills, not just 7. |
| 4 | ▸ **Vigil renders as a peer of Wayfaring with no special case** | §5.4 — this is the UI half of the D-132 proof. |
| 5 | **Gold-leaf and contrast compliance** | D-148: gold is a fill and a rule, never body text; gold type only ≥24sp or on navy; all floating chrome opaque. |

**Depends on:** `09`. **Done when:** every skill in `xp-rules-v1.yaml` appears with no per-skill
component; contrast is checked against the §8 tokens; Total Level reads the computed ceiling
(D-192 — count the enabled rows in the ruleset; do not hardcode a figure in a test fixture either).

#### `12-post-run-moment` — 8 tickets
*`06-ui-ux.md` §3: "the most important screen in the app, and it is not really a screen."*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **`/run/:activityId` route + entry points** | Push/plinth deep-link auto-plays; cold open does **not** ambush; chronicle opens static with `⟲ Relive`. |
| 2 | ▸ **Beat 1 — the map (0.0 → 2.9 s)** | Camera fly, lantern travels the route, fog burns back behind it. Never preceded by a spinner, a title card or a toast. |
| 3 | ▸ **Beat 2 — the tally (2.9 → 6.0 s)** | Parchment ledger rises, rows count up staggered 240 ms. |
| 4 | ▸ **Beat 3 — level-up cards, queued, 1.4 s each** | Interrupts the tally. |
| 5 | ▸ **D-146 guard: a new skill mints a free Total Level point and must NEVER fire a card** | At the **notification layer**, not the scoring layer. See §5. |
| 6 | **Beats 4 and 5 — chronicle line, frontier line; end state** | Persistent, scrollable, no timeout. |
| 7 | ▸ **Skip, interruption, failure, and the `seen` flag** | One tap always ends it and jumps to the end state, never to the next beat. `seen` is per-device and never affects scoring. |
| 8 | **The no-new-territory fallback** | `06-ui-ux.md` §3.5. A repeat loop must still feel like something happened (D-021 gives it half XP, not nothing). |

**Depends on:** `08`, `09`. **Done when:** the sequence runs in 8.4 s ± 0.3 s on the real phone;
a tap at any point lands on the end state; adding a skill produces no level-up card; the whole
thing is skippable and nothing about it is required.

#### `13-home-plinth-and-chronicle` — 5 tickets

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **The plinth over the map** | `06-ui-ux.md` §2.2: Total Level headline, "1 new run — tap to open", nav to `/skills`, `/log`, settings. |
| 2 | ▸ **Home states** | §2.4: cold start, no runs yet, sync in progress, sync failed. |
| 3 | **`/chronicle` sheet — run list, drag-up from the plinth** | Renders as a sheet; exists as a route so Android back and deep links behave. |
| 4 | **`/settings` — small and boring** | Connect/disconnect source, sign out, account deletion entry point. |
| 5 | **Derived stats feed: new territory per run, lifetime totals** | `05-fog-of-war.md` §8.2, §8.3. |

**Depends on:** `08`, `12`. **Done when:** every route in the §1.2 screen map exists except
`/dev/tickets`, and the Android back button behaves at every depth.

---

### PHASE 3 — Trustworthy and Complete

#### `14-webhook-and-automatic-sync` — 6 tickets
*This is where D-013 is actually satisfied. Until it ships, the app has upkeep.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **`strava-webhook` Lambda + Function URL (`authType: NONE`), 128 MB / 3 s** | The 2-second deadline design (`01-architecture.md` §2). CDK escape hatch — no API Gateway. |
| 2 | ▸ **`hub.challenge` handshake and subscription management** | `08-security-privacy.md` §4.2. |
| 3 | ▸ **Verification, replay protection, rate limiting and cost-DoS defence** | §4.1, §4.3, §4.4. The endpoint must never do the work inline (§4.5) — it enqueues. |
| 4 | ▸ **`token-refresh` scheduled Lambda (every 4 h)** | Refresh before expiry, not on failure. |
| 5 | ▸ **`nightly-reconcile` — `listSince` backstop** | Covers silently dropped webhooks. This is *why* `listSince` is mandatory (D-140). |
| 6 | ~~**Push/plinth notification "your run is on the map"**~~ | **DECLINED 2026-09-03, D-185.** Web push was the last MVP item needing the phone *configured* rather than opened. `0087`'s plinth line `1 new run — tap to open` carries the signal; the ticket's own criterion 10 already required the app to work identically with push denied. |

**Depends on:** `06`, `12`. **Done when:** a run finished on the phone appears on the map with no
user action *(unchanged — D-185 dropped the push, not the automatic path; you learn about the run
from the plinth on next open)*; killing the webhook for a day and running the reconcile recovers the
missed runs.

#### `15-two-map-modes-and-cold-territory` — 5 tickets

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **Fork `@protomaps/basemaps` `light` to parchment** | D-050/D-053. Parchment basemap with dark fog — never dark-on-dark, which destroys reveal contrast. |
| 2 | ▸ **The atlas / adventure toggle** | D-052. `u_noiseAmp` 0.10/0.30, `u_rimAmt` 0.08/0.30, different label placement. |
| 3 | ▸ **What the modes may NOT differ in** | `05-fog-of-war.md` §5.4 — same revealed set, same geometry. Atmosphere may never cost legibility (D-051). |
| 4 | ▸ **Cold territory, atlas mode only** | D-133. Cool desaturation on a **different perceptual channel** from the warm-luminance frontier, clipped two cell-widths inside the coverage mask so the two can never touch (D-147). |
| 5 | **Controls, gestures, and inspecting a past run over the fog** | `06-ui-ux.md` §4.4, §4.5. |

**Depends on:** `08`. **Done when:** both modes render the identical revealed set; a screenshot of
each is pasted into the capability doc; cold ground is visible in atlas and invisible in adventure.

#### `16-rebuild-drill` — 5 tickets
*A recovery path that has never been executed is not a recovery path.*

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **Drill steps 1–3: enumerate `raw/`, normalize in parallel, sort** | `02-data-model.md` §8.3. The self-describing S3 key is the whole mechanism. |
| 2 | ▸ **Drill steps 4–8: re-project cells, replay XP, verify against `manifest.json` `generation` and `cellCount`** | Into new empty tables via a parallel stack. Nothing destructive. |
| 3 | ▸ **CI drill on every build against a ~20-object fixture spanning every `SourceId`** | §8.4. Same code path at 1/200 volume; stops an adapter change silently breaking recovery. |
| 4 | ▸ **EXECUTE THE DRILL FOR REAL, once, before MVP ship** | Against the live archive, into a parallel stack, cutover **not** performed. See §4.3. |
| 5 | ▸ **Account-deletion runbook, executed against a throwaway account** | §8.5 / `08-security-privacy.md` §6.4. |

**Depends on:** `09`, `07`. **Done when:** the real drill has run and its output — object count,
failure count, final `cellCount`, final Total XP vs the snapshot — is pasted into the capability
doc. **This is the ticket that turns D-101 from a claim into a measurement, and it is what proves
the D-121 Strava decision is reversible.**

#### `17-tickets-ui` — 5 tickets
*Last, because `03` already did the load-bearing half.*

| # | Ticket | Description |
|---|---|---|
| 1 | **`/dev/tickets` capture sheet** | `06-ui-ux.md` §7.3. Title + body. Nothing else. |
| 2 | **Browse, grouped by capability, priority-then-id within group** | 07 §5.4. |
| 3 | **`/dev/tickets/:id` detail with `depends_on` status resolved inline** | 07 §5.5. |
| 4 | ▸ **Read cache + GitHub push webhook** | 07 §5.7. **Explicitly a cache** — rebuildable, never authoritative, never read by the agent. |
| 5 | ▸ **Enforce the v1 non-goals** | 07 §5.6: no acceptance-criteria fields, no capability picker, no size picker, no editing from the phone. Resist every temptation. |

**Depends on:** `03`, `13`. **Done when:** browse and detail work offline from the cache, capture
still works when the cache is stale, and no write path exists from the phone other than `inbox/`.

#### `18-mvp-hardening` — 6 tickets

| # | Ticket | Description |
|---|---|---|
| 1 | ▸ **Accessibility and reality checks** | `06-ui-ux.md` §9: sunlight, one-handed reach, sweaty thumbs, reduced motion, the §9.6 table as a checklist. |
| 2 | ▸ **Offline and slow-connection behaviour** | §9.5. The map must degrade, not blank. |
| 3 | ▸ **The D-123 standing conditions, wired not caveated** | `08-security-privacy.md` §2.3–2.5. The three trigger gates must be *code or CI*, not a paragraph. |
| 4 | ▸ **Secrets and dependency audit; incident playbook dry-read** | §3, §7.5, §8. |
| 5 | ▸ **Invariant test sweep: `02-data-model.md` §9 I-1…I-26** | Each invariant either has a test or a documented reason it cannot. |
| 6 | ▸ **MVP definition-of-done sweep (§9 of this document)** | Evaluate every box objectively. |

**Depends on:** everything. **Done when:** §9 is fully checked.

---

## 4. Sequencing calls that need justifying

### 4.1 The bootstrapping paradox, and why `03` ships before `17`

**The paradox** (`07-ticketsmith.md` §7.1): the backlog for building Lost Soles must exist *as
tickets* before there is anything capable of creating tickets. `/tickets` is itself work that
needs a ticket. The capture endpoint is a capability that needs a capability doc. And D-001 says
nothing gets built until the full plan and backlog exist and the user signs off — so the backlog
must exist before the first line of app code.

**It is awkward, not deadlocked, and the reason is D-093.** Because markdown in the repo is the
source of truth and not the database, the ticket system's day-one dependencies are a directory, a
text editor and git. All three exist now. Everything with a runtime — `tickets.mjs`, the skill,
the endpoint, the UI — is an *optimisation* layered onto a system that already works. Had we
chosen DB-as-truth, this section could not be written: the ticket system would live inside the app
it is building and there would be no order of operations that produces it.

**The resolution, as scheduled here:**

1. `00`/6 authors the entire backlog by hand, in the §3 format, with no tooling. This is the
   large unglamorous session nobody can skip. Expect frontmatter errors.
2. `01`/5 runs `validate` over that hand-authored backlog and fixes what it finds. 07 §7.5.1
   predicts it will find something; treat a clean first run as suspicious.
3. `01` closes itself using itself. From that point every session uses the system.

**The recommendation this document makes explicit: `03-ticket-capture-endpoint` — the endpoint
plus a D-124 Android quick-capture tile — ships in Phase 1, well before the ticket UI in `17`.**

The reasoning is 07 §7.5.3 taken seriously. **D-092 is not satisfied until the capture endpoint
ships**, and between sign-off and that point, post-run ideas go to a notes app and get hand-carried
into `tickets/inbox/`. That is a real gap of days to weeks, and it is the strongest argument for
building the endpoint early. Two further reasons:

- **Of the two ticket-capture interfaces, the endpoint — not the `/dev/tickets` UI — is the one
  that carries the load.** A Tasker/MacroDroid HTTP task on a quick-settings tile, or a Google
  Assistant routine, captures a thought *without unlocking the phone*; the `/dev/tickets` sheet
  requires opening the app, navigating, and typing. The tile is likely to remain the fastest path
  even after `17` ships.
  **This sentence is about `03` versus `17` and nothing else.** It is emphatically *not* a claim
  about Lost Soles, whose real product is the map and the skill system — see `00-vision.md`. An
  earlier phrasing ("the endpoint, not the UI, is the real product") was quoted into ticket `0020`
  without this paragraph around it and read there as exactly the claim it is not. Do not re-shorten
  it. D-184.
- **D-124 fixes the platform.** Android. Tasker/MacroDroid HTTP tasks, Assistant routines, PWA
  `share_target`. **Not iOS Shortcuts, not Siri.** Any design that assumes an iOS capture path is
  wrong for this user and must be rejected on sight.

`03` costs seven tickets and buys the entire remaining build a working idea-capture channel. That
is the best return in the plan. It is *not* on the critical path to the first-usable milestone,
and it is scheduled anyway — deliberately, and this is the only place in Phase 1 where a
non-critical-path capability is admitted.

> **Superseded in part, 2026-09-03 — D-184.** The endpoint shipped and stands. **The phone half of
> this argument did not survive contact with the phone**: `0020` (the tile), `0021` (the Assistant
> routine) and `0022` (the task-side retry queue) are **declined**. Two reasons, both faults in this
> section rather than in the tickets: it recommended a **paid** automation app without ever pricing
> it against the D-081 budget, and the bullet above was quotable out of its scope. So the "seven
> tickets" above is now four, and the claim below that **D-092 is satisfied at `03`** is withdrawn —
> D-092 says *"from the app UI"*, and a macro is not an app UI. **D-092 is satisfied at `17`.**
> Until then a post-run idea goes to a notes app and is hand-carried, or is sent from a laptop with
> `tools/capture/capture.sh`. Reversing this costs one re-filed ticket against
> `docs/capabilities/03-capture-tile.md`, which is kept for the purpose.

### 4.2 D-141: `match` lands before the first line of the scorer

**Non-negotiable placement:** `rules/xp-rules-v1.yaml`, complete with the `match` block
(`kinds`, `requiresTrace`, `sources`, `measure`) and `matchPriority`, is **ticket 4 of capability
`04`**. The first line of the scorer is **ticket 1 of capability `09`**. Five capabilities of
distance, two whole phases apart. That is not an accident and it is not padding.

**Why the ordering is load-bearing.** The schema in `04-game-design.md` §1.3 as first published
covered measurement, rating, propagation and presentation, and silently omitted **selection**.
Wayfaring and Vigil come out byte-identical in every field, so a scorer written against that
schema must decide in code:

```ts
// THE FAILURE MODE. If this line is ever written, D-031 is broken and D-132 has failed.
const skill = activity.hasTrace ? "wayfaring" : "vigil"
```

That is a `switch` on skill id. Every future workout type that splits on a condition — indoor
cycling, rowing erg, pool swim — is a Vigil-shaped problem that would extend that branch. D-141
records the value of the exercise exactly: *the defect was caught in planning rather than in
ticket ~15, where every subsequently-added workout type would have compounded the switch.*

**Therefore:** if `09`/1 is ever reached and `04`/4 is not closed, **stop**. Do not write the
scorer against a schema without `match` intending to retrofit it. The retrofit is a rewrite of
every call site plus a data migration of every ledger row's `xpRulesVersion` semantics.

Three supporting placements follow from it:
- `04`/5 — the matcher and its **seed-time** totality/determinism checks. Ambiguity fails the
  deploy, not the 6am Sunday run (invariant I-26).
- `04`/6 — the Vigil test lives in CI **permanently** (`02-data-model.md` §3.8), not as a one-off.
- `10`/5 — the `/log` page renders rows from the ruleset, so a new workout type is still one row
  on the UI side too. The property is worthless if the data layer honours it and the UI does not.

### 4.3 The S3 rebuild drill is a scheduled exercise, not an assumption

D-101 says user-supplied files are the system of record and anything API-sourced is reproducible.
D-121 permits Strava *only because* of that reversibility. **A reversibility that has never been
exercised is a claim, not a property.**

So the drill is scheduled three ways, and all three are tickets:

| When | Form | Ticket |
|---|---|---|
| Every CI build | ~20-object fixture spanning every `SourceId`, asserting §8.3 steps 1–8 | `16`/3 |
| **Once, for real, before MVP ship** | Live archive → parallel stack, cutover **not** performed | `16`/4 |
| Before any D-121 migration | Same drill, run while there is no pressure | (post-MVP, `03-integrations.md` §6) |

`16`/4 is the one that matters and it is the one most likely to be skipped, because by the time
Phase 3 arrives the app works and the drill feels like ceremony. It is not. Its done-condition is
a **pasted result**: object count, `normalize()` failure count, final `cellCount` against
`manifest.json`, final Total XP against the `snapshots/skillstate/` snapshot. If those four
numbers are not in the capability doc, the drill did not happen.

Two constraints the drill imposes on everything upstream, which is why it is designed in now and
not bolted on:
- `normalize()` is **pure** — no network, no clock (`05`/5, contract §3). A drill cannot call
  Strava; the athlete cap may already have removed access.
- The S3 key is **self-describing**: `raw/<uid>/<source>/<externalId>/<sha256>.<ext>`. That is
  the entire reason the key has that shape, and it is why the drill needs nothing but the bucket
  (`06`/1).
- Adapters are deleted only when their raw objects are, which under §8.1 is never. That is the
  standing cost of the D-100 boundary and the reason it is worth paying.

### 4.4 Pre-flight: audit CloudFront before the subdomain exists

**`00`/1 is step zero of the entire project.** Before `02`/4 creates the domain association:

The `devaultsecurity` repo history shows an abandoned S3 + CloudFront + ACM architecture, retired
over unresolvable SSL problems, **whose teardown was never verified**. If any distribution in the
account still carries a `devaultsecurity.com` alias, or a stale Route 53 record points at a dead
distribution, adding `soles.devaultsecurity.com` fails with **`CNAMEAlreadyExistsException`** —
and Amplify's validation polling backs off to *hours* after the first attempt. Getting it right on
the first try is worth an hour of auditing.

Run the three queries in `01-architecture.md` §6 (`list-distributions` filtered on aliases;
`list-resource-record-sets` on the existing zone; `acm list-certificates --region us-east-1`),
then, in order: resolve findings (a disabled-but-existing distribution still holds the alias);
check CAA *first*, because fixing it afterwards requires deleting and re-adding the domain in
Amplify and takes the whole apex down; check the existing app's auto-subdomain setting for a
branch-name collision on `soles`; use the **existing** hosted zone — do not create a second one;
claim `soles` only, removing Amplify's default apex and `www` offer. Expect the raw CloudFront URL
to 404 — Amplify routes by `Host` header. That is not a bug.

Related and same-cost: **`00`/2 rotates the O-005 AWS key before the first commit exists.** It has
not leaked, and it is one `git add .` from leaking.

### 4.5 Manual Sync before the webhook — a deliberate inversion

D-013 forbids upkeep, so a Sync button looks like a violation. It is a temporary one, taken on
purpose:

- The webhook path is a Function URL + a 2-second ack deadline + SQS + subscription management +
  `hub.challenge` + replay protection + cost-DoS defence — capability `14`, six tickets, none of
  which reveal a single hexagon.
- `listSince` is **mandatory** anyway (D-140) because the nightly reconcile needs it to cover
  silently dropped webhooks. Building it first costs nothing; it is required either way.
- A Sync button reaches the first-usable milestone roughly one capability sooner and lets the user
  re-import at will while the projection code is still moving — which, during `07`, is
  constantly.

The honest cost: **between the milestone and capability `14`, the app has upkeep, and D-013 is
not satisfied.** That is stated here so it is a scheduled debt with a named payoff ticket, not a
drift. If the gap between `08` and `14` grows past a few weeks, promote `14` ahead of `15`–`17`.

### 4.6 Why the XP engine is in Phase 2 and not Phase 1

The fog reveal is the product (P4, D-051). XP is the *scoring* of it. Splitting them lets Phase 1
prove the two genuinely uncertain things — the WebGL renderer and third-party ingest — without
also carrying the ledger, the replay floor, the two ratchets and the meta-skill propagation.
`07`/4 computes and stores the discovery classification at ingest time; `09` consumes it. Nothing
is thrown away and no data is lost in the interval, because the cells carry `lastRunAt` from the
first write (D-120) and the ledger is rebuildable from raw (D-101) — modulo the D-143 snapshot,
which does not exist yet and so has nothing to preserve.

---

## 5. Carry-forward corrections

Defects found *during design*. They are written down here so they become tickets rather than
evaporating between documents. Each is already placed in §3; this section is the register.

### 5.1 D-145 — the Total Level ceiling is COMPUTED, not stated
**Ticket: `04`/7 (doc fix) and `09`/6 (implementation).**
> **RESOLVED 2026-09-04 by ticket `0031`, and the resolution is different from the one specified
> here.** This item asked for 594 → 693. By the time it was worked, 693 was *also* wrong: Vigil
> (`0028`) and then Roving and Cadence (`0157`) had each moved the ceiling, and each was a
> data-only change that silently invalidated a hardcoded total. **§1.2 now states the arithmetic
> rather than a number** — enabled rows × `maxLevel` — which is 9 × 99 = **891** at `v1`.
>
> This item also contained an error worth naming: it said adding Slayer "does not move the ceiling
> again, because 693 already counts seven", while §1.2 counted its own seven as *six MVP skills
> plus Slayer*. Two different sevens. The computed form removes the ambiguity: **Slayer ships
> `enabled: false` and does not count until it is enabled.**

Adding Vigil as a fifth activity skill moved the ceiling. `04-game-design.md` §1.2 stated
**594** (6 skills × 99) and was to be corrected to **693** (7 × 99). The MVP skill set was
Wayfaring, Vigil, Might, Fortitude, Endurance, Cartography, Constitution — seven.

Acceptance, as amended by `0031`: `04-game-design.md` §1.2 states the **arithmetic** and not a
number; the ceiling is *computed* as `enabledSkillCount × maxLevel`, never a literal, so the next
skill cannot desynchronise it; a test asserts the computed ceiling equals `Σ maxLevel` over enabled
rows in `xp-rules-v1.yaml`. **The prose half is done (D-192); the code half is `0063`.**

### 5.2 D-146 — adding a skill mints a free Total Level point that must never celebrate
**Ticket: `12`/5.**
Total Level = Σ level(skill). A new skill row starts at level 1, so **Total Level increases by 1
the moment the row is added**, with no work done. That must never fire a level-up card. Any future
workout type hits this; Vigil hits it first.

**Guard it at the notification layer, not the scoring layer** (`06-ui-ux.md` §5.4, §10.5). The
scoring layer is correct — the level genuinely is 1 — and clamping it there would make
`displayedXp == SUM(ledger)` false and break D-142. The notification layer must diff Total Level
*excluding skills whose `firstSeenAt` is this ruleset version*.

Acceptance: a test that adds a skill row to a seeded ruleset, replays, and asserts Total Level
rose by exactly the skill count added **and** that zero level-up cards were queued.

### 5.3 The `04-game-design.md` §1.3 open item — one `measure` per row
**Ticket: `04`/7, as a `design` ticket whose deliverable is an amendment, not code.**

`04-game-design.md` §1.3 records it exactly: *"`measure` per row is exact. A skill that later owns
two exercises needs two measures; whether `match` becomes a list or `measure` accepts a set is an
`02-data-model.md` §3 amendment."*

Concretely: Might is `measure: "reps:pushup"`. If Might should later also be trained by dips or
diamond pushups, one row cannot express it. Two options, and this document does not choose:

| Option | Shape | Cost |
|---|---|---|
| A — `match` becomes a list | `match: [ {…measure: "reps:pushup"}, {…measure: "reps:dip"} ]` | Matcher iterates; `matchPriority` semantics need a tiebreak *within* a row |
| B — `measure` accepts a set | `measure: ["reps:pushup", "reps:dip"]` | Simpler YAML; but `02-data-model.md` §3.4 groups candidates *by* `measure` to award one skill per measure, and a set breaks that grouping directly |

**Recommendation (a guess, flagged as one): option A.** It preserves the "one skill per distinct
`measure`" grouping that invariant I-26 and the whole Might-and-Fortitude-from-one-session
behaviour rest on, and it localises the change to the matcher's candidate enumeration. Option B
looks cheaper and attacks the grouping rule, which is the load-bearing part.

**This is not urgent and must not be built speculatively.** No MVP skill owns two exercises. The
ticket's deliverable is the amendment written down in `02-data-model.md` §3 with the option chosen
and the invariant restated; implementation waits for the first skill that actually needs it. It is
scheduled in `04` only so the decision is made while the schema is fresh in context, not two years
later under pressure from a feature request.

### 5.4 Standing conditions carried into implementation
Not defects, but they expire silently if nobody holds them. Each is a named ticket.

| Condition | Where | Ticket |
|---|---|---|
| **D-123 revisit trigger** — no special home-location handling holds *only* for the single-owner case. Friends, family, sharing or screenshots reopen it. Three hard gates in `08-security-privacy.md` §2.4 | `08` §2.3–2.5 | `18`/3 |
| **O-004** — does Strava write *routes* to Health Connect? Five-minute device check | D-113 | Post-MVP, gates adapter order (§6.4) |
| **Amplify Hosting free-tier perpetuity** — verify in the Billing console | `01` §8 Risk 2 | `02`/1 |
| **Reveal radius 65 m is an assumption** — every Cartography number scales linearly with it | `04` §10 | `07`/2, noted in the capability doc |
| **Region boundaries are an unchosen input** — neighbourhood completion needs an OSM boundary source | `05` §9.8, `04` §10 | Post-MVP; explicitly not in D-122 |

---

## 6. Post-MVP phases

Everything here is OUT of MVP by D-122 and stays out. This section is sequencing, not permission.
The overriding rule from `00-vision.md` §8: **deferred ≠ cancelled**, and the promotion trigger
for every one of them is the same shape — *the MVP has been in daily use for long enough that its
absence is felt*, not *the MVP is finished*.

**The gate on all of them: S1 — six-month retention.** `00-vision.md` §5 names it the only test
that really matters. Nothing below gets promoted before the MVP has survived six months of real
use, with one exception noted in §6.4.

### Phase 4 — Combat (D-040, D-041)
*Sequenced first among the post-MVP work because Slayer is the one designed skill that MVP omits,
and its absence is visible on the skills panel from day one.*

| Capability | Sketch | Why in this order |
|---|---|---|
| `19-player-power-and-slayer` | Player Power derived from skills (`04` §5.2); Slayer skill row; combat resolves **automatically at import time** (D-041) — never a game the user plays | Everything below needs Power to resolve against |
| `20-map-encounters` | Creatures inhabit fogged regions, encountered by running into/near them (`04` §5.3) | Runs-only. Tests the whole loop against a single trigger |
| `21-boss-quests` | Longer-running boss accepts damage from **any** workout, so non-running days count (D-040) | Needs `20`'s resolution engine plus a multi-day state machine — strictly harder |

**Map encounters before boss quests**, explicitly. Encounters are stateless per run and reuse the
cell set that already exists. A boss is a persistent entity with HP across weeks, damage from
heterogeneous sources, and a failure mode (an abandoned boss) that MVP has no analogue for.
Building the stateless one first means the resolution rules are proven before persistence is added.

**Trigger to promote:** the user notices the empty space where Slayer should be, *or* the map has
enough revealed ground that unrevealed pockets have started to feel inert rather than inviting.
**Do not promote on "combat sounds fun."** D-041's whole point is that combat must cost zero
upkeep; a version that asks for a decision is the Habitica trap and must be rejected at design
time, not discovered at ship time.
**Expect a Slayer rebalance.** `04-game-design.md` §10: Slayer's XP scale is unvalidatable until
encounters exist; plan a v2 ruleset and rely on the D-142 ledger and D-135's floor to absorb it.

### Phase 5 — Novelty route planning (D-070)
*"Plan a run by target distance + start point, prioritising new territory."*

R7 found this **unexpectedly cheap: roughly 300–500 lines and about $0.03/month.** That is the
single best cost-to-value ratio in the whole deferred set, and it is the reason it ranks above
equipment despite equipment being simpler.

It is also the most direct expression of D-012 — novelty is the core motivator — and
`05-fog-of-war.md` §8.4 ("unexplored zones near me") is explicitly the route-planner precursor and
is already MVP work. The planner is a consumer of data that will already exist.

Two things it needs that MVP does not build: a routable network (OSM extract or a routing service)
and the §8.4 unexplored-zone scoring surfaced as a first-class query.

**Trigger to promote:** the user opens atlas mode before a run and finds themselves squinting at
the reveal edge trying to work out a loop. That is the feature asking to exist. If after six
months they are still choosing routes fine by eye, the map already did the job and the planner is
a nice-to-have.
**Cheapness is not a reason to promote it early.** It is a reason to promote it *fast once
triggered* — 300–500 lines is one or two capabilities, not a phase.

### Phase 6 — Equipment and loot (D-134)
Last of the game systems, for two reasons. First, D-134 already removed the thing that would make
it urgent: **gear grants no XP multipliers** — combat power, lantern reveal radius and appearance
only — so equipment cannot accelerate progression and its absence costs nothing. Second, its two
real effect surfaces are combat power (needs Phase 4) and lantern reveal radius (a knob on the
`08` renderer, and changing reveal radius rescales every Cartography number — `04` §10).

**Trigger to promote:** combat has shipped and has been in use long enough that its outcomes feel
flat. Not before. Loot with nothing to drop from is a cosmetics shop.

### Phase 7 — Further ingestion adapters
Ordered by D-121's post-MVP note: **Health Connect (D-113) or GPSLogger (D-112), then a watch
vendor (D-117) if hardware is purchased.** Every one of them is a new directory under
`src/adapters/` and nothing else — that is the entire payoff of D-100, and `16`'s drill is what
keeps it true.

| Adapter | State | Trigger to promote |
|---|---|---|
| **Health Connect bridge (D-113)** | Preferred long-term. `ExerciseRoute` carries full GPS; **Google imposes no retention limit**. Reads capped to 30 days without `READ_HEALTH_DATA_HISTORY`; background reads of another app's route always return `ConsentRequired`, so sync is on app-open, not silent — accepted. Sideloaded (D-114), so no Play health declaration, no demo video, no target-SDK deadline | **Blocked on O-004**: does Strava write *routes*, not just summary sessions, to Health Connect? Five-minute device check. If yes, this is the answer to the Strava athlete cap and should be promoted **the moment the cap bites** (§8) |
| **GPSLogger (D-112)** | F-Droid, GPLv2, maintained. Already POSTs finished GPX to an arbitrary HTTPS endpoint. **Zero Android code written by us** — we build only the ingest endpoint D-100 requires anyway. Run continuously it reveals every street *walked* | Promote if O-004 comes back **no**, or immediately as a cheap insurance policy. Note the open question in `04` §10: walks should earn full Cartography and ~50% Wayfaring as an `activityType` multiplier — **one more data row, no code**. Flagged, not decided |
| **Watch vendor (D-117)** | A **Whoop-replacement decision, not a legal necessity**. Suunto Race 2 ($499, ~14 d, real webhook API, non-commercial allowed) / Polar Vantage M3 ($399, self-serve API, no retention cap, ~6 d battery) / Garmin Instinct 3 Solar ($399, ~17 d, best hardware, **no API**). Garmin's developer API is closed and the `garth` workaround died 2026-03-27 | Promote when hardware is actually bought. **Hard constraint: no daily charging** (O-001) — which rules the Polar out on battery and the Garmin out on API, leaving Suunto as the only candidate satisfying both. D-103 means this decision is not blocking and can wait indefinitely |

**The exception to the six-month gate:** if the Strava athlete cap or a terms enforcement fires,
an adapter is promoted immediately regardless of how long the MVP has run. That is what D-100 was
built for and §8 costs it.

---

## 7. Honest sizing

### 7.1 Estimating assumptions — state them so the numbers can be argued with

1. **A ticket is 30 minutes to 2 hours** of an AI agent's focused work, targeting ~1 hour
   (`07-ticketsmith.md` §1.2). A ticket estimated `l` is a smell meaning "split it", not a big
   ticket — so no ticket below is `l` by design.
2. **A session is one agent working session that stops at roughly 60% context** (07 §1.2). In
   practice that is **2–3 tickets per build session**, fewer when the tickets are in unfamiliar
   code, more when they are mechanical. I use **2.5** as the divisor.
3. **Every capability costs one extra DESIGN session** before its tickets are written — that is
   the DESIGN → TICKET-WRITE half of the cycle, and its deliverable is
   `docs/capabilities/NN-name.md`. 19 capabilities = 19 design sessions. **USE and REFLECT are
   folded into the following capability's design session**, which is a compression and is the
   most likely place this estimate is wrong: 07 §1.1 calls those the most-skipped and most
   important steps.
4. **No wall-clock estimate is given.** Sessions per week is a fact about the user's life, not
   about this project, and multiplying by a guessed cadence would launder a guess into a date.
5. **The numbers exclude re-work.** Not because there will be none — see §7.3 — but because
   re-work lands as *new tickets*, and inflating the baseline to hide them makes the count
   useless for tracking. Expect the final ticket count to exceed 117.

**Confidence:** ticket counts are firm (they come from designed capabilities against written
specs). Session counts are ±30% and the three capabilities in §7.3 could each move the total by
several sessions on their own.

### 7.2 Per phase

| Phase | Capabilities | Tickets | Design sessions | Build sessions | Total sessions |
|---|---|---|---|---|---|
| **0 — Ground Truth on Disk** | 2 | **11** | 2 | 6–9 | **8–11** |
| **1 — The Spine** | 7 | **48** | 7 | 18–28 | **25–36** |
| **2 — The Game Made Visible** | 5 | **31** | 5 | 11–18 | **16–24** |
| **3 — Trustworthy and Complete** | 5 | **27** | 5 | 9–15 | **14–20** |
| **TOTAL (MVP)** | **19** | **117** | **19** | **44–70** | **63–91** |

**To the first-usable milestone (end of Phase 0 + Phase 1): 9 capabilities, 59 tickets,
33–47 sessions.** That is roughly half the MVP effort spent before the user sees anything — which
is the honest shape of a project whose product is a custom WebGL layer over a third-party ingest
pipeline, and it is why §2 exists to keep that half as short as it can honestly be.

Phase 0 is inflated relative to its ticket count on purpose: `00`/6 (author the entire backlog by
hand, with no tooling) is a **2–4 session ticket on its own** and violates assumption 1. It is the
one place in the plan where that is unavoidable — D-001 requires the backlog before the build, and
the backlog is the thing being signed off (07 §7.5.2: "there is no way to shorten it").

### 7.3 The three capabilities most likely to overrun

**1. `08-map-and-fog-renderer` — 8 tickets, estimated 3–5 sessions, could be 10.**
This is the single most technically uncertain piece in the project. It is a **hand-written WebGL2
layer inside MapLibre's render loop**: a custom `prerender` pass binding a half-resolution `R8`
framebuffer, instanced disc splatting unioned with `gl.blendEquation(gl.MAX)`, and a composite
pass whose output is judged on *how it looks*, not on whether it passes. Three compounding
reasons it overruns:
- **`gl.MAX` blending is WebGL2-only and there is no fallback** (`05-fog-of-war.md` §9.6 flags the
  WebGL2 assumption). If it misbehaves on the target device, there is no plan B in the design.
- **Aesthetic tickets have no natural stopping point.** "The mist boundary reads as weather, not
  as a honeycomb" is not a passing test. R4 gives numbers (1.35× circumradius; below 1.15
  scallops, above 1.6 inflates) which helps enormously — but the last 20% is taste iteration.
- **The perf budget is measured on real hardware** (`08`/8), and if it misses, the fix is `07`
  (zoom bucketing, culling) or the mask resolution, i.e. it reaches backwards into shipped work.

**2. `12-post-run-moment` — 8 tickets, estimated 3–4 sessions, could be 8.**
`06-ui-ux.md` §3 specifies this "to the frame" — 8.4 s across five beats with named
timings — which removes the design risk but not the *feel* risk. It is choreography: a camera
flight, a lantern travelling a polyline while the fog burns back behind it (which means driving
the `08` mask from an animation, not from the cell set), a ledger rising, staggered count-ups,
interrupting level-up cards, and a skip that must land on the end state from any point. Each beat
is individually easy and the composition is where the time goes. It also depends on `08` in a way
no other capability does — a renderer change late in `12` is a `08` regression.

**3. `05-strava-adapter` — 7 tickets, estimated 3 sessions, could be 7.**
Not because it is hard, but because **it is the only capability whose counterparty is a hostile
third party**. OAuth redirect handling, token refresh, rate-limit backoff, real-response fixtures,
and undocumented behaviour in `latlng` streams for indoor and manual activities
(`03-integrations.md` §2.6). Every one of those bugs is discovered against a live service on
someone else's schedule. And it carries the athlete-cap risk (§8.1) — a failure here is not a bug
to fix but a migration to run.

**Runner-up, named because it will surprise someone: `09-xp-engine-and-ledger`.** Ticket 7 (the
replay job, `retained_floor` rows, `ReplayRun` audit row, the `levelHighWater` second ratchet) is
the subtlest logic in the project. It is very well specified (D-142, `02-data-model.md` §4.4–4.7),
which is why it is a runner-up and not in the top three — but "well specified" and "easy to get
right" are different properties.

**Where I am guessing:** all three multipliers above. I have specs, not code. The ranking is
confident; the magnitudes are estimates.

---

## 8. Risks to the schedule

Ordered by expected damage, not by probability.

### 8.1 The Strava athlete cap (D-102, D-121)
**Likelihood: moderate over the MVP's life. Damage: an unplanned migration mid-build.**

The verified risk profile: the integration **violates Strava's written terms — unambiguously**.
Enforcement against a 6-user app is under 1%. But 2026 enforcement targets **athlete caps, not
storage**: apps have been downgraded 9,999 → 1 without notice, and **nobody has graduated past 10
athletes since 2026-06-01**. The failure mode is friends being locked out, not data being deleted.

That is genuinely benign for MVP — D-122 puts friends and family out of scope anyway — with one
sharp edge: a downgrade to 1 athlete is survivable *only if the owner is that one athlete*. A
downgrade to 0, or a revoked client, is a hard stop on ingest.

**Mitigations, all already scheduled:**
- **`16`/4, the executed rebuild drill, is the mitigation.** It is what makes the answer to
  "Strava cut us off" be "run the drill, swap the adapter directory" rather than "start over."
- The D-121 non-negotiables are enforced in code from Phase 1, not retrofitted: adapter boundary
  (`04`/3 CI grep), raw archived before normalize (`06`/1), `activity:read_all` (`05`/1), full
  `latlng` (`05`/4).
- `03-integrations.md` §2.8 defines **trigger conditions — migrate when any of these fire**. Those
  triggers must be *watched*, and the honest weakness in this plan is that nothing watches them
  automatically. Mitigation: the `05` capability doc carries the trigger list, and `14`/5's
  nightly reconcile failing repeatedly is the de-facto alarm.
- **If a trigger fires, promote Health Connect or GPSLogger immediately** (§6.4), bypassing the
  six-month gate. GPSLogger is the faster answer — zero Android code written by us — and is the
  reason to keep it as the standing insurance policy even if Health Connect is preferred.

**I advised against D-121 and the user reaffirmed it. It is being built. This section is the
price, written down.**

### 8.2 The WebGL fog renderer is the single most technically uncertain piece
**Likelihood: high that it costs more than estimated. Damage: it sits on the critical path to the
first-usable milestone.**

Everything in §7.3.1 applies. The schedule-specific danger is *position*: `08` is the last
capability before the milestone, so every session it overruns is a session the user still has
nothing to use — which is precisely what §2 exists to prevent.

**Mitigations:**
- **Spike the mask pass first.** `08`/4 against a hard-coded array of a few hundred cells, before
  `08`/3's real decoder. If `gl.MAX` on a half-res `R8` FBO inside MapLibre's `prerender` does not
  work on the target phone, that must be known in session one of `08`, not session five.
- **Ship the milestone on a stock basemap** (`08`/1). The parchment fork is `15`/1, deliberately
  after the milestone. Colour work must never delay the reveal.
- **Do not retry what R4 already ruled out** (`05-fog-of-war.md` §4.6). That list is a schedule
  asset; re-deriving it costs sessions.
- **A defined retreat.** If the custom layer defeats the schedule, a GeoJSON-polygon fog layer in
  plain MapLibre reveals real territory — ugly, faceted, and honest — and reaches the milestone.
  It is **not** the design (§4.1 is emphatic: hexagons survive every blur you can afford) and it
  must be recorded as debt with a ticket to replace it. **This is a schedule retreat, not a design
  change.** It is offered only because the alternative is missing the milestone entirely.

### 8.3 Amplify Gen 2 is the user's first
`01-architecture.md` §1 names it: this is the first Gen 2 backend. The CDK escape hatch
(`backend.createStack`) carries four resources — the three machine-only DynamoDB tables, the SQS
queue, and the webhook Function URL — and escape-hatch work is where unfamiliarity costs most.
**Mitigation:** `02` does the deploy end to end with an empty backend *before* any of it, so
deploy problems are never entangled with logic problems. Also inherited from the existing repo
(`01` §6): **Amplify's clean `npm ci` environment is stricter than local** — path aliases that
resolved locally did not, and a whole `src/layouts` directory was missing from a commit. Verify
every new path alias and confirm every new file actually landed in the commit.

### 8.4 The domain association stalls
`CNAMEAlreadyExistsException`, and Amplify's validation polling backs off to **hours** after the
first failure. A day lost to a fifteen-minute audit. **Mitigation: `00`/1, before anything.** See
§4.4. Second-order: a CAA record fixed *after* the association requires deleting and re-adding the
domain, taking the whole apex down — so CAA is checked first, not second.

### 8.5 Cost drifts past the D-083 target
Target is a few dollars a month; the estimate is $1–5 all-in. Two named risks: **pmtiles egress**
(mitigated structurally — the tiles live on Cloudflare R2 at zero egress, `01` §8 Risk 1) and
**free-tier perpetuity being genuinely ambiguous** (`01` §8 Risk 2). Deliberately absent: VPC, NAT
Gateway ($33/mo, ~10× the budget, D-081), RDS, API Gateway, WAF, Secrets Manager, any tile server,
any always-on compute. **Mitigation:** verify free-tier perpetuity in the Billing console during
`02` (§5.4), and set a billing alarm at $10 in the same ticket. Cost is a *schedule* risk because
the fix for a surprise bill is architectural rework.

### 8.6 The plan's own upkeep — the Habitica risk turned inward
The most likely way this project fails is not technical. It is that the ceremony designed to keep
it honest — capability docs, DESIGN and REFLECT steps, `## Operator validation` on every close —
becomes the thing that makes it a job. That is exactly what D-013 records about Habitica.

**Mitigations, and they are real ones:**
- **The first-usable milestone is the primary mitigation.** A system in use generates motivation;
  a system in construction consumes it.
- **`03` at Phase 1** means an idea captured after a run costs one dictation, not a session.
- **`/tickets list` reads `index.json`, not twelve files** — the O(n)-context-tax-per-session
  problem TicketSmith has at 60 open tickets, and this backlog opens at 117.
- **Capabilities are 3–8 tickets and useful on their own.** Every one of the nineteen is a
  legitimate stopping point. The plan is designed to be abandoned partway without waste — which is
  the only kind of plan that survives contact with a hobby project.

### 8.7 Scope creep from the post-run moment
`06-ui-ux.md` §3 calls it the most important screen in the app and gives it a disproportionate
budget. It will invite polish forever. **Mitigation:** its done-condition (§3, `12`) is timing and
skippability, not delight. `06-ui-ux.md` §10 is a list of things deliberately not built and it is
binding — file a ticket, do not extend one (07 §1.2: never expand a ticket's scope).

---

## 9. Definition of done for MVP

Every box is objectively evaluable — a command that exits zero, a file that exists, a number that
matches, or a physical act performed. Nothing here reads "feels good". `18`/6 is the ticket that
walks this list.

### 9.1 Scope — D-122, exactly

- [ ] A real Strava run imports and reveals territory that persists across sessions and deploys.
- [ ] **Both** map modes exist and are toggleable (D-052), and render an identical revealed set.
- [ ] All **seven** MVP skills exist as rows in `xp-rules-v1.yaml` and appear on `/skills`:
      Wayfaring, Vigil, Might, Fortitude, Endurance, Cartography, Constitution.
- [ ] XP and levels are computed and displayed; Total Level and Total XP are on the home screen.
- [ ] `/log` records pushups, situps and planks in one tap each (D-061, D-062).
- [ ] `/tickets` works and `/dev/tickets` capture works (D-090, D-091, D-092).
- [ ] **Nothing built from the OUT list**: no combat, no encounters, no boss quests, no route
      planning, no equipment, no loot. Verified by grep for the absence of those modules.

### 9.2 Invariants — mechanically checked

- [ ] `grep` for Strava identifiers outside `src/adapters/strava/` returns nothing, and that grep
      **fails the build** (D-100, D-121.1, contract §5).
- [ ] The four boundary tests T1–T4 pass in CI.
- [ ] Adding a skill to `xp-rules-v1.yaml` produces a working skill with **zero** diff outside
      `rules/` — proven by the permanent Vigil test (D-031, D-132, D-141).
- [ ] The matcher returns exactly one skill per `measure` across the full `ActivityKind` ×
      `hasTrace` grid; ambiguity is a **seed-time** hard error (I-26).
- [ ] `displayedXp == SUM(ledger)` after a full replay (D-142).
- [ ] A replay against a *lower* ruleset produces `retained_floor` rows and **no** visible
      decrease (D-135).
- [ ] Total Level ceiling is computed as `enabledSkillCount × maxLevel`, never a literal
      (D-145, D-192). Do not write the current figure here — that is what made it wrong three times.
- [ ] Adding a skill fires **zero** level-up cards (D-146).
- [ ] Re-processing an already-ingested activity changes zero cells, zero timestamps, zero ledger
      rows (idempotency, T8).
- [ ] Every explored cell carries `lastRunAt`, and no code path writes a presence bit (D-120).
- [ ] The map has never re-fogged. Revealed ground is still revealed (D-020).
- [ ] `02-data-model.md` §9 invariants I-1…I-26: each has a test, or a written reason it cannot.

### 9.3 Reversibility — the D-101 / D-121 proof

- [ ] Every ingested activity has a raw object in `s3://…/raw/<uid>/<source>/<externalId>/
      <sha256>.<ext>`, written **before** normalize. Object count equals activity count.
- [ ] `normalize()` passes with `fetch` and `Date.now` stubbed to throw (purity).
- [ ] The CI rebuild drill runs on every build against the fixture and asserts §8.3 steps 1–8.
- [ ] **The full drill has been executed once, for real, against the live archive**, into a
      parallel stack, cutover not performed — and its four numbers (object count, normalize
      failures, final `cellCount` vs `manifest.json`, final Total XP vs the snapshot) are pasted
      into `docs/capabilities/16-rebuild-drill.md`.
- [ ] `snapshots/skillstate/` is being written (D-143).
- [ ] The account-deletion runbook has been executed against a throwaway account
      (`02-data-model.md` §8.5).

### 9.4 Operational

- [ ] `https://soles.devaultsecurity.com` serves the app over valid TLS.
- [ ] A run finished on the phone appears on the map **with no user action** (D-013). The Sync
      button may remain as a manual fallback; it must not be the only path.
- [ ] `token-refresh` and `nightly-reconcile` have both run successfully on schedule at least once.
- [ ] A poisoned message lands in the DLQ and is visible somewhere a human looks.
- [ ] Cognito self-signup is OFF and unauthenticated identities are OFF (`08` §5.1).
- [ ] No secret in the client bundle — the §7 forbidden-list grep passes against `.next/static`.
- [ ] gitleaks passes on the full history; the O-005 key is rotated and its file is gitignored.
- [ ] A billing alarm exists at $10/month, and one month of real billing is at or under the D-083
      target of a few dollars.

### 9.5 The product, on the actual device

Evaluated on the user's own Android phone (D-124), not a simulator.

- [ ] The `05-fog-of-war.md` §6.3 frame budget is **measured** and met at year-one cell volume.
- [ ] The post-run sequence completes in **8.4 s ± 0.3 s** and one tap from any beat lands on the
      end state.
- [ ] `prefers-reduced-motion` renders the fog static and stops the rAF loop.
- [ ] The `06-ui-ux.md` §9.6 reality-check table passes: sunlight, one-handed reach, sweaty thumbs.
- [ ] Gold appears only as fill or rule, or as type at ≥24sp or on navy; all floating chrome is
      opaque (D-148).
- [ ] Street names are legible in **both** modes at planning zoom. Atmosphere never cost
      legibility (D-051 — non-negotiable).

### 9.6 The one test that is not on this list

`00-vision.md` §5 names **S1 — six-month retention** as the only test that really matters, and it
cannot be evaluated at ship. It is recorded here so nobody mistakes a green checklist for success:
**this list defines when MVP is built. It does not define when Lost Soles has worked.**
That is settled six months later, by whether the user is still opening it.
