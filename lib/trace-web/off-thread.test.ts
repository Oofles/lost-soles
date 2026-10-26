import { afterEach, describe, expect, it, vi } from "vitest"

import type { Position } from "@/src/domain/simplify-line"

import { buildWebOffThread, resetOffThread, type WebSource } from "./off-thread"
import { packWeb, unpackWeb } from "./pack"
import { buildWeb, type WebRunInput } from "./web"
import { workerCore, type BuildRequest } from "./worker-core"

/**
 * Ticket `0259`. The web built in a worker is the web built here, number for number.
 * GEOMETRY IS SYNTHETIC, near Point Nemo — `08-security-privacy.md` §7.2, D-199.
 */

const NEMO = { lat: -48.876, lng: -123.393 }
const R_EARTH = 6_371_008.8
const RAD = Math.PI / 180

/** A wiggly line east, `km` long, `northM` north of Nemo: enough pieces and wear steps to be a real web. */
function wiggle(km: number, northM: number, phase: number): Position[] {
  const out: Position[] = []
  const kx = R_EARTH * RAD * Math.cos(NEMO.lat * RAD)
  for (let m = 0; m <= km * 1000; m += 3) {
    const y = northM + 6 * Math.sin(m / 40 + phase)
    out.push([NEMO.lng + m / kx, NEMO.lat + y / (R_EARTH * RAD)])
  }
  return out
}

const RUNS: WebRunInput[] = Array.from({ length: 12 }, (_, i) => ({
  activityId: `r${i}`,
  startedAt: `2026-09-${String(i + 1).padStart(2, "0")}T07:00:00Z`,
  lines: [wiggle(1 + (i % 3) * 0.5, (i % 4) * 30, i), ...(i % 5 === 0 ? [wiggle(0.4, 200, i)] : [])],
}))

const source = (key = 1): WebSource => ({ key, text: JSON.stringify({ runs: RUNS }), runs: RUNS })

describe("pack", () => {
  it("round-trips the drawn web exactly", () => {
    for (const web of [buildWeb(RUNS), buildWeb(RUNS, { exclude: "r11" }), buildWeb([])]) {
      expect(unpackWeb(packWeb(web))).toStrictEqual(web)
    }
    expect(buildWeb(RUNS).features.length).toBeGreaterThan(5)
  })
})

describe("workerCore", () => {
  const unpacked = (r: ReturnType<ReturnType<typeof workerCore>>) => {
    if (!r.response.ok) throw new Error(r.response.error)
    return unpackWeb(r.response.web)
  }

  it("builds with and without a run from the body text, and transfers the buffers", () => {
    const handle = workerCore()
    const req: BuildRequest = { id: 1, key: 1, text: source().text }
    const all = handle(req)
    expect(unpacked(all)).toStrictEqual(buildWeb(RUNS))
    expect(all.transfer).toHaveLength(3)
    expect(unpacked(handle({ ...req, id: 2, exclude: "r11" }))).toStrictEqual(buildWeb(RUNS, { exclude: "r11" }))
  })

  it("parses a body once per key", () => {
    const parse = vi.spyOn(JSON, "parse")
    const handle = workerCore()
    const text = source().text
    handle({ id: 1, key: 7, text })
    handle({ id: 2, key: 7, text, exclude: "r3" })
    expect(parse).toHaveBeenCalledTimes(1)
    handle({ id: 3, key: 8, text })
    expect(parse).toHaveBeenCalledTimes(2)
    parse.mockRestore()
  })

  it("answers a bad body with an error, not a throw", () => {
    const r = workerCore()({ id: 4, key: 1, text: "{" })
    expect(r.response).toMatchObject({ id: 4, ok: false })
  })
})

/** A `Worker` that runs `workerCore` on a macrotask, as a real one answers on its own thread. */
class FakeWorker {
  static made = 0
  static failToLoad = false
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null
  private handle = workerCore()
  constructor() {
    FakeWorker.made++
  }
  postMessage(data: BuildRequest) {
    setTimeout(() => {
      if (FakeWorker.failToLoad) return this.onerror?.({ message: "no chunk", preventDefault() {} })
      this.onmessage?.({ data: this.handle(data).response })
    }, 0)
  }
  terminate() {}
}

describe("buildWebOffThread", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetOffThread()
    FakeWorker.made = 0
    FakeWorker.failToLoad = false
  })

  it("with no Worker, builds here: the same web", async () => {
    resetOffThread()
    expect(await buildWebOffThread(source())).toStrictEqual(buildWeb(RUNS))
  })

  it("in workers, builds the same web, two at once", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    resetOffThread()
    const [all, before] = await Promise.all([
      buildWebOffThread(source()),
      buildWebOffThread(source(), { exclude: "r11" }),
    ])
    expect(all).toStrictEqual(buildWeb(RUNS))
    expect(before).toStrictEqual(buildWeb(RUNS, { exclude: "r11" }))
    expect(FakeWorker.made).toBe(2)
    // A third build reuses an idle worker rather than spawning one.
    await buildWebOffThread(source(2))
    expect(FakeWorker.made).toBe(2)
  })

  it("a worker that will not load falls back to the main thread, for pending and later builds", async () => {
    vi.stubGlobal("Worker", FakeWorker)
    resetOffThread()
    FakeWorker.failToLoad = true
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await buildWebOffThread(source(), { exclude: "r0" })).toStrictEqual(buildWeb(RUNS, { exclude: "r0" }))
    expect(await buildWebOffThread(source())).toStrictEqual(buildWeb(RUNS))
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
})
