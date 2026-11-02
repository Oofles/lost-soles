/**
 * THE RUN PAGE'S LEDGER READ. Ticket `0078`; same-origin since `0331` (D-472).
 *
 * `XpLedgerEntry`'s `byActivity` index (T4 GSI1, *"which rows did this activity earn — the post-run
 * card"*), through `GET /api/runs/[activityId]/ledger`. The route runs as the SSR compute and filters
 * on the session's uid (`lib/runs/ledger-server.ts`): another account's rows are simply not returned,
 * so there is no user id here to pass.
 */

import { sameOriginJson } from "@/lib/http/same-origin-json"

import type { ActivityLedgerRow } from "./ledger"

export const runLedgerPath = (activityId: string) => `/api/runs/${encodeURIComponent(activityId)}/ledger`

/** Every ledger row this activity earned. A run is a handful of rows (one per skill and reason). */
export async function fetchActivityLedger(activityId: string): Promise<ActivityLedgerRow[]> {
  return sameOriginJson<ActivityLedgerRow[]>(runLedgerPath(activityId))
}
