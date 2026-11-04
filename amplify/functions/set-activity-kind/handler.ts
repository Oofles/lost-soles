import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"

import { isOwner } from "@/lib/auth/owner-ids"
import { log } from "@/lib/log"
import { archivedTrace } from "@/src/pipeline/archived-trace"
import { EXPLORED_CELL_TABLE } from "@/src/pipeline/explored-cells"
import { UnknownKindError } from "@/src/pipeline/kind-override"
import { rescoreKind, type KindRescoreResult } from "@/src/pipeline/kind-rescore"
import { rulesForUser } from "@/src/pipeline/worker-rules"
import { ReplayInProgressError } from "@/src/pipeline/xp-ledger"
import type { RuleSet } from "@/src/rules/schema"
import { assertValidRuleSet } from "@/src/rules/validate"

import { callerOf } from "../caller"

/**
 * THE `setActivityKind` HANDLER. Ticket `0244`. `POST /api/runs/[activityId]/kind` in (D-472,
 * `0331`), `src/pipeline/kind-rescore.ts` out —
 * the override, the cells and the re-score live there; the AWS clients and the identity live here.
 *
 * ─── WHO ─────────────────────────────────────────────────────────────────────
 *
 * `logWorkout`'s rule: the user is `event.userId`, set by the route from `currentUserId()` on a
 * direct invoke only the SSR compute role may make (`../caller.ts`; the AppSync path was removed in
 * `0334`), never a client field, and must be on the owner allowlist. `rescoreKind` then refuses an activity that is not that user's, so the
 * `activityId` argument cannot reach someone else's run.
 *
 * ─── ERRORS ──────────────────────────────────────────────────────────────────
 *
 * `REFUSED:<code>:` for what the caller can fix (an unknown kind), as `logWorkout` does. A replay
 * in progress is `BUSY:` — try again later, nothing was written to the ledger.
 */

const s3 = new S3Client({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

const RULES: ReadonlyMap<number, RuleSet> = new Map(
  Object.entries(BUNDLED_RULES).map(([key, rules]) => {
    assertValidRuleSet(rules)
    return [Number(key), rules] as const
  }),
)

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set on set-activity-kind. It is wired in amplify/backend.ts.`)
  return value
}

/** What the GraphQL `SetActivityKindResult` carries. Skill maps flattened to lists for the SDL. */
export interface SetActivityKindResult {
  outcome: KindRescoreResult["outcome"]
  activityId: string
  kind: string
  from: string | null
  derivedKind: string | null
  gained: { skillId: string; xp: number }[]
  retained: { skillId: string; xp: number }[]
  cellsRevealed: number
  message: string
}

export function toResult(r: KindRescoreResult): SetActivityKindResult {
  const list = (m: Record<string, number>) => Object.entries(m).map(([skillId, xp]) => ({ skillId, xp }))
  if (r.outcome === "unchanged") {
    return { outcome: r.outcome, activityId: r.activityId, kind: r.kind, from: null, derivedKind: null, gained: [], retained: [], cellsRevealed: 0, message: r.message }
  }
  return {
    outcome: r.outcome,
    activityId: r.activityId,
    kind: r.to,
    from: r.from,
    derivedKind: r.derivedKind,
    gained: r.xp ? list(r.xp.gained) : [],
    retained: r.xp ? list(r.xp.floors) : [],
    cellsRevealed: r.cellsRevealed,
    message: r.message,
  }
}

export const handler = async (event: unknown): Promise<SetActivityKindResult> => {
  const { userId, args } = callerOf(event)
  if (!userId || !isOwner(userId)) throw new Error("REFUSED:NOT_OWNER: setActivityKind is owner-only")
  const { activityId, kind } = args
  if (typeof activityId !== "string" || !activityId || typeof kind !== "string" || !kind) {
    throw new Error("REFUSED:BAD_ARGUMENTS: activityId and kind are required")
  }

  const bucket = required("USER_DATA_BUCKET")
  const startedAt = Date.now()
  try {
    const result = await rescoreKind(
      { userId, activityId, kind, setBy: `setActivityKind:${userId}` },
      {
        ddb: ddb as never,
        activityTable: required("ACTIVITY_TABLE"),
        ledger: {
          ledgerTable: required("XP_LEDGER_TABLE"),
          skillStateTable: required("SKILL_STATE_TABLE"),
          profileTable: required("PROFILE_TABLE"),
          landmarkTable: required("LANDMARK_TABLE"),
        },
        overrides: { s3: s3 as never, bucket },
        registry: (uid) =>
          rulesForUser(uid, {
            ddb,
            table: required("SKILL_STATE_TABLE"),
            profileTable: required("PROFILE_TABLE"),
            bundled: RULES,
          }),
        cells: { ddb: ddb as never, table: EXPLORED_CELL_TABLE },
        blobs: {
          s3: s3 as never,
          bucket,
          ddb: ddb as never,
          table: EXPLORED_CELL_TABLE,
          /** The worker's `Profile.exploredGeneration` mirror, so a reveal here moves it too. */
          mirror: { ddb: ddb as never, table: required("PROFILE_TABLE") },
        },
        loadTrace: (activity) => archivedTrace(activity, { s3: s3 as never }, `set-activity-kind:${activity.activityId}`),
      },
    )
    log.info({ at: "set-activity-kind", outcome: result.outcome, activityId, kind, message: result.message, totalMs: Date.now() - startedAt })
    return toResult(result)
  } catch (error) {
    if (error instanceof UnknownKindError) {
      log.warn({ at: "set-activity-kind", outcome: "refused", code: "UNKNOWN_KIND", detail: error.message })
      throw new Error(`REFUSED:UNKNOWN_KIND: ${error.message}`)
    }
    if (error instanceof ReplayInProgressError) {
      log.warn({ at: "set-activity-kind", outcome: "busy", detail: error.message })
      throw new Error(`BUSY: an XP replay is running; try again in a minute. ${error.message}`)
    }
    log.error({
      at: "set-activity-kind",
      outcome: "failed",
      errorClass: error instanceof Error ? error.name : "UnknownError",
      detail: error instanceof Error ? error.message : String(error),
      totalMs: Date.now() - startedAt,
    })
    throw error
  }
}
