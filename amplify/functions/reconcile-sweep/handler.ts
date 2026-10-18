import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import { modeOf, runReconcileSweep, type ReconcileResult } from "@/lib/sources/reconcile-sweep"

/**
 * The scheduled entry point. Ticket 0095. All of the behaviour is in
 * `lib/sources/reconcile-sweep.ts`, where it is tested without a Lambda.
 *
 * Two schedules invoke it: Amplify's six-hourly one with no payload, and the nightly one
 * (`amplify/backend.ts`) with `{ "mode": "nightly" }`. A hand invocation chooses either.
 *
 * Returns the counts, which carry no credential, so a manual invocation from the console or
 * the CLI shows what the sweep did.
 */

const sqs = new SQSClient({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

function queueUrl(): string {
  const url = process.env.INGEST_QUEUE_URL
  if (!url) throw new Error("INGEST_QUEUE_URL is not set; amplify/backend.ts adds it to this function")
  return url
}

export const handler = async (event: unknown): Promise<ReconcileResult> =>
  runReconcileSweep(modeOf(event), {
    receipt: { ddb },
    /** `SendMessage` throws when the message did not land, which `SyncDeps.enqueue` requires. */
    enqueue: async (job) => {
      await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl(), MessageBody: JSON.stringify(job) }))
    },
  })
