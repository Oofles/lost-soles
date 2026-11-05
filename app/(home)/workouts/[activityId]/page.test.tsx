import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { activityItem } from "@/src/pipeline/persist"

/**
 * Ticket `0345` — `/workouts/:id`, the plain record (`06` §2.6, D-486).
 *
 * The page's reads are real (`workoutById`, `activityLedger`) over a RECORDING DynamoDB fake, so the
 * criterion "reopening a workout writes nothing" is proved rather than assumed: every command the
 * page sends is captured and every one must be a `Query`. The ledger is never written (D-135).
 */

let signedInAs: string | undefined = "u-1"
vi.mock("@/lib/auth/owner", () => ({ currentUserId: async () => signedInAs, isOwner: () => true }))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND")
  },
  useRouter: () => ({ back: () => {} }),
}))

const sent: { name: string; input: Record<string, unknown> }[] = []
let activityRows: Record<string, unknown>[] = []
let ledgerRows: Record<string, unknown>[] = []
const ddb = {
  async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
    sent.push({ name: command.constructor.name, input: command.input })
    return { Items: command.input.TableName === "TestLedger" ? ledgerRows : activityRows }
  },
}
vi.mock("@/lib/runs/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/runs/server")>()),
  defaultRunReadDeps: () => ({ ddb, activityTable: "TestActivity", bucket: "bkt", s3: {} }),
}))
vi.mock("@/lib/runs/ledger-server", async (orig) => ({
  ...(await orig<typeof import("@/lib/runs/ledger-server")>()),
  defaultActivityLedgerDeps: () => ({ ddb, ledgerTable: "TestLedger" }),
}))

const { default: WorkoutRecordPage } = await import("./page")
const render = async (id = "w-1") => renderToStaticMarkup(await WorkoutRecordPage({ params: Promise.resolve({ activityId: id }) }))

const workout = (over: Record<string, unknown> = {}) => ({
  ...activityItem({
    activityId: "w-1",
    userId: "u-1",
    kind: "strength",
    hasTrace: false,
    source: { source: "manual", externalId: "1" },
    startedAt: "2026-11-04T23:00:00.000Z",
    startedAtLocal: "2026-11-04T18:00:00",
    timezone: "America/New_York",
    ingestedAt: "2026-11-04T23:00:01.000Z",
    elapsedS: 0,
    movingS: null,
    distanceM: null,
    name: null,
    sets: [{ exercise: "pushup", reps: 40 }],
  } as unknown as Parameters<typeof activityItem>[0]),
  ...over,
})

beforeEach(() => {
  signedInAs = "u-1"
  sent.length = 0
  activityRows = [workout()]
  ledgerRows = [{ skillId: "strength", reason: "work", xpAwarded: 120, xpRulesVersion: 1, isFloor: false }]
})

describe("/workouts/:id", () => {
  it("is a plain record: the date, what was logged, the XP earned", async () => {
    const html = await render()
    expect(html).toContain("Wed 4 Nov 2026")
    expect(html).toMatch(/data-logged=""[\s\S]*40/)
    expect(html).toMatch(/data-earned=""[\s\S]*\+120 XP/)
  })

  it("carries none of the run page: no Relive, no Return from the Fog, no map of its own", async () => {
    const html = await render()
    expect(html).not.toMatch(/Relive|⟲|Return from the Fog/i)
    expect(html).not.toMatch(/maplibre|<canvas/i)
  })

  it("WRITES NOTHING: every command reopening it sends is a read (D-135)", async () => {
    await render()
    await render()
    expect(sent.length).toBeGreaterThan(0)
    expect(new Set(sent.map((c) => c.name))).toEqual(new Set(["QueryCommand"]))
    // The ledger read is filtered to the session's account, and nothing else touches the ledger.
    const ledgerReads = sent.filter((c) => c.input.TableName === "TestLedger")
    expect(ledgerReads.every((c) => (c.input.ExpressionAttributeValues as Record<string, unknown>)[":u"] === "u-1")).toBe(true)
  })

  it("404s another user's activity, a run, and no session — the same 404 each time", async () => {
    activityRows = [workout({ userId: "u-2" })]
    await expect(render()).rejects.toThrow("NOT_FOUND")
    activityRows = [workout({ hasTrace: true, traceRef: "users/u-1/traces/w-1.segments.json.gz" })]
    await expect(render()).rejects.toThrow("NOT_FOUND")
    signedInAs = undefined
    await expect(render()).rejects.toThrow("NOT_FOUND")
  })

  it("a failed ledger read costs the XP lines, never the record", async () => {
    const real = ddb.send
    ddb.send = async (c) => {
      if (c.input.TableName === "TestLedger") throw new Error("throttled")
      return real(c)
    }
    try {
      const html = await render()
      expect(html).toContain("Wed 4 Nov 2026")
      expect(html).toContain("data-xp-unavailable")
    } finally {
      ddb.send = real
    }
  })
})
