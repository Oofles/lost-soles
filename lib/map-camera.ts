/**
 * Where the camera was last time. Ticket 0053.
 *
 * The ticket's reason is operator ergonomics rather than polish: "so the operator does
 * not re-navigate to their neighbourhood on every build". During capability 08 the app
 * is rebuilt and reloaded dozens of times a session, and a map that always opens on a
 * continent view makes every one of those reloads cost a pan and a zoom.
 */

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
