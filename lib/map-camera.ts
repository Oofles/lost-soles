/**
 * Where the camera was last time. Ticket 0053.
 *
 * The ticket's reason is operator ergonomics rather than polish: "so the operator does
 * not re-navigate to their neighbourhood on every build". During capability 08 the app
 * is rebuilt and reloaded dozens of times a session, and a map that always opens on a
 * continent view makes every one of those reloads cost a pan and a zoom.
 */

import type { RunFeatureCollection } from "@/lib/runs/wire"

export interface Camera {
  lng: number
  lat: number
  zoom: number
  bearing: number
}

const STORAGE_KEY = "lost-soles.camera.v1"

/**
 * THE FALLBACK IS THE EXTRACT, NOT THE OPERATOR'S HOME, and that is a privacy position
 * rather than a default nobody thought about.
 *
 * `08-security-privacy.md` §7.2 and D-199 forbid the operator's real coordinates from
 * reaching this repository — `github.com/Oofles/lost-soles` is public, and a committed
 * coordinate is a home address in git history forever. The same reasoning applies one
 * step further out: `/` is the signed-out landing route, so anything the server renders
 * into it is fetchable without a session. The configured home therefore arrives only
 * through `lib/map-home.ts`, which reads it from the environment and hands it over only
 * to an authenticated request.
 *
 * What is left here is the centre of the Florida extract at a zoom that shows the state:
 * already public in `docs/capabilities/08-map-and-fog-renderer.md`, identifying nobody,
 * and — the practical part — guaranteed to have tiles under it.
 */
export const EXTRACT_FALLBACK: Camera = { lng: -83.8, lat: 27.75, zoom: 6, bearing: 0 }

/** Neighbourhood zoom. The floor D-051 is judged at is z14-17. */
export const HOME_ZOOM = 14

function isFiniteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
}

/**
 * VALIDATED FIELD BY FIELD, because `localStorage` is user-writable and survives
 * upgrades. A `NaN` zoom or an out-of-range latitude reaches MapLibre as a throw during
 * construction, which on this route means a blank screen with the map never built — the
 * same symptom as a broken basemap and much harder to tell apart. A camera that fails to
 * parse is not an error worth surfacing; it is a camera we do not have.
 */
export function parseCamera(raw: string | null): Camera | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof value !== "object" || value === null) return null
  const { lng, lat, zoom, bearing } = value as Record<string, unknown>
  if (!isFiniteIn(lng, -180, 180)) return null
  if (!isFiniteIn(lat, -90, 90)) return null
  if (!isFiniteIn(zoom, 0, 24)) return null
  if (!isFiniteIn(bearing, -360, 360)) return null
  return { lng, lat, zoom, bearing }
}

/**
 * Reads and writes are both wrapped: Safari private browsing throws on `localStorage`
 * access rather than returning null, and a map that will not load because a preference
 * could not be saved is a bad trade.
 */
export function readCamera(): Camera | null {
  try {
    return parseCamera(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export function writeCamera(camera: Camera): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(camera))
  } catch {
    /* nothing to do and nothing worth telling the operator */
  }
}

/**
 * THE MOST RECENT RUN, AS A CAMERA. Ticket `0186`, completing `0053`'s *"the user's most recent
 * activity centroid, falling back to a configured home coordinate"*.
 *
 * The centre of the run's bounding box, not the mean of its vertices. A GPS trace is sampled by
 * time, so a vertex mean drifts toward wherever the runner stood still — a traffic light, a
 * water stop, the car park before pressing start. The box centre is where the whole route sits
 * symmetrically on screen, which is what a camera is for.
 *
 * `null` for the empty collection and for a geometry with no finite position in range: the
 * caller then keeps whatever camera it already has, which is the configured home or the extract.
 */
export function runCamera(runs: RunFeatureCollection): Camera | null {
  const geometry = runs.features[0]?.geometry
  if (!geometry) return null

  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (const line of geometry.coordinates) {
    for (const [lng, lat] of line) {
      if (!isFiniteIn(lng, -180, 180) || !isFiniteIn(lat, -90, 90)) continue
      west = Math.min(west, lng)
      east = Math.max(east, lng)
      south = Math.min(south, lat)
      north = Math.max(north, lat)
    }
  }
  if (west > east) return null

  return { lng: (west + east) / 2, lat: (south + north) / 2, zoom: HOME_ZOOM, bearing: 0 }
}

/**
 * WHETHER THE MAP SHOULD MOVE TO THE RUN NOW. Precedence is stored camera → most recent run →
 * configured home → extract (`0186`). The last two are known at construction; the run is not —
 * it arrives from `/api/runs/latest` after the map exists — so it is applied as a one-time move
 * rather than as the constructor's centre.
 *
 * Three things veto it, and each is a camera that outranks a default:
 *
 *   - a camera was stored when the map mounted. That is the operator's own last position, and
 *     `0053` records why it must win: the app is reloaded dozens of times a session.
 *   - the operator has already moved the map. Yanking it out from under a pan because a fetch
 *     came back late is worse than never centring at all.
 *   - it has already happened this mount. The run is re-fetched on every explored-set generation
 *     change (`use-latest-run.ts`), and a sync must not snap the camera back to the new run.
 */
export function firstLoadRunCamera(state: {
  storedAtMount: boolean
  userMoved: boolean
  alreadyCentred: boolean
  runs: RunFeatureCollection
}): Camera | null {
  if (state.storedAtMount || state.userMoved || state.alreadyCentred) return null
  return runCamera(state.runs)
}
