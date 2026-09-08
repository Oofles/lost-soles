import { beforeEach, describe, expect, it, vi } from "vitest"

import { NO_CELLS } from "@/src/domain/discovery"

import {
  SourceNeedsReauthError,
  SourceNotConnectedError,
  SourceRateLimitedError,
} from "@/src/adapters/errors"

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
/** Ticket 0044. Resolves to the row as written, which is what carries `attempts`. */
const recordFailure = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
  attempts: 3,
}))

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
/**
 * PARTIALLY MOCKED. `processActivity` is replaced because the point of this file is what
 * the handler does with an outcome, but `archiveCompletedBy` and `INGEST_PHASES` are the
 * REAL ones — they are pure functions over an ordered list, and a stub of them would be a
 * second, possibly wrong, statement of which phases come after the archive PUT. That
 * ordering is what criterion 3's `rawArchived` means.
 */
vi.mock("@/src/pipeline/process-activity", async () => ({
  ...(await vi.importActual<typeof import("@/src/pipeline/process-activity")>(
    "@/src/pipeline/process-activity",
  )),
  processActivity: runPipeline,
}))
vi.mock("@/src/pipeline/ingest-receipt", () => ({ recordFailure }))

process.env.ACTIVITY_TABLE = "Activity-test"
process.env.RAW_ARCHIVE_BUCKET = "bucket-test"
/** `0049`. The same physical bucket, under the name the delivery layer reads. */
process.env.USER_DATA_BUCKET = "bucket-test"
process.env.ACTIVITY_INGEST_QUEUE_URL = "https://sqs.test/queue"

const { handler } = await import("./handler")
const { ChangeMessageVisibilityCommand } = await import("@aws-sdk/client-sqs")

const event = (receiveCount = 1) => ({
  Records: [
    {
      messageId: "m-1",
      receiptHandle: "rh-1",
      attributes: { ApproximateReceiveCount: String(receiveCount) },
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

/** The JSON the handler wrote to `console.error`, parsed, or undefined if it wrote none. */
function errorLine(): Record<string, unknown> | undefined {
  const spy = vi.mocked(console.error)
  for (const call of [...spy.mock.calls].reverse()) {
    try {
      const parsed = JSON.parse(String(call[0])) as Record<string, unknown>
      if (parsed.at === "process-activity") return parsed
    } catch {
      /* not a JSON line — the handler writes others */
    }
  }
  return undefined
}

beforeEach(() => {
  sqsSend.mockClear()
  runPipeline.mockReset()
  recordFailure.mockClear()
  recordFailure.mockResolvedValue({ attempts: 3 })
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

/** The `console.warn` lines §3.6's guard emits, as rendered strings. */
const noCellWarnings = (): string[] =>
  vi
    .mocked(console.warn)
    .mock.calls.map((c) => String(c[0]))
    .filter((line) => line.includes("trace-yielded-no-cells"))

describe("what the handler does with the pipeline's four outcomes", () => {
  it("acks a persisted activity", async () => {
    runPipeline.mockResolvedValue({
      outcome: "persisted",
      activityId: "a-1",
      cells: { advanced: 4, backfilled: 0, unchanged: 0 },
      award: { ...NO_CELLS, cellCount: 4, newCellCount: 4 },
      blobs: null,
      rejects: null,
      timings: { credentialsMs: 1, fetchMs: 2, archiveMs: 3, normalizeMs: 4, gateMs: 5, cellsMs: 6, blobsMs: 7, persistMs: 8, totalMs: 21 },
    })

    await expect(handler(event())).resolves.toBeUndefined()
  })

  /**
   * §3.6's last bullet (ticket `0180`). Points went in, nothing came out — the one ingest
   * outcome that looks completely normal and is not. ONE warning, naming the counts.
   */
  it("warns once when a trace had points and yielded no cells", async () => {
    runPipeline.mockResolvedValue({
      outcome: "persisted",
      activityId: "a-1",
      cells: { advanced: 0, backfilled: 0, unchanged: 0 },
      award: NO_CELLS,
      blobs: null,
      rejects: { accuracy: 2000, duplicate: 0, nonFinite: 0, segments: 0 },
      timings: { credentialsMs: 1, fetchMs: 2, archiveMs: 3, normalizeMs: 4, gateMs: 5, cellsMs: 6, blobsMs: 0, persistMs: 8, totalMs: 21 },
    })

    await expect(handler(event())).resolves.toBeUndefined()
    // `log.warn` serialises through `lib/log.ts`'s redactor, so the spy sees one string.
    const warnings = noCellWarnings()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"activityId":"a-1"')
    expect(warnings[0]).toContain('"accuracy":2000')
    expect(warnings[0]).toContain('"segments":0')
  })

  /** A traceless activity is NOT a fault, and must not produce the warning. */
  it("does not warn for a treadmill run — there was nothing to project", async () => {
    runPipeline.mockResolvedValue({
      outcome: "persisted",
      activityId: "a-1",
      cells: null,
      award: NO_CELLS,
      blobs: null,
      rejects: null,
      timings: { credentialsMs: 1, fetchMs: 2, archiveMs: 3, normalizeMs: 4, gateMs: 5, cellsMs: 0, blobsMs: 0, persistMs: 8, totalMs: 21 },
    })

    await expect(handler(event())).resolves.toBeUndefined()
    expect(noCellWarnings()).toHaveLength(0)
  })

  /** A run with perfect GPS reports zeros and still does not warn. */
  it("does not warn when a projection ran and produced cells", async () => {
    runPipeline.mockResolvedValue({
      outcome: "persisted",
      activityId: "a-1",
      cells: { advanced: 9, backfilled: 0, unchanged: 0 },
      award: { ...NO_CELLS, cellCount: 9, newCellCount: 9 },
      blobs: null,
      rejects: { accuracy: 0, duplicate: 0, nonFinite: 0, segments: 1 },
      timings: { credentialsMs: 1, fetchMs: 2, archiveMs: 3, normalizeMs: 4, gateMs: 5, cellsMs: 6, blobsMs: 7, persistMs: 8, totalMs: 21 },
    })

    await expect(handler(event())).resolves.toBeUndefined()
    expect(noCellWarnings()).toHaveLength(0)
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET 0044 — WHICH FAILURES ARE TERMINAL, AND WHAT THEY LEAVE BEHIND
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 0042's note left this decision open on purpose: `markFailed` had no caller anywhere,
 * because every terminal source-side failure happens before the score gate and its
 * `PROCESSING` guard would have no-opped. What replaces it has to decide deliberately
 * WHICH failures are terminal rather than marking all of them — and the cost of getting
 * it wrong in either direction is a lie on the Sync screen.
 */
describe("criterion 2 — terminal failures write FAILED, and only terminal ones", () => {
  /**
   * A DEAD CREDENTIAL IS TERMINAL ON THE FIRST DELIVERY. No retry can repair it; a human
   * has to re-authorize. Waiting three deliveries to say so is up to ~48 minutes of
   * visibility timeouts during which the screen says nothing is wrong.
   */
  it("records a dead credential immediately, on delivery one", async () => {
    runPipeline.mockRejectedValue(new SourceNeedsReauthError("test-source", "two 401s"))

    await expect(handler(event(1))).rejects.toBeInstanceOf(SourceNeedsReauthError)

    expect(recordFailure).toHaveBeenCalledTimes(1)
    expect(recordFailure.mock.calls[0][0]).toBe("k-1")
    expect(recordFailure.mock.calls[0][1]).toMatchObject({
      userId: "u-1",
      errorClass: "SourceNeedsReauthError",
    })
  })

  /** The other half of the same rule: never connected is as unretryable as revoked. */
  it("records a connection that is not there at all", async () => {
    runPipeline.mockRejectedValue(new SourceNotConnectedError("test-source"))

    await expect(handler(event(1))).rejects.toBeInstanceOf(SourceNotConnectedError)

    expect(recordFailure).toHaveBeenCalledTimes(1)
  })

  /**
   * A TRANSIENT FAULT ON AN EARLY DELIVERY IS NOT TERMINAL, and this is the assertion
   * that keeps the Sync line honest. Recording it would report a failure that the queue
   * is about to retry successfully — true for ninety seconds and then a lie.
   */
  it("leaves an early transient failure unrecorded", async () => {
    runPipeline.mockRejectedValue(new Error("ECONNRESET"))

    await expect(handler(event(1))).rejects.toThrow("ECONNRESET")

    expect(recordFailure).not.toHaveBeenCalled()
  })

  /**
   * THE LAST DELIVERY IS TERMINAL WHATEVER FAILED. `maxReceiveCount` is 3, so a message
   * failing its third receive is about to reach the DLQ — and a failure nobody records
   * on its way there is the silence this ticket exists to end.
   */
  it("records anything that fails on the last delivery the queue allows", async () => {
    runPipeline.mockRejectedValue(new Error("ECONNRESET"))

    await expect(handler(event(3))).rejects.toThrow("ECONNRESET")

    expect(recordFailure).toHaveBeenCalledTimes(1)
    expect(recordFailure.mock.calls[0][1]).toMatchObject({ errorClass: "Error" })
  })

  /**
   * NOT ON A CLAIM SOMEONE ELSE HOLDS. `not-claimable` means another invocation is
   * mid-import; `recordFailure` is guarded on `<> DONE`, so marking here would stamp
   * FAILED over a working import and report it to the operator while it succeeded.
   */
  it("never records a failure for a receipt another invocation is holding", async () => {
    runPipeline.mockResolvedValue({ outcome: "not-claimable", status: "PROCESSING" })

    await expect(handler(event(3))).rejects.toThrow(/may not claim/)

    expect(recordFailure).not.toHaveBeenCalled()
  })

  /**
   * A 429 IS A SCHEDULE, NOT A FAILURE. Rule 3 extends the visibility and rethrows above
   * this decision, so the message comes back later rather than being reported broken.
   */
  it("never records a rate limit, even on the last delivery", async () => {
    runPipeline.mockRejectedValue(new SourceRateLimitedError("test-source", "streams", 1000))

    await expect(handler(event(3))).rejects.toBeInstanceOf(SourceRateLimitedError)

    expect(recordFailure).not.toHaveBeenCalled()
  })

  /**
   * THE RECEIPT WRITE MUST NOT MASK THE ORIGINAL ERROR. What a human needs is the failure
   * that got us here; a DynamoDB fault while recording it is a second problem, not a
   * replacement for the first.
   */
  it("still throws the original error when the receipt write itself fails", async () => {
    runPipeline.mockRejectedValue(new SourceNeedsReauthError("test-source", "two 401s"))
    recordFailure.mockRejectedValue(new Error("ProvisionedThroughputExceeded"))

    await expect(handler(event(1))).rejects.toBeInstanceOf(SourceNeedsReauthError)
  })
})

describe("criterion 3 — one structured line per terminal failure", () => {
  /**
   * Every field the ticket lists, because the runbook reads this line and nothing else:
   * `userId`, `source`, `externalId`, `activityId`, `attempts`, the error class, and
   * whether the raw archive succeeded.
   */
  it("carries every field the runbook needs", async () => {
    runPipeline.mockRejectedValue(new SourceNeedsReauthError("test-source", "two 401s"))

    await expect(handler(event(1))).rejects.toThrow()

    expect(errorLine()).toMatchObject({
      event: "ingest-failed",
      terminal: true,
      outcome: "needs-reauth",
      userId: "u-1",
      source: "test-source",
      externalId: "9001",
      ingestKey: "k-1",
      errorClass: "SourceNeedsReauthError",
      attempts: 3,
      rawArchived: false,
    })
    /** Deterministic from (user, source, external id) by I-5 — never a fresh id. */
    expect(errorLine()?.activityId).toEqual(expect.any(String))
  })

  /**
   * `rawArchived` IS THE FIELD THE RUNBOOK BRANCHES ON, and the ticket calls it
   * load-bearing: raw in S3 means the run is replayable forever from the archive (D-101),
   * raw missing means the only copy is still on the source's servers and a deletion there
   * takes the run with it. The pipeline never reached a phase here, so it is false.
   */
  it("reports the archive as not written when the pipeline never got there", async () => {
    runPipeline.mockRejectedValue(new Error("boom"))

    await expect(handler(event(3))).rejects.toThrow()

    expect(errorLine()).toMatchObject({ rawArchived: false, phase: "none" })
  })

  /**
   * NEVER A MESSAGE, NEVER A STACK — a class name and nothing else (criterion 2). A
   * provider's error message routinely echoes the request that produced it, which on a
   * token endpoint means the client secret (O-005, `08-security-privacy.md` §7.4).
   */
  it("logs an error class, not the error's message", async () => {
    runPipeline.mockRejectedValue(new Error("Bearer sk-secret-value-in-the-message"))

    await expect(handler(event(3))).rejects.toThrow()

    expect(JSON.stringify(errorLine())).not.toContain("sk-secret-value")
    expect(errorLine()?.errorClass).toBe("Error")
  })

  /**
   * A NON-TERMINAL FAILURE IS STILL LOGGED, under a different event name so a Logs
   * Insights filter on `ingest-failed` returns the failures that actually stuck. An
   * early blip is worth reading and is not worth alarming on.
   */
  it("distinguishes an attempt that failed from a failure that stuck", async () => {
    runPipeline.mockRejectedValue(new Error("ECONNRESET"))

    await expect(handler(event(1))).rejects.toThrow()

    expect(errorLine()).toMatchObject({ event: "ingest-attempt-failed", terminal: false })
  })

  /**
   * A FAILURE THAT COULD NOT BE RECORDED IS MORE WORTH READING, not less — the receipt
   * is the thing the Sync screen reads, so its absence means this failure will be
   * invisible everywhere except here.
   */
  it("says so when the receipt could not be marked", async () => {
    runPipeline.mockRejectedValue(new Error("boom"))
    recordFailure.mockResolvedValue(undefined)

    await expect(handler(event(3))).rejects.toThrow()

    expect(errorLine()).toMatchObject({ terminal: true, failureRecorded: false })
  })
})
