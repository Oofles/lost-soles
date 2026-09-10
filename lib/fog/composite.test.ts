import { describe, expect, it } from "vitest"

import { fakeGl, GL } from "./__fixtures__/fake-gl"
import {
  COMPOSITE_VERTEX_SOURCE,
  compositeFragmentSource,
  compositeRestoreOk,
  createCompositeResources,
  disposeCompositeResources,
  groundNoiseCoord,
  noiseFrame,
  runCompositePass,
  TIME_WRAP_S,
  type NoiseFrame,
} from "./composite"
import { FBM_OCTAVES, NOISE_ORIGIN_MODULUS, NOISE_PX, REVEAL_HI, REVEAL_LO, V1 } from "./fog-uniforms"

/**
 * A MapLibre-shaped mercator projection matrix, column-major, exactly as `mainMatrix` arrives.
 *
 *   ndc.x = (mercX - centreX) * 2S / W
 *   ndc.y = -(mercY - centreY) * 2S / H     (screen y runs down, ndc y runs up)
 *
 * `S` is the world size in drawing-buffer pixels — `512 * 2^zoom * devicePixelRatio` — which is the
 * only place zoom enters. `pitchW` puts a non-constant `w` row in, which is what a pitched camera
 * actually produces: the ground plane reaches the screen through a projective map, not an affine
 * one, and the whole reason `noiseFrame` inverts a homography rather than a 2x3.
 */
function mercatorMatrix(options: {
  centreX: number
  centreY: number
  zoom: number
  width: number
  height: number
  dpr?: number
  pitchW?: number
}): Float64Array {
  const { centreX, centreY, zoom, width, height, dpr = 1, pitchW = 0 } = options
  const s = 512 * 2 ** zoom * dpr
  const m = new Float64Array(16)
  m[0] = (2 * s) / width // row 0, col 0
  m[5] = (-2 * s) / height // row 1, col 1
  m[10] = 1
  m[15] = 1 // row 3, col 3
  m[12] = (-centreX * 2 * s) / width // row 0, col 3
  m[13] = (centreY * 2 * s) / height // row 1, col 3
  m[7] = pitchW // row 3, col 1 — w varies with mercator y
  return m
}

/** Forward-project a mercator point to NDC through the same matrix, as the GPU would. */
function toNdc(m: ArrayLike<number>, x: number, y: number): [number, number] {
  const cx = m[0]! * x + m[4]! * y + m[12]!
  const cy = m[1]! * x + m[5]! * y + m[13]!
  const cw = m[3]! * x + m[7]! * y + m[15]!
  return [cx / cw, cy / cw]
}

/**
 * What the FRAGMENT SHADER computes for a ground point: run the point forward to NDC, then back
 * through `u_noiseMatrix`, then add `u_noiseOrigin` — the same three steps, in the same order, as
 * the vertex shader's `u_noiseMatrix * vec3(p, 1.0)`, the fragment's divide, and `vnoise`'s
 * `floor(p) + o`.
 *
 * THIS IS THE POINT OF THE TEST FILE. Asserting `merc * scale` directly would only prove
 * multiplication; going through the inverted matrix is what proves the inversion.
 */
function shaderNoiseCoord(
  frame: NoiseFrame,
  m: ArrayLike<number>,
  x: number,
  y: number,
): [number, number] {
  const [nx, ny] = toNdc(m, x, y)
  const n = frame.matrix // column-major: n[col * 3 + row]
  const qx = n[0]! * nx + n[3]! * ny + n[6]!
  const qy = n[1]! * nx + n[4]! * ny + n[7]!
  const qw = n[2]! * nx + n[5]! * ny + n[8]!
  return [qx / qw + frame.origin[0], qy / qw + frame.origin[1]]
}

/** Ponte Vedra, roughly — the operator's actual ground, so the magnitudes are the real ones. */
const HOME = { x: 0.2739, y: 0.3767 }

/**
 * ONE PAN, SHARED BY THE ASSERTION AND ITS SABOTAGE CASE, so the two cannot quietly diverge into
 * "the ground-anchored one was tested with a small drag and the screen-space one with a big one".
 * Half a screen width and a fifth of its height at z14 — one ordinary drag of the map.
 */
const PAN = { dx: 800 / (512 * 2 ** 14), dy: 200 / (512 * 2 ** 14) }

describe("noiseFrame — the ground anchoring (D-233, criterion 9)", () => {
  const view = { width: 1600, height: 1000 }

  it("inverts mainMatrix: the matrix path agrees with merc x scale", () => {
    const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom: 14, ...view })
    const frame = noiseFrame(m, view.width, view.height)

    const viaMatrix = shaderNoiseCoord(frame, m, HOME.x + 1e-4, HOME.y - 1e-4)
    const direct = groundNoiseCoord(frame, HOME.x + 1e-4, HOME.y - 1e-4)

    expect(viaMatrix[0]).toBeCloseTo(direct[0], 6)
    expect(viaMatrix[1]).toBeCloseTo(direct[1], 6)
  })

  it("holds under a PITCHED camera, where the mapping is projective and not affine", () => {
    const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom: 14, ...view, pitchW: 0.8 })
    const frame = noiseFrame(m, view.width, view.height)

    // Three points spread across the ground, so a matrix that happened to be right at the centre
    // and wrong elsewhere — which is exactly what dropping the w row would give — fails here.
    for (const [dx, dy] of [
      [0, 0],
      [4e-4, 2e-4],
      [-6e-4, 5e-4],
    ] as const) {
      const viaMatrix = shaderNoiseCoord(frame, m, HOME.x + dx, HOME.y + dy)
      const direct = groundNoiseCoord(frame, HOME.x + dx, HOME.y + dy)
      expect(viaMatrix[0]).toBeCloseTo(direct[0], 5)
      expect(viaMatrix[1]).toBeCloseTo(direct[1], 5)
    }
  })

  /**
   * CRITERION 9, AS A NUMBER. The whole ticket's hardest claim: pan the map and the noise stays on
   * the ground. Two frames, one pan, one ground point, and the noise coordinate it lands on must be
   * the same in both — because that coordinate is what the hash is taken of.
   */
  it("a PAN does not move the noise: the same ground point keeps its noise coordinate", () => {
    const before = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom: 14, ...view })
    const after = mercatorMatrix({
      centreX: HOME.x + PAN.dx,
      centreY: HOME.y + PAN.dy,
      zoom: 14,
      ...view,
    })

    const f1 = noiseFrame(before, view.width, view.height)
    const f2 = noiseFrame(after, view.width, view.height)

    const q1 = shaderNoiseCoord(f1, before, HOME.x, HOME.y)
    const q2 = shaderNoiseCoord(f2, after, HOME.x, HOME.y)

    expect(q2[0]).toBeCloseTo(q1[0], 4)
    expect(q2[1]).toBeCloseTo(q1[1], 4)
  })

  /**
   * THE SABOTAGE CASE, and without it the assertion above is a decoration. `0118`'s rule: a probe
   * that can only report success proves nothing. §4.3's own sketch samples at
   * `gl_FragCoord.xy / u_screen`, so this is that recipe, on the same two frames — and it must move
   * the ground point by a large fraction of a noise cell.
   */
  it("SABOTAGE: §4.3's screen-space recipe moves the same point by most of a noise cell", () => {
    const before = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom: 14, ...view })
    const after = mercatorMatrix({
      centreX: HOME.x + PAN.dx,
      centreY: HOME.y + PAN.dy,
      zoom: 14,
      ...view,
    })

    const screenSpace = (m: ArrayLike<number>) => {
      const [nx, ny] = toNdc(m, HOME.x, HOME.y)
      // uv * u_screen / NOISE_PX, which is what §4.3 sketched.
      return [
        (((nx + 1) / 2) * view.width) / NOISE_PX,
        (((ny + 1) / 2) * view.height) / NOISE_PX,
      ]
    }
    const s1 = screenSpace(before)
    const s2 = screenSpace(after)

    expect(Math.hypot(s2[0]! - s1[0]!, s2[1]! - s1[1]!)).toBeGreaterThan(3)
  })

  /**
   * THE OTHER HALF OF CRITERION 9's RISK, and it is not the pan.
   *
   * The origin exists to keep the interpolated coordinate small. It is an integer that JUMPS as the
   * camera moves, and it is added back after `floor(p)` precisely so that the jump cancels. If the
   * matrix and the origin ever disagree, the whole noise field snaps by a whole cell at some
   * arbitrary camera position — a pop that no still screenshot can show.
   *
   * So: sweep a zoom range wide enough to cross hundreds of origin boundaries, and at every step
   * assert the matrix-and-origin path reproduces the smooth analytic coordinate. What it must NOT
   * be asserted against is its own previous value — the coordinate is SUPPOSED to drift under a
   * zoom, because the noise frequency tracks the screen scale (see `NOISE_PX`), and a test that
   * forbade that would be forbidding the design.
   */
  it("a ZOOM does not pop: the origin jumps and the matrix cancels it, every time", () => {
    let originChanges = 0
    let worstError = 0
    let previousOrigin: [number, number] | null = null

    for (let zoom = 13; zoom <= 18; zoom += 0.01) {
      const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom, ...view })
      const frame = noiseFrame(m, view.width, view.height)
      const q = shaderNoiseCoord(frame, m, HOME.x + 2e-5, HOME.y)
      const analytic = groundNoiseCoord(frame, HOME.x + 2e-5, HOME.y)

      // Relative, because the absolute coordinate legitimately reaches six figures at z18.
      worstError = Math.max(
        worstError,
        Math.hypot(q[0] - analytic[0], q[1] - analytic[1]) / Math.max(1, Math.abs(analytic[0])),
      )
      if (previousOrigin && frame.origin[0] !== previousOrigin[0]) originChanges++
      previousOrigin = frame.origin
    }

    // The sweep has to actually exercise the risk, or "no pop" is vacuous.
    expect(originChanges).toBeGreaterThan(100)
    expect(worstError).toBeLessThan(1e-9)
  })

  it("keeps the origin an exact integer inside its modulus, at every zoom", () => {
    for (const zoom of [0, 8, 14, 18, 22]) {
      const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom, ...view, dpr: 2 })
      const { origin } = noiseFrame(m, view.width, view.height)
      for (const o of origin) {
        expect(Number.isInteger(o)).toBe(true)
        expect(o).toBeGreaterThanOrEqual(0)
        expect(o).toBeLessThan(NOISE_ORIGIN_MODULUS)
      }
    }
  })

  it("keeps the LOCAL coordinate small, which is the entire reason the origin exists", () => {
    // At z18 on a DPR-2 display the absolute coordinate is in the millions and a float32 would
    // resolve `fract()` to eighths of a cell. What the shader actually interpolates must not be.
    const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom: 18, ...view, dpr: 2 })
    const frame = noiseFrame(m, view.width, view.height)
    const absolute = groundNoiseCoord(frame, HOME.x, HOME.y)
    expect(Math.abs(absolute[0])).toBeGreaterThan(100_000)

    // A corner of the screen, which is the furthest the shader's local coordinate ever gets.
    const corner = shaderNoiseCoord(frame, m, HOME.x, HOME.y)
    const local = [corner[0] - frame.origin[0], corner[1] - frame.origin[1]]
    expect(Math.abs(local[0]!)).toBeLessThan(10)
    expect(Math.abs(local[1]!)).toBeLessThan(10)
  })

  it("a noise cell is NOISE_PX drawing-buffer pixels across, at every zoom and DPR", () => {
    for (const zoom of [10, 14, 18]) {
      for (const dpr of [1, 2]) {
        const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom, ...view, dpr })
        const frame = noiseFrame(m, view.width, view.height)
        // One cell in mercator, converted to pixels by the frame's own measured scale.
        expect((1 / frame.scale) / frame.mercPerPixel).toBeCloseTo(NOISE_PX, 6)
      }
    }
  })

  it("falls back to screen space rather than to nothing when mainMatrix is singular", () => {
    const frame = noiseFrame(new Float64Array(16), 1600, 1000)
    expect(frame.degenerate).toBe(true)
    expect(frame.matrix).toHaveLength(9)
    expect(Number.isFinite(frame.matrix[0]!)).toBe(true)
    expect(frame.matrix[0]).toBeCloseTo(1600 / (2 * NOISE_PX), 6)
  })

  it("falls back on a zero-sized drawing buffer instead of dividing by it", () => {
    const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom: 14, ...view })
    expect(noiseFrame(m, 0, 0).degenerate).toBe(true)
  })
})

describe("the composite shader source", () => {
  it("carries §4.3's reveal ramp, built from the constants rather than typed twice", () => {
    const src = compositeFragmentSource()
    expect(src).toContain(`smoothstep(${REVEAL_LO}, ${REVEAL_HI}, coverage`)
  })

  it("emits PREMULTIPLIED alpha, which MapLibre's translucent blend requires", () => {
    expect(compositeFragmentSource()).toContain("fragColor = vec4(col * alpha, alpha)")
  })

  /** Criterion 2 — lever (c) is one edit, and the `#define` is what makes it one. */
  it("puts the octave count in a #define, defaulting to FBM_OCTAVES", () => {
    expect(compositeFragmentSource()).toContain(`#define FBM_OCTAVES ${FBM_OCTAVES}`)
    expect(compositeFragmentSource(2)).toContain("#define FBM_OCTAVES 2")
  })

  /**
   * D-233's GUARD. §4.3's sketch is still in the design document beside the amendment, and the
   * shape of a regression here is somebody pasting it back in — which would look right in review
   * and be caught only by panning a real map.
   */
  it("does NOT sample the noise in screen space", () => {
    const src = compositeFragmentSource()
    expect(src).not.toContain("u_screen")
    expect(src).not.toContain("gl_FragCoord")
    expect(src).toContain("v_noiseH.xy / v_noiseH.z")
  })

  it("hashes the integer lattice rather than sin(dot(...)), which quantises at z18", () => {
    const src = compositeFragmentSource()
    expect(src).not.toContain("43758.5453")
    expect(src).toContain("uvec2")
  })

  it("interpolates the noise coordinate homogeneously, so pitch stays correct", () => {
    expect(COMPOSITE_VERTEX_SOURCE).toContain("v_noiseH = u_noiseMatrix * vec3(p, 1.0)")
  })
})

describe("runCompositePass — the GL call sequence (criterion 1)", () => {
  const frame = (time = 0): Parameters<typeof runCompositePass>[2] => ({
    mask: { tag: "mask-texture" } as unknown as WebGLTexture,
    noise: noiseFrame(
      mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom: 14, width: 800, height: 600 }),
      800,
      600,
    ),
    time,
    palette: V1,
  })

  it("draws ONE full-screen triangle — three vertices, not a quad's six", () => {
    const f = fakeGl()
    const res = createCompositeResources(f.gl)
    runCompositePass(f.gl, res, frame())

    const draws = f.of("drawArrays")
    expect(draws).toHaveLength(1)
    expect(draws[0]!.args).toEqual([GL.TRIANGLES, 0, 3])
    expect(f.of("drawArraysInstanced")).toHaveLength(0)
  })

  it("binds the mask on unit 0 and tells the sampler so", () => {
    const f = fakeGl()
    const res = createCompositeResources(f.gl)
    const frame0 = frame()
    runCompositePass(f.gl, res, frame0)

    expect(f.of("activeTexture")[0]!.args).toEqual([GL.TEXTURE0])
    expect(f.of("bindTexture")[0]!.args[1]).toBe(frame0.mask)
    const sampler = f.of("uniform1i")[0]!
    expect(sampler.args[1]).toBe(0)
  })

  it("sets every one of the six palette uniforms from the palette it was given", () => {
    const f = fakeGl()
    const res = createCompositeResources(f.gl)
    runCompositePass(f.gl, res, frame())

    const vec3s = f.of("uniform3f").map((c) => c.args.slice(1))
    expect(vec3s).toEqual([[...V1.fogDeep], [...V1.fogEdge], [...V1.rimGlow]])

    const floats = f.of("uniform1f").map((c) => c.args[1])
    expect(floats).toContain(V1.maxOpacity)
    expect(floats).toContain(V1.noiseAmp)
    expect(floats).toContain(V1.rimAmt)
  })

  /** Criterion 4 restated for pass 2: `u_maxOpacity` is 0.94 and it reaches the GPU as 0.94. */
  it("ships u_maxOpacity = 0.94, never 1.0", () => {
    expect(V1.maxOpacity).toBe(0.94)
    expect(V1.maxOpacity).toBeLessThan(1)
    const f = fakeGl()
    runCompositePass(f.gl, createCompositeResources(f.gl), frame())
    expect(f.of("uniform1f").map((c) => c.args[1])).toContain(0.94)
  })

  it("hands the noise matrix and origin over as a mat3 and a vec2", () => {
    const f = fakeGl()
    const res = createCompositeResources(f.gl)
    const frame0 = frame()
    runCompositePass(f.gl, res, frame0)

    const mat = f.of("uniformMatrix3fv")[0]!
    expect(mat.args[1]).toBe(false) // never transposed; GLSL takes column-major
    expect(mat.args[2]).toBe(frame0.noise.matrix)
    expect(f.of("uniform2f")[0]!.args.slice(1)).toEqual(frame0.noise.origin)
  })

  it("wraps u_time, so the lattice index cannot outgrow the shader's bias", () => {
    const f = fakeGl()
    const res = createCompositeResources(f.gl)
    runCompositePass(f.gl, res, frame(TIME_WRAP_S + 5))
    expect(f.of("uniform1f").map((c) => c.args[1])).toContain(5)
  })

  it("blends premultiplied, with depth testing off", () => {
    const f = fakeGl()
    const res = createCompositeResources(f.gl)
    runCompositePass(f.gl, res, frame())

    expect(f.of("disable").map((c) => c.args[0])).toContain(GL.DEPTH_TEST)
    expect(f.of("enable").map((c) => c.args[0])).toContain(GL.BLEND)
    expect(f.of("blendEquation").at(-1)!.args).toEqual([GL.FUNC_ADD])
    expect(f.of("blendFunc").at(-1)!.args).toEqual([GL.ONE, GL.ONE_MINUS_SRC_ALPHA])
  })

  it("leaves MapLibre's base state behind, and unbinds what it bound", () => {
    const f = fakeGl()
    const res = createCompositeResources(f.gl)
    const restore = runCompositePass(f.gl, res, frame())

    expect(compositeRestoreOk(f.gl, restore)).toBe(true)
    expect(f.of("bindVertexArray").at(-1)!.args[0]).toBeNull()
    expect(f.of("bindTexture").at(-1)!.args[1]).toBeNull()
  })

  it("caches uniform locations at link time, not per frame", () => {
    const f = fakeGl()
    const res = createCompositeResources(f.gl)
    const afterLink = f.calls.length
    runCompositePass(f.gl, res, frame())
    runCompositePass(f.gl, res, frame())
    expect(f.calls.slice(afterLink).some((c) => c.name === "getUniformLocation")).toBe(false)
    expect(Object.values(res.uniforms).every((u) => u !== null)).toBe(true)
  })

  it("reports a compile failure verbatim rather than drawing nothing quietly", () => {
    const f = fakeGl()
    f.failCompile = true
    expect(() => createCompositeResources(f.gl)).toThrow(/fake compile failure/)
  })

  it("disposes both objects it owns", () => {
    const f = fakeGl()
    const res = createCompositeResources(f.gl)
    disposeCompositeResources(f.gl, res)
    expect(f.of("deleteProgram")).toHaveLength(1)
    expect(f.of("deleteVertexArray")).toHaveLength(1)
  })
})
