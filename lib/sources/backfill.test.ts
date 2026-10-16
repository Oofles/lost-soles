import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import type { SourceAdapter, SweepJob } from "@/src/adapters/types"

import {
  BACKFILL_ORIGIN,
  nextBackfillCursor,
  runBackfill,
  type BackfillDeps,
  type BackfillWindowReport,
} from "./backfill"

/**
 * Ticket 0177. What can be permanently wrong here is RESUME: a cursor that moves past an
 * activity that never reached the queue loses a run on a map that never re-fogs (D-020).
 * Everything is tested against a made-up source, as `sync.test.ts` does.
 */

const USER = "u-1"
const SOURCE = "gpslogger"
const NOW = new Date("2026-10-16T14:00:00.000Z")

const job = (n: number, startedAt: string): SweepJob => ({
  ingestKey: `k-${n}`,
  userId: USER,
  source: SOURCE,
  externalId: String(n),
  command: "ingest",
  startedAt,
  meta: null,
  enqueuedAt: NOW.toISOString(),
})

const HISTORY = [
  job(1, "2018-05-01T08:00:00.000Z"),
  job(2, "2019-03-02T08:00:00.000Z"),
  job(3, "2019-03-02T08:00:00.000Z"), // same second as 2: the cursor must not step over it
  job(4, "2021-07-04T08:00:00.000Z"),
  job(5, "2026-10-01T08:00:00.000Z"), // already imported by the 30-day first Sync
]

interface Options {
  history?: SweepJob[]
  /** Activities the pace allows per window. */
  perWindow?: number
  /** Receipt rows already present, as a delivered (`attempts: 1`) row. */
  known?: string[]
  /** `ingestKey`s whose enqueue throws, once each. */
  enqueueFailsOnce?: string[]
  /** Throw from `report` on this window: the process was killed right after the window's enqueues. */
  killAfterWindow?: number
  /** Throws a rate-limit error from the generator on this window's first listing. */
  rateLimitedOnWindow?: number
  paceFails?: boolean
}

/** One receipt table and one queue, shared across "processes", so a restart sees the first run's writes. */
function world(known: string[] = []) {
  const receipts: Record<string, { status: string; attempts: number }> = {}
  for (const k of known) receipts[k] = { status: "DONE", attempts: 1 }
  const queue: string[] = []
  const enqueued: string[] = []
  return { receipts, queue, enqueued }
}

function rig(w: ReturnType<typeof world>, options: Options = {}) {
  const history = options.history ?? HISTORY
  const perWindow = options.perWindow ?? 2
  const failOnce = new Set(options.enqueueFailsOnce ?? [])
  const reports: BackfillWindowReport[] = []
  const sleeps: number[] = []
  const listedFrom: string[] = []
  let window = 0

  const adapter = {
    id: SOURCE,
    async *listSince(_user: string, after: string) {
      listedFrom.push(after)
      if (options.rateLimitedOnWindow === window) {
        options.rateLimitedOnWindow = undefined
        throw Object.assign(new Error("429"), { name: "SourceRateLimitedError", retryAfterMs: 60_000 })
      }
      // Strava's `after` is exclusive, and the list is ascending.
      for (const j of history) if (Date.parse(j.startedAt) > Date.parse(after)) yield j
    },
  } as unknown as SourceAdapter<unknown>

  const deps: BackfillDeps = {
    adapter,
    credentials: {},
    now: () => NOW,
    receipt: {
      ddb: {
        async send(command: unknown) {
          if (command instanceof PutCommand) {
            const key = (command.input.Item as { ingestKey: string }).ingestKey
            if (w.receipts[key]) {
              throw Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" })
            }
            w.receipts[key] = { status: "QUEUED", attempts: 0 }
            return {}
          }
          const key = (command as { input: { Key?: { ingestKey?: string } } }).input.Key?.ingestKey
          return { Item: key && w.receipts[key] ? { ingestKey: key, ...w.receipts[key] } : undefined }
        },
      },
    } as never,
    async enqueue(j) {
      if (failOnce.delete(j.ingestKey)) throw new Error("sqs is down")
      w.queue.push(j.ingestKey)
      w.enqueued.push(j.ingestKey)
    },
    async beginWindow() {
      window += 1
      // The drain: every message on the queue is delivered, so its receipt shows a delivery.
      for (const k of w.queue.splice(0)) w.receipts[k] = { status: "DONE", attempts: 1 }
    },
    pace(enqueuedThisWindow) {
      if (options.paceFails) return { action: "fail", reason: "no headers" }
      return enqueuedThisWindow < perWindow
        ? { action: "proceed", allowance: perWindow - enqueuedThisWindow }
        : { action: "sleep", untilMs: NOW.getTime() + 15 * 60_000, reason: "window full" }
    },
    async sleep(ms) {
      sleeps.push(ms)
    },
    report(line) {
      if (options.killAfterWindow === line.window) throw new Error("killed")
      reports.push(line)
    },
  }
  return { deps, reports, sleeps, listedFrom }
}

describe("a paced backfill", () => {
  it("imports the whole history across windows, once each, with one invocation", async () => {
    const w = world(["k-5"])
    const { deps, reports, sleeps, listedFrom } = rig(w, { perWindow: 2 })
    const tally = await runBackfill(USER, deps)

    expect(w.enqueued).toEqual(["k-1", "k-2", "k-3", "k-4"])
    expect(listedFrom[0]).toBe(BACKFILL_ORIGIN)
    expect(sleeps.length).toBe(reports.length - 1)
    expect(reports.at(-1)?.completed).toBe(true)

    expect(tally.queued).toBe(4)
    expect(tally.alreadyKnown).toBeGreaterThanOrEqual(1)
    expect(tally.importedFrom).toBe("2018-05-01T08:00:00.000Z")
    expect(tally.importedTo).toBe("2021-07-04T08:00:00.000Z")
  })

  it("does not step over a same-second sibling when a window ends between them", async () => {
    const w = world()
    const { deps } = rig(w, { perWindow: 1 })
    await runBackfill(USER, deps)
    expect(w.enqueued).toContain("k-3")
    expect(new Set(w.enqueued).size).toBe(w.enqueued.length)
  })

  it("sleeps out a 429 on the list call and carries on", async () => {
    const w = world()
    const { deps, sleeps } = rig(w, { perWindow: 10, rateLimitedOnWindow: 1 })
    await runBackfill(USER, deps)
    expect(sleeps[0]).toBeGreaterThanOrEqual(60_000)
    expect(w.enqueued).toEqual(["k-1", "k-2", "k-3", "k-4", "k-5"])
  })

  it("refuses to run blind rather than enqueueing without a budget reading", async () => {
    const w = world()
    const { deps } = rig(w, { paceFails: true })
    await expect(runBackfill(USER, deps)).rejects.toThrow("no headers")
    expect(w.enqueued).toEqual([])
  })
})

describe("resume is re-running it: the receipt gate is the checkpoint", () => {
  it("after a failed enqueue, a re-run imports what was missed and doubles nothing", async () => {
    const w = world()
    const first = rig(w, { perWindow: 10, enqueueFailsOnce: ["k-4"] })
    await expect(runBackfill(USER, first.deps)).rejects.toThrow("sqs is down")
    expect(w.enqueued).toEqual(["k-1", "k-2", "k-3"])

    // k-4's receipt was accepted and never delivered (QUEUED, attempts 0), so it goes again.
    const second = rig(w, { perWindow: 10 })
    const tally = await runBackfill(USER, second.deps)
    expect(w.enqueued).toEqual(["k-1", "k-2", "k-3", "k-4", "k-5"])
    expect(tally.queued).toBe(2)
    expect(second.listedFrom[0]).toBe(BACKFILL_ORIGIN)
  })

  it("killed right after a window's enqueues, a re-run enqueues none of them again", async () => {
    const w = world()
    const first = rig(w, { perWindow: 2, killAfterWindow: 2 })
    await expect(runBackfill(USER, first.deps)).rejects.toThrow("killed")
    // Window 2 enqueued k-3 and k-4 and never recorded it.
    expect(w.enqueued).toEqual(["k-1", "k-2", "k-3", "k-4"])

    const second = rig(w, { perWindow: 2 })
    await runBackfill(USER, second.deps)
    expect(w.enqueued).toEqual(["k-1", "k-2", "k-3", "k-4", "k-5"])
  })
})

describe("nextBackfillCursor", () => {
  it("holds when nothing was confirmed", () => {
    expect(nextBackfillCursor(BACKFILL_ORIGIN, [])).toBe(BACKFILL_ORIGIN)
  })

  it("sits one second behind the newest confirmed start, so siblings are re-listed", () => {
    expect(nextBackfillCursor(BACKFILL_ORIGIN, ["2019-03-02T08:00:00.400Z", "2018-01-01T00:00:00.000Z"])).toBe(
      "2019-03-02T07:59:59.000Z",
    )
  })

  it("never moves backwards", () => {
    expect(nextBackfillCursor("2019-03-02T08:00:00.000Z", ["2019-03-02T08:00:00.000Z"])).toBe(
      "2019-03-02T08:00:00.000Z",
    )
  })
})
