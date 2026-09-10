// Ticket 0118 — the half the stub prelude cannot prove: a real maplibre-gl Map, a real
// custom layer, and MapLibre's OWN `shaderData.vertexShaderPrelude` compiling against
// this spike's attributes inside the real `prerender` hook.
//
// Bundled by run-maplibre.mjs, which is why this one CAN import.
import * as maplibre from "maplibre-gl"

import {
  createResources, detectCapabilities, judgeProbe, restoreOk, runBlitPass, runMaskPass,
} from "../../lib/fog/spike-mask.ts"
import { spikeField, spikeProbe, SPIKE_CENTRE } from "../../lib/fog/spike-cells.ts"

const fail = []
const log = []
let probed = null
let blitted = 0
let preludeSeen = null

class SpikeLayer {
  id = "fog-spike"
  type = "custom"
  renderingMode = "2d"
  #res = null
  #want = true

  onAdd(_map, gl) {
    log.push(`onAdd: ${detectCapabilities(gl).r8Framebuffer}`)
  }

  prerender(gl, options) {
    const { vertexShaderPrelude, define, variantName } = options.shaderData
    if (!this.#res) {
      // Recorded so the output PROVES the real prelude was used and not a stub.
      preludeSeen = { variantName, bytes: vertexShaderPrelude.length, define }
      try {
        this.#res = createResources(gl, {
          prelude: vertexShaderPrelude, define,
          field: spikeField(), probe: spikeProbe(),
          width: gl.drawingBufferWidth, height: gl.drawingBufferHeight,
        })
      } catch (error) {
        fail.push(`createResources threw with MapLibre's real prelude: ${error.message}`)
        this.#res = "failed"
        return
      }
    }
    if (this.#res === "failed") return

    const result = runMaskPass(gl, this.#res, options.defaultProjectionData, { probe: this.#want })
    if (this.#want) {
      this.#want = false
      probed = { judged: result.probe ? judgeProbe(result.probe) : null, ...result }
    }
  }

  render(gl) {
    if (!this.#res || this.#res === "failed") return
    runBlitPass(gl, this.#res)
    blitted += 1
  }
}

// A style with no sources: the basemap is irrelevant to whether prerender fires, and a
// headless run has no business fetching a 1.1 GB pmtiles archive over CloudFront.
const map = new maplibre.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#f5edd9" } }] },
  center: [SPIKE_CENTRE.lng, SPIKE_CENTRE.lat],
  zoom: 14,
  attributionControl: false,
})

map.on("load", () => map.addLayer(new SpikeLayer()))

// The layer is installed, removed and reinstalled, because criterion 4 is about state
// the SECOND install inherits — and onRemove freeing GPU resources while the context
// lives on is where a custom layer is most likely to take the context down with it.
map.once("idle", () => {
  setTimeout(() => {
    try {
      map.removeLayer("fog-spike")
      map.triggerRepaint()
      map.addLayer(new SpikeLayer())
      map.triggerRepaint()
    } catch (error) {
      fail.push(`remove + re-add threw: ${error.message}`)
    }
    setTimeout(report, 1500)
  }, 1500)
})

function report() {
  if (!probed) fail.push("prerender never ran, or the probe never completed")
  else {
    if (probed.judged?.verdict !== "max") fail.push(`probe: ${probed.judged?.verdict} — ${probed.judged?.detail}`)
    if (!restoreOk(probed.restore)) fail.push(`state not restored: ${JSON.stringify(probed.restore)}`)
    if (probed.glError !== "NO_ERROR") fail.push(`gl error: ${probed.glError}`)
  }
  if (blitted === 0) fail.push("render never ran — the mask was never blitted")
  if (!preludeSeen) fail.push("MapLibre's shaderData never reached prerender")

  const head = fail.length === 0 ? "MAPLIBRE HARNESS PASS" : `MAPLIBRE HARNESS FAIL (${fail.length})`
  document.title = head
  document.getElementById("out").textContent = [
    head,
    ...fail.map((f) => `  ✗ ${f}`),
    "",
    `maplibre       ${maplibre.getVersion()}`,
    `prelude        variant=${preludeSeen?.variantName} ${preludeSeen?.bytes} bytes, define=${JSON.stringify(preludeSeen?.define)}`,
    `probe          ${probed?.judged?.verdict} — ${probed?.judged?.detail}`,
    `readback       ${probed?.probe?.readPath}`,
    `restored       ${JSON.stringify(probed?.restore)}`,
    `gl.getError    ${probed?.glError}`,
    `blit frames    ${blitted}`,
    ...log,
  ].join("\n")
}
