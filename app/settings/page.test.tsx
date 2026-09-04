import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { connectableSources, getOAuthConnector } from "@/src/adapters/registry"

/**
 * Ticket 0032 criterion 3 — the half of it a script can answer.
 *
 * The criterion is that a scope refusal is RENDERED, names the consequence, and offers
 * re-authorization with `approval_prompt=force`. Whether that message reads well while
 * standing outside after a run is a judgement only the operator can make (D-181), and
 * it stays in the ticket's Operator validation. Whether the words are on the screen at
 * all is mechanical, and it is asserted here.
 *
 * The source id and the expected copy both come from the registry — no vendor name
 * appears in this file, which `check-boundaries.mjs` scans (D-163 exempts nothing).
 */

const SOURCE = connectableSources()[0] as string
const CONNECTOR = getOAuthConnector(SOURCE)
const OWNER = "b3f1c2d4-0000-4000-8000-000000000001"

let signedInAs: string | undefined
let owners: string[] = []

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
  isOwner: (id: string | undefined) => id !== undefined && owners.includes(id),
}))

const getSourceAccountSummary = vi.fn()

vi.mock("@/lib/sources/source-account-store", () => ({
  getSourceAccountSummary: (...a: unknown[]) => getSourceAccountSummary(...a),
}))

const { default: Settings } = await import("./page")

const render = async (searchParams: Record<string, string> = {}) =>
  renderToStaticMarkup(await Settings({ searchParams: Promise.resolve(searchParams) }))

beforeEach(() => {
  signedInAs = OWNER
  owners = [OWNER]
  getSourceAccountSummary.mockResolvedValue(null)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("the scope refusal — criterion 3", () => {
  it("names the consequence, in the connector's own words", async () => {
    const html = await render({ connect: "scope-refused", source: SOURCE })

    // One string, so the screen and the check that refused cannot disagree about
    // what the user was told.
    expect(html).toContain("permanent hole around home")
    expect(html).toContain(CONNECTOR.scopeConsequence.slice(0, 40))
  })

  it("says plainly that nothing was saved", async () => {
    const html = await render({ connect: "scope-refused", source: SOURCE })
    expect(html).toContain("Nothing was saved")
    expect(html).not.toContain("Connected as athlete")
  })

  it("offers re-authorization with approval_prompt=force", async () => {
    // Without `force` the provider silently re-approves the same reduced grant and
    // the user never sees the permission they need to re-tick — so the retry would
    // land them back here with no way out.
    const html = await render({ connect: "scope-refused", source: SOURCE })
    expect(html).toContain(`/api/auth/${SOURCE}/start?force=1`)
  })

  it("does not show the refusal for a DIFFERENT source's outcome", async () => {
    const html = await render({ connect: "scope-refused", source: "somewhere-else" })
    expect(html).not.toContain("permanent hole around home")
  })
})

describe("the connected and disconnected states", () => {
  it("offers Connect when nothing is connected", async () => {
    const html = await render()
    expect(html).toContain(`/api/auth/${SOURCE}/start`)
    expect(html).toContain("Not connected")
  })

  it("NAMES THE SCOPES when connected, so a reduced grant is visible on screen", async () => {
    // The operator validation asks for exactly this: proof that the connection which
    // succeeded is the one with the full permission, not a reduced grant that happens
    // to look healthy.
    getSourceAccountSummary.mockResolvedValue({
      sourceId: SOURCE,
      externalOwnerId: "134815",
      scopes: CONNECTOR.requiredScopes.slice(),
      expiresAt: 1794700000,
      status: "ACTIVE",
      connectedAt: "2026-09-04T14:37:00.000Z",
    })

    const html = await render()
    expect(html).toContain("Connected as athlete 134815")
    expect(html).toContain(CONNECTOR.requiredScopes[0])
  })

  it("posts the disconnect and says it is not account deletion", async () => {
    getSourceAccountSummary.mockResolvedValue({
      sourceId: SOURCE,
      externalOwnerId: "134815",
      scopes: CONNECTOR.requiredScopes.slice(),
      expiresAt: 1794700000,
      status: "ACTIVE",
      connectedAt: "2026-09-04T14:37:00.000Z",
    })

    const html = await render()
    // A GET that revokes a credential is one <img> tag away from being fired by any
    // page the operator visits.
    expect(html).toContain(`method="post"`)
    expect(html).toContain(`action="/api/auth/${SOURCE}/disconnect"`)
    // 08 §6.5 — conflating disconnect with deletion is how someone destroys years of
    // data while trying to stop a sync.
    expect(html).toContain("this is not account deletion")
  })

  it("shows a NEEDS_REAUTH row as not connected, offering Connect", async () => {
    getSourceAccountSummary.mockResolvedValue({
      sourceId: SOURCE,
      externalOwnerId: "134815",
      scopes: CONNECTOR.requiredScopes.slice(),
      expiresAt: 1794700000,
      status: "NEEDS_REAUTH",
      connectedAt: "2026-09-04T14:37:00.000Z",
    })

    const html = await render()
    expect(html).toContain("needs reauth")
    expect(html).toContain(`/api/auth/${SOURCE}/start`)
  })

  it("renders nothing about sources for a signed-in non-owner", async () => {
    signedInAs = "b3f1c2d4-0000-4000-8000-000000000002"
    const html = await render()
    expect(html).not.toContain("/api/auth/")
    expect(getSourceAccountSummary).not.toHaveBeenCalled()
  })
})
