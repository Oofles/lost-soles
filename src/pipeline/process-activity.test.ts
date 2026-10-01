import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import { SourceRateLimitedError } from "@/src/adapters/errors"
import type { IngestJob } from "@/src/adapters/types"
import type { Trace } from "@/src/domain/activity"
import { RES } from "@/src/domain/fog"
import { RawArchiveError } from "@/src/pipeline/archive"
import {
  ACTIVITY_TABLE,
  BUCKET,
  CELL_TABLE,
  FIXTURE,
  INGEST,
  JOB,
  LEDGER_TABLE,
  PROFILE_TABLE,
  REGISTRY,
  SKILL_STATE_TABLE,
  SOURCE,
  TRACE,
  rig,
  type Options,
} from "@/src/pipeline/__fixtures__/process-rig"
import {
  archiveCompletedBy,
  INGEST_PHASES,
  processActivity,
  type IngestPhase,
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


describe("step 3 — the cross-source dedupe lookup (0179, I-22)", () => {
  /** The same run, recorded by another source: 40 s later, 25 s longer, no distance on either. */
  const OTHER_SOURCE_ROW = { id: "a-other-source", startedAt: "2026-09-06T03:00:40.000Z", elapsedS: 1825 }

  it("drops a duplicate before the gate: no cells, no blobs, no transaction, no claim", async () => {
    const r = rig({ dedupeRows: [OTHER_SOURCE_ROW], ingest: { hasTrace: true, trace: TRACE } })
    const result = await processActivity(JOB, r.deps)

    expect(result).toEqual({
      outcome: "duplicate",
      activityId: "a-1",
      duplicateOf: "a-other-source",
      pointer: "raw/u-1/gpslogger/9001.duplicate-of.json",
    })
    // Pointer before receipt — see the comment above the step.
    expect(r.calls).toEqual(["recordDelivery", "credentials", "fetch", "archive", "normalize", "pointer", "recordDuplicate"])
    expect(r.cellWrites).toHaveLength(0)
    expect(r.blobPuts).toHaveLength(0)
    expect(r.transacts).toHaveLength(0)
  })

  it("marks the receipt DONE with zero awards and duplicateOf — never FAILED", async () => {
    const r = rig({ dedupeRows: [OTHER_SOURCE_ROW] })
    await processActivity(JOB, r.deps)
    const write = r.receiptWrites.find((w) => String(w.UpdateExpression).includes("duplicateOf"))!
    expect(write.ExpressionAttributeValues).toMatchObject({ ":done": "DONE", ":zero": 0, ":winner": "a-other-source" })
    expect(String(write.UpdateExpression)).toMatch(/^SET #status = :done,/)
    expect(String(write.ConditionExpression)).toMatch(/processingStartedAt < :stale/)
  })

  it("writes the pointer BESIDE the archive prefix, never inside it where replay would read it", async () => {
    const r = rig({ dedupeRows: [OTHER_SOURCE_ROW] })
    await processActivity(JOB, r.deps)
    const [put] = r.pointerPuts
    expect(put!.Key).not.toMatch(/^raw\/u-1\/gpslogger\/9001\//)
    expect(put!.IfNoneMatch).toBe("*")
    expect(JSON.parse(String(put!.Body))).toMatchObject({ duplicateOf: "a-other-source", activityId: "a-1" })
  })

  it("queries GSI2, then reads only the three compared fields", async () => {
    const r = rig({ dedupeRows: [OTHER_SOURCE_ROW] })
    await processActivity(JOB, r.deps)
    expect(r.dedupeReads[0]).toMatchObject({ TableName: ACTIVITY_TABLE, IndexName: "byUserAndDedupe" })
    expect(r.dedupeReads[1]).toMatchObject({ Key: { id: "a-other-source" }, ProjectionExpression: "startedAt, elapsedS, distanceM" })
  })

  it("does not count its own row — a reingest or redelivery must still score", async () => {
    const r = rig({ dedupeRows: [{ id: "a-1", startedAt: "2026-09-06T03:00:00.000Z", elapsedS: 1800 }] })
    const result = await processActivity(JOB, r.deps)
    expect(result.outcome).toBe("persisted")
    expect(r.pointerPuts).toHaveLength(0)
  })

  it("keeps a different run that merely shares the anchor bucket", async () => {
    // Twelve minutes apart: same 30-minute anchor, outside the 5-minute tolerance.
    const r = rig({ dedupeRows: [{ id: "a-other", startedAt: "2026-09-06T03:12:00.000Z", elapsedS: 1800 }] })
    expect((await processActivity(JOB, r.deps)).outcome).toBe("persisted")
  })

  it("leaves the receipt claimable when the pointer cannot be written", async () => {
    const r = rig({ dedupeRows: [OTHER_SOURCE_ROW], pointerFails: new Error("s3 is down") })
    await expect(processActivity(JOB, r.deps)).rejects.toThrow("s3 is down")
    expect(r.calls).not.toContain("recordDuplicate")
  })
})

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
    expect(result.cells).toEqual({
      advanced: expect.any(Number),
      backfilled: 0,
      unchanged: 0,
      contested: 0,
    })
    expect(result.cells!.advanced).toBeGreaterThan(0)
    expect(result.timings.cellsMs).toBeGreaterThanOrEqual(0)
  })

  it("writes the real T6 update expression, keyed by the res-7 parent", async () => {
    const { deps, cellWrites } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, deps)

    expect(cellWrites.length).toBeGreaterThan(0)
    for (const input of cellWrites) {
      expect(input.TableName).toBe(CELL_TABLE)
      expect(input.Key!.pk).toMatch(/^U#u-1#C#/)
      // Every cell of a first run is `new`, so every write is D-268's claim on absence.
      expect(input.ConditionExpression).toBe("attribute_not_exists(lastRunAt)")
      // The cell's clock is the RUN's clock, never the ingest's.
      expect(input.ExpressionAttributeValues![":at"]).toBe("2026-09-06T03:00:00.000Z")
    }
  })
})

describe("reingest — the replay verb, ticket 0192", () => {
  const REPLAY_JOB: IngestJob = { ...JOB, command: "reingest" }

  /**
   * The archive stub. `readArchivedRaw` lists the activity's prefix and gets the newest object, so
   * the two commands are told apart the same way `rig` tells the two receipt updates apart.
   */
  function archiveS3(body = FIXTURE) {
    const gets: string[] = []
    return {
      gets,
      deps: {
        bucket: BUCKET,
        s3: {
          async send(command: unknown) {
            if (command instanceof ListObjectsV2Command) {
              return {
                Contents: [
                  { Key: "raw/u-1/gpslogger/9001/abc.json", LastModified: new Date("2026-09-06") },
                ],
              }
            }
            gets.push((command as GetObjectCommand).input.Key!)
            return {
              Body: { transformToByteArray: async () => new Uint8Array(body) },
              ContentType: "application/json",
              Metadata: { schemahint: "x@1" },
            }
          },
        },
      },
    }
  }

  /**
   * THE ASSERTION THE WHOLE TICKET TURNS ON. A source can return different bytes for the same
   * activity — a new privacy zone, a re-uploaded file — and ground revealed from bytes the original
   * ingest never saw is permanent (D-020). A replay reads the archive or it does not run.
   */
  it("reads the archive and never calls the source", async () => {
    const archive = archiveS3()
    const { deps, calls } = rig({ ingest: TRACED_RUN })
    const result = await processActivity(REPLAY_JOB, { ...deps, replay: archive.deps as never })

    expect(result.outcome).toBe("persisted")
    expect(calls).not.toContain("fetch")
    expect(archive.gets).toEqual(["raw/u-1/gpslogger/9001/abc.json"])
    // And the SHIPPED normalizer still runs on those bytes — one wire-format implementation.
    expect(calls).toContain("normalize")
  })

  it("refuses to run at all without replay deps, rather than falling back to the source", async () => {
    const { deps, calls } = rig({ ingest: TRACED_RUN })
    await expect(processActivity(REPLAY_JOB, deps)).rejects.toThrow(/D-020|different bytes/)
    // Nothing was touched — not even the delivery counter. A misconfigured worker must not
    // half-process a replay.
    expect(calls).toEqual([])
  })

  it("relaxes the score gate so a DONE receipt can be re-claimed", async () => {
    const archive = archiveS3()
    const conditions: string[] = []
    const { deps } = rig({ ingest: TRACED_RUN })
    const receipt = {
      ddb: {
        async send(command: UpdateCommand) {
          const expression = String(command.input.UpdateExpression)
          if (expression.startsWith("ADD attempts")) return { Attributes: { attempts: 2 } }
          conditions.push(String(command.input.ConditionExpression))
          return { Attributes: { attempts: 2 } }
        },
      },
    } as never

    await processActivity(REPLAY_JOB, { ...deps, receipt, replay: archive.deps as never })
    expect(conditions).toHaveLength(1)
    expect(conditions[0]).toContain("#status = :done")
  })

  it("leaves an ordinary job on the network and on the unrelaxed gate", async () => {
    const archive = archiveS3()
    const conditions: string[] = []
    const { deps, calls } = rig({ ingest: TRACED_RUN })
    const receipt = {
      ddb: {
        async send(command: UpdateCommand) {
          const expression = String(command.input.UpdateExpression)
          if (expression.startsWith("ADD attempts")) return { Attributes: { attempts: 1 } }
          conditions.push(String(command.input.ConditionExpression))
          return { Attributes: { attempts: 1 } }
        },
      },
    } as never

    // Replay deps PRESENT and deliberately unused: the verb is on the job, not on the config.
    await processActivity(JOB, { ...deps, receipt, replay: archive.deps as never })
    expect(calls).toContain("fetch")
    expect(archive.gets).toEqual([])
    expect(conditions[0]).not.toContain(":done")
  })

  /**
   * CRITERION 3 — IDEMPOTENCE, and it is layer 4 rather than the receipt that provides it.
   * `ingest-receipt.ts`: *"`delta = newCells \ explored` is empty on a replay, so a re-run awards
   * nothing even if layers 1-3 all failed."* Seeded here with every cell already known at a LATER
   * timestamp than the run, which is the state a second replay finds.
   */
  it("a second replay reveals nothing new and cannot move firstRunAt later", async () => {
    const archive = archiveS3()
    const { deps, cellWrites } = rig({
      ingest: TRACED_RUN,
      known: (cells) => Object.fromEntries(cells.map((c) => [c, "2027-01-01T00:00:00.000Z"])),
    })
    const result = await processActivity(REPLAY_JOB, { ...deps, replay: archive.deps as never })

    if (result.outcome !== "persisted") throw new Error("expected persisted")

    // NOTHING IS NEWLY DISCOVERED THE SECOND TIME ROUND, and this is layer 4 in one assertion:
    // every cell was already explored, so the discovery delta is empty and the award is zero.
    // `advanced`/`unchanged` are about the T6 write, which still happens — visitCount advances
    // on a replay and that is correct. What must not repeat is the CREDIT.
    expect(result.award.newCellCount).toBe(0)
    expect(result.award.discoveryCredits).toBe(0)
    for (const input of cellWrites) {
      expect(input.ExpressionAttributeValues![":credit"]).toBe(0)
    }

    for (const input of cellWrites) {
      // `min` on firstRunAt is what makes a replay unable to push a first visit later, and the
      // clock is the RUN's, never the replay's — scoring uses activity.startedAt, never now().
      expect(String(input.UpdateExpression)).toContain("firstRunAt")
      expect(input.ExpressionAttributeValues![":at"]).toBe("2026-09-06T03:00:00.000Z")
    }
  })

  it("scores on the activity's own clock, so a replay years later reveals the same ground", async () => {
    const archive = archiveS3()
    const { deps, cellWrites } = rig({ ingest: TRACED_RUN })
    await processActivity(REPLAY_JOB, { ...deps, replay: archive.deps as never })

    expect(cellWrites.length).toBeGreaterThan(0)
    for (const input of cellWrites) {
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
      async send(command: TransactWriteCommand | GetCommand) {
        if (command instanceof TransactWriteCommand) transactions.push(command.input.TransactItems)
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
      async send(command: TransactWriteCommand | GetCommand) {
        if (command instanceof TransactWriteCommand) transactions.push(command.input.TransactItems)
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

describe("a second delivery keeps the first award (0220, D-260)", () => {
  const AWARD_COLUMNS = [
    "cellCount",
    "newCellCount",
    "rearmedCellCount",
    "cooledCellCount",
    "deferredCellCount",
    "fogAlgoVersion",
  ]
  const t3Row = (transacts: ReturnType<typeof rig>["transacts"]) =>
    transacts.at(-1)!.TransactItems!.find((i) => i.Put?.TableName === ACTIVITY_TABLE)!.Put!.Item!
  const awardOf = (row: Record<string, unknown>) =>
    Object.fromEntries(AWARD_COLUMNS.map((c) => [c, row[c]]))

  /**
   * THE BUG, END TO END. The second delivery sees a store that remembers the first run's cells,
   * each carrying this activity's own `lastRunAt` — so it classifies every one `cooled`. The row
   * it commits must still say what the first delivery awarded.
   */
  it("the same activity twice: T3's award is exactly what the first delivery wrote", async () => {
    const first = rig({ ingest: TRACED_RUN })
    const r1 = await processActivity(JOB, first.deps)
    if (r1.outcome !== "persisted") throw new Error("expected persisted")
    const firstRow = t3Row(first.transacts)
    expect(firstRow.newCellCount).toBeGreaterThan(0)

    const firstCells = new Set(first.cellWrites.map((w) => String((w.Key as { sk: string }).sk)))
    const second = rig({
      ingest: TRACED_RUN,
      known: (cells) =>
        Object.fromEntries(
          cells.filter((c) => firstCells.has(c)).map((c) => [c, INGEST.activity.startedAt]),
        ),
      ledgerExisting: [{ id: "a-1#wayfaring#new_ground#v1", xpAwarded: 28, xpRulesVersion: 1 }],
      storedActivity: firstRow,
    })
    const r2 = await processActivity(JOB, second.deps)
    if (r2.outcome !== "persisted") throw new Error("expected persisted")

    // The reclassification really did come back all-cooled — the bug's precondition holds.
    expect(r2.award.newCellCount).toBe(0)
    expect(r2.award.cooledCellCount).toBe(r1.award.cellCount)

    expect(awardOf(t3Row(second.transacts))).toEqual(awardOf(firstRow))
    expect(t3Row(second.transacts).cellsRef).toBe(firstRow.cellsRef)
    expect(r2.xp).toMatchObject({ alreadyScored: true, awardKept: true })

    // The receipt closes with the kept number too, so a later duplicate answers with it.
    const done = second.transacts[0]!.TransactItems!.find((i) => i.Update)!.Update!
    expect(done.ExpressionAttributeValues![":newCellCount"]).toBe(firstRow.newCellCount)
  })

  it("reads T3 consistently, by the activity's id, for the award columns only", async () => {
    const { deps, activityReads } = rig({ ingest: TRACED_RUN })
    await processActivity(JOB, deps)
    expect(activityReads).toHaveLength(1)
    expect(activityReads[0]).toMatchObject({
      TableName: ACTIVITY_TABLE,
      Key: { id: "a-1" },
      ConsistentRead: true,
    })
    expect(String(activityReads[0]!.ProjectionExpression).split(", ")).toEqual(AWARD_COLUMNS)
  })

  it("a first delivery writes its own classification and reports nothing kept", async () => {
    const { deps, transacts } = rig({ ingest: TRACED_RUN })
    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(t3Row(transacts).newCellCount).toBe(result.award.newCellCount)
    expect(result.xp.awardKept).toBe(false)
  })

  /** A row from before `0048` has no award to keep; writing the fresh one is the old behaviour. */
  it("a row with no award columns is not a stored award", async () => {
    const { deps, transacts } = rig({
      ingest: TRACED_RUN,
      storedActivity: { id: "a-1", userId: "u-1" },
    })
    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(t3Row(transacts).newCellCount).toBe(result.award.newCellCount)
    expect(result.xp.awardKept).toBe(false)
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
      res: RES,
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
      `users/u-1/explored/explored-r${RES}.1.bin`,
      `users/u-1/explored/explored-lastrun-r${RES}.1.bin`,
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
    // Three levels, and `02` T6's own partition math bounds the parents one run touches.
    const partitions = new Set(aggWrites.map((w) => String(w.Key!.pk)))
    expect(partitions).toEqual(
      new Set(["U#u-1#AGG#6", "U#u-1#AGG#7", "U#u-1#AGG#8"]),
    )
  })
})

describe("trace reject counts reach T3 (0180, §3.6)", () => {
  const rowOf = async (options: Options) => {
    const transactions: unknown[] = []
    const { deps } = rig(options)
    const inner = deps.persist.ddb.send.bind(deps.persist.ddb)
    deps.persist.ddb = {
      async send(command: TransactWriteCommand | GetCommand) {
        if (command instanceof TransactWriteCommand) transactions.push(command.input.TransactItems)
        return inner(command)
      },
    }
    const result = await processActivity(JOB, deps)
    const items = transactions[0] as Array<{ Put?: { Item: Record<string, unknown> } }>
    return { row: items.find((i) => i.Put)!.Put!.Item, result }
  }

  it("writes the counts on a scored run", async () => {
    const { row, result } = await rowOf({ ingest: TRACED_RUN })
    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(row.traceRejectCounts).toEqual(result.rejects)
    expect(row.traceRejectCounts).toMatchObject({ accuracy: 0, duplicate: 0, nonFinite: 0 })
  })

  /**
   * WRITTEN EVEN WHEN THERE IS NOTHING TO REPORT, the same rule `cellCount: 0` follows. A
   * missing map on a treadmill run would be indistinguishable from a row written before the
   * column existed — which is exactly the "absent vs none" distinction §3.6 refuses to make a
   * reader carry.
   */
  it("writes zeros for a traceless activity, so the row shape never varies", async () => {
    const { row, result } = await rowOf({ ingest: { kind: "run", hasTrace: false } })
    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.rejects).toBeNull()
    expect(row.traceRejectCounts).toEqual({
      accuracy: 0,
      duplicate: 0,
      nonFinite: 0,
      segments: 0,
    })
  })

  it("writes zeros for an activity the rules refuse to project (D-189)", async () => {
    const { row } = await rowOf({ ingest: { kind: "ride", hasTrace: true, trace: TRACE } })
    expect(row.traceRejectCounts).toEqual({
      accuracy: 0,
      duplicate: 0,
      nonFinite: 0,
      segments: 0,
    })
  })

  /**
   * CRITERION 4, end to end. Every sample over `MAX_ACC_M`: the activity persists, scores
   * nothing, and the row says why — which is the whole difference between this and a treadmill
   * run that looks identical in every other column.
   */
  it("a trace whose every sample fails the accuracy gate: cellCount 0, accuracy == pointCount", async () => {
    const bad: Trace = {
      ...TRACE,
      points: TRACE.points.map((p) => ({ ...p, accuracyM: 500 })),
    }
    const { row, result } = await rowOf({ ingest: { ...TRACED_RUN, trace: bad } })
    if (result.outcome !== "persisted") throw new Error("expected persisted")

    expect(row.cellCount).toBe(0)
    expect(result.award.cellCount).toBe(0)
    expect(row.traceRejectCounts).toMatchObject({ accuracy: bad.points.length, segments: 0 })
    // And it is distinguishable from a treadmill run, which is the point.
    expect(result.rejects).not.toBeNull()
  })

  it("bumps no generation for that run — it revealed nothing", async () => {
    const bad: Trace = {
      ...TRACE,
      points: TRACE.points.map((p) => ({ ...p, accuracyM: 500 })),
    }
    const { deps, calls, blobPuts } = rig({ ingest: { ...TRACED_RUN, trace: bad } })
    await processActivity(JOB, deps)
    expect(blobPuts).toEqual([])
    expect(calls).not.toContain("generation")
  })
})

/**
 * Ticket `0195`. `02-data-model.md` §5.1 (S-7); `05-fog-of-war.md` §4.4.
 *
 * The route geometry is written above the transaction and its key reaches T3. Both halves
 * matter: a `traceRef` on a row whose object was never written is a 404 the map cannot
 * distinguish from a new account, and an object with no `traceRef` is unreachable.
 */
describe("the route geometry phase (0195, 02 §5.1 S-7)", () => {
  const rowOf = async (options: Options) => {
    const transactions: unknown[] = []
    const rigged = rig(options)
    const inner = rigged.deps.persist.ddb.send.bind(rigged.deps.persist.ddb)
    rigged.deps.persist.ddb = {
      async send(command: TransactWriteCommand | GetCommand) {
        if (command instanceof TransactWriteCommand) transactions.push(command.input.TransactItems)
        return inner(command)
      },
    }
    const result = await processActivity(JOB, rigged.deps)
    const items = transactions[0] as Array<{ Put?: { Item: Record<string, unknown> } }>
    return { ...rigged, row: items.find((i) => i.Put)!.Put!.Item, result }
  }

  it("writes the geometry under the activity's own key", async () => {
    const { tracePuts } = await rowOf({ ingest: TRACED_RUN, traces: true })
    expect(tracePuts).toHaveLength(1)
    expect(String(tracePuts[0]!.Key)).toBe("users/u-1/traces/a-1.segments.json.gz")
  })

  /**
   * THE COLUMN WAS NULL ON EVERY ROW EVER WRITTEN before this ticket — `normalize()` sets it
   * to null and said the pipeline would fill it in, and nothing did. This is the assertion
   * that says it now does.
   */
  it("puts the key on the T3 row", async () => {
    const { row } = await rowOf({ ingest: TRACED_RUN, traces: true })
    expect(row.traceRef).toBe("users/u-1/traces/a-1.segments.json.gz")
  })

  /**
   * §3.6. A treadmill run, a manual entry, a strength session. `traceRef: null` is the normal
   * outcome and the column stays PRESENT — `persist.test.ts` already asserts the row shape must
   * not vary, and a reader must never distinguish "absent" from "none".
   */
  it("writes nothing and keeps traceRef null for a traceless activity", async () => {
    const { row, tracePuts } = await rowOf({
      ingest: { kind: "run", hasTrace: false },
      traces: true,
    })
    expect(tracePuts).toHaveLength(0)
    expect(row.traceRef).toBeNull()
    expect("traceRef" in row).toBe(true)
  })

  /**
   * D-189 REFUSES TO PROJECT A RIDE, AND THE LINE IS STILL DRAWN. `traceRef` is a fact about
   * the recording — "here is where this went" — not a game-layer verdict, and T3 documents its
   * null case as treadmill/manual/strength, which is a statement about having a trace. A ride
   * that reveals no ground still has a route worth showing.
   */
  it("writes geometry for a traced activity the rules refuse to project", async () => {
    const { row, tracePuts } = await rowOf({
      ingest: { kind: "ride", hasTrace: true, trace: TRACE },
      traces: true,
    })
    expect(tracePuts).toHaveLength(1)
    expect(row.traceRef).toBe("users/u-1/traces/a-1.segments.json.gz")
    // The projection still did not run — this ticket did not weaken D-189 on its way past.
    expect(row.cellCount).toBe(0)
  })

  /**
   * ABOVE THE TRANSACTION, the property the phase ordering exists for. A failure here must
   * leave NO `Activity` row, so a redelivery repeats the whole set idempotently. Below it,
   * rows would accumulate carrying a `traceRef` pointing at nothing.
   */
  it("fails above the transaction, so no row is written", async () => {
    const { deps, calls } = rig({
      ingest: TRACED_RUN,
      traces: true,
      tracesFail: new Error("s3 is down"),
    })
    await expect(processActivity(JOB, deps)).rejects.toThrow("s3 is down")
    expect(calls).toContain("traces")
    expect(calls).not.toContain("persist")
  })

  it("runs after the publish and before the transaction", async () => {
    const { calls } = await rowOf({ ingest: TRACED_RUN, traces: true })
    expect(calls.indexOf("traces")).toBeGreaterThan(calls.indexOf("blobs"))
    expect(calls.indexOf("traces")).toBeLessThan(calls.indexOf("persist"))
  })

  it("announces itself as a phase, so 0044 can time it", async () => {
    const seen: string[] = []
    const { deps } = rig({ ingest: TRACED_RUN, traces: true })
    const result = await processActivity(JOB, { ...deps, onPhase: (p) => seen.push(p) })
    expect(seen).toContain("traces")
    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(result.timings.tracesMs).toBeGreaterThanOrEqual(0)
  })

  /**
   * THE REBUILD DRILL'S CONFIGURATION (`0102`/`0103`): no `traces` dep at all. It re-derives
   * cells over thousands of archived activities and has no reason to rewrite geometry that is
   * already there, so the absence is a no-op rather than a throw.
   */
  it("is a no-op when no traces dep is supplied", async () => {
    const { row, tracePuts } = await rowOf({ ingest: TRACED_RUN })
    expect(tracePuts).toHaveLength(0)
    expect(row.traceRef).toBeNull()
  })
})

/**
 * Ticket `0062`. The scorer and the ledger, wired into the pipeline. `xp-ledger.test.ts` owns
 * the commit semantics; this file proves the wiring: what reaches the one transaction, and in
 * what order relative to the cells.
 */
describe("XP — the ledger rides in the ingest transaction (0062)", () => {
  const RUN = { hasTrace: true, trace: TRACE, distanceM: 280 }

  it("a traced run's ledger rows and SkillState ADD reach the ONE transaction, after the cells", async () => {
    const { deps, calls, transacts } = rig({ ingest: RUN })
    const result = await processActivity(JOB, deps)

    expect(calls.indexOf("cells")).toBeLessThan(calls.indexOf("persist"))
    expect(transacts).toHaveLength(1)
    const items = transacts[0]!.TransactItems!
    const tables = items.map((i) => (i.Put ?? i.Update)!.TableName)
    // 0064: Wayfaring, then Cartography's discovery credit, then the Constitution share —
    // three ledger rows, a SkillState ADD per skill and the Profile totals (0219), all in the
    // one transaction.
    expect(tables.slice(2)).toEqual([
      LEDGER_TABLE,
      LEDGER_TABLE,
      LEDGER_TABLE,
      SKILL_STATE_TABLE,
      SKILL_STATE_TABLE,
      SKILL_STATE_TABLE,
      PROFILE_TABLE,
    ])

    // Every cell is unknown, so the whole path is new ground: 0.28 km × 100 XP/km.
    const row = items[2]!.Put!.Item!
    expect(row).toMatchObject({
      id: "a-1#wayfaring#new_ground#v1",
      reason: "new_ground",
      xpAwarded: 28,
      xpRulesVersion: 1,
      isFloor: false,
    })
    const cells = items[3]!.Put!.Item!
    expect(cells).toMatchObject({ id: "a-1#cartography#cells_new#v1", reason: "cells_new" })
    expect(cells.xpAwarded).toBe(cells.units * 13)
    expect(items[4]!.Put!.Item).toMatchObject({
      id: "a-1#constitution#constitution_share#v1",
      xpAwarded: Math.round(28 * 0.3333),
    })
    const total = 28 + cells.xpAwarded + Math.round(28 * 0.3333)
    expect(items[0]!.Put!.Item).toMatchObject({ xpAwarded: total, xpRulesVersion: 1 })
    expect(items[1]!.Update!.ExpressionAttributeValues).toMatchObject({ ":xpAwarded": total })
    expect(result).toMatchObject({
      outcome: "persisted",
      xp: { xpAwarded: total, rowsWritten: 3, alreadyScored: false, xpRulesVersion: 1 },
    })
  })

  it("ground the store already knows is rated as recent ground, at half XP (D-120)", async () => {
    const { deps, transacts } = rig({
      ingest: RUN,
      known: (cells) => Object.fromEntries(cells.map((c) => [c, "2026-09-01T00:00:00.000Z"])),
    })
    await processActivity(JOB, deps)
    const row = transacts[0]!.TransactItems![2]!.Put!.Item!
    expect(row).toMatchObject({ reason: "recent_ground", xpAwarded: 14 })
  })

  it("an activity that already has ledger rows awards nothing: two items, the old sum on the row", async () => {
    const { deps, transacts } = rig({
      ingest: RUN,
      ledgerExisting: [{ id: "a-1#wayfaring#new_ground#v1", xpAwarded: 28, xpRulesVersion: 1 }],
    })
    const result = await processActivity(JOB, deps)
    expect(transacts[0]!.TransactItems).toHaveLength(2)
    expect(transacts[0]!.TransactItems![0]!.Put!.Item).toMatchObject({ xpAwarded: 28 })
    expect(result).toMatchObject({ xp: { alreadyScored: true, rowsWritten: 0, xpAwarded: 28 } })
  })

  it("a traceless run scores through the ungrounded skill as a `distance` row", async () => {
    const { deps, transacts } = rig({ ingest: { hasTrace: false, distanceM: 5000 } })
    await processActivity(JOB, deps)
    const rows = transacts[0]!.TransactItems!.filter((i) => i.Put?.TableName === LEDGER_TABLE)
    // No trace, no cells: no discovery row. The share still follows the activity XP (0064).
    expect(rows.map((r) => r.Put!.Item!.reason)).toEqual(["distance", "constitution_share"])
    expect(rows[0]!.Put!.Item).toMatchObject({ xpAwarded: 500 })
  })

  it("a lost race is retried; a receipt failure is not", async () => {
    const race = Object.assign(new Error("x"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "None" }, { Code: "None" }, { Code: "ConditionalCheckFailed" }],
    })
    const retried = rig({ ingest: RUN, persistFails: (n) => (n === 1 ? race : undefined) })
    await processActivity(JOB, retried.deps)
    expect(retried.transacts).toHaveLength(2)

    const stolen = Object.assign(new Error("x"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
    })
    const refused = rig({ ingest: RUN, persistFails: () => stolen })
    await expect(processActivity(JOB, refused.deps)).rejects.toBe(stolen)
    expect(refused.transacts).toHaveLength(1)
  })
})

describe("the skill-state snapshot after the commit (0067, D-143)", () => {
  const RUN = { hasTrace: true, trace: TRACE, distanceM: 280 }
  const REGISTRY_IDS = REGISTRY.skills.map((s) => s.id).sort()

  it("writes one immutable object under snapshots/skillstate/<uid>/<takenAt>-<generation>.json, after the transaction", async () => {
    const { deps, snapshotPuts, transacts } = rig({
      ingest: RUN,
      skillStates: [{ userId: "u-1", skillId: "wayfaring", displayedXp: 28, xpLedgerSum: 28, firstSeenRulesVersion: 1 }],
    })
    let transactsAtSnapshot = -1
    const put = deps.snapshots.s3.send.bind(deps.snapshots.s3)
    deps.snapshots.s3 = { send: (c: never) => ((transactsAtSnapshot = transacts.length), put(c)) } as never

    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected persisted")

    expect(transactsAtSnapshot).toBe(1)
    expect(snapshotPuts).toHaveLength(1)
    const put0 = snapshotPuts[0]!
    expect(put0.IfNoneMatch).toBe("*")
    // The generation this ingest just published.
    expect(put0.Key).toMatch(/^snapshots\/skillstate\/u-1\/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z-1\.json$/)
    expect(result.snapshot).toEqual({ key: put0.Key })
  })

  it("carries every field for every registry skill, level 1 / 0 XP included", async () => {
    const { deps, snapshotPuts } = rig({
      ingest: RUN,
      skillStates: [{ userId: "u-1", skillId: "wayfaring", displayedXp: 28, xpLedgerSum: 28, firstSeenRulesVersion: 1 }],
    })
    await processActivity(JOB, deps)
    const body = JSON.parse(String(snapshotPuts[0]!.Body))

    expect(body).toMatchObject({ userId: "u-1", rulesVersion: 1, generation: 1, trigger: "ingest" })
    expect(typeof body.takenAt).toBe("string")
    expect(body.skills.map((s: { skillId: string }) => s.skillId)).toEqual(REGISTRY_IDS)
    for (const s of body.skills) {
      expect(Object.keys(s).sort()).toEqual(
        ["displayedXp", "firstSeenRulesVersion", "level", "levelHighWater", "skillId", "xpLedgerSum"],
      )
    }
    expect(body.skills.find((s: { skillId: string }) => s.skillId === "wayfaring")).toMatchObject({
      displayedXp: 28,
      xpLedgerSum: 28,
    })
    const untrained = body.skills.find((s: { skillId: string }) => s.skillId !== "wayfaring")
    expect(untrained).toMatchObject({ displayedXp: 0, xpLedgerSum: 0, level: 1, levelHighWater: 1 })
  })

  it("a traceless activity bumps no generation, so the snapshot names the manifest's", async () => {
    const { deps, snapshotPuts } = rig({ ingest: { kind: "run", hasTrace: false } })
    await processActivity(JOB, deps)
    // The rig has no manifest: generation 0.
    expect(snapshotPuts[0]!.Key).toMatch(/-0\.json$/)
  })

  it("a failed snapshot never fails the ingest — it is reported, and the activity is committed", async () => {
    const { deps, transacts } = rig({ ingest: RUN, snapshotFails: Object.assign(new Error("denied"), { name: "AccessDenied" }) })
    const result = await processActivity(JOB, deps)
    if (result.outcome !== "persisted") throw new Error("expected persisted")
    expect(transacts).toHaveLength(1)
    expect(result.snapshot).toEqual({ failed: "AccessDenied: denied" })
  })
})
