import { readFileSync } from "node:fs"
import { join } from "node:path"

import { layers as basemapLayers, namedFlavor } from "@protomaps/basemaps"
import { describe, expect, it } from "vitest"

import { installTraceInk } from "@/lib/run-moment/ink"
import { lanternPath } from "@/lib/run-moment/lantern-path"

import {
  installWebBeat,
  setTraceWeb,
  TRACE_BEFORE_LAYER_ID,
  TRACE_INK_LAYER_ID,
  TRACE_LAYER_ID,
  traceBeforeId,
  traceColorFrom,
  traceIsBetweenBasemapAndRoute,
  traceOpacity,
  type TraceHost,
} from "./layer"
import { EMPTY_WEB, WEAR_MAX } from "./web"

/** Ticket `0085`. The trace layer's place in the stack and beat 1's two seams. Point Nemo (D-199). */

/** A map that keeps an ordered layer list, so `beforeId` is honoured as MapLibre honours it. */
function fakeMap(initial: Array<{ id: string; type: string }>) {
  const stack = initial.slice()
  const sources = new Map<string, unknown>()
  const paint: Array<[string, string, unknown]> = []
  const layout: Array<[string, string, unknown]> = []
  const host = {
    getLayer: (id: string) => stack.find((l) => l.id === id),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, s: unknown) => void sources.set(id, { ...(s as object), setData() {} }),
    removeSource: (id: string) => void sources.delete(id),
    addLayer(layer: unknown, beforeId?: string) {
      const l = layer as { id: string; type: string }
      const at = beforeId ? stack.findIndex((x) => x.id === beforeId) : -1
      if (at >= 0) stack.splice(at, 0, l)
      else stack.push(l)
    },
    removeLayer: (id: string) => void stack.splice(stack.findIndex((l) => l.id === id), 1),
    setPaintProperty: (layer: string, name: string, value: unknown) => void paint.push([layer, name, value]),
    setLayoutProperty: (layer: string, name: string, value: unknown) => void layout.push([layer, name, value]),
    getStyle: () => ({ layers: stack }),
  }
  return { host: host as TraceHost & typeof host, stack, paint, layout }
}

const BASEMAP = basemapLayers("protomaps", namedFlavor("light"), { lang: "en" }).map((l) => ({ id: l.id, type: l.type }))

describe("where the web sits (criterion 1)", () => {
  it("above the basemap's ground and roads, under every label, the fog and the route", () => {
    const { host, stack } = fakeMap(BASEMAP)
    setTraceWeb(host, EMPTY_WEB, "#a9b3c2")
    // The fog and the route arrive later, appended on top as `lib/map-layers.ts` adds them.
    stack.push({ id: "fog-mask", type: "custom" }, { id: "run-glow", type: "line" }, { id: "run-core", type: "line" })
    expect(traceIsBetweenBasemapAndRoute(stack)).toBe(true)
    const trace = stack.findIndex((l) => l.id === TRACE_LAYER_ID)
    expect(stack.slice(0, trace).some((l) => l.type === "line")).toBe(true)
    expect(stack.slice(0, trace).every((l) => l.type !== "symbol")).toBe(true)
  })

  it("is one source, added once and then only re-fed", () => {
    const { host, stack } = fakeMap(BASEMAP)
    setTraceWeb(host, EMPTY_WEB, "#a9b3c2")
    setTraceWeb(host, EMPTY_WEB, "#a9b3c2")
    expect(stack.filter((l) => l.id === TRACE_LAYER_ID)).toHaveLength(1)
  })

  it("goes on top when the style has no labels", () => {
    expect(traceBeforeId({ getStyle: () => ({ layers: [{ id: "bg", type: "background" }] }) })).toBeUndefined()
  })

  it("is --ink-300, through its own semantic token", () => {
    const css = readFileSync(join(__dirname, "../../app/tokens.css"), "utf8")
    expect(css).toMatch(/--trace-line:\s*var\(--ink-300\);/)
    expect(() => traceColorFrom(() => "")).toThrow(/--trace-line/)
  })
})

describe("beat 1's web, before and after this run", () => {
  it("holds the steady web out and shows the web without this run, then cross-fades", () => {
    const { host, stack, paint } = fakeMap(BASEMAP)
    setTraceWeb(host, EMPTY_WEB, "#a9b3c2")
    const beat = installWebBeat(host, EMPTY_WEB, "#a9b3c2")
    beat.crossfade(0)
    expect(stack.findIndex((l) => l.id === TRACE_BEFORE_LAYER_ID)).toBeLessThan(stack.findIndex((l) => l.type === "symbol"))
    expect(paint.at(-2)).toEqual([TRACE_LAYER_ID, "line-opacity", traceOpacity(0)])
    expect(paint.at(-1)).toEqual([TRACE_BEFORE_LAYER_ID, "line-opacity", traceOpacity(1)])
    beat.crossfade(0.5)
    expect(paint.at(-2)).toEqual([TRACE_LAYER_ID, "line-opacity", traceOpacity(0.5)])
    beat.remove()
    expect(stack.some((l) => l.id === TRACE_BEFORE_LAYER_ID)).toBe(false)
    expect(paint.at(-1)).toEqual([TRACE_LAYER_ID, "line-opacity", traceOpacity(1)])
  })
})

describe("the line joining the web (criterion 5)", () => {
  const ROUTE = { type: "MultiLineString" as const, coordinates: [[[-123.393, -48.876], [-123.38, -48.876]] as [number, number][]] }

  it("inks in the trace layer's paint, under the labels, with the run's amber held hidden", () => {
    const { host, stack, layout } = fakeMap([...BASEMAP, { id: "run-glow", type: "line" }, { id: "run-core", type: "line" }])
    installTraceInk(host, lanternPath(ROUTE)!, "#a9b3c2")
    const ink = stack.find((l) => l.id === TRACE_INK_LAYER_ID) as unknown as { paint: Record<string, unknown> }
    expect(ink.paint["line-opacity"]).toBe(WEAR_MAX)
    expect(stack.findIndex((l) => l.id === TRACE_INK_LAYER_ID)).toBeLessThan(stack.findIndex((l) => l.type === "symbol"))
    expect(layout).toContainEqual(["run-glow", "visibility", "none"])
    expect(layout).toContainEqual(["run-core", "visibility", "none"])
  })

  it("fades into the web and gives the run's line back on remove", () => {
    const { host, stack, paint, layout } = fakeMap([...BASEMAP, { id: "run-glow", type: "line" }, { id: "run-core", type: "line" }])
    const ink = installTraceInk(host, lanternPath(ROUTE)!, "#a9b3c2")
    ink.update(0.5)
    expect(paint.at(-1)![1]).toBe("line-gradient")
    ink.fade(0.25)
    expect(paint.at(-1)).toEqual([TRACE_INK_LAYER_ID, "line-opacity", WEAR_MAX * 0.25])
    ink.remove()
    expect(stack.some((l) => l.id === TRACE_INK_LAYER_ID)).toBe(false)
    expect(layout.at(-1)).toEqual(["run-core", "visibility", "visible"])
  })
})
