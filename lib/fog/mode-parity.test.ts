import { readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

import type { CustomRenderMethodInput } from "maplibre-gl"
import { gridDisk, latLngToCell } from "h3-js"
import ts from "typescript"
import { describe, expect, it } from "vitest"

import { RES } from "@/src/domain/fog"

import { fakeGl, type GlCall } from "./__fixtures__/fake-gl"
import { FOG_MODES, lerpPalette, MAX_OPACITY_CEILING, type FogPalette } from "./fog-uniforms"
import { packBucket } from "./instances"
import { STUB_PRELUDE } from "./mask"
import { FogMaskLayer } from "./mask-layer"

/**
 * TICKET 0099 — WHAT THE MODES MAY NOT DIFFER IN. `05-fog-of-war.md` §5.4.
 *
 * *"Neither mode changes what is revealed."* The revealed set is the mask; the mode is the composite's
 * uniforms and the style's layers (D-374). This file holds the three in-suite halves of the proof:
 *
 *   1. **The mask pass is the same GL call stream in both modes** — same uploads, same uniforms, same
 *      draw — and a mode change never re-runs it (fake GL). The bit-identical PIXELS are
 *      `tools/fog-harness/run-mode-swap.mjs`, on a real GPU, because a fake cannot rasterise.
 *   2. **The cell-selection and `revealScale` code paths cannot take a mode** — a signature test over
 *      the TypeScript checker's own view of every exported parameter, so it is impossible rather than
 *      merely untrue (criterion 2).
 *   3. **Those modules cannot even import one** — their transitive import closure never reaches a
 *      module that defines a mode, a palette, or a basemap variant.
 *
 * `scripts/check-mode-boundary.mjs` is the outer ring (criterion 3): the mode's name stays inside the
 * renderer and the toggle. These are the inner one: inside the renderer, it stays out of the mask.
 *
 * Point Nemo, per D-199.
 */
const NEMO = { lat: -48.876, lng: -123.393 }
const ROOT = resolve(__dirname, "../..")

function mainMatrix(centreX = 0.2739, centreY = 0.3767, zoom = 14): Float32Array {
  const s = 512 * 2 ** zoom
  const m = new Float32Array(16)
  m[0] = (2 * s) / 800
  m[5] = (-2 * s) / 600
  m[10] = 1
  m[15] = 1
  m[12] = (-centreX * 2 * s) / 800
  m[13] = (centreY * 2 * s) / 600
  return m
}

function renderInput(matrix: ArrayLike<number> = mainMatrix()): CustomRenderMethodInput {
  return {
    farZ: 1,
    nearZ: 0,
    fov: 0.6,
    modelViewProjectionMatrix: new Float64Array(16),
    projectionMatrix: new Float64Array(16),
    shaderData: { variantName: "mercator", vertexShaderPrelude: STUB_PRELUDE, define: "#define PROJECTION_MERCATOR" },
    defaultProjectionData: {
      mainMatrix: matrix,
      tileMercatorCoords: [0, 0, 1, 1],
      clippingPlane: [0, 0, 0, 0],
      projectionTransition: 0,
      fallbackMatrix: new Float32Array(16),
      clipAntimeridian: false,
    },
  } as unknown as CustomRenderMethodInput
}

/** An irregular explored set: a disc, a corridor off it, and a lone cell — edges in every direction. */
const centre = latLngToCell(NEMO.lat, NEMO.lng, RES)
const cells = [
  ...new Set([
    ...gridDisk(centre, 6),
    ...gridDisk(latLngToCell(NEMO.lat + 0.004, NEMO.lng + 0.003, RES), 1),
    latLngToCell(NEMO.lat - 0.003, NEMO.lng - 0.004, RES),
  ]),
]
const BUCKET = packBucket(cells)

/** The calls `prerender` makes — which is the mask pass and nothing else (the composite is `render`). */
function maskPassCalls(palette: FogPalette, matrix = mainMatrix()): GlCall[] {
  const fake = fakeGl()
  const layer = new FogMaskLayer({ palette, timeSource: () => 3.25, onRebuild: () => {} })
  layer.setBucket(BUCKET)
  layer.prerender(fake.gl, renderInput(matrix))
  return fake.calls
}

const PALETTES: Record<string, FogPalette> = {
  atlas: FOG_MODES.atlas,
  adventure: FOG_MODES.adventure,
  "mid-fade": lerpPalette(FOG_MODES.atlas, FOG_MODES.adventure, 0.5),
}

describe("criterion 1 — the mask does not see the mode (05 §5.4)", () => {
  it.each([12, 15.25, 17.75])("issues an identical mask pass in every mode at z%s", (zoom) => {
    const matrix = mainMatrix(0.2739, 0.3767, zoom)
    const [first, ...rest] = Object.values(PALETTES).map((p) => maskPassCalls(p, matrix))
    expect(first!.some((c) => c.name === "drawArraysInstanced")).toBe(true)
    for (const calls of rest) expect(calls).toEqual(first)
  })

  /**
   * A mode change between two frames must not re-run the mask pass: a re-run would mean a mode value
   * reached the stage that decides what is revealed. The composite is the only pass that redraws.
   */
  it("does not re-run the mask pass when the mode changes, and the composite does redraw", () => {
    const fake = fakeGl()
    const layer = new FogMaskLayer({ palette: FOG_MODES.adventure, timeSource: () => 3.25, onRebuild: () => {} })
    layer.setBucket(BUCKET)
    layer.prerender(fake.gl, renderInput())
    layer.render(fake.gl, renderInput())
    const passes = layer.stats().passes
    const draws = fake.of("drawArraysInstanced").length
    const composites = layer.stats().composites

    for (const palette of [FOG_MODES.atlas, PALETTES["mid-fade"]!, FOG_MODES.adventure]) {
      layer.setPalette(palette)
      layer.prerender(fake.gl, renderInput())
      layer.render(fake.gl, renderInput())
    }
    expect(layer.stats().passes).toBe(passes)
    expect(fake.of("drawArraysInstanced")).toHaveLength(draws)
    expect(layer.stats().composites).toBe(composites + 3)
  })

  /** The sabotage: the comparison above can see a difference when there is one to see. */
  it("would notice: a different camera is a different mask pass", () => {
    expect(maskPassCalls(FOG_MODES.atlas, mainMatrix(0.2739, 0.3767, 15))).not.toEqual(
      maskPassCalls(FOG_MODES.atlas, mainMatrix(0.2739, 0.3767, 15.01)),
    )
  })
})

describe("criterion 4 — u_maxOpacity < 1.0 in every mode, and along every fade", () => {
  it("holds for each FOG_MODES entry and every frame between them", () => {
    expect(MAX_OPACITY_CEILING).toBeLessThan(1)
    for (const a of Object.values(FOG_MODES)) {
      expect(a.maxOpacity).toBeLessThan(1)
      for (const b of Object.values(FOG_MODES)) {
        for (let i = 0; i <= 32; i++) expect(lerpPalette(a, b, i / 32).maxOpacity).toBeLessThan(1)
      }
    }
  })
})

/* ─── criterion 2 — the signature test ──────────────────────────────────────────────────── */

/**
 * THE CELL-SELECTION AND `revealScale` PATHS. What decides which discs are in the mask and how big
 * they are: the explored set, the zoom buckets, the cull, the packer (where `REVEAL_SCALE` becomes a
 * radius), the route corridor and the reveal tagging, the mask pass itself, and the camera driver.
 */
const SELECTION_MODULES = [
  "lib/fog/explored-set.ts",
  "lib/fog/zoom-buckets.ts",
  "lib/fog/cull.ts",
  "lib/fog/instances.ts",
  "lib/fog/mask.ts",
  "lib/fog/route-corridor.ts",
  "lib/fog/reveal-tag.ts",
  "lib/fog/reveal.ts",
  "lib/fog/viewport-controller.ts",
]

/**
 * `FogMaskLayer` is both sides: its constructor and `setPalette` take the look, by design. Its DATA
 * seam — every method that feeds the mask — is held to the same rule as the modules above.
 */
const MASK_LAYER_DATA_SEAM = ["setBucket", "setInstances", "setOptimisticRoute", "setReveal", "setRevealProgress", "prerender"]

/** Named types that ARE a mode or a look. A parameter reaching one of them is the leak. */
const MODE_TYPES = new Set(["MapMode", "RenderMode", "FogMode", "BasemapVariant", "FogPalette", "ModeFrame", "BloomPalette"])
const MODE_LITERALS = new Set(["atlas", "adventure"])

function program(files: string[]): ts.Program {
  const config = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT)
  return ts.createProgram(
    files.map((f) => join(ROOT, f)),
    { ...parsed.options, noEmit: true, incremental: false },
  )
}

/** Every named type or mode literal reachable from `type`, depth-limited — a parameter's whole shape. */
function modeLeaks(checker: ts.TypeChecker, type: ts.Type, seen = new Set<ts.Type>(), depth = 0): string[] {
  if (seen.has(type) || depth > 4) return []
  seen.add(type)
  const out: string[] = []
  const name = type.aliasSymbol?.getName() ?? type.getSymbol()?.getName()
  if (name && MODE_TYPES.has(name)) out.push(name)
  if (type.isStringLiteral() && MODE_LITERALS.has(type.value)) out.push(`"${type.value}"`)
  if (type.isUnionOrIntersection()) for (const t of type.types) out.push(...modeLeaks(checker, t, seen, depth))
  for (const t of type.aliasTypeArguments ?? []) out.push(...modeLeaks(checker, t, seen, depth + 1))
  if (type.flags & ts.TypeFlags.Object) {
    // Only the repository's own shapes are walked into; a DOM or MapLibre type cannot name our mode.
    const decl = type.getSymbol()?.declarations?.[0]
    const ours = !decl || !decl.getSourceFile().fileName.includes("node_modules")
    if (ours) {
      for (const prop of checker.getPropertiesOfType(type)) {
        const d = prop.valueDeclaration ?? prop.declarations?.[0]
        if (!d) continue
        out.push(...modeLeaks(checker, checker.getTypeOfSymbolAtLocation(prop, d), seen, depth + 1))
      }
      for (const sig of type.getCallSignatures()) {
        for (const p of sig.getParameters()) {
          const d = p.valueDeclaration ?? p.declarations?.[0]
          if (d) out.push(...modeLeaks(checker, checker.getTypeOfSymbolAtLocation(p, d), seen, depth + 1))
        }
      }
    }
  }
  return out
}

interface Signature {
  where: string
  params: { name: string; leaks: string[] }[]
}

function signaturesOf(checker: ts.TypeChecker, symbol: ts.Symbol, where: string, only?: string[]): Signature[] {
  const out: Signature[] = []
  const decl = symbol.valueDeclaration ?? symbol.declarations?.[0]
  if (!decl) return out
  const describe = (label: string, sigs: readonly ts.Signature[]) => {
    for (const sig of sigs) {
      out.push({
        where: label,
        params: sig.getParameters().map((p) => {
          const d = p.valueDeclaration ?? p.declarations?.[0] ?? decl
          return { name: p.getName(), leaks: modeLeaks(checker, checker.getTypeOfSymbolAtLocation(p, d)) }
        }),
      })
    }
  }
  const type = checker.getTypeOfSymbolAtLocation(symbol, decl)
  if (ts.isClassDeclaration(decl)) {
    if (!only) describe(`${where} constructor`, type.getConstructSignatures())
    const instance = checker.getDeclaredTypeOfSymbol(symbol)
    for (const prop of checker.getPropertiesOfType(instance)) {
      if (only && !only.includes(prop.getName())) continue
      const d = prop.valueDeclaration ?? prop.declarations?.[0]
      if (!d) continue
      describe(`${where}.${prop.getName()}`, checker.getTypeOfSymbolAtLocation(prop, d).getCallSignatures())
    }
  } else {
    describe(where, type.getCallSignatures())
  }
  return out
}

describe("criterion 2 — the cell-selection and revealScale paths take no mode argument", () => {
  const prog = program([...SELECTION_MODULES, "lib/fog/mask-layer.ts"])
  const checker = prog.getTypeChecker()

  function exportsOf(file: string): ts.Symbol[] {
    const source = prog.getSourceFile(join(ROOT, file))
    if (!source) throw new Error(`${file} is not in the program`)
    const moduleSymbol = checker.getSymbolAtLocation(source)
    return moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []
  }

  const signatures: Signature[] = []
  for (const file of SELECTION_MODULES) {
    for (const symbol of exportsOf(file)) signatures.push(...signaturesOf(checker, symbol, `${file}:${symbol.getName()}`))
  }
  const layer = exportsOf("lib/fog/mask-layer.ts").find((s) => s.getName() === "FogMaskLayer")!
  signatures.push(...signaturesOf(checker, layer, "lib/fog/mask-layer.ts:FogMaskLayer", MASK_LAYER_DATA_SEAM))

  it("finds the functions it is meant to be guarding", () => {
    const where = signatures.map((s) => s.where)
    // The paths the criterion names, by name — a refactor that renames one must update this list.
    for (const fn of [
      "lib/fog/cull.ts:cullBucket",
      "lib/fog/instances.ts:packBucket",
      "lib/fog/instances.ts:discRadiusM",
      "lib/fog/zoom-buckets.ts:resForZoom",
      "lib/fog/mask.ts:runMaskPass",
      "lib/fog/mask.ts:maskVertexSource",
      "lib/fog/mask.ts:createMaskResources",
      "lib/fog/mask-layer.ts:FogMaskLayer.setInstances",
      "lib/fog/mask-layer.ts:FogMaskLayer.prerender",
      "lib/fog/viewport-controller.ts:FogViewportController constructor",
      "lib/fog/zoom-buckets.ts:ZoomBucketStore constructor",
    ]) {
      expect(where).toContain(fn)
    }
    expect(signatures.length).toBeGreaterThan(40)
  })

  it("no parameter is, or contains, a mode, a palette, or a mode literal", () => {
    const leaks = signatures.flatMap((s) =>
      s.params.filter((p) => p.leaks.length > 0 || /mode|palette/i.test(p.name)).map((p) => `${s.where}(${p.name}: ${p.leaks.join(", ")})`),
    )
    expect(leaks).toEqual([])
  })

  /** The sabotage: the walker sees a mode where there is one — the layer's own constructor. */
  it("would notice: FogMaskLayer's constructor takes the palette, and the walker says so", () => {
    const ctor = signaturesOf(checker, layer, "FogMaskLayer").find((s) => s.where === "FogMaskLayer constructor")!
    expect(ctor.params.flatMap((p) => p.leaks)).toContain("FogPalette")
    const setPalette = signaturesOf(checker, layer, "FogMaskLayer", ["setPalette"])
    expect(setPalette[0]!.params[0]!.leaks).toContain("FogPalette")
  })
}, 60_000)

/* ─── the import closure ────────────────────────────────────────────────────────────────── */

/** Modules that define a mode or a look. None may be reachable from the selection modules. */
const MODE_MODULES = ["lib/map-mode.ts", "lib/basemap-style.ts", "lib/basemap.ts", "lib/fog/fog-uniforms.ts", "lib/run-moment/mode.ts"]

function localImports(file: string): string[] {
  const src = readFileSync(join(ROOT, file), "utf8")
  const out: string[] = []
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/g)) {
    const spec = m[1]!
    let base: string | null = null
    if (spec.startsWith("@/")) base = spec.slice(2)
    else if (spec.startsWith(".")) base = relative(ROOT, resolve(ROOT, dirname(file), spec))
    if (!base) continue
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      try {
        readFileSync(join(ROOT, base + ext))
        out.push(base + ext)
        break
      } catch {
        // try the next extension
      }
    }
  }
  return out
}

function closure(roots: string[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    stack.push(...localImports(f))
  }
  return seen
}

describe("the selection modules cannot reach a mode, even by import", () => {
  it.each(SELECTION_MODULES)("%s imports nothing that defines a mode or a look", (file) => {
    const reached = closure([file])
    expect(MODE_MODULES.filter((m) => reached.has(m))).toEqual([])
  })

  it("would notice: the mask layer, which does hold the look, reaches fog-uniforms", () => {
    expect(closure(["lib/fog/mask-layer.ts"]).has("lib/fog/fog-uniforms.ts")).toBe(true)
  })
})
