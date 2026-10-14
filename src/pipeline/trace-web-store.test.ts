import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { describe, expect, it } from "vitest"

import { simplifyLine } from "@/src/domain/simplify-line"

import {
  editTraceWeb,
  encodeTraceWeb,
  parseTraceWeb,
  traceWebKey,
  upsertTraceWeb,
  type TraceWeb,
  type TraceWebS3,
} from "./trace-web-store"

/**
 * Ticket `0085`, D-299. GEOMETRY IS SYNTHETIC, near Point Nemo — `08-security-privacy.md` §7.2.
 */

const LINE: [number, number][] = Array.from({ length: 50 }, (_, i) => [-123.393 + i * 0.00004, -48.876])

/** An in-memory bucket with ETags and S3's conditional-write semantics. */
function bucket(opts: { raceOnce?: () => TraceWeb } = {}) {
  const store = new Map<string, { body: Uint8Array; etag: string }>()
  let n = 0
  let race = opts.raceOnce
  const puts: PutObjectCommand["input"][] = []
  const s3: TraceWebS3 = {
    async send(command: GetObjectCommand | PutObjectCommand) {
      if (command instanceof GetObjectCommand) {
        const hit = store.get(command.input.Key!)
        if (!hit) throw Object.assign(new Error("missing"), { name: "NoSuchKey" })
        return { Body: { transformToByteArray: async () => hit.body }, ETag: hit.etag }
      }
      const input = command.input
      puts.push(input)
      const key = input.Key!
      if (race) {
        // Another worker writes between this one's read and its PUT.
        store.set(key, { body: encodeTraceWeb(race()), etag: `"e${++n}"` })
        race = undefined
      }
      const current = store.get(key)
      if ((input.IfNoneMatch === "*" && current) || (input.IfMatch !== undefined && input.IfMatch !== current?.etag)) {
        throw Object.assign(new Error("precondition"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } })
      }
      store.set(key, { body: input.Body as Uint8Array, etag: `"e${++n}"` })
      return { ETag: `"e${n}"` }
    },
  } as TraceWebS3
  const read = (userId: string) => parseTraceWeb(store.get(traceWebKey(userId))!.body, "test")
  return { s3, read, puts }
}

const deps = (s3: TraceWebS3) => ({ s3, bucket: "bkt", backoff: async () => {} })

describe("trace-web-store", () => {
  it("keys the web under the user's own traces prefix", () => {
    expect(traceWebKey("u-1")).toBe("users/u-1/traces/web.json.gz")
  })

  it("creates the web with the first route, simplified, and only when absent", async () => {
    const b = bucket()
    await upsertTraceWeb(
      { userId: "u-1", activityId: "a-1", startedAt: "2026-09-02T07:00:00Z", geometry: { type: "MultiLineString", coordinates: [LINE] } },
      deps(b.s3),
    )
    expect(b.puts[0]!.IfNoneMatch).toBe("*")
    expect(b.puts[0]!.ContentEncoding).toBe("gzip")
    const web = b.read("u-1")
    expect(Object.keys(web.runs)).toEqual(["a-1"])
    // A straight line simplifies to its two ends.
    expect(web.runs["a-1"]!.lines[0]).toEqual([LINE[0], LINE[LINE.length - 1]])
  })

  it("replaces a run's own entry on a re-ingest rather than adding a second", async () => {
    const b = bucket()
    const input = { userId: "u-1", activityId: "a-1", startedAt: "2026-09-02T07:00:00Z", geometry: { type: "MultiLineString" as const, coordinates: [LINE] } }
    await upsertTraceWeb(input, deps(b.s3))
    await upsertTraceWeb({ ...input, activityId: "a-2" }, deps(b.s3))
    await upsertTraceWeb(input, deps(b.s3))
    expect(Object.keys(b.read("u-1").runs).sort()).toEqual(["a-1", "a-2"])
    expect(b.puts.at(-1)!.IfMatch).toBeDefined()
  })

  it("redoes the edit on top of a concurrent writer's, so neither route is lost", async () => {
    const other: TraceWeb = { v: 1, runs: { "a-0": { startedAt: "2026-09-01T07:00:00Z", lines: [LINE.slice(0, 2)] } } }
    const b = bucket({ raceOnce: () => other })
    await editTraceWeb("u-1", (web) => ({ v: 1, runs: { ...web.runs, "a-1": other.runs["a-0"]! } }), deps(b.s3))
    expect(Object.keys(b.read("u-1").runs).sort()).toEqual(["a-0", "a-1"])
    expect(b.puts).toHaveLength(2)
  })

  it("writes nothing for a route with no line to draw", async () => {
    const b = bucket()
    await upsertTraceWeb(
      { userId: "u-1", activityId: "a-1", startedAt: "2026-09-02T07:00:00Z", geometry: { type: "MultiLineString", coordinates: [] } },
      deps(b.s3),
    )
    expect(b.puts).toHaveLength(0)
  })
})

describe("simplifyLine", () => {
  it("keeps a bend wider than the tolerance and drops one narrower", () => {
    const m = 1 / 111_195 // ~1 m of latitude
    const bent: [number, number][] = [[0, 0], [0.00005, 10 * m], [0.0001, 0]]
    const flat: [number, number][] = [[0, 0], [0.00005, 1 * m], [0.0001, 0]]
    expect(simplifyLine(bent)).toHaveLength(3)
    expect(simplifyLine(flat)).toHaveLength(2)
  })
})

/**
 * CRITERION 3. *"Nothing reads the trace layer for scoring: a grep proves no scoring module imports
 * it, and no count, badge or 'nth time' string exists anywhere in its code path."*
 */
describe("the trace layer is never scored (criterion 3)", () => {
  const ROOT = join(__dirname, "../..")
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []
    })
  const TRACE_MODULES = /trace-web|simplify-line/

  it("no scoring, rules or domain-scoring module imports it", () => {
    const scoring = [...walk(join(ROOT, "src/scoring")), ...walk(join(ROOT, "src/rules"))]
    for (const domain of ["discovery", "fold", "explored-agg", "score-key", "frontier", "chronicle"]) {
      scoring.push(join(ROOT, `src/domain/${domain}.ts`))
    }
    const offenders = scoring.filter((f) => TRACE_MODULES.test(readFileSync(f, "utf8")))
    expect(offenders).toEqual([])
  })

  it("its code path carries no count, badge or nth-time string", () => {
    const path = [
      "src/pipeline/trace-web-store.ts",
      "src/domain/simplify-line.ts",
      "lib/trace-web/web.ts",
      "lib/trace-web/layer.ts",
      "components/map/use-trace-web.ts",
    ]
      .map((f) => readFileSync(join(ROOT, f), "utf8"))
      // Code only: the prose explaining the rule names what it forbids.
      .map((src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))
    const literals = path.flatMap((src) => src.match(/(["'`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [])
    const forbidden = /\b(\d+(st|nd|rd|th)|times?|badge|count|passes|streak)\b/i
    expect(literals.filter((l) => forbidden.test(l))).toEqual([])
  })
})
