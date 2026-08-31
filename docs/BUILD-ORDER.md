# Build order

> **Generated from the dependency graph.** A fallback and a reference, not a second source of
> truth. From ticket `0009` onward **`/tickets next` computes this live** and supersedes this file —
> a hand-maintained order goes stale the first time a ticket is split. Until then (`0001`–`0008`),
> this is how you know what comes next.

Topological sort of `depends_on`, tie-broken by capability, then priority, then id. Session
grouping follows **D-151**: 2–3 tickets per session within a capability, always clear at a
capability boundary, **one ticket per session** in `08`, `09`, `12`.

**120 open tickets · 62 sessions · 19 capabilities**

---


## `00-preflight-and-repo`

**Session 1** — `0001` · `0002` · `0003`
- `0001` CloudFront / Route 53 / ACM pre-flight audit of the devaultsecurity AWS account
- `0002` Rotate the O-005 AWS access key and gitignore the agent config that contains it
- `0003` Create the repository skeleton per 07-ticketsmith §7.2

**Session 2** — `0004` · `0120` · `0005`
- `0004` .gitignore and secret scanning, in place before the first commit
- `0120` docs/INDEX.md — a section map so design docs are read by section, never whole
- `0005` Copy TicketSmith WORKFLOW.md, TEMPLATE.md and the three prompt files, with two edits


## `01-ticket-system`

**Session 3** — `0007` · `0008` · `0009`
- `0007` tickets.mjs — frontmatter parse, index.json generation, list, and the validator
- `0008` tickets.mjs — allocate, create, start, block, unblock, close, triage-move
- `0009` Dependency resolution, the ready set, `next`, and cycle detection

**Session 4** — `0010` · `0011` · `0121`
- `0010` The /tickets project skill — SKILL.md and reference.md
- `0011` Validate the entire hand-authored backlog and fix everything it finds
- `0121` /tickets audit — run the capability close audit and refuse to advance until it passes


## `02-deploy-and-auth`

**Session 5** — `0012` · `0013` · `0014`
- `0012` Next.js 15 App Router project and Amplify Gen 2 backend skeleton
- `0013` GitHub Actions PR gate — tsc --noEmit, ESLint, vitest, mirrored in amplify.yml
- `0014` Cognito — email sign-in, self-signup OFF, unauthenticated identities OFF

**Session 6** — `0015` · `0017` · `0016`
- `0015` Domain association for soles.devaultsecurity.com
- `0017` Secrets via SSM secret() and a client-bundle leak test in CI
- `0016` App shell, the seven route stubs, and the design-token file


## `03-ticket-capture-endpoint`

**Session 7** — `0018` · `0019` · `0020`
- `0018` POST /api/tickets/capture commits a new file to tickets/inbox/
- `0019` Harden the capture endpoint - owner auth, server-derived path, size and rate limits, idempotency
- `0020` Android quick-capture - Tasker/MacroDroid HTTP task on a quick-settings tile

**Session 8** — `0023` · `0022` · `0024`
- `0023` /tickets triage handles inbox files end to end
- `0022` Capture-queue semantics for offline - retry lives in the Android task, not the app
- `0024` Runbook - rotating and revoking the GitHub PAT

**Session 9** — `0021`
- `0021` Google Assistant routine as a second capture path


## `04-domain-contract-and-rules`

**Session 10** — `0025` · `0026` · `0027`
- `0025` src/domain/activity.ts - Activity, Trace, GeoPoint, ActivityKind, transcribed from the canonical contract
- `0026` src/adapters/types.ts and registry.ts - SourceAdapter, IngestJob, IngestCommand, mandatory listSince
- `0027` The four boundary CI tests (T1-T4) that prove the D-100 adapter boundary holds

**Session 11** — `0028` · `0029` · `0030`
- `0028` rules/xp-rules-v1.yaml WITH the match block and matchPriority - before the first line of the scorer
- `0029` selectActivitySkills matcher plus the seed-time totality and determinism checks
- `0030` The Vigil test, permanently in CI - adding a skill is a YAML row and zero code

**Session 12** — `0031`
- `0031` Doc corrections - D-145 Total Level ceiling, D-146 free level point, and the 04 section 1.3 match/measure amendment


## `05-strava-adapter`

**Session 13** — `0032` · `0033` · `0034`
- `0032` Strava OAuth connect flow with activity:read_all - and a callback that refuses the lesser scope
- `0033` strava/client.ts - token storage in SourceAccount (T7) and rotating-refresh-token handling
- `0034` strava listSince(since) - the mandatory reconciliation sweep and the manual-sync producer

**Session 14** — `0035` · `0036` · `0037`
- `0035` Fetch the full latlng stream - never summary_polyline, and never send resolution/series_type
- `0036` strava/normalize.ts - pure, no network, no clock, streams JSON to { activity, trace }
- `0037` Activity-kind mapping on sport_type, indoor/no-GPS handling, and trace sanitation

**Session 15** — `0038`
- `0038` Checked-in real-response fixtures, the fidelity floor, and rate-limit backoff


## `06-ingest-pipeline`

**Session 16** — `0039` · `0040` · `0041`
- `0039` pipeline/archive.ts — write the raw source payload to S3 before normalize runs
- `0040` IngestReceipt idempotency ledger with deterministic activityId
- `0041` pipeline/persist.ts — write the Activity row inside the ingest transaction

**Session 17** — `0042` · `0043` · `0044`
- `0042` process-activity Lambda, SQS queue and DLQ via the CDK escape hatch
- `0043` Manual Sync action — listSince, then enqueue
- `0044` Failure handling and DLQ visibility — a failed job must be visible somewhere a human looks


## `07-fog-projection-and-cells`

**Session 18** — `0045` · `0046` · `0047`
- `0045` domain/fog.ts — traceToCells, a pure trace → H3 res-10 cell Set
- `0046` REVEAL_R_M = 65 m exact-radius filter and corridor fill
- `0047` ExploredCell writes — firstRunAt via min, lastRunAt via max, outside the ingest transaction

**Session 19** — `0048` · `0049` · `0050`
- `0048` Discovery classification — new / re-armed (>6mo, 50%) / cooled (<6mo, 0%)
- `0049` explored-r10.bin generation, aggregates, and the manifest generation counter
- `0050` Same-run edge cases, out-of-order and backfilled activities, score-time idempotency

**Session 20** — `0051`
- `0051` Cache invalidation contract between the ingest Lambda and the browser


## `08-map-and-fog-renderer`

**Session 21** — `0052`
- `0052` Protomaps PMTiles basemap on Cloudflare R2 with the stock light flavour

**Session 22** — `0053`
- `0053` MapLibre GL JS 6.x shell as the home route, DPR capped at 2

**Session 23** — `0054`
- `0054` Client blob loader and decoder — explored-r10.bin to a sorted typed array

**Session 24** — `0118`
- `0118` Spike — prove gl.MAX on a half-res R8 FBO inside MapLibre's prerender works on the target Android phone

**Session 25** — `0055`
- `0055` Custom WebGL2 layer, pass 1 — instanced soft-disc coverage mask in prerender

**Session 26** — `0056`
- `0056` Pass 2 — noisy composite: fBm-perturbed smoothstep with a warm rim glow

**Session 27** — `0057`
- `0057` Layer order — fog above labels, run polyline above the fog

**Session 28** — `0058`
- `0058` Zoom bucketing and two-level viewport culling

**Session 29** — `0059`
- `0059` Perf harness against the §6.4 budget on a real mid-range Android phone — FIRST USABLE

**Session 30** — `0119`
- `0119` Tune the fog atmosphere against atlas legibility — time-boxed


## `09-xp-engine-and-ledger`

**Session 31** — `0060`
- `0060` The scorer — activity to per-skill unit counts via selectActivitySkills

**Session 32** — `0061`
- `0061` Ground multipliers — new, re-armed and recent ground (D-120)

**Session 33** — `0062`
- `0062` XpLedgerEntry (T4) — append-only, one row per (activity, skill, reason)

**Session 34** — `0063`
- `0063` Level maths — 4L^2, C(L), Total Level and the 693 ceiling (D-130, D-145)

**Session 35** — `0064`
- `0064` Meta-skill propagation — Cartography and Constitution via feeds

**Session 36** — `0065`
- `0065` D-146 — a new skill mints a free Total Level point that must never celebrate

**Session 37** — `0066`
- `0066` Replay job — clear non-floor rows, write retained_floor, ReplayRun audit, levelHighWater

**Session 38** — `0067`
- `0067` snapshots/skillstate/ writer — the one documented exception to D-101


## `10-add-workout`

**Session 39** — `0070` · `0068` · `0069`
- `0070` WorkoutEntry shape that accommodates sets from day one
- `0068` /log route — one row per workout type, one tap to log
- `0069` The manual adapter — src/adapters/manual/ behind the ingestion contract

**Session 40** — `0071` · `0072`
- `0071` /log row anatomy and interaction rules — sweaty thumbs, one hand
- `0072` A new workout type arrives as a YAML row only — proven by a zero-diff test


## `11-skills-panel`

**Session 41** — `0073` · `0074` · `0075`
- `0073` /skills panel — every skill, level, bar, Total Level headline
- `0074` /skills/:skillId detail sheet
- `0075` The rules that keep the skills panel readable in year ten

**Session 42** — `0076` · `0077`
- `0076` Vigil renders as a peer of Wayfaring with no special case — the UI half of D-132
- `0077` Gold-leaf and contrast compliance on the skills panel (D-148)


## `12-post-run-moment`

**Session 43** — `0078`
- `0078` /run/:activityId route, its four entry points, and the persistent end state

**Session 44** — `0079`
- `0079` Drive the 08 coverage mask from an animation clock, not from the cell set

**Session 45** — `0080`
- `0080` Beat 1 — the map (0.0 to 2.9 s): camera, lantern, route ink, three kinds of ground

**Session 46** — `0081`
- `0081` Beat 2 — the parchment tally (2.9 to 6.0 s), staggered count-ups, and never a zero

**Session 47** — `0082`
- `0082` Beat 3 — queued level-up cards, and the D-146 guard that must never let one fire

**Session 48** — `0083`
- `0083` Beats 4 and 5 — the chronicle line and the frontier line

**Session 49** — `0084`
- `0084` Skip, interruption, reduced motion, WebGL loss, backfill, and the per-device seen flag

**Session 50** — `0085`
- `0085` The no-new-territory fallback — the permanent trace layer and a run that still counts


## `13-home-plinth-and-chronicle`

**Session 51** — `0086` · `0087` · `0088`
- `0086` The plinth over the map — Total Level, cells revealed, last run, three destinations
- `0087` Home screen states — cold start, nothing imported, sync in progress, sync failed, offline
- `0088` /chronicle — the run list as a sheet dragged up from the plinth

**Session 52** — `0089` · `0090`
- `0089` /settings — connect/disconnect source, sign out, account deletion entry point
- `0090` Derived stats feed — per-run territory counts, lifetime totals, and the frontier primitive


## `14-webhook-and-automatic-sync`

**Session 53** — `0091` · `0092` · `0093`
- `0091` strava-webhook Lambda behind a Function URL, added via the CDK escape hatch, acking in 2 s
- `0092` The hub.challenge handshake (the key has a dot) and subscription lifecycle management
- `0093` Event validation, replay idempotency, deauthorization, and cost-DoS defence

**Session 54** — `0094` · `0095` · `0096`
- `0094` token-refresh scheduled Lambda — refresh before expiry, every 4 hours, never on failure
- `0095` The reconciliation sweep — listSince backstop for silently dropped webhooks
- `0096` "Your run is on the map" — the one notification, deep-linking to /run/:id


## `15-two-map-modes-and-cold-territory`

**Session 55** — `0097` · `0098` · `0099`
- `0097` Fork @protomaps/basemaps light into the parchment style, in two variants
- `0098` The atlas / adventure toggle — uniforms, style variants, 320 ms cross-fade
- `0099` What the modes may NOT differ in — revealed set and geometry parity, enforced

**Session 56** — `0100` · `0101`
- `0100` Cold territory wash, atlas mode only, on a different perceptual channel
- `0101` Map controls, gestures, and inspecting a past run over the fog


## `16-rebuild-drill`

**Session 57** — `0102` · `0103` · `0104`
- `0102` Rebuild drill steps 1-3 — enumerate raw/, normalize in parallel, sort
- `0103` Rebuild drill steps 4-8 — re-project cells, fold, replay XP, verify, cut over never
- `0104` CI rebuild drill on every build against a ~20-object fixture spanning every SourceId

**Session 58** — `0105` · `0106`
- `0105` EXECUTE THE DRILL FOR REAL, once, before MVP ship — four numbers pasted or it did not happen
- `0106` Account-deletion runbook, executed once against a throwaway account


## `17-tickets-ui`

**Session 59** — `0107` · `0110` · `0108`
- `0107` /dev/tickets capture sheet — title, body, two chip rows, Save
- `0110` Ticket read cache + GitHub push webhook — explicitly a cache, never authoritative
- `0108` Browse tickets, grouped by capability, priority-then-id within group

**Session 60** — `0109` · `0111`
- `0109` /dev/tickets/:id detail with depends_on status resolved inline
- `0111` Enforce the v1 non-goals — create and browse only, no write path from the phone


## `18-mvp-hardening`

**Session 61** — `0112` · `0113` · `0114`
- `0112` Accessibility and reality checks — sunlight, one-handed reach, sweaty thumbs, reduced motion
- `0113` Offline and slow-connection behaviour — the map degrades, never blanks
- `0114` The D-123 standing conditions, wired as code and CI rather than caveated

**Session 62** — `0115` · `0116` · `0117`
- `0115` Secrets and dependency audit; incident playbook dry-read
- `0116` Invariant test sweep — 02-data-model.md §9 I-1 through I-26
- `0117` MVP definition-of-done sweep — evaluate every box in roadmap §9 objectively


---

At the end of every capability run the close audit (`docs/capabilities/AUDIT.md`).
Capabilities `00` and `01` are audited by hand; from `02` onward `/tickets audit` blocks advance.
