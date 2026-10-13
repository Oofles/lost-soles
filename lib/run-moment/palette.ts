import type { BloomPalette } from "@/lib/fog/composite"
import type { Rgb } from "@/lib/fog/fog-uniforms"

/**
 * BEAT 1'S COLOURS, FROM `app/tokens.css`. Ticket `0080`.
 *
 * A shader uniform and a MapLibre paint value cannot be CSS variables, so the tokens are resolved
 * once per sequence — never per frame — through a reader, so the browser and a test share the path.
 * Same argument as `routePaletteFrom` in `lib/map-layers.ts`: a literal here would be a second copy
 * of a palette colour that capability 15's art-direction pass could not see.
 */

export const GOLD_TOKEN = "--gold-300"
export const FROST_TOKEN = "--frost-400"
export const GLINT_TOKEN = "--route-core"

/** `#rgb` or `#rrggbb` to linear-ish `0..1` channels, as the fog palette writes them. */
export function hexToRgb(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "")
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  const n = parseInt(full, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** The same colour at zero alpha — the ink's `clear`, so its edge fades its own hue, not black. */
export function clearOf(value: string): string {
  const rgb = hexToRgb(value)
  if (!rgb) return "rgba(0, 0, 0, 0)"
  return `rgba(${rgb.map((c) => Math.round(c * 255)).join(", ")}, 0)`
}

/**
 * `null` when any token is missing — and then beat 1 plays with no bloom at all. A missing bloom is
 * the smaller lie (the ticket's own rule for a missing classification); a black one would be wrong.
 */
export function bloomPaletteFrom(read: (token: string) => string): BloomPalette | null {
  const gold = hexToRgb(read(GOLD_TOKEN))
  const frost = hexToRgb(read(FROST_TOKEN))
  const glint = hexToRgb(read(GLINT_TOKEN))
  return gold && frost && glint ? { gold, frost, glint } : null
}

export function documentBloomPalette(): BloomPalette | null {
  const computed = getComputedStyle(document.documentElement)
  return bloomPaletteFrom((token) => computed.getPropertyValue(token))
}
