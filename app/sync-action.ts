"use server"

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import outputs from "@/amplify_outputs.json"
import { currentUserId, isOwner } from "@/lib/auth/owner"
import { log } from "@/lib/log"
import { oauthCredentialsFor } from "@/lib/sources/adapter-credentials"
import {
  advanceListSinceWatermark,
  getSourceAccountSummary,
  readListSinceWatermark,
} from "@/lib/sources/source-account-store"
import { syncResultLine } from "@/lib/sources/sync-message"
import { syncSource, type SourceSyncOutcome } from "@/lib/sources/sync"
import { getAdapter, getOAuthConnector, registeredSources } from "@/src/adapters/registry"
import { listFailedReceipts } from "@/src/pipeline/ingest-receipt"

/**
 * THE SYNC ACTION. Ticket 0043, `09-roadmap.md` §4.5.
 *
 * A deliberate, scheduled violation of D-013 — there is one thing to do after a run — and
 * it is paid off by capability 14, which adds a webhook producer to the same queue with
 * no change to anything below this file. Recorded in the roadmap as debt with a named
 * payoff rather than as drift.
 *
 * THIS FILE IS THE AUTHENTICATED WRAPPER AND THE WIRING. The sweep's rules are in
 * `lib/sources/sync.ts` and the sentence is in `lib/sources/sync-message.ts`, both of
 * which are testable without Next, AWS or a session. What is left here is the three
 * things only a request can supply: who is asking, which clients to use, and where the
 * queue is.
 */

/**
 * MODULE SCOPE, so a warm SSR container reuses the connections rather than opening TLS
 * per press — this action is the one thing in the app with a person waiting on it.
 */
const sqs = new SQSClient({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

/**
 * THE QUEUE URL, FROM `amplify_outputs.json`'s `custom` BLOCK.
 *
 * That is the channel `01-architecture.md` §2's escape-hatch example prescribes —
 * `backend.addOutput({ custom: { activityQueueUrl } })` — and ticket 0042 surfaced it
 * there. The SSR compute has no CloudFormation output of its own to read and no
 * environment variable a CDK stack can set, which is the same structural gap that made
 * the three machine-only tables carry explicit names.
 *
 * READ THROUGH A CAST, and that is not laziness. `amplify_outputs.json` is gitignored and
 * generated per environment, so the TYPE of this import is whatever file happens to be on
 * disk at typecheck time: the deployed one has `custom`, a stale local one does not, and
 * CI copies `amplify_outputs.example.json`. A structural read plus a loud failure is the
 * only thing that behaves the same in all three.
 *
 * A QUEUE URL IS NOT A SECRET. Possessing it grants nothing without `sqs:SendMessage`,
 * which is held by the SSR compute role alone.
 */
function queueUrl(): string {
  const custom = (outputs as { custom?: { activityIngestQueueUrl?: string } }).custom
  const url = custom?.activityIngestQueueUrl
  if (!url) {
    throw new Error(
      "amplify_outputs.json has no custom.activityIngestQueueUrl. It is written by " +
        "backend.addOutput in amplify/backend.ts (ticket 0042); a missing value means " +
        "this build predates that deploy.",
    )
  }
  return url
}

export interface SyncSummary {
  line: string
  outcomes: SourceSyncOutcome[]
  /**
   * Activities that failed to import on an EARLIER press and are still outstanding
   * (ticket 0044, criterion 4). Not a property of this sweep — see `syncResultLine`.
   */
  failedCount: number
}

/**
 * Sweeps every registered source for the SIGNED-IN user.
 *
 * ─── THE USER ID IS DERIVED, NEVER ACCEPTED ─────────────────────────────────
 *
 * Criterion 2, and `08-security-privacy.md` §5.3: every server entry point re-derives
 * `sub` from the verified JWT and never takes a uid from a body, query string or header.
 * That is why this function's only parameter is the `useActionState` previous value,
 * which it ignores — **there is no argument here for a caller to pass an identity into**,
 * which is a stronger guarantee than validating one would be.
 *
 * The owner check is the second half (§6.5): today "signed in" and "is the owner" are the
 * same set because the pool has one account, and they stop being the same set the day
 * D-014 adds friends. A Sync that had silently widened to "anyone the operator trusts
 * with their map" would be spending the operator's provider rate limit on someone else's
 * behalf.
 */
export async function syncNow(): Promise<SyncSummary> {
  const userId = await currentUserId()
  if (userId === undefined || !isOwner(userId)) {
    return { line: "Not signed in.", outcomes: [], failedCount: 0 }
  }

  const outcomes: SourceSyncOutcome[] = []

  for (const sourceId of registeredSources()) {
    /**
     * CRITERION 7. A missing or disconnected row is not a failure and must not read as
     * one, and `NEEDS_REAUTH` is a different sentence again — one asks the operator to
     * connect, the other tells them something they already had has broken.
     */
    const account = await getSourceAccountSummary(userId, sourceId)
    if (account === null || account.status === "DISCONNECTED") {
      outcomes.push({ sourceId, kind: "not-connected" })
      continue
    }
    if (account.status !== "ACTIVE") {
      outcomes.push({ sourceId, kind: "reconnect" })
      continue
    }

    outcomes.push(
      await syncSource(userId, sourceId, {
        adapter: getAdapter(sourceId),
        /**
         * CREDENTIALS NEVER LEAVE THE SERVER (criterion 3). This resolves to two
         * functions closing over the store; no token is returned from this action, and
         * none is in the value the client receives — which is a `SyncSummary` of counts
         * and one sentence.
         */
        credentials: oauthCredentialsFor({ userId, source: sourceId }),
        receipt: { ddb },
        readWatermark: () => readListSinceWatermark(userId, sourceId),
        advanceWatermark: (watermark) =>
          advanceListSinceWatermark({ userId, sourceId, watermark }),
        /**
         * `SendMessage` THROWS ON FAILURE, which is what `SyncDeps.enqueue` requires and
         * why this is a one-line wrapper rather than a client passed straight through:
         * the watermark rule's correctness rests on "this landed" being true.
         */
        enqueue: async (job) => {
          await sqs.send(
            new SendMessageCommand({ QueueUrl: queueUrl(), MessageBody: JSON.stringify(job) }),
          )
        },
      }),
    )
  }

  /**
   * READ AFTER THE SWEEP, NOT BEFORE (criterion 4). A failure the worker records while
   * this action is running should be reported by this press rather than the next one,
   * and more importantly a receipt this sweep just RE-ENQUEUED has had its failure
   * fields cleared at the score gate — reading first would report a failure that the
   * press the operator is waiting on has already sent for retry.
   *
   * IT IS NOT ALLOWED TO FAIL THE SWEEP. The activities are queued either way, and an
   * empty index is the common case; losing a real import's confirmation to a failed
   * report about a hypothetical one would be the wrong trade. The read error is logged
   * where the worker's are, and the line falls back to saying nothing about failures.
   */
  let failedCount = 0
  try {
    failedCount = (await listFailedReceipts(userId, { ddb })).length
  } catch (error) {
    log.error({
      at: "sync-action",
      outcome: "failed-receipt-query-failed",
      error: error instanceof Error ? error.name : "unknown error",
    })
  }

  return {
    line: syncResultLine(outcomes, (id) => getOAuthConnector(id).displayName, failedCount),
    outcomes,
    failedCount,
  }
}

/**
 * The `useActionState` shape. Separated from `syncNow` so the real function keeps a
 * signature that says what it does, and so nothing in the app can call it with a
 * hand-made "previous state" that means something.
 */
export async function syncNowAction(previous: SyncSummary | null): Promise<SyncSummary> {
  // The previous summary is deliberately discarded rather than merged. Each press is a
  // whole sweep whose result stands on its own, and carrying the last one forward would
  // let a stale "3 activities queued" survive a press that queued nothing.
  void previous
  return syncNow()
}
