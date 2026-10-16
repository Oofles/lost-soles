import { describe, expect, it, vi, beforeEach } from "vitest"

import { connectableSources } from "@/src/adapters/registry"

/**
 * Ticket 0281 — the press no longer asks about failed imports.
 *
 * `0044` read the `failedByUser` index after every sweep to append "N activities failed to
 * import". D-318 shows a failed import nowhere, so that Query was paid per press for a
 * count nobody read. These tests pin the removal: the read is never issued, and the
 * summary carries no failure count for anything to consume.
 *
 * The receipt module is still mocked so a regression that re-imports the read is caught
 * here rather than by a DynamoDB call the mocked client would silently swallow.
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

beforeEach(() => {
  signedInAs = OWNER
  owners = [OWNER]
  listFailedReceipts.mockReset()
  listFailedReceipts.mockResolvedValue([])
  syncSource.mockReset()
  syncSource.mockResolvedValue({ sourceId: SOURCE, kind: "nothing-new" })
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("a Sync press does not query failed receipts (0281, D-318)", () => {
  it("sweeps and reports what it queued without reading the failure index", async () => {
    syncSource.mockResolvedValue({ sourceId: SOURCE, kind: "queued", queued: 3, alreadyKnown: 0 })

    const summary = await syncNow()

    expect(summary.line).toBe("3 activities queued.")
    expect(summary).not.toHaveProperty("failedCount")
    expect(listFailedReceipts).not.toHaveBeenCalled()
  })

  it("says nothing about failures even when some are outstanding", async () => {
    listFailedReceipts.mockResolvedValue([{ ingestKey: "k-0" }])

    const summary = await syncNow()

    expect(summary.line).not.toContain("failed to import")
    expect(listFailedReceipts).not.toHaveBeenCalled()
  })

  /** The user id is derived from the session, never accepted — §5.3, and 0043's criterion 2. */
  it("sweeps only for the signed-in user", async () => {
    await syncNow()

    expect(syncSource.mock.calls[0][0]).toBe(OWNER)
  })

  it("does nothing for a request with no session", async () => {
    signedInAs = undefined

    const summary = await syncNow()

    expect(summary).toEqual({ line: "Not signed in.", outcomes: [] })
    expect(syncSource).not.toHaveBeenCalled()
  })
})
