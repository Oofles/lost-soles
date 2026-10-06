/**
 * THE BROWSER'S TWO CALLS FOR `/log`. Ticket 0068.
 *
 * `logWorkout` (0069's mutation) is how a queued entry leaves the browser, and `SkillState` is
 * where the optimistic result's standing comes from. Both go straight to AppSync with the
 * signed-in user's Cognito token. That is the path 0069 built the mutation for: the handler
 * reads the user from `identity.sub`, never from an argument.
 *
 * Behind one seam, so the queue and the page can be tested with no network and no Amplify.
 */

import type { Schema } from "@/amplify/data/resource"
import type { CachedSkill } from "@/lib/log/optimistic"
import { LogRefusedError, type SendLog } from "@/lib/log/queue"
import type { WorkoutEntry } from "@/lib/log/workout-entry"

/** `06` §9.5: *"API timeout 10 s, then queue. No request is allowed to hold a screen."* */
export const API_TIMEOUT_MS = 10_000

/** `amplify/functions/log-workout`: errors the client caused are `REFUSED:<code>:<message>`. */
const REFUSED = /^REFUSED:([A-Z_]+):?\s*(.*)$/s

type DataClient = ReturnType<typeof import("aws-amplify/data").generateClient<Schema>>
let client: Promise<DataClient> | undefined

/** Lazily, so a module that imports this file does not import Amplify until it calls out. */
function dataClient(): Promise<DataClient> {
  client ??= import("aws-amplify/data").then(({ generateClient }) => generateClient<Schema>())
  return client
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${API_TIMEOUT_MS} ms`)), API_TIMEOUT_MS)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/** GraphQL errors from the data client → a refusal, or a retryable failure. */
export function errorFrom(errors: readonly { message?: string; errorType?: string }[]): Error {
  for (const e of errors) {
    const m = REFUSED.exec(e.message ?? "")
    if (m) return new LogRefusedError(m[1], m[2])
  }
  return new Error(errors.map((e) => e.message ?? e.errorType ?? "unknown error").join("; "))
}

export const sendLog: SendLog = async (entry: WorkoutEntry) => {
  const c = await dataClient()
  const { data, errors } = await withTimeout(
    c.mutations.logWorkout({
      exerciseId: entry.exerciseId,
      sets: entry.sets.map((s) => ({ ...s })),
      occurredAt: entry.occurredAt,
      idempotencyKey: entry.idempotencyKey,
      timezone: entry.timezone ?? null,
    }),
    "logWorkout",
  )
  if (errors?.length) throw errorFrom(errors)
  if (!data) throw new Error("logWorkout returned no data")
  return { logged: data.logged, xpAwarded: data.xpAwarded }
}

/** The signed-in user's `SkillState` rows. Owner-scoped by AppSync; one page is every skill. */
export async function fetchSkills(): Promise<CachedSkill[]> {
  const c = await dataClient()
  const { data, errors } = await withTimeout(c.models.SkillState.list({ limit: 1000 }), "SkillState.list")
  if (errors?.length) throw errorFrom(errors)
  return data.map((s) => ({
    skillId: s.skillId,
    xp: s.displayedXp,
    ...(s.rulesVersionLastComputed != null ? { rulesVersionLastComputed: s.rulesVersionLastComputed } : {}),
    ...(s.levelHighWater != null ? { levelHighWater: s.levelHighWater } : {}),
  }))
}

/** The signed-in user's `sub`, from the local session — no network. Undefined if signed out. */
export async function currentUid(): Promise<string | undefined> {
  try {
    const { getCurrentUser } = await import("aws-amplify/auth")
    return (await getCurrentUser()).userId
  } catch {
    return undefined
  }
}
