import type { RetractConfirmation } from "@/src/adapters/types"
import { computeActivityId } from "@/src/domain/activity-id"

import { closeRetractReceipt, recordDelivery, type ReceiptDeps } from "./ingest-receipt"
import { tombstoneActivity, type PersistDeps, type TombstoneResult } from "./persist"
import type { RetractMessage } from "./retract-message"

/**
 * A SOURCE-SIDE DELETION, CONFIRMED BEFORE IT IS BELIEVED. Ticket `0282`, D-NEW-a.
 *
 * The worker half of a `RetractMessage`. Three steps, in this order, and the order is the point:
 *
 *   1. `recordDelivery` — the receipt the webhook's accept gate wrote must exist. A hand-crafted
 *      message that never passed the gate fails here, having spent no provider call and written
 *      nothing (the same guard an `IngestJob` meets first).
 *   2. CONFIRM with the source (`SourceAdapter.confirmRetracted`), with our credential. The event
 *      is unsigned on at least one source (`08-security-privacy.md` §4.1); believing it would let
 *      a stranger hide a real run. `present` → the claim was forged or stale: nothing is written
 *      beyond closing the receipt, and the outcome is logged.
 *   3. TOMBSTONE — `status = TOMBSTONED` on the T3 row and nothing else (`02` §4.7). Its XP stays
 *      in the total (D-135), its cells stay revealed with their timestamps untouched (D-020), and
 *      later deliveries of the activity keep the tombstone (`activityItem`'s `status`).
 *
 * A throw anywhere (a 5xx, a timeout, an ambiguous not-found) propagates, so SQS redelivers and
 * the DLQ alarm fires if it never resolves — a fault is never read as either answer.
 *
 * No source is named here (D-100): which call answers "is it gone" is the adapter's.
 */
export type RetractOutcome = "forged-or-stale" | TombstoneResult

export interface RetractDeps {
  /** Asks the source. Bound to the message's user and source by the caller. */
  confirm(message: RetractMessage): Promise<RetractConfirmation>
  receipt: ReceiptDeps
  persist: PersistDeps
  now?: () => Date
}

export async function retractActivity(message: RetractMessage, deps: RetractDeps): Promise<RetractOutcome> {
  await recordDelivery(message.ingestKey, deps.receipt)

  const confirmation = await deps.confirm(message)
  const outcome: RetractOutcome =
    confirmation === "gone"
      ? await tombstoneActivity(
          {
            activityId: computeActivityId(message.userId, message.source, message.externalId),
            userId: message.userId,
            now: deps.now?.() ?? new Date(),
          },
          deps.persist,
        )
      : "forged-or-stale"

  await closeRetractReceipt(message.ingestKey, deps.receipt)
  return outcome
}
