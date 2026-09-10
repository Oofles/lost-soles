const LAT = 27.9478, LNG = -82.4584
const mx = (lng) => lng / 360 + 0.5
const my = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
const m2m = (m, lat) => m / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180))
const DISC_R_M = REVEAL_SCALE * CELL_CIRCUMRADIUS_M

const canvas = document.getElementById("c")
const gl = canvas.getContext("webgl2", { antialias: false })
const lines = []
const fail = []

function pack(discs) {
  const out = new Float32Array(discs.length * 4)
  discs.forEach((d, i) => {
    out[i * 4 + 0] = mx(d.lng)
    out[i * 4 + 1] = my(d.lat)
    out[i * 4 + 2] = m2m(d.radiusM, d.lat)
    out[i * 4 + 3] = d.value
  })
  return out
}

// The same geometry lib/fog/spike-cells.ts produces, recomputed here rather than
// imported: spike-cells.ts imports h3-js, which does not resolve in a bare module.
const probeR = DISC_R_M * 20
const probeOffset = m2m(probeR / 2, LAT) * 360
const probe = pack([
  { lat: LAT, lng: LNG - probeOffset, radiusM: probeR, value: PROBE_HIGH },
  { lat: LAT, lng: LNG + probeOffset, radiusM: probeR, value: PROBE_LOW },
])
const field = pack(
  [-2, -1, 0, 1, 2].flatMap((i) =>
    [-2, -1, 0, 1, 2].map((j) => ({
      lat: LAT + j * 0.0012,
      lng: LNG + i * 0.0012,
      radiusM: DISC_R_M,
      value: DISC_COVERAGE,
    })),
  ),
)

// A 10 km window, as a mercator → clip matrix. Behaviourally what MapLibre's
// u_projection_matrix does under mercator.
const spanX = m2m(10000, LAT)
const spanY = (spanX * canvas.height) / canvas.width
const cx = mx(LNG), cy = my(LAT)
const mainMatrix = new Float32Array([
  2 / spanX, 0, 0, 0,
  0, -2 / spanY, 0, 0,
  0, 0, 1, 0,
  (-2 * cx) / spanX, (2 * cy) / spanY, 0, 1,
])
const projection = {
  mainMatrix,
  fallbackMatrix: mainMatrix,
  tileMercatorCoords: [0, 0, 1, 1],
  clippingPlane: [0, 0, 0, 0],
  projectionTransition: 0,
  clipAntimeridian: false,
}

let verdict = null
try {
  const caps = detectCapabilities(gl)
  const res = createResources(gl, {
    prelude: STUB_PRELUDE, define: "", field, probe,
    width: canvas.width, height: canvas.height,
  })

  const real = runMaskPass(gl, res, projection, { probe: true })
  const judged = judgeProbe(real.probe)

  // ── the self-test: the instrument must be able to fail ──
  const summed = judgeProbe(runMaskPass(gl, res, projection, { probe: true, blendOverride: "add" }).probe)
  const overwritten = judgeProbe(runMaskPass(gl, res, projection, { probe: true, blendOverride: "off" }).probe)

  if (judged.verdict !== "max") fail.push(`MAX probe returned ${judged.verdict}: ${judged.detail}`)
  if (summed.verdict !== "sum") fail.push(`self-test: FUNC_ADD should read as sum, read as ${summed.verdict}`)
  if (overwritten.verdict !== "overwrite") fail.push(`self-test: blend off should read as overwrite, read as ${overwritten.verdict}`)
  if (!restoreOk(real.restore)) fail.push(`state not restored: ${JSON.stringify(real.restore)}`)
  if (real.glError !== "NO_ERROR") fail.push(`gl error ${real.glError}`)

  lines.push(`expected bytes: low=${quantise(PROBE_LOW)} high=${quantise(PROBE_HIGH)} summed=${quantise(PROBE_LOW + PROBE_HIGH)}`)
  lines.push(`MAX      -> ${judged.verdict}: ${judged.detail}`)
  lines.push(`FUNC_ADD -> ${summed.verdict}: ${summed.detail}`)
  lines.push(`no blend -> ${overwritten.verdict}: ${overwritten.detail}`)
  lines.push("")
  verdict = {
    capabilities: caps, instances: field.length / 4, maskSize: `${res.maskW}×${res.maskH}`,
    probe: judged, readPath: real.probe.readPath, restore: real.restore, glError: real.glError,
    shaderError: null, userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio, frameMs: null,
  }
  lines.push(formatVerdict(verdict))
} catch (error) {
  fail.push(`threw: ${error.message}`)
}

const head = fail.length === 0 ? "HARNESS PASS" : `HARNESS FAIL (${fail.length})`
document.title = head
document.getElementById("out").textContent = [head, ...fail.map((f) => `  ✗ ${f}`), "", ...lines].join("\n")
