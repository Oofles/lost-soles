import { describe, expect, it, vi, beforeEach } from "vitest"

import { connectableSources } from "@/src/adapters/registry"

/**
 * Ticket 0044, criterion 4 — the WIRING, which is the half neither of the other two
 * tests can reach.
 *
 * `lib/sources/sync-message.test.ts` proves the sentence and
 * `src/pipeline/ingest-receipt.test.ts` proves the query. What sits between them is six
 * lines in `syncNow`: read the outstanding failures AFTER the sweep, pass the count to
 * the line, and never let that read fail the press. Each of those three is a decision
 * with a failure mode, and none of them is visible from either end.
 *
 * The one that matters most is the third. The activities are queued either way, and an
 * empty index is the common case — losing a real import's confirmation to a failed
 * report about a hypothetical failure would be the wrong trade on the one surface the
 * operator has for knowing whether their data arrived.
 *
 * NO VENDOR NAME. The source id comes from the registry, like `settings/page.test.tsx`
 * does it — `check-boundaries.mjs` scans `app/` (D-100).
 */

const SOURCE = connectableSources()[0] as string
const OWNER = "b3f1c2d4-0000-4000-8000-000000000001"

let signedInAs: string | undefined = OWNER
let owners: string[] = [OWNER]

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
  isOwner: (id: string | undefined) => id !== undefined && owners.includes(id),
}))

const listFailedReceipts = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => [])
const syncSource = vi.fn()

vi.mock("@/src/pipeline/ingest-receipt", () => ({
  listFailedReceipts: (...a: unknown[]) => listFailedReceipts(...a),
}))
vi.mock("@/lib/sources/sync", () => ({ syncSource: (...a: unknown[]) => syncSource(...a) }))
vi.mock("@/lib/sources/source-account-store", () => ({
  getSourceAccountSummary: async () => ({ status: "ACTIVE" }),
  readListSinceWatermark: async () => null,
  advanceListSinceWatermark: async () => {},
}))
vi.mock("@/lib/sources/adapter-credentials", () => ({ oauthCredentialsFor: () => ({}) }))
vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: class { send = async () => ({}) },
  SendMessageCommand: class {},
}))
vi.mock("@aws-sdk/client-dynamodb", () => ({ DynamoDBClient: class {} }))
vi.mock("@aws-sdk/lib-dynamodb", () => ({ DynamoDBDocumentClient: { from: () => ({}) } }))

const { syncNow } = await import("./sync-action")

const failed = (n: number) => Array.from({ length: n }, (_, i) => ({ ingestKey: `k-${i}` }))

beforeEach(() => {
  signedInAs = OWNER
  owners = [OWNER]
  listFailedReceipts.mockReset()
  listFailedReceipts.mockResolvedValue([])
  syncSource.mockReset()
  syncSource.mockResolvedValue({ sourceId: SOURCE, kind: "nothing-new" })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("outstanding failures reach the result line", () => {
  /**
   * THE CASE THE TICKET IS ABOUT. `09-roadmap.md` §2.3 shipped this milestone with "no
   * error surface — the user finds out because the map did not change". A sweep that
   * finds nothing new while an earlier import is broken used to render as "Nothing new."
   */
  it("reports a failure a previous press left behind", async () => {
    listFailedReceipts.mockResolvedValue(failed(1))

    const summary = await syncNow()

    expect(summary.failedCount).toBe(1)
    expect(summary.line).toContain("1 activity failed to import.")
  })

  it("says nothing about failures when there are none", async () => {
    const summary = await syncNow()

    expect(summary.failedCount).toBe(0)
    expect(summary.line).not.toContain("failed to import")
  })

  /** The user id is derived from the session, never accepted — §5.3, and 0043's criterion 2. */
  it("asks only about the signed-in user's failures", async () => {
    await syncNow()

    expect(listFailedReceipts.mock.calls[0][0]).toBe(OWNER)
  })

  /**
   * READ AFTER THE SWEEP, NOT BEFORE. A receipt this press just re-enqueued has had its
   * failure fields cleared at the score gate (D-209), so reading first would report a
   * failure that the press the operator is waiting on has already sent for retry.
   */
  it("reads the failures after the sweep, not before it", async () => {
    const order: string[] = []
    syncSource.mockImplementation(async () => {
      order.push("sweep")
      return { sourceId: SOURCE, kind: "nothing-new" }
    })
    listFailedReceipts.mockImplementation(async () => {
      order.push("read-failures")
      return []
    })

    await syncNow()

    expect(order).toEqual(["sweep", "read-failures"])
  })

  /**
   * A FAILED REPORT MUST NOT FAIL THE PRESS. The activities are queued either way. Losing
   * a real import's confirmation to a broken report about a hypothetical failure is the
   * wrong trade on the one surface that says whether the data arrived.
   */
  it("still reports the sweep when the failure query itself breaks", async () => {
    listFailedReceipts.mockRejectedValue(new Error("ProvisionedThroughputExceeded"))
    syncSource.mockResolvedValue({
      sourceId: SOURCE,
      kind: "queued",
      queued: 3,
      alreadyKnown: 0,
    })

    const summary = await syncNow()

    expect(summary.line).toContain("3 activities queued.")
    expect(summary.failedCount).toBe(0)
  })

  /** Nobody signed in is asked about nobody's failures. */
  it("does not query for a request with no session", async () => {
    signedInAs = undefined

    const summary = await syncNow()

    expect(summary).toEqual({ line: "Not signed in.", outcomes: [], failedCount: 0 })
    expect(listFailedReceipts).not.toHaveBeenCalled()
  })
})
