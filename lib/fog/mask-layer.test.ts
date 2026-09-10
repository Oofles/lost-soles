import type { CustomRenderMethodInput } from "maplibre-gl"
import { latLngToCell, gridDisk } from "h3-js"
import { describe, expect, it, vi } from "vitest"

import { fakeGl, GL, type FakeGl } from "./__fixtures__/fake-gl"
import { packBucket } from "./instances"
import { FogMaskLayer, maskDebugEnabled, type MaskStats } from "./mask-layer"
import { STUB_PRELUDE } from "./mask"

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
function renderInput(variantName = "mercator"): CustomRenderMethodInput {
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
      mainMatrix: new Float32Array(16),
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

function layerOn(options: { debug?: boolean } = {}): {
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

describe("render — criterion 1's passthrough and criterion 10's debug blit", () => {
  it("does nothing at all with the debug flag off", () => {
    const { layer, fake } = layerOn()
    layer.setBucket(packBucket(cells))
    layer.prerender(fake.gl, renderInput())
    fake.calls.length = 0
    layer.render(fake.gl)
    // 0056 fills this in. Until then the layer must be invisible rather than approximately right —
    // a placeholder veil would be mistaken for the fog and tuned instead of replaced.
    expect(fake.calls).toHaveLength(0)
  })

  it("blits the mask as greyscale with the debug flag on", () => {
    const { layer, fake } = layerOn({ debug: true })
    layer.setBucket(packBucket(cells))
    layer.prerender(fake.gl, renderInput())
    fake.calls.length = 0
    layer.render(fake.gl)
    expect(fake.of("drawArrays")[0]!.args).toEqual([GL.TRIANGLES, 0, 3])
  })

  it("renders nothing before the first prerender has built resources", () => {
    const { layer, fake } = layerOn({ debug: true })
    layer.render(fake.gl)
    expect(fake.calls).toHaveLength(0)
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
