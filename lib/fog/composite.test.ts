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
import {
  FBM_OCTAVES,
  NOISE_ORIGIN_MODULUS,
  NOISE_PX,
  NOISE_PX_MAX,
  NOISE_PX_MIN,
  NOISE_PX_QUANTISED,
  REVEAL_HI,
  REVEAL_LO,
  V1,
} from "./fog-uniforms"

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
   * So: sweep, and at every step assert the matrix-and-origin path reproduces the smooth analytic
   * coordinate.
   *
   * **THE STIMULUS IS A PAN, AND SINCE `0199` IT HAS TO BE.** This test used to sweep a ZOOM, on the
   * reasoning that a zoom crosses hundreds of origin boundaries. It did, because `scale` tracked the
   * zoom continuously — which is exactly the bug `0199` fixed. D-243 quantises `scale` to powers of
   * two, so a five-level zoom now changes the origin about five times and the sweep would have been
   * asserting almost nothing. A pan at fixed zoom moves the screen centre continuously and still
   * crosses boundaries by the hundred, so the risk is exercised the same as before.
   *
   * The comment this replaces said the coordinate *"is SUPPOSED to drift under a zoom … a test that
   * forbade that would be forbidding the design"*. That was the design, it was wrong, and the test
   * below now forbids precisely what that sentence protected.
   */
  it("a PAN does not pop: the origin jumps and the matrix cancels it, every time", () => {
    let originChanges = 0
    let worstError = 0
    let previousOrigin: [number, number] | null = null

    // ~1,500 cells of ground at z16, which is hundreds of origin boundaries.
    for (let step = 0; step <= 500; step++) {
      const centreX = HOME.x + step * 4e-6
      const m = mercatorMatrix({ centreX, centreY: HOME.y, zoom: 16, ...view })
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

  /**
   * `0199` CRITERION 1 — THE MIST MUST NOT BOIL DURING A PINCH. D-243.
   *
   * The operator's report: *"On a continuous zoom, the fog definitely flickers. It looks like static
   * on a screen when zooming."* The cause was that the lattice index of a FIXED ground point moved
   * by hundreds to thousands of cells per frame, and `hashCell` is an integer bit-mix, so every one
   * of those frames drew an uncorrelated field.
   *
   * **Sweeping is the whole point.** `groundNoiseCoord`'s existing assertions compare two frames at
   * the SAME scale, so they are blind to this by construction — that blind spot is why the bug
   * survived `0056`'s validation and reached the operator's eye. This walks the zoom at a realistic
   * pinch rate and looks at every consecutive pair.
   *
   * What D-243 guarantees, and what it does not: **zero drift within a whole zoom level**, and one
   * step per level where the field legitimately re-randomises. The criterion was amended from *"at
   * most one cell per frame"* to this, because that wording is only satisfiable by a ground-anchored
   * frequency (option B/C) and the operator chose A.
   */
  it("a PINCH does not re-randomise the field: zero drift within a zoom level (0199, D-243)", () => {
    const PINCH_PER_FRAME = 0.2 // zoom levels per frame — a fast two-second z17->z10 pinch
    const ground = { x: HOME.x + 2e-5, y: HOME.y }

    const cellOf = (zoom: number): number => {
      const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom, ...view })
      return Math.floor(groundNoiseCoord(noiseFrame(m, view.width, view.height), ground.x, ground.y)[0]!)
    }

    let steps = 0
    let stepped = 0
    let worstWithinLevel = 0

    for (let zoom = 17; zoom > 10; zoom -= PINCH_PER_FRAME) {
      const drift = Math.abs(cellOf(zoom - PINCH_PER_FRAME) - cellOf(zoom))
      steps++
      // A quantisation boundary halves the scale, so the index halves too — a legitimate step.
      if (drift > 1) stepped++
      else worstWithinLevel = Math.max(worstWithinLevel, drift)
    }

    // Within a level the lattice is EXACTLY still. Not "small" — still.
    expect(worstWithinLevel).toBe(0)
    // One step per whole zoom level crossed, and no more. Seven levels, seven steps.
    expect(stepped).toBe(7)
    // Guard against the sweep silently becoming trivial.
    expect(steps).toBeGreaterThan(30)
  })

  /**
   * THE SABOTAGE HALF of the test above — `0118`'s rule that a probe which can only report success
   * proves nothing. The pre-D-243 scale is the actual shipped bug, so replaying it here is the
   * strongest possible statement of what changed.
   */
  it("and the un-quantised scale it replaced fails that same sweep (0199)", () => {
    const PINCH_PER_FRAME = 0.2
    const ground = { x: HOME.x + 2e-5, y: HOME.y }

    const legacyCellOf = (zoom: number): number => {
      const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom, ...view })
      const frame = noiseFrame(m, view.width, view.height)
      // What `noiseFrame` computed before D-243: the raw, un-quantised scale.
      return Math.floor(ground.x * (1 / (frame.mercPerPixel * NOISE_PX)))
    }

    let worst = 0
    for (let zoom = 17; zoom > 10; zoom -= PINCH_PER_FRAME) {
      worst = Math.max(worst, Math.abs(legacyCellOf(zoom - PINCH_PER_FRAME) - legacyCellOf(zoom)))
    }

    // Thousands of cells in a single frame — the ticket measured 9,152 for its first step.
    expect(worst).toBeGreaterThan(1_000)
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

  /**
   * Was `toBeCloseTo(NOISE_PX)` before `0199`. D-243 makes the answer **256, not 260**, at every
   * zoom and every DPR: MapLibre's world is `512 x 2^zoom x dpr` pixels and the quantised scale is
   * `2^n`, so their ratio is a power of two and lands on `NOISE_PX`'s nearest one. The zoom and the
   * DPR both cancel out of the algebra, which is why this loop is still the right shape.
   */
  it("a noise cell is NOISE_PX_QUANTISED px across at a WHOLE zoom level, every DPR (D-243)", () => {
    expect(NOISE_PX_QUANTISED).toBe(256)
    for (const zoom of [10, 14, 18]) {
      for (const dpr of [1, 2]) {
        const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom, ...view, dpr })
        const frame = noiseFrame(m, view.width, view.height)
        // One cell in mercator, converted to pixels by the frame's own measured scale.
        expect((1 / frame.scale) / frame.mercPerPixel).toBeCloseTo(NOISE_PX_QUANTISED, 6)
      }
    }
  })

  /**
   * `0199` CRITERION 3 — THE PRICE OF D-243, MEASURED RATHER THAN ASSUMED.
   *
   * Quantising the frequency buys a still lattice and pays for it in apparent coarseness: between
   * whole levels a cell is no longer 260 px. The ticket predicted 184-368 from the geometry; this
   * asserts what the code actually does, and pins the extremes so a future change to the rounding
   * cannot widen the band silently.
   */
  it("pays for it in coarseness, within NOISE_PX_MIN..NOISE_PX_MAX and no wider (0199, D-243)", () => {
    let min = Infinity
    let max = 0
    for (let zoom = 10; zoom <= 18; zoom += 0.05) {
      const m = mercatorMatrix({ centreX: HOME.x, centreY: HOME.y, zoom, ...view })
      const frame = noiseFrame(m, view.width, view.height)
      const px = (1 / frame.scale) / frame.mercPerPixel
      min = Math.min(min, px)
      max = Math.max(max, px)
    }

    // Inside the declared band...
    expect(min).toBeGreaterThanOrEqual(NOISE_PX_MIN - 1e-6)
    expect(max).toBeLessThanOrEqual(NOISE_PX_MAX + 1e-6)
    // ...and actually reaching it, or the band would be a claim nothing tests.
    expect(min).toBeLessThan(NOISE_PX_MIN * 1.02)
    expect(max).toBeGreaterThan(NOISE_PX_MAX * 0.98)
    // The whole band stays coarse enough not to beat against §4.3's 2-4 px parchment grain.
    expect(min).toBeGreaterThan(150)
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
