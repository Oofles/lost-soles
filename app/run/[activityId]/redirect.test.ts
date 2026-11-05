import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Ticket `0345`, D-486 — `/run/:id` for a TRACELESS activity goes to `/workouts/:id`, before any of
 * the run page's reads (the XP-before fold, the history, the basemap names) start. An old link or a
 * pasted URL to a workout never renders the run page, which has nothing to show for it.
 */

vi.mock("@/lib/auth/owner", () => ({ currentUserId: async () => "u-1", isOwner: () => true }))
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND")
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`)
  },
}))

let summary: Record<string, unknown> | null = null
vi.mock("@/lib/runs/server", () => ({
  defaultRunReadDeps: () => ({}),
  runById: async () => summary,
}))
const xpBeforeRun = vi.fn(async () => ({}))
vi.mock("@/lib/runs/tally-server", () => ({ ledgerTableName: () => "L", xpBeforeRun: (...a: unknown[]) => xpBeforeRun(...(a as [])) }))
const historyUpTo = vi.fn(async () => [])
vi.mock("@/lib/runs/chronicle-server", () => ({
  historyUpTo: (...a: unknown[]) => historyUpTo(...(a as [])),
  namesFor: async () => null,
  chronicleFor: () => ({ text: "" }),
}))
vi.mock("@/lib/map-home", () => ({ homeCameraForSession: async () => null }))
vi.mock("@/lib/place-names", () => ({ basemapPlaceNames: () => ({}) }))
vi.mock("./run-moment", () => ({ RunMoment: () => null }))
vi.mock("@/components/map/explored-provider", () => ({ ExploredProvider: () => null }))

const { default: RunMomentPage } = await import("./page")
const open = (id: string) => RunMomentPage({ params: Promise.resolve({ activityId: id }), searchParams: Promise.resolve({}) })

beforeEach(() => {
  xpBeforeRun.mockClear()
  historyUpTo.mockClear()
})

describe("/run/:id for a workout", () => {
  it("redirects to /workouts/:id and reads nothing else", async () => {
    summary = { activityId: "w-1", startedAt: "2026-11-04T23:00:00.000Z", traced: false }
    await expect(open("w-1")).rejects.toThrow("REDIRECT /workouts/w-1")
    expect(xpBeforeRun).not.toHaveBeenCalled()
    expect(historyUpTo).not.toHaveBeenCalled()
  })

  it("renders the run page for a traced run, and for a summary that predates the flag", async () => {
    for (const traced of [true, undefined]) {
      summary = { activityId: "a-9", startedAt: "2026-08-28T11:00:00.000Z", route: { features: [] }, ...(traced === undefined ? {} : { traced }) }
      await expect(open("a-9")).resolves.toBeTruthy()
    }
  })
})
