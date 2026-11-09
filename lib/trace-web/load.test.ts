import { afterEach, describe, expect, it, vi } from "vitest"

import { RunFetchError } from "@/lib/runs/client"

import { loadDrawnWeb } from "./load"
import { resetWebRuns, webRuns } from "./runs"
import { buildWeb, EMPTY_WEB, type WebRunInput } from "./web"

/**
 * Ticket `0321`, criterion 3. A 413 from Amplify's ~5.94 MB response cap (D-460) — empty body, as
 * measured — or any other non-2xx from `/api/runs/web` leaves the map usable without the web.
 * GEOMETRY IS SYNTHETIC, near Point Nemo — `08-security-privacy.md` §7.2, D-199.
 */

const RUNS: WebRunInput[] = [{ activityId: "a-1", startedAt: "2026-09-02T07:00:00Z", lines: [[[-123.393, -48.876], [-123.392, -48.876]]] }]
const ok = () => new Response(JSON.stringify({ runs: RUNS }), { status: 200 })
const status = (code: number) => () => new Response(null, { status: code })
const build = async (s: { runs: WebRunInput[] }) => buildWeb(s.runs)

afterEach(() => {
  resetWebRuns()
  vi.restoreAllMocks()
})

describe("loadDrawnWeb — the map's web, when the fetch fails (0321)", () => {
  it.each([413, 500, 502, 503])("a %i resolves to no web, logged once, never a rejection", async (code) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetch = vi.fn(status(code)) as unknown as typeof globalThis.fetch
    await expect(loadDrawnWeb(1, { fetch, build })).resolves.toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0]![0])).toContain("trace web: fetch failed")
  })

  it("does not cache the failure: the next generation's ask fetches again and draws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const fetch = vi.fn().mockImplementationOnce(status(413)).mockImplementationOnce(ok) as unknown as typeof globalThis.fetch
    await expect(loadDrawnWeb(1, { fetch, build })).resolves.toBeNull()
    const web = await loadDrawnWeb(1, { fetch, build })
    expect(web).toEqual(buildWeb(RUNS))
    expect(web).not.toEqual(EMPTY_WEB)
  })

  it("a 413 reaches the run index and region list as a typed rejection, which both swallow", async () => {
    const fetch = vi.fn(status(413)) as unknown as typeof globalThis.fetch
    const err = await webRuns(2, fetch).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RunFetchError)
    expect((err as RunFetchError).status).toBe(413)
  })
})
