/**
 * THE `?fog=` DEBUG FLAGS, IN ONE PLACE. Tickets `0054` and `0055`.
 *
 * `0054` claimed `?fog=debug` for the decode readout. `0055` then claimed `?fog=mask` for the
 * greyscale mask blit — **on the same parameter**, so setting one silently turned the other off.
 *
 * That is not a tidiness complaint. The readout `0054` built prints `cells 0`, which is the exact
 * and complete answer to "why is the mask empty" — and `?fog=mask` was the one URL that hid it.
 * The first time the mask rendered nothing, the instrument that would have explained it in five
 * seconds had been switched off by the flag used to look. Costing an hour of AWS spelunking is what
 * a parameter collision looks like in practice.
 *
 * So the value is a comma-separated SET, and the flags compose:
 *
 *   ?fog=debug        the decode readout        (0054, unchanged)
 *   ?fog=mask         the greyscale mask + HUD  (0055)
 *   ?fog=noise        the composite + the HUD   (0056)
 *   ?fog=mask,debug   any combination
 */
export function fogFlags(search: string): ReadonlySet<string> {
  const raw = new URLSearchParams(search).get("fog")
  if (!raw) return new Set()
  return new Set(
    raw
      .split(",")
      .map((flag) => flag.trim().toLowerCase())
      .filter(Boolean),
  )
}

/** Criterion 10's flag. `?fog=mask`, alone or alongside `debug`. */
export function maskDebugEnabled(search: string): boolean {
  return fogFlags(search).has("mask")
}

/** `0054`'s decode readout. */
export function decodeDebugEnabled(search: string): boolean {
  return fogFlags(search).has("debug")
}

/**
 * `0056`. The HUD over the REAL fog, rather than over the raw mask.
 *
 * `?fog=mask` answers "is the coverage right" by replacing the fog with the mask. It cannot answer
 * "is the noise anchored to the ground" (D-233), because that is a property of the pass it turns
 * off — and a ground-anchoring failure looks exactly like a working fog until you pan. This flag
 * leaves the composite alone and puts its numbers on screen: the mercator scale, the lattice
 * origin, and whether the frame fell back to screen space.
 */
export function noiseDebugEnabled(search: string): boolean {
  return fogFlags(search).has("noise")
}

/**
 * `0057`, criterion 7 — `?fog=off`. The fog layer is never added, so the basemap and the route
 * render with nothing over them.
 *
 * A FLAG RATHER THAN A `visibility` TOGGLE, because a `CustomLayerInterface` has no layout
 * properties: `setLayoutProperty(id, "visibility", "none")` on one is not a thing MapLibre
 * supports, so "toggle the fog off" has to mean "do not add it". That also makes the check
 * meaningful — it proves the basemap and the route are correct in the fog's ABSENCE rather than
 * merely with a transparent pass still running over them.
 *
 * It belongs with the other three because it shares their parameter, which is the collision this
 * file was created to stop happening a second time: `?fog=off,debug` is a sensible thing to type
 * and must not silently mean one of the two.
 */
export function fogDisabled(search: string): boolean {
  return fogFlags(search).has("off")
}

/** Either debug view shows the HUD. `0055`'s cell-count readout is useful under both. */
export function hudEnabled(search: string): boolean {
  return maskDebugEnabled(search) || noiseDebugEnabled(search)
}

/**
 * `0059`, §6.4 — THE PERF HARNESS, AND ITS DATASET.
 *
 *   ?fog=perf           the harness over whatever the account actually holds
 *   ?fog=perf:150k      the harness over the checked-in 150k synthetic fixture
 *   ?fog=perf:here      the 150k disc regenerated around the CURRENT camera
 *
 * A VALUE ON THE FLAG rather than a second query parameter, because the collision this file exists
 * to prevent is two flags on one parameter — and `?fog=perf&dataset=150k` would be two parameters on
 * one flag, which is the same mistake wearing a hat. `fogFlags` splits on comma, so the colon is free.
 *
 * ─── `here` IS NOT A CONVENIENCE, IT IS THE ONLY HONEST FRAME TIME ──────────
 *
 * The checked-in fixtures sit at 30°N 100°E (see `perf/synthetic.ts`), which is a synthetic
 * coordinate and, more to the point, **nowhere the basemap extract covers**. Fog drawn over an empty
 * background is a frame that leaves out most of a frame: no tiles fetched, no vector geometry
 * tessellated, no labels laid out, no symbol collision — MapLibre's own work, which §6.3 explicitly
 * budgets the rest of the 16.7 ms for. A p95 measured there would be a p95 for a renderer nobody
 * ships.
 *
 * `here` regenerates the same disc, the same size, around wherever the camera already is, so the
 * fog lands over real tiles. It commits no coordinate — the centre comes from the operator's own
 * camera at the moment they open the page — which is the other reason it is the mode the phone runs.
 *
 * So the two modes answer two different questions and the summary table names which one produced it:
 * the fixture answers *is `visibleInstanceCount` bounded and is the heap small*, neither of which the
 * basemap can affect; `here` answers *does it hold 60 fps over real ground*, which is the only
 * question the operator can feel.
 */
export function perfDataset(search: string): string | null {
  for (const flag of fogFlags(search)) {
    if (flag === "perf") return "150k"
    if (flag.startsWith("perf:")) return flag.slice("perf:".length) || "150k"
  }
  return null
}

/** Is the harness on at all? */
export function perfEnabled(search: string): boolean {
  return perfDataset(search) !== null
}
