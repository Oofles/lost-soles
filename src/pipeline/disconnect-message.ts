import type { SourceId } from "@/src/domain/activity"

/**
 * THE SECOND MESSAGE SHAPE ON THE INGEST QUEUE. Ticket 0093, D-NEW (Q1 = A′).
 *
 * A source's deauthorization (`03-integrations.md` §2.3: the athlete revoked us at the provider)
 * arrives at the public webhook, which holds no grant on `LostSolesSourceAccount` (§4.5) and so
 * cannot mark anything disconnected itself. It sends this instead, on the queue it already sends
 * ingest jobs to, and `process-activity` — which does hold that grant — acts on it.
 *
 * It is NOT an `IngestJob`, and it is not one deliberately. `IngestJob`'s key set is pinned
 * (D-343), and a disconnect has no activity, no external id and no ingest key. The two shapes are
 * told apart by `command`: an `IngestJob`'s is `ingest` or `reingest`, this one's is `disconnect`.
 *
 * IT IS A CLAIM, NOT A FACT. Strava signs nothing, so a forged deauthorization is as easy to send
 * as a forged create. The worker therefore confirms the revocation with the provider before it
 * acts (`lib/sources/deauthorization.ts`), which keeps §4.1's property: a forgery is worthless.
 */
export interface DisconnectMessage {
  command: "disconnect"
  source: SourceId
  userId: string
  enqueuedAt: string
}

export function disconnectMessage(input: { source: SourceId; userId: string; now: Date }): DisconnectMessage {
  return { command: "disconnect", source: input.source, userId: input.userId, enqueuedAt: input.now.toISOString() }
}

export function isDisconnectMessage(value: unknown): value is DisconnectMessage {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return v.command === "disconnect" && typeof v.source === "string" && typeof v.userId === "string"
}
