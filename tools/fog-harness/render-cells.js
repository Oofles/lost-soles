// Ticket 0194 — the res-10 / res-11 decision as two pictures of the SAME ground.
//
// Concatenated into a classic <script> alongside the compiled fog modules; see render-cells.mjs.
// `CELLS` is injected by the runner: real cells, re-derived from the operator's own archived
// traces by `res-compare.ts`, at one resolution per panel.
//
// The basemap is parchment and THE RUN ITSELF, and deliberately nothing else. A stand-in street
// grid is right for `0056`'s question (are labels legible under mist) and wrong for this one: the
// operator's complaint is that the corridor zig-zags relative to the LINE THEY RAN, so the line
// they ran is the only reference that can settle it. A synthetic grid at an invented angle would
// answer a question nobody asked.

const PW = 900          // one panel
const PH = 900
const GUTTER = 16
const LABEL_H = 54

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6371008.8
const mercatorX = (lng) => lng / 360 + 0.5
const mercatorY = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
const metresToMercator = (m, lat) => m / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180))

const CENTRE = { lat: CENTRE_LAT, lng: CENTRE_LNG }
const HALF_W = metresToMercator(HALF_W_M, CENTRE.lat)
const HALF_H = HALF_W * (PH / PW)
const CX = mercatorX(CENTRE.lng)
const CY = mercatorY(CENTRE.lat)

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

/** Mercator -> panel pixels, the same transform the projection matrix applies. */
const toPx = (lng, lat) => [
  ((mercatorX(lng) - CX) / HALF_W) * 0.5 * PW + PW / 2,
  ((mercatorY(lat) - CY) / HALF_H) * 0.5 * PH + PH / 2,
]

/** Parchment, then the run polyline exactly as `0057` ships it: verdigris, above the ground. */
function basemap(paths) {
  const bg = document.getElementById("bg")
  const ctx = bg.getContext("2d")
  ctx.clearRect(0, 0, PW, PH)
  ctx.fillStyle = TOKENS["parch-100"]
  ctx.fillRect(0, 0, PW, PH)

  ctx.strokeStyle = TOKENS["verdigris-300"]
  ctx.lineWidth = 3
  ctx.lineJoin = "round"
  ctx.lineCap = "round"
  for (const segs of paths) {
    for (const seg of segs) {
      ctx.beginPath()
      seg.forEach(([lng, lat], i) => {
        const [x, y] = toPx(lng, lat)
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }
  }
  return bg
}

function panel(gl, data) {
  const base = basemap(data.paths)
  const res = createMaskResources(gl, { prelude: STUB_PRELUDE, define: "", width: PW, height: PH })

  // One instance per REAL revealed cell, at the render disc radius for THIS resolution —
  // revealScale x circumradius, which is the whole variable under test.
  const r = metresToMercator(data.discRadiusM, CENTRE.lat)
  const instances = new Float32Array(data.cells.length * INSTANCE_FLOATS)
  data.cells.forEach(([lng, lat], i) => {
    instances[i * INSTANCE_FLOATS + 0] = mercatorX(lng)
    instances[i * INSTANCE_FLOATS + 1] = mercatorY(lat)
    instances[i * INSTANCE_FLOATS + 2] = r
    instances[i * INSTANCE_FLOATS + 3] = 1
  })
  uploadInstances(gl, res, instances)
  runMaskPass(gl, res, PROJECTION)

  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, base)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const vs = `#version 300 es
out vec2 v_uv;
void main() {
    vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
    v_uv = (p + 1.0) * 0.5;
    gl_Position = vec4(p, 0.0, 1.0);
}`
  const fs = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
in vec2 v_uv;
out vec4 fragColor;
void main() { fragColor = vec4(texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y)).rgb, 1.0); }`
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s }
  const prog = gl.createProgram()
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs))
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(prog)

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, PW, PH)
  gl.disable(gl.BLEND)
  gl.useProgram(prog)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0)
  gl.bindVertexArray(gl.createVertexArray())
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  const composite = createCompositeResources(gl)
  runCompositePass(gl, composite, {
    mask: res.texture,
    noise: noiseFrame(PROJECTION.mainMatrix, PW, PH),
    time: 0,
    palette: V1,
  })
}

function main() {
  const gl = document.getElementById("c").getContext("webgl2", { antialias: false, preserveDrawingBuffer: true })
  const out = document.getElementById("sheet")
  const octx = out.getContext("2d")
  octx.fillStyle = TOKENS["parch-100"]
  octx.fillRect(0, 0, out.width, out.height)

  PANELS.forEach((data, i) => {
    panel(gl, data)
    const x = i * (PW + GUTTER)
    octx.drawImage(document.getElementById("c"), x, LABEL_H)
    octx.fillStyle = TOKENS["ink-600"]
    octx.font = "600 26px system-ui, sans-serif"
    octx.fillText(
      `res ${data.res}  ·  ${data.cells.length} cells  ·  ${Math.round(data.discRadiusM)} m brush  ·  ` +
      `~${Math.round(2 * (65 + data.discRadiusM))} m corridor`,
      x + 4, 36,
    )
  })
  octx.fillStyle = TOKENS["ink-600"]
  octx.font = "400 20px system-ui, sans-serif"
  octx.fillText(
    `${Math.round(HALF_W_M * 2)} m across  ·  the green line is the run  ·  real cells re-derived from the archive`,
    4, LABEL_H + PH + 28,
  )
  document.getElementById("out").textContent = out.toDataURL("image/png")
}

try {
  main()
} catch (error) {
  document.getElementById("out").textContent = String((error && error.stack) || error)
}
