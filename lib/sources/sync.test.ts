import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import { describe, expect, it } from "vitest"

import type { IngestJob, SourceAdapter } from "@/src/adapters/types"

import {
  FIRST_SYNC_LOOKBACK_DAYS,
  firstSyncBoundary,
  syncSource,
  type SyncDeps,
} from "./sync"

/**
 * Ticket 0043. What is under test is the WATERMARK UNDER PARTIAL FAILURE, because that is
 * the only part of this file that can be catastrophically wrong: a watermark that moves
 * too far forward loses a run permanently, on a map that by D-020 never re-fogs. Everything
 * else here is bookkeeping.
 *
 * SOURCE-AGNOSTIC, like the module. The stub adapter is a made-up source; reaching for the
 * real one would be testing the sweep and an adapter at once and could not say which broke.
 */

const USER = "u-1"
const SOURCE = "gpslogger"
const NOW = new Date("2026-09-07T12:00:00.000Z")

/** Activities as `listSince` yields them: OLDEST FIRST, which the advance rule relies on. */
const job = (n: number, startedAt: string): IngestJob => ({
  ingestKey: `k-${n}`,
  userId: USER,
  source: SOURCE,
  externalId: String(n),
  command: "ingest",
  startedAt,
  meta: null,
  enqueuedAt: NOW.toISOString(),
})

const JOBS = [
  job(1, "2026-09-01T08:00:00.000Z"),
  job(2, "2026-09-03T08:00:00.000Z"),
  job(3, "2026-09-05T08:00:00.000Z"),
]

interface Options {
  jobs?: IngestJob[]
  watermark?: string | null
  /** `ingestKey`s whose enqueue throws. */
  enqueueFails?: string[]
  /** Throws from the generator after yielding this many — a source that died mid-sweep. */
  sourceDiesAfter?: number
  /** `ingestKey`s the receipt table already holds, with the status it holds them at. */
  existing?: Record<string, { status: string; attempts: number }>
  reauth?: boolean
}

function rig(options: Options = {}) {
  const jobs = options.jobs ?? JOBS
  const existing = options.existing ?? {}
  const enqueued: string[] = []
  let advancedTo: string | undefined

  const adapter = {
    id: SOURCE,
    async *listSince() {
      let yielded = 0
      for (const j of jobs) {
        if (options.sourceDiesAfter !== undefined && yielded === options.sourceDiesAfter) {
          throw Object.assign(new Error("provider stopped"), { name: "ProviderError" })
        }
        yielded += 1
        yield j
      }
      if (options.reauth) {
        throw Object.assign(new Error("dead"), { name: "SourceNeedsReauthError" })
      }
    },
  } as unknown as SourceAdapter<unknown>

  const conditionalFailure = Object.assign(new Error("exists"), {
    name: "ConditionalCheckFailedException",
  })

  const deps: SyncDeps = {
    adapter,
    credentials: {},
    now: () => NOW,
    receipt: {
      ddb: {
        async send(command: PutCommand | UpdateCommand | { input: { Key?: unknown } }) {
          if (command instanceof PutCommand) {
            const key = (command.input.Item as { ingestKey: string }).ingestKey
            if (existing[key]) throw conditionalFailure
            existing[key] = { status: "QUEUED", attempts: 0 }
            return {}
          }
          // The only other command this path issues is `readReceipt`'s GetItem.
          const key = (command as { input: { Key?: { ingestKey?: string } } }).input.Key
            ?.ingestKey
          return { Item: key ? { ingestKey: key, ...existing[key] } : undefined }
        },
      },
    } as never,
    async enqueue(j) {
      if (options.enqueueFails?.includes(j.ingestKey)) throw new Error("sqs is down")
      enqueued.push(j.ingestKey)
    },
    async readWatermark() {
      return options.watermark === undefined ? "2026-08-31T00:00:00.000Z" : options.watermark
    },
    async advanceWatermark(value) {
      advancedTo = value
    },
  }

  return { deps, enqueued, advanced: () => advancedTo }
}

describe("the happy sweep", () => {
  it("enqueues every listed activity and reports the count", async () => {
    const { deps, enqueued } = rig()

    const outcome = await syncSource(USER, SOURCE, deps)

    expect(outcome).toEqual({ sourceId: SOURCE, kind: "queued", queued: 3, alreadyKnown: 0 })
    expect(enqueued).toEqual(["k-1", "k-2", "k-3"])
  })

  /**
   * Criterion 4's overlap. The advance lands at `newest confirmed − 48h`, which is BEHIND
   * where the sweep started — the watermark is meant to oscillate, not to march forward.
   * §2.3's reason is upload lag: `start_date` is when the user ran, not when the activity
   * appeared, so a run recorded Sunday and uploaded Tuesday sits behind a tighter window.
   */
  it("advances to the newest confirmed activity, less the overlap", async () => {
    const { deps, advanced } = rig()

    await syncSource(USER, SOURCE, deps)

    // 2026-09-05T08:00Z − 48h
    expect(advanced()).toBe("2026-09-03T08:00:00.000Z")
  })

  /** An empty window is not progress, and the rule refuses to advance on it. */
  it("reports nothing-new and leaves the watermark alone", async () => {
    const { deps, advanced } = rig({ jobs: [] })

    expect(await syncSource(USER, SOURCE, deps)).toEqual({ sourceId: SOURCE, kind: "nothing-new" })
    expect(advanced()).toBeUndefined()
  })
})

describe("pressing Sync twice (criterion 5)", () => {
  /**
   * The second press lists the same activities — the 48-hour overlap guarantees it — and
   * every one is already in the ledger. One conditional write each, no enqueue, and the
   * result line says "nothing new" rather than claiming three more.
   */
  it("enqueues nothing the second time, and says so", async () => {
    const existing = {}
    const first = rig({ existing })
    await syncSource(USER, SOURCE, first.deps)

    // The receipts written by the first sweep are now in flight, so attempts advances.
    for (const key of Object.keys(existing)) {
      ;(existing as Record<string, { status: string; attempts: number }>)[key].attempts = 1
    }

    const second = rig({ existing })
    const outcome = await syncSource(USER, SOURCE, second.deps)

    expect(second.enqueued).toEqual([])
    expect(outcome).toEqual({ sourceId: SOURCE, kind: "queued", queued: 0, alreadyKnown: 3 })
  })

  /**
   * THE HOLE THE ACCEPT GATE LEAVES, and the reason `needsEnqueue` reads rather than
   * trusts. A receipt written by a sweep whose `SendMessage` then failed is `QUEUED` with
   * zero attempts — accepted and never delivered. Skipping it on the strength of
   * "duplicate" would block that activity FOREVER: never imported, never in the DLQ,
   * never anywhere a human looks.
   */
  it("re-enqueues a receipt that was accepted but never delivered", async () => {
    const { deps, enqueued } = rig({
      existing: { "k-2": { status: "QUEUED", attempts: 0 } },
    })

    await syncSource(USER, SOURCE, deps)

    expect(enqueued).toContain("k-2")
  })

  /** `attempts > 0` means the queue has it. Re-enqueueing would duplicate work the DLQ owns. */
  it("leaves a receipt alone once a delivery has happened", async () => {
    const { deps, enqueued } = rig({
      existing: { "k-2": { status: "QUEUED", attempts: 1 } },
    })

    await syncSource(USER, SOURCE, deps)

    expect(enqueued).not.toContain("k-2")
  })

  /** A finished activity is not re-enqueued on any later press. */
  it("leaves a finished receipt alone", async () => {
    const { deps, enqueued } = rig({ existing: { "k-1": { status: "DONE", attempts: 1 } } })

    await syncSource(USER, SOURCE, deps)

    expect(enqueued).toEqual(["k-2", "k-3"])
  })
})

describe("partial failure — the case the watermark exists for", () => {
  /**
   * THE ONE THAT MATTERS. The middle activity's enqueue fails while the newest succeeds.
   * A naive "how far did I get" would advance past the failure because something newer
   * landed, and that run would never be listed again.
   *
   * The rule pins the boundary at the OLDEST UNCONFIRMED — below the failure, and
   * therefore below the newer success too, which is re-listed and de-duplicated for free.
   */
  it("pins the watermark below a failed enqueue, even when a newer one succeeded", async () => {
    const { deps, advanced, enqueued } = rig({ enqueueFails: ["k-2"] })

    const outcome = await syncSource(USER, SOURCE, deps)

    expect(enqueued).toEqual(["k-1", "k-3"])
    // 2026-09-03T08:00Z (the failure) − 48h, NOT 2026-09-05 (the newest success) − 48h.
    expect(advanced()).toBe("2026-09-01T08:00:00.000Z")
    expect(outcome).toMatchObject({ kind: "failed", queued: 2 })
  })

  /** One bad activity must not cost the rest of the page. */
  it("keeps going after a failure rather than abandoning the sweep", async () => {
    const { deps, enqueued } = rig({ enqueueFails: ["k-1"] })

    await syncSource(USER, SOURCE, deps)

    expect(enqueued).toEqual(["k-2", "k-3"])
  })

  /**
   * The source died after two pages. Advancing on what WAS confirmed is safe rather than
   * optimistic, and the reason is the paging order: `listSince` yields oldest-first, so
   * everything we never saw is newer than everything we did.
   */
  it("advances on what it did confirm when the source stops mid-sweep", async () => {
    const { deps, advanced, enqueued } = rig({ sourceDiesAfter: 2 })

    const outcome = await syncSource(USER, SOURCE, deps)

    expect(enqueued).toEqual(["k-1", "k-2"])
    // 2026-09-03T08:00Z − 48h
    expect(advanced()).toBe("2026-09-01T08:00:00.000Z")
    expect(outcome).toMatchObject({ kind: "failed", queued: 2 })
  })

  /**
   * A dead credential is a different answer, not a worse failure: no amount of retrying
   * fixes it and the only useful thing to say is "reconnect". The watermark is left alone
   * because nothing about the window has been established.
   */
  it("reports reconnect and does not move the watermark when the credential is dead", async () => {
    const { deps, advanced } = rig({ jobs: [], reauth: true })

    expect(await syncSource(USER, SOURCE, deps)).toEqual({ sourceId: SOURCE, kind: "reconnect" })
    expect(advanced()).toBeUndefined()
  })

  /** The detail is a NAME, never a message or a stack — a token exchange error quotes its request. */
  it("never puts an error message in a value that reaches a page", async () => {
    const { deps } = rig({ enqueueFails: ["k-1", "k-2", "k-3"] })

    const outcome = await syncSource(USER, SOURCE, deps)

    expect(outcome).toMatchObject({ kind: "failed", detail: "Error" })
    expect(JSON.stringify(outcome)).not.toContain("sqs is down")
  })
})

describe("the first sync", () => {
  /**
   * `readListSinceWatermark` returns null for a connection that has never been swept, and
   * the store's own comment insists that is not "swept and found nothing". Thirty days is
   * the boundary decision, taken with the operator: the constraint is the provider's read
   * budget, which an unbounded first sweep would spend for eight hours.
   */
  it("looks back thirty days when there is no watermark", async () => {
    const { deps } = rig({ watermark: null })

    await syncSource(USER, SOURCE, deps)

    expect(firstSyncBoundary(NOW)).toBe("2026-08-08T12:00:00.000Z")
    expect(FIRST_SYNC_LOOKBACK_DAYS).toBe(30)
  })

  it("hands that boundary to the adapter as the window to list from", async () => {
    let asked: string | undefined
    const { deps } = rig({ watermark: null })
    const inner = deps.adapter.listSince.bind(deps.adapter)
    deps.adapter = {
      ...deps.adapter,
      listSince: (userId: string, watermark: string, creds: unknown) => {
        asked = watermark
        return inner(userId, watermark, creds)
      },
    } as never

    await syncSource(USER, SOURCE, deps)

    expect(asked).toBe(firstSyncBoundary(NOW))
  })
})
