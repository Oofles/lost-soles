import type { SourceId } from "@/src/domain/activity"

/**
 * THE THIRD MESSAGE SHAPE ON THE INGEST QUEUE. Ticket 0282, D-NEW-a — built in `DisconnectMessage`'s
 * shape (D-348) rather than a second routing scheme.
 *
 * A source-side deletion arrives at the public webhook, which may not call the source and holds no
 * grant on the activity table, so it cannot confirm or tombstone anything itself. It gates the
 * claim through the receipt (`ingestKey`, minted by the adapter) and sends this; `process-activity`
 * acts on it (`retract.ts`).
 *
 * It is NOT an `IngestJob`: D-343 pins that key set, and a retract has nothing to fetch, archive or
 * score. The shapes are told apart by `command` — an `IngestJob`'s is `ingest` or `reingest`, a
 * `DisconnectMessage`'s is `disconnect`, this one's is `retract`.
 *
 * IT IS A CLAIM, NOT A FACT. Some sources sign nothing (`08-security-privacy.md` §4.1), so the
 * worker asks the source before it believes it (`SourceAdapter.confirmRetracted`).
 */
export interface RetractMessage {
  command: "retract"
  source: SourceId
  userId: string
  /** ALWAYS a string, for `IngestJob.externalId`'s reason: some sources' ids are int64. */
  externalId: string
  ingestKey: string
  enqueuedAt: string
}

export function retractMessage(input: {
  source: SourceId
  userId: string
  externalId: string
  ingestKey: string
  now: Date
}): RetractMessage {
  return {
    command: "retract",
    source: input.source,
    userId: input.userId,
    externalId: input.externalId,
    ingestKey: input.ingestKey,
    enqueuedAt: input.now.toISOString(),
  }
}

export function isRetractMessage(value: unknown): value is RetractMessage {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.command === "retract" &&
    typeof v.source === "string" &&
    typeof v.userId === "string" &&
    typeof v.externalId === "string" &&
    typeof v.ingestKey === "string"
  )
}
