import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchChroniclePage } from "@/lib/chronicle/transport"
import { httpLastRunFetch } from "@/lib/fog/last-run"
import { httpTransport } from "@/lib/fog/transport"
import { fetchLatestRun, fetchRunFacts, fetchTraceWebRuns } from "@/lib/runs/client"

import { API_TIMEOUT_MS, ApiTimeoutError } from "./timeout"

/**
 * TICKET `0113`, `06-ui-ux.md` §9.5 — the rules that hold across the whole browser app rather than
 * inside one module. Each is a source scan or a hung-endpoint test, because each is a thing a later
 * change could quietly undo in a file this ticket never touched.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const SCANNED = ["app", "components", "lib"]

function sources(): { path: string; text: string; code: string }[] {
  const out: { path: string; text: string; code: string }[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        if (name !== "node_modules" && name !== "__fixtures__") walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue
      const text = readFileSync(full, "utf8")
      out.push({ path: relative(ROOT, full), text, code: stripComments(text) })
    }
  }
  for (const dir of SCANNED) walk(join(ROOT, dir))
  return out
}

/** Block and line comments out, so a comment that says "no spinner" is not read as one. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

const ALL = sources()

describe("0113 — source rules", () => {
  it("scans the app", () => {
    expect(ALL.length).toBeGreaterThan(100)
  })

  /** Criterion 5. */
  it("has no navigator.onLine, and no UI driven by connectivity events", () => {
    expect(ALL.filter((f) => /navigator\s*\.\s*onLine/.test(f.code)).map((f) => f.path)).toEqual([])
    expect(ALL.filter((f) => /["']offline["']/.test(f.code)).map((f) => f.path)).toEqual([])
    /**
     * One `online` listener, and it is not UI: `LogQueueRunner` renders `null` and uses the event
     * only to skip the write queue's backoff (`06` §6.4, D-282).
     */
    expect(ALL.filter((f) => /["']online["']/.test(f.code)).map((f) => f.path)).toEqual([
      "components/log-queue-runner.tsx",
    ])
    expect(readFileSync(join(ROOT, "components/log-queue-runner.tsx"), "utf8")).toMatch(/return null\s*\n\s*\}\s*$/)
  })

  /**
   * Criterion 5: no offline banner, no connectivity toast. Text a person would read about the network
   * being gone. `lib/fog/boot.ts`'s note is the one exemption: it is a `FogState.message` on a `ready`
   * state, which `FogStatus` prints only inside the `?fog=debug` readout.
   */
  it("says nothing on screen about being offline", () => {
    const banner = /\b(you(?:'|’)re offline|you are offline|no connection|no internet|connection lost|offline mode)/i
    const hits = ALL.filter((f) => banner.test(f.code)).map((f) => f.path)
    expect(hits).toEqual([])
    const offlineWord = ALL.filter((f) => /["'`][^"'`]*\bOffline\b/.test(f.code)).map((f) => f.path)
    expect(offlineWord).toEqual(["lib/fog/boot.ts"])
    const status = readFileSync(join(ROOT, "components/map/fog-status.tsx"), "utf8")
    expect(status).toMatch(/if \(!debug\) return null/)
  })

  /** Criterion 4, the grep half: no checkerboard asset, no spinner, no busy indicator anywhere. */
  it("has no checkerboard and no spinner", () => {
    const shapes = /checker|spinner|role=["']progressbar|aria-busy|<progress\b|animation:\s*["']?spin/i
    expect(ALL.filter((f) => shapes.test(f.code)).map((f) => f.path)).toEqual([])
    const assets: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/checker|spinner|loading/i.test(name)) assets.push(relative(ROOT, full))
      }
    }
    walk(join(ROOT, "public"))
    walk(join(ROOT, "app"))
    expect(assets).toEqual([])
  })

  /**
   * Criterion 6, the coverage half. Every browser call to the API runs inside `withApiTimeout`: any
   * file that calls `fetch` or builds Amplify's data client imports it. The exemptions do not run in
   * the browser against this app's API, and each says why.
   */
  it("every file that calls the API imports the 10 s timeout", () => {
    const EXEMPT = new Map([
      ["lib/auth/bearer.ts", "edge middleware; aws-jwt-verify fetches Cognito's JWKS server-side"],
      ["lib/tickets/github.ts", "server-side GitHub capture, never the browser"],
      ["lib/fog/perf/dataset-source.ts", "?fog=perf only: a static fixture from /fog-fixtures, not the API"],
    ])
    const calls = ALL.filter(
      (f) =>
        !f.path.startsWith("app/api/") &&
        (/\bfetch(Impl)?\(/.test(f.code) || /\bgenerateClient\b/.test(f.code)),
    ).map((f) => f.path)
    const missing = calls.filter((p) => !EXEMPT.has(p) && !/withApiTimeout/.test(ALL.find((f) => f.path === p)!.code))
    expect(calls.length).toBeGreaterThan(5)
    expect(missing).toEqual([])
  })
})

describe("0113 — every fetch transport gives up at 10 s on a hung endpoint", () => {
  afterEach(() => vi.useRealTimers())

  /** Never answers, and ignores its abort signal too: the worst endpoint there is. */
  const hung = (() => new Promise<Response>(() => {})) as unknown as typeof fetch

  const cases: [string, () => Promise<unknown>][] = [
    ["GET /api/fog/update", () => httpTransport(hung).update(42)],
    ["GET /api/fog/blob", () => httpTransport(hung).blob(42)],
    ["GET /api/fog/lastrun", () => httpLastRunFetch(hung)(42)],
    ["GET /api/runs/latest", () => fetchLatestRun(hung)],
    ["GET /api/runs/web", () => fetchTraceWebRuns(hung)],
    ["GET /api/runs/summary", () => fetchRunFacts(["a"], hung)],
    ["GET /api/runs/chronicle", () => fetchChroniclePage("cursor", hung)],
  ]

  it.each(cases)("%s", async (_name, call) => {
    vi.useFakeTimers()
    const caught = call().catch((e: unknown) => e)
    let settled = false
    void caught.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await caught).toBeInstanceOf(ApiTimeoutError)
  })

  it("passes the abort signal to fetch, so a hung connection is released", async () => {
    const seen: (AbortSignal | undefined)[] = []
    const spy = (async (_url: string, init?: RequestInit) => {
      seen.push(init?.signal ?? undefined)
      return new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), { status: 200 })
    }) as unknown as typeof fetch
    await fetchLatestRun(spy)
    await httpTransport(spy).update(null).catch(() => {})
    expect(seen).toHaveLength(2)
    for (const s of seen) expect(s).toBeInstanceOf(AbortSignal)
  })
})
