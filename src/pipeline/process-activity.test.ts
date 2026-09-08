import { readFileSync } from "node:fs"

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { BatchGetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { SourceRateLimitedError } from "@/src/adapters/errors"
import type { IngestJob, SourceAdapter } from "@/src/adapters/types"
import type { NormalizedIngest, Trace } from "@/src/domain/activity"
import { RawArchiveError } from "@/src/pipeline/archive"
import { loadRuleSet } from "@/src/rules/load"
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
const CELL_TABLE = "TestExploredCell"
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
function ingestOf(over: Options["ingest"] = {}): NormalizedIngest {
  return {
    activity: {
      activityId: "a-1",
      userId: "u-1",
      kind: over.kind ?? "run",
      hasTrace: over.hasTrace ?? false,
      source: { source: SOURCE },
      startedAt: "2026-09-06T03:00:00.000Z",
      startedAtLocal: "2026-09-05T21:00:00",
      timezone: "America/Denver",
      ingestedAt: "2026-09-06T09:00:02.000Z",
      sets: [],
    },
    trace: over.trace,
  } as unknown as NormalizedIngest
}

const INGEST = ingestOf()

interface Options {
  /** What the score gate answers. `claimed` by default. */
  claim?: { kind: "claimed" } | { kind: "duplicate"; attributes: Record<string, unknown> }
  fetchRaw?: () => Promise<never>
  archiveFails?: boolean
  /** No receipt row — `recordDelivery`'s condition fails. */
  noReceipt?: boolean
  /**
   * Ticket `0047`. Overrides on the normalized ingest, so one rig can produce a traceless
   * strength log, a run that reveals ground and a ride that must not.
   */
  ingest?: { kind?: string; hasTrace?: boolean; trace?: Trace }
  /** Ticket `0047`. Every cell write throws this, to prove the ordering holds under failure. */
  cellsFail?: Error
  /** `0049`. A failed blob PUT, to prove it happens above the transaction. */
  blobsFail?: Error
  /** `0051`. T1's table name, when a test wants the mirror to actually write. */
  profileTable?: string
  /** `0050`. Called with the `startedAt` a replay was marked from. */
  onReplayMark?: (at: string) => void
  /**
   * Ticket `0048`. What T6 already holds, as `cell -> lastRunAt`. A cell absent from this
   * map classifies `new`. Given as a function of the run's cells so a test can seed "every
   * cell is already known" without knowing which cells the fixture trace produces.
   */
  known?: (cells: string[]) => Record<string, string>
}

/** The real v1 ruleset, because D-189's answer must be the shipped one, not a stub's. */
const REGISTRY = loadRuleSet(1)

/**
 * A two-point trace near Point Nemo (D-199), long enough to qualify a handful of cells
 * and short enough that the assertions stay countable.
 */
const TRACE: Trace = {
  points: [
    { lat: -48.876, lng: -123.393, t: 0 },
    { lat: -48.8735, lng: -123.393, t: 90_000 },
  ],
  gaps: [],
  simplified: false,
  bbox: [-123.393, -48.876, -123.393, -48.8735],
  pointCount: 2,
}

/**
 * One rig, one `calls` array. Everything the pipeline is allowed to touch is here, and
 * anything it is NOT allowed to touch throws rather than returning undefined — a step
 * run out of turn should announce itself, not be inferred later from a missing entry.
 */
function rig(options: Options = {}) {
  const calls: string[] = []
  const cellWrites: UpdateCommand["input"][] = []
  const aggWrites: UpdateCommand["input"][] = []
  const blobPuts: string[] = []
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
      return options.ingest ? ingestOf(options.ingest) : INGEST
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
    /**
     * Ticket `0047`. Every conditional `UpdateItem` is captured, and the FIRST one pushes
     * `cells` — one entry, not 130, so the ordering assertion stays about the sequence of
     * phases rather than about how much ground the fixture happens to cover.
     */
    cells: {
      table: CELL_TABLE,
      concurrency: 1,
      sleep: async () => {},
      ddb: {
        async send(command: UpdateCommand | BatchGetCommand) {
          /**
           * `0048`. The read comes first and is announced separately, so the ordering
           * assertions can say READ-then-WRITE — which is §3.3's classify-then-write rule
           * at the level this file can see it.
           */
          if (command instanceof BatchGetCommand) {
            calls.push("cellsRead")
            const keys = (command.input.RequestItems?.[CELL_TABLE]?.Keys ?? []) as Array<{
              sk: string
            }>
            const known = options.known?.(keys.map((k) => k.sk)) ?? {}
            return {
              Responses: {
                [CELL_TABLE]: keys
                  .filter((k) => known[k.sk])
                  .map((k) => ({ sk: k.sk, lastRunAt: known[k.sk] })),
              },
            }
          }
          /**
           * `0049`. T6's item type B rides on the same client, and it must not be counted
           * as a cell write — the assertions below are about the 40-130 conditional cell
           * updates, and folding three aggregate rows into them would make every count
           * off by a number that varies with the fixture's geography.
           */
          if (String(command.input.Key?.pk).endsWith("#GEN")) {
            calls.push("replayMark")
            options.onReplayMark?.(
              String(
                (command.input.ExpressionAttributeValues as Record<string, string>)[":at"],
              ),
            )
            return {}
          }
          if (String(command.input.Key?.pk).includes("#AGG#")) {
            if (!aggWrites.length) calls.push("cellsAgg")
            aggWrites.push(command.input)
            if (options.cellsFail) throw options.cellsFail
            return {}
          }
          if (!cellWrites.length) calls.push("cells")
          cellWrites.push(command.input)
          if (options.cellsFail) throw options.cellsFail
          return {}
        },
      },
    },
    /**
     * `0049`. §2.10's regeneration, faked at the two seams it actually uses: a counter on
     * T6 and object storage. The GET always misses, so every test in this file publishes
     * generation 1 from an empty base — which is the bootstrap case and keeps the
     * assertions about ORDER rather than about merge arithmetic (that is
     * `explored-blob-store.test.ts`'s job).
     */
    blobs: {
      bucket: BUCKET,
      table: CELL_TABLE,
      /** `0051`. No T1 yet, so the mirror is a no-op — see `explored-mirror.ts`. */
      mirror: options.profileTable === undefined ? undefined : {
        table: options.profileTable,
        ddb: {
          async send() {
            calls.push("mirror")
            return {}
          },
        } as never,
      },
      now: () => new Date("2026-09-06T09:00:02.000Z"),
      ddb: {
        async send() {
          calls.push("generation")
          return { Attributes: { generation: 1 } }
        },
      } as never,
      s3: {
        async send(command: unknown) {
          if (command instanceof GetObjectCommand) {
            const e = new Error("no such key") as Error & { name: string }
            e.name = "NoSuchKey"
            throw e
          }
          if (!blobPuts.length) calls.push("blobs")
          blobPuts.push(String((command as PutObjectCommand).input.Key))
          if (options.blobsFail) throw options.blobsFail
          return { ETag: '"b"' }
        },
      } as never,
    },
    registry: REGISTRY,
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

  return { deps, calls, cellWrites, aggWrites, blobPuts }
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
      t.credentialsMs +
        t.fetchMs +
        t.archiveMs +
        t.normalizeMs +
        t.gateMs +
        t.cellsMs +
        t.persistMs,
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET `0047` — cells first, outside the transaction, and only when the rules say so.
 * I-10, D-144, D-189.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TRACED_RUN: Options["ingest"] = { kind: "run", hasTrace: true, trace: TRACE }

describe("cells are written BEFORE the transaction (I-10, D-144)", () => {
  it("puts the cell writes between the gate and persist, in that order", async () => {
    const { deps, calls } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, deps)

    expect(calls.indexOf("cells")).toBeGreaterThan(calls.indexOf("gate"))
    expect(calls.indexOf("cells")).toBeLessThan(calls.indexOf("persist"))
  })

  it("announces `cells` as its own phase, not folded into persist", async () => {
    const phases: IngestPhase[] = []
    const { deps } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, { ...deps, onPhase: (p) => phases.push(p) })
    expect(phases).toEqual([...INGEST_PHASES])
  })

  /**
   * THE FAULT INJECTION. `0047` criterion 7, amended — the original asked the recovery
   * path to "award XP", and there is no XP engine until capability 09.
   *
   * What IS assertable now is the property the criterion was protecting: the skew may only
   * ever be MAP AHEAD OF XP. So the failure is injected between the two writes and the
   * assertion is that the transaction never ran — no `Activity` row, no `DONE` receipt —
   * while whatever cells landed stay landed. Revealed-but-unscored self-heals on
   * redelivery; scored-but-unrevealed could only be repaired by re-fogging (D-020).
   */
  it("a cell-write failure leaves the transaction unrun, so XP never leads the map", async () => {
    const { deps, calls } = rig({ ingest: TRACED_RUN, cellsFail: new Error("dynamo is down") })

    await expect(processActivity(JOB, deps)).rejects.toThrow("dynamo is down")

    expect(calls).toContain("cells")
    expect(calls).not.toContain("persist")
  })

  it("and the reverse skew is impossible: persist cannot run first", async () => {
    // Stated as an ordering assertion rather than a comment, because the failure it
    // guards is invisible — a scored run whose ground was never revealed looks fine
    // until someone opens the map.
    const { deps, calls } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, deps)
    expect(calls.filter((c) => c === "cells" || c === "persist")).toEqual(["cells", "persist"])
  })

  it("reports what the writes did, and times them separately", async () => {
    const { deps } = rig({ ingest: TRACED_RUN })
    const result = await processActivity(JOB, deps)

    expect(result.outcome).toBe("persisted")
    if (result.outcome !== "persisted") return
    expect(result.cells).toEqual({ advanced: expect.any(Number), backfilled: 0, unchanged: 0 })
    expect(result.cells!.advanced).toBeGreaterThan(0)
    expect(result.timings.cellsMs).toBeGreaterThanOrEqual(0)
  })

  it("writes the real T6 update expression, keyed by res-6 parent", async () => {
    const { deps, cellWrites } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, deps)

    expect(cellWrites.length).toBeGreaterThan(0)
    for (const input of cellWrites) {
      expect(input.TableName).toBe(CELL_TABLE)
      expect(input.Key!.pk).toMatch(/^U#u-1#C#/)
      expect(input.ConditionExpression).toContain("lastRunAt < :at")
      // The cell's clock is the RUN's clock, never the ingest's.
      expect(input.ExpressionAttributeValues![":at"]).toBe("2026-09-06T03:00:00.000Z")
    }
  })
})

describe("revealsGround gates the whole projection (D-189)", () => {
  it("A TRACED RIDE WRITES NOT ONE CELL", async () => {
    const { deps, calls, cellWrites } = rig({
      ingest: { kind: "ride", hasTrace: true, trace: TRACE },
    })
    const result = await processActivity(JOB, deps)

    expect(cellWrites).toHaveLength(0)
    expect(calls).not.toContain("cells")
    // `null`, not an empty result: "the rules refused" and "every cell was a replay" are
    // different stories and the log line must be able to tell them apart.
    expect(result.outcome === "persisted" && result.cells).toBeNull()
  })

  it("and still persists the activity — the run happened, it just opened no map", async () => {
    const { deps, calls } = rig({ ingest: { kind: "ride", hasTrace: true, trace: TRACE } })
    await processActivity(JOB, deps)
    expect(calls).toContain("persist")
  })

  it("a traceless run reveals nothing either, with no branch of its own (05 §3.6)", async () => {
    // No trace ⇒ no projection ⇒ no cells. It also fails `revealsGround`, because
    // `requiresTrace` is what separates the outdoor row from the indoor one — so this
    // asserts the outcome, not which of the two reasons got there first.
    const { deps, cellWrites } = rig({ ingest: { kind: "run", hasTrace: false } })
    await processActivity(JOB, deps)
    expect(cellWrites).toHaveLength(0)
  })
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET `0048` — classify against pre-run state, then write, then store the award.
 * `05-fog-of-war.md` §3.2/§3.3/§3.6; D-120; I-12.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const LONG_AGO = "2024-01-01T00:00:00.000Z"
const RECENTLY = "2026-08-20T00:00:00.000Z"

describe("discovery classification, end to end", () => {
  it("reads BEFORE it writes — §3.3's classify-then-write, at the level this file sees", async () => {
    const { deps, calls } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, deps)

    expect(calls.indexOf("cellsRead")).toBeGreaterThan(calls.indexOf("gate"))
    expect(calls.indexOf("cellsRead")).toBeLessThan(calls.indexOf("cells"))
    expect(calls.indexOf("cells")).toBeLessThan(calls.indexOf("persist"))
  })

  it("a run over wholly new ground is all new, and every cell earns credit", async () => {
    const { deps, cellWrites } = rig({ ingest: TRACED_RUN })
    const result = await processActivity(JOB, deps)

    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.award.newCellCount).toBe(result.award.cellCount)
    expect(result.award.cooledCellCount).toBe(0)
    expect(result.award.discoveryCredits).toBe(result.award.cellCount)
    for (const input of cellWrites) {
      expect(input.ExpressionAttributeValues![":credit"]).toBe(1)
    }
  })

  it("a run over ground covered last month is all cooled, and earns nothing", async () => {
    const { deps, cellWrites } = rig({
      ingest: TRACED_RUN,
      known: (cells) => Object.fromEntries(cells.map((c) => [c, RECENTLY])),
    })
    const result = await processActivity(JOB, deps)

    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.award.cooledCellCount).toBe(result.award.cellCount)
    expect(result.award.newCellCount).toBe(0)
    expect(result.award.discoveryCredits).toBe(0)
    // The cells are still written — visitCount advances, discoveryCount does not.
    expect(cellWrites.length).toBeGreaterThan(0)
    for (const input of cellWrites) {
      expect(input.ExpressionAttributeValues![":credit"]).toBe(0)
    }
  })

  it("a run over ground last covered two years ago re-arms at half credit", async () => {
    const { deps } = rig({
      ingest: TRACED_RUN,
      known: (cells) => Object.fromEntries(cells.map((c) => [c, LONG_AGO])),
    })
    const result = await processActivity(JOB, deps)

    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.award.rearmedCellCount).toBe(result.award.cellCount)
    expect(result.award.discoveryCredits).toBe(result.award.cellCount * 0.5)
  })

  /**
   * The whole point of reading in one shot. If the read were interleaved with the writes,
   * the cells written early in this run would come back as `lastRunAt = now` and the rest
   * of the run would classify `cooled` — halving the credit of the runs the game exists to
   * reward, with nothing anywhere looking wrong.
   */
  it("later cells are NOT poisoned by the writes this same run performed", async () => {
    const { deps, calls } = rig({ ingest: TRACED_RUN })
    const result = await processActivity(JOB, deps)

    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.award.cooledCellCount).toBe(0)
    // Exactly one read, up front — not one per cell.
    expect(calls.filter((c) => c === "cellsRead")).toHaveLength(1)
  })

  /**
   * `0050` REPLACED `0048`'s THROW. §3.4's case is a backfill, a redelivered webhook or an old
   * GPX import — the first thing the section names — and failing the job sent it to the DLQ, so
   * the ground never reached the map at all. The activity now completes: its cells are written,
   * the undecidable ones earn ZERO, and the user is marked for a fold.
   *
   * The zero is what makes deferring safe. D-135 permits only additions, so the replay can
   * raise this and never lower a number the user has already seen.
   */
  it("an out-of-order activity completes, awards zero, and marks a replay (§3.4)", async () => {
    const future = "2027-01-01T00:00:00.000Z"
    const { deps, calls, cellWrites } = rig({
      ingest: TRACED_RUN,
      known: (cells) => Object.fromEntries(cells.map((c) => [c, future])),
    })

    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected persisted")

    // Every cell was undecidable, so every cell earned nothing.
    expect(result.award.deferredCellCount).toBe(result.award.cellCount)
    expect(result.award.newCellCount).toBe(0)
    expect(result.award.discoveryCredits).toBe(0)

    // The GROUND still landed — that is the half the DLQ used to lose.
    expect(cellWrites.length).toBeGreaterThan(0)
    expect(calls).toContain("persist")
    expect(calls).toContain("replayMark")
  })

  it("does not mark a replay when every cell was decidable", async () => {
    const { deps, calls } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, deps)
    expect(calls).not.toContain("replayMark")
  })

  it("marks the replay from the ACTIVITY's startedAt, never the clock (I-12)", async () => {
    const future = "2027-01-01T00:00:00.000Z"
    const marks: string[] = []
    const { deps } = rig({
      ingest: TRACED_RUN,
      known: (cells) => Object.fromEntries(cells.map((c) => [c, future])),
      onReplayMark: (at) => marks.push(at),
    })

    await processActivity(JOB, deps)
    expect(marks).toEqual([INGEST.activity.startedAt])
  })
})

describe("the award is stored, not recomputed (criterion 9, §3.2)", () => {
  it("lands on the T3 row inside the ingest transaction", async () => {
    const transactions: unknown[] = []
    const { deps } = rig({ ingest: TRACED_RUN })
    const inner = deps.persist.ddb.send.bind(deps.persist.ddb)
    deps.persist.ddb = {
      async send(command: TransactWriteCommand) {
        transactions.push(command.input.TransactItems)
        return inner(command)
      },
    }

    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected persisted")

    const items = transactions[0] as Array<{ Put?: { Item: Record<string, unknown> } }>
    const row = items.find((i) => i.Put)!.Put!.Item
    expect(row.cellCount).toBe(result.award.cellCount)
    expect(row.newCellCount).toBe(result.award.newCellCount)
    expect(row.rearmedCellCount).toBe(result.award.rearmedCellCount)
    expect(row.cooledCellCount).toBe(result.award.cooledCellCount)
    expect(row.fogAlgoVersion).toBe(result.award.algoVersion)
  })

  it("closes the receipt with the same newCellCount, so a duplicate need not reclassify", async () => {
    const transactions: unknown[] = []
    const { deps } = rig({ ingest: TRACED_RUN })
    const inner = deps.persist.ddb.send.bind(deps.persist.ddb)
    deps.persist.ddb = {
      async send(command: TransactWriteCommand) {
        transactions.push(command.input.TransactItems)
        return inner(command)
      },
    }

    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected persisted")

    const items = transactions[0] as Array<{
      Update?: { ExpressionAttributeValues?: Record<string, unknown> }
    }>
    const done = items.find((i) => i.Update)!.Update!
    expect(done.ExpressionAttributeValues![":newCellCount"]).toBe(result.award.newCellCount)
  })

  /**
   * The reason the award is stored at all. A second delivery returns the WINNER's numbers
   * off the receipt; reclassifying would give a different answer, because by now every one
   * of those cells is in the store and would come back cooled.
   */
  it("a duplicate returns the stored numbers and never touches the classifier", async () => {
    const { deps, calls } = rig({
      ingest: TRACED_RUN,
      claim: { kind: "duplicate", attributes: { status: "DONE", xpAwarded: 0, newCellCount: 41 } },
    })

    const result = await processActivity(JOB, deps)
    expect(result).toEqual({ outcome: "already-done", xpAwarded: 0, newCellCount: 41 })
    expect(calls).not.toContain("cellsRead")
    expect(calls).not.toContain("cells")
  })
})

describe("no cells still writes a record (§3.6)", () => {
  it("a ride's award is zeros, so the T3 row shape never varies", async () => {
    const { deps } = rig({ ingest: { kind: "ride", hasTrace: true, trace: TRACE } })
    const result = await processActivity(JOB, deps)

    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.cells).toBeNull()
    expect(result.award).toEqual({
      cellCount: 0,
      newCellCount: 0,
      rearmedCellCount: 0,
      cooledCellCount: 0,
      deferredCellCount: 0,
      discoveryCredits: 0,
      res: 10,
      algoVersion: 1,
    })
  })

  it("a traceless run's award is zeros too, and it is still persisted", async () => {
    const { deps, calls } = rig({ ingest: { kind: "run", hasTrace: false } })
    const result = await processActivity(JOB, deps)

    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.award.cellCount).toBe(0)
    expect(calls).toContain("persist")
    // Nothing to read, so nothing was read.
    expect(calls).not.toContain("cellsRead")
  })
})

describe("the publish phase (0049, 02 §2.10 and §6.4)", () => {
  /**
   * The ordering that makes a failure self-healing. Cells first (D-144), then the blobs,
   * then the transaction — so a crash anywhere above `persist` leaves the receipt
   * `PROCESSING` and a redelivery repeats the whole thing idempotently.
   */
  it("runs after the cell writes and before the transaction", async () => {
    const { deps, calls } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, deps)

    expect(calls.indexOf("cells")).toBeLessThan(calls.indexOf("blobs"))
    expect(calls.indexOf("blobs")).toBeLessThan(calls.indexOf("persist"))
  })

  it("publishes the four objects and commits with the manifest last", async () => {
    const { deps, blobPuts } = rig({ ingest: TRACED_RUN })
    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected persisted")

    expect(blobPuts).toEqual([
      // `0050`'s per-run cell record is written inside the `cells` phase, before the publish.
      "users/u-1/cells/a-1.bin",
      "users/u-1/explored/explored-r10.1.bin",
      "users/u-1/explored/explored-lastrun-r10.1.bin",
      "users/u-1/explored/explored-agg.1.json",
      "users/u-1/deltas/1.bin",
      "users/u-1/manifest.json",
    ])
    expect(result.blobs).toMatchObject({ generation: 1, previousGeneration: 0 })
    expect(result.blobs!.cellCount).toBe(result.award.cellCount)
  })

  it("times the phase separately from the cells and the transaction", async () => {
    const { deps } = rig({ ingest: TRACED_RUN })
    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.timings.blobsMs).toBeGreaterThan(0)
  })

  /**
   * Tickets `0069` and `0159` state this as an acceptance criterion of their own: a
   * traceless activity *"bumps no generation"*. It is not an optimisation — a bump makes
   * every cached client refetch a 300 KB blob byte-identical to the one it already holds.
   */
  it("a traceless activity publishes NOTHING and bumps no generation", async () => {
    const { deps, calls, blobPuts } = rig({ ingest: { kind: "run", hasTrace: false } })
    const result = await processActivity(JOB, deps)

    expect(blobPuts).toEqual([])
    expect(calls).not.toContain("generation")
    expect(calls).not.toContain("blobs")
    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.blobs).toBeNull()
  })

  /** D-189: a traced ride has real geometry and must reveal none of it, blob included. */
  it("an activity the rules refuse publishes nothing either", async () => {
    const { deps, calls, blobPuts } = rig({ ingest: { kind: "ride", hasTrace: true, trace: TRACE } })
    await processActivity(JOB, deps)
    expect(blobPuts).toEqual([])
    expect(calls).not.toContain("generation")
  })

  /**
   * The whole reason the phase sits where it does. A publish failure must not leave a
   * `DONE` receipt behind — the cells would be in T6 and in no blob, and every generation
   * after this one would inherit the hole until an AP-17 repair.
   */
  it("a failed publish throws before the transaction, leaving the receipt PROCESSING", async () => {
    const { deps, calls } = rig({ ingest: TRACED_RUN, blobsFail: new Error("s3 is down") })
    await expect(processActivity(JOB, deps)).rejects.toThrow("s3 is down")
    expect(calls).toContain("cells")
    expect(calls).not.toContain("persist")
  })

  it("writes T6's aggregate items, and only after the cells", async () => {
    const { deps, calls, aggWrites } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, deps)

    expect(aggWrites.length).toBeGreaterThan(0)
    expect(calls.indexOf("cells")).toBeLessThan(calls.indexOf("cellsAgg"))
    // Three levels, and `02` T6's own partition math says 1-2 res-6 parents for one run.
    const partitions = new Set(aggWrites.map((w) => String(w.Key!.pk)))
    expect(partitions).toEqual(
      new Set(["U#u-1#AGG#6", "U#u-1#AGG#7", "U#u-1#AGG#8"]),
    )
  })
})
