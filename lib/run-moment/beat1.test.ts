import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { segmentsToCells } from "@/src/domain/fog"
import { routePaletteFrom } from "@/lib/map-layers"
import type { RouteTraceGeometry } from "@/lib/runs/wire"
import { ARC_FROST_OFFSET, ARC_GOLD_OFFSET, bloomWeight, INSTANCE_FLOATS as F, revealWeight } from "@/lib/fog/mask"
import { revealCellsForRoute } from "@/lib/fog/reveal"
import { tagReveal } from "@/lib/fog/reveal-tag"

import { BEAT1_MS, CAMERA_MS, FROST_MS, GOLD_MS, SETTLE_MS, TRAVERSAL_MS, beat1At, easeOutCubic } from "./beat1"
import { flyToRun, runInView, type Box, type CameraMap } from "./camera"
import { INK_CORE_ID, INK_GLOW_ID, INK_SOURCE_ID, installInk, type InkMap } from "./ink"
import { inkGradient, lanternPath } from "./lantern-path"
import { modeCrossFade, savedRenderMode, SEQUENCE_MODE } from "./mode"
import { bloomPaletteFrom, clearOf, hexToRgb } from "./palette"

/**
 * Ticket `0080`. Beat 1, everything about it that is not pixels: the clock, the path, the ink, the
 * camera's one decision, and the three kinds of ground from the server's verdict through the real
 * tagger into the shader's JS twin. What it LOOKS like is the operator's (D-229); whether it holds
 * 2.9 s and its frame budget in a real browser is measured under `?fog=perf`.
 *
 * Point Nemo, per D-199.
 */
const NEMO = { lat: -48.876, lng: -123.393 }
const KM_LNG = 1 / (111.32 * Math.cos((NEMO.lat * Math.PI) / 180))

function line(fromKm: number, toKm: number, northM = 0, step = 0.05): [number, number][] {
  const out: [number, number][] = []
  const n = Math.round(Math.abs(toKm - fromKm) / step)
  for (let i = 0; i <= n; i++) {
    const km = fromKm + ((toKm - fromKm) * i) / n
    out.push([NEMO.lng + km * KM_LNG, NEMO.lat + northM / 110_540])
  }
  return out
}

/** The real `app/tokens.css`, one `var()` hop resolved — as `lib/map-layers.test.ts` reads it. */
const tokensCss = readFileSync(join(__dirname, "..", "..", "app/tokens.css"), "utf8")
function token(name: string): string {
  const direct = new RegExp(`\\${name}:\\s*([^;]+);`).exec(tokensCss)
  if (!direct) return ""
  const value = direct[1]!.trim()
  const hop = /^var\((--[\w-]+)\)$/.exec(value)
  return hop ? token(hop[1]!) : value
}

const geometry = (...parts: [number, number][][]): RouteTraceGeometry => ({ type: "MultiLineString", coordinates: parts })
const THREE_KM = geometry(line(0, 3))
const TWENTY_KM = geometry(line(0, 20, 0, 0.02))
/** Two segments with a 1 km GPS gap between them: 2 km run, then nothing, then 2 km more. */
const GAPPED = geometry(line(0, 2), line(3, 5))

/* ─── Criterion 1: 2.9 s, whatever the run ──────────────────────────────────── */

describe("the clock — criterion 1", () => {
  it("is 0.4 + 2.2 + 0.3 = 2.9 s, to the millisecond", () => {
    expect([CAMERA_MS, TRAVERSAL_MS, SETTLE_MS]).toEqual([400, 2200, 300])
    expect(BEAT1_MS).toBe(2900)
    expect(beat1At(BEAT1_MS - 1).phase).toBe("settle")
    expect(beat1At(BEAT1_MS).phase).toBe("done")
  })

  it("walks phases camera → traversal → settle → done at §3.2's boundaries", () => {
    expect(beat1At(0).phase).toBe("camera")
    expect(beat1At(399).phase).toBe("camera")
    expect(beat1At(400).phase).toBe("traversal")
    expect(beat1At(2599).phase).toBe("traversal")
    expect(beat1At(2600).phase).toBe("settle")
  })

  it("is the same 2.9 s for a 3 km run and a 20 km run: the clock speaks only in arc fraction", () => {
    const short = lanternPath(THREE_KM)!
    const long = lanternPath(TWENTY_KM)!
    expect(short.lengthM).toBeCloseTo(3000, -1)
    expect(long.lengthM).toBeCloseTo(20_000, -2)
    // The whole beat for either is the same sequence of arcs at the same times — the run never enters.
    for (let t = 0; t <= BEAT1_MS; t += 100) {
      const { progress } = beat1At(t)
      // Constant screen speed: the lantern is at the same fraction of either route at the same time.
      const a = short.at(progress)[0] - short.at(0)[0]
      const b = long.at(progress)[0] - long.at(0)[0]
      expect(a / (short.at(1)[0] - short.at(0)[0])).toBeCloseTo(b / (long.at(1)[0] - long.at(0)[0]), 6)
    }
  })

  it("moves the lantern linearly in arc — pace is not the subject — and lands at exactly 1", () => {
    expect(beat1At(CAMERA_MS).progress).toBe(0)
    expect(beat1At(CAMERA_MS + TRAVERSAL_MS / 4).progress).toBeCloseTo(0.25, 9)
    expect(beat1At(CAMERA_MS + TRAVERSAL_MS).progress).toBe(1)
    expect(beat1At(BEAT1_MS + 1000).progress).toBe(1)
  })

  it("is dark before and after: no lantern in the camera move or once done; one pulse in the settle", () => {
    expect(beat1At(200).lantern).toBe(0)
    expect(beat1At(1000).lantern).toBe(1)
    expect(beat1At(BEAT1_MS).lantern).toBe(0)
    expect(beat1At(1000).pulse).toBe(0)
    expect(beat1At(CAMERA_MS + TRAVERSAL_MS + SETTLE_MS / 2).pulse).toBeCloseTo(1, 9)
  })

  it("easeOutCubic is §3.2's: 0 → 1, fast then slow", () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 9)
  })
})

/* ─── Criterion 3: the full stream ──────────────────────────────────────────── */

describe("the lantern's path — criterion 3", () => {
  it("uses every point of the trace, across every segment", () => {
    const trace = GAPPED.coordinates.reduce((n, part) => n + part.length, 0)
    const path = lanternPath(GAPPED)!
    expect(path.pointCount).toBe(trace)
    expect(path.ink.geometry.coordinates).toHaveLength(trace)
  })

  it("starts on the first point and lands on the last", () => {
    const path = lanternPath(GAPPED)!
    expect(path.at(0)).toEqual(GAPPED.coordinates[0]![0])
    expect(path.at(1)).toEqual(GAPPED.coordinates[1]!.at(-1))
  })

  it("is parameterised by metres RUN: a GPS gap costs the lantern nothing", () => {
    const path = lanternPath(GAPPED)!
    expect(path.lengthM).toBeCloseTo(4000, -1)
    // Half of 4 km run is the end of the first segment — not 2.5 km along a line that includes the gap.
    expect(path.at(0.5)[0]).toBeCloseTo(NEMO.lng + 3 * KM_LNG, 6)
    expect(path.at(0.25)[0]).toBeCloseTo(NEMO.lng + 1 * KM_LNG, 6)
  })

  it("is null with nothing to walk", () => {
    expect(lanternPath(null)).toBeNull()
    expect(lanternPath(geometry())).toBeNull()
    expect(lanternPath(geometry([[NEMO.lng, NEMO.lat]]))).toBeNull()
  })

  /**
   * D-121 mitigation 4. The wire type has no polyline to read, and no file on this path names one in
   * code. Comments are stripped first: the header that explains WHY is allowed to say the word.
   */
  it("never reads the decimated summary polyline — not in the wire type, not on the beat's path", () => {
    const root = join(__dirname, "..", "..")
    const files = [
      ...readdirSync(join(root, "lib/run-moment"))
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => join(root, "lib/run-moment", f)),
      join(root, "app/run/[activityId]/run-sequence.tsx"),
      join(root, "app/run/[activityId]/run-moment.tsx"),
      join(root, "lib/runs/wire.ts"),
      join(root, "lib/fog/reveal.ts"),
    ]
    for (const file of files) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
      expect(code, file).not.toMatch(/polyline/i)
    }
  })
})

/* ─── The ink ───────────────────────────────────────────────────────────────── */

describe("the route inks in behind the lantern", () => {
  const stopsOf = (g: unknown[]) => {
    const flat = g.slice(3)
    const out: [number, string][] = []
    for (let i = 0; i < flat.length; i += 2) out.push([flat[i] as number, flat[i + 1] as string])
    return out
  }
  const colourAt = (g: unknown[], x: number) => {
    const stops = stopsOf(g)
    let c = stops[0]![1]
    for (const [at, colour] of stops) if (at <= x) c = colour
    return c
  }

  it("is a line-gradient over line-progress with strictly ascending stops", () => {
    const path = lanternPath(GAPPED)!
    for (const arc of [0, 0.1, 0.5, 0.75, 1]) {
      const g = inkGradient(path, arc, "INK", "CLEAR")
      expect(g.slice(0, 3)).toEqual(["interpolate", ["linear"], ["line-progress"]])
      const at = stopsOf(g).map(([x]) => x)
      for (let i = 1; i < at.length; i++) expect(at[i]!).toBeGreaterThan(at[i - 1]!)
      expect(at[0]).toBe(0)
      expect(at.at(-1)).toBe(1)
    }
  })

  it("is all clear before the lantern moves, and inked to the head behind it", () => {
    const path = lanternPath(THREE_KM)!
    expect(stopsOf(inkGradient(path, 0, "INK", "CLEAR")).every(([, c]) => c === "CLEAR")).toBe(true)
    const g = inkGradient(path, 0.4, "INK", "CLEAR")
    expect(colourAt(g, 0.39)).toBe("INK")
    expect(colourAt(g, 0.41)).toBe("CLEAR")
    expect(colourAt(inkGradient(path, 1, "INK", "CLEAR"), 0.999)).toBe("INK")
  })

  it("never inks the join across a GPS gap, where nobody ran", () => {
    const path = lanternPath(GAPPED)!
    const [first, second] = path.inkRuns
    const g = inkGradient(path, 1, "INK", "CLEAR")
    const midGap = (first![1] + second![0]) / 2
    expect(colourAt(g, midGap)).toBe("CLEAR")
    expect(colourAt(g, (first![0] + first![1]) / 2)).toBe("INK")
    expect(colourAt(g, (second![0] + second![1]) / 2)).toBe("INK")
  })

  it("maps the lantern's arc onto the joined line's progress, gap included", () => {
    const path = lanternPath(GAPPED)!
    // 2 km run of 4 km, but 2 km along 5 km drawn.
    expect(path.inkProgress(0.5)).toBeCloseTo(3 / 5, 4)
    expect(path.inkProgress(0.25)).toBeCloseTo(1 / 5, 4)
  })

  function fakeMap(withRunLayers = true) {
    const calls: [string, ...unknown[]][] = []
    const layers = new Set<string>(withRunLayers ? ["run-glow", "run-core"] : [])
    const sources = new Set<string>()
    const map: InkMap = {
      addSource: (id, src) => (sources.add(id), calls.push(["addSource", id, src])),
      getSource: (id) => (sources.has(id) ? {} : undefined),
      removeSource: (id) => (sources.delete(id), calls.push(["removeSource", id])),
      addLayer: (layer) => (layers.add((layer as { id: string }).id), calls.push(["addLayer", layer])),
      getLayer: (id) => (layers.has(id) ? {} : undefined),
      removeLayer: (id) => (layers.delete(id), calls.push(["removeLayer", id])),
      setPaintProperty: (...a) => calls.push(["setPaintProperty", ...a]),
      setLayoutProperty: (...a) => calls.push(["setLayoutProperty", ...a]),
    }
    return { map, calls, layers }
  }
  const palette = routePaletteFrom(token)

  it("reuses 05 §4.4's paint unchanged, and hides the run's own line while it draws", () => {
    const { map, calls } = fakeMap()
    installInk(map, lanternPath(THREE_KM)!, palette)
    expect(calls.filter(([n]) => n === "setLayoutProperty")).toEqual([
      ["setLayoutProperty", "run-glow", "visibility", "none"],
      ["setLayoutProperty", "run-core", "visibility", "none"],
    ])
    const source = calls.find(([n]) => n === "addSource")!
    expect(source[1]).toBe(INK_SOURCE_ID)
    expect(source[2]).toMatchObject({ type: "geojson", lineMetrics: true })
    const [glow, core] = calls.filter(([n]) => n === "addLayer").map(([, l]) => l as { id: string; paint: object })
    expect(glow!.id).toBe(INK_GLOW_ID)
    expect(glow!.paint).toMatchObject({ "line-width": 12, "line-blur": 10, "line-opacity": 0.35 })
    expect(core!.id).toBe(INK_CORE_ID)
    expect(core!.paint).toMatchObject({ "line-width": 2.5 })
  })

  it("moves the head with two paint writes, and hands the run's line back on remove", () => {
    const { map, calls, layers } = fakeMap()
    const ink = installInk(map, lanternPath(THREE_KM)!, palette)
    calls.length = 0
    ink.update(0.5)
    expect(calls.filter(([n]) => n === "setPaintProperty").map(([, id, name]) => [id, name])).toEqual([
      [INK_GLOW_ID, "line-gradient"],
      [INK_CORE_ID, "line-gradient"],
    ])
    ink.remove()
    ink.remove()
    expect(layers.has(INK_GLOW_ID) || layers.has(INK_CORE_ID)).toBe(false)
    expect(calls.filter(([n, , , v]) => n === "setLayoutProperty" && v === "visible")).toHaveLength(2)
  })

  it("re-hides the run's line if it arrives after the ink did", () => {
    const { map, calls, layers } = fakeMap(false)
    const ink = installInk(map, lanternPath(THREE_KM)!, palette)
    layers.add("run-glow")
    layers.add("run-core")
    ink.hold()
    expect(calls.filter(([n, , , v]) => n === "setLayoutProperty" && v === "none")).toHaveLength(2)
  })

  it("fades the ink's own hue at its edge, not black", () => {
    const [r, g, b] = hexToRgb(token("--route-core"))!.map((c) => Math.round(c * 255))
    expect(clearOf(token("--route-core"))).toBe(`rgba(${r}, ${g}, ${b}, 0)`)
    expect(clearOf("not a colour")).toBe("rgba(0, 0, 0, 0)")
  })
})

/* ─── Criterion 2: the camera ───────────────────────────────────────────────── */

describe("the camera — criterion 2", () => {
  const run: Box = [
    [-123.4, -48.9],
    [-123.3, -48.8],
  ]
  function fakeCamera(view: Box) {
    const fits: [Box, object][] = []
    const map: CameraMap = {
      getBounds: () => ({
        getWest: () => view[0][0],
        getSouth: () => view[0][1],
        getEast: () => view[1][0],
        getNorth: () => view[1][1],
      }),
      getContainer: () => ({ getBoundingClientRect: () => ({ width: 1000, height: 600 }) }),
      fitBounds: (box, options) => fits.push([box, options]),
    }
    return { map, fits }
  }

  it("does not move at all when the run is already wholly in view", () => {
    const { map, fits } = fakeCamera([
      [-123.5, -49],
      [-123.2, -48.7],
    ])
    expect(flyToRun(map, run)).toBe(false)
    expect(fits).toHaveLength(0)
  })

  it("flies 400 ms, easeOutCubic, 12% padding, when any of the run is out of view", () => {
    const { map, fits } = fakeCamera([
      [-123.35, -49],
      [-123.2, -48.7],
    ])
    expect(flyToRun(map, run)).toBe(true)
    expect(fits).toHaveLength(1)
    expect(fits[0]![0]).toEqual(run)
    expect(fits[0]![1]).toMatchObject({ padding: 72, duration: 400, easing: easeOutCubic, maxZoom: 17 })
  })

  it("is containment, not overlap", () => {
    const view: Box = [
      [0, 0],
      [10, 10],
    ]
    expect(runInView([[1, 1], [9, 9]], view)).toBe(true)
    expect(runInView([[1, 1], [11, 9]], view)).toBe(false)
  })
})

/* ─── Criterion 4: the fog follows the lantern ──────────────────────────────── */

describe("the reveal is gated on the lantern's arc — criterion 4", () => {
  it("at t = 1.5 s the revealed cells are the ones behind the lantern, not the whole run", () => {
    const reveal = revealCellsForRoute(THREE_KM)
    const { progress } = beat1At(1500)
    expect(progress).toBe(0.5)
    const lanternX = lanternPath(THREE_KM)!.at(progress)[0]
    expect(lanternX).toBeCloseTo(NEMO.lng + 1.5 * KM_LNG, 6)

    // `0079`'s ramp: a cell at arc a is clear by p = a(1 - R) + R. Behind the light: clear. Well
    // ahead of it: still fogged. The run's far half is not revealed early.
    const behind = reveal.filter((r) => r.arc < 0.4)
    const ahead = reveal.filter((r) => r.arc > 0.55)
    expect(behind.length).toBeGreaterThan(10)
    expect(ahead.length).toBeGreaterThan(10)
    for (const r of behind) expect(revealWeight(r.arc, progress)).toBe(1)
    for (const r of ahead) expect(revealWeight(r.arc, progress)).toBe(0)
  })
})

/* ─── Criterion 6: three kinds of ground ────────────────────────────────────── */

describe("three kinds of ground — criterion 6", () => {
  /**
   * A 3 km run that crosses all three: the server called the first kilometre new, the second
   * re-armed, and the third is familiar (listed in neither — D-294 stores only the two that earn).
   */
  const segments = THREE_KM.coordinates.map((p) => p.map(([lng, lat]) => ({ lat: lat!, lng: lng! })))
  const all = [...segmentsToCells(segments)]
  const byKm = (km: number) => {
    const reveal = revealCellsForRoute(THREE_KM)
    return reveal.filter((r) => r.arc >= km / 3 && r.arc < (km + 1) / 3).map((r) => r.cell)
  }
  const classes = { new: byKm(0).sort(), rearmed: byKm(1).sort() }
  const familiar = new Set(all.filter((c) => !classes.new.includes(c) && !classes.rearmed.includes(c)))

  it("reveals exactly the server's new and re-armed cells — familiar ground is never in the set", () => {
    const reveal = revealCellsForRoute(THREE_KM, classes)
    expect(reveal.map((r) => r.cell).sort()).toEqual([...classes.new, ...classes.rearmed].sort())
    for (const r of reveal) expect(familiar.has(r.cell)).toBe(false)
    expect(familiar.size).toBeGreaterThan(10)
  })

  it("tags each with the server's verdict, and derives none", () => {
    const reveal = revealCellsForRoute(THREE_KM, classes)
    for (const r of reveal) expect(r.ground).toBe(classes.new.includes(r.cell) ? "new" : "rearmed")
    // The scrub's whole-route set carries no verdict at all: silent, never guessed.
    for (const r of revealCellsForRoute(THREE_KM)) expect(r.ground).toBeUndefined()
  })

  it("encodes new as gold and re-armed as frost in the instance stream; the fade-in is untouched", () => {
    const reveal = revealCellsForRoute(THREE_KM, classes)
    // A post stream of exactly the reveal cells' own discs, and an empty pre stream: every instance
    // is post-only, which is what a run's new ground is.
    const post = new Float32Array(reveal.length * F)
    reveal.forEach((r, i) => post.set([r.x, r.y, 1e-6, 1, -1], i * F))
    const tagged = tagReveal(post, new Float32Array(0), reveal)
    let gold = 0
    let frost = 0
    for (let i = 0; i < reveal.length; i++) {
      const arc = tagged[i * F + 4]!
      const r = reveal[i]!
      if (r.ground === "new") {
        expect(arc).toBe(ARC_GOLD_OFFSET + r.arc)
        gold++
      } else {
        expect(arc).toBe(ARC_FROST_OFFSET + r.arc)
        frost++
      }
      // The offset changes how it blooms, never when it clears.
      for (const p of [0, 0.2, 0.5, 0.8, 1]) expect(revealWeight(arc, p)).toBe(revealWeight(r.arc, p))
    }
    expect(gold).toBeGreaterThan(5)
    expect(frost).toBeGreaterThan(5)
  })

  it("gold blooms over 600 ms and frost over 900 ms, through the shader's own envelope", () => {
    const arc = 0.25
    const at = (t: number) => beat1At(t).bloom
    // When does the cell finish clearing? The bloom peaks then, and is gone one span later.
    const clearT = CAMERA_MS + (arc * (1 - 0.03) + 0.03) * TRAVERSAL_MS
    const [g0] = bloomWeight(ARC_GOLD_OFFSET + arc, at(clearT))
    const [, f0] = bloomWeight(ARC_FROST_OFFSET + arc, at(clearT))
    expect(g0).toBeCloseTo(1, 6)
    expect(f0).toBeCloseTo(1, 6)
    const [gMid] = bloomWeight(ARC_GOLD_OFFSET + arc, at(clearT + GOLD_MS / 2))
    const [, fMid] = bloomWeight(ARC_FROST_OFFSET + arc, at(clearT + GOLD_MS / 2))
    expect(gMid).toBeCloseTo(0.5, 6)
    expect(fMid).toBeGreaterThan(gMid) // slower
    expect(bloomWeight(ARC_GOLD_OFFSET + arc, at(clearT + GOLD_MS))[0]).toBeCloseTo(0, 6)
    expect(bloomWeight(ARC_FROST_OFFSET + arc, at(clearT + FROST_MS))[1]).toBeCloseTo(0, 6)
  })

  it("familiar ground — and every steady-state instance — never blooms", () => {
    for (const t of [500, 1500, 2500]) {
      expect(bloomWeight(-1, beat1At(t).bloom)).toEqual([0, 0])
      expect(bloomWeight(0.3, beat1At(t).bloom)).toEqual([0, 0])
    }
  })

  it("no bloom in the camera move or after the beat: the clock is off", () => {
    expect(bloomWeight(ARC_GOLD_OFFSET, beat1At(100).bloom)).toEqual([0, 0])
    expect(bloomWeight(ARC_GOLD_OFFSET + 1, beat1At(BEAT1_MS).bloom)).toEqual([0, 0])
  })

  it("resolves its colours from the tokens, and plays silent rather than black if one is missing", () => {
    const palette = bloomPaletteFrom(token)!
    expect(palette.gold).toEqual(hexToRgb(token("--gold-300")))
    expect(palette.frost).toEqual(hexToRgb(token("--frost-400")))
    expect(palette.glint).toEqual(hexToRgb(token("--route-core")))
    expect(bloomPaletteFrom((t) => (t === "--frost-400" ? "" : token(t)))).toBeNull()
  })

  it("the frost token exists in the palette, at §3.2's value", () => {
    // §3.2 gives --frost-400 as 7FA8C9 (D-295 added it to §8.1's palette and to tokens.css).
    expect(hexToRgb(token("--frost-400"))!.map((c) => Math.round(c * 255))).toEqual([0x7f, 0xa8, 0xc9])
  })
})

/* ─── Criterion 5: the mode, stubbed (D-295) ────────────────────────────────── */

describe("the mode around the sequence — criterion 5, stubbed until capability 15", () => {
  it("plays in adventure; the saved mode is adventure; so there is nothing to cross-fade", () => {
    expect(SEQUENCE_MODE).toBe("adventure")
    expect(savedRenderMode()).toBe("adventure")
    expect(modeCrossFade(savedRenderMode())).toBeNull()
  })

  it("describes a 300 ms fade to the saved mode once one can differ", () => {
    expect(modeCrossFade("atlas")).toEqual({ from: "adventure", to: "atlas", ms: 300 })
  })
})

/* ─── Criterion 8: no sound, ever ───────────────────────────────────────────── */

describe("no audio anywhere in the sequence — criterion 8", () => {
  it("constructs no Audio, AudioContext or media element", () => {
    const root = join(__dirname, "..", "..")
    const files = [
      ...readdirSync(join(root, "lib/run-moment"))
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => join(root, "lib/run-moment", f)),
      ...readdirSync(join(root, "app/run/[activityId]"))
        .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
        .map((f) => join(root, "app/run/[activityId]", f)),
    ]
    expect(files.length).toBeGreaterThan(8)
    for (const file of files) {
      const code = readFileSync(file, "utf8")
      expect(code, file).not.toMatch(/\bAudio(Context)?\b|webkitAudioContext|<audio|<video|createElement\(["'](audio|video)/)
    }
  })
})
