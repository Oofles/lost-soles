import { cookies } from "next/headers"
import { fetchAuthSession } from "aws-amplify/auth/server"

import { runWithAmplifyServerContext } from "@/lib/amplify-server"
import { HOME_ZOOM, type Camera } from "@/lib/map-camera"

/**
 * The configured home coordinate. Ticket 0053: "Default camera is the user's most recent
 * activity centroid, falling back to a configured home coordinate."
 *
 * ─── WHY THIS IS AN ENVIRONMENT VARIABLE AND NOT A CONSTANT ──────────────────
 *
 * Because the constant would be the operator's neighbourhood, and this repository is
 * public. `08-security-privacy.md` §7.2 forbids exactly that, D-199 enforces it against
 * fixtures with an allowlist, and the reasoning it gives — "a sample activity checked in
 * for a unit test is a home address in git history forever" — does not stop being true
 * because the coordinate is a camera default instead of a fixture.
 *
 * ─── WHY IT IS ALSO GATED ON THE SESSION ─────────────────────────────────────
 *
 * Keeping it out of git is not enough on its own. `/` is the signed-out landing route
 * (middleware.ts sends every other route here, and the Authenticator renders sign-in in
 * its place), so anything a server component renders into `/` is fetchable by anyone who
 * finds the site. A `NEXT_PUBLIC_` variable would be worse still — inlined into a
 * publicly served JS bundle.
 *
 * So the read happens on the server, behind the same session check middleware uses, and
 * a signed-out request gets `null`. The map then opens on the extract-wide fallback,
 * which identifies nobody.
 *
 * THIS IS NOT SECURITY THEATRE FOR A SINGLE-USER APP. D-123 declines special privacy
 * handling for the explored set on the grounds that the map is shown only to its owner —
 * that argument holds precisely because the map IS behind auth. An unauthenticated
 * landing page quietly carrying the same information is the one hole in it, and closing
 * it costs the fifteen lines below.
 */
/**
 * `Number("")` IS 0, NOT NaN, and that is not a hypothetical. An Amplify environment
 * variable that exists but is blank — the shape a half-finished console entry takes —
 * would otherwise pass every finite-and-in-range check and centre the map on 0,0: Null
 * Island, in the Gulf of Guinea, several thousand kilometres from any tile in the
 * extract. It looks like a camera, so nothing downstream rejects it, and the symptom is
 * an empty grey map that reads as a broken basemap. A blank variable is an unset one.
 */
function envNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function configuredHome(): Camera | null {
  const lat = envNumber(process.env.LOST_SOLES_HOME_LAT)
  const lng = envNumber(process.env.LOST_SOLES_HOME_LNG)
  if (lat === null || lng === null) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

  const zoom = envNumber(process.env.LOST_SOLES_HOME_ZOOM) ?? Number.NaN
  return {
    lat,
    lng,
    zoom: Number.isFinite(zoom) && zoom >= 0 && zoom <= 24 ? zoom : HOME_ZOOM,
    bearing: 0,
  }
}

export async function homeCameraForSession(): Promise<Camera | null> {
  const authenticated = await runWithAmplifyServerContext({
    nextServerContext: { cookies },
    operation: async (contextSpec) => {
      try {
        const session = await fetchAuthSession(contextSpec)
        // Both tokens, exactly as middleware.ts requires. A partial session is a
        // signed-out session: fail closed.
        return (
          session.tokens?.accessToken !== undefined && session.tokens?.idToken !== undefined
        )
      } catch {
        return false
      }
    },
  })

  return authenticated ? configuredHome() : null
}
