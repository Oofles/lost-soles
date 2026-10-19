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
// Ticket 0056 added a second half — see `compositeProbes` at the bottom. Same split, same rule:
// the composite's shader source and call sequence are `composite.test.ts`'s, and everything that
// needs a rasteriser to answer is down there.
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
    out[i * INSTANCE_FLOATS + 4] = ARC_ALWAYS
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

  /* ── T6 — the corridor silhouette, with and without bridge discs. D-232. ─ */
  //
  // THE THING A CONSTANT CANNOT FIX, and the reason bridges exist. A run reveals a chain of cells
  // one cell wide at ~121 m spacing. Discs of 102 m radius overlap, so the coverage field has no
  // gap — but the union's OUTLINE pinches at every junction, which is what reads as a string of
  // pearls. Measured here as the corridor's WIDTH along its length: bulge at each centre, waist
  // between. The interior seam (T3) can be perfect while this is not, which is exactly what
  // happened.
  {
    const SPAN = 7
    const chain = []
    for (let i = 0; i < SPAN; i++) chain.push({ x: east((i - 3) * SPACING_M), y: CY, r: RADIUS, fraction: 1 })
    const bridged = []
    for (let i = 0; i < SPAN; i++) {
      bridged.push(chain[i])
      if (i < SPAN - 1) {
        bridged.push({ x: (chain[i].x + chain[i + 1].x) / 2, y: CY, r: RADIUS, fraction: 1 })
      }
    }

    // Corridor half-width at a given mercator x, at 0056's visible boundary (coverage 0.72).
    const halfWidth = (red, mx) => {
      const { col } = maskPixel(mx, CY)
      const mid = maskPixel(mx, CY).row
      let up = 0
      while (mid + up < MASK_H && red[(mid + up) * MASK_W + col] >= byte(0.72)) up++
      return up
    }
    const profile = (discs) => {
      const { red } = draw(pack(discs))
      const at = []
      // One full period either side of centre: two cell centres and the waist between them.
      for (const mx of [east(-SPACING_M), east(-SPACING_M / 2), CX, east(SPACING_M / 2), east(SPACING_M)]) {
        at.push(halfWidth(red, mx))
      }
      const bulge = Math.max(...at)
      const waist = Math.min(...at)
      return { bulge, waist, ratio: bulge === 0 ? 0 : waist / bulge }
    }

    const plain = profile(chain)
    const dense = profile(bridged)
    record(
      "T6 bridges smooth the silhouette",
      dense.ratio >= 0.9 && dense.ratio > plain.ratio,
      `cells only: waist/bulge ${plain.waist}/${plain.bulge} = ${plain.ratio.toFixed(2)}  ->  ` +
        `with bridges ${dense.waist}/${dense.bulge} = ${dense.ratio.toFixed(2)} ` +
        `(${bridged.length} discs for ${chain.length} cells)`,
    )
    record(
      "S1 the pearls are detectable",
      plain.ratio < 0.9,
      `a bare cell chain measures ${plain.ratio.toFixed(2)} — if this ever passes 0.9 the probe has stopped measuring`,
    )
  }

  /* ── R1-R4 — the reveal seam. Ticket 0079, criteria 2, 3 and 4. ────────── */
  //
  // The streams are real: `reveal-fixture.ts` ran the shipped derivation — route → cells → zoom
  // buckets → cull, for the explored set before and after a run — and `run.mjs` inlined them. This
  // page tags them with the shipped `tagReveal` and draws them with the shipped pass, so every
  // comparison below is between two things the app would actually put on screen.
  //
  //   R1  p = 1 against the steady post-run stream     ZERO tolerance, every pixel
  //   R2  p = 0 against the steady pre-run stream      ZERO tolerance, every pixel
  //   R3  a 65-step sweep: no pixel ever falls below min(its previous value, its settled value)
  //   R4  the sabotage — p = 0.999 must NOT match, and pre must not match post, or R1/R2 are blind
  {
    const drawAt = (instances, progress) => {
      uploadInstances(gl, res, instances)
      res.revealProgress = progress
      runMaskPass(gl, res, PROJECTION)
      res.revealProgress = 1
      return readMaskRed(gl, res).red
    }
    const diff = (a, b) => {
      let n = 0
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
      return n
    }
    const lit = (red) => {
      let n = 0
      for (const v of red) if (v > 0) n++
      return n
    }
    const points = REVEAL_FIXTURE.points

    for (const c of REVEAL_FIXTURE.cases) {
      const post = Float32Array.from(c.post)
      const pre = Float32Array.from(c.pre)
      const tagged = tagReveal(post, pre, points)

      const steadyPost = drawAt(Float32Array.from(c.steadyPost), 1)
      const steadyPre = drawAt(Float32Array.from(c.steadyPre), 1)
      const at1 = drawAt(tagged, 1)
      const at0 = drawAt(tagged, 0)

      record(
        `R1 p=1 ≡ steady (${c.label})`,
        diff(at1, steadyPost) === 0 && lit(steadyPost) > 0,
        `${diff(at1, steadyPost)} of ${at1.length} pixels differ (want 0); ` +
          `${lit(steadyPost)} lit; ${post.length / INSTANCE_FLOATS} post, ` +
          `${pre.length / INSTANCE_FLOATS} pre, ${tagged.length / INSTANCE_FLOATS} tagged`,
      )
      record(
        `R2 p=0 ≡ pre-run (${c.label})`,
        diff(at0, steadyPre) === 0,
        `${diff(at0, steadyPre)} of ${at0.length} pixels differ (want 0); ${lit(steadyPre)} lit`,
      )

      let previous = at0
      let drops = 0
      let worst = 0
      for (let step = 1; step <= 64; step++) {
        const now = drawAt(tagged, step / 64)
        for (let i = 0; i < now.length; i++) {
          // Plain monotonicity since `0252` (D-304): the steady state no longer drops on its own.
          const floor = previous[i]
          if (now[i] < floor) {
            drops++
            worst = Math.max(worst, floor - now[i])
          }
        }
        previous = now
      }
      record(
        `R3 sweep monotone (${c.label})`,
        drops === 0,
        `${drops} pixel-steps fell below the previous step (want 0)` +
          (drops ? `, worst by ${worst}` : ""),
      )

      // The comparator must be able to see a difference IN THESE STREAMS, or a zero in R1/R2 means
      // nothing. `p = 0.999` is recorded too but not gated: at a coarse bucket the one fading disc
      // has legitimately arrived by then, which is the ramp working, not the probe failing.
      const nearlyDone = drawAt(tagged, 0.999)
      record(
        `R4 sabotage (${c.label})`,
        diff(steadyPre, steadyPost) > 0,
        `pre differs from post at ${diff(steadyPre, steadyPost)} pixels (must be > 0); ` +
          `p=0.999 differs from settled at ${diff(nearlyDone, steadyPost)}`,
      )
    }
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

  /* ══ 0056 — PASS 2, THE NOISY COMPOSITE ═════════════════════════════════ */
  //
  // C1  the rim lights the fog at the BOUNDARY, never revealed ground  criterion 3, 0210
  // C2  u_maxOpacity = 0.94 lets 6% of the basemap through          criterion 4
  // C3  the noise is anchored to the GROUND, not to the screen      criterion 9  (D-233)
  // C4  what the composite costs per frame                          criterion 8  (recorded)
  //
  // Every one of them has its sabotage case, for 0118's reason. C1 and C2 sabotage the uniform they
  // are measuring (rimAmt -> 0, maxOpacity -> 1.0) and must lose the signal entirely; C3 re-runs on
  // the SAME two camera positions with §4.3's original screen-space noise, which must move.
  compositeProbes(gl, res)

  /* ══ 0080 — BEAT 1'S BLOOM, IN THE MASK'S GREEN AND BLUE ════════════════ */
  //
  // B1  a gold-tagged disc at its bloom's peak writes GREEN, not BLUE        criterion 6
  // B2  a frost-tagged disc writes BLUE, not GREEN                          criterion 6
  // B3  SABOTAGE: an untagged arc, ARC_ALWAYS, and a gold tag with the clock off — no bloom at all,
  //     and RED is still the full coverage. Without this B1/B2 could pass on a shader that wrote G
  //     for everything.
  bloomProbes(gl, res)

  disposeMaskResources(gl, res)
  results.unshift({ id: "renderer", pass: true, detail: renderer })
}

/* ─── 0056's probes ───────────────────────────────────────────────────────── */

/** A mid-grey stand-in for the basemap. Not black: C2 measures what shows THROUGH the fog. */
const BG = [0.5, 0.5, 0.5]

/** The orthographic projection above, re-centred — one pan, one matrix. */
function projectionAt(cx, cy) {
  return {
    ...PROJECTION,
    mainMatrix: new Float32Array([
      1 / HALF_W, 0, 0, 0,
      0, -1 / HALF_H, 0, 0,
      0, 0, 1, 0,
      -cx / HALF_W, cy / HALF_H, 0, 1,
    ]),
  }
}

/** Mercator → the index of that pixel in a bottom-up RGBA readback of the full canvas. */
function screenIndex(cx, cy, mx, my) {
  const ndcX = (mx - cx) / HALF_W
  const ndcY = -(my - cy) / HALF_H
  const col = Math.round((ndcX * 0.5 + 0.5) * CANVAS_W)
  const rowFromBottom = Math.round((-ndcY * 0.5 + 0.5) * CANVAS_H)
  if (col < 0 || col >= CANVAS_W || rowFromBottom < 0 || rowFromBottom >= CANVAS_H) return -1
  return (rowFromBottom * CANVAS_W + col) * 4
}

function bloomProbes(gl, res) {
  const peak = { clock: REVEAL_RAMP, fade: 1, goldSpan: 0.27, frostSpan: 0.41 }
  const centre = (Math.floor(res.maskH / 2) * res.maskW + Math.floor(res.maskW / 2)) * 4
  const px = new Uint8Array(res.maskW * res.maskH * 4)
  const read = (arc, bloom) => {
    const disc = pack([{ x: CX, y: CY, r: RADIUS, fraction: 1 }])
    disc[4] = arc
    uploadInstances(gl, res, disc)
    res.revealProgress = 0.5
    res.bloom = bloom
    runMaskPass(gl, res, PROJECTION)
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo)
    gl.readPixels(0, 0, res.maskW, res.maskH, gl.RGBA, gl.UNSIGNED_BYTE, px)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    res.revealProgress = 1
    res.bloom = NO_BLOOM
    return [px[centre], px[centre + 1], px[centre + 2]]
  }
  const gold = read(ARC_GOLD_OFFSET, peak)
  const frost = read(ARC_FROST_OFFSET, peak)
  const plain = read(0, peak)
  const always = read(ARC_ALWAYS, peak)
  const off = read(ARC_GOLD_OFFSET, NO_BLOOM)
  const rgb = (c) => `(${c.join(",")})`
  record("B1 gold → GREEN only", gold[0] === 255 && gold[1] >= 250 && gold[2] === 0, `centre ${rgb(gold)} (want 255, >=250, 0)`)
  record("B2 frost → BLUE only", frost[0] === 255 && frost[1] === 0 && frost[2] >= 250, `centre ${rgb(frost)} (want 255, 0, >=250)`)
  const silent = [plain, always, off].every((c) => c[0] === 255 && c[1] === 0 && c[2] === 0)
  record("B3 sabotage: no tag / no clock", silent, `untagged ${rgb(plain)}, always ${rgb(always)}, clock off ${rgb(off)} (want 255,0,0 each)`)
}

function compositeProbes(gl, res) {
  let compositeRes
  try {
    compositeRes = createCompositeResources(gl)
  } catch (error) {
    record("C0 composite compiles", false, String((error && error.message) || error))
    return
  }
  const uniformCount = Object.keys(compositeRes.uniforms).length
  record("C0 composite compiles", true, `#define FBM_OCTAVES ${compositeRes.octaves}, ${Object.values(compositeRes.uniforms).filter(Boolean).length}/${uniformCount} uniforms live`)

  const pixels = new Uint8Array(CANVAS_W * CANVAS_H * 4)

  /**
   * One frame, end to end: pass 1 into the mask FBO, then pass 2 over a known background into the
   * default framebuffer, then read it back. `readPixels` is a full pipeline stall and that is fine
   * — nothing here is measuring a frame time except C4, which does not read back.
   */
  function frame(options) {
    const projection = options.projection || PROJECTION
    uploadInstances(gl, res, options.instances || new Float32Array(0))
    runMaskPass(gl, res, projection)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, CANVAS_W, CANVAS_H)
    gl.clearColor(BG[0], BG[1], BG[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    runCompositePass(gl, compositeRes, {
      mask: res.texture,
      noise: options.noise || noiseFrame(projection.mainMatrix, CANVAS_W, CANVAS_H),
      time: options.time || 0,
      palette: options.palette || V1,
      bloom: options.bloom || NO_BLOOM_PALETTE,
      rimBand: options.rimBand || 0,
    })
    gl.readPixels(0, 0, CANVAS_W, CANVAS_H, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return pixels.slice()
  }

  /* ── C5 — 0080: a gold bloom warms the cleared ground; with the clock off it is not there at all ─ */
  //
  // The no-bloom frame must equal an UNTAGGED frame byte for byte — that is the composite's half of
  // "the steady state is unchanged" — and the lit frame must differ at the disc, warmer than it is
  // blue. The equality is the sabotage: a composite that tinted regardless would fail it.
  {
    const disc = pack([{ x: CX, y: CY, r: RADIUS * 3, fraction: 1 }])
    const tagged = disc.slice()
    tagged[4] = ARC_GOLD_OFFSET
    const bloom = { gold: [0.91, 0.78, 0.48], frost: [0.5, 0.66, 0.79], glint: [1, 0.95, 0.82] }
    const plain = frame({ instances: disc, bloom })
    const unlit = frame({ instances: tagged, bloom })
    res.bloom = { clock: REVEAL_RAMP, fade: 1, goldSpan: 0.27, frostSpan: 0.41 }
    const lit = frame({ instances: tagged, bloom })
    res.bloom = NO_BLOOM
    let differ = 0
    for (let i = 0; i < plain.length; i++) if (plain[i] !== unlit[i]) differ++
    const at = screenIndex(CX, CY, CX, CY)
    const dR = lit[at] - plain[at]
    const dB = lit[at + 2] - plain[at + 2]
    record(
      "C5 gold bloom composites",
      differ === 0 && dR > 20 && dR > dB,
      `clock off vs untagged: ${differ} bytes differ (want 0); centre lit-plain R ${dR} B ${dB} (want R > 20, R > B)`,
    )
  }

  /* ── C1 — the rim is lit mist on the FOG side, and nothing on revealed ground. 0210. ─── */
  //
  // Measured by DIFFERENCING two renders that differ only in u_rimAmt. That isolates the rim's own
  // contribution — warming and thinning the fog — from everything else in the frame.
  //
  // `0210` replaced §4.3's glow (`reveal * (1 - reveal) * 4`, scaled by the edge's own alpha and
  // invisible at every rimAmt in range) with a ring blur of the mask. The claims are now three:
  //   - INSIDE revealed ground the difference is EXACTLY ZERO. That is the D-051 guarantee: the rim
  //     never tints, thins or veils cleared ground, so labels there read as they do with fog off.
  //   - It PEAKS on the fog side of the edge (coverage under 0.5), and is large there.
  //   - FARTHER than the band's reach from the edge, it is zero again: a band, not a wash.
  {
    // THREE TIMES THE DISC RADIUS, NOT SIX, AND THE DIFFERENCE IS THE WHOLE PROBE. At 6x the blob
    // is wider than the camera window, so no sample on screen has zero coverage — `outside` comes
    // back EMPTY, `Math.max()` of nothing is -Infinity, and `-Infinity <= 1` reports a pass. The
    // probe read green while measuring nothing at all, which is 0055's SEAM_FLOOR lesson in a
    // different costume. The population guard below is the fix; this radius is what makes it
    // satisfiable — 3 radii of blob plus the band's 1.1 still leaves room inside the window.
    const bigR = RADIUS * 3
    const blob = pack([{ x: CX, y: CY, r: bigR, fraction: 1 }])
    const projection = PROJECTION
    const band = rimBand(noiseFrame(projection.mainMatrix, CANVAS_W, CANVAS_H), metresToMercator(DISC_R_M, 0))
    const withRim = frame({ instances: blob, palette: V1, rimBand: band })
    const noRim = frame({ instances: blob, palette: { ...V1, rimAmt: 0 }, rimBand: band })
    const { red: coverage } = { red: readMaskRed(gl, res).red }

    // A radial profile east from the centre, out past the band and stopping inside the window.
    const reach = HALF_W * 0.95
    const profile = []
    for (let mercOffset = 0; mercOffset <= reach; mercOffset += HALF_W / 200) {
      const mx = CX + mercOffset
      const i = screenIndex(CX, CY, mx, CY)
      if (i < 0) continue
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs(withRim[i + c] - noRim[i + c])))
      profile.push({ mx, cover: sample(coverage, mx, CY) / 255, d })
    }

    const inside = profile.filter((p) => p.cover >= 0.95)
    // Past the edge (coverage 0 at bigR) by the band's reach plus a quarter-radius of slack.
    const far = profile.filter((p) => p.mx - CX >= bigR + (RIM_BAND_R + 0.25) * RADIUS)
    const peak = profile.reduce((best, p) => (p.d > best.d ? p : best), profile[0])
    const populated = inside.length >= 5 && far.length >= 5
    const insideMax = populated ? Math.max(...inside.map((p) => p.d)) : NaN
    const farMax = populated ? Math.max(...far.map((p) => p.d)) : NaN

    record(
      "C1 rim is lit mist at the edge",
      populated && peak.d >= 20 && insideMax === 0 && farMax <= 1 && peak.cover < 0.5,
      `peak ${peak.d}/255 at coverage ${peak.cover.toFixed(2)} (want >= 20, fog side < 0.5); ` +
        `revealed (${inside.length} samples, cover>=0.95) max ${insideMax} (want 0); ` +
        `beyond the band (${far.length} samples) max ${farMax}`,
    )

    // THE DIFFERENCING ITSELF HAS TO BE PROVED. Two identical renders must difference to nothing,
    // or C1's "0 inside" is measuring a constant rather than an absence.
    const again = frame({ instances: blob, palette: { ...V1, rimAmt: 0 }, rimBand: band })
    let selfDiff = 0
    for (const p of profile) {
      const i = screenIndex(CX, CY, p.mx, CY)
      if (i >= 0) selfDiff = Math.max(selfDiff, Math.abs(again[i] - noRim[i]))
    }
    record(
      "S1 the rim probe can read zero",
      selfDiff === 0 && peak.d > 0,
      `rimAmt=0 differenced against itself reads ${selfDiff} (want 0), against ${V1.rimAmt} reads ${peak.d}`,
    )
  }

  /* ── C2 — 0.94, not 1.0. Criterion 4. ──────────────────────────────────── */
  //
  // An empty mask, so every pixel is fully fogged, rendered over black and over white. What comes
  // through is `(1 - u_maxOpacity) x background`, so the DIFFERENCE between the two backgrounds is
  // 6% of 255 wherever the fog is at full strength — and it is exactly 0 if u_maxOpacity is 1.0.
  {
    const transmission = (maxOpacity) => {
      const palette = { ...V1, maxOpacity }
      const saved = BG.slice()
      BG[0] = BG[1] = BG[2] = 0
      const dark = frame({ palette })
      BG[0] = BG[1] = BG[2] = 1
      const light = frame({ palette })
      BG[0] = saved[0]
      BG[1] = saved[1]
      BG[2] = saved[2]
      const i = screenIndex(CX, CY, CX, CY)
      return [light[i] - dark[i], light[i + 1] - dark[i + 1], light[i + 2] - dark[i + 2]]
    }

    const real = transmission(V1.maxOpacity)
    const want = (1 - V1.maxOpacity) * 255
    record(
      "C2 6% of the basemap survives",
      real.every((v) => Math.abs(v - want) <= 2),
      `rgb ${real.join(",")} of 255 with u_maxOpacity=${V1.maxOpacity} (want ~${want.toFixed(1)})`,
    )

    const opaque = transmission(1)
    record(
      "S1 a hole in the map reads 0",
      opaque.every((v) => v === 0),
      `u_maxOpacity=1.0 transmits ${opaque.join(",")} — if this is not 0,0,0 the probe is not measuring transmission`,
    )
  }

  /* ── C3 — the noise is on the GROUND. Criterion 9, D-233. ──────────────── */
  //
  // The claim the whole ticket turns on, and the one no still image can make. An empty mask, so the
  // only thing varying across the frame is the noise field: `col = mix(fogDeep, fogEdge, ...)`
  // drives ~47 levels of the 8-bit range, which is plenty of signal.
  //
  // Two camera positions, 300 px of pan apart. Nine ground points, each read at whatever SCREEN
  // pixel it landed on in each frame. Anchored to the ground, the colour follows the point. Anchored
  // to the screen, it does not.
  {
    const panMerc = 300 * ((2 * HALF_W) / CANVAS_W)
    const before = projectionAt(CX, CY)
    const after = projectionAt(CX + panMerc, CY)

    const points = []
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        points.push({ x: CX + i * HALF_W * 0.3, y: CY + j * HALF_H * 0.3 })
      }
    }

    const compare = (noiseFor) => {
      const a = frame({ projection: before, noise: noiseFor(before) })
      const b = frame({ projection: after, noise: noiseFor(after) })
      let worst = 0
      for (const pt of points) {
        const ia = screenIndex(CX, CY, pt.x, pt.y)
        const ib = screenIndex(CX + panMerc, CY, pt.x, pt.y)
        if (ia < 0 || ib < 0) continue
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a[ia + c] - b[ib + c]))
      }
      return worst
    }

    const anchored = compare((p) => noiseFrame(p.mainMatrix, CANVAS_W, CANVAS_H))
    // §4.3's own recipe: `noiseFrame` produces exactly it when it cannot invert the matrix.
    const screenSpace = compare(() => noiseFrame(new Float32Array(16), CANVAS_W, CANVAS_H))

    record(
      "C3 noise stays on the ground",
      anchored <= 2,
      `same ground point across a 300 px pan differs by ${anchored}/255`,
    )
    record(
      "S1 screen-space noise crawls",
      screenSpace >= 6 && screenSpace > anchored,
      `§4.3's original recipe differs by ${screenSpace}/255 across the same pan ` +
        `(ground-anchored: ${anchored}) — if these ever match, C3 is measuring nothing`,
    )
  }

  /* ── C4 — what it costs. Criterion 8, RECORDED not gated. ──────────────── */
  //
  // SwiftShader is not a phone and this number is not the ticket's 2 ms budget — 0059 is the hard
  // gate, on real hardware, and D-230 parked that question there deliberately. What this measures
  // is the shape of the cost: a per-fragment shader over the full drawing buffer, with no readback
  // in the timed region.
  {
    const projection = PROJECTION
    const noise = noiseFrame(projection.mainMatrix, CANVAS_W, CANVAS_H)
    uploadInstances(gl, res, new Float32Array(0))
    runMaskPass(gl, res, projection)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, CANVAS_W, CANVAS_H)

    // 0211: the edge warp, sized as the layer sizes it: this harness's disc radius, at the equator.
    const warp = edgeWarp(noise, metresToMercator(DISC_R_M, 0))
    // 0210: the rim's ring blur, sized as the layer sizes it. The mask is EMPTY here, so no fragment
    // is fully revealed and every one of them pays for the taps: this is the rim's worst case.
    const band = rimBand(noise, metresToMercator(DISC_R_M, 0))
    const run = (n, w, rb = 0) => {
      for (let i = 0; i < n; i++) {
        runCompositePass(gl, compositeRes, { mask: res.texture, noise, time: i / 30, palette: V1, bloom: NO_BLOOM_PALETTE, warp: w, rimBand: rb })
      }
      // 0210: `gl.finish()` alone does NOT wait for the GPU process in Chromium. It returned before
      // the draws ran, so C4 read 0.70 ms whether the rim took 24 taps or 192. A one-pixel readback
      // is a true sync point; one per batch of frames costs nothing measurable.
      gl.finish()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    }
    const measure = (w, rb) => {
      run(10, w, rb) // warm the pipeline; the first draw carries the program switch
      const started = performance.now()
      const frames = 60
      run(frames, w, rb)
      return (performance.now() - started) / frames
    }
    const per = measure(undefined)
    const perWarp = measure(warp)
    const perRim = measure(warp, band)

    record(
      "C4 composite cost",
      gl.getError() === gl.NO_ERROR,
      `${per.toFixed(2)} ms/frame without the edge warp, ${perWarp.toFixed(2)} with it (freq ${warp.freq}), ` +
        `${perRim.toFixed(2)} with the warp and the rim's ${RIM_RINGS}x${RIM_TAPS_PER_RING} taps (0210, worst case), ` +
        `at ${CANVAS_W}x${CANVAS_H} on THIS software rasteriser — not the 2 ms phone budget, which is 0059's gate`,
    )
  }

  disposeCompositeResources(gl, compositeRes)
}

try {
  main()
} catch (error) {
  record("threw", false, String((error && error.stack) || error))
}

const failed = results.filter((r) => !r.pass)
const lines = results.map((r) => `${r.pass ? "  ok  " : " FAIL "} ${r.id.padEnd(28)} ${r.detail}`)
document.getElementById("out").textContent =
  `${failed.length === 0 ? "HARNESS PASS" : "HARNESS FAIL"} — 0055 mask pass + 0056 composite + 0079 reveal\n${lines.join("\n")}`
document.title = failed.length === 0 ? "PASS" : "FAIL"
