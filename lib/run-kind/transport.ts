/**
 * THE RUN PAGE'S TWO CALLS FOR AN ACTIVITY'S KIND. Ticket `0244`; same-origin since `0331` (D-472).
 *
 * Both through `/api/runs/[activityId]/kind`, which runs as the SSR compute and takes the user from
 * the session:
 *
 * - `GET`: the `Activity` row's kind fields, filtered on the session's uid (`lib/run-kind/server.ts`).
 * - `POST { kind }`: the route invokes `set-activity-kind` with a server-set `userId`. No user field
 *   is sent from here.
 */

import { RouteError, sameOriginJson } from "@/lib/http/same-origin-json"

import type { ActivityKindRow, KindChangeResult } from "./kind"

export const runKindPath = (activityId: string) => `/api/runs/${encodeURIComponent(activityId)}/kind`

/** `REFUSED:<CODE>: detail` and `BUSY: detail` → the detail, which is written for a person. */
export function errorText(errors: readonly { message?: string }[]): string {
  const m = errors.map((e) => e.message ?? "").find(Boolean) ?? "unknown error"
  return m.replace(/^(REFUSED:[A-Z_]+|BUSY):\s*/, "")
}

/** A route failure → an `Error` whose message is for a person, as before. */
function personError(error: unknown): unknown {
  if (error instanceof RouteError && error.errors.length > 0) return new Error(errorText(error.errors))
  return error
}

/** The activity's kind fields, or `null` if there is no such activity (or it is not this user's). */
export async function fetchActivityKind(activityId: string): Promise<ActivityKindRow | null> {
  try {
    return (await sameOriginJson<{ activity: ActivityKindRow | null }>(runKindPath(activityId))).activity
  } catch (error) {
    throw personError(error)
  }
}

export async function setActivityKind(activityId: string, kind: string): Promise<KindChangeResult> {
  let data: KindChangeResult | null
  try {
    data = await sameOriginJson<KindChangeResult | null>(runKindPath(activityId), { method: "POST", body: { kind } })
  } catch (error) {
    throw personError(error)
  }
  if (!data) throw new Error("setActivityKind returned no data")
  return data
}
