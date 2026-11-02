import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `/api/skills/{state,ledger,profile,landmarks}` — ticket `0331`, D-472.
 *
 * The session and the readers are mocked; the status codes, the cache header and which uid reaches
 * a reader are real. The uid is the session's and nothing else: a `uid`/`userId` in the query string
 * is ignored, and `state` and `profile` take no `Request` at all.
 */

let signedInAs: string | undefined

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
}))

const readers = {
  skillStates: vi.fn(),
  recentLedger: vi.fn(),
  skillLedger: vi.fn(),
  replayInProgress: vi.fn(),
  landmarks: vi.fn(),
}

vi.mock("@/lib/skills/server", () => ({
  defaultSkillReadDeps: () => ({ ddb: {}, ledgerTable: "T4", skillStateTable: "T2", profileTable: "T1", landmarkTable: "L" }),
  skillStates: (...a: unknown[]) => readers.skillStates(...a),
  recentLedger: (...a: unknown[]) => readers.recentLedger(...a),
  skillLedger: (...a: unknown[]) => readers.skillLedger(...a),
  replayInProgress: (...a: unknown[]) => readers.replayInProgress(...a),
  landmarks: (...a: unknown[]) => readers.landmarks(...a),
}))

const state = await import("./state/route")
const ledger = await import("./ledger/route")
const profile = await import("./profile/route")
const landmarks = await import("./landmarks/route")

const req = (path: string) => new Request(`https://soles.devaultsecurity.com${path}`)

beforeEach(() => {
  for (const r of Object.values(readers)) {
    r.mockReset()
    r.mockResolvedValue([])
  }
  readers.replayInProgress.mockResolvedValue(false)
})

describe("signed out", () => {
  it("every route 404s with the middleware's body and reads nothing", async () => {
    signedInAs = undefined
    const responses = [
      await state.GET(),
      await profile.GET(),
      await ledger.GET(req("/api/skills/ledger")),
      await ledger.GET(req("/api/skills/ledger?skill=athletics")),
      await landmarks.GET(req("/api/skills/landmarks")),
    ]
    for (const r of responses) {
      expect(r.status).toBe(404)
      expect(await r.json()).toEqual({ error: "not found" })
      expect(r.headers.get("cache-control")).toBe("no-store, private")
    }
    for (const r of Object.values(readers)) expect(r).not.toHaveBeenCalled()
  })
})

describe("signed in", () => {
  beforeEach(() => {
    signedInAs = "u-session"
  })

  it("state: the session's SkillState rows, and the handler takes no Request", async () => {
    readers.skillStates.mockResolvedValueOnce([{ skillId: "athletics", xp: 120, levelHighWater: 4 }])
    const r = await state.GET()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual([{ skillId: "athletics", xp: 120, levelHighWater: 4 }])
    expect(readers.skillStates.mock.calls[0]![0]).toBe("u-session")
    expect(state.GET.length).toBe(0)
    expect(r.headers.get("cache-control")).toBe("no-store, private")
  })

  it("profile: the flag only, for the session's uid", async () => {
    readers.replayInProgress.mockResolvedValueOnce(true)
    const r = await profile.GET()
    expect(await r.json()).toEqual({ replayInProgress: true })
    expect(readers.replayInProgress.mock.calls[0]![0]).toBe("u-session")
    expect(profile.GET.length).toBe(0)
  })

  it("ledger: recent rows by default, one skill's with ?skill=, and a uid in the query is ignored", async () => {
    await ledger.GET(req("/api/skills/ledger?uid=u-other&userId=u-other"))
    expect(readers.recentLedger.mock.calls[0]![0]).toBe("u-session")
    expect(readers.skillLedger).not.toHaveBeenCalled()

    await ledger.GET(req("/api/skills/ledger?skill=athletics&uid=u-other"))
    expect(readers.skillLedger.mock.calls[0]!.slice(0, 2)).toEqual(["u-session", "athletics"])
  })

  it("ledger: a skill id that could change a composite key prefix is refused", async () => {
    const r = await ledger.GET(req(`/api/skills/ledger?skill=${encodeURIComponent("athletics#x")}`))
    expect(r.status).toBe(400)
    expect(readers.skillLedger).not.toHaveBeenCalled()
  })

  it("landmarks: every one, or one skill's, for the session's uid only", async () => {
    await landmarks.GET(req("/api/skills/landmarks?uid=u-other"))
    expect(readers.landmarks.mock.calls[0]!.slice(0, 2)).toEqual(["u-session", undefined])
    await landmarks.GET(req("/api/skills/landmarks?skill=wayfaring&userId=u-other"))
    expect(readers.landmarks.mock.calls[1]!.slice(0, 2)).toEqual(["u-session", "wayfaring"])
  })
})
