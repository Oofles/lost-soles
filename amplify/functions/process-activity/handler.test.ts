import { beforeEach, describe, expect, it, vi } from "vitest"

import { SourceNeedsReauthError, SourceRateLimitedError } from "@/src/adapters/errors"

/**
 * Ticket 0042, criteria 6 and 7 — the two failure rules that live in the HANDLER rather
 * than in the pipeline, because both are statements about a queue.
 *
 * `01-architecture.md` §4 "Failure handling" is the specification and the ticket says
 * plainly: do not invent different ones. What is asserted here is exactly those two
 * sentences and nothing more:
 *
 *   - "429 (rate limit) → return the message to the queue with a delay"
 *   - "401 → refresh once, retry once, then fail to the DLQ. Do not loop."
 *
 * The refresh-once-retry-once half of the second one is the adapter client's and is
 * covered by `strava/client.test.ts`. What this file owes it is the other half: by the
 * time the worker sees it, the connection is already marked and the ONLY correct thing
 * left to do is throw, so the message is redelivered and, after three receives, the DLQ.
 *
 * SOURCE-AGNOSTIC. `check-boundaries.mjs` scans `amplify/` too, and the handler is
 * written to a source-agnostic error type precisely so neither file has to name a vendor.
 */

/**
 * Typed on the ARGUMENT, so `mock.calls` is a tuple with an element at 0 — otherwise the
 * commands this test exists to inspect are unreachable through the type system.
 */
const sqsSend = vi.fn<(command: unknown) => Promise<object>>(async () => ({}))
const runPipeline = vi.fn()

vi.mock("@aws-sdk/client-sqs", async () => {
  const actual = await vi.importActual<typeof import("@aws-sdk/client-sqs")>(
    "@aws-sdk/client-sqs",
  )
  return { ...actual, SQSClient: class { send = sqsSend } }
})
vi.mock("@aws-sdk/client-s3", () => ({ S3Client: class {} }))
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }))
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({}) },
}))
vi.mock("@/src/adapters/registry", () => ({ getAdapter: () => ({ id: "test-source" }) }))
vi.mock("@/lib/sources/adapter-credentials", () => ({ oauthCredentialsFor: () => ({}) }))
vi.mock("@/src/pipeline/process-activity", () => ({ processActivity: runPipeline }))

process.env.ACTIVITY_TABLE = "Activity-test"
process.env.RAW_ARCHIVE_BUCKET = "bucket-test"
process.env.ACTIVITY_INGEST_QUEUE_URL = "https://sqs.test/queue"

const { handler } = await import("./handler")
const { ChangeMessageVisibilityCommand } = await import("@aws-sdk/client-sqs")

const event = () => ({
  Records: [
    {
      messageId: "m-1",
      receiptHandle: "rh-1",
      body: JSON.stringify({
        ingestKey: "k-1",
        userId: "u-1",
        source: "test-source",
        externalId: "9001",
        command: "ingest",
        meta: null,
        enqueuedAt: "2026-09-06T09:00:00.000Z",
      }),
    },
  ],
})

/** The visibility timeout the handler asked SQS for, or undefined if it never asked. */
function requestedVisibility(): number | undefined {
  const command = sqsSend.mock.calls
    .map((c) => c[0])
    .find((c): c is InstanceType<typeof ChangeMessageVisibilityCommand> =>
      c instanceof ChangeMessageVisibilityCommand,
    )
  return command?.input.VisibilityTimeout
}

beforeEach(() => {
  sqsSend.mockClear()
  runPipeline.mockReset()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("criterion 7 — a rate limit returns the message with a delay", () => {
  it("extends the message's visibility to the window the adapter named", async () => {
    runPipeline.mockRejectedValue(
      new SourceRateLimitedError("test-source", "activity detail", 7 * 60 * 1000),
    )

    await expect(handler(event())).rejects.toBeInstanceOf(SourceRateLimitedError)

    expect(requestedVisibility()).toBe(420)
  })

  /**
   * A 429 on the DAILY bucket asks to wait until 00:00 UTC — up to 24 hours — and SQS
   * caps a visibility timeout at 12. Clamped rather than rejected: the message comes
   * back early, is refused again, and the retry budget is what makes it terminate. An
   * unclamped value is an `InvalidParameterValue` from SQS, which would swap a delayed
   * retry for an immediate one at the worst possible moment.
   */
  it("clamps a delay longer than SQS allows", async () => {
    runPipeline.mockRejectedValue(
      new SourceRateLimitedError("test-source", "activity detail", 24 * 60 * 60 * 1000),
    )

    await expect(handler(event())).rejects.toBeInstanceOf(SourceRateLimitedError)

    expect(requestedVisibility()).toBe(12 * 60 * 60)
  })

  /**
   * IT STILL THROWS. Extending the visibility does not delete the message, and returning
   * normally would — an SQS event source treats a clean return as "handled". A 429 that
   * acked would be a silently dropped activity on a map that cannot re-fog.
   */
  it("does not swallow the error after delaying", async () => {
    runPipeline.mockRejectedValue(new SourceRateLimitedError("test-source", "streams", 1000))

    await expect(handler(event())).rejects.toThrow()
  })
})

describe("criterion 6 — a dead credential fails to the DLQ without looping", () => {
  /**
   * No delay, no retry-in-place, no second refresh. The adapter already refreshed once
   * and retried once; by here the connection is marked `NEEDS_REAUTH` and every later
   * delivery refuses at the credential store before any HTTP happens. Throwing is what
   * spends the remaining two receives cheaply and lands the message in the DLQ.
   */
  it("rethrows without extending the visibility", async () => {
    runPipeline.mockRejectedValue(new SourceNeedsReauthError("test-source", "two 401s"))

    await expect(handler(event())).rejects.toBeInstanceOf(SourceNeedsReauthError)

    expect(requestedVisibility()).toBeUndefined()
  })
})

describe("what the handler does with the pipeline's four outcomes", () => {
  it("acks a persisted activity", async () => {
    runPipeline.mockResolvedValue({
      outcome: "persisted",
      activityId: "a-1",
      timings: { credentialsMs: 1, fetchMs: 2, archiveMs: 3, normalizeMs: 4, gateMs: 5, persistMs: 6, totalMs: 21 },
    })

    await expect(handler(event())).resolves.toBeUndefined()
  })

  /** The replay no-op. A duplicate that finds a finished winner is a SUCCESS. */
  it("acks a redelivery whose work is already done", async () => {
    runPipeline.mockResolvedValue({ outcome: "already-done", xpAwarded: 240, newCellCount: 31 })

    await expect(handler(event())).resolves.toBeUndefined()
  })

  /**
   * NOT an ack. A receipt someone else holds, or one a previous delivery failed, means
   * this delivery did no work — and an SQS event source deletes anything the handler
   * returns from. Throwing is the only way to be redelivered.
   */
  it("throws on a receipt it could not claim, so the message comes back", async () => {
    runPipeline.mockResolvedValue({ outcome: "not-claimable", status: "PROCESSING" })

    await expect(handler(event())).rejects.toThrow(/may not claim/)
  })
})

describe("the environment it cannot run without", () => {
  it("names the missing variable rather than failing on an undefined", async () => {
    const saved = process.env.RAW_ARCHIVE_BUCKET
    delete process.env.RAW_ARCHIVE_BUCKET

    // It fails while ASSEMBLING the deps, before the pipeline is entered at all — which
    // is the point of reading at use rather than at module load: an import-time throw
    // would surface as an initialization error whose stack points at nothing useful.
    await expect(handler(event())).rejects.toThrow(/RAW_ARCHIVE_BUCKET is not set/)
    expect(runPipeline).not.toHaveBeenCalled()

    process.env.RAW_ARCHIVE_BUCKET = saved
  })
})
