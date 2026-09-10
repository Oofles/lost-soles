import { cellToLatLng, gridDisk, latLngToCell } from "h3-js"

import {
  CELL_CIRCUMRADIUS_M,
  DISC_COVERAGE,
  EARTH_CIRCUMFERENCE_M,
  INSTANCE_FLOATS,
  PROBE_HIGH,
  PROBE_LOW,
  REVEAL_SCALE,
} from "./spike-mask"

/**
 * THROWAWAY. Ticket `0118` — the hard-coded cell array the spike draws, and the web
 * mercator arithmetic to get it into the shader. Deleted at the ticket's close; `0055`
 * replaces all of it with `0054`'s real decoder.
 *
 * Separate from `spike-mask.ts` so that file can stay import-free and run headless.
 */

/**
 * DOWNTOWN TAMPA, AND NOT WHERE THE OPERATOR RUNS.
 *
 * `08-security-privacy.md` §7.2 and D-199: this repository is public, and a committed
 * coordinate near the operator's home is the leak the fixture-geography guard in
 * `scripts/` exists to prevent. That guard only walks `__fixtures__` directories, so it
 * would not have caught a literal here — which is the argument for choosing the
 * coordinate carefully rather than for relying on the guard.
 *
 * (Its filename is deliberately not written out. `src/adapters/strava/adapter.test.ts`'s
 * D-121 guard flags any shipped file whose TEXT contains that name, with no carve-out for
 * comments — unlike `check-design-tokens.mjs`, which has one. Ticket `0189` records it.)
 *
 * Point Nemo, which the fixture check mandates, is the wrong answer for THIS ticket:
 * criterion 4 is "MapLibre's own basemap renders unchanged", and in the middle of the
 * Pacific there is no basemap to compare — no roads, no labels, nothing to be wrong.
 * A dense public street grid inside the Florida extract is what makes that criterion
 * checkable, and a downtown 250 km from Nocatee says nothing about anybody.
 */
export const SPIKE_CENTRE = { lat: 27.9478, lng: -82.4584 }

/** `3k² + 3k + 1` at k = 12 is 469 — the ticket's "~500 cell centres". */
export const SPIKE_RING_K = 12

/* ─── Web mercator 0..1, the space MapLibre's `projectTile` takes ────────────── */

export function mercatorX(lng: number): number {
  return lng / 360 + 0.5
}

export function mercatorY(lat: number): number {
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
}

/**
 * Metres on the ground → mercator units at a given latitude.
 *
 * The `cos(lat)` is the whole content: mercator units are constant across the world
 * but the ground they cover shrinks toward the poles, so one radius in metres is a
 * different number of mercator units at every latitude. This is why §4.2's comment
 * says a mercator-space disc is still a disc on screen and needs no latitude
 * correction for its SHAPE, while `a_radius` carries the ground-size variation.
 */
export function metresToMercator(metres: number, lat: number): number {
  return metres / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180))
}

/** §4.1 — `revealScale × circumradius ≈ 1.35 × 75.9 ≈ 102 m`. */
export const DISC_RADIUS_M = REVEAL_SCALE * CELL_CIRCUMRADIUS_M

/* ─── The instance arrays ───────────────────────────────────────────────────── */

function pack(discs: Array<{ lat: number; lng: number; radiusM: number; value: number }>): Float32Array {
  const out = new Float32Array(discs.length * INSTANCE_FLOATS)
  discs.forEach((d, i) => {
    out[i * INSTANCE_FLOATS + 0] = mercatorX(d.lng)
    out[i * INSTANCE_FLOATS + 1] = mercatorY(d.lat)
    out[i * INSTANCE_FLOATS + 2] = metresToMercator(d.radiusM, d.lat)
    out[i * INSTANCE_FLOATS + 3] = d.value
  })
  return out
}

/**
 * A 469-cell res-10 disk around the centre, plus the two isolated overlapping discs
 * the operator's eye actually reads.
 *
 * THE PAIR IS THE POINT OF THE PAIR. The 469-cell field overlaps itself everywhere, so
 * an additive blend turns it into a bright mess — loud, but it is a mess either way and
 * "is this mess uniform" is not a question anyone can answer confidently. Two discs on
 * their own, overlapping by exactly one radius, give one unambiguous thing to look at:
 * either the intersection is the same grey as the rest, or it is a brighter lens. That
 * is the ticket's Operator validation, verbatim, and it needs its own geometry to exist.
 */
export function spikeField(): Float32Array {
  const origin = latLngToCell(SPIKE_CENTRE.lat, SPIKE_CENTRE.lng, 10)
  const cells = gridDisk(origin, SPIKE_RING_K).map((cell) => {
    const [lat, lng] = cellToLatLng(cell)
    return { lat, lng, radiusM: DISC_RADIUS_M, value: DISC_COVERAGE }
  })

  // Clear of the field: it spans k × 131 m ≈ 1.6 km, and 0.035° of longitude at this
  // latitude is ~3.4 km. Equal coverage values, because "uniform brightness" is the
  // observation and two different values would make the eye check meaningless.
  const pairRadiusM = DISC_RADIUS_M * 8
  const pairOffset = metresToMercator(pairRadiusM / 2, SPIKE_CENTRE.lat) * 360
  const pairLng = SPIKE_CENTRE.lng + 0.035
  const pair = [-1, 1].map((side) => ({
    lat: SPIKE_CENTRE.lat,
    lng: pairLng + side * pairOffset,
    radiusM: pairRadiusM,
    value: DISC_COVERAGE,
  }))

  return pack([...cells, ...pair])
}

/**
 * The probe pair, `PROBE_HIGH` FIRST — `judgeProbe` depends on the draw order to tell
 * an honoured `MAX` from an ignored blend equation.
 *
 * Deliberately large (20 × the cell radius, ~2 km) and separated by exactly one radius.
 * Large because the verdict is a pixel-count comparison and a 6-pixel disc in a
 * half-resolution mask is not enough area to compare; separated by one radius because
 * that leaves each disc 61% of its own pixels exclusively, which is a ratio no rounding
 * can blur. They are never seen — `runMaskPass` clears the mask after reading them.
 */
export function spikeProbe(): Float32Array {
  const radiusM = DISC_RADIUS_M * 20
  const offset = metresToMercator(radiusM / 2, SPIKE_CENTRE.lat) * 360
  return pack([
    { lat: SPIKE_CENTRE.lat, lng: SPIKE_CENTRE.lng - offset, radiusM, value: PROBE_HIGH },
    { lat: SPIKE_CENTRE.lat, lng: SPIKE_CENTRE.lng + offset, radiusM, value: PROBE_LOW },
  ])
}
