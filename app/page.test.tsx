import { isValidElement, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * TICKET 0186, CRITERION 4: WHAT A SIGNED-OUT VISITOR TO `/` IS SENT.
 *
 * `/` is the signed-out landing route, so the element tree this server component returns is the
 * payload anyone who finds the site can fetch. It must carry neither the configured home
 * (`0053`) nor the most recent run's centre (`0186`). The second is structurally absent — the run
 * reaches the browser only through the session-gated `/api/runs/latest` — and this test is what
 * keeps it absent if someone later moves the read server-side "to avoid the jump".
 *
 * The client components are stubbed: they are not what is under test, and `MapShell` imports
 * MapLibre's CSS. The stubs keep their props, which is exactly the payload.
 */
vi.mock("next/headers", () => ({ cookies: () => ({}), headers: async () => new Headers() }))

const authenticated = vi.fn<() => boolean>()
vi.mock("@/lib/amplify-server", () => ({
  runWithAmplifyServerContext: async () => authenticated(),
}))
vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => (authenticated() ? "sub-1" : undefined),
}))
vi.mock("@/components/map/map-shell", () => ({ MapShell: () => null }))
vi.mock("@/components/map/explored-provider", () => ({
  ExploredProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/components/map/fog-status", () => ({ FogStatus: () => null }))
vi.mock("@/components/sync-button", () => ({ SyncButton: () => null }))
vi.mock("@/lib/runs/server", () => {
  throw new Error("/ must not read activity data on the server (0186)")
})

const { default: Home } = await import("./page")
const { MapShell } = await import("@/components/map/map-shell")

const ENV = { ...process.env }
afterEach(() => {
  process.env = { ...ENV }
  vi.clearAllMocks()
})

/** Every prop in the tree, flattened to one string. Functions (the stubs) drop out. */
function payload(node: unknown): string {
  return JSON.stringify(node, (key, value) => (key === "_owner" || key === "_store" ? undefined : value))
}

function propsOf(node: unknown, type: unknown): Record<string, unknown> | undefined {
  if (!isValidElement(node)) return undefined
  if (node.type === type) return node.props as Record<string, unknown>
  const children = (node.props as { children?: unknown }).children
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = propsOf(child, type)
    if (found) return found
  }
  return undefined
}

describe("the signed-out payload of / (0186)", () => {
  it("carries no coordinate: neither the configured home nor a run's centre", async () => {
    process.env.LOST_SOLES_HOME_LAT = "27.1234"
    process.env.LOST_SOLES_HOME_LNG = "-82.5678"
    authenticated.mockReturnValue(false)

    const tree = await Home()

    expect(propsOf(tree, MapShell)).toStrictEqual({ home: null })
    const body = payload(tree)
    expect(body).not.toContain("27.1234")
    expect(body).not.toContain("-82.5678")
  })

  it("does carry the configured home once signed in, so the test above can fail", async () => {
    process.env.LOST_SOLES_HOME_LAT = "27.1234"
    process.env.LOST_SOLES_HOME_LNG = "-82.5678"
    authenticated.mockReturnValue(true)

    const tree = await Home()

    expect(payload(tree)).toContain("27.1234")
  })
})
