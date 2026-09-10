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

/** Either debug view shows the HUD. `0055`'s cell-count readout is useful under both. */
export function hudEnabled(search: string): boolean {
  return maskDebugEnabled(search) || noiseDebugEnabled(search)
}
