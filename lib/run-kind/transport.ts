/**
 * THE RUN PAGE'S TWO CALLS FOR AN ACTIVITY'S KIND. Ticket `0244`.
 *
 * Read: the `Activity` row's kind fields, owner-scoped by AppSync's `allow.owner().to(["read"])`.
 * Write: `setActivityKind`, whose handler takes the user from `identity.sub` (never an argument).
 * Both straight to AppSync with the signed-in user's token, as `/log`'s are.
 */

import type { Schema } from "@/amplify/data/resource"
import { API_TIMEOUT_MS } from "@/lib/log/transport"

import type { ActivityKindRow, KindChangeResult } from "./kind"

type DataClient = ReturnType<typeof import("aws-amplify/data").generateClient<Schema>>
let client: Promise<DataClient> | undefined

function dataClient(): Promise<DataClient> {
  client ??= import("aws-amplify/data").then(({ generateClient }) => generateClient<Schema>())
  return client
}

function timed<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${API_TIMEOUT_MS} ms`)), API_TIMEOUT_MS)),
  ])
}

/** `REFUSED:<CODE>: detail` and `BUSY: detail` → the detail, which is written for a person. */
export function errorText(errors: readonly { message?: string }[]): string {
  const m = errors.map((e) => e.message ?? "").find(Boolean) ?? "unknown error"
  return m.replace(/^(REFUSED:[A-Z_]+|BUSY):\s*/, "")
}

/** The activity's kind fields, or `null` if there is no such activity (or it is not this user's). */
export async function fetchActivityKind(activityId: string): Promise<ActivityKindRow | null> {
  const c = await dataClient()
  const { data, errors } = await timed(
    c.models.Activity.get({ id: activityId }, { selectionSet: ["id", "kind", "derivedKind", "kindOverride.kind"] }),
    "Activity.get",
  )
  if (errors?.length) throw new Error(errorText(errors))
  if (!data) return null
  return { kind: data.kind, derivedKind: data.derivedKind, kindOverride: data.kindOverride ? { kind: data.kindOverride.kind } : null }
}

export async function setActivityKind(activityId: string, kind: string): Promise<KindChangeResult> {
  const c = await dataClient()
  const { data, errors } = await timed(c.mutations.setActivityKind({ activityId, kind }), "setActivityKind")
  if (errors?.length) throw new Error(errorText(errors))
  if (!data) throw new Error("setActivityKind returned no data")
  return data
}
