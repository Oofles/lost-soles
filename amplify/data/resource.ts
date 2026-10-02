import { a, defineData, type ClientSchema } from "@aws-amplify/backend"

/**
 * The AppSync-backed half of the data model. `02-data-model.md` §2.1: five
 * `defineData` models (one physical table each, which is how Gen 2 works) plus three
 * raw CDK `dynamodb.Table` constructs for the machine-only tables in `../backend.ts`.
 *
 * A model belongs HERE when a browser is allowed to ask about it, and in the CDK
 * escape hatch when it is not. That is the whole rule: "no auth rule is as safe as no
 * reachability" (§2.1 reason 1).
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

const schema = a.schema({
  SourceRef: sourceRef,
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
     * READ-ONLY TO THE CLIENT, and that is the security posture rather than a
     * convenience. T3: "Client creates are only permitted through the manual-log
     * mutation (§2.11), never a raw `createActivity`."
     *
     * Every field on this model is written by the pipeline, which runs server-side
     * under an IAM role and does not go through AppSync at all. A client that could
     * `createActivity` could mint XP by inventing a run — server-side scoring (01 §4
     * step 14: "never let the client claim XP") means nothing if the client can write
     * the input to it. So the owner gets `read` and nothing else.
     */
    .authorization((allow) => [allow.owner().to(["read"])]),

  /**
   * T1 `Profile`. Ticket 0066, `02-data-model.md` T1. One row per user, `id` = the Cognito sub.
   *
   * Built by the XP replay because it is the first thing that needs to WRITE here: step 1's
   * `replayInProgress` flag and step 6's `totalXp`/`totalLevel` (§4.4). The rest of T1's
   * attributes are declared now so capabilities 08 and 13 inherit the schema `02` chose rather
   * than growing it one column per ticket.
   *
   * ─── THE CLIENT MAY EDIT ITS PREFERENCES, NEVER ITS NUMBERS ─────────────────
   *
   * `02` T1 says `allow.owner()`, and the preferences (`displayName`, `mapMode`,
   * `showColdTerritory`, `rulesVersionPinned`) are the owner's to write. The four attributes the
   * pipeline owns are narrowed to owner READ at the field (D-258): the XP trust boundary
   * (`01` §5, I-20) does not stop being true because a total is denormalised onto a row the
   * client can otherwise edit. A client that could write `totalLevel` could forge the headline.
   */
  Profile: a
    .model({
      displayName: a.string(),
      /** Mirror of the manifest's generation (`02` §6.4). Wired by `0182`. */
      exploredGeneration: a.integer().authorization((allow) => [allow.owner().to(["read"])]),
      /** `"atlas" | "adventure"` (D-052). */
      mapMode: a.string(),
      /** Atlas-only overlay (D-133). */
      showColdTerritory: a.boolean(),
      rulesVersionPinned: a.integer(),
      /** D-033's headline, denormalised so it is one read, not six (`02` T1). */
      totalLevel: a.integer().authorization((allow) => [allow.owner().to(["read"])]),
      totalXp: a.integer().authorization((allow) => [allow.owner().to(["read"])]),
      /**
       * `02` §4.4 step 1. While true, the UI keeps rendering the SkillState it already has
       * rather than refetching, so no number visibly moves until step 6 has written them all.
       */
      replayInProgress: a.boolean().authorization((allow) => [allow.owner().to(["read"])]),
      /**
       * `0235`, D-275. The version §4.4 step 6 moved the ledger to. Every ingest commit with XP
       * is conditioned on it, so a commit scored before a replay cannot land after one.
       */
      ledgerRulesVersion: a.integer().authorization((allow) => [allow.owner().to(["read"])]),
    })
    .authorization((allow) => [allow.owner()]),

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
     * `allow.owner().to(["read"])` alone still generates `createSkillState` and friends, with
     * an auth check that refuses them; `Activity` above is that shape today. For the two
     * tables that ARE the XP, "no auth rule is as safe as no reachability" (§2.1) wins.
     * Subscriptions go too: they fire only on AppSync mutations, and the pipeline writes
     * DynamoDB directly, so one could never fire.
     */
    .disableOperations(["mutations", "subscriptions"])
    .authorization((allow) => [allow.owner().to(["read"])]),

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
       * GSI3 `bySkill`, INCLUDE — one skill's history, newest last. The skill sheet's
       * `RECENT` list needs the XP and the version and nothing else.
       */
      index("userIdSkillId")
        .sortKeys(["awardedAt"])
        .name("bySkill")
        .projection("INCLUDE", ["xpAwarded", "xpRulesVersion"]),
    ])
    /** See `SkillState` above: no mutation exists, rather than one that is refused. */
    .disableOperations(["mutations", "subscriptions"])
    .authorization((allow) => [allow.owner().to(["read"])]),

  /**
   * 0012's placeholder. Kept until a second real model lands — see the header.
   */
  DeploySmokeTest: a
    .model({
      note: a.string(),
    })
    .authorization((allow) => [allow.owner()]),
})

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  schema,
  /**
   * UNCHANGED BY THIS TICKET. The ingest pipeline writes `Activity` rows straight to
   * DynamoDB inside a `TransactWriteItems` (01 §4 step 15) and never touches AppSync,
   * so it needs no auth mode of its own here.
   *
   * 01 §4 step 17 — the worker calling an IAM-authed mutation to wake the browser's
   * subscription, because Amplify has no on-demand ISR and there is no
   * `revalidatePath` to call from a webhook — needs an IAM grant on this model. That
   * arrives with the worker that makes the call (0042) and the invalidation contract
   * (0051); adding it now would be config for a caller that does not exist.
   */
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
})
