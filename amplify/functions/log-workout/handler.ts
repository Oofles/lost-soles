import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"

import { isOwner } from "@/lib/auth/owner-ids"
import { log } from "@/lib/log"
import { logWorkout, LogWorkoutRefused, type LogWorkoutResult } from "@/lib/log/log-workout"
import { EXPLORED_CELL_TABLE } from "@/src/pipeline/explored-cells"
import { rulesForUser } from "@/src/pipeline/worker-rules"
import type { RuleSet } from "@/src/rules/schema"
import { assertValidRuleSet } from "@/src/rules/validate"

/**
 * THE `logWorkout` RESOLVER. Ticket 0069. AppSync in, `lib/log/log-workout.ts` out — the
 * pipeline order lives there, the AWS clients and the identity live here.
 *
 * ─── WHO ─────────────────────────────────────────────────────────────────────
 *
 * The user is `event.identity.sub`, verified by AppSync against the user pool. Never an
 * argument: the mutation has no user field, so there is nothing for a client to forge.
 * The OWNER check is the second half, for `lib/auth/owner.ts`'s reason — "signed in" and
 * "the owner" are the same set today and stop being so the day D-014 adds friends.
 *
 * ─── ERRORS ──────────────────────────────────────────────────────────────────
 *
 * A thrown error becomes a GraphQL error. `LogWorkoutRefused` is prefixed `REFUSED:` so the
 * client queue (`0068`) can tell "this entry will never be accepted, drop it" from "try again".
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
  if (!value) throw new Error(`${name} is not set on log-workout. It is wired in amplify/backend.ts.`)
  return value
}

interface AppSyncEvent {
  arguments: Record<string, unknown>
  identity?: { sub?: string } | null
}

export const handler = async (event: AppSyncEvent): Promise<LogWorkoutResult> => {
  const userId = event.identity?.sub
  if (!userId || !isOwner(userId)) throw new Error("REFUSED:NOT_OWNER: logWorkout is owner-only")

  const bucket = required("USER_DATA_BUCKET")
  const startedAt = Date.now()
  try {
    const result = await logWorkout(event.arguments, userId, {
      registry: (uid) =>
        rulesForUser(uid, {
          ddb,
          table: required("SKILL_STATE_TABLE"),
          profileTable: required("PROFILE_TABLE"),
          bundled: RULES,
        }),
      archive: { s3, bucket },
      receipt: { ddb },
      // Never touched on this path — a manual log has no trace (I-27) — but typed as required.
      cells: { ddb, table: EXPLORED_CELL_TABLE },
      blobs: { s3, bucket, ddb, table: EXPLORED_CELL_TABLE },
      persist: { ddb, activityTable: required("ACTIVITY_TABLE") },
      dedupe: { ddb, activityTable: required("ACTIVITY_TABLE") },
      /** `0243`. A fresh log has no correction yet; looked for anyway, so the worker has one rule. */
      kindOverrides: { s3: s3 as never, bucket },
      ledger: {
        ddb,
        ledgerTable: required("XP_LEDGER_TABLE"),
        skillStateTable: required("SKILL_STATE_TABLE"),
        profileTable: required("PROFILE_TABLE"),
      },
      snapshots: { s3, bucket },
    })
    log.info({ at: "log-workout", outcome: result.logged ? "logged" : "already-logged", ...result, totalMs: Date.now() - startedAt })
    return result
  } catch (error) {
    if (error instanceof LogWorkoutRefused) {
      log.warn({ at: "log-workout", outcome: "refused", code: error.code, detail: error.message })
      throw new Error(`REFUSED:${error.code}: ${error.message}`)
    }
    log.error({
      at: "log-workout",
      outcome: "failed",
      errorClass: error instanceof Error ? error.name : "UnknownError",
      detail: error instanceof Error ? error.message : String(error),
      totalMs: Date.now() - startedAt,
    })
    throw error
  }
}
