import { readFileSync } from "node:fs"

import { PutObjectCommand } from "@aws-sdk/client-s3"
import { TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { SourceRateLimitedError } from "@/src/adapters/errors"
import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { NormalizedIngest } from "@/src/domain/activity"
import { RawArchiveError } from "@/src/pipeline/archive"
import {
  archiveCompletedBy,
  INGEST_PHASES,
  processActivity,
  type IngestPhase,
  type ProcessDeps,
} from "@/src/pipeline/process-activity"

/**
 * Ticket 0042, criterion 4 — "a test asserts the ORDER, not just that each ran".
 *
 * That distinction is the whole design of this file. Six independent "was it called"
 * assertions pass just as happily on a handler that archives after it normalizes, which
 * is the D-101 violation 0039 exists to prevent, and on one that claims the receipt
 * before it fetches, which widens the window a crash leaves a `PROCESSING` row in. So
 * every dependency writes its name into ONE shared array and the assertion is on the
 * sequence.
 *
 * SOURCE-AGNOSTIC, like everything else in this directory (D-100). The stub adapter is
 * a made-up source; a test that reached for the real one would be asserting the
 * pipeline and an adapter at the same time and could not tell which had broken.
 */

const SOURCE = "gpslogger"
const BUCKET = "test-bucket"
const ACTIVITY_TABLE = "Activity-testapi-NONE"
const FIXTURE = readFileSync(new URL("./__fixtures__/verbatim-payload.json", import.meta.url))

const JOB: IngestJob = {
  ingestKey: "k-1",
  userId: "u-1",
  source: SOURCE,
  externalId: "9001",
  command: "ingest",
  startedAt: "2026-06-01T02:53:48.000Z",
  meta: null,
  enqueuedAt: "2026-09-06T09:00:00.000Z",
}

/**
 * Enough of an `Activity` for `persistActivity` to build a real item from. Not a full
 * fixture — `persist.test.ts` owns the row's shape, and duplicating it here would mean
 * two places to edit every time T3 gains a field.
 */
const INGEST = {
  activity: {
    activityId: "a-1",
    userId: "u-1",
    kind: "run",
    startedAt: "2026-09-06T03:00:00.000Z",
    startedAtLocal: "2026-09-05T21:00:00",
    timezone: "America/Denver",
    ingestedAt: "2026-09-06T09:00:02.000Z",
    sets: [],
  },
} as unknown as NormalizedIngest

interface Options {
  /** What the score gate answers. `claimed` by default. */
  claim?: { kind: "claimed" } | { kind: "duplicate"; attributes: Record<string, unknown> }
  fetchRaw?: () => Promise<never>
  archiveFails?: boolean
  /** No receipt row — `recordDelivery`'s condition fails. */
  noReceipt?: boolean
}

/**
 * One rig, one `calls` array. Everything the pipeline is allowed to touch is here, and
 * anything it is NOT allowed to touch throws rather than returning undefined — a step
 * run out of turn should announce itself, not be inferred later from a missing entry.
 */
function rig(options: Options = {}) {
  const calls: string[] = []
  let ticks = 0
  const clock = () => {
    ticks += 1
    return 1_000 + ticks * 10
  }

  const adapter = {
    id: SOURCE,
    accept: () => Promise.reject(new Error("accept is the webhook's phase, not the worker's")),
    async fetchRaw() {
      calls.push("fetch")
      if (options.fetchRaw) return options.fetchRaw()
      return { body: FIXTURE, contentType: "application/json", ext: "json", schemaHint: "x@1" }
    },
    normalize() {
      calls.push("normalize")
      return INGEST
    },
    listSince: () => {
      throw new Error("listSince belongs to the Sync action, not the worker")
    },
  } as unknown as SourceAdapter<{ token: string }>

  const conditionalFailure = Object.assign(new Error("conditional"), {
    name: "ConditionalCheckFailedException",
  })

  const deps: ProcessDeps<{ token: string }> = {
    adapter,
    clock,
    async credentials(job) {
      calls.push("credentials")
      expect(job).toBe(JOB)
      return { token: "t" }
    },
    archive: {
      bucket: BUCKET,
      now: () => new Date("2026-09-06T09:00:01.000Z"),
      s3: {
        async send(command: unknown) {
          if (command instanceof PutObjectCommand) {
            calls.push("archive")
            if (options.archiveFails) throw new Error("s3 is down")
            return { ETag: '"e"' }
          }
          // A HeadObject only happens on the already-archived path; not exercised here.
          return {}
        },
      } as never,
    },
    receipt: {
      async send(): Promise<never> {
        throw new Error("unreachable")
      },
    } as never,
    persist: {
      activityTable: ACTIVITY_TABLE,
      ddb: {
        async send(command: TransactWriteCommand) {
          calls.push("persist")
          expect(command).toBeInstanceOf(TransactWriteCommand)
          return {}
        },
      },
    },
  }

  /**
   * The receipt client sees TWO different `UpdateCommand`s and they must not be
   * conflated: `recordDelivery`'s `ADD attempts` and the score gate's `SET #status`.
   * Told apart by their update expression, which is the only thing that distinguishes
   * them at the wire level.
   */
  deps.receipt = {
    ddb: {
      async send(command: UpdateCommand) {
        const expression = String(command.input.UpdateExpression)
        if (expression.startsWith("ADD attempts")) {
          calls.push("recordDelivery")
          if (options.noReceipt) throw conditionalFailure
          return { Attributes: { attempts: 1 } }
        }
        calls.push("gate")
        const claim = options.claim ?? { kind: "claimed" }
        if (claim.kind === "claimed") return { Attributes: { attempts: 1 } }
        throw conditionalFailure
      },
    },
  } as never

  // The losing claim path READS the receipt after its condition fails. Layered on
  // afterwards so the happy path's client stays a single method.
  if (options.claim?.kind === "duplicate") {
    const attributes = options.claim.attributes
    deps.receipt = {
      ddb: {
        async send(command: { input: { UpdateExpression?: string } }) {
          const expression = command.input.UpdateExpression
          if (expression === undefined) {
            calls.push("readReceipt")
            return { Item: attributes }
          }
          if (expression.startsWith("ADD attempts")) {
            calls.push("recordDelivery")
            return { Attributes: { attempts: 2 } }
          }
          calls.push("gate")
          throw conditionalFailure
        },
      },
    } as never
  }

  return { deps, calls }
}

describe("the fixed order", () => {
  /**
   * CRITERION 4. Read this list top to bottom: it is `01-architecture.md` §4 steps 6-15
   * with the steps capability 07 has not built yet left out.
   *
   * `recordDelivery` leads because T8's `attempts` counts DELIVERIES, including the ones
   * that fail before they reach the gate — and because a message with no receipt row is
   * refused there, having spent nothing on the network.
   */
  it("runs credentials → fetch → archive → normalize → gate → persist", async () => {
    const { deps, calls } = rig()

    const result = await processActivity(JOB, deps)

    expect(calls).toEqual([
      "recordDelivery",
      "credentials",
      "fetch",
      "archive",
      "normalize",
      "gate",
      "persist",
    ])
    expect(result.outcome).toBe("persisted")
  })

  /**
   * The half of the ordering D-101 actually cares about, asserted here as well as in
   * `fetch-archive-normalize.test.ts`. Duplicated on purpose: that test protects the
   * function, this one protects the fact that the worker still calls it rather than
   * inlining three steps of its own.
   */
  it("never normalizes bytes it has not archived", async () => {
    const { deps, calls } = rig({ archiveFails: true })

    await expect(processActivity(JOB, deps)).rejects.toBeInstanceOf(RawArchiveError)

    expect(calls).toEqual(["recordDelivery", "credentials", "fetch", "archive"])
    expect(calls).not.toContain("normalize")
    expect(calls).not.toContain("persist")
  })

  /**
   * The score gate is claimed LAST, after the network work — §4 step 12. Getting this
   * backwards is tempting (why fetch if we are going to lose the claim?) and it is what
   * widens the window in which a killed invocation strands a `PROCESSING` receipt.
   */
  it("claims the receipt after the fetch, not before it", async () => {
    const { deps, calls } = rig()

    await processActivity(JOB, deps)

    expect(calls.indexOf("gate")).toBeGreaterThan(calls.indexOf("fetch"))
    expect(calls.indexOf("gate")).toBeLessThan(calls.indexOf("persist"))
  })

  /**
   * A message that never passed the accept gate is refused before it can cost an API
   * call against a rate limit shared with every other user of this app.
   */
  it("touches nothing when there is no receipt to count a delivery against", async () => {
    const { deps, calls } = rig({ noReceipt: true })

    await expect(processActivity(JOB, deps)).rejects.toThrow()

    expect(calls).toEqual(["recordDelivery"])
  })
})

describe("redelivery", () => {
  /** Layer 2's whole purpose: the second delivery of a finished activity writes nothing. */
  it("returns the winner's numbers and does not persist when the receipt is DONE", async () => {
    const { deps, calls } = rig({
      claim: {
        kind: "duplicate",
        attributes: { status: "DONE", xpAwarded: 240, newCellCount: 31 },
      },
    })

    const result = await processActivity(JOB, deps)

    expect(result).toEqual({ outcome: "already-done", xpAwarded: 240, newCellCount: 31 })
    expect(calls).not.toContain("persist")
  })

  /**
   * An unfinished winner is NOT success and NOT an exception. The caller decides — and
   * for an SQS consumer the answer is "be redelivered", which is why this is a value.
   */
  it("reports not-claimable while another invocation holds the claim", async () => {
    const { deps } = rig({
      claim: { kind: "duplicate", attributes: { status: "PROCESSING" } },
    })

    expect(await processActivity(JOB, deps)).toEqual({
      outcome: "not-claimable",
      status: "PROCESSING",
    })
  })

  /**
   * A STATUS THIS FUNCTION DOES NOT INTERPRET. The gate decides what is claimable, and
   * from 0044 `FAILED` is (D-209) — so what surfaces here is whatever the gate refused
   * on, reported as a disposition the handler turns into a redelivery.
   *
   * `claimForScoring` only ever reports FAILED now as its "cannot claim, cannot say why"
   * sentinel for a row that aged out mid-call, and this asserts the pipeline passes even
   * that through rather than guessing at it.
   */
  it("passes the gate's refusal through without interpreting the status", async () => {
    const { deps } = rig({ claim: { kind: "duplicate", attributes: { status: "FAILED" } } })

    expect(await processActivity(JOB, deps)).toEqual({
      outcome: "not-claimable",
      status: "FAILED",
    })
  })
})

describe("what the pipeline does with a source-side failure", () => {
  /**
   * IT DOES NOT INTERPRET IT. The rate-limit delay is the adapter's answer, read off the
   * provider's own headers, and the queue is what acts on it — so this function's only
   * correct behaviour is to let the typed error through with its `retryAfterMs` intact.
   * Swallowing it here, or converting it into a generic failure, is what would make §4's
   * "return the message to the queue with a delay" unimplementable one layer up.
   */
  it("lets a rate-limit error through untouched", async () => {
    const limited = new SourceRateLimitedError(SOURCE, "activity detail", 420_000)
    const { deps, calls } = rig({ fetchRaw: () => Promise.reject(limited) })

    await expect(processActivity(JOB, deps)).rejects.toBe(limited)

    expect(calls).toEqual(["recordDelivery", "credentials", "fetch"])
  })
})

describe("timings", () => {
  /**
   * Criterion 8. 0044 alarms on these, so what matters is that every phase reports a
   * number and that the total is not less than the parts — an `archiveMs` derived by
   * subtraction is the one that could go negative if the arithmetic were wrong.
   */
  it("reports a duration for every phase, and a total that covers them", async () => {
    const { deps } = rig()

    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected a persisted result")
    const t = result.timings

    for (const [phase, ms] of Object.entries(t)) {
      expect(ms, `${phase} should be a non-negative number`).toBeGreaterThanOrEqual(0)
    }
    expect(t.totalMs).toBeGreaterThanOrEqual(
      t.credentialsMs + t.fetchMs + t.archiveMs + t.normalizeMs + t.gateMs + t.persistMs,
    )
  })
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET 0044 — THE PHASE OBSERVER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The handler's failure log has to answer one question the exception itself cannot:
 * DID THE RAW BYTES REACH S3 BEFORE THIS BROKE? The ticket calls the answer load-bearing
 * — raw in S3 means the run is replayable forever from the archive (D-101); raw missing
 * means the only copy is on the source's servers, and a deletion there takes the run
 * with it. Those are different urgencies and the runbook branches on them.
 */
describe("onPhase (ticket 0044)", () => {
  const observed = async (options: Parameters<typeof rig>[0] = {}) => {
    const phases: IngestPhase[] = []
    const { deps } = rig(options)
    await processActivity(JOB, { ...deps, onPhase: (p) => phases.push(p) }).catch(() => {})
    return phases
  }

  /** The same order the `calls` array asserts, announced from inside rather than out. */
  it("announces every phase, in the order they run", async () => {
    expect(await observed()).toEqual([...INGEST_PHASES])
  })

  /**
   * THE ARCHIVE PHASE IS INFERRED FROM ITS NEIGHBOURS, because `fetchArchiveNormalize`
   * takes no instrumentation hook — deliberately, since every argument it grows is
   * another thing a future edit could reorder (D-101). So "archive" is announced once
   * the fetch has returned and the archive PUT is what happens next.
   */
  it("stops at the archive when the archive PUT is what failed", async () => {
    expect(await observed({ archiveFails: true })).toEqual(["credentials", "fetch", "archive"])
  })

  /** A failed fetch never reaches the archive, so nothing was written. */
  it("stops at the fetch when the source is what failed", async () => {
    const limited = new SourceRateLimitedError(SOURCE, "activity detail", 1000)
    expect(await observed({ fetchRaw: () => Promise.reject(limited) })).toEqual([
      "credentials",
      "fetch",
    ])
  })
})

describe("archiveCompletedBy", () => {
  /**
   * REACHING `normalize` IS THE PROOF, and it is proof rather than inference: the three
   * steps are one function and D-101 forbids normalizing bytes that have not been
   * archived, so the normalize phase cannot begin unless the PUT returned.
   */
  it("is true only from the normalize phase onward", () => {
    expect(archiveCompletedBy("credentials")).toBe(false)
    expect(archiveCompletedBy("fetch")).toBe(false)
    expect(archiveCompletedBy("archive")).toBe(false)
    expect(archiveCompletedBy("normalize")).toBe(true)
    expect(archiveCompletedBy("gate")).toBe(true)
    expect(archiveCompletedBy("persist")).toBe(true)
  })

  /**
   * NO PHASE AT ALL MEANS NO ARCHIVE. A failure before the first phase — a message with
   * no receipt row, so `recordDelivery` throws — has written nothing anywhere, and
   * defaulting to "archived" would send the runbook down the replay path for bytes that
   * are not there.
   */
  it("is false when nothing was announced", () => {
    expect(archiveCompletedBy(undefined)).toBe(false)
  })
})
