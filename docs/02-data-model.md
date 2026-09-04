# 02 — Data Model & Persistence

**Project:** Lost Soles
**Status:** Design. No code exists. This document is what an implementer builds from.
**Date:** 2026-08-30
**Authority:** `docs/decisions/DECISIONS.md`. Every `D-xxx` cited is settled and user-confirmed.
Nothing here may contradict it.
**Canonical types:** `docs/contracts/ingestion-contract.md` defines `Activity`, `Trace`,
`GeoPoint`, `RawArchiveRef`, `SourceRef`, `WorkoutSet`, `NormalizedIngest` and `SourceAdapter`
(D-140). **This document never redefines them.** It defines only how they are *stored*, plus the
game-layer entities the contract deliberately excludes (conflict #7: `kind` is a fact, `skill` is
a game decision).

**Companions:** `01-architecture.md` (AWS topology), `04-game-design.md` (skills, XP curve),
`05-fog-of-war.md` (cells, scoring, delivery format).

---

## Contents

1. [Storage map](#1-storage-map)
2. [DynamoDB table design](#2-dynamodb-table-design)
3. [The skill schema — skills are data, not code](#3-the-skill-schema--skills-are-data-not-code)
4. [The XP ledger](#4-the-xp-ledger)
5. [Access patterns](#5-access-patterns)
6. [The client payload](#6-the-client-payload)
7. [Migrations and versioning](#7-migrations-and-versioning)
8. [Retention, deletion, and the rebuild drill](#8-retention-deletion-and-the-rebuild-drill)
9. [Invariants an implementer must not violate](#9-invariants-an-implementer-must-not-violate)

---

## 1. Storage map

### 1.1 The layering, stated once

`04-game-design.md` §7.1 states the invariant this whole document is built to satisfy:

> **Store facts. Derive XP. Never store XP as a fact.**

Four layers, in strictly decreasing order of authority:

| Layer | Where | System of record? | Rebuildable from |
|---|---|---|---|
| **Raw** | S3 `raw/…` — original Strava JSON / GPX / FIT / manual-log JSON | **YES — D-101.** The only authority. | nothing. This is bedrock. |
| **Rules** | Git repo `rules/xp-rules-vN.yaml`, mirrored to S3 `rules/` | **YES.** Immutable once shipped. | git history |
| **Facts** | DynamoDB `Activity`; S3 `traces/`, `cells/` | rebuildable | raw + `normalize()` (a *pure* function — the contract §3 makes this the migration seam) |
| **Derived** | DynamoDB `ExploredCell`, `XpLedgerEntry`, `SkillState`; S3 `explored-*.bin` | rebuildable | facts + rules |
| **Ephemeral** | DynamoDB `IngestReceipt` (TTL 90 d); IndexedDB in the browser | discardable | nothing needed |
| **Secrets** | DynamoDB `SourceAccount` (OAuth tokens) | **not rebuildable, and must not be** | user re-authorisation |

Everything below the first row is a cache with a longer-than-usual lifetime.

### 1.2 What lives where

**S3 — one bucket, `lost-soles-storage`** (`defineStorage`, resource #9 in `01-architecture.md`).

```
s3://lost-soles-storage/
  raw/<uid>/<source>/<externalId>/<sha256>.<ext>     RawArchiveRef.key — contract §2
                                                     IMMUTABLE. Versioning ON. Delete DENIED
                                                     by bucket policy, not just by convention.
  facts/<uid>/highwater.jsonl                        append-only D-135 floor decisions (§4.6)
  facts/<uid>/identity.json                          userId ↔ Cognito sub ↔ display name (§1.4)
  traces/<uid>/<activityId>.trace.json.gz            normalized Trace (contract §2). DERIVED.
  cells/<uid>/<activityId>.cells.bin                 res-10 cell set for one activity. DERIVED.
  users/<uid>/manifest.json                          mutable pointer, no-cache (05 §7.3)
  users/<uid>/explored/explored-r10.<gen>.bin        immutable, content-addressed by generation
  users/<uid>/explored/explored-agg.<gen>.json
  users/<uid>/explored/explored-lastrun-r10.<gen>.bin
  users/<uid>/deltas/<fromGen>-<toGen>.bin           immutable, GC'd at ~20 generations
  rules/xp-rules-v<N>.yaml                           mirror of the repo file, for the replay job
  regions/<regionId>-r10.bin                         precomputed denominators (05 §8.1)
```

`traces/` and `cells/` are S3, not DynamoDB, deliberately. A 2,700-point trace is ~90 KB of JSON
(~25 KB gzipped) — an order of magnitude over DynamoDB's 400 KB item limit is not the concern;
the concern is that nothing ever *queries* a trace. It is fetched whole, by key, on activity
detail. That is exactly S3's job and it costs $0.023/GB-month against DynamoDB's $0.25.

**DynamoDB — eight tables.** Five behind AppSync, three raw CDK constructs outside it. §2.

**Cloudflare R2** holds only the pmtiles basemap (resource #20). It is third-party map data,
re-downloadable, and contains nothing of the user's. Not part of this model.

**Browser IndexedDB** holds the decoded explored set keyed `{uid, generation}` (05 §7.3). Pure
cache; clearing it costs one 300 KB fetch.

### 1.3 What ships to the browser

Per **R3** the entire explored set is 300–450 KB gzipped at the five-year *worst* case and ships
once per session (§6). The client also receives, via AppSync: the user's `Profile`, all six
`SkillState` rows, the skill definitions for the pinned rules version, a page of `Activity`
summaries, and `XpLedgerEntry` rows for whichever activity is open.

The client receives **no** cell rows, **no** OAuth tokens, and **no** ingest receipts. There is
no AppSync model for any of those, which is a stronger guarantee than an auth rule (01 §2).

### 1.4 Proof of D-101 — and where it breaks

D-101: *user-supplied raw files in S3 are the system of record; everything else must be
reconstructible from them plus the XP rules.* Walking it:

| Store | Reconstructible? | How |
|---|---|---|
| `Activity` rows | ✅ | `adapter.normalize(rawBytes, ref, job)`. Pure (contract §3), no network, no clock. `activityId = sha256(uid:source:externalId)` is deterministic, so the same row is reproduced byte-for-byte. |
| `traces/`, `cells/` | ✅ | `normalize()` then `traceToCells()` at res 10 (D-115). Deterministic. |
| `ExploredCell` | ✅ | fold activities ascending by `startedAt` (04 §7.4 replay order, ties by `activityId`), applying `min`/`max`/`ADD` per 05 §2.4. |
| `XpLedgerEntry` | ✅ | replay against the pinned `xpRulesVersion` per activity. |
| `SkillState` | ✅ | pure `SUM` over the ledger. |
| `explored-*.bin`, `manifest.json` | ✅ | regenerated from `ExploredCell` in <100 ms (R3 §6). |
| `IngestReceipt` | ✅ (vacuously) | replay is not webhook-driven; receipts are re-minted `DONE`. |

**It breaks in exactly three places. Each has a fix, and the fixes are load-bearing.**

**Break 1 — identity.** `userId` comes from a Cognito sub. Rebuilding into a fresh Cognito pool
mints new subs, and every S3 key and DynamoDB partition key embeds `<uid>`.
*Fix:* `facts/<uid>/identity.json` records `{userId, cognitoSub, email, displayName, createdAt}`,
written at first sign-in and on every profile change. A rebuild reads it and either restores the
mapping or performs a documented key rewrite. Without this file the archive is anonymous rubble.

**Break 2 — D-135's monotonicity floors are not a function of facts + rules.** They are a
function of *what the user was shown, and when*. If v1 ran, the user saw Might 40, then v2
lowers pushup XP, the floor that protects Might 40 exists only because v1 was live at a
particular moment. A rebuild that replays straight to v2 has no way to know Might 40 was ever
displayed, and would honestly — and wrongly, per D-135 — show Might 37.
*Fix:* **floors are promoted to facts.** Every floor decision is appended to
`facts/<uid>/highwater.jsonl` (§4.6) *and* to the ledger as a `monotonicity_floor` row. The
rebuild replays the ruleset chain in order and re-applies floors from the JSONL. This is the one
place the model stores a derived number as a fact, and it is D-135 that forces it. It is worth
saying plainly: **D-135 costs us a fact stream.**

**Break 3 — OAuth tokens.** `SourceAccount` is deliberately unrecoverable. Rebuilding requires
the user to press "Connect Strava" once. This is correct behaviour for a credential store, not
a defect, but a rebuild runbook that does not mention it will appear to hang forever waiting for
a webhook (§8.3 step 8).

Everything else — every cell, every XP number, every byte of every blob — is a cache. **The
delete-protected `raw/` prefix plus `rules/` plus two small fact files is the whole of Lost
Soles.**

---

## 2. DynamoDB table design

### 2.1 Multi-table. Eight tables. Here is why that is not laziness.

**Decision: multi-table.** Five Amplify `defineData` models (one physical table each, which is
how Gen 2 works) plus three raw CDK `dynamodb.Table` constructs (01 §2, the escape-hatch block).

Single-table design exists to solve two problems: (a) fetching a heterogeneous item collection
in one `Query`, and (b) keeping the number of provisioned tables down at scale. Neither applies.

- **(a) does not apply because the biggest read in this app is not a DynamoDB read at all.** The
  client downloads `explored-r10.bin` from S3 once and answers every spatial question in memory
  (R3, 01 §5). There is no screen that wants "the profile *and* the skills *and* the last ten
  activities *and* the cells" in one round trip; the dashboard wants three small independent
  reads, all of which are single-digit RRU.
- **(b) does not apply at 1–6 users (D-014).** All eight tables are `PAY_PER_REQUEST`. Total
  five-year storage is ~35 MB against a 25 GB always-free allowance. The five-year *write* bill
  is computed in §5.6 and rounds to under a dollar. There is no table count to economise on.

Three things multi-table buys that a single table would actively destroy:

1. **IAM blast radius.** `SourceAccount` holds OAuth refresh tokens. In a single table, any
   principal that can write cells can read tokens, because DynamoDB IAM conditions on leading
   keys are a documented footgun and not something a 6-user app should be betting a credential
   store on. Separate tables make "the webhook Lambda cannot read tokens" a *resource* boundary
   (01 §2 reason 2). No auth rule is safer than no reachability.
2. **Divergent table settings.** `ExploredCell` needs `removalPolicy: RETAIN` and PITR — D-020
   says the map only ever grows and losing it is the one unrecoverable-feeling failure.
   `IngestReceipt` needs a TTL attribute and *wants* to be disposable. You cannot set a TTL on
   half a table.
3. **Amplify does the client-facing half for you.** `defineData` generates the AppSync schema,
   `allow.owner()` rules, subscriptions and typed hooks per model. Hand-rolling a single table
   behind AppSync means hand-writing every resolver. That is a large, permanent tax paid to
   optimise a bottleneck that does not exist.

The one thing genuinely lost is the ability to transact a write across tables — except
DynamoDB `TransactWriteItems` **is cross-table** (up to 100 items, same region, same account), so
the atomic ingest commit in 01 §4 step 15 works unchanged. Nothing is lost.

### 2.2 Table index

| # | Table | Managed by | In AppSync? | Items @ 5 y | Purpose |
|---|---|---|---|---|---|
| T1 | `Profile` | `defineData` | yes, `allow.owner()` | ≤ 6 | identity, display prefs, map mode, generation mirror |
| T2 | `SkillState` | `defineData` | yes, owner-read only | ~36–60 | materialised per-skill XP + level + D-135 floors |
| T3 | `Activity` | `defineData` | yes, owner | 2,000–5,000 | the fact row; canonical shape from the contract |
| T4 | `XpLedgerEntry` | `defineData` | yes, owner-read only | 9,000–25,000 | append-only XP events with rule version |
| T5 | `RuleSkill` | `defineData` | yes, **read-only to all signed-in users** | ~24–60 | the skill registry, materialised as rows (§3) |
| T6 | `ExploredCell` | **CDK** | **no** | 20k–150k | the fog. `firstRunAt` + `lastRunAt` per D-120 |
| T7 | `SourceAccount` | **CDK** | **no** | ≤ 24 | OAuth tokens + per-adapter watermarks |
| T8 | `IngestReceipt` | **CDK** | **no** | ~250 live (TTL 90 d) | idempotency ledger |

`Ticket` and `Region` from 01 §2 resource #5 are covered in §2.11 — both are small and neither
participates in ingest.

---

### T1 — `Profile`

```
Table: Profile                       (Amplify defineData model)
PK   id                = <userId>    (the Cognito sub; Amplify's default identifier)
```

| attr | type | notes |
|---|---|---|
| `id` | S | `= userId`. Also the `<uid>` in every S3 key and every other table's partition key. |
| `displayName` | S | free text |
| `exploredGeneration` | N | **mirror** of `manifest.json`'s `generation` (05 §7.3). Lives here so the AppSync subscription in 01 §4 step 17 has something to push. Authoritative copy is the manifest. |
| `mapMode` | S | `"atlas" \| "adventure"` (D-052) |
| `showColdTerritory` | BOOL | atlas-only overlay (D-133) |
| `rulesVersionPinned` | N | which `RuleSkill` version the UI renders. Normally the newest. |
| `totalLevel`, `totalXp` | N | denormalised from `SkillState` in the same transaction as an XP write; D-033's headline number, so it must not cost six reads. |
| `createdAt`, `updatedAt` | S | ISO 8601 UTC |

Auth: `allow.owner()`. Access patterns: **AP-1**, **AP-14**.
5-year count: ≤ 6 (D-014). No GSIs.

---

### T2 — `SkillState`

```
Table: SkillState
PK   userId
SK   skillId                          (identifier(['userId','skillId']))
```

| attr | type | notes |
|---|---|---|
| `userId` | S | |
| `skillId` | S | `wayfaring` \| `vigil` \| `might` \| … — **an opaque string, never an enum** (D-031) |
| `xpLedgerSum` | N | pure `SUM(XpLedgerEntry.xpAwarded)` for this (user, skill). Maintained by `ADD` on ingest; recomputed wholesale on replay. |
| `displayedXp` | N | `= xpLedgerSum` by construction — see §4.6. Kept as a separate attribute so a bug in one is detectable against the other. |
| `level` | N | `levelForXp(displayedXp, curve)` — derived, cached |
| `levelHighWater` | N | never decreases (04 §7.5, D-135) |
| `firstXpAt`, `lastXpAt` | S | ISO 8601 UTC; drives "training since" flavour |
| `rulesVersionLastComputed` | N | which ruleset produced `xpLedgerSum` |

Auth: `allow.owner().to(['read'])`. **The client can never write XP** (01 §5, trust boundary).
All writes are IAM-authed from `process-activity` / the replay job.
Access patterns: **AP-2**, **AP-5**, **AP-6**.
5-year count: 6 users × 6 MVP skills = 36; ~60 with Slayer (D-122, post-MVP) and future rows.
No GSIs — the only query is "all skills for this user", which is the base-table `Query`.

---

### T3 — `Activity`

The item is the contract's `Activity` (contract §2) stored flat, with the nested `SourceRef` and
`RawArchiveRef` as DynamoDB maps and the game-layer additions clearly separated.

```
Table: Activity
PK   id           = <activityId>      = sha256(`${userId}:${source}:${externalId}`)
GSI1 byUserAndStart      PK userId          SK startedAt        (ALL)
GSI2 byUserAndDedupe     PK userId          SK dedupeKey        (KEYS_ONLY)
GSI3 byUserAndDay        PK userIdLocalDay  SK startedAtLocal   (INCLUDE: kind, distanceM, xpAwarded)
```

| attr | type | source | notes |
|---|---|---|---|
| `id` | S | contract `activityId` | Amplify's identifier. **Deterministic sha256 ⇒ re-ingest is idempotent for free** (contract conflict #6). |
| `userId` | S | contract | GSI1/GSI2 partition |
| `kind` | S | contract `ActivityKind` | `run\|walk\|hike\|ride\|strength\|other`. **Physical fact. Never a skill** (conflict #7). |
| `startedAt` | S | contract | ISO 8601 with a real `Z`. GSI1 sort key. **All scoring uses this, never ingest time** (05 §3.1). |
| `startedAtLocal` | S | contract | naive wall clock, no offset. **All game-day bucketing** (conflict #3). |
| `timezone` | S/NULL | contract | bare IANA id or null |
| `userIdLocalDay` | S | derived | `<userId>#<YYYY-MM-DD from startedAtLocal>`. GSI3 partition. Exists only so "did I work out today" is one query, not a scan. |
| `elapsedS`, `movingS`, `distanceM`, `elevationGainM`, `name` | N/S | contract | |
| `source` | M | contract `SourceRef` | `{source, externalId, sourceTypeRaw, fetchedAt, meta}`. `externalId` **always a string** — Strava ids overflow 2^53 (contract §2). |
| `raw` | M | contract `RawArchiveRef` | `{bucket, key, contentType, bytes, sha256, archivedAt}`. The contract permits `null` for `manual`; **we never emit null** — the manual adapter synthesises and archives a JSON document like every other source (01 §5), because D-101 has no exception for hand-typed pushups. |
| `traceRef` | S/NULL | contract | S3 key of the normalized trace. **Null is a normal outcome**: treadmill, manual, strength. |
| `hasTrace` | BOOL | contract | the field the skill matcher reads (§3.4). |
| `sets` | L of M | contract `WorkoutSet[]` | `{exercise, reps?, durationS?, weightKg?}`. D-062: carried from day one even though MVP logs one number. |
| `dedupeKey` | S | contract | cross-source natural key. GSI2 sort key. |
| `ingestedAt` | S | contract | |
| `revision` | N | contract | bumped on re-ingest of a source-side edit |
| — game layer below this line — | | | |
| `xpRulesVersion` | N | | pinned at scoring time (04 §7.6). What the user *saw*. |
| `fogAlgoVersion` | N | | 05 §3.5. Part of the idempotency key. |
| `xpAwarded` | N | | total across skills. Denormalised for the activity list; the ledger is authoritative. |
| `cellCount`, `newCellCount`, `rearmedCellCount`, `cooledCellCount` | N | | 05 §8.2. Written even when zero (treadmill) so the row shape never varies. |
| `cellsRef` | S/NULL | | S3 key `cells/<uid>/<id>.cells.bin` — the per-activity cell set, needed for un-award (05 §3.5). |
| `status` | S | | `ACTIVE \| TOMBSTONED`. A Strava `aspect_type: delete` sets `TOMBSTONED`; **cells are never removed** (D-020, 01 §4). |
| `traceRejectCounts` | M | | `{speedGate, accuracy, duplicate}` — makes a silently-garbage GPS record visible (05 §3.6). |

Auth: `allow.owner()`, but **`to(['read'])` for every field the pipeline owns.** Client creates
are only permitted through the manual-log mutation (§2.11), never a raw `createActivity`.
Access patterns: **AP-3**, **AP-4**, **AP-7**, **AP-10**, **AP-13**.
5-year count: ~400 activities/year typical (200 runs + ~200 strength sessions), 1,000/year
pessimistic (04 §7.6) → **2,000–5,000 items**, ~700 bytes each → ~3.5 MB.

*Why GSI2 is `KEYS_ONLY`:* the dedupe check only needs "does an activity with this `dedupeKey`
already exist, and what is its id". Projecting the whole item would double the write cost of a
table that is written on every single ingest.

---

### T4 — `XpLedgerEntry`

```
Table: XpLedgerEntry
PK   id  = `${activityId}#${skillId}#${reason}#v${xpRulesVersion}`
GSI1 byActivity     PK activityId  SK skillId#reason        (ALL)
GSI2 byUserAndSeq   PK userId      SK seq                   (ALL)
GSI3 bySkill        PK userId#skillId  SK awardedAt         (INCLUDE: xpAwarded, xpRulesVersion)
```

Full item shape and semantics in §4. Summary:

| attr | type | notes |
|---|---|---|
| `id` | S | deterministic ⇒ the write is a `ConditionExpression: attribute_not_exists(id)` and a duplicate replay is a no-op (05 §3.5) |
| `userId`, `activityId`, `skillId` | S | |
| `reason` | S | closed vocabulary, §4.2 |
| `units`, `unitsEffective` | N | e.g. `units: 8.37` km, `unitsEffective: 5.19` after the D-120 ground split |
| `xpAwarded` | N | integer |
| `xpRulesVersion` | N | **the row is meaningless without this** |
| `seq` | S | `<startedAt>#<activityId>#<nn>` — the replay-order key (04 §7.4: ascending `startedAt`, ties by activityId) |
| `awardedAt` | S | ISO 8601 UTC, ingest wall clock. Audit only; never an input to scoring. |

Auth: `allow.owner().to(['read'])`. Append-only: no `update`, no `delete` in the AppSync schema
at all. The replay job deletes and rewrites via IAM, outside AppSync.
Access patterns: **AP-7**, **AP-9**, **AP-11**.
5-year count: ~4.5 rows/activity → **9,000–25,000 items**, ~200 bytes each → ~5 MB.

---

### T5 — `RuleSkill`

The skill registry, materialised as rows. Full treatment in §3.

```
Table: RuleSkill
PK   rulesVersion   (N as S, e.g. "1")
SK   skillId
```

Auth: `allow.authenticated().to(['read'])` — skill definitions are not per-user data.
Writes are IAM-only, from the deploy-time seeding job that reads `rules/xp-rules-vN.yaml`.
5-year count: ~3 rule versions × 8 skills = **24**, generously 60.

---
### T6 — `ExploredCell` — the fog

**CDK `dynamodb.Table`. Not an Amplify model. The client never reads it** (01 §2): the client
downloads `explored-r10.bin` and queries it in memory. Putting this table behind AppSync would
add $4.00/M operations for a path nobody uses.

```ts
new ddb.Table(custom, "ExploredCell", {
  partitionKey: { name: "pk", type: S },
  sortKey:      { name: "sk", type: S },
  billingMode:  PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN,     // D-020: the map only ever grows
  pointInTimeRecovery: true,               // this is the one table whose loss would feel final
})
```

**Two item types share this table.** That is a deliberate, bounded exception to §2.1 — the two
are written inside the same `TransactWriteItems` and read by the same job, so splitting them
would buy nothing and cost atomicity.

**Item type A — the cell** (05 §2.4, verbatim, plus provenance):

```
pk  = U#<uid>#C#<res6ParentCellId>          e.g. U#a3f1…#C#8628308ffffffff
sk  = <res10CellId>                          e.g. 8a2830828767fff
```

| attr | type | write rule | why it earns its place |
|---|---|---|---|
| `firstRunAt` | S (ISO 8601 UTC) | `min(existing, incoming)` — **immutable in spirit; `min` because backfills arrive out of order** (05 §3.4) | lifetime stats, "explorer since", ordering territory by age of discovery. **Cannot be reconstructed from `lastRunAt` once the cell is re-run** — this is exactly why D-120 needs both. |
| `firstRunId` | S | `if_not_exists` | audit: which run discovered this ground |
| `lastRunAt` | S (ISO 8601 UTC) | `max(existing, incoming)` | **THE D-120 clock.** Discovery scoring is `now − lastRunAt`. A presence bit here is the bug D-120 was written to prevent. |
| `lastRunId` | S | set when `lastRunAt` advances | audit |
| `visitCount` | N | `ADD 1` per *activity*, not per traversal (05 §3.3) | "most-run ground"; a future heat view |
| `discoveryCount` | N | `ADD 1` only when credit was awarded | separates "run 40 times" from "re-armed twice" |
| `lastRunDay` | N | `u16` days since 2020-01-01 | the value packed into `explored-lastrun-r10.bin` (05 §7.2); stored so the blob builder does not re-parse 150k ISO strings |

The write, exactly (01 §4, expanded for `firstRunAt`'s `min`):

```
UpdateItem
  Key: { pk, sk }
  UpdateExpression:
    SET firstRunAt = if_not_exists(firstRunAt, :now),
        firstRunId = if_not_exists(firstRunId, :rid),
        lastRunAt  = :now,
        lastRunId  = :rid,
        lastRunDay = :day
    ADD visitCount :one, discoveryCount :credit
  ConditionExpression: attribute_not_exists(lastRunAt) OR lastRunAt < :now
```

The condition makes the write **safe for out-of-order arrival**: a backfilled 2024 run cannot
stomp a 2026 `lastRunAt`. When it fails, the fallback path is a second `UpdateItem` that only
lowers `firstRunAt` (`ConditionExpression: firstRunAt > :now`) and leaves the clock alone — and
the activity is enqueued for replay per 05 §3.4. **Two writes, both idempotent, no read-modify-
write, no lost update.**

**Item type B — the zoom-out aggregate** (01 §4, 05 §6.1):

```
pk  = U#<uid>#AGG#<res>        res ∈ {6, 7, 8}
sk  = <parentCellId>
    exploredChildren : N       ADD (count of res-10 children newly added)
    totalChildren    : N       constant = 7^(10-res)   (2401 / 343 / 49)
    lastRunDay       : N       max
```

The `AGG#6` partition doubles as **the index of which parents a user has touched**, which is
what makes a full blob rebuild possible without a table scan (§2.4).

**Access patterns:** AP-15 (ingest diff), AP-16 (blob rebuild), AP-17 (repair scan).
No GSIs. None are needed: every read is by known partition.

**Partition math (why res-6 is the right parent, D-115 / 05 §2.4):**

| | value |
|---|---|
| res-10 cell area | ~15,047 m² (~1.5 ha) |
| res-6 cell area | ~36.13 km² |
| res-10 children per res-6 parent | 7⁴ = **2,401** — a hard ceiling |
| max partition size | 2,401 × ~160 B = **~384 KB** — three orders of magnitude under DynamoDB's 10 GB limit, and no hot-partition risk at 6 users |
| parents touched by one 5-mile run | 1–2 |
| parents in a home metro after 5 years | ~20–60; ~100–200 including travel |

Res-6 also gives the client its viewport bucketing for free (05 §6.2) and the delta-application
invalidation key (05 §7.4) — the same grouping, three uses.

*Rejected:* res-7 parents (343 children — partitions too small, 7× more `Query` calls on
rebuild) and res-5 (16,807 children, ~2.7 MB partitions, and the client's bucket granularity
becomes too coarse to invalidate cheaply).

**5-year item count:** R3's absolute worst case (zero route overlap, which will never happen)
is **147,782** cells; realistically **20,000–50,000** because a home-based runner re-runs the
same streets constantly. Plus ~1 AGG item per ~50 cells at res 8 → +3k. At ~160 B/item that is
**~4–24 MB**. Storage cost: zero (25 GB free tier).

---

### T7 — `SourceAccount`

**CDK table. Not in AppSync, at any auth level, ever** (01 §2 reason 2). Holds OAuth
access/refresh tokens.

```
pk  = U#<uid>
sk  = SRC#<sourceId>                        e.g. SRC#strava
GSI1 byExternalOwner:
     gsi1pk = <sourceId>#<externalOwnerId>  e.g. strava#12345678
     projection: KEYS_ONLY                   ← see the resolution note below
```

| attr | type | notes |
|---|---|---|
| `userId`, `sourceId` | S | |
| `externalOwnerId` | S | the vendor's athlete/user id, **always a string** (contract §2) |
| `accessToken`, `refreshToken` | S | encrypted at rest with a CMK; never logged, never projected into any index |
| `expiresAt` | N | epoch seconds. `token-refresh` (01 resource #14) sweeps anything within 4 h. |
| `scopes` | SS | must contain `activity:read_all`, never `activity:read` (D-121.3) |
| `connectedAt`, `lastSuccessfulSyncAt` | S | |
| `listSinceWatermark` | S | ISO 8601 — the cursor for the **mandatory** `listSince()` reconciliation sweep (contract §3, conflict #8). This is the field that covers silently-dropped webhooks. |
| `status` | S | `ACTIVE \| NEEDS_REAUTH \| DISCONNECTED`. A 401 that survives one refresh sets `NEEDS_REAUTH` and the UI shows "reconnect", rather than retry-storming (01 §4). |

**Resolved conflict.** `01-architecture.md` §2 says both *"on POST an `owner_id` →
`SourceAccount` lookup that discards events for unknown athletes"* and *"strava-webhook gets NO
access to sourceAccount."* Both cannot hold. The resolution, which satisfies the intent of each:
**grant `strava-webhook` `dynamodb:Query` on `SourceAccount/index/byExternalOwner` only, with the
index projected `KEYS_ONLY`.** The webhook learns `userId` and nothing else; the token attributes
are not present in the index, so a fully compromised webhook Lambda cannot read a credential even
with a valid IAM grant. `process-activity` and `token-refresh` keep base-table read/write.

5-year count: 6 users × ≤4 adapters = **≤ 24**.

---

### T8 — `IngestReceipt` — idempotency

**CDK table.** This is the thing that makes webhook replay unable to double-award XP.

```
pk  = ingestKey                             (no sort key)
ttl = epoch seconds, 90 days out
```

Two key shapes coexist, and they are different gates at different moments:

```
accept-time  (01 §4 step 3):
  ingestKey = sha256(`strava:${owner_id}:${object_id}:${aspect_type}`)

score-time   (05 §3.5):
  ingestKey = `${source}#${externalId}#${sha256(canonicalJson({points, startedAt})).slice(0,16)}#v${FOG_ALGO_VERSION}`
```

| attr | type | notes |
|---|---|---|
| `ingestKey` | S | |
| `keyKind` | S | `ACCEPT \| SCORE` |
| `status` | S | `QUEUED → PROCESSING → DONE`, plus `FAILED`. Every transition is a conditional update. |
| `userId`, `activityId` | S | |
| `processingStartedAt` | S | a `PROCESSING` older than the 15-minute Lambda timeout is reclaimable by the next attempt (01 §4) — which is why the state carries a timestamp |
| `xpAwarded`, `newCellCount` | N | on `DONE`, so a duplicate returns the winner's award rather than recomputing |
| `attempts` | N | `ADD 1` per delivery; ≥ 4 means the DLQ has it |
| `ttl` | N | 90 days. **Safe to expire**: layer 4 (cell writes are set-inserts) is the permanent backstop (01 §4). |

**The four layers, mapped onto this table** (01 §4, restated so an implementer sees which write
does which job):

1. **Accept gate** — `PutItem` with `ConditionExpression: attribute_not_exists(ingestKey)`.
   Kills a redelivery before it reaches SQS. Protects the 2-second budget.
2. **Score gate** — `UpdateItem SET status="PROCESSING", processingStartedAt=:now
   ConditionExpression: status = "QUEUED" OR (status = "PROCESSING" AND processingStartedAt < :staleCutoff)`.
   A redelivered SQS message loses this race and exits **before any XP is written**.
3. **Transactional commit** — the `Activity` put, the `SkillState` `ADD`s, the `XpLedgerEntry`
   conditional puts and `status = "DONE" (ConditionExpression: status = "PROCESSING")` are one
   `TransactWriteItems`. **XP and the receipt commit or fail together.** There is no window in
   which XP exists and the receipt does not.
4. **Set semantics** — even if 1–3 all failed, `delta = newCells \ exploredSet` is empty on a
   replay, so zero cells and zero discovery credit. And the ledger's `id` is deterministic
   (`activityId#skillId#reason#vN`), so a duplicate put is a `ConditionalCheckFailed`, not a
   second award. **Two independent backstops, both structural.**

5-year count: 90-day TTL × ~2 keys per activity × ~400/yr ≈ **~250 live items**.

---

### 2.9 Two things this design deliberately does not store

**No `CellVisit` table.** `04-game-design.md` §7.2 specifies an append-only `CellVisit`
{userId, h3Index, activityId, visitedAt} as the fact that makes D-120 recomputable, and calls
`lastRunAt` "a cache". That is the right *layering* and the wrong *storage*. At 150k cells with a
mean `visitCount` well above 1, a per-visit table is 500k–1M rows carrying no information that
`cells/<uid>/<activityId>.cells.bin` in S3 does not already carry — and that S3 object is itself
derived from the raw trace, so the real fact is the trace (D-101).

So: **the `CellVisit` fact stream exists; it is stored as one small immutable S3 object per
activity, not as a DynamoDB table.** `ExploredCell` is exactly the cache 04 §7.2 says it is, and
the recomputability property 04 §7.2 was protecting is preserved in full — folding
`cells/*.cells.bin` in `startedAt` order regenerates every `ExploredCell` attribute. §8.3 step 5
is that fold. **This is a storage-medium change, not a semantic one.**

**No per-run cell rows in DynamoDB.** The un-award path (05 §3.5) needs "which cells did this
activity touch". That is `cellsRef` → one S3 `GetObject` of ~200–300 bytes, not a GSI on a
150k-item table that would double its write cost forever to serve a query that fires on an edited
activity a few times a year.

### 2.10 Blob regeneration does not re-read the table

Naïvely, regenerating `explored-r10.bin` means `Query`ing every res-6 partition — ~24 MB of
eventually-consistent reads ≈ 3,000 RRU per run. It works and costs $0.15/year, but there is a
strictly better path that `process-activity` is already positioned for:

```
1. GET  users/<uid>/explored/explored-r10.<gen-1>.bin   (~300 KB, one S3 GET)
2. decode → sorted BigUint64Array
3. merge the run's newly-added cells (typically 40–130)  → still sorted
4. encode, gzip, PUT explored-r10.<gen>.bin  +  deltas/<gen-1>-<gen>.bin
5. PUT manifest.json  (the only mutable object)
```

Under 100 ms even at the five-year worst case (R3 §6). The full-table `Query` path stays in the
codebase as **AP-17, the repair path**, invoked by the rebuild drill (§8.3) and by a
consistency check — never on the ingest hot path.

### 2.11 The two remaining Amplify models

**`Region`** (01 resource #5) — named regions for the "% territory" stat (05 §8.1).
`PK id`, attrs `{name, boundaryS3Key, totalCellsRes10, cellsRes10Key, res}`. The cell list and
denominator are precomputed once and shipped from `regions/` in S3, because they **never change**.
≤ 20 items ever. Read-only to clients.

**`Ticket`** (D-090, D-092) — a **write-only inbox**, not a ticket database. D-093 makes markdown
in the repo the single source of truth; the phone UI only ever *creates*, the agent only ever
edits/numbers/moves. So: `PK id (ULID)`, attrs `{userId, title, body, createdAt, drainedAt}`.
A `/tickets` run drains undrained rows into `tickets/inbox/` and stamps `drainedAt`. Disjoint
write sets ⇒ no merge conflicts, no sync engine. ~50 items/year; a 180-day TTL on drained rows.

**Manual workout logging** does not get its own model. `(app)/log/page.tsx` (D-061) calls a
custom mutation `logWorkout(entries: [{exerciseId, reps|seconds}])` backed by a Lambda that runs
the **manual adapter** — archive to S3, `normalize()`, score, persist — so a hand-logged pushup
takes exactly the same path as a Strava run (01 §5). One XP code path, one archive rule, no
second implementation to keep in sync.

---

## 3. The skill schema — skills are data, not code

`04-game-design.md` §1.3 states the requirement: *"Adding 'Burpees' must be adding a row. If it
requires a code change, the design has failed."* **D-031** makes modularity a product decision,
and **D-132** supplies the acceptance test: adding **Vigil** (GPS-less running — full activity XP,
zero discovery credit, no map reveal) must be a data row.

This section designs the row, then runs the test. **The verdict is in §3.6, and it is a
qualified pass: the schema as literally written in 04 §1.3 fails, one additive change fixes it,
and after that change Vigil is exactly one row of YAML and one seeded item.** The change is
specified in §3.4 and must land before implementation.

### 3.1 The five jobs a skill row has to do

A skill definition is not just a name and an XP rate. Walk the pipeline (contract §4) and count
every place where the code would otherwise have to know a skill's name:

| # | Job | Where it fires | If this is not data… |
|---|---|---|---|
| J1 | **Selection** — given an `Activity`, which activity skill does it train? | score step 6 | `if (kind === "run") …` — a `switch` on skill id, the exact thing 04 §1.3 forbids |
| J2 | **Measurement** — which number off the activity is the unit count? | score step 6 | a per-skill extractor function |
| J3 | **Rating** — units → XP, with ground multipliers and caps | score step 6 | a per-skill formula |
| J4 | **Propagation** — which meta skills does the award feed, at what rate? | score step 6 | a hardcoded Constitution rule |
| J5 | **Presentation** — order, label, unit noun, grouping on the skill panel and the log page | UI | a hardcoded array in a React component |

04 §1.3's YAML covers **J2 (`logMode`, `unit`), J3 (`xpPerUnit`, `softCapUnits`,
`groundMultipliers`), J4 (`feeds`)** and part of J5. It does **not** cover **J1**, and J1 is
precisely what Vigil needs. That gap is the whole finding of this section.

### 3.2 `RuleSkill` — the item shape (T5)

The YAML in `rules/xp-rules-vN.yaml` is authored in git and is the human-editable authority.
It is **seeded verbatim into T5 at deploy time** so the browser and the scoring Lambda read the
same rows rather than each parsing a file. Git is the source of truth; T5 is a materialised
projection of it, exactly as `ExploredCell` is a projection of the traces (§1.1).

```
Table: RuleSkill                        (Amplify defineData model)
PK   rulesVersion   = "1"               (the number, stored as a string partition key)
SK   skillId        = "wayfaring"       (opaque string — NEVER a TypeScript union, D-031)
```

| attr | type | job | notes |
|---|---|---|---|
| `rulesVersion` | S | — | partition. Every shipped version is retained forever (04 §7.6). |
| `skillId` | S | — | opaque. Appears verbatim in `SkillState.skillId` and `XpLedgerEntry.skillId`. |
| `name` | S | J5 | display name. **Renaming Vigil is an edit to this field and nothing else** — D-132 says the name is provisional, so it must not be an identifier. |
| `kind` | S | J5 | `activity \| meta` |
| `enabled` | BOOL | J1/J5 | `false` hides the skill and stops it matching. Slayer ships `false` (D-122). A disabled skill's historical ledger rows stay valid. |
| `displayOrder` | N | J5 | sparse (10, 20, 30 …) so an insert is a row, not a renumber |
| `logMode` | S | J2 | `trace \| reps \| duration \| derived` — see §3.7 |
| `unit` | S | J2/J5 | `km \| rep \| second \| cell` — a display noun *and* the unit the rate is quoted in |
| **`match`** | M | **J1** | **the new part. §3.4.** Absent/null on `kind: meta`. |
| `matchPriority` | N | J1 | higher wins; ties break on `skillId` ascending (determinism, 04 §7.4) |
| `xpPerUnit` | N | J3 | |
| `groundMultipliers` | M/NULL | J3 | `{new, rearmed, recent}` per D-120. **`null` means "this skill is not ground-scored"** — distinct from `{1,1,1}`, which would be a claim about ground. |
| **`revealsGround`** | BOOL/NULL | **J1** | **D-189, ticket 0157.** Does an activity matching this skill open the map? `true` writes its cells to `ExploredCell` and therefore earns Cartography; `false` archives and may draw the trace but writes nothing, so the ground keeps its full discovery value. **Required on every `kind: activity` row and null on meta rows — there is deliberately NO DEFAULT**, because the map never re-fogs (D-020) and a cell revealed by an omitted line is permanent. Only `wayfaring` is `true` in v1. |
| `softCapUnits` | N/NULL | J3 | per-session diminishing returns (04 §3.5) |
| `sanityCeilingUnits` | N/NULL | J3 | flag-only; never blocks (D-123) |
| `minUnitsForCredit` | N | J3 | |
| `feeds` | L of M | J4 | `[{skill, rate}]`. Constitution's 1/3 is a row's attribute, not a constant in the scorer. |
| `exercises` | L of M | J5 | for `logMode: reps\|duration` — `{id, label, entry, quickValues}`, what `(app)/log/page.tsx` renders (D-061). Nested here rather than in a sibling `RuleExercise` table because an exercise has no meaning without its skill, and the log page's only query is "give me the whole enabled registry" anyway. |

The curve (`stepFormula: "4 * L^2"`, `maxLevel`, `deepMaxLevel` — D-130) is not per-skill:
**D-131 explicitly rejected per-skill curve constants**, so it is one `RuleCurve` item stored in
the same table under `SK = "__curve__"`. One `Query` on the partition returns the curve and every
skill together, which is AP-8.

### 3.3 Why the registry is a table and not just a file

The scoring Lambda could read the YAML from S3. The client cannot cheaply, and the client needs
the registry for every screen: the skill panel, Total Level (D-033), the log page's exercise rows,
the post-run tally's labels. Shipping rows through AppSync with `allow.authenticated().to(['read'])`
gives the UI a typed, cached, paginated read of the same bytes the scorer used, with no second
parser and no risk of the two drifting. **The YAML is the authority; T5 is a build artefact.**
Writes are IAM-only, from the deploy-time seeding job (§3.8).

### 3.4 `match` — the selection clause, declaratively

This is the addition. A skill declares, in data, which activities it consumes:

```yaml
match:
  kinds:        [run, walk, hike]   # ActivityKind values (contract §2). Empty/absent = any.
  requiresTrace: true               # true | false | any    <-- THE Vigil discriminator
  sources:      any                 # any | [strava, manual, …]  — escape hatch, rarely used
  measure:      distanceKm          # J2: which quantity off the Activity is the unit count
```

Four keys, all closed vocabularies drawn from types that already exist in the contract. `kinds`
draws from `ActivityKind`; `requiresTrace` reads `Activity.hasTrace`, which the contract already
carries and T3 already stores; `sources` draws from `SourceId`; `measure` names one of a fixed
set of extractors (§3.7).

**The matcher, in full:**

```
selectActivitySkills(activity, registry):
    candidates = registry.skills
        .filter(s => s.kind == "activity" && s.enabled)
        .filter(s => s.match.kinds is empty  OR  activity.kind in s.match.kinds)
        .filter(s => s.match.requiresTrace == "any"
                     OR s.match.requiresTrace == activity.hasTrace)
        .filter(s => s.match.sources == "any" OR activity.source.source in s.match.sources)
    group candidates by match.measure
    for each group: take max(matchPriority), tie-break skillId ascending
    return one skill per distinct measure
```

Grouping by `measure` is what lets one strength session train Might *and* Fortitude (two
different `measure`s: reps of `pushup`, reps of `situp`) while a run trains exactly one distance
skill. Meta skills are never matched — they arrive through `feeds` (J4) and through the fog
subsystem's own derived award (Cartography, 05 §8.2).

**The matcher is total and deterministic**, which 04 §7.4 requires for replay soundness: same
activity + same `rulesVersion` ⇒ same skills, always, with no clock and no RNG. Zero matches for
an activity that carries measurable work is a **hard seed-time error**, not a runtime surprise
(§3.8, check 3).

**Selection is not revelation.** Matching a skill decides which XP an activity earns; whether it
opens the map is a separate question answered by that skill's `revealsGround` (§3.2, D-189). A
road ride matches `roving` and earns full XP, and writes no cells. Keeping the two apart is what
lets cycling be a first-class skill without cycling becoming the dominant way to train
Cartography — a bike covers roughly three times the ground of a run for the same effort, and
because the map never re-fogs, ground revealed from a saddle could never be re-earned on foot.

### 3.5 THE VIGIL TEST (D-132)

D-132: *"GPS-less running trains a SEPARATE activity skill, at full XP, with zero discovery
credit and no map reveal… adding it must be a DATA ROW, not code."*

**Step 1 — Wayfaring gains one line.** Its `match` block, previously implicit, becomes explicit:

```yaml
  - id: wayfaring
    name: Wayfaring
    kind: activity
    displayOrder: 10
    logMode: trace
    unit: km
    match: { kinds: [run, walk, hike], requiresTrace: true, sources: any, measure: distanceKm }
    matchPriority: 100
    xpPerUnit: 100
    groundMultipliers: { new: 1.0, rearmed: 0.5, recent: 0.5 }   # D-120
    softCapUnits: null
    sanityCeilingUnits: 300
    minUnitsForCredit: 0.25
    feeds: [{ skill: constitution, rate: 0.3333 }]
```

**Step 2 — Vigil is this row, and nothing else in the system changes:**

```yaml
  - id: vigil
    name: Vigil                      # provisional (D-132); it is a display string, not an id
    kind: activity
    displayOrder: 15
    logMode: trace                   # same kernel: a distance-measured effort
    unit: km
    match: { kinds: [run, walk, hike], requiresTrace: false, sources: any, measure: distanceKm }
    matchPriority: 100
    xpPerUnit: 100                   # D-132: FULL activity XP, identical to Wayfaring
    groundMultipliers: null          # not ground-scored: there is no ground
    softCapUnits: null
    sanityCeilingUnits: 300
    minUnitsForCredit: 0.25
    feeds: [{ skill: constitution, rate: 0.3333 }]
```

As a T5 item:

```json
{ "rulesVersion": "2", "skillId": "vigil", "name": "Vigil", "kind": "activity",
  "enabled": true, "displayOrder": 15, "logMode": "trace", "unit": "km",
  "match": { "kinds": ["run","walk","hike"], "requiresTrace": false,
             "sources": "any", "measure": "distanceKm" },
  "matchPriority": 100, "xpPerUnit": 100, "groundMultipliers": null,
  "softCapUnits": null, "sanityCeilingUnits": 300, "minUnitsForCredit": 0.25,
  "feeds": [{ "skill": "constitution", "rate": 0.3333 }], "exercises": [] }
```

**Now check each of D-132's three clauses against the row:**

| D-132 clause | Satisfied by | Code change needed? |
|---|---|---|
| A **separate** skill, outdoor and indoor never diluting each other | two `skillId`s ⇒ two `SkillState` rows ⇒ two independent XP totals, two independent levels, and Total Level (D-033) rises by 1 because it iterates the registry (04 §1.2) | **none** |
| **Full** activity XP | `xpPerUnit: 100`, `groundMultipliers: null` ⇒ multiplier 1.0. This also **overrides 05 §3.6's provisional "treadmill = half Wayfaring XP" recommendation**, which §9.1 of that document flagged as undecided and D-132 has now settled. | **none** |
| **Zero discovery credit, no map reveal** | falls out with no field at all: `hasTrace: false` ⇒ `traceRef: null` ⇒ no trace ⇒ no H3 projection ⇒ `cells.size == 0` ⇒ no `ExploredCell` write, no generation bump, no Cartography award (05 §3.6, verbatim). T3 still records `cellCount: 0` so the row shape never varies. | **none** |

**Everything downstream already treats skills as opaque strings**, which is what makes this hold:

- `SkillState.skillId` is documented as *"an opaque string, never an enum"* (T2). A `vigil` row is
  created on first award by the same `UpdateItem … ADD` used for every other skill.
- `XpLedgerEntry.id` is `${activityId}#${skillId}#${reason}#v${xpRulesVersion}` (T4) — a string
  template that never enumerates skills.
- `Profile.totalLevel` / `totalXp` sum the `SkillState` query result; a sixth or seventh row is
  arithmetic, not a branch.
- The skill panel and the log page iterate T5 ordered by `displayOrder`.
- `reason` for a Vigil award is `distance` — the same closed vocabulary value Wayfaring uses on
  ungrounded distance (§4.2). No new `reason` is minted.

**Verdict: Vigil is one YAML row, one seeded item, zero lines of code.** The row above is the
whole diff. A rename ("Vigil" → anything) is one attribute. This is the acceptance test D-132
demanded, and the schema in §3.2 + §3.4 passes it.

### 3.6 The loud part: 04 §1.3's schema, as written, does NOT pass

**Stated plainly, because D-132 asks for exactly this signal.**

The YAML in `04-game-design.md` §1.3 has no `match` block. Under it, Wayfaring and Vigil are
byte-identical in every field that could distinguish them — both `kind: activity`,
`logMode: trace`, `unit: km`, `xpPerUnit: 100`. **Nothing in the row says which one a given run
trains.** The scorer would have to decide from `activity.hasTrace` in code, and the only place to
put that decision is a branch naming the two skills:

```ts
// THE FAILURE MODE. If this line is ever written, D-031 is broken and D-132 has failed.
const skill = activity.hasTrace ? "wayfaring" : "vigil"
```

That is a `switch` on skill id, the precise construct 04 §1.3 outlaws, and it would have to be
edited again for every future skill pair that splits on a condition (indoor cycling, rowing erg,
pool swim — every one of them is a Vigil-shaped problem).

**The fix is additive and small: the `match` block in §3.4, plus `matchPriority`.** No existing
field changes meaning; `groundMultipliers: null` gains a documented third state. The four
pre-existing skills each gain one `match` line. **This must land in `rules/xp-rules-v1.yaml`
before any scoring code is written** — retrofitting selection into data after a `switch` exists
means rewriting the scorer and reissuing a rules version.

**Action required:** `04-game-design.md` §1.3's schema block should be amended to include `match`
and `matchPriority`, or annotated to point here. This document does not have the authority to
edit that one; the ticket backlog must carry it. Filed as a blocking item for implementation.

### 3.7 The honest boundary — what stays code, forever

Data cannot be turned all the way down, and pretending otherwise produces a YAML dialect that is
a programming language with no debugger. The line is drawn here:

**Code (four `logMode` kernels, closed set, changed only by a real design change):**

| `logMode` | Kernel | `measure` values it serves |
|---|---|---|
| `trace` | units = distance in km from the activity | `distanceKm` |
| `reps` | units = Σ `sets[].reps` where `sets[].exercise` ∈ this skill's `exercises[].id` | `reps:<exerciseId>` |
| `duration` | units = Σ `sets[].durationS` for this skill's exercises | `seconds:<exerciseId>` |
| `derived` | units supplied by another subsystem (cells from fog; `feeds` shares) | `cells`, `share` |

**Data (everything else):** which skills exist, their names, ids, order, units, rates, caps,
floors, ground multipliers, meta-skill feeds, exercise rows and quick-log values — **and which
activities each skill matches.**

Adding Burpees, Pull-ups, Rowing or Kettlebell Swings needs no new kernel: each is `reps` or
`duration`. **Adding a fifth kernel is the one event that requires code**, and 04 §1.3 already
names the rule: *"If a future skill needs a shape this schema cannot express, add a `logMode`, not
a special case."* Pool swimming (distance with no GPS) is not a new kernel — it is
`match: { kinds: [other], requiresTrace: false, measure: distanceKm }`, i.e. another Vigil.

### 3.8 Seeding, and the CI checks that keep this true

The deploy-time seeder reads `rules/xp-rules-vN.yaml`, validates it, and writes T5 items under
partition `N`. It is **idempotent and append-only across versions**: it never edits an existing
`rulesVersion` partition, because 04 §7.6 requires every shipped ruleset to survive forever —
a ledger row citing `v1` is meaningless if `v1`'s rows were mutated.

Validation, run in CI and again in the seeder, failing the build on any violation:

1. `skillId` unique within a version; `feeds[].skill` resolves to an existing `kind: meta` row.
2. `feeds` has no cycles (Constitution feeds nothing — 04 §1.1).
3. **Totality:** for a fixture set of activities covering every `ActivityKind` × `hasTrace`
   combination, `selectActivitySkills` returns **exactly one** skill per `measure`. Zero matches
   for measurable work, or two at equal `matchPriority` with the same `measure`, fails the build.
4. **Determinism:** the matcher is called with the clock and RNG stubbed to throw (mirrors the
   contract §5 check on `normalize()`).
5. **The D-132 regression test, permanently:** seed the v1 registry, add *only* the Vigil row from
   §3.5, and assert (a) the repo's TypeScript diff is empty, (b) a `hasTrace: false` run scores
   into `vigil` at full rate, (c) the same run with a trace scores into `wayfaring`, (d) neither
   writes an `ExploredCell` for the traceless case. **This test is the acceptance criterion for
   D-031, wired into CI so the property cannot rot.**
6. `grep -rE '"(wayfaring|vigil|might|fortitude|endurance|cartography|constitution)"' src/` returns
   nothing outside `rules/`, fixtures and tests — the skill-name equivalent of the contract §5
   `grep -ri strava` check.

---

## 4. The XP ledger

Two requirements meet here and pull in opposite directions:

- `04-game-design.md` §7.1: **"Store facts. Derive XP. Never store XP as a fact."** A rebalance
  must be a recomputation, not a migration.
- **D-135:** *"Replay never lowers already-displayed XP. Corrections may only add."*

A pure derivation is free to go down. A monotonic display is not. The resolution is that
**monotonicity is itself recorded as a fact in the ledger** (§4.6), so the invariant
`displayedXp == SUM(ledger)` never breaks and there is no second, shadow mechanism that the
recompute path could disagree with.

### 4.1 One row per (activity, skill, reason)

04 §7.3's `XpLedger` is adopted as T4 with the field names from §2's table, plus the two things
that table needs to be operable at all: a deterministic `id` and an explicit `seq`.

| attr | type | notes |
|---|---|---|
| `id` | S | `${activityId}#${skillId}#${reason}#v${xpRulesVersion}` — deterministic, so the write is `ConditionExpression: attribute_not_exists(id)` and a webhook replay is a no-op (§2 T8 layer 4) |
| `userId` | S | GSI2 partition |
| `activityId` | S | GSI1 partition. For floor rows (§4.6): the sentinel `__floor__`. |
| `skillId` | S | opaque (§3) |
| `reason` | S | closed vocabulary, §4.2 |
| `units` | N | raw measured quantity — e.g. `8.37` km |
| `unitsEffective` | N | after the D-120 ground split and any `softCapUnits` — e.g. `5.19` |
| `xpAwarded` | N | **integer.** Rounding happens once, here, at write time; never at read time, or two screens summing in different orders would disagree. |
| `xpRulesVersion` | N | **the row is meaningless without this** (04 §7.6) |
| `isFloor` | BOOL | **the D-135 marker.** `false` for every rule-derived row. `true` rows are facts about what the user was shown and are **never deleted by a replay** (§4.6). |
| `seq` | S | `<startedAt>#<activityId>#<nn>` — replay order per 04 §7.4 (ascending `startedAt`, ties by activityId), `nn` ordering rows within one activity |
| `awardedAt` | S | ingest wall clock, ISO 8601 UTC. **Audit only. Never an input to scoring** — a scoring input that reads the clock would break 04 §7.4's determinism. |

`SkillState.xpLedgerSum` is a pure `SUM(xpAwarded)` over this table for one `(userId, skillId)`.
That is the whole contract between the two tables, and it is what makes 04 §7.3's *"a rebalance is
`DELETE FROM XpLedger; replay;` and nothing else in the system needs to know"* literally true —
with the single, deliberate exception of `isFloor` rows.

### 4.2 The `reason` vocabulary

Closed, and versioned with the ruleset. 04 §7.3's list, trimmed to MVP (D-122 removes combat) and
extended by the two rows this design needs:

| `reason` | Written when | Emitted by |
|---|---|---|
| `new_ground` | distance over never-seen cells | scorer, `logMode: trace` |
| `rearmed_ground` | distance over cells last run > 6 months ago (D-120) | scorer |
| `recent_ground` | distance over cells last run ≤ 6 months ago — **half XP, D-120/D-021** | scorer |
| `distance` | distance with **no ground classification at all** — this is Vigil's row (§3.5), and any future traceless distance skill | scorer |
| `reps` | `logMode: reps` | scorer |
| `duration` | `logMode: duration` | scorer |
| `cells_new` / `cells_rearmed` | Cartography, 1.0 and 0.5 credit (05 §8.2) | fog subsystem |
| `constitution_share` | the `feeds` propagation, 1/3 (04 §1.1) | scorer |
| `retained_floor` | **D-135 only.** §4.6. | replay job |
| `slayer_win`, `slayer_loss`, `boss_phase` | reserved, post-MVP (D-122) | — |

**`recent_ground` and `cells_recent` are asymmetric on purpose**: repeated ground still pays half
activity XP (D-021/D-120) so there *is* a row, but it pays **zero** discovery credit, so there is
no Cartography row at all rather than a row of zero. A zero-XP row would inflate the ledger by
~40% for no information.

Typical rows per activity: a run ≈ 5 (up to three ground rows + `cells_new` + `constitution_share`),
a strength session ≈ 4 (three exercises + share). That is the ~4.5 rows/activity behind T4's
9,000–25,000 five-year estimate.

### 4.3 The write path

Every ledger row is written inside the single `TransactWriteItems` described in §2 T8 layer 3,
together with the `Activity` put, the `SkillState` `ADD`s, the `ExploredCell` updates and the
receipt's `status = "DONE"`. **XP and its receipt commit or fail together**; there is no window in
which a row exists without the idempotency gate that would stop it being written twice.

```
TransactWriteItems (≤ 100 items; a run is ~15, worst case ~40)
  Put    Activity              ConditionExpression: attribute_not_exists(id) OR revision < :rev
  Put    XpLedgerEntry × N     ConditionExpression: attribute_not_exists(id)
  Update SkillState × M        ADD xpLedgerSum :xp, displayedXp :xp
                               SET level = …, levelHighWater = …, lastXpAt = :now
  Update Profile               SET totalXp = totalXp + :xp, exploredGeneration = :gen
  Update IngestReceipt         SET status = "DONE"  ConditionExpression: status = "PROCESSING"
```

`level` and `levelHighWater` cannot be computed inside DynamoDB, so the Lambda computes them from
the pre-read `SkillState` and writes them with a `ConditionExpression` on the pre-read
`xpLedgerSum`; a lost race retries the whole transaction. At ≤ 6 users with at most one ingest in
flight each, that race is theoretical — but the condition costs nothing and its absence would be
a silent lost update.

**Cell writes stay outside** this transaction when a run touches more than ~60 cells, because
`TransactWriteItems` caps at 100 items and a run touches 40–130 (R3 §2). The ordering is: cell
writes first (idempotent set-inserts, §2 T6), then the transaction. A crash between the two leaves
cells revealed with no XP awarded — which the replayed message then fixes, awarding XP while the
cell writes no-op. **The failure mode is "map ahead of XP", never "XP ahead of map"**, and that is
the right direction: D-020 makes the map append-only, so an early cell write is never wrong.

### 4.4 Recomputation — the procedure

A rebalance is: write `rules/xp-rules-v2.yaml`, seed T5 partition `2` (§3.8), run the replay job.
**Ship the job in MVP, before it is needed** (04 §7.6) — an untested recompute path is not a
recompute path.

```
replay(userId, toRulesVersion):

 0. PRE-FLIGHT
    read every SkillState row for the user  →  prevDisplayed[skillId] = displayedXp
                                               prevLevel[skillId]     = max(level, levelHighWater)
    snapshot them into ReplayRun (§4.5). THIS IS THE D-135 WATERLINE.

 1. FREEZE
    set Profile.replayInProgress = true. Ingest continues (it is idempotent and the
    activity is picked up in step 3 or by the reconciliation sweep); the UI reads the
    pre-replay SkillState throughout, so no number ever visibly flickers downward.

 2. CLEAR
    delete every XpLedgerEntry for the user WHERE isFloor = false, via AP-11
    (GSI2 byUserAndSeq, batched 25/write). isFloor rows SURVIVE — they are facts about
    what was displayed, not derivations from rules.

 3. REPLAY, in 04 §7.4 order — Activity GSI1 byUserAndStart ascending, ties by activityId
    for each Activity with status = ACTIVE:
      a. load the registry for toRulesVersion (§3.2), select skills (§3.4)
      b. ground classification: fold cells/<uid>/<activityId>.cells.bin (§2.9) in the SAME
         order, maintaining an in-memory firstRunAt/lastRunAt map. This reconstructs the
         D-120 "was this ground run within 6 months" answer AS IT WAS, from facts —
         it does NOT read ExploredCell, which is a cache of this very fold.
      c. write XpLedgerEntry rows with xpRulesVersion = toRulesVersion, isFloor = false
      d. accumulate newSum[skillId]

 4. REBUILD ExploredCell from the same fold (it is derived — §1.1, §2.9), and regenerate
    the blobs via AP-17 + §2.10. Bump generation ONCE, at the end.

 5. RECONCILE against the waterline — §4.6. This is the only step that can add rows.

 6. THAW
    write SkillState in one pass; clear replayInProgress; write the chronicle entry
    (04 §7.6: "The rules of the world shifted… nothing was taken away.")
```

Volume makes this trivial: 2,000–5,000 activities and 20k–50k cells at five years (§2), so a full
replay is **seconds and a few hundred thousand RRU/WRU — well under a dollar, once**, comfortably
inside D-083.

**Per-user, not global.** Six users (D-014) replayed one at a time keeps each transaction's blast
radius to one person and makes a partial failure resumable rather than global.

### 4.5 `ReplayRun` — the audit row

The waterline must outlive the job, or a crash in step 5 loses the record of what the user had
been shown. It is written to T4's table under a reserved partition rather than earning a ninth
table:

```
XpLedgerEntry item, id = REPLAY#<userId>#<ulid>
  { userId, fromRulesVersion, toRulesVersion, startedAt, finishedAt,
    status: RUNNING | DONE | FAILED,
    waterline: { wayfaring: {xp: 412900, level: 47}, … },   # step 0
    recomputed: { wayfaring: {xp: 398100, level: 46}, … },  # step 3
    floorsWritten: { wayfaring: 14800, … },                 # step 5
    isFloor: false, xpAwarded: 0 }
```

`xpAwarded: 0` keeps it harmless to any `SUM` that sweeps the partition. Retained forever; there
will be ~3 of them in five years.

### 4.6 D-135, enforced — what happens when the new number is lower

**The rule:** for every skill, after a replay,
`displayedXp_after ≥ displayedXp_before` and `displayedLevel_after ≥ displayedLevel_before`.
Unconditionally. No exceptions for bug fixes, no exceptions for a rate the user "shouldn't have
had".

**The mechanism — a compensating ledger row, not a clamp.** For each skill in step 5:

```
existingFloors = SUM(xpAwarded) over this skill's isFloor = true rows   # survived step 2
gap            = prevDisplayed[skillId] - (newSum[skillId] + existingFloors)

if gap > 0:
    Put XpLedgerEntry {
      id:             `__floor__#${skillId}#v${fromVersion}-${toVersion}`,   # deterministic
      activityId:     "__floor__",
      skillId, userId,
      reason:         "retained_floor",
      units: 0, unitsEffective: 0,
      xpAwarded:      gap,                          # integer, ≥ 1
      xpRulesVersion: toVersion,
      supersedesRulesVersion: fromVersion,
      isFloor:        true,
      seq:            `9999-12-31T00:00:00Z#__floor__#${skillId}`,   # sorts last, always
      awardedAt:      now
    }  ConditionExpression: attribute_not_exists(id)

displayedXp = xpLedgerSum = newSum + existingFloors + gap    #  == prevDisplayed exactly
```

Five properties this buys, none of which a clamp would:

1. **`displayedXp == SUM(ledger)` stays true.** The one invariant every screen, every audit and
   every future migration depends on is never violated. A clamped `displayedXp` that disagreed
   with its own ledger would be an unfalsifiable number.
2. **Auditable.** "Why is my Wayfaring 412,900 when the rules say 398,100?" is answered by a row
   the user can be shown: *14,800 XP retained from ruleset v1.*
3. **Idempotent.** The `id` is deterministic in `(skill, fromVersion, toVersion)`, so re-running a
   failed replay writes the same row once. Re-running an *already-completed* replay computes
   `gap = 0` and writes nothing.
4. **No double counting across successive rebalances.** `existingFloors` is inside the `gap`
   arithmetic, so a v2→v3 replay only tops up whatever v3 still leaves short of the waterline.
   Floors accumulate; they never compound.
5. **Self-extinguishing.** Floors are a debt the honest rules pay off. Once the user's real
   activity carries `newSum` back above the waterline, `gap ≤ 0` and no new floor is written; the
   old ones remain, correctly, as the record of what was already banked. **The user simply does
   not advance again until their recomputed XP catches up** — which is exactly 04 §7.5's
   intended behaviour, now expressed in XP rather than only in levels.

**`sequence`/ordering note:** floors sort last (`seq` begins `9999-…`) so a chronological ledger
view shows them where they belong — after the history they compensate for, not interleaved with it.

**Levels need their own high-water, and it is not redundant.** The XP floor covers a *rate*
change. It does **not** cover a *curve* change: if D-130's `4L²` were ever retuned to `5L²`, XP
would be untouched and the level would still fall. So `SkillState.levelHighWater` (04 §7.5) is
retained as an independent ratchet, and `displayedLevel = max(level, levelHighWater)`.
**Two ratchets, two distinct threats.** Total Level (D-033) is summed from `displayedLevel`, so it
inherits monotonicity for free.

### 4.7 The other three ways XP could go down, and what each does

D-135 is about replay, but three non-replay paths could also lower a number. All are closed the
same way:

| Path | What happens | Result |
|---|---|---|
| **Strava sends `aspect_type: delete`** (D-121 territory: the source can retract) | `Activity.status = TOMBSTONED`. Its ledger rows are **kept**, not deleted. The activity leaves the activity list; the XP does not leave the total. Cells are never removed (D-020, §2 T3). | XP unchanged |
| **Source-side edit** (distance corrected downward, `revision` bumped) | re-score, and write the *difference* only if positive. A negative difference writes nothing. | XP never falls |
| **A scoring bug found in production** | fix the rules, run a replay. §4.6 handles it. | XP never falls |

**There is no un-award code path in this design.** 05 §3.5's un-award machinery is retained only
for the fog *cache* rebuild (which is idempotent and re-derivable), never for XP. If a row of XP
was ever displayed, it is permanent. That is D-135, taken literally.

---

## 5. Access patterns

Every query the app makes. If a read is not in this table, the design does not support it, and
adding it means adding a row here first — that is how a GSI that nobody needed gets caught before
it is provisioned and paid for forever.

### 5.1 The complete list

**Read patterns.** Cost is per invocation. RRU = read request unit (1 = one strongly consistent
4 KB read; eventually consistent reads are 0.5). Every read below is eventually consistent unless
marked, because nothing in this app is harmed by a 100 ms-stale number.

| AP | Pattern | Table / index | Operation | Items | Cost |
|---|---|---|---|---|---|
| **AP-1** | Profile for the signed-in user | T1 `Profile` base | `GetItem` | 1 | **0.5 RRU** |
| **AP-2** | All skills for a user (skill panel, Total Level) | T2 `SkillState` base | `Query userId` | 6–8 | **0.5 RRU** (all rows < 4 KB) |
| **AP-3** | Activity list, newest first, paged | T3 GSI1 `byUserAndStart` | `Query userId, ScanIndexForward=false, Limit=20` | 20 | **~3.5 RRU** (20 × 700 B) |
| **AP-4** | One activity, full detail | T3 base | `GetItem id` | 1 | **0.5 RRU** |
| **AP-5** | One skill's state (skill detail page) | T2 base | `GetItem (userId, skillId)` | 1 | **0.5 RRU** |
| **AP-6** | Pre-read of `SkillState` before the ingest transaction (§4.3) | T2 base | `Query userId` **consistent** | 6–8 | **1 RRU** |
| **AP-7** | XP itemisation for one activity (post-run tally, activity detail) | T4 GSI1 `byActivity` | `Query activityId` | 4–6 | **0.5 RRU** |
| **AP-8** | The skill registry + curve for a rules version | T5 `RuleSkill` base | `Query rulesVersion` | ~9 | **0.5 RRU**; cached in the client for the session |
| **AP-9** | One skill's XP history (sparkline, "training since") | T4 GSI3 `bySkill` | `Query userId#skillId, SK between` | 50–500 | **1–13 RRU** (INCLUDE projection keeps rows ~80 B) |
| **AP-10** | Cross-source dedupe check at ingest | T3 GSI2 `byUserAndDedupe` | `Query userId, SK = dedupeKey` | 0–1 | **0.5 RRU** (KEYS_ONLY) |
| **AP-11** | Replay: every ledger row for a user, in order | T4 GSI2 `byUserAndSeq` | `Query userId` paged | 9k–25k | **~1,250 RRU** once per rebalance |
| **AP-12** | Webhook: `owner_id` → `userId`; worker: fetch tokens | T7 GSI1 `byExternalOwner` (KEYS_ONLY), then T7 base | `Query` + `GetItem` | 1 + 1 | **1 RRU**; the index cannot leak a token (§2 T7) |
| **AP-13** | "Did I work out today" / a day's activities | T3 GSI3 `byUserAndDay` | `Query userIdLocalDay` | 0–4 | **0.5 RRU** — uses `startedAtLocal` (contract conflict #3) |
| **AP-14** | Generation mirror for the AppSync subscription | T1 base | `GetItem` / subscription push | 1 | **0.5 RRU** |
| **AP-15** | Ingest: which of this run's cells already exist | T6 `ExploredCell` base | `Query` per touched res-6 parent (1–2) | 1–2,401 | **~1–50 RRU** |
| **AP-16** | Blob rebuild: the user's whole explored set | T6 base | `Query AGG#6` then `Query` per parent | 20k–150k | **~1,000–3,000 RRU** — **repair path only** (§2.10) |
| **AP-17** | Consistency scan / rebuild drill | T6 base | as AP-16 + verification | all | as AP-16 |
| **AP-18** | Idempotency gates | T8 `IngestReceipt` base | `GetItem` / conditional writes | 1 | **0.5 RRU** |
| **AP-19** | `/tickets` drain: undrained inbox rows | `Ticket` base | `Query userId, filter attribute_not_exists(drainedAt)` | 0–50 | **0.5 RRU** |
| **AP-20** | Region list + denominators for "% territory" | `Region` base | `Scan` (≤ 20 items, once per session) | ≤ 20 | **0.5 RRU** |

**Client-side patterns — no server round trip at all.** These are the reads that would have
dominated the bill in a naive design, and R3's "ship the whole set" architecture (05 §7) removes
them entirely:

| AP | Pattern | Served by | Cost |
|---|---|---|---|
| **S-1** | Map load: the explored set | S3 `manifest.json` (revalidate, 304) + `explored-r10.<gen>.bin` from cache or CloudFront | 1 conditional GET; a cold load adds one immutable GET (§6) |
| **S-2** | Viewport render, pan, zoom | in-memory `BigUint64Array` + res-6 buckets (05 §6.1) | **zero** |
| **S-3** | "% explored" of a region | in-memory `Set.has()` over `region.cellsRes10` (05 §8.1) | **zero**; ~13k lookups, milliseconds |
| **S-4** | "Unexplored near me" | in-memory `frontier()` (05 §8.4) | **zero** |
| **S-5** | Cold-territory overlay, atlas mode only (D-133) | lazy GET of `explored-lastrun-r10.<gen>.bin` | one GET, on demand only |
| **S-6** | Mid-session run landing | AppSync subscription (AP-14) + one `deltas/<from>-<to>.bin` GET | ~1 KB (05 §7.4) |
| **S-7** | Trace polyline on activity detail | `traces/<activityId>.polyline.gz` | one immutable GET |

### 5.2 By screen — what actually fires

| Screen | Patterns | Total |
|---|---|---|
| **Dashboard load** | AP-1 (profile, Total Level) + AP-2 (six skill bars) + AP-3 `Limit=5` (recent activity) + AP-8 (registry, cached) + S-1 (map) | **~2.5 RRU + 1 conditional S3 GET.** Three independent small reads — the case §2.1 made against single-table design. |
| **Map load** | S-1 only, plus S-5 if the atlas cold overlay is on | **zero DynamoDB.** The client already holds the set. |
| **Activity list** (paging) | AP-3 per page of 20 | ~3.5 RRU/page |
| **Activity detail** | AP-4 + AP-7 (itemisation) + S-7 (polyline) | **1 RRU + 1 S3 GET** |
| **Skill panel** | AP-2 + AP-8; AP-9 only when a skill is expanded | 1 RRU, +13 for a history chart |
| **Post-run summary** ("Return from the Fog", 04 §4.2) | AP-4 + AP-7 + S-6 (the delta that reveals the ground) | **1 RRU + 1 KB.** The itemisation is free because the ledger *is* the tally (04 §7.3 job 1). |
| **"% explored"** | S-3, after AP-20 once per session | **zero** |
| **"Unexplored near me"** | S-4 | **zero** |
| **Ticket inbox** (phone, D-092) | write-only create; the pending list is a local IndexedDB echo of what this device created, reconciled against AP-19 only in the `/tickets` agent run | **zero on the phone.** D-093 makes the repo the source of truth, so the app has nothing to read back. |

### 5.3 Write patterns

| WP | Trigger | Writes | Cost |
|---|---|---|---|
| **WP-1** | Webhook accept (01 §4 step 3) | T8 conditional `PutItem` | 1 WRU |
| **WP-2** | Score + persist (§4.3) | 1 Activity + ~5 ledger + ~3 SkillState + 1 Profile + 1 receipt, **transactional (2× WRU)** | ~22 WRU |
| **WP-3** | Cell writes (§2 T6) | 40–130 `UpdateItem` + 1–2 AGG | ~45–135 WRU |
| **WP-4** | Blob regeneration (§2.10) | 1 S3 GET + 3 PUTs | ~$0.00002 |
| **WP-5** | Token refresh (01 resource #14) | 1 T7 `UpdateItem` per adapter per ~5 h | negligible |
| **WP-6** | Manual workout (D-061) | as WP-2 with no WP-3 | ~18 WRU |

**~120 WRU per activity, dominated by cell writes** — which is the intended shape: the expensive
thing is the thing the product is about.

### 5.4 What is deliberately *not* a query

- **No "cells near a point" query.** S-4 answers it in memory. A server-side spatial query would
  need either PostGIS (D-082 forbids) or a per-viewport API (05 §7 forbids in bold).
- **No "which activities touched this cell".** It would need a GSI on a 150k-item table, doubling
  its write cost forever (§2.9). The answer, when needed, is a fold of `cells/*.cells.bin`.
- **No cross-user anything.** D-011/D-014: no leaderboards, no comparison, no shared queries.
  Every partition key in the system starts with a user id.
- **No full-text search over activity names.** `name` is display-only (contract §2).

### 5.5 Pricing basis

On-demand pricing, us-east-1, approximate: **$0.125 per million RRU, $0.625 per million WRU**;
AppSync **$4.00 per million operations**; S3 **$0.005 per 1,000 PUTs, $0.0004 per 1,000 GETs**.
Volume basis: 1,000 activities/year (the pessimistic figure from 04 §7.6), 6 users, 5 app loads
per user per day.

### 5.6 The five-year bill (the §2.1 forward reference)

| Line | Five-year volume | Cost |
|---|---|---|
| DynamoDB writes | 5,000 activities × ~120 WRU ≈ **600k WRU** | **$0.38** |
| DynamoDB reads | ~55k app loads × ~3 RRU + ingest pre-reads ≈ **250k RRU** | **$0.03** |
| Three full replays (AP-11 + AP-16 + rewrite) | ~3 × 1.3M units | **$0.02** |
| AppSync operations | ~55k loads × 4 ops ≈ **220k** | **$0.88** |
| S3 PUTs (blob regeneration, WP-4) | 5,000 × 3 ≈ **15k** | **$0.08** |
| S3 GETs | ~60k | **$0.02** |
| S3 storage | ~35 MB DynamoDB (free tier) + ~2 GB S3 raw/traces/blobs | **~$0.05/mo** |
| **Total, five years** | | **well under $10 of request charges** |

**The bill is not the storage and not the requests — it is CloudFront, Cognito and the Amplify
build minutes**, all of which sit in 01's estimate. This document's contribution to the D-083
budget rounds to zero, and the 25 GB DynamoDB free tier is never approached (§2.1).

**The one thing that could break this** is a full-table `Query` (AP-16) on the ingest hot path.
At 3,000 RRU per run it would be $0.002/run — still trivial in absolute terms, but it is 100×
the correct path (§2.10) for no benefit, and it is the sort of drift that only shows up in a
bill. AP-16 is the repair path. Calling it from `process-activity` is a review-blocking bug.

---

## 6. The client payload

`05-fog-of-war.md` §7 owns this format. **This document does not redefine it** — it states the
storage-side obligations, the size arithmetic at one and five years, and the invalidation contract
between the ingest Lambda and the browser.

The architectural claim being underwritten (R3, 05 §7): **ship the entire explored set to the
client, once per session.** One GET at app load, then every spatial question (S-2 … S-4) is an
in-memory operation. This section shows the numbers that make that claim survive five years.

### 6.1 The objects

Per user, under `s3://lost-soles-storage/users/<uid>/` (05 §7.3):

| Object | Contents | Cache-Control | Fetched |
|---|---|---|---|
| `manifest.json` | `{generation, res, cellCount, updatedAt, cells, agg, lastRun, deltasFrom}` | `no-cache` | every load (a 304 is a few hundred bytes) |
| `explored/explored-r10.<gen>.bin` | the set — `LSFG` header + `baseCell` u64 + (count−1) LEB128 ascending deltas (05 §7.1) | `public, max-age=31536000, immutable` | cold load only |
| `explored/explored-agg.<gen>.json` | res 6/7/8 parent → `{exploredChildren, totalChildren, fraction}` | immutable | app load; a few KB |
| `explored/explored-lastrun-r10.<gen>.bin` | `u16` days-since-2020-01-01, **parallel to the cell array** | immutable | **lazily** — atlas cold overlay only (D-133) |
| `deltas/<fromGen>-<toGen>.bin` | `LSFD`, adds only, ascending delta-varint | immutable, GC'd after ~20 generations | mid-session update (S-6) |

`<gen>` in the name is what makes `immutable` safe: a generation is never rewritten, so no cache
anywhere — browser, IndexedDB, CloudFront — can ever be wrong, and nothing needs purging.
**`manifest.json` is the only mutable object in the whole delivery path.**

### 6.2 Size, at one year and at five

Three cell-count scenarios. "Realistic" is a home-based runner who re-runs the same streets
constantly (R3's own framing); "pessimistic" is R3's zero-route-overlap worst case, which will
never happen. Discovery is heavily front-loaded — the home metro falls in the first year — so the
one-year figure is a large fraction of the five-year one, and growth after that is slow.

| Horizon | Cells | Raw u64 | Delta + LEB128 | **Over the wire (gzip)** |
|---|---|---|---|---|
| **1 year, realistic** | ~8,000–15,000 | 64–120 KB | ~20–38 KB | **~18–33 KB** |
| **1 year, pessimistic** | ~29,500 | 236 KB | ~74 KB | **~60–80 KB** |
| **5 years, realistic** | 20,000–50,000 | 160–400 KB | 50–125 KB | **~45–110 KB** |
| **5 years, pessimistic** (R3 §6) | **147,782** | 1.18 MB | ~370 KB | **~300–450 KB** — R3's headline figure |
| 10 years, pessimistic (headroom check) | ~250,000 | 2.0 MB | ~625 KB | ~500–750 KB |

**Why gzip buys so little on top of varint, and why that is fine.** Delta-encoded LEB128 is close
to entropy already — the redundancy gzip lives on has been removed by the delta step. R3's
300–450 KB gzipped figure and the ~370 KB varint figure therefore sit on top of each other rather
than a factor apart; **treat the varint size as the floor and R3's range as the number of record.**
Serving with `Content-Encoding: gzip` still earns its place: it costs nothing (S3 stores the
gzipped object, CloudFront passes it through) and it does compress the header, the `agg` JSON and
the long runs of identical small deltas through dense grid territory.

**The lever, unpulled:** `flags` bit0 `compacted` ships `h3.compactCells()` output and shrinks
contiguous territory 3–10× (R3 §3.6). 05 §7.1 recommends **shipping uncompacted for v1** because
mixed-resolution arrays are an H3 correctness footgun. At 300–450 KB — one image's worth, once per
session, on a cached immutable URL — there is nothing to buy. **Revisit only if the payload passes
~1 MB**, which the table above puts past year ten of the case that will not happen.

### 6.3 What it costs the client, which is the real budget

Bytes on the wire are not the binding constraint; memory on a mid-range Android (D-124) is.

| Structure | 50k cells | 150k cells |
|---|---|---|
| Sorted `BigUint64Array` (what the render buckets iterate) | 400 KB | 1.2 MB |
| `Set<string>` for O(1) `has()` (what S-3/S-4 use) | ~7 MB | **~20 MB** |
| Decode + Set construction, one time | ~20 ms | **~50 ms** (05 §7.1) |

The typed array is free. **The `Set` is the entire memory cost**, and 05 §7.1 keeps both
deliberately. That is right at the sizes this app will actually see. **If the cell count ever
passes ~100k, drop the `Set` and answer `has()` by binary search on the array already in
memory** — 17 comparisons, no allocation, and S-3's 13,291-lookup region scan becomes ~230k
comparisons, still milliseconds. Recorded here so the trade is a decision rather than a
discovery during a slow-phone bug report.

### 6.4 Invalidation — the contract between the Lambda and the browser

**`generation` is the only cache key.** It is a monotonic per-user counter, bumped by the ingest
Lambda **inside the same transaction as the cell writes** (05 §7.3, §4.3 above), and mirrored to
`Profile.exploredGeneration` (T1) purely so the AppSync subscription has something to push
(AP-14). **The manifest is authoritative; the Profile attribute is a notification channel.** If
they ever disagree, the manifest wins and the mirror is repaired — which is why T1 documents it as
a mirror rather than a source.

The ordering obligation on the writer, in one line: **bump `generation` and write the new blobs
before writing the new `manifest.json`.** The manifest is the commit point. A crash before it
leaves orphan blobs (harmless, garbage-collected); a crash after it would point clients at an
object that does not exist. There is no third possibility, because the manifest PUT is a single
atomic S3 operation.

Boot sequence (05 §7.3, restated as an obligation rather than a suggestion):

1. Read IndexedDB (`{uid, generation}`, storing the **decoded** array — do not re-parse on warm
   start). If present, **render immediately**. Do not wait for the network.
2. Fetch `manifest.json` in parallel.
3. `manifest.generation === cached.generation` → done. Nothing else is fetched. **This is the
   common case, and it costs one 304.**
4. `cached.generation >= manifest.deltasFrom` → fetch and apply the delta chain (§6.5).
5. Otherwise → fetch the full `.bin`, replace the cache.

**Stale is always safe, and that is a structural property, not luck.** The set is append-only
(D-020), so a stale cache can only ever be *missing the newest run* — never *wrong about revealed
ground*. This is what licenses step 1's render-before-network. A design where territory could be
removed could not do this.

**Version skew:** if `manifest.res !== 10` (D-115) or the blob's `version` byte is unknown, the
client **discards its cache and refuses to render** rather than guessing. A silent mis-parse of
cell IDs looks like territory teleporting, which is indistinguishable from data loss to the user.

### 6.5 A run landing mid-session

The emotional payload of the product (05 §7.4). Strava's webhook fires, the Lambda scores, the
generation bumps, and an open tab must show the new ground without a reload and without refetching
the full blob.

```
GET deltas/<fromGen>-<toGen>.bin      # "LSFD", version, res=10, fromGen u64, toGen u64,
                                      # addedCount u32, ascending delta-varint cell IDs
```

**Typically 40–130 cells ≈ 100–350 bytes** (R3 §2). At that size the delta is smaller than the
HTTP headers requesting it — which is the point: the incremental path exists so the *client work*
stays small, not to save bandwidth.

- **Adds only. There is no removal opcode, and there must never be one.** D-020 makes the set
  append-only, and a client that cannot express a removal cannot be tricked into un-revealing
  ground by a malformed payload. This is the same structural argument as §4.7's "there is no
  un-award code path", applied to geometry.
- **`assert delta.fromGen === state.generation`** before applying; on mismatch, fall back to a full
  fetch. Chain multiple deltas when several generations behind, validating each.
- **Only the touched res-6 parents are invalidated** (`unique(added.map(c => cellToParent(c, 6)))`).
  One run touches 1–2 parents, so the update is sub-millisecond and one VBO upload. This is the
  third distinct use of the res-6 grouping already chosen for the T6 partition key and the client's
  viewport bucketing (§2 T6) — one decision, three payoffs.
- **Trigger order:** AppSync subscription on the generation counter (push, no polling, no VPC —
  D-081) → revalidate the manifest on `visibilitychange`/`focus` → a manual sync affordance.
  **Never a timer.** Background polling is exactly the upkeep D-013 rejects.
- `persistToIndexedDB` runs in an idle callback, never on the frame path.

**Deltas are garbage-collected at ~20 generations**, and `manifest.deltasFrom` tells the client
when the chain no longer reaches it. A client that has been closed for a month takes the full
fetch — one 300 KB immutable GET — and that is the correct outcome.

---

## 7. Migrations and versioning

### 7.1 Five version numbers, deliberately independent

Conflating any two of these would couple a change in one subsystem to a rewrite in another. They
are separate, and each has exactly one owner.

| Version | Lives on | Owner | Bumped when | Forces |
|---|---|---|---|---|
| `xpRulesVersion` | `Activity`, `XpLedgerEntry`, `SkillState.rulesVersionLastComputed`, T5 partition | `rules/xp-rules-vN.yaml` | any XP rate, cap, curve, skill or `match` change | an XP replay (§4.4). **No table change.** |
| `fogAlgoVersion` | `Activity.fogAlgoVersion`, the score-time `ingestKey` (T8) | the fog module (05 §3.5) | reveal radius, trace sanitisation, H3 projection changes | a cell rebuild + blob regeneration. **No XP change** unless Cartography counts move. |
| blob `version` byte | `explored-r10.bin` header (05 §7.1) | the blob encoder | wire format changes | clients discard their cache and refetch (§6.4) |
| `generation` | `manifest.json`, mirrored to `Profile` | the ingest Lambda | every cell write | a client delta or refetch (§6.5) |
| `revision` | `Activity.revision` (contract §2) | the adapter | a source-side edit of one activity | a re-score of that one activity |

**H3 resolution is not on this list, on purpose.** D-115 fixes res 10 and 05 §2.1 says
"canonical, never mixed". Changing it is not a version bump — it is a rebuild from raw (§8.3),
because every `ExploredCell` sort key and every byte of every blob would change meaning.

### 7.2 Schema evolution — the rules for changing a table

1. **Add attributes; never repurpose one.** A reader of an old row must not have to know which
   era wrote it. `Activity.cellCount` is written even when zero (§2 T3) precisely so the row shape
   never varies — a missing attribute and a zero attribute must never both be possible.
2. **Never change the meaning of a key.** `activityId = sha256(userId:source:externalId)` and
   `XpLedgerEntry.id = activityId#skillId#reason#vN` are load-bearing for idempotency (contract
   conflict #6, §2 T8 layer 4). Changing either formula silently un-deduplicates the entire
   history. If one must change, it is a rebuild (§8.3), not a migration.
3. **A new GSI is free to add and expensive to remove.** Adding one backfills asynchronously and
   costs one write per existing item; at 5,000 activities that is invisible. But every GSI is a
   permanent tax on every future write to that table, which is why §5.4 lists the indexes that
   were considered and rejected.
4. **Amplify model changes are `defineData` edits and a `sandbox`/pipeline deploy.** Adding a
   nullable field is safe. **Removing a required field, changing an identifier, or renaming a
   model replaces the physical table** — Gen 2 will happily do this and take the data with it.
   Any such change must be treated as §8.3, with a raw-archive rebuild, never as a deploy.
5. **T6, T7 and T8 are CDK tables with `removalPolicy: RETAIN`** — they survive a stack teardown
   by construction. That is the whole reason they are outside `defineData` (§2.1 reason 2).
6. **Backfills are jobs, not deploy hooks.** A deploy that mutates data cannot be rolled back.

### 7.3 XP rule versioning

Mechanically covered by §4.4. The storage obligations:

- **Every shipped ruleset is retained forever**, in git and as its own T5 partition (§3.8). A
  ledger row citing `v1` is meaningless if `v1`'s rows were mutated, and 04 §7.6 wants the
  chronicle to be able to replay what the user *saw at the time*.
- **`Activity.xpRulesVersion` records what the user saw; `SkillState.rulesVersionLastComputed`
  records what the current totals were built from.** After a replay they agree. Between step 2 and
  step 6 of §4.4 they do not, and that difference is the resumability marker if the job dies.
- A rules change **never touches a fact**. No `Activity` row, no `cells.bin`, no raw object is
  read-modify-written by a rebalance. That is what makes it a recomputation (04 §7.1).
- **Never rebalance silently** (04 §7.6): a rules change writes a chronicle entry, and §4.6's
  `retained_floor` rows make the "nothing was taken away" promise checkable rather than merely
  claimed.

### 7.4 The D-121 migration — moving off Strava

D-121 was made with full knowledge of the risk and against advice; **the mitigation that makes it
acceptable is that it is reversible.** This is what reversibility looks like in the tables.

D-121's practical failure mode is the **athlete cap**, not deletion (apps downgraded 9,999→1
without notice). So the realistic trigger is "friends get locked out" or "the user buys a watch"
(D-117), not an emergency.

**Before — Strava as the ingest source:**

| Table | State |
|---|---|
| T7 `SourceAccount` | one row, `sk = SRC#strava`, tokens, `scopes ⊇ activity:read_all` (D-121.3), `listSinceWatermark` |
| T3 `Activity` | `source = {source: "strava", externalId: "<int64 as string>", sourceTypeRaw: "Run"}`; `id = sha256(uid:strava:<externalId>)`; `raw.key = raw/<uid>/strava/<externalId>/<sha256>.json` |
| S3 `raw/<uid>/strava/…` | every raw stream response, archived at ingest **before `normalize()` ever ran** (D-121.2, contract §4 step 1) |
| T6 `ExploredCell` | keyed `U#<uid>#C#<parent>` / `<res10cell>`. **No source anywhere in the key or the item.** |
| T4 `XpLedgerEntry` | no source field at all |
| code | `src/adapters/strava/*` + one line in `src/adapters/registry.ts` (contract §3) |

**After — a watch vendor, GPSLogger (D-112) or Health Connect (D-113):**

| Table | Change |
|---|---|
| T7 | Strava row `status = DISCONNECTED`, tokens **deleted** (they are the one non-rebuildable thing, §1.1, and there is no reason to keep a dead credential). New row `sk = SRC#suunto`. |
| T3 | **historical rows are not touched.** New activities arrive with `source.source = "suunto"` and new `activityId`s. |
| S3 | `raw/<uid>/strava/…` **kept** — it is the system of record for those years (D-101). New objects land under `raw/<uid>/suunto/…`. |
| T6 | **not touched. Not one write. Not one cell.** |
| T4 / T2 | not touched. No XP moves, in either direction. |
| code | one new adapter directory, one registry line. Contract §5 check 2 is exactly this assertion. |

**Three consequences worth being explicit about:**

1. **`activityId` is source-scoped, so the same physical run ingested from two sources gets two
   ids.** That is by design (contract conflict #6 chose determinism over global identity) and
   `dedupeKey` is the mechanism that stops it becoming double XP: AP-10 queries GSI2
   `byUserAndDedupe` before every write, and the second arrival is dropped. **During a
   dual-connected overlap window — both Strava and the new source live — first writer wins and
   the loser is a no-op.** This is the one window a migration actually has to think about, and it
   is already closed by a query that runs on every ingest anyway.
2. **Historical backfill is a re-ingest, not a data edit.** A Strava bulk export dropped into the
   `file-upload` adapter (D-101, contract `SourceId`) replays through the same pipeline; every
   activity already present collides on `dedupeKey` and is discarded. **The correct outcome of
   backfilling data you already have is that nothing happens** — and that is a real test, cheap to
   run before the migration rather than after.
3. **Nothing in the game layer knows a migration occurred.** `SkillState`, `XpLedgerEntry`,
   `Profile.totalLevel` and the blobs contain no source field. The Total Level on the home screen
   is byte-identical the day before and the day after.

#### Why no cell re-fogs — three levels of retreat

D-020 says revealed territory is permanent forever. A migration must not be able to violate that
even by accident. Three increasingly aggressive retreats from Strava, and what each costs:

| Level | Action | `ExploredCell` | Blobs | XP | Replay fidelity |
|---|---|---|---|---|---|
| **(a) Disconnect** | T7 row `DISCONNECTED`, tokens deleted, webhook subscription cancelled | untouched | untouched | untouched | full |
| **(b) Stop and forget** | (a) + `Activity` rows for Strava marked `TOMBSTONED` | untouched (**D-020, §2 T3: cells are never removed**) | untouched | untouched (**§4.7: tombstoning keeps ledger rows**) | full — raw is still archived |
| **(c) Purge the raw archive** | (b) + delete `raw/<uid>/strava/**` | untouched | untouched | untouched | **degraded — see below** |

**The structural reason the map cannot re-fog:** `ExploredCell`'s key is
`U#<uid>#C#<parent>` / `<res10cell>`. There is no source attribute to filter on, no per-source
index, and no code path that deletes a cell — the only writes are `if_not_exists`, `max`, `min`
and `ADD` (§2 T6). **"Remove Strava's cells" is not an operation this schema can express.** The
table also carries `removalPolicy: RETAIN` and PITR precisely because it is the one loss that
would feel final.

**What level (c) actually costs, stated honestly:** it breaks §1.1's layering for the affected
activities. Raw is bedrock; `cells/<uid>/<activityId>.cells.bin` and the `Activity` row are
*derived* from it. Purge raw and those derived objects become bedrock for those years — still
sufficient to rebuild `ExploredCell` and every blob (§8.3 step 5 is exactly that fold), and still
sufficient for an XP replay of distance-based awards, but no longer sufficient to re-derive a
trace at a *different* `fogAlgoVersion` or a different H3 resolution. **Level (c) is therefore the
only retreat that should require a deliberate confirmation**, and the map survives all three.

### 7.5 What a migration must never do

A checklist, because these are the failures that are not recoverable:

- Delete an `ExploredCell` item. Under any circumstances. There is no legitimate reason.
- Delete an object under `raw/`. It is the system of record (D-101).
- Delete an `isFloor: true` ledger row (§4.6) — it is a fact about what was displayed, and D-135
  depends on it.
- Mutate a shipped `RuleSkill` partition (§3.8) or a shipped ruleset file.
- Change `activityId`, `dedupeKey` or `XpLedgerEntry.id` derivation without a full rebuild.
- Lower `SkillState.displayedXp` or `levelHighWater`. Ever (D-135, 04 §7.5).
- Let `defineData` replace a table as a side effect of a schema edit (§7.2 rule 4).

---

## 8. Retention, deletion, and the rebuild drill

**D-101:** user-supplied files are the system of record; everything else is reconstructible.
That is a claim, and a claim about recoverability that has never been executed is worth nothing.
§8.3 is the executable form of it, and it is the proof that D-121 is reversible.

### 8.1 What is kept forever, and what is not

| Data | Retention | Why |
|---|---|---|
| `raw/<uid>/<source>/<externalId>/<sha256>.<ext>` | **forever** | D-101/D-121.2. Bedrock. The only thing on this list that cannot be regenerated. |
| `rules/xp-rules-vN.yaml` (git + S3 mirror) | **forever** | 04 §7.6. A `v1` ledger row is meaningless without `v1`. |
| `traces/<activityId>.polyline.gz` | forever in practice, **purgeable** | derived from raw; kept because regenerating it costs a `normalize()` and it is served on every activity detail (S-7) |
| `cells/<uid>/<activityId>.cells.bin` | forever in practice, **purgeable** | derived; ~200–300 B each, ~1.5 MB at five years. It is the `CellVisit` fact stream in its chosen storage medium (§2.9) and step 5 of the drill folds it. |
| T6 `ExploredCell` | **forever, `RETAIN` + PITR** | D-020. Derived, but the one loss that would feel final. |
| T3 `Activity`, T4 `XpLedgerEntry`, T2 `SkillState` | forever | derived; tiny; PITR on |
| `explored-*.<gen>.bin`, `explored-agg.<gen>.json` | **keep current + 1 previous** | regenerable in <100 ms (§2.10). Older generations are garbage. |
| `deltas/<from>-<to>.bin` | **~20 generations** | `manifest.deltasFrom` tells the client when the chain no longer reaches it (§6.5) |
| T8 `IngestReceipt` | **TTL 90 days** | safe to expire: set semantics and the deterministic ledger `id` are the permanent backstops (§2 T8 layer 4) |
| T7 `SourceAccount` tokens | **until disconnect, then deleted** | not rebuildable **and must not be** (§1.1). Recovery is re-authorisation, by design. |
| `snapshots/skillstate/<uid>/<date>.json` | **forever** | §8.2 — the D-135 waterline. Small, and the one derived thing that is not re-derivable. |
| CloudWatch logs | 30 days | operational only |

**The purgeable column is theoretical.** Total five-year S3 footprint is ~1–2 GB, costing
~$0.05/month. **There is no storage pressure in this system and there never will be at six users
(D-014), so nothing should be purged for space.** The column exists so that a future reader knows
what is safe to delete under a *legal* obligation, not to invite housekeeping.

### 8.2 The one derived thing that is not re-derivable — and the snapshot it forces

D-135 says replay may never lower already-displayed XP. Enforcing that (§4.6) requires knowing
**what was displayed**, and that is a fact about history, not about running. It is not in the raw
archive. It exists only in `SkillState.displayedXp`/`levelHighWater` and the `isFloor` ledger rows.

**Consequence: a total DynamoDB loss would rebuild every number correctly from raw, and would
silently lose the monotonicity waterline.** If the current ruleset is more generous than every
past one, nothing is visible. If it is stricter, the rebuilt total is honestly lower than a number
the user was once shown — a D-135 violation arriving through the back door.

**Mitigation, and it is cheap:** a scheduled job writes
`snapshots/skillstate/<uid>/<YYYY-MM-DD>.json` — every skill's `displayedXp`, `level`,
`levelHighWater`, `rulesVersionLastComputed` — monthly and immediately before any replay or
rebuild. A few hundred bytes per user per month; ~30 KB over five years. **The drill's step 6 reads
the newest snapshot as its waterline.** With it, D-135 survives losing every table. Without it,
D-135 is only as durable as DynamoDB PITR's 35-day window.

This is recorded as an awkwardness rather than hidden: **D-135 is the one decision in this document
that forces a fact to be stored that is not derivable from the system of record.** It is a small
price and the decision is worth it, but the exception should be visible.

### 8.3 The rebuild drill

Rebuild the entire application state from `raw/` alone. Concrete, ordered, executable.

**Preconditions (verify all four before starting):**

1. `aws s3 ls s3://lost-soles-storage/raw/<uid>/ --recursive --summarize` returns a non-zero
   object count matching the last known figure (~2,000–5,000 at five years).
2. `rules/xp-rules-v*.yaml` present in git at the target commit.
3. The adapter code that can `normalize()` every `<source>` present in the raw prefix is
   deployed — **including adapters for sources no longer in use.** An adapter is deleted only
   when its raw objects are, which under §8.1 is never. *(This is the standing cost of D-100's
   boundary, and the reason it is worth paying.)*
4. The newest `snapshots/skillstate/<uid>/*.json` is downloaded (§8.2).

**Step 0 — snapshot, then decide the scope.** Write a fresh SkillState snapshot. Read
`manifest.json` and record `generation` and `cellCount` as the verification target. Rebuild into
**new, empty tables** (a parallel CDK stack) rather than truncating live ones; cut over by
pointing the app at them only after step 8 passes. Nothing destructive happens until then.

**Step 1 — enumerate the work.** `ListObjectsV2` under `raw/<uid>/`. **The key is
self-describing** — `raw/<uid>/<source>/<externalId>/<sha256>.<ext>` — so `(userId, source,
externalId)` come from the path with no index and no database. That is the entire reason the key
has that shape, and it is why the drill needs nothing but the bucket.

**Step 2 — normalize, in parallel, order-independent.** For each object: reconstruct the
`IngestJob` from the key, `GetObject` the bytes, verify the `sha256` in the key against the
content, then call `registry.get(source).normalize(raw, ref, job)` — **pure, no network, no clock**
(contract §3). Emit `{activity, trace}`. A `normalize()` failure is logged with the key and does
not stop the run; the count of failures is a step-8 assertion. ~2,000–5,000 invocations at ~20 ms
is **under two minutes** and embarrassingly parallel.

**Step 3 — sort.** By `activity.startedAt` ascending, ties broken by `activityId` (04 §7.4).
**Everything after this point is order-dependent and must run single-threaded per user.**

**Step 4 — persist facts and per-activity derivations.** In sorted order, for each activity:
`PutItem` the `Activity` row (T3); write `traces/<activityId>.polyline.gz`; sanitise the trace and
project to H3 res 10 (D-115, 05 §2.2) at the **current** `fogAlgoVersion`; write
`cells/<uid>/<activityId>.cells.bin`. **No XP and no `ExploredCell` writes yet.**

**Step 5 — the fold. This is the heart of the drill** (and the operation §2.9 promised).
Walk the activities in the same sorted order, maintaining an in-memory map
`cellId → {firstRunAt, firstRunId, lastRunAt, lastRunId, visitCount, discoveryCount}`:

```
for activity in sorted:
    cells = read cells/<uid>/<activity.id>.cells.bin
    for c in cells:
        prev = map.get(c)
        if prev is None:
            credit = 1.0                                   # never seen
            map.set(c, {firstRunAt: activity.startedAt, firstRunId: activity.id,
                        lastRunAt: activity.startedAt,  lastRunId: activity.id,
                        visitCount: 1, discoveryCount: 1})
        else:
            age    = activity.startedAt - prev.lastRunAt
            credit = 0.5 if age > SIX_MONTHS else 0.0       # D-120
            prev.firstRunAt = min(prev.firstRunAt, activity.startedAt)
            prev.lastRunAt  = max(prev.lastRunAt,  activity.startedAt)   # monotonic here by sort
            prev.lastRunId  = activity.id
            prev.visitCount += 1
            if credit > 0: prev.discoveryCount += 1
    record per-activity {newCellCount, rearmedCellCount, cooledCellCount}   # feeds step 6
```

Then bulk-write the map to T6 (`BatchWriteItem`, 25/request, ~20k–150k items ≈ 1–6 minutes) with
`lastRunDay` computed as u16 days since 2020-01-01, and derive the `AGG#{6,7,8}` items by counting
children per parent. **This fold reproduces every `ExploredCell` attribute exactly, from facts, in
history order — which is what makes the table honestly a cache** (§2.9) and what makes D-120
recomputable in the sense 04 §7.2 required.

**Step 6 — replay XP.** Run §4.4 steps 3, 5 and 6 against the rebuilt facts at the target
`xpRulesVersion`, using **the step-0/precondition-4 snapshot as the D-135 waterline** rather than
a live `SkillState` read (there is none — the tables are new). Ground classification comes from
step 5's per-activity counts, not from T6, which is the same discipline §4.4 step 3b imposes.
Write `SkillState`, `Profile.totalXp`/`totalLevel`, and any `retained_floor` rows the waterline
requires (§4.6).

**Step 7 — regenerate the delivery layer.** Encode `explored-r10.bin`, `explored-agg.json` and
`explored-lastrun-r10.bin` from the step-5 map; PUT them; PUT `manifest.json` last (§6.4).
**Set `generation = <the step-0 generation> + 1`, never 1.** A generation that goes backwards
would leave every cached client convinced it is already up to date, and the fog is the one thing
that must never appear to regress.

**Step 8 — verify before cutting over.** All six must pass:

| # | Assertion | Failure means |
|---|---|---|
| 1 | `normalize()` failures == 0 | an adapter regression, or a corrupt raw object — investigate the specific key |
| 2 | rebuilt activity count == raw object count − known `dedupeKey` collisions | lost or duplicated history |
| 3 | rebuilt `cellCount` **== step-0 `cellCount`** when `fogAlgoVersion` is unchanged; **≥** it if the algorithm changed | a cell was lost — **stop; do not cut over** (D-020) |
| 4 | every skill's rebuilt `displayedXp` ≥ the snapshot's | a D-135 violation; step 6's floors did not apply |
| 5 | `SUM(XpLedgerEntry.xpAwarded)` per skill == `SkillState.xpLedgerSum` | the §4.1 invariant is broken |
| 6 | a spot-check activity's XP itemisation (AP-7) matches its pre-drill values under the same rules version | a scoring regression |

**Step 9 — reconnect sources.** T7 is **not** rebuilt: OAuth tokens are not derivable and must not
be (§1.1). Re-authorise each adapter, then set `listSinceWatermark` to **the drill's start time
minus 7 days** so the mandatory reconciliation sweep (contract §3) picks up anything that landed
during the rebuild. Re-ingesting an activity already rebuilt is a `dedupeKey` no-op (AP-10).
T8 is not rebuilt either — it is 90-day ephemera, and an empty receipt table is a correct
starting state.

**Budget:** ~2 min normalize + ~1–6 min of `BatchWriteItem` + seconds of XP replay + <1 s of blob
encoding. **Call it under 30 minutes wall-clock including verification**, and roughly $0.50 of
request charges, once. At six users this is not an operation that needs to be clever.

### 8.4 Running the drill before it is needed

04 §7.6's rule for the replay job applies with more force here: **a recovery path that has never
been executed is not a recovery path.**

- **In CI, every build:** the drill runs end to end against a checked-in fixture of ~20 raw
  objects spanning every `SourceId` in use, asserting steps 8.1–8.6. It is the same code path,
  at 1/200th the volume, and it is what stops an adapter change silently breaking recovery.
- **Once before MVP ship, for real,** against the live raw archive, into a parallel stack, with the
  cutover *not* performed. That is the run that turns D-101 from a claim into a measurement.
- **Again immediately before any D-121 migration.** The whole argument for D-121's acceptability is
  reversibility; verify it while there is no pressure.
- **The `fogAlgoVersion` bump path is the drill at steps 4, 5 and 7 only** — no `normalize()`, no
  XP replay. Exercising the full drill exercises that too.

### 8.5 Account deletion

D-014 permits up to ~6 users; D-123 declines special home-location handling **for the
single-owner case only**, with an explicit revisit trigger if friends or sharing arrive. Deletion
must therefore work per user, cleanly, today:

1. Revoke and delete the T7 rows (tokens first — stop the inflow before deleting the outflow).
2. Delete every item under `pk` prefix `U#<uid>#` in T6, every T2/T4 row for the user, the T3 rows
   via GSI1, and the T1 row.
3. Delete `s3://lost-soles-storage/**/<uid>/**` — `raw/`, `traces/`, `cells/`, `explored/`,
   `deltas/`, `snapshots/`.
4. Delete the Cognito user.

**This is the one operation permitted to delete `ExploredCell` items and `raw/` objects**, and it
is exempt from §7.5 because it is the user's own instruction about their own data. It is also
irreversible in the strongest sense in this system: after step 3 there is no rebuild, because
bedrock is gone. **It must be gated behind an explicit typed confirmation, and it must never be a
side effect of disconnecting a source** — §7.4's level (a) and this operation are separated by the
entire document.

---

## 9. Invariants an implementer must not violate

Everything above argues for a design. This section states the **properties that design exists to
guarantee**, consolidated in one place so they can be read without reading the document, and
written so each one can become a test, a `ConditionExpression`, an IAM boundary or a CI assertion.

Three rules govern the list:

1. **An invariant with no check is a wish.** Every row names its enforcement mechanism. Where the
   mechanism is *structural* — a deterministic key, a conditional write, a missing IAM grant, a
   model that does not exist in the AppSync schema — that is stronger than a test, and is marked
   **[S]**. Tests can be deleted; a mutation that was never generated cannot be called.
2. **Violations are stop-the-line.** None of these is a warning threshold. A failed assertion in
   the rebuild drill (§8.3 step 8) aborts the cutover; a failed CI check fails the build.
3. **They are numbered `I-n` so tickets, tests and code comments can cite them.**

### 9.1 Layering and reconstructibility

| # | Invariant | Why it matters | How it is checked |
|---|---|---|---|
| **I-1** | Every store except `raw/`, `rules/` and the two fact files is **rebuildable from them**, with no other input (D-101). | It is the entire disaster-recovery story and the entire D-121 exit story. If it silently stops being true, nobody finds out until the day it is needed. | The rebuild drill runs **end to end in CI on every build** against a ~20-object fixture (§8.4), asserting §8.3 step 8's six checks. Real-archive run once before MVP ship and before any D-121 migration. |
| **I-2** | The set of non-reconstructible data is **exactly three items and is closed**: the displayed-XP waterline (`snapshots/skillstate/` + `facts/<uid>/highwater.jsonl`, D-143), `facts/<uid>/identity.json`, and `SourceAccount` tokens. | D-143 permits *one* documented exception to D-101. Each further exception is a piece of the system that can no longer be rebuilt, and they accumulate silently. | CI check: the drill fixture is rebuilt from `raw/` + `rules/` + those three inputs **and nothing else** — the drill harness denies reads outside that set, so a fourth dependency fails the build rather than passing quietly. |
| **I-3** | `raw/` objects are **immutable and undeletable**; the only operation permitted to remove one is account deletion (§8.5). | Bedrock. Once a raw object is gone, no rebuild can reproduce the activity it encoded. | **[S]** Bucket policy denies `s3:DeleteObject`/overwrite on the `raw/` prefix for every principal but the deletion role; S3 Versioning is on. Not a convention — a policy. |
| **I-4** | `adapter.normalize()` is **pure**: no clock, no network, no RNG. Same bytes in ⇒ same `Activity` out, byte-for-byte, forever. | It is the migration seam (contract §3). An impure `normalize()` makes rebuilds non-reproducible, which makes I-1 unverifiable. | CI: `normalize()` is invoked with `Date.now`, `Math.random` and the network stubbed to **throw** (contract §5). Plus a golden-file test over the fixture archive. |
| **I-5** | `activityId = sha256(userId:source:externalId)` — **deterministic, never a ULID**. | It is what makes replay and webhook redelivery idempotent for free (D-140, contract conflict #6). A random id would award XP twice on every redelivery. | **[S]** The id is computed, not generated; a duplicate `PutItem` is a no-op on the same key. Unit test asserts stability across processes. |
| **I-6** | A shipped `rulesVersion` partition in T5 is **never mutated or deleted** (04 §7.6). | Every `XpLedgerEntry` cites a `xpRulesVersion`. Mutating `v1`'s rows retroactively rewrites what the user was told they earned, and makes the ledger unauditable. | Seeder is append-across-versions only, and refuses to write into an existing partition (§3.8). CI asserts a re-run of the seeder against an unchanged YAML produces zero writes. |

### 9.2 The fog — D-020, D-120, D-144

| # | Invariant | Why it matters | How it is checked |
|---|---|---|---|
| **I-7** | **Cells never re-fog.** No code path deletes an `ExploredCell` item or unsets a cell in a blob, at any level of retreat (D-020, §7.4). Account deletion is the sole exception. | This is the one failure that would feel final to the user, and the one promise the product makes about the past. Tombstoning an activity, disconnecting a source, and migrating off Strava all leave the map untouched. | **[S]** T6 is `removalPolicy: RETAIN` with PITR; no Lambda role holds `dynamodb:DeleteItem` on T6 except the deletion role. CI: a tombstone/retract/disconnect fixture asserts cell count is unchanged. Drill step 8 check 3 asserts rebuilt `cellCount` **==** the pre-drill count (**≥** if `fogAlgoVersion` changed) and **aborts the cutover** otherwise. |
| **I-8** | `firstRunAt` is written with **`min`** semantics, `lastRunAt` with **`max`** — never a plain `SET`, never a read-modify-write. | Backfills and bulk imports arrive out of chronological order. A plain `SET` lets a 2024 import stomp a 2026 `lastRunAt`, which silently corrupts every future D-120 discovery decision on that cell. | **[S]** The `UpdateItem` carries `ConditionExpression: attribute_not_exists(lastRunAt) OR lastRunAt < :now`, with a second `firstRunAt > :now` write on the fallback path (T6). CI: an out-of-order fixture (2026 run ingested, then a 2024 backfill) asserts `firstRunAt` = 2024 and `lastRunAt` = 2026. |
| **I-9** | `lastRunAt` is a **timestamp, never a presence bit**, and discovery credit is a function of `activity.startedAt − lastRunAt`. | D-120's whole re-arm mechanic (6-month cooldown, 50% credit) is unimplementable from a boolean, and the loss is not recoverable after the fact. | Type-level: the attribute is `S`/ISO-8601. CI: three-run fixture (new / re-run within 6 months / re-run after 6 months) asserts credit 1.0 / 0.0 / 0.5. |
| **I-10** | Cell writes are **outside** the ingest transaction, and the only permitted skew is **"map ahead of XP" — never the reverse** (D-144). | 40–130 cells per run exceeds `TransactWriteItems`' 100-item cap, so atomicity across both is not available. Given a forced choice, revealed-but-unscored ground self-heals on replay; scored-but-unrevealed ground contradicts D-020 and cannot be repaired without re-fogging. | Ordering is fixed in code (cells first, then the XP transaction) and asserted by a fault-injection test that kills the Lambda between the two writes and checks the recovery path awards the XP without touching cells. |
| **I-11** | `manifest.generation` is **monotonic per user** — it never decreases and never restarts at 1, including after a full rebuild (§8.3 step 7). | A generation that goes backwards leaves every cached client convinced it is already current, so the fog appears to regress on exactly the devices that were working correctly. | **[S]** Conditional update on the counter. Drill step 7 sets `generation = pre-drill generation + 1`; drill verification asserts it. Client asserts `delta.fromGen === state.generation` before applying (§6.5). |

### 9.3 Time

| # | Invariant | Why it matters | How it is checked |
|---|---|---|---|
| **I-12** | **All scoring reads `activity.startedAt`. Nothing in the scorer calls `now()`.** `awardedAt` and `ingestedAt` are audit fields and are never inputs. | A backfilled run must score identically today and in five years. Any `now()` in the scoring path makes replay non-reproducible and breaks I-1 and I-14 together. | CI: the scorer is executed with the clock stubbed to throw (same discipline as I-4). Golden-file replay test: the fixture archive replayed twice, weeks apart in simulated time, produces byte-identical ledgers. |
| **I-13** | **Game-day bucketing uses `startedAtLocal`** (naive wall clock), never UTC, never a stored offset. | An 11pm run must belong to the day the user ran it, and an offset is not a timezone (DST) — D-140, contract conflict #3. | CI: fixtures spanning a DST boundary and a UTC-midnight-crossing local evening assert the expected `userIdLocalDay`. |
| **I-14** | Replay order is **ascending `startedAt`, ties broken by `activityId`**, and the fold is **single-threaded per user** (04 §7.4, §8.3 step 3). | D-120 credit is order-dependent: the same activities folded in a different order produce different discovery counts and therefore different Cartography XP. | CI: the fixture replayed with the input list shuffled produces an identical ledger and identical cell attributes. Concurrency is structural — one replay worker per user. |

### 9.4 XP — D-135, D-142

| # | Invariant | Why it matters | How it is checked |
|---|---|---|---|
| **I-15** | For every `(userId, skillId)`: **`SkillState.displayedXp == SUM(XpLedgerEntry.xpAwarded)`**, with no exceptions and no adjustment terms. | It is the single equation that makes XP auditable. The moment a displayed number can differ from the ledger, "why do I have this XP" has no answer and every downstream total is suspect. | Drill step 8 check 5. A standing consistency job recomputes the sum per skill and alerts on any mismatch. Also the reason `xpLedgerSum` and `displayedXp` are stored as **two** attributes (T2): a bug in one is detectable against the other. |
| **I-16** | **Displayed XP never decreases** (D-135), and monotonicity is enforced **inside the ledger** by appending a deterministic `retained_floor` row — **never by clamping a computed value** (D-142). | Clamping hides the discrepancy and compounds it across successive rebalances; a floor row keeps I-15 true, makes the retention auditable, and makes a re-run of the same replay idempotent rather than additive. | Drill step 8 check 4: every skill's rebuilt `displayedXp` **≥** the snapshot's. CI: apply a deliberately stingier ruleset to the fixture and assert (a) no skill's total fell, (b) the shortfall appears as `retained_floor` rows, (c) replaying twice produces the same floor rows, not doubled ones. |
| **I-17** | **`levelHighWater` ratchets** and is a *second, independent* ratchet from the XP floor (D-142). | The XP floor covers rate changes; it does not cover curve changes, which can lower a level at unchanged XP. Levels are memories (04 §7.5) — the user's level must not fall because the curve was edited. | CI: a fixture that changes only `stepFormula` asserts XP is untouched and displayed level never falls. Unit test on the ratchet: `levelHighWater = max(levelHighWater, computedLevel)`. |
| **I-18** | The ledger is **append-only**: a replay deletes only `isFloor: false` rows; `isFloor: true` rows are never deleted, and no client-facing mutation can write, update or delete any row. | Floor rows record what the user was *shown* — the one thing not derivable from raw (D-143). Deleting one destroys the waterline that I-16 depends on. | **[S]** The AppSync schema exposes no `update`/`delete` for T4 and `allow.owner().to(['read'])` for read; replay deletes via IAM with a filter on `isFloor = false`. CI asserts the generated schema contains no T4 mutation. |
| **I-19** | Every ledger row carries a **non-null `xpRulesVersion`**, and `xpAwarded` is an **integer rounded exactly once, at write time**. | A row without its rule version is unattributable and unreplayable. Rounding at read time lets two screens summing in different orders disagree about the same total. | **[S]** `xpRulesVersion` is part of the row's deterministic `id`, so a row cannot exist without it. CI: a property test asserts `Number.isInteger(xpAwarded)` for every row the scorer emits, and that summing a ledger in random order is invariant. |
| **I-20** | **The client can never write XP, cells, or activities** (except through the `logWorkout` mutation, which runs the same server-side pipeline). | It is the trust boundary. XP the client can write is XP that means nothing. | **[S]** No AppSync mutation exists for T2/T4; T3 is `to(['read'])` for every pipeline-owned field; T6/T7/T8 have no AppSync model at all. CI asserts the generated schema against an allowlist of mutations. |

### 9.5 Idempotency and dedupe

| # | Invariant | Why it matters | How it is checked |
|---|---|---|---|
| **I-21** | **Re-ingesting an activity awards nothing further.** Processing the same activity N times produces the same XP, the same ledger rows and the same cells as processing it once. | Webhook redelivery is routine, not exceptional, and a double award is both wrong and — under D-135 — permanent, because the inflated number becomes a floor. | Four independent layers (T8): accept gate, score gate, the transactional commit, and set semantics + the deterministic ledger `id`. **Two of the four are structural and survive the receipt table expiring.** CI: the fixture is ingested 5× (including concurrently) and asserts identical totals; a chaos test replays a webhook after TTL expiry. |
| **I-22** | **At most one `ACTIVE` `Activity` per `(userId, dedupeKey)`**, across *all* sources — the same run arriving via Strava and Health Connect is one activity, not two. | Cross-source duplication is the failure mode that silently doubles XP and doubles cell visit counts, and it is invisible in any single adapter's view. | GSI2 `byUserAndDedupe` is queried at pipeline step 3 (contract §3) before any write. CI: a fixture supplies the same run through two adapters with differing `externalId`s and asserts one activity, one award. Drill step 8 check 2 reconciles rebuilt activity count against raw object count minus known `dedupeKey` collisions. |
| **I-23** | Expiry of an `IngestReceipt` (90-day TTL) can **never** cause a double award. | The receipt table is deliberately disposable; if correctness depended on it, the TTL would be a scheduled bug. | **[S]** Layer 4 is permanent and independent of T8: `delta = newCells \ exploredSet` is empty on a replay, and the ledger `id` is deterministic so a duplicate put is a `ConditionalCheckFailed`. Covered by the I-21 post-TTL chaos test. |

### 9.6 Skills are data — D-031, D-132, D-141

| # | Invariant | Why it matters | How it is checked |
|---|---|---|---|
| **I-24** | **Adding a workout type touches zero lines of code.** A new skill is one YAML row plus one seeded T5 item; the TypeScript diff is empty. | D-031 makes this a product decision, not an aspiration. It is also the property most likely to rot quietly, one convenient `if` at a time. | **The D-132 regression test, wired into CI permanently** (§3.8 check 5): seed v1, add *only* the Vigil row, assert (a) empty TS diff, (b) a `hasTrace: false` run scores into `vigil` at full rate, (c) the same run with a trace scores into `wayfaring`, (d) neither writes an `ExploredCell` for the traceless case. |
| **I-25** | **No skill id appears anywhere in `src/`** — no enum, no union type, no `switch` on skill id. Skill ids are opaque strings everywhere they are stored (T2, T4). | The moment one skill name is legible to the compiler, the next one is cheaper to add in code than in data, and D-031 is over. | §3.8 check 6: `grep -rE '"(wayfaring\|vigil\|might\|fortitude\|endurance\|cartography\|constitution)"' src/` must return nothing outside `rules/`, fixtures and tests. Fails the build. |
| **I-26** | The matcher is **total and deterministic**: for every `ActivityKind` × `hasTrace` combination it returns **exactly one** enabled skill per `measure` — never zero for measurable work, never two at equal `matchPriority`. | Zero matches silently drops a workout; two matches double-awards it. Non-determinism breaks I-12 and I-14 and therefore I-1. Both must fail at **seed time**, not at 6am on a Sunday run. | §3.8 checks 3 and 4: the totality fixture sweeps the full `ActivityKind` × `hasTrace` grid; the matcher is additionally called with clock and RNG stubbed to throw. Ambiguity is a **seed-time hard error** — the deploy fails, not the run. |
| **I-27** | **"Zero discovery credit / no map reveal" is expressed by no field at all.** `hasTrace: false` ⇒ `traceRef: null` ⇒ no trace ⇒ no cells ⇒ no `ExploredCell` write ⇒ no generation bump ⇒ no Cartography award. | A `grantsDiscovery: false` flag would be a second statement of a fact the pipeline already implies — and a place for the two to disagree. Deriving it means the property cannot be misconfigured. | I-24's test clause (d). Asserted structurally: the fog stage's input is the trace, and there is no trace. `cellCount: 0` is still written so the row shape never varies. |

### 9.7 Boundaries and secrets

| # | Invariant | Why it matters | How it is checked |
|---|---|---|---|
| **I-28** | **OAuth tokens are unreachable from AppSync at any auth level, and are never projected into any index.** | No auth rule is as safe as no reachability. A compromised webhook Lambda with a valid IAM grant must still be unable to read a credential. | **[S]** T7 is a CDK table with no AppSync model at all; `byExternalOwner` is `KEYS_ONLY`, so the token attributes are not present in the index the webhook can query (T7, resolved conflict). CI asserts the generated schema mentions no token field and that the webhook role's policy names only the index ARN. |
| **I-29** | The client receives **no cell rows, no OAuth tokens, no ingest receipts** — ever. | Three tables that simply do not exist in the client's world is a stronger guarantee than three auth rules that could be edited. | **[S]** T6/T7/T8 have no `defineData` model (§1.3, 01 §2). Same generated-schema assertion as I-20/I-28. |
| **I-30** | A migration or rebalance **never deletes user data to make a number consistent** (§7.5). Corrections add; they do not erase. | Every irreversible operation in this system is irreversible in the same direction. Account deletion (§8.5) is the only exception, it is the user's own instruction, and it must never be a side effect of disconnecting a source. | Code review gate plus the drill: any procedure whose rollback plan is "restore from PITR" does not ship. Deletion is gated behind an explicit typed confirmation. |

### 9.8 Where each invariant is enforced

| Mechanism | Invariants | Note |
|---|---|---|
| **Structural [S]** — a key shape, a conditional write, a missing IAM grant, a model that does not exist | I-3, I-5, I-7, I-8, I-11, I-18, I-19, I-20, I-23, I-28, I-29 | Cannot be deleted by a future commit without the deletion being obvious in a diff of the infrastructure. **Prefer moving invariants into this row.** |
| **CI, every build** | I-1, I-2, I-4, I-6, I-9, I-10, I-12, I-13, I-14, I-16, I-17, I-21, I-22, I-24, I-25, I-26 | Includes the full rebuild drill at fixture scale (§8.4) and the permanent D-132 regression test (§3.8 check 5). |
| **Seed time (deploy fails)** | I-6, I-26 | A skill registry that cannot select is never allowed to reach production. |
| **Rebuild drill, step 8** | I-1, I-7, I-15, I-16, I-22 | Six assertions, all of which must pass **before** cutover. |
| **Standing consistency job** | I-15 | The one invariant worth re-checking against live data on a schedule; it is cheap (AP-17 is off the hot path) and it is the equation everything else is read through. |

**If a change makes one of these harder to state, that is the signal to stop.** Every one of them
is here because some other part of the design leans on it: the fog leans on I-7 through I-11, the
XP display leans on I-15 through I-19, and D-101 — the reason this system can be rebuilt from a
bucket of files at all — leans on every row in §9.1.
