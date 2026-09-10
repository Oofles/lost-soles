// Concatenated into a classic <script> alongside the compiled mask module, sharing one top-level
// scope — so REVEAL_SCALE, createMaskResources and the rest are free identifiers here by design.
// run.mjs explains why this cannot be an ES module.
//
// Ticket 0055 — the half of the verification a fake GL context cannot do.
//
// `lib/fog/mask.test.ts` proves the CALLS: gl.MAX is set, state is restored, there is one instanced
// draw whatever the cell count. It cannot prove a pixel. Everything below is a claim about
// rasterisation, and 0118's lesson is that those go where a driver can contradict them:
//
//   T1  a_fraction MULTIPLIES coverage — criterion 8's "renders as partial, not solid"
//   T2  overlapping discs UNION rather than sum or overwrite — §4.1's MAX semantics
//   T3  neighbours at REVEAL_SCALE merge with NO SCALLOPING — §4.1's whole argument
//   T4  GL state is restored, read back from the driver — criterion 4
//   S1  the same probes, sabotaged, to prove they can fail
//
// S1 IS NOT OPTIONAL. A probe that can only report success is a decoration — the same argument
// every scripts/check-*.mjs --self-test in this repo makes, and the reason 0118's verdict was
// trustworthy. T2's pixel is re-measured under a forced FUNC_ADD and with blending disabled; if
// those do not produce the two OTHER numbers, the probe is measuring nothing.

const MASK_W_SCALE = 0.5

/**
 * POINT NEMO. D-199 and 08-security-privacy.md §7.2: this repository is public. The latitude also
 * does real work — the cos(lat) correction below is invisible at the equator and a third of the
 * answer at -49°.
 */
const NEMO = { lat: -48.876, lng: -123.393 }

// The same arithmetic as lib/fog/instances.ts, restated because that module imports h3-js and this
// page loads mask.ts ALONE. instances.test.ts is what guards the shipped copy; this one only has to
// place discs on a screen.
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6371008.8
const mercatorX = (lng) => lng / 360 + 0.5
const mercatorY = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
const metresToMercator = (m, lat) => m / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180))

/** §2.1: at res 10 the edge length IS the circumradius. §4.1: the disc is 1.35x it. */
const CIRCUMRADIUS_M = 75.864
const SPACING_M = 131.4
const DISC_R_M = REVEAL_SCALE * CIRCUMRADIUS_M

const CANVAS_W = 1280
const CANVAS_H = 800
const MASK_W = Math.floor(CANVAS_W * MASK_W_SCALE)
const MASK_H = Math.floor(CANVAS_H * MASK_W_SCALE)

/**
 * The mercator half-window the camera shows. Chosen so a res-10 disc is ~62 px across in the mask:
 * large enough that a soft falloff has room to be a ramp rather than three pixels, small enough that
 * two neighbours fit side by side with their seam in the middle of the frame.
 *
 * `halfH` is `halfW * MASK_H / MASK_W` because mercator is conformal — equal scale in x and y — so
 * an unequal window would stretch the discs into ellipses and make the scalloping measurement
 * depend on which direction the neighbour lay in.
 */
const HALF_W = 2e-5
const HALF_H = (HALF_W * MASK_H) / MASK_W
const CX = mercatorX(NEMO.lng)
const CY = mercatorY(NEMO.lat)

/**
 * An orthographic projection standing in for MapLibre's, column-major as `uniformMatrix4fv` wants.
 * Maps [CX-HALF_W, CX+HALF_W] x [CY-HALF_H, CY+HALF_H] to clip space, y flipped because mercator y
 * grows downward and clip y grows up. STUB_PRELUDE's projectTile is `u_projection_matrix * vec4`,
 * behaviourally identical to MapLibre 6.6.0's mercator prelude.
 */
const PROJECTION = {
  mainMatrix: new Float32Array([
    1 / HALF_W, 0, 0, 0,
    0, -1 / HALF_H, 0, 0,
    0, 0, 1, 0,
    -CX / HALF_W, CY / HALF_H, 0, 1,
  ]),
  tileMercatorCoords: [0, 0, 1, 1],
  clippingPlane: [0, 0, 0, 0],
  projectionTransition: 0,
  fallbackMatrix: new Float32Array(16),
  clipAntimeridian: false,
}

/** Mercator → the mask pixel that covers it. readPixels is bottom-up, which the y term encodes. */
function maskPixel(mx, my) {
  const ndcX = (mx - CX) / HALF_W
  const ndcY = -(my - CY) / HALF_H
  return {
    col: Math.round((ndcX * 0.5 + 0.5) * MASK_W),
    row: Math.round((ndcY * 0.5 + 0.5) * MASK_H),
  }
}

const sample = (red, mx, my) => {
  const { col, row } = maskPixel(mx, my)
  return red[row * MASK_W + col]
}

/** Discs → the packed instance array, criterion 5's layout. */
function pack(discs) {
  const out = new Float32Array(discs.length * INSTANCE_FLOATS)
  discs.forEach((d, i) => {
    out[i * INSTANCE_FLOATS + 0] = d.x
    out[i * INSTANCE_FLOATS + 1] = d.y
    out[i * INSTANCE_FLOATS + 2] = d.r
    out[i * INSTANCE_FLOATS + 3] = d.fraction
  })
  return out
}

/** Metres east/north of Point Nemo, in mercator units. */
const east = (m) => CX + metresToMercator(m, NEMO.lat)
const RADIUS = metresToMercator(DISC_R_M, NEMO.lat)

const results = []
const record = (id, pass, detail) => results.push({ id, pass, detail })
const byte = (coverage) => Math.round(coverage * 255)

function main() {
  const canvas = document.getElementById("c")
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true })
  if (!gl) {
    record("webgl2", false, "no WebGL2 context at all")
    return
  }

  const debug = gl.getExtension("WEBGL_debug_renderer_info")
  const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "(masked)"

  const res = createMaskResources(gl, {
    prelude: STUB_PRELUDE,
    define: "",
    width: CANVAS_W,
    height: CANVAS_H,
  })
  record(
    "fbo",
    res.maskW === MASK_W && res.maskH === MASK_H,
    `R8 mask ${res.maskW}x${res.maskH} at ${MASK_W_SCALE}x of ${CANVAS_W}x${CANVAS_H}`,
  )

  const draw = (instances, options) => {
    uploadInstances(gl, res, instances)
    const restore = runMaskPass(gl, res, PROJECTION, options || {})
    return { red: readMaskRed(gl, res).red, restore }
  }

  /* ── T1 — a_fraction multiplies coverage. Criterion 8. ─────────────────── */
  //
  // Two discs far enough apart that neither touches the other, at full and quarter coverage. §6.1:
  // "a parent cell you've run 20% of is a dim glow, not a solid block. Without this, zooming out
  // turns a sparse city into a solid slab."
  {
    const solidX = east(-400)
    const partialX = east(400)
    const bigR = RADIUS * 3
    const { red } = draw(
      pack([
        { x: solidX, y: CY, r: bigR, fraction: 1 },
        { x: partialX, y: CY, r: bigR, fraction: 0.25 },
      ]),
    )
    const solid = sample(red, solidX, CY)
    const partial = sample(red, partialX, CY)
    record(
      "T1 a_fraction",
      solid >= 250 && Math.abs(partial - byte(0.25)) <= 4,
      `solid=${solid} (want 255) partial=${partial} (want ${byte(0.25)})`,
    )
  }

  /* ── T2 — MAX unions. §4.1. ────────────────────────────────────────────── */
  //
  // ONE PIXEL, THREE ANSWERS, AND THAT IS THE DESIGN OF THIS PROBE. Disc A (0.60) is drawn first;
  // disc B (0.30) is drawn second, centred half a radius away so it covers A's centre. At A's
  // centre the shader's own falloff gives A 0.600 and B 0.293, so:
  //
  //     MAX honoured        max(0.600, 0.293) = 0.600  -> 153
  //     additive blend      0.600 + 0.293     = 0.893  -> 228
  //     blend ignored       B overwrote A     = 0.293  ->  75
  //
  // 0118 needed a pixel-COUNT argument to separate those, because its discs were flat and two of
  // the three produced identical bytes. With a soft falloff and unequal coverage they separate by
  // value at a pixel whose location is known in advance, which is cheaper and reads plainly. S1
  // below produces the other two numbers deliberately, so this is a measurement rather than a hope.
  const bigR = RADIUS * 3
  const overlapPair = pack([
    { x: CX, y: CY, r: bigR, fraction: 0.6 },
    { x: CX + bigR * 0.5, y: CY, r: bigR, fraction: 0.3 },
  ])
  {
    const { red } = draw(overlapPair)
    const at = sample(red, CX, CY)
    record(
      "T2 MAX union",
      Math.abs(at - 153) <= 4,
      `overlap reads ${at} — max=153, summed=228, overwritten=75`,
    )
  }

  /* ── T3 — no scalloping. §4.1, and the operator check for this ticket. ─── */
  //
  // Two adjacent res-10 cells at their real 131.4 m spacing, full coverage. The seam is the pixel
  // exactly between them, and "scalloping" is that pixel being visibly darker than the discs it
  // sits between. §4.1 promises 1.35 removes it; the sabotage below at 1.15 is what shows the
  // constant is doing the work rather than the claim being unfalsifiable.
  {
    const leftX = east(-SPACING_M / 2)
    const rightX = east(SPACING_M / 2)
    const seamOf = (radius) => {
      const { red } = draw(
        pack([
          { x: leftX, y: CY, r: radius, fraction: 1 },
          { x: rightX, y: CY, r: radius, fraction: 1 },
        ]),
      )
      return { seam: sample(red, CX, CY), peak: sample(red, leftX, CY) }
    }
    const at135 = seamOf(RADIUS)
    const at115 = seamOf(metresToMercator(1.15 * CIRCUMRADIUS_M, NEMO.lat))
    // THE THRESHOLD COMES FROM 0056, NOT FROM ME. `SEAM_FLOOR` is derived in mask.ts from §4.3's
    // own constants: the composite thresholds at smoothstep(0.30, 0.72, coverage + noise) with the
    // noise swinging +-0.15, so a seam below 0.87 pulses in and out of the mist as the animation
    // drifts. The previous assertion here was `seam >= 179/255` — a number I picked to sit clearly
    // above the sabotage case, related to nothing — and it PASSED the 0.72 seam that the operator
    // then reported as broken on sight. A threshold calibrated to what the code already does cannot
    // fail; this one can, and did.
    const floor = Math.round(SEAM_FLOOR * 255)
    record(
      "T3 no scalloping",
      at135.seam >= floor && at135.peak >= 250,
      `seam=${at135.seam} of peak=${at135.peak} = ${(at135.seam / at135.peak).toFixed(3)} at ` +
        `revealScale ${REVEAL_SCALE}, falloff ${FALLOFF_INNER} (floor ${floor} = SEAM_FLOOR ${SEAM_FLOOR}, from 0056's threshold)`,
    )
    record(
      "S1 scalloping is detectable",
      at115.seam < floor,
      `seam=${at115.seam} at revealScale 1.15 — R4's stated lower bound, where §4.1 says the notch appears`,
    )
  }

  /* ── T4 — GL state is restored. Criterion 4, read back from the driver. ── */
  {
    gl.viewport(0, 0, CANVAS_W, CANVAS_H)
    const { restore } = draw(overlapPair)
    record(
      "T4 state restored",
      restoreOk(restore),
      `blendEquation=${restore.blendEquationRGB}/${restore.blendEquationAlpha} ` +
        `fbo=${restore.framebufferUnbound ? "null" : "BOUND"} viewport=${restore.viewportRestored ? "ok" : "CHANGED"}`,
    )
  }

  /* ── S1 — the sabotage. The probe must be able to fail. ────────────────── */
  {
    const summed = sample(draw(overlapPair, { blendOverride: "add" }).red, CX, CY)
    const overwritten = sample(draw(overlapPair, { blendOverride: "off" }).red, CX, CY)
    record(
      "S1 probe reports a sum",
      Math.abs(summed - 228) <= 5,
      `forced FUNC_ADD reads ${summed} (want 228, not 153)`,
    )
    record(
      "S1 probe reports an overwrite",
      Math.abs(overwritten - 75) <= 5,
      `blending disabled reads ${overwritten} (want 75, not 153)`,
    )
  }

  /* ── One instanced draw, whatever the count. Criterion 3, on a real GPU. ─ */
  {
    const many = []
    for (let i = 0; i < 5000; i++) {
      many.push({
        x: east(((i % 100) - 50) * SPACING_M),
        y: CY + metresToMercator((Math.floor(i / 100) - 25) * SPACING_M, NEMO.lat),
        r: RADIUS,
        fraction: 1,
      })
    }
    const before = performance.now()
    const { red } = draw(pack(many))
    const ms = performance.now() - before
    let lit = 0
    for (const v of red) if (v > 0) lit++
    record(
      "T5 5000 instances in one call",
      gl.getError() === gl.NO_ERROR && lit > 0,
      `${lit} lit mask pixels, ${ms.toFixed(1)} ms including a full readPixels stall`,
    )
  }

  disposeMaskResources(gl, res)
  results.unshift({ id: "renderer", pass: true, detail: renderer })
}

try {
  main()
} catch (error) {
  record("threw", false, String((error && error.stack) || error))
}

const failed = results.filter((r) => !r.pass)
const lines = results.map((r) => `${r.pass ? "  ok  " : " FAIL "} ${r.id.padEnd(28)} ${r.detail}`)
document.getElementById("out").textContent =
  `${failed.length === 0 ? "HARNESS PASS" : "HARNESS FAIL"} — 0055 mask pass\n${lines.join("\n")}`
document.title = failed.length === 0 ? "0055 PASS" : "0055 FAIL"
