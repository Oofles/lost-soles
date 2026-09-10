import { describe, expect, it } from "vitest"

import { fakeGl, GL } from "./__fixtures__/fake-gl"
import {
  INSTANCE_FLOATS,
  MASK_FRAGMENT_SOURCE,
  MASK_SCALE,
  REVEAL_SCALE,
  REVEAL_SCALE_MAX,
  FALLOFF_INNER,
  REVEAL_SCALE_MIN,
  SEAM_FLOOR,
  STUB_PRELUDE,
  createMaskResources,
  disposeMaskResources,
  maskDimensions,
  maskVertexSource,
  resizeMask,
  restoreOk,
  runDebugBlit,
  runMaskPass,
  setProjectionUniforms,
  uploadInstances,
} from "./mask"

/**
 * Ticket `0055`, pass 1. `05-fog-of-war.md` §4.1, §4.2.
 *
 * WHAT THESE TESTS CAN AND CANNOT PROVE, stated up front because the boundary is the whole design
 * of the verification for this ticket. A recording fake context proves the CALLS: that `gl.MAX` is
 * set, that state is put back, that there is exactly one instanced draw whatever the cell count,
 * that the FBO tracks the drawing buffer. It cannot prove a single pixel.
 *
 * `tools/fog-harness/run.mjs` is the other half and it runs this same module on a real GPU: that
 * `a_fraction` dims a disc rather than leaving it solid, that overlapping discs union instead of
 * summing, and that neighbours at `REVEAL_SCALE` merge with no scalloping notch. Splitting them
 * this way is `0118`'s lesson — the numeric claims go where a driver can contradict them.
 */

const PROJECTION = {
  mainMatrix: new Float32Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)),
  tileMercatorCoords: [0, 0, 1, 1] as const,
  clippingPlane: [0, 0, 0, 0] as const,
  projectionTransition: 0,
  fallbackMatrix: new Float32Array(16),
  clipAntimeridian: false,
}

function resourcesOn(fake = fakeGl()) {
  const res = createMaskResources(fake.gl, {
    prelude: STUB_PRELUDE,
    define: "#define PROJECTION_MERCATOR",
    width: fake.gl.drawingBufferWidth,
    height: fake.gl.drawingBufferHeight,
  })
  return { fake, res }
}

describe("REVEAL_SCALE — §4.1's disc radius", () => {
  it("is 1.35 and sits inside R4's 1.15/1.6 bounds", () => {
    expect(REVEAL_SCALE).toBe(1.35)
    expect(REVEAL_SCALE).toBeGreaterThan(REVEAL_SCALE_MIN)
    expect(REVEAL_SCALE).toBeLessThan(REVEAL_SCALE_MAX)
  })

  /**
   * §4.1's actual claim, arithmetic rather than aesthetic: at 1.35 x 75.9 m against a 131.4 m
   * centre spacing, a neighbour's disc reaches past your centre-to-edge midpoint, which is why a
   * contiguous run of cells merges into one region instead of a string of scallops.
   */
  it("overlaps a neighbour past its half-power point at res 10", () => {
    const radiusM = REVEAL_SCALE * 75.9
    const spacingM = 131.4
    expect(radiusM).toBeGreaterThan(spacingM / 2)
    expect(radiusM).toBeCloseTo(102, 0) // §4.1's "1.35 x 75.9 ~= 102 m"
  })

  /**
   * SCALLOPING, AS A NUMBER. The operator check for this ticket is *"look for the repeating
   * semicircular notch between adjacent cells"*, and this is what that notch is: the coverage
   * halfway between two neighbouring cell centres, which under `MAX` is the deeper of the two
   * discs' own falloff there.
   *
   * A JS MIRROR OF THE SHADER, AND THE SHADER IS AUTHORITATIVE. This asserts the constant is doing
   * work, not that the GPU agrees — `tools/fog-harness` reads the real mask back and measures the
   * same trough. Kept anyway because it is what turns "1.35 is the right number" from a quotation
   * into something a later session can argue with.
   */
  it("holds the seam above 0056's threshold, which is what 0.45 failed to do", () => {
    const smoothstep = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
      return t * t * (3 - 2 * t)
    }
    /** Coverage at the midpoint between two adjacent res-10 cells, 131.4 m apart. */
    const seam = (inner: number, scale = REVEAL_SCALE) =>
      1 - smoothstep(inner, 1, 131.4 / 2 / (scale * 75.9))

    // D-231. The floor comes from §4.3's own constants, not from what the code happens to produce.
    expect(seam(FALLOFF_INNER)).toBeGreaterThan(SEAM_FLOOR)
    expect(seam(FALLOFF_INNER)).toBeGreaterThan(0.96)

    /**
     * THE REGRESSION THIS FILE EXISTS TO PREVENT. `0.45` is what §4.2 originally specified, and it
     * puts the seam at 0.72 — below the floor, and visible on sight as a chain of discs with a
     * crease at every join. Asserted explicitly so a later "restore the doc's value" edit fails.
     */
    expect(seam(0.45)).toBeLessThan(SEAM_FLOOR)
    expect(seam(0.45)).toBeCloseTo(0.72, 2)
  })

  it("still needs revealScale itself, not just the falloff — the discs must overlap at all", () => {
    const smoothstep = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
      return t * t * (3 - 2 * t)
    }
    const seam = (scale: number) => 1 - smoothstep(FALLOFF_INNER, 1, 131.4 / 2 / (scale * 75.9))
    // Below R4's lower bound the neighbour is past the ramp entirely and the trough collapses,
    // whatever the falloff does — which is why the two constants are both load-bearing.
    expect(seam(REVEAL_SCALE_MIN)).toBeLessThan(seam(REVEAL_SCALE))
    expect(seam(REVEAL_SCALE_MAX)).toBe(1)
  })
})

describe("the shaders", () => {
  it("takes projection from MapLibre's prelude and declares no matrix of its own", () => {
    const source = maskVertexSource(STUB_PRELUDE, "#define PROJECTION_MERCATOR")
    expect(source).toContain(STUB_PRELUDE)
    expect(source).toContain("projectTile(a_center + a_quad * a_radius)")
    // Criterion 7: the layer must not declare the uniform the prelude already declares — that is
    // a redefinition error under globe, where the prelude declares more than one.
    const ownDeclaration = source
      .replace(STUB_PRELUDE, "")
      .includes("uniform mat4 u_projection_matrix")
    expect(ownDeclaration).toBe(false)
  })

  it("puts the prelude before the first use of projectTile", () => {
    const source = maskVertexSource(STUB_PRELUDE, "")
    expect(source.indexOf("vec4 projectTile")).toBeLessThan(source.indexOf("gl_Position"))
    // #version must be the first line of a GLSL ES 3.00 shader, before the injected prelude.
    expect(source.startsWith("#version 300 es\n")).toBe(true)
  })

  it("multiplies coverage by a_fraction and ramps with smoothstep, not a hard edge", () => {
    // The constant is interpolated from `FALLOFF_INNER`, so this asserts the wiring as well as the
    // value — a shader with the number typed in twice is a shader that drifts from its own constant.
    expect(MASK_FRAGMENT_SOURCE).toContain(`1.0 - smoothstep(${FALLOFF_INNER.toFixed(2)}, 1.0, d)`)
    expect(FALLOFF_INNER).toBe(0.6)
    expect(MASK_FRAGMENT_SOURCE).toContain("* v_fraction")
    // The disc is round even though the quad is square.
    expect(MASK_FRAGMENT_SOURCE).toContain("discard")
  })
})

describe("setProjectionUniforms", () => {
  /**
   * `0118` finding 1: under mercator the globe uniforms are stripped by the compiler, so their
   * locations are null. An unguarded set would throw inside MapLibre's own frame.
   */
  it("skips uniforms the compiler stripped instead of throwing", () => {
    const { fake, res } = resourcesOn()
    expect(() => setProjectionUniforms(fake.gl, res.maskProgram, PROJECTION)).not.toThrow()
    expect(fake.of("uniformMatrix4fv")).toHaveLength(1) // u_projection_matrix only
    expect(fake.of("uniform4fv")).toHaveLength(0) // the globe uniforms resolved to null
  })
})

describe("the mask framebuffer", () => {
  it("is half the drawing buffer, single-channel R8, LINEAR and CLAMP_TO_EDGE", () => {
    const { fake, res } = resourcesOn(fakeGl({ width: 801, height: 601 }))
    expect(MASK_SCALE).toBe(0.5)
    expect(res.maskW).toBe(400)
    expect(res.maskH).toBe(300)

    const alloc = fake.of("texImage2D")[0]!
    expect(alloc.args[2]).toBe(GL.R8)
    expect(alloc.args[3]).toBe(400)
    expect(alloc.args[4]).toBe(300)
    expect(alloc.args[6]).toBe(GL.RED)

    const params = fake.of("texParameteri").map((c) => c.args.slice(1))
    expect(params).toEqual([
      [GL.TEXTURE_MIN_FILTER, GL.LINEAR],
      [GL.TEXTURE_MAG_FILTER, GL.LINEAR],
      [GL.TEXTURE_WRAP_S, GL.CLAMP_TO_EDGE],
      [GL.TEXTURE_WRAP_T, GL.CLAMP_TO_EDGE],
    ])
  })

  it("never allocates a zero-sized mask", () => {
    expect(maskDimensions(1, 1)).toEqual({ maskW: 1, maskH: 1 })
    expect(maskDimensions(0, 0)).toEqual({ maskW: 1, maskH: 1 })
  })

  it("reallocates on a resize and reuses the same FBO and texture", () => {
    const { fake, res } = resourcesOn()
    const before = fake.of("createFramebuffer").length
    expect(resizeMask(fake.gl, res, 1000, 500)).toBe(true)
    expect(res.maskW).toBe(500)
    expect(res.maskH).toBe(250)
    expect(fake.of("createFramebuffer")).toHaveLength(before)
    // A resize to the same size must not churn the texture.
    expect(resizeMask(fake.gl, res, 1000, 500)).toBe(false)
  })
})

describe("the instance buffer", () => {
  it("packs INSTANCE_FLOATS per instance and reports the count", () => {
    const { fake, res } = resourcesOn()
    uploadInstances(fake.gl, res, new Float32Array(3 * INSTANCE_FLOATS))
    expect(res.instanceCount).toBe(3)
    expect(fake.uploads.at(-1)).toHaveLength(3 * INSTANCE_FLOATS)
  })

  it("reuses the allocation when the new bucket fits, and grows when it does not", () => {
    const { fake, res } = resourcesOn()
    uploadInstances(fake.gl, res, new Float32Array(10 * INSTANCE_FLOATS))
    const grows = fake.of("bufferData").length
    uploadInstances(fake.gl, res, new Float32Array(4 * INSTANCE_FLOATS))
    expect(fake.of("bufferData")).toHaveLength(grows) // reused
    expect(fake.of("bufferSubData")).toHaveLength(1)
    expect(res.instanceCount).toBe(4) // the DRAW count, not the buffer's capacity
    uploadInstances(fake.gl, res, new Float32Array(40 * INSTANCE_FLOATS))
    expect(fake.of("bufferData")).toHaveLength(grows + 1)
  })

  /**
   * The divisor is what makes this an INSTANCED draw. Without it every instance reads vertex 0's
   * attributes and a 6,000-cell bucket renders one disc — which reads as "the data is wrong".
   */
  it("marks the quad per-vertex and every packed attribute per-instance", () => {
    const { fake } = resourcesOn()
    const divisors = fake.of("vertexAttribDivisor").map((c) => c.args)
    expect(divisors).toEqual([
      [0, 0], // a_quad
      [1, 1], // a_center
      [2, 1], // a_radius
      [3, 1], // a_fraction
    ])
  })

  it("uses criterion 5's byte layout: centre, radius, fraction, tightly strided", () => {
    const { fake } = resourcesOn()
    const stride = INSTANCE_FLOATS * 4
    const pointers = fake
      .of("vertexAttribPointer")
      .filter((c) => c.args[0] !== 0)
      .map((c) => [c.args[0], c.args[1], c.args[4], c.args[5]])
    expect(pointers).toEqual([
      [1, 2, stride, 0], // a_center  — 2 floats at byte 0
      [2, 1, stride, 8], // a_radius  — 1 float  at byte 8
      [3, 1, stride, 12], // a_fraction — 1 float  at byte 12
    ])
  })
})

describe("runMaskPass — §4.2", () => {
  it("binds the mask FBO, clears it to zero and sets gl.MAX", () => {
    const { fake, res } = resourcesOn()
    uploadInstances(fake.gl, res, new Float32Array(5 * INSTANCE_FLOATS))
    fake.calls.length = 0

    runMaskPass(fake.gl, res, PROJECTION)

    const names = fake.calls.map((c) => c.name)
    expect(names.indexOf("bindFramebuffer")).toBeLessThan(names.indexOf("clear"))
    expect(fake.of("clearColor")[0]!.args).toEqual([0, 0, 0, 1])
    expect(fake.of("clear")[0]!.args).toEqual([GL.COLOR_BUFFER_BIT])
    // Union, not sum (§4.1). The one call this whole ticket rests on.
    expect(fake.of("blendEquation")[0]!.args).toEqual([GL.MAX])
    expect(fake.of("blendFunc")[0]!.args).toEqual([GL.ONE, GL.ONE])
    // The mask is drawn at half resolution, so the viewport must follow it there.
    expect(fake.of("viewport")[0]!.args).toEqual([0, 0, res.maskW, res.maskH])
  })

  /**
   * Criterion 3, and it is the reason the layer exists in this shape: one draw call per cell is
   * draw-call bound around ~2k cells, which §4 rules out explicitly.
   */
  it("is exactly one drawArraysInstanced regardless of cell count", () => {
    for (const count of [0, 1, 2_000, 150_000]) {
      const { fake, res } = resourcesOn()
      uploadInstances(fake.gl, res, new Float32Array(count * INSTANCE_FLOATS))
      fake.calls.length = 0
      runMaskPass(fake.gl, res, PROJECTION)
      const draws = fake.of("drawArraysInstanced")
      expect(draws).toHaveLength(1)
      expect(draws[0]!.args).toEqual([GL.TRIANGLE_STRIP, 0, 4, count])
      expect(fake.of("drawArrays")).toHaveLength(0)
    }
  })

  /**
   * CRITERION 4. MapLibre calls `setBaseState()` after both custom-layer hooks, so it would recover
   * on its own — but §4.2 says restore anyway, because leaving `MAX` set "is the kind of bug that
   * shows up three layers later as 'why is the basemap wrong'". Read back rather than assumed.
   */
  it("restores blend equation, blend func, framebuffer and viewport", () => {
    const { fake, res } = resourcesOn()
    uploadInstances(fake.gl, res, new Float32Array(2 * INSTANCE_FLOATS))
    const before = Array.from(fake.gl.getParameter(GL.VIEWPORT) as Int32Array)

    const restore = runMaskPass(fake.gl, res, PROJECTION)

    expect(restore.blendEquationRGB).toBe("FUNC_ADD")
    expect(restore.blendEquationAlpha).toBe("FUNC_ADD")
    expect(restore.blendSrcRGB).toBe(GL.ONE)
    expect(restore.blendDstRGB).toBe(GL.ONE_MINUS_SRC_ALPHA)
    expect(restore.framebufferUnbound).toBe(true)
    expect(restore.viewportRestored).toBe(true)
    expect(restoreOk(restore)).toBe(true)
    expect(Array.from(fake.gl.getParameter(GL.VIEWPORT) as Int32Array)).toEqual(before)
    // And the VAO is unbound, so MapLibre's next draw cannot inherit our attribute pointers.
    expect(fake.of("bindVertexArray").at(-1)!.args).toEqual([null])
  })

  /**
   * `restoreOk` has to be able to say NO. A checker that returns true for everything is the
   * decoration `0118` warned about, so each failure mode is asserted individually.
   */
  it("restoreOk rejects each way the restore can fail", () => {
    const good = {
      blendEquationRGB: "FUNC_ADD",
      blendEquationAlpha: "FUNC_ADD",
      blendSrcRGB: GL.ONE,
      blendDstRGB: GL.ONE_MINUS_SRC_ALPHA,
      framebufferUnbound: true,
      viewportRestored: true,
    }
    expect(restoreOk(good)).toBe(true)
    expect(restoreOk({ ...good, blendEquationRGB: "MAX" })).toBe(false)
    expect(restoreOk({ ...good, blendEquationAlpha: "MAX" })).toBe(false)
    expect(restoreOk({ ...good, framebufferUnbound: false })).toBe(false)
    expect(restoreOk({ ...good, viewportRestored: false })).toBe(false)
  })

  it("leaves MAX set only between the bind and the restore, never at the end", () => {
    const { fake, res } = resourcesOn()
    runMaskPass(fake.gl, res, PROJECTION)
    const equations = fake.of("blendEquation").map((c) => c.args[0])
    expect(equations).toEqual([GL.MAX, GL.FUNC_ADD])
  })
})

describe("the debug blit — criterion 10", () => {
  it("draws one full-screen triangle with premultiplied blending", () => {
    const { fake, res } = resourcesOn()
    fake.calls.length = 0
    runDebugBlit(fake.gl, res)
    expect(fake.of("drawArrays")[0]!.args).toEqual([GL.TRIANGLES, 0, 3])
    // MapLibre's render pass expects premultiplied alpha; an opaque blit would satisfy "the mask is
    // visible" and break "the basemap renders unchanged" in the same frame (0118 finding 3).
    expect(fake.of("blendFunc")[0]!.args).toEqual([GL.ONE, GL.ONE_MINUS_SRC_ALPHA])
    // No attribute buffer at all — the triangle comes from gl_VertexID.
    expect(fake.of("bufferData")).toHaveLength(0)
  })
})

describe("disposeMaskResources", () => {
  it("frees every object it created", () => {
    const { fake, res } = resourcesOn()
    disposeMaskResources(fake.gl, res)
    expect(fake.of("deleteProgram")).toHaveLength(2)
    expect(fake.of("deleteBuffer")).toHaveLength(2)
    expect(fake.of("deleteVertexArray")).toHaveLength(2)
    expect(fake.of("deleteFramebuffer")).toHaveLength(1)
    expect(fake.of("deleteTexture")).toHaveLength(1)
  })
})

describe("a shader that will not compile", () => {
  it("throws with the driver's log verbatim rather than 'shader failed'", () => {
    const fake = fakeGl()
    fake.failCompile = true
    expect(() => resourcesOn(fake)).toThrow(/vertex shader: fake compile failure/)
  })
})
