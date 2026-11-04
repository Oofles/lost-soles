import { a, defineData, type ClientSchema } from "@aws-amplify/backend"

/**
 * The AppSync-backed half of the data model. `02-data-model.md` §2.1: six `defineData`
 * models (one physical table each, which is how Gen 2 works) plus five raw CDK
 * `dynamodb.Table` constructs for the machine-only tables in `../backend.ts` (D-456, D-465).
 *
 * WHY `defineData` STAYS AT ALL (D-472, `0334`). It owns the six model tables, and deleting it
 * would delete them, with the activity and ledger history no rebuild reproduces without a drill.
 * AppSync is no longer a client-facing API: the browser talks only to its own origin, and the SSR
 * compute reads these tables directly with `dynamodb:Query` (`../backend.ts`).
 *
 * IAM-ONLY, AND NO CALLER. `defaultAuthorizationMode: "iam"` with no `defineAuth` makes `AWS_IAM`
 * the API's one auth mode (Gen 2 always adds IAM; `@aws-amplify/backend-data`'s
 * `convert_authorization_modes.js`). Every model carries the one rule described above `schema`,
 * because Gen 2 refuses a model with no rule at all, and NO PRINCIPAL IS GRANTED `appsync:GraphQL`,
 * so the API answers nobody. `scripts/check-auth-posture.mjs` asserts the deployed modes are
 * exactly `AWS_IAM`.
 *
 * The two custom mutations (`logWorkout`, `setActivityKind`) are gone: since `0331` the browser
 * reaches their Lambdas through `POST /api/log` and `POST /api/runs/[activityId]/kind`, and the
 * SSR compute role is the only invoker. The Lambdas keep `resourceGroupName: "data"` so they stay
 * in this stack rather than being recreated in another.
 *
 * `DeploySmokeTest` was 0012's placeholder — `defineData` refuses an empty schema and
 * something had to stand in. T3 replaces it as the first real model; the placeholder
 * stays only until a second real model lands, because deleting it now would be a
 * separate breaking change to an API this ticket has no business touching.
 */

/**
 * `SourceRef`, stored as a DynamoDB map (T3). Transcribed from the contract
 * (`src/domain/activity.ts`), which wins wherever anything else disagrees (D-140).
 *
 * `externalId` is a STRING even where the vendor's is an integer — Strava ids overflow
 * 2^53 and `JSON.parse` corrupts them silently (contract §2, §2.7).
 */
const sourceRef = a.customType({
  source: a.string().required(),
  externalId: a.string().required(),
  /** The vendor's own type string, verbatim. NEVER branched on outside the adapter. */
  sourceTypeRaw: a.string().required(),
  fetchedAt: a.datetime().required(),
  /** Adapter-private. `a.json()` because its shape is the adapter's business, not ours. */
  meta: a.json(),
})

/** `RawArchiveRef` (T3) — where the system of record for this activity lives (D-101). */
const rawArchiveRef = a.customType({
  bucket: a.string().required(),
  key: a.string().required(),
  contentType: a.string().required(),
  bytes: a.integer().required(),
  sha256: a.string().required(),
  archivedAt: a.datetime().required(),
})

/** D-062: carried from day one even though the MVP UI logs one number. */
const workoutSet = a.customType({
  exercise: a.string().required(),
  reps: a.integer(),
  durationS: a.integer(),
  /** `0240`, D-286. A hand-logged distance (treadmill / track), whole metres. */
  distanceM: a.integer(),
  weightKg: a.float(),
})

/**
 * 05 §3.6 — makes a silently-garbage GPS record visible instead of merely absent. Ticket
 * `0180`, and the shape moved from `02` T3's original `{speedGate, accuracy, duplicate}`
 * (D-222).
 *
 * These are the FOG PROJECTION's own per-sample drops (§2.2 step 1), plus `segments`, which is
 * not a drop count and is here anyway: the teleport gate SPLITS rather than drops (D-212), so
 * "samples rejected by the speed gate" does not exist in this layer — a trace that arrives as
 * one recording and leaves as eleven segments is the diagnostic instead.
 *
 * `speedGate` is gone for that reason, and because the per-sample count that genuinely exists
 * is the adapter sanitizer's and already reaches this row inside `source.meta`. Two copies of
 * one number is the duplication D-193 names.
 */
const traceRejectCounts = a.customType({
  accuracy: a.integer().required(),
  duplicate: a.integer().required(),
  nonFinite: a.integer().required(),
  segments: a.integer().required(),
})

/**
 * `0243`, D-284. The T3 mirror of an operator's kind correction. The FACT is the immutable object
 * under `raw/` that `key` names; this copy exists so the single-run page reads one row.
 */
const kindOverride = a.customType({
  kind: a.string().required(),
  derivedKind: a.string().required(),
  setBy: a.string().required(),
  setAt: a.datetime().required(),
  key: a.string().required(),
})

/**
 * THE ONE RULE EVERY MODEL CARRIES (D-472). `allow.authenticated("identityPool")` is the minimal
 * IAM-provider rule Gen 2 accepts on a model (`{allow: private, provider: iam}`). With no identity
 * pool in this app there is no authenticated role it could admit, and no IAM principal holds
 * `appsync:GraphQL` on the API, so it admits nobody. Read-only, so even a future grant could not
 * write a table the pipeline owns (I-20). Inlined on each model rather than shared, so Gen 2's
 * `ClientSchema` inference sees the literal rule. `amplify/data-iam-only.test.ts` pins it.
 */

const schema = a.schema({
  SourceRef: sourceRef,
  KindOverride: kindOverride,
  RawArchiveRef: rawArchiveRef,
  WorkoutSet: workoutSet,
  TraceRejectCounts: traceRejectCounts,

  /**
   * T3 `Activity`. The contract's `Activity` stored flat, with the nested `SourceRef`
   * and `RawArchiveRef` as maps and the game-layer additions below the line.
   */
  Activity: a
    .model({
      /**
       * `sha256(userId:source:externalId)` — NEVER a ULID (I-5). Deterministic, so
       * re-ingest overwrites rather than duplicating. A source that retries three
       * times and then drops would otherwise leave three copies of one run,
       * permanently, on a map that cannot re-fog (D-020).
       */
      id: a.id().required(),

      userId: a.string().required(),
      /** PHYSICAL FACT, never a skill (conflict #7). run|walk|hike|ride|strength|other. */
      kind: a.string().required(),
      /**
       * `0243`, D-284. `kind` is the EFFECTIVE kind; this is what `normalize()` derived from the
       * source's type string. Equal to `kind` on an uncorrected row. Optional only because rows
       * written before `0243` lack it — read it as `derivedKind ?? kind`.
       */
      derivedKind: a.string(),
      /** `0243`. Who corrected `kind`, when, and from which `raw/` fact. Null when nobody did. */
      kindOverride: a.ref("KindOverride"),

      /** ISO 8601 with a real Z. ALL scoring uses this, never ingest time (05 §3.1). */
      startedAt: a.datetime().required(),
      /**
       * Naive wall clock, NO offset — `a.string()` and deliberately not `a.datetime()`,
       * which would demand a timezone and defeat the entire point (conflict #3, I-13).
       * ALL game-day bucketing reads this.
       */
      startedAtLocal: a.string().required(),
      /** Bare IANA id or null. Never a "(GMT-07:00) " prefixed string. */
      timezone: a.string(),
      /**
       * `<userId>#<YYYY-MM-DD from startedAtLocal>`. DERIVED, and it exists for exactly
       * one reason: so "did I work out today" is one query rather than a scan.
       */
      userIdLocalDay: a.string().required(),

      elapsedS: a.integer().required(),
      movingS: a.integer(),
      distanceM: a.float(),
      elevationGainM: a.float(),
      /** Free text from the source. Display only — nothing branches on it. */
      name: a.string(),

      source: a.ref("SourceRef").required(),
      /**
       * T3: the contract permits null for `manual`, but **we never emit null** — the
       * manual adapter synthesises and archives a JSON document like every other
       * source, because D-101 has no exception for hand-typed pushups.
       */
      raw: a.ref("RawArchiveRef").required(),
      /** NULL IS A NORMAL OUTCOME: treadmill, manual, strength. Not an error. */
      traceRef: a.string(),
      /** What the skill matcher reads (§3.4). */
      hasTrace: a.boolean().required(),

      sets: a.ref("WorkoutSet").array(),

      /** Cross-source natural key — the same run via two sources is one activity. */
      dedupeKey: a.string().required(),
      ingestedAt: a.datetime().required(),
      /** Bumped on re-ingest of a source-side edit. The id never changes. */
      revision: a.integer().required(),

      /* ── game layer below this line (T3) ──────────────────────────────────── */

      /** Pinned at scoring time (04 §7.6). What the user actually SAW. */
      xpRulesVersion: a.integer(),
      /** 05 §3.5. Part of the score-time idempotency key. */
      fogAlgoVersion: a.integer(),
      /** Denormalised for the activity list; the ledger (T4) is authoritative. */
      xpAwarded: a.integer(),
      /**
       * 05 §8.2. WRITTEN EVEN WHEN ZERO (a treadmill run) so the row shape never
       * varies — §7.2 leans on that: a reader must not have to know which era wrote a row.
       */
      cellCount: a.integer(),
      newCellCount: a.integer(),
      rearmedCellCount: a.integer(),
      cooledCellCount: a.integer(),
      /**
       * `0050`, 05 §3.4 / D-221. Cells whose verdict could not be decided incrementally
       * because this activity is EARLIER than their `lastRunAt`. A non-zero value means the
       * award is PROVISIONAL until a replay folds the history.
       *
       * **Added here by `0180`, one ticket late.** `0050` wrote it in `persist.ts` and did not
       * declare it — DynamoDB is schemaless so the attribute landed, but AppSync would not
       * return a field it does not know about, so the column was unreadable by anything that
       * would ever want it.
       */
      deferredCellCount: a.integer(),
      /** `users/<uid>/cells/<id>.bin` — the per-activity set, needed for un-award (05 §3.5). */
      cellsRef: a.string(),
      /**
       * ACTIVE | TOMBSTONED. A source-side delete sets TOMBSTONED; **cells are never
       * removed** (D-020, I-7). Ground that was genuinely run stays run.
       */
      status: a.string().required(),
      traceRejectCounts: a.ref("TraceRejectCounts"),
    })
    /** T3: `PK id = <activityId>`. Stated explicitly rather than relying on the default. */
    .identifier(["id"])
    .secondaryIndexes((index) => [
      /**
       * GSI1 `byUserAndStart`, projection ALL — the activity list and every
       * date-range read (AP-3, AP-4). It is the one index whose consumers want the
       * whole row, so projecting less would just force a second read per item.
       */
      index("userId").sortKeys(["startedAt"]).name("byUserAndStart").projection("ALL"),
      /**
       * GSI2 `byUserAndDedupe`, KEYS_ONLY — and the projection is the decision, not an
       * optimisation. The dedupe check asks only "does an activity with this key
       * already exist, and what is its id". Projecting the whole item would double the
       * write cost of a table written on every single ingest (T3, stated).
       */
      index("userId")
        .sortKeys(["dedupeKey"])
        .name("byUserAndDedupe")
        .projection("KEYS_ONLY"),
      /**
       * GSI3 `byUserAndDay`, INCLUDE — "did I work out today", and the three fields the
       * answer needs to render. Anything more and this becomes a second copy of the
       * table for a question that fits in one row.
       */
      index("userIdLocalDay")
        .sortKeys(["startedAtLocal"])
        .name("byUserAndDay")
        .projection("INCLUDE", ["kind", "distanceM", "xpAwarded"]),
    ])
    /**
     * NO CLIENT REACHES THIS MODEL (D-472). Every field is written by the pipeline, which runs
     * server-side under an IAM role and does not go through AppSync at all; a client that could
     * `createActivity` could mint XP by inventing a run (01 §4 step 14). Until `0334` the owner
     * had `read`; now nobody does, and the run views read T3 through the SSR compute.
     */
    .authorization((allow) => [allow.authenticated("identityPool").to(["read"])]),

  /**
   * T1 `Profile`. Ticket 0066, `02-data-model.md` T1. One row per user, `id` = the Cognito sub.
   *
   * Built by the XP replay because it is the first thing that needs to WRITE here: step 1's
   * `replayInProgress` flag and step 6's `totalXp`/`totalLevel` (§4.4). The rest of T1's
   * attributes are declared now so capabilities 08 and 13 inherit the schema `02` chose rather
   * than growing it one column per ticket.
   *
   * ─── NO CLIENT WRITES IT (D-472; D-258's field rules went with the owner rule) ───
   *
   * Until `0334` the owner could edit the preferences through AppSync and only READ the
   * pipeline-owned attributes, narrowed at the field (D-258). With AppSync answering no caller
   * there is no client write path left to narrow. The XP trust boundary (`01` §5, I-20) now
   * holds because no principal can reach the API at all.
   */
  Profile: a
    .model({
      displayName: a.string(),
      /** Mirror of the manifest's generation (`02` §6.4). Wired by `0182`. */
      exploredGeneration: a.integer(),
      /** Atlas-only overlay (D-133). */
      showColdTerritory: a.boolean(),
      rulesVersionPinned: a.integer(),
      /** D-033's headline, denormalised so it is one read, not six (`02` T1). */
      totalLevel: a.integer(),
      totalXp: a.integer(),
      /**
       * `02` §4.4 step 1. While true, the UI keeps rendering the SkillState it already has
       * rather than refetching, so no number visibly moves until step 6 has written them all.
       */
      replayInProgress: a.boolean(),
      /**
       * `0235`, D-275. The version §4.4 step 6 moved the ledger to. Every ingest commit with XP
       * is conditioned on it, so a commit scored before a replay cannot land after one.
       */
      ledgerRulesVersion: a.integer(),
    })
    .authorization((allow) => [allow.authenticated("identityPool").to(["read"])]),

  /**
   * T2 `SkillState`. Ticket 0062, `02-data-model.md` T2.
   *
   * `xpLedgerSum` is a pure SUM of this (user, skill)'s ledger rows, maintained by `ADD` on
   * ingest. `displayedXp` equals it by construction (§4.6), and it is a SECOND attribute so
   * a bug in one shows against the other (I-15).
   *
   * `level` and `levelHighWater` are written by every XP-bearing ingest (`0219`) and by the
   * replay (`0066`). They are optional so a row written before then reads cleanly.
   */
  SkillState: a
    .model({
      userId: a.string().required(),
      /** Opaque. NEVER an enum (D-031). */
      skillId: a.string().required(),
      xpLedgerSum: a.integer().required(),
      displayedXp: a.integer().required(),
      level: a.integer(),
      /** Never decreases (04 §7.5, D-135). */
      levelHighWater: a.integer(),
      /** From `activity.startedAt`, never the clock (I-12). */
      firstXpAt: a.datetime(),
      lastXpAt: a.datetime(),
      rulesVersionLastComputed: a.integer(),
      /**
       * D-146, ticket 0065. The registry row's `introducedIn`, and the creating activity's
       * `startedAt` — written by the ADD that creates the row, never after (`if_not_exists`).
       */
      firstSeenRulesVersion: a.integer(),
      firstSeenAt: a.datetime(),
    })
    /** T2: `PK userId, SK skillId`. No GSIs: "all skills for this user" is the base-table query. */
    .identifier(["userId", "skillId"])
    /**
     * NO MUTATIONS AND NO SUBSCRIPTIONS EXIST, rather than existing and being denied (I-20).
     * A read-only rule alone still generates `createSkillState` and friends, with
     * an auth check that refuses them; `Activity` above is that shape today. For the two
     * tables that ARE the XP, "no auth rule is as safe as no reachability" (§2.1) wins.
     * Subscriptions go too: they fire only on AppSync mutations, and the pipeline writes
     * DynamoDB directly, so one could never fire.
     */
    .disableOperations(["mutations", "subscriptions"])
    .authorization((allow) => [allow.authenticated("identityPool").to(["read"])]),

  /**
   * T4 `XpLedgerEntry`. Ticket 0062, `02-data-model.md` T4 and §4.
   *
   * APPEND-ONLY. The pipeline writes rows with a conditional put inside the ingest
   * transaction; the replay job (`0066`) deletes and rewrites over IAM. Nothing reaches this
   * table through AppSync except a read (I-18).
   */
  XpLedgerEntry: a
    .model({
      /** `${activityId}#${skillId}#${reason}#v${xpRulesVersion}` — `src/scoring/ledger.ts`. */
      id: a.id().required(),
      userId: a.string().required(),
      /** `__floor__` on a D-135 floor row. */
      activityId: a.string().required(),
      skillId: a.string().required(),
      /** Closed vocabulary, `02` §4.2 — `LEDGER_REASONS`. */
      reason: a.string().required(),
      /** GSI1's sort key, `${skillId}#${reason}`. Derived; see `byActivity` below. */
      skillIdReason: a.string().required(),
      /** GSI3's partition key, `${userId}#${skillId}`. Derived; see `bySkill` below. */
      userIdSkillId: a.string().required(),
      units: a.float().required(),
      unitsEffective: a.float().required(),
      /** INTEGER, rounded once at write time (I-19). */
      xpAwarded: a.integer().required(),
      /** The row is meaningless without it (04 §7.6). */
      xpRulesVersion: a.integer().required(),
      /** The D-135 marker. `false` on every rule-derived row. */
      isFloor: a.boolean().required(),
      /** `<startedAt>#<activityId>#<nn>` — replay order. */
      seq: a.string().required(),
      /** Ingest wall clock. Audit only; never a scoring input. */
      awardedAt: a.datetime().required(),
      /** `retained_floor` rows only (§4.6): the ruleset whose displayed total the row retains. */
      supersedesRulesVersion: a.integer(),
      /**
       * `ReplayRun` rows only (§4.5, ticket 0066): `id = REPLAY#<userId>#<id>`,
       * `activityId = "__replay__"`, `reason = "replay_run"`, `xpAwarded: 0`. The DONE row is
       * also the chronicle's "the rules of the world shifted" entry (D-258).
       */
      fromRulesVersion: a.integer(),
      toRulesVersion: a.integer(),
      /** `RUNNING | DONE | FAILED`. */
      status: a.string(),
      startedAt: a.datetime(),
      finishedAt: a.datetime(),
      waterline: a.json(),
      recomputed: a.json(),
      floorsWritten: a.json(),
    })
    .identifier(["id"])
    .secondaryIndexes((index) => [
      /**
       * GSI1 `byActivity`, ALL. "Which rows did this activity earn" — the post-run card, and
       * the ingest path's layer-1 check (`xp-ledger.ts`). T4 writes the sort key as
       * `skillId#reason`; Amplify indexes name a single field, so it is stored as one,
       * the same way T3 stores `userIdLocalDay`.
       */
      index("activityId").sortKeys(["skillIdReason"]).name("byActivity").projection("ALL"),
      /** GSI2 `byUserAndSeq`, ALL — replay order for the whole ledger (04 §7.4). */
      index("userId").sortKeys(["seq"]).name("byUserAndSeq").projection("ALL"),
      /**
       * GSI3 `bySkill`, ALL — one skill's history, newest last: the skill sheet's `RECENT`
       * list (0074). Not INCLUDE (0242): AppSync's owner rule filters on `owner`, which DynamoDB
       * refuses on an attribute the index does not project, and the client's default selection
       * set asks for required fields (`reason`, `activityId`, `units`…) that RECENT needs anyway.
       * At one user's ledger size the extra index storage is negligible.
       */
      index("userIdSkillId").sortKeys(["awardedAt"]).name("bySkill").projection("ALL"),
    ])
    /** See `SkillState` above: no mutation exists, rather than one that is refused. */
    .disableOperations(["mutations", "subscriptions"])
    .authorization((allow) => [allow.authenticated("identityPool").to(["read"])]),

  /**
   * `Landmark` — WHERE A PLACE-BOUND MILESTONE WAS EARNED. Ticket `0248`, `04` §4.3, D-301.
   *
   * WRITE-ONCE. The pipeline writes a row inside the transaction that commits the crossing XP,
   * every attribute `if_not_exists`, so the first crossing of (skill, level) is the one kept: a
   * redelivery, a re-ingest or a ruleset replay that moves the crossing to another run changes
   * nothing (D-020, D-135 — a landmark, like the map, never un-happens). Nothing deletes a row,
   * and no IAM grant could.
   *
   * `lng`/`lat` are null when the crossing activity had no route (a manual or strength log): the
   * milestone happened, it just happened nowhere. They are a real coordinate near home otherwise
   * (`08` §7.2, D-199), served to the owner only.
   */
  Landmark: a
    .model({
      userId: a.string().required(),
      /** `${skillId}#${level}` — the key that makes the write once-only. */
      skillLevel: a.string().required(),
      /** Opaque. NEVER an enum (D-031). */
      skillId: a.string().required(),
      level: a.integer().required(),
      /** `PLACE_LEVELS`' kind at the time of the crossing — `landmark` or `shrine`. */
      place: a.string().required(),
      /** The activity whose XP crossed the threshold. */
      activityId: a.string().required(),
      /** That activity's `startedAt` — never the clock (I-12). */
      earnedAt: a.datetime().required(),
      lng: a.float(),
      lat: a.float(),
    })
    .identifier(["userId", "skillLevel"])
    /** See `SkillState`: no mutation exists, rather than one that is refused. */
    .disableOperations(["mutations", "subscriptions"])
    .authorization((allow) => [allow.authenticated("identityPool").to(["read"])]),

  /**
   * 0012's placeholder. Kept because removing the model would delete its table, which is churn
   * `0334` does not need on the deploy that changes the API's auth.
   */
  DeploySmokeTest: a
    .model({
      note: a.string(),
    })
    .authorization((allow) => [allow.authenticated("identityPool").to(["read"])]),
})

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  schema,
  /**
   * `iam`, and no `defineAuth` exists (D-472, D-473, `0334`). The API's auth modes are exactly
   * `AWS_IAM`, which `scripts/check-auth-posture.mjs` asserts against the deployed API.
   */
  authorizationModes: {
    defaultAuthorizationMode: "iam",
  },
})
