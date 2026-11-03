/**
 * THE BROWSER'S TWO CALLS FOR `/log`. Ticket 0068; same-origin since `0331` (D-472).
 *
 * `logWorkout` is how a queued entry leaves the browser, and `SkillState` is where the optimistic
 * result's standing comes from. Both go to this app's own routes, `POST /api/log` and
 * `GET /api/skills/state`, which run as the SSR compute and take the user from the session. The
 * log route invokes 0069's `log-workout` Lambda with a server-set `userId`; nothing here sends one.
 *
 * Behind one seam, so the queue and the page can be tested with no network and no Amplify.
 */

import { uidFromCookieHeader } from "@/lib/auth/uid-cookie"
import { RouteError, sameOriginJson } from "@/lib/http/same-origin-json"
import type { CachedSkill } from "@/lib/log/optimistic"
import { LogRefusedError, type SendLog } from "@/lib/log/queue"
import type { WorkoutEntry } from "@/lib/log/workout-entry"
import { SKILLS_STATE_PATH } from "@/lib/skills/wire"

/** `POST /api/log`. */
export const LOG_PATH = "/api/log"

/** `amplify/functions/log-workout`: errors the client caused are `REFUSED:<code>:<message>`. */
const REFUSED = /^REFUSED:([A-Z_]+):?\s*(.*)$/s

/** The handler's error list (relayed by the route) → a refusal, or a retryable failure. */
export function errorFrom(errors: readonly { message?: string; errorType?: string }[]): Error {
  for (const e of errors) {
    const m = REFUSED.exec(e.message ?? "")
    if (m) return new LogRefusedError(m[1], m[2])
  }
  return new Error(errors.map((e) => e.message ?? e.errorType ?? "unknown error").join("; "))
}

/**
 * A route failure → `errorFrom`'s answer. Only a `422` can be a refusal: a signed-out `404`, a
 * `403`, a `502` or a dropped connection is a failed flush and the entry stays queued, because the
 * queue's whole promise is that a log is never lost to a bad moment.
 */
function routeErrorFrom(error: unknown): unknown {
  if (!(error instanceof RouteError)) return error
  if (error.status === 422 && error.errors.length > 0) return errorFrom(error.errors)
  return error
}

interface LogWorkoutResponse {
  logged: boolean
  xpAwarded: number
}

export const sendLog: SendLog = async (entry: WorkoutEntry) => {
  // `06` §9.5: *"API timeout 10 s, then queue."* A timeout is a failed flush: the entry stays queued.
  let data: LogWorkoutResponse | null
  try {
    data = await sameOriginJson<LogWorkoutResponse | null>(LOG_PATH, {
      method: "POST",
      body: {
        exerciseId: entry.exerciseId,
        sets: entry.sets.map((s) => ({ ...s })),
        occurredAt: entry.occurredAt,
        idempotencyKey: entry.idempotencyKey,
        timezone: entry.timezone ?? null,
      },
    })
  } catch (error) {
    throw routeErrorFrom(error)
  }
  if (!data) throw new Error("logWorkout returned no data")
  return { logged: data.logged, xpAwarded: data.xpAwarded }
}

/** The signed-in user's `SkillState` rows, keyed by the session on the server. */
export async function fetchSkills(): Promise<CachedSkill[]> {
  return sameOriginJson<CachedSkill[]>(SKILLS_STATE_PATH)
}

/**
 * The signed-in user's uid, from the `ls-uid` cookie — no network, so `/log` still opens its queue
 * and cache offline (D-282). Undefined if signed out, or outside a browser. Ticket 0332, D-NEW-a:
 * it was Amplify's `getCurrentUser()` until the cutover. A KEY FOR LOCAL STORES, NOT A CREDENTIAL:
 * the server never reads this cookie (`lib/auth/uid-cookie.ts`).
 */
export async function currentUid(
  cookie: () => string | undefined = () => (typeof document === "undefined" ? undefined : document.cookie),
): Promise<string | undefined> {
  return uidFromCookieHeader(cookie())
}
