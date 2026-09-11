import type { CustomRenderMethodInput } from "maplibre-gl"
import { latLngToCell, gridDisk } from "h3-js"
import { describe, expect, it, vi } from "vitest"

import { fakeGl, GL, type FakeGl } from "./__fixtures__/fake-gl"
import { packBucket } from "./instances"
import { packRouteCorridor } from "./route-corridor"
import { FogMaskLayer, maskDebugEnabled, type MaskStats } from "./mask-layer"
import { STUB_PRELUDE } from "./mask"
import { V1 } from "./fog-uniforms"

/**
 * Ticket `0055`, criteria 1, 9 and 10. `05-fog-of-war.md` §4.2, §6.4.
 *
 * Point Nemo, per D-199 — see the note in `instances.test.ts`.
 */
const NEMO = { lat: -48.876, lng: -123.393 }

/**
 * `CustomRenderMethodInput`, as MapLibre hands it to `prerender`. `variantName` is MapLibre's own
 * cache key for the projection, and it is the input this layer's rebuild logic keys on.
 */
/**
 * A real, invertible mercator `mainMatrix` — `0056` needs one. `0055` passed sixteen zeros because
 * nothing read it; the composite inverts it to anchor its noise to the ground (D-233), and a
 * singular matrix takes the degenerate screen-space path, which is precisely the branch that must
 * not be the one the tests exercise by accident.
 */
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

function renderInput(
  variantName = "mercator",
  matrix: ArrayLike<number> = mainMatrix(),
): CustomRenderMethodInput {
  return {
    farZ: 1,
    nearZ: 0,
    fov: 0.6,
    modelViewProjectionMatrix: new Float64Array(16),
    projectionMatrix: new Float64Array(16),
    shaderData: {
      variantName,
      vertexShaderPrelude: STUB_PRELUDE,
      define: "#define PROJECTION_MERCATOR",
    },
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

const cells = gridDisk(latLngToCell(NEMO.lat, NEMO.lng, 10), 4)
/**
 * `visibleInstanceCount` is DISCS, not cells — `packBucket` adds a bridge disc per adjacent revealed
 * pair (D-232) and every one of them is drawn. Asserted through the packer rather than as a literal,
 * because the multiplier is the packer's business and `instances.test.ts` is where it is pinned.
 */
const BUCKET = packBucket(cells)

function layerOn(
  options: { debug?: boolean; timeSource?: () => number; octaves?: number } = {},
): {
  layer: FogMaskLayer
  fake: FakeGl
  rebuilds: MaskStats[]
} {
  const rebuilds: MaskStats[] = []
  const layer = new FogMaskLayer({ ...options, onRebuild: (s) => rebuilds.push(s) })
  return { layer, fake: fakeGl(), rebuilds }
}

describe("the custom layer interface — criterion 1", () => {
  it("declares the id, type and rendering mode MapLibre needs", () => {
    const layer = new FogMaskLayer()
    expect(layer.id).toBe("fog-mask")
    expect(layer.type).toBe("custom")
    expect(layer.renderingMode).toBe("2d")
    expect(typeof layer.onAdd).toBe("function")
    expect(typeof layer.prerender).toBe("function")
    expect(typeof layer.render).toBe("function")
    expect(typeof layer.onRemove).toBe("function")
  })

  /**
   * `0118` finding 2, and it is not a style choice: the vertex shader needs
   * `shaderData.vertexShaderPrelude`, which exists only on the render-method input. `onAdd` gets the
   * map and the context and nothing else, so a layer that built its program there would be
   * compiling against a prelude it had to invent.
   */
  it("builds nothing in onAdd — the prelude only exists on the render input", () => {
    const { layer, fake } = layerOn()
    layer.onAdd()
    expect(fake.calls).toHaveLength(0)
    expect(layer.maskTexture()).toBeNull()

    layer.prerender(fake.gl, renderInput())
    expect(fake.of("createProgram").length).toBeGreaterThan(0)
    expect(layer.maskTexture()).not.toBeNull()
  })

  it("rebuilds the program when the projection variant changes, and not otherwise", () => {
    const { layer, fake } = layerOn()
    layer.prerender(fake.gl, renderInput("mercator"))
    const built = fake.of("createProgram").length
    layer.prerender(fake.gl, renderInput("mercator"))
    expect(fake.of("createProgram")).toHaveLength(built)

    layer.prerender(fake.gl, renderInput("globe"))
    expect(fake.of("createProgram").length).toBeGreaterThan(built)
    // The old program is freed rather than leaked on the way.
    expect(fake.of("deleteProgram").length).toBe(built)
  })

  it("re-uploads the bucket after a variant rebuild instead of drawing an empty mask", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(BUCKET)
    layer.prerender(fake.gl, renderInput("mercator"))
    expect(layer.stats().visibleInstanceCount).toBe(BUCKET.count)

    layer.prerender(fake.gl, renderInput("globe"))
    expect(layer.stats().visibleInstanceCount).toBe(BUCKET.count)
    const draw = fake.of("drawArraysInstanced").at(-1)!
    expect(draw.args[3]).toBe(BUCKET.count)
  })

  it("frees its GPU resources on remove and re-queues the bucket for a re-add", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(BUCKET)
    layer.prerender(fake.gl, renderInput())
    layer.onRemove(null as never, fake.gl)

    expect(fake.of("deleteFramebuffer")).toHaveLength(1)
    expect(fake.of("deleteTexture")).toHaveLength(1)
    expect(layer.maskTexture()).toBeNull()

    // A style change removes and re-adds custom layers. The bucket must survive that round trip,
    // or the map comes back fogless until the next delta.
    layer.prerender(fake.gl, renderInput())
    expect(fake.of("drawArraysInstanced").at(-1)!.args[3]).toBe(BUCKET.count)
  })
})

describe("setBucket", () => {
  /**
   * Criterion 5's "never per frame", enforced where it can actually be enforced: the layer uploads
   * only when it has been handed something new, so a hundred frames after one `setBucket` are a
   * hundred draws and one upload.
   */
  it("uploads once per bucket, not once per frame", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(packBucket(cells))
    for (let i = 0; i < 5; i++) layer.prerender(fake.gl, renderInput())

    const uploads = fake.of("bufferData").length + fake.of("bufferSubData").length
    // One for the static quad, one for the instances. Five frames added nothing.
    expect(uploads).toBe(2)
    expect(fake.of("drawArraysInstanced")).toHaveLength(5)
  })

  it("defers the upload to prerender rather than touching GL from the caller", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(packBucket(cells))
    // Nothing has touched the context yet: a custom layer may only use GL inside its own hooks.
    expect(fake.calls).toHaveLength(0)
    layer.prerender(fake.gl, renderInput())
    expect(fake.of("drawArraysInstanced")).toHaveLength(1)
  })

  it("draws an empty mask, not a stale one, when the set is emptied", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(packBucket(cells))
    layer.prerender(fake.gl, renderInput())
    layer.setBucket(packBucket([]))
    layer.prerender(fake.gl, renderInput())
    expect(fake.of("drawArraysInstanced").at(-1)!.args[3]).toBe(0)
    expect(layer.stats().visibleInstanceCount).toBe(0)
  })
})

describe("setOptimisticRoute — 0057, criteria 5 and 6", () => {
  const corridor = packRouteCorridor({
    type: "MultiLineString",
    coordinates: [
      [
        [NEMO.lng, NEMO.lat],
        [NEMO.lng, NEMO.lat + 0.009],
      ],
    ],
  })

  it("draws the corridor as well as the cells, in one call", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(BUCKET)
    layer.setOptimisticRoute(corridor)
    layer.prerender(fake.gl, renderInput())

    expect(corridor.count).toBeGreaterThan(0)
    // ONE draw, whatever the mix. §4 rules out a call per group as firmly as a call per cell.
    expect(fake.of("drawArraysInstanced")).toHaveLength(1)
    expect(fake.of("drawArraysInstanced")[0]!.args[3]).toBe(BUCKET.count + corridor.count)
    expect(layer.stats().optimisticDiscs).toBe(corridor.count)
  })

  /**
   * CRITERION 5's *"cleared on the next bucket rebuild"*, which is the half of this optimisation
   * that keeps it honest. A corridor that survived its own replacement would leave a permanent
   * band of extra revealed ground around the newest run, growing by one run per sync — the
   * client inventing territory, slowly.
   */
  it("is discarded by the next bucket", () => {
    const { layer, fake } = layerOn()
    layer.setOptimisticRoute(corridor)
    layer.prerender(fake.gl, renderInput())
    expect(layer.stats().visibleInstanceCount).toBe(corridor.count)

    layer.setBucket(BUCKET)
    layer.prerender(fake.gl, renderInput())
    expect(layer.stats().optimisticDiscs).toBe(0)
    expect(fake.of("drawArraysInstanced").at(-1)!.args[3]).toBe(BUCKET.count)
  })

  it("draws before any cells exist at all — the corridor is the point of it", () => {
    const { layer, fake } = layerOn()
    layer.setOptimisticRoute(corridor)
    layer.prerender(fake.gl, renderInput())
    expect(fake.of("drawArraysInstanced")[0]!.args[3]).toBe(corridor.count)
  })

  it("survives a variant rebuild along with the bucket", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(BUCKET)
    layer.setOptimisticRoute(corridor)
    layer.prerender(fake.gl, renderInput("mercator"))
    layer.prerender(fake.gl, renderInput("globe"))
    expect(fake.of("drawArraysInstanced").at(-1)!.args[3]).toBe(BUCKET.count + corridor.count)
  })

  it("clears on null", () => {
    const { layer, fake } = layerOn()
    layer.setOptimisticRoute(corridor)
    layer.prerender(fake.gl, renderInput())
    layer.setOptimisticRoute(null)
    layer.prerender(fake.gl, renderInput())
    expect(fake.of("drawArraysInstanced").at(-1)!.args[3]).toBe(0)
  })

  it("still uploads once per change, not once per frame", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(BUCKET)
    layer.setOptimisticRoute(corridor)
    for (let i = 0; i < 5; i++) layer.prerender(fake.gl, renderInput())
    // The quad, and one merged instance upload. Five frames added nothing.
    expect(fake.of("bufferData").length + fake.of("bufferSubData").length).toBe(2)
  })
})

describe("visibleInstanceCount — criterion 9, §6.4 item 1", () => {
  /**
   * "Per rebuild" means per INSTANCE-BUFFER rebuild, not per frame, and the distinction is not a
   * dodge. The mask pass is screen-space and runs every frame — sixty log lines a second is a flood,
   * not evidence, and it would push everything else out of the console. What §6.4 wants a histogram
   * of is the count the pass draws, and that changes only when the buffer is rebuilt. `stats()` is
   * the per-frame half, sampled by `0059`'s scripted camera path.
   */
  it("reports once per bucket, carrying the count and the resolution", () => {
    const { layer, fake, rebuilds } = layerOn()
    layer.setBucket(packBucket(cells))
    layer.prerender(fake.gl, renderInput())
    layer.prerender(fake.gl, renderInput())
    layer.prerender(fake.gl, renderInput())

    expect(rebuilds).toHaveLength(1)
    // Discs, not cells: the count the pass actually draws, which is what §6.4 wants a histogram of.
    expect(rebuilds[0]!.visibleInstanceCount).toBe(BUCKET.count)
    expect(BUCKET.count).toBe(BUCKET.cells + BUCKET.bridges)
    expect(BUCKET.bridges).toBeGreaterThan(0)
    expect(rebuilds[0]!.res).toBe(10)
    expect(rebuilds[0]!.maskSize).toBe("400x300")
    expect(layer.stats().passes).toBe(3)
  })

  it("reports again for a coarse bucket, at that bucket's resolution", () => {
    const { layer, fake, rebuilds } = layerOn()
    const parents = gridDisk(latLngToCell(NEMO.lat, NEMO.lng, 6), 1)
    const coarse = packBucket(parents, { res: 6, fractions: new Map() })
    layer.setBucket(BUCKET)
    layer.prerender(fake.gl, renderInput())
    layer.setBucket(coarse)
    layer.prerender(fake.gl, renderInput())

    expect(rebuilds.map((r) => [r.res, r.visibleInstanceCount])).toEqual([
      [10, BUCKET.count],
      [6, coarse.count],
    ])
  })

  it("carries the restore read-back so a leak is visible from outside the layer", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(packBucket(cells))
    layer.prerender(fake.gl, renderInput())
    expect(layer.stats().restore).toMatchObject({
      blendEquationRGB: "FUNC_ADD",
      framebufferUnbound: true,
      viewportRestored: true,
    })
  })
})

describe("render — 0056's composite and 0055's debug blit", () => {
  /** `prerender` once so there is a mask to composite, then start counting. */
  function primed(options: Parameters<typeof layerOn>[0] = {}) {
    const ctx = layerOn(options)
    ctx.layer.setBucket(packBucket(cells))
    ctx.layer.prerender(ctx.fake.gl, renderInput())
    ctx.fake.calls.length = 0
    return ctx
  }

  it("composites one full-screen triangle with the flag off", () => {
    const { layer, fake } = primed()
    layer.render(fake.gl, renderInput())

    const draws = fake.of("drawArrays")
    expect(draws).toHaveLength(1)
    expect(draws[0]!.args).toEqual([GL.TRIANGLES, 0, 3])
    expect(layer.stats().composites).toBe(1)
  })

  it("anchors the noise to the ground, and says so in stats", () => {
    const { layer, fake } = primed()
    layer.render(fake.gl, renderInput())

    const noise = layer.stats().noise
    expect(noise?.degenerate).toBe(false)
    expect(noise?.scale).toBeGreaterThan(0)
    expect(Number.isInteger(noise?.origin[0])).toBe(true)
  })

  it("falls back to screen space rather than to a blank frame on a singular mainMatrix", () => {
    const { layer, fake } = primed()
    layer.render(fake.gl, renderInput("mercator", new Float32Array(16)))
    expect(layer.stats().noise?.degenerate).toBe(true)
    expect(fake.of("drawArrays")).toHaveLength(1)
  })

  it("reads the time source once per composite and sends it to the GPU", () => {
    let clock = 0
    const { layer, fake } = primed({ timeSource: () => clock })
    clock = 12.5
    layer.render(fake.gl, renderInput())
    expect(layer.stats().fogTime).toBe(12.5)
    expect(fake.of("uniform1f").map((c) => c.args[1])).toContain(12.5)
  })

  it("defaults to a frozen fog rather than a broken one when there is no animator", () => {
    const { layer, fake } = primed()
    layer.render(fake.gl, renderInput())
    expect(layer.stats().fogTime).toBe(0)
  })

  it("ships V1's palette by default", () => {
    const { layer, fake } = primed()
    layer.render(fake.gl, renderInput())
    expect(fake.of("uniform3f").map((c) => c.args.slice(1))).toEqual([
      [...V1.fogDeep],
      [...V1.fogEdge],
      [...V1.rimGlow],
    ])
  })

  /**
   * `render` runs every frame. Building the program there is correct — it is the first moment the
   * context is ours — and rebuilding it there would be a compile per frame, which is the shape of
   * bug that shows up as a mysterious 4 fps rather than as an error.
   */
  it("builds the composite program ONCE across many frames", () => {
    const { layer, fake } = primed()
    for (let i = 0; i < 20; i++) layer.render(fake.gl, renderInput())
    expect(fake.of("createProgram")).toHaveLength(1)
    expect(layer.stats().composites).toBe(20)
  })

  it("blits the raw mask instead, with the debug flag on", () => {
    const { layer, fake } = primed({ debug: true })
    layer.render(fake.gl, renderInput())
    expect(fake.of("drawArrays")[0]!.args).toEqual([GL.TRIANGLES, 0, 3])
    // The blit is 0055's program; the composite never ran, so there is nothing to report.
    expect(layer.stats().composites).toBe(0)
    expect(fake.of("uniformMatrix3fv")).toHaveLength(0)
  })

  it("renders nothing before the first prerender has built resources", () => {
    const { layer, fake } = layerOn()
    layer.render(fake.gl, renderInput())
    expect(fake.calls).toHaveLength(0)
  })

  it("passes the octave lever through to the shader it compiles", () => {
    const { layer, fake } = primed({ octaves: 2 })
    layer.render(fake.gl, renderInput())
    expect(fake.sources.fragment.at(-1)).toContain("#define FBM_OCTAVES 2")
  })

  it("reports a composite compile failure once, and stops rather than retrying per frame", () => {
    const { layer, fake } = primed()
    fake.failCompile = true
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    for (let i = 0; i < 5; i++) layer.render(fake.gl, renderInput())
    error.mockRestore()

    expect(layer.stats().compositeError).toMatch(/fake compile failure/)
    expect(layer.stats().composites).toBe(0)
    expect(fake.of("drawArrays")).toHaveLength(0)
    // ONE attempt across five frames. The vertex shader throws before `createProgram` is reached,
    // so the shader count is what shows a per-frame retry — and a per-frame retry here is sixty
    // identical console lines a second with the finding buried inside the flood it caused.
    expect(fake.of("createShader")).toHaveLength(1)
  })

  it("disposes the composite's program and VAO on removal", () => {
    const { layer, fake } = primed()
    layer.render(fake.gl, renderInput())
    const before = fake.of("deleteProgram").length
    layer.onRemove(null as never, fake.gl)
    // 0055's two mask programs plus 0056's composite.
    expect(fake.of("deleteProgram").length - before).toBe(3)
  })
})

describe("maskDebugEnabled", () => {
  // The flag itself is `debug-flags.test.ts`'s subject — including the `?fog=mask,debug`
  // composition that this module's own copy of the parser got wrong. Re-exported here because this
  // is where callers import it from, so the re-export is what needs asserting.
  it("is re-exported from this module and reads ?fog=mask", () => {
    expect(maskDebugEnabled("?fog=mask")).toBe(true)
    expect(maskDebugEnabled("?fog=mask,debug")).toBe(true)
    expect(maskDebugEnabled("?fog=debug")).toBe(false)
  })
})

describe("a shader that will not compile", () => {
  it("reports it once and stops drawing rather than throwing inside MapLibre's frame", () => {
    const { layer, fake } = layerOn()
    fake.failCompile = true
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => layer.prerender(fake.gl, renderInput())).not.toThrow()
    expect(layer.stats().shaderError).toMatch(/fake compile failure/)
    expect(fake.of("drawArraysInstanced")).toHaveLength(0)

    // Once, not sixty times a second — the finding has to be readable to reach anyone.
    layer.prerender(fake.gl, renderInput())
    layer.prerender(fake.gl, renderInput())
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it("retries on a projection change, because that is a different prelude", () => {
    const { layer, fake } = layerOn()
    fake.failCompile = true
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    layer.prerender(fake.gl, renderInput("mercator"))
    expect(layer.stats().shaderError).not.toBeNull()

    fake.failCompile = false
    layer.prerender(fake.gl, renderInput("globe"))
    expect(layer.stats().shaderError).toBeNull()
    expect(fake.of("drawArraysInstanced")).toHaveLength(1)
    error.mockRestore()
  })
})
