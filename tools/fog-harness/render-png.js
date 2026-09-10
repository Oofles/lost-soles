// Concatenated into a classic <script> alongside the compiled fog modules — see render-png.mjs.
//
// A stand-in basemap (parchment ground, a street grid, labels) with the real composite over it, so
// D-051's question — "are the street names inside revealed ground still readable" — has something
// to be asked of before it is asked of the operator.

const W = 1280
const H = 800
/** `render-png.mjs` injects `PALETTE_NAME`; V1 is what ships, the other two are §5.2's columns. */
const PALETTE = { V1, ATLAS, ADVENTURE }[typeof PALETTE_NAME === "string" ? PALETTE_NAME : "V1"]
const NEMO = { lat: -48.876, lng: -123.393 }

const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6371008.8
const mercatorX = (lng) => lng / 360 + 0.5
const mercatorY = (lat) => 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
const metresToMercator = (m, lat) => m / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180))

/**
 * Half the camera's width, in metres. `render-png.mjs` injects it; 900 m is a neighbourhood at
 * roughly z15, 100 m is a couple of streets. The edge treatment is SCALE DEPENDENT — the noise
 * displaces the boundary by a fixed number of GROUND metres, so it is worth a couple of pixels
 * zoomed out and tens of pixels zoomed in — which is why this is a parameter and not a constant.
 */
const HALF_W_M_VALUE = typeof HALF_W_M === "number" ? HALF_W_M : 900
const HALF_W = metresToMercator(HALF_W_M_VALUE, NEMO.lat)

/**
 * THE CAMERA SITS ON THE FRONTIER, NOT ON THE TERRITORY, and at every half-width. The corridor is a
 * fixed size on the ground, so a camera centred on it shows only revealed parchment once you zoom
 * in — and the boundary is the entire subject of this picture.
 */
const LOOP_R_M = 430
const EDGE_M = LOOP_R_M + REVEAL_SCALE * 75.864
const CX = mercatorX(NEMO.lng) + metresToMercator(EDGE_M - HALF_W_M_VALUE * 0.3, NEMO.lat)
const CY = mercatorY(NEMO.lat)
const NOMINAL_X = mercatorX(NEMO.lng)
const HALF_H = (HALF_W * H) / W

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

/**
 * A parchment street grid, drawn to a 2D canvas and uploaded as the "basemap" behind the fog.
 *
 * EVERY COLOUR COMES FROM `app/tokens.css`, injected by `render-png.mjs` as `TOKENS`. Not a
 * formality — the first draft of this file had five raw hex literals in it and
 * `check-design-tokens.mjs` failed the Amplify build over them, which is `0055`'s harness comment
 * warning about exactly this (*"a raw hex here fails check-design-tokens.mjs, correctly"*) coming
 * true one ticket later. Reading the real ramp is also the better picture: D-051's question is
 * whether labels stay readable against the ACTUAL parchment, not against something close to it.
 */
function basemap() {
  const bg = document.getElementById("bg")
  const ctx = bg.getContext("2d")
  ctx.fillStyle = TOKENS["parch-100"]
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = TOKENS["verdigris-300"]
  ctx.globalAlpha = 0.25
  ctx.fillRect(760, 90, 330, 210)          // a park
  ctx.fillStyle = TOKENS["cold-wash"]
  ctx.beginPath()
  ctx.ellipse(230, 620, 190, 105, 0.3, 0, Math.PI * 2)
  ctx.fill()                                // a lake
  ctx.globalAlpha = 1
  ctx.strokeStyle = TOKENS["parch-400"]
  ctx.lineWidth = 9
  for (let x = 80; x < W; x += 160) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
  for (let y = 70; y < H; y += 150) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
  ctx.fillStyle = TOKENS["ink-600"]
  ctx.font = "500 15px system-ui, sans-serif"
  for (let x = 96; x < W; x += 160) {
    for (let y = 60; y < H; y += 150) ctx.fillText("Deer Ridge Dr", x, y)
  }
  return bg
}

function main() {
  const base = basemap()
  const canvas = document.getElementById("c")
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true })

  const res = createMaskResources(gl, { prelude: STUB_PRELUDE, define: "", width: W, height: H })

  // A run: a looping corridor of cells, densified the way instances.ts densifies one, so the
  // silhouette is D-232's and not a bare chain of pearls.
  const centres = []
  for (let t = 0; t <= 1; t += 0.001) {
    const a = t * Math.PI * 2
    centres.push({
      x: NOMINAL_X + metresToMercator(LOOP_R_M * Math.cos(a) + 120 * Math.cos(3 * a), NEMO.lat),
      y: CY + metresToMercator(LOOP_R_M * 0.7 * Math.sin(a) + 90 * Math.sin(2 * a), NEMO.lat),
    })
  }
  const r = metresToMercator(REVEAL_SCALE * 75.864, NEMO.lat)
  const instances = new Float32Array(centres.length * INSTANCE_FLOATS)
  centres.forEach((c, i) => {
    instances[i * INSTANCE_FLOATS + 0] = c.x
    instances[i * INSTANCE_FLOATS + 1] = c.y
    instances[i * INSTANCE_FLOATS + 2] = r
    instances[i * INSTANCE_FLOATS + 3] = 1
  })

  uploadInstances(gl, res, instances)
  runMaskPass(gl, res, PROJECTION)

  // The basemap goes into the framebuffer first, exactly as MapLibre's own layers would have.
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, base)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const blit = { texture: tex, debugProgram: null }
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
  const vao = gl.createVertexArray()

  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, W, H)
  gl.disable(gl.BLEND)
  gl.useProgram(prog)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, blit.texture)
  gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0)
  gl.bindVertexArray(vao)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  const composite = createCompositeResources(gl)
  runCompositePass(gl, composite, {
    mask: res.texture,
    noise: noiseFrame(PROJECTION.mainMatrix, W, H),
    time: 0,
    palette: PALETTE,
  })

  document.getElementById("out").textContent = canvas.toDataURL("image/png")
}

try {
  main()
} catch (error) {
  document.getElementById("out").textContent = String((error && error.stack) || error)
}
