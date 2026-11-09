import { gunzipSync } from "node:zlib"

import { describe, expect, it } from "vitest"

import type { WebRunInput } from "@/lib/trace-web/web"

import { AMPLIFY_RESPONSE_CAP_BYTES, encodeWebBody } from "./web-body"

/**
 * Ticket `0321`, criterion 1. The trace web at year-five scale, as D-451 sized it: 1,000 runs of
 * 8 km at the noisy ~96 points a km, the worst density it measured. Coordinates are a seeded
 * random walk of ~10 m steps rounded to 5 decimals, as `trace-web-store.ts`'s `round5` stores
 * them, so the body compresses like real traces rather than like a repeated string.
 */
function yearFive(): WebRunInput[] {
  let seed = 0x0321
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const round5 = (n: number) => Math.round(n * 1e5) / 1e5
  const runs: WebRunInput[] = []
  for (let r = 0; r < 1_000; r++) {
    let lng = -123.4 + rand() * 0.2
    let lat = -48.9 + rand() * 0.2
    const line: [number, number][] = []
    for (let p = 0; p < 8 * 96; p++) {
      lng += (rand() - 0.5) * 0.00028
      lat += (rand() - 0.5) * 0.00018
      line.push([round5(lng), round5(lat)])
    }
    const day = new Date(Date.UTC(2026, 0, 1) + r * 36 * 3_600_000).toISOString()
    runs.push({ activityId: `strava-${10_000_000_000 + r}`, startedAt: day, lines: [line] })
  }
  return runs
}

describe("encodeWebBody — the bytes /api/runs/web emits (0321, D-460)", () => {
  const runs = yearFive()
  const raw = Buffer.byteLength(JSON.stringify({ runs }), "utf8")
  const sent = encodeWebBody(runs)

  it("is past the cap raw, which is the bug this ticket fixes", () => {
    expect(raw).toBeGreaterThan(AMPLIFY_RESPONSE_CAP_BYTES)
  })

  it("stays under Amplify's ~5.94 MB response cap at year-five scale, with room to spare", () => {
    expect(sent.byteLength).toBeLessThan(AMPLIFY_RESPONSE_CAP_BYTES * 0.75)
  })

  it("decodes back to exactly the body the client has always parsed", () => {
    expect(JSON.parse(gunzipSync(sent).toString("utf8"))).toEqual({ runs })
  })
})
