/**
 * THE PLINTH'S ONLY QUESTION ABOUT A SOURCE: IS IT CONNECTED, AND IS IT BROKEN? Ticket `0087`.
 *
 * Read on the server by `app/(home)/layout.tsx` (D-322) — the same summary `/settings` reads, with no token
 * attribute projected — and handed to the client as data. The two lines it feeds are the only
 * source-related text `/` ever shows (`06` §2.3, §2.4):
 *
 * - `Connect <name> to begin`, when nothing has ever been imported and nothing is connected;
 * - `<name> needs reconnecting`, when a connection is `NEEDS_REAUTH` — a genuinely broken token,
 *   and the ONLY failure `/` surfaces. A slow provider, an outage, a sweep that found nothing:
 *   none of those is an event (D-013), and none of them changes this row.
 *
 * NO VENDOR NAME HERE. `name` is the connector's `displayName`, as `/settings` uses it (D-100).
 *
 * A failed read is a source omitted, never a thrown page: an unknown state says nothing, and
 * "nothing" is always a safe thing for the plinth to say.
 */

import { getSourceAccountSummary, type SourceAccountSummary } from "@/lib/sources/source-account-store"
import { connectableSources, getOAuthConnector } from "@/src/adapters/registry"

export type SourceState = "connected" | "not-connected" | "reconnect"

export interface SourceConnection {
  sourceId: string
  name: string
  state: SourceState
}

export function sourceState(summary: SourceAccountSummary | null): SourceState {
  if (summary === null || summary.status === "DISCONNECTED") return "not-connected"
  return summary.status === "ACTIVE" ? "connected" : "reconnect"
}

export async function sourceConnections(
  userId: string,
  read: (userId: string, sourceId: string) => Promise<SourceAccountSummary | null> = getSourceAccountSummary,
): Promise<SourceConnection[]> {
  const rows = await Promise.all(
    connectableSources().map(async (sourceId): Promise<SourceConnection | null> => {
      try {
        const state = sourceState(await read(userId, sourceId))
        return { sourceId, name: getOAuthConnector(sourceId).displayName, state }
      } catch {
        return null
      }
    }),
  )
  return rows.filter((r): r is SourceConnection => r !== null)
}
