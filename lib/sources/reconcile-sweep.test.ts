import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { PutCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import type { SourceAdapter, SweepJob } from "@/src/adapters/types"
import type { SourceId } from "@/src/domain/activity"

import { NIGHTLY_OVERLAP_SECONDS } from "./list-since-watermark"
import {
  metricLine,
  modeOf,
  RECONCILE_METRIC_NAMESPACE,
  RECONCILE_METRICS,
  runReconcileSweep,
  type ReconcileDeps,
} from "./reconcile-sweep"

/**
 * Ticket 0095. SOURCE-AGNOSTIC, like `sync.test.ts`: a made-up source with a paging stub, so
 * what is under test is the sweep and not an adapter. The real adapter's paging (per_page=200,
 * page to exhaustion, a 429 as `SourceRateLimitedError`) is `src/adapters/strava/adapter.test.ts`.
 */

const USER = "u-owner"
const SOURCE = "gpslogger" as SourceId
const NOW = new Date("2026-10-17T12:00:00.000Z")
const WATERMARK = "2026-10-14T00:00:00.000Z"
const PAGE = 200

const job = (n: number): SweepJob => ({
  ingestKey: `k-${n}`,
  userId: USER,
  source: SOURCE,
  externalId: String(n),
  command: "ingest",
  // Oldest first, one minute apart, all inside the window.
  startedAt: new Date(Date.parse(WATERMARK) + n * 60_000).toISOString(),
  meta: null,
  enqueuedAt: NOW.toISOString(),
})

interface RigOptions {
  /** How many activities the source holds in the window. */
  count?: number
  /** Throw from the listing when this page is requested (1-based). */
  failOnPage?: number
  failWith?: Error
  watermark?: string | null
  /** `ingestKey`s that already have a receipt, as a webhook would have left them. */
  delivered?: string[]
  status?: string | null
}

function rig(options: RigOptions = {}) {
  const count = options.count ?? 3
  const receipts = new Map<string, { status: string; attempts: number }>(
    (options.delivered ?? []).map((k) => [k, { status: "DONE", attempts: 1 }]),
  )
  const enqueued: string[] = []
  const listedFrom: string[] = []
  const pagesRequested: number[] = []
  const lines: string[] = []
  let advancedTo: string | undefined

  /** Pages like the real one: `PAGE` per page, a short page ends it. */
  const adapter = {
    id: SOURCE,
    async *listSince(_user: string, from: string) {
      listedFrom.push(from)
      for (let page = 1; ; page += 1) {
        pagesRequested.push(page)
        if (options.failOnPage === page) {
          throw options.failWith ?? Object.assign(new Error("provider stopped"), { name: "ProviderError" })
        }
        const batch = Array.from({ length: Math.max(0, Math.min(PAGE, count - (page - 1) * PAGE)) }, (_, i) =>
          job((page - 1) * PAGE + i + 1),
        )
        yield* batch
        if (batch.length < PAGE) return
      }
    },
  } as unknown as SourceAdapter<unknown>

  const deps: ReconcileDeps = {
    userIds: [USER],
    sources: () => [SOURCE],
    accountStatus: async () => (options.status === undefined ? "ACTIVE" : options.status),
    now: () => NOW,
    receipt: {
      ddb: {
        async send(command: unknown) {
          if (command instanceof PutCommand) {
            const key = (command.input.Item as { ingestKey: string }).ingestKey
            if (receipts.has(key)) {
              throw Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" })
            }
            receipts.set(key, { status: "QUEUED", attempts: 0 })
            return {}
          }
          const key = (command as { input: { Key?: { ingestKey?: string } } }).input.Key?.ingestKey
          const r = key ? receipts.get(key) : undefined
          return { Item: r ? { ingestKey: key, ...r } : undefined }
        },
      },
    } as never,
    async enqueue(j) {
      enqueued.push(j.ingestKey)
      // The worker picks it up: a delivery happened.
      receipts.set(j.ingestKey, { status: "QUEUED", attempts: 1 })
    },
    syncDepsFor: () => ({
      adapter,
      credentials: {},
      readWatermark: async () => (options.watermark === undefined ? WATERMARK : options.watermark),
      advanceWatermark: async (w) => {
        advancedTo = w
      },
    }),
    emit: (line) => lines.push(line),
  }

  return {
    deps,
    enqueued,
    listedFrom,
    pagesRequested,
    receipts,
    lines,
    advanced: () => advancedTo,
  }
}

describe("the two windows (criteria 1 and 2)", () => {
  /**
   * The stored watermark is already `newest confirmed - 48h` (`nextListSinceWatermark` applies
   * the overlap on write), so the six-hourly sweep lists from it unchanged. Subtracting 48h
   * again would list four days.
   */
  it("six-hourly lists from the stored watermark", async () => {
    const r = rig()
    await runReconcileSweep("six-hourly", r.deps)
    expect(r.listedFrom).toEqual([WATERMARK])
  })

  it("nightly lists the last 14 days when the watermark is more recent", async () => {
    const r = rig()
    await runReconcileSweep("nightly", r.deps)
    expect(r.listedFrom).toEqual([new Date(NOW.getTime() - NIGHTLY_OVERLAP_SECONDS * 1000).toISOString()])
  })

  /** A connection 20 days behind is swept from its watermark: the window only ever widens. */
  it("nightly never lists LESS than the watermark asks for", async () => {
    const old = "2026-09-27T00:00:00.000Z"
    const r = rig({ watermark: old })
    await runReconcileSweep("nightly", r.deps)
    expect(r.listedFrom).toEqual([old])
  })

  it("pages to exhaustion", async () => {
    const r = rig({ count: 437 })
    const result = await runReconcileSweep("six-hourly", r.deps)
    expect(r.pagesRequested).toEqual([1, 2, 3])
    expect(result.seen).toBe(437)
  })

  it("reads the nightly mode from its schedule's payload, and anything else as six-hourly", () => {
    expect(modeOf({ mode: "nightly" })).toBe("nightly")
    expect(modeOf({})).toBe("six-hourly")
    expect(modeOf(undefined)).toBe("six-hourly")
    expect(modeOf({ mode: "weekly" })).toBe("six-hourly")
  })
})

describe("the receipt gate (criteria 4 and 5)", () => {
  /**
   * The webhook got there first: one conditional write each, and nothing enqueued. No message
   * means no worker run, so no Activity row, no raw object and no XP can follow from the sweep.
   */
  it("enqueues nothing for activities the webhook already delivered", async () => {
    const r = rig({ delivered: ["k-1", "k-2", "k-3"] })
    const result = await runReconcileSweep("six-hourly", r.deps)
    expect(r.enqueued).toEqual([])
    expect(result).toMatchObject({ seen: 3, enqueued: 0, alreadyPresent: 3 })
  })

  it("enqueues exactly the ones the webhook dropped", async () => {
    const r = rig({ delivered: ["k-1", "k-3"] })
    const result = await runReconcileSweep("six-hourly", r.deps)
    expect(r.enqueued).toEqual(["k-2"])
    expect(result).toMatchObject({ seen: 3, enqueued: 1, alreadyPresent: 2 })
  })

  /** Safe to run at any time for any reason: the second run finds its own receipts. */
  it("is idempotent across runs, including six-hourly then nightly", async () => {
    const r = rig()
    await runReconcileSweep("six-hourly", r.deps)
    await runReconcileSweep("nightly", r.deps)
    await runReconcileSweep("six-hourly", r.deps)
    expect(r.enqueued).toEqual(["k-1", "k-2", "k-3"])
  })
})

describe("the watermark (criterion 6)", () => {
  it("advances after a complete sweep", async () => {
    const r = rig({ count: 3 })
    await runReconcileSweep("six-hourly", r.deps)
    // newest (WATERMARK + 3 min) - 48h
    expect(r.advanced()).toBe(new Date(Date.parse(WATERMARK) + 3 * 60_000 - 48 * 3600_000).toISOString())
  })

  /** THE CRITERION'S OWN TEST: a full first page, then the listing throws on page 2. */
  it("is left unchanged when the listing throws on page 2", async () => {
    const r = rig({ count: 437, failOnPage: 2 })
    const result = await runReconcileSweep("six-hourly", r.deps)

    expect(r.pagesRequested).toEqual([1, 2])
    expect(r.advanced()).toBeUndefined()
    // Page 1's enqueues stand: they landed, and the next sweep re-lists them for free.
    expect(r.enqueued).toHaveLength(PAGE)
    expect(result).toMatchObject({ failed: 1, enqueued: PAGE, seen: PAGE })
  })

  it("does not throw out of the handler for a failed connection", async () => {
    const r = rig({ failOnPage: 1 })
    await expect(runReconcileSweep("nightly", r.deps)).resolves.toMatchObject({ failed: 1 })
  })
})

describe("rate limits (criterion 10)", () => {
  /**
   * A 429 on the list call ends the sweep: no further page is requested, nothing is retried
   * inside the invocation, the watermark holds, and the handler returns rather than throwing
   * (a throw would let the scheduler's retries spend the budget minutes later). The next
   * scheduled run is the back-off.
   */
  it("stops at a 429 and holds the watermark", async () => {
    const limited = Object.assign(new Error("rate limited"), {
      name: "SourceRateLimitedError",
      retryAfterMs: 600_000,
    })
    const r = rig({ count: 437, failOnPage: 2, failWith: limited })

    const result = await runReconcileSweep("six-hourly", r.deps)

    expect(r.pagesRequested).toEqual([1, 2])
    expect(r.advanced()).toBeUndefined()
    expect(result.failed).toBe(1)
    expect(result.outcomes[0]).toMatchObject({ kind: "failed", detail: "SourceRateLimitedError" })
  })
})

describe("connections", () => {
  it("skips a source that is not connected, without listing", async () => {
    const r = rig({ status: null })
    const result = await runReconcileSweep("six-hourly", r.deps)
    expect(r.listedFrom).toEqual([])
    expect(result.outcomes).toEqual([])
  })

  it("counts a broken connection as reconnect, without listing", async () => {
    const r = rig({ status: "NEEDS_REAUTH" })
    const result = await runReconcileSweep("six-hourly", r.deps)
    expect(r.listedFrom).toEqual([])
    expect(result.reconnect).toBe(1)
  })
})

describe("metrics (criterion 7)", () => {
  it("emits one EMF line per sweep with seen, enqueued and already-present", async () => {
    const r = rig({ delivered: ["k-1"] })
    await runReconcileSweep("nightly", r.deps)

    expect(r.lines).toHaveLength(1)
    const emf = JSON.parse(r.lines[0])
    const directive = emf._aws.CloudWatchMetrics[0]
    expect(directive.Namespace).toBe(RECONCILE_METRIC_NAMESPACE)
    expect(directive.Dimensions).toEqual([[]])
    expect(directive.Metrics.map((m: { Name: string }) => m.Name)).toEqual([
      RECONCILE_METRICS.seen,
      RECONCILE_METRICS.enqueued,
      RECONCILE_METRICS.alreadyPresent,
    ])
    expect(emf).toMatchObject({ mode: "nightly", SweepSeen: 3, SweepEnqueued: 2, SweepAlreadyPresent: 1 })
    expect(emf._aws.Timestamp).toBe(NOW.getTime())
  })

  /** Zeros are emitted, so a quiet day is a 0 datapoint and not missing data. */
  it("emits zeros when nothing is connected", async () => {
    const r = rig({ status: null })
    await runReconcileSweep("six-hourly", r.deps)
    expect(JSON.parse(r.lines[0])).toMatchObject({ SweepSeen: 0, SweepEnqueued: 0, SweepAlreadyPresent: 0 })
  })

  it("carries nothing but counts and the mode", () => {
    const line = metricLine(
      { mode: "six-hourly", seen: 1, enqueued: 1, alreadyPresent: 0, failed: 0, reconnect: 0, outcomes: [] },
      NOW,
    )
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(
      ["_aws", "mode", "SweepSeen", "SweepEnqueued", "SweepAlreadyPresent"].sort(),
    )
  })
})

/**
 * CRITERION 3: ONE LISTING IMPLEMENTATION. The sweep goes through `syncSource`, which calls the
 * adapter's `listSince`; nothing outside `src/adapters/` names a provider's list endpoint or
 * pages one.
 */
describe("one listSince implementation (criterion 3)", () => {
  const root = join(__dirname, "..", "..")
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) return name === "node_modules" ? [] : files(p)
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
    })

  it("has exactly one list-endpoint caller, in the adapter", () => {
    const hits = ["lib", "amplify", "app", "src", "tools"]
      .flatMap((d) => files(join(root, d)))
      // The REQUEST, not a mention: `tools/backfill` reads the list call's headers by URL.
      .filter((p) => /\.get\(\s*["'`]\/athlete\/activities["'`]/.test(readFileSync(p, "utf8")))
    expect(hits.map((p) => p.slice(root.length + 1))).toEqual(["src/adapters/strava/adapter.ts"])
  })

  it("the sweep lists through syncSource and has no paging or HTTP of its own", () => {
    const sweep = readFileSync(join(root, "lib/sources/reconcile-sweep.ts"), "utf8")
    const handler = readFileSync(join(root, "amplify/functions/reconcile-sweep/handler.ts"), "utf8")
    expect(sweep).toMatch(/await syncSource\(/)
    for (const src of [sweep, handler]) {
      expect(src).not.toMatch(/\bfetch\(|per_page|\.listSince\(/)
    }
  })
})
