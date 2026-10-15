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

vi.mock("aws-amplify/auth", () => ({ signOut: async () => {} }))

const { default: Settings } = await import("./page")
const { DisconnectControl } = await import("./settings-controls")

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

    // Ticket 0089: the page shows only the Disconnect trigger; the POST form lives in
    // the one confirmation (criterion 3), rendered at that stage here.
    const html = await render()
    expect(html).toContain(">Disconnect</button>")
    expect(html).not.toContain(`action="/api/auth/${SOURCE}/disconnect"`)

    const confirming = renderToStaticMarkup(
      <DisconnectControl
        action={`/api/auth/${SOURCE}/disconnect`}
        displayName={CONNECTOR.displayName}
        initialStage="confirming"
      />,
    )
    // A GET that revokes a credential is one <img> tag away from being fired by any
    // page the operator visits.
    expect(confirming).toContain(`method="post"`)
    expect(confirming).toContain(`action="/api/auth/${SOURCE}/disconnect"`)
    // 08 §6.5 — conflating disconnect with deletion is how someone destroys years of
    // data while trying to stop a sync.
    expect(confirming).toContain("This is not account deletion")
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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET 0089 — the four things, and nothing else
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ACTIVE = {
  sourceId: SOURCE,
  externalOwnerId: "134815",
  scopes: CONNECTOR.requiredScopes.slice(),
  expiresAt: 1794700000,
  status: "ACTIVE",
  connectedAt: "2026-09-04T14:37:00.000Z",
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("0089 — the screen", () => {
  it("offers sign out, the deletion entry and build info, connected or not", async () => {
    for (const account of [null, ACTIVE]) {
      getSourceAccountSummary.mockResolvedValue(account)
      const t = text(await render())
      expect(t).toContain("Sign out")
      expect(t).toContain("Delete account")
      expect(t).toMatch(/Build \S+ · \S+/)
    }
  })

  it("puts the deletion entry AFTER sign out, under its own heading, far from disconnect", async () => {
    getSourceAccountSummary.mockResolvedValue(ACTIVE)
    const html = await render()
    const disconnect = html.indexOf(">Disconnect</button>")
    const signOut = html.indexOf(">Sign out</button>")
    const deletion = html.indexOf('id="delete-account"')
    expect(disconnect).toBeGreaterThan(-1)
    expect(signOut).toBeGreaterThan(disconnect)
    expect(deletion).toBeGreaterThan(signOut)
    // The trigger only opens the typed confirmation — no form, no POST, no link yet.
    const tail = html.slice(deletion)
    expect(tail).not.toContain("<form")
    expect(tail).not.toContain("runbook")
  })

  it("says after a disconnect that the map, levels and history are kept", async () => {
    getSourceAccountSummary.mockResolvedValue({ ...ACTIVE, status: "DISCONNECTED" })
    const t = text(await render({ connect: "disconnected", source: SOURCE }))
    expect(t).toContain("Your map, your levels and your history are all still here")
    expect(t).toContain(`Connect ${CONNECTOR.displayName}`)
  })

  it("renders a DISCONNECTED row the user never touched (inbound deauthorization) as reconnectable", async () => {
    // 0093's webhook flips the row with no visit to /settings and no outcome param.
    getSourceAccountSummary.mockResolvedValue({ ...ACTIVE, status: "DISCONNECTED" })
    const html = await render()
    expect(text(html)).toContain("Not connected (disconnected)")
    expect(html).toContain(`href="/api/auth/${SOURCE}/start"`)
    expect(html).not.toContain(">Disconnect</button>")
  })

  it("lets a signed-in non-owner sign out, and shows them nothing else of substance", async () => {
    signedInAs = "b3f1c2d4-0000-4000-8000-000000000002"
    const t = text(await render())
    expect(t).toContain("Sign out")
    expect(t).not.toContain("Delete account")
  })
})

/**
 * Criterion 9. A PREFERENCE CONTROL is anything that holds a choice the user then has
 * to maintain: a select, checkbox, radio, range, colour or number input, a switch, or
 * a toggle button. It is asserted over every stage of every control the page can
 * render, not only the first paint, because a toggle hidden behind a click is still a
 * toggle.
 *
 * The one text input on the screen is the deletion phrase, which holds nothing: it is
 * cleared on cancel and never stored. It is named, so a second text input fails.
 */
describe("0089 — no preference control of any kind (criterion 9)", () => {
  const PREFERENCE = [
    /<select\b/i,
    /<textarea\b/i,
    /type="(checkbox|radio|range|color|number|date|time)"/i,
    /role="(switch|checkbox|radio|slider|listbox|combobox|menuitemcheckbox|menuitemradio)"/i,
    /aria-pressed=/i,
    /aria-checked=/i,
    /\b(theme|units?|notification|sound|dark mode|light mode|preferences?)\b/i,
  ]

  async function everyStage(): Promise<string[]> {
    const { DeletionEntry } = await import("./settings-controls")
    const pages: string[] = []
    for (const account of [null, ACTIVE, { ...ACTIVE, status: "NEEDS_REAUTH" }]) {
      getSourceAccountSummary.mockResolvedValue(account)
      pages.push(await render())
    }
    pages.push(
      renderToStaticMarkup(
        <DisconnectControl action="/x" displayName={CONNECTOR.displayName} initialStage="confirming" />,
      ),
      renderToStaticMarkup(<DeletionEntry initialStage="confirming" />),
      renderToStaticMarkup(<DeletionEntry initialStage="acknowledged" />),
    )
    return pages
  }

  it("finds none in the rendered tree, at any stage", async () => {
    for (const html of await everyStage()) {
      for (const pattern of PREFERENCE) expect(html, String(pattern)).not.toMatch(pattern)
    }
  })

  it("has exactly one text input anywhere, and it is the deletion phrase", async () => {
    const inputs = (await everyStage()).flatMap((html) => html.match(/<input\b[^>]*>/g) ?? [])
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toContain('type="text"')
    expect(inputs[0]).toContain('name="deletion-confirmation"')
  })

  it("the assertion fires on a toggle, so it is not vacuous", () => {
    const planted = renderToStaticMarkup(<input type="checkbox" />)
    expect(PREFERENCE.some((p) => p.test(planted))).toBe(true)
  })
})
