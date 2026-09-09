import { ExploredProvider } from "@/components/map/explored-provider"
import { FogStatus } from "@/components/map/fog-status"
import { MapShell } from "@/components/map/map-shell"
import { SyncButton } from "@/components/sync-button"
import { currentUserId } from "@/lib/auth/owner"
import { homeCameraForSession } from "@/lib/map-home"

// §2.1 — fullscreen map plus one card at the bottom: the plinth. §4.1 is emphatic
// that there is NO separate map screen; this route is the map. Cold start lands
// here and back from everywhere returns here (§1.5).
//
// This is also where a SIGNED-OUT visitor lands: middleware.ts redirects every
// other route here, and the Authenticator in the root layout renders sign-in in
// place of this content. There is no separate /sign-in route, which keeps §1.2's
// "seven routes" true.
//
// The stub is gone as of ticket 0053 — this route is now the actual map, which is
// what the stub said it would become. The plinth is capability 13's and does not
// exist yet, so the Sync button sits over the map unstyled instead. That is
// 09-roadmap.md §2.3's instruction ("the token system is DEFINED but applied only
// to the map and one button"), not an unfinished edge: at this milestone ingest is
// a manual tap (D-013 is knowingly violated until capability 14) and it has to
// stay reachable, so it cannot simply be dropped when the map arrives.

/**
 * ASYNC, AND THEREFORE DYNAMIC. Reading the session costs this route its static
 * prerender. That is the point rather than a side effect — see `lib/map-home.ts`:
 * `/` is the signed-out landing route, so a prerendered `/` would carry the operator's
 * home coordinate to anyone who fetched it.
 */
export default async function Home() {
  const home = await homeCameraForSession()
  /**
   * The IndexedDB key for the explored set (`02-data-model.md` §6.4, ticket 0054), read
   * here because the session is already being read one line above and a client component
   * cannot read it at all.
   *
   * `null` for a signed-out visitor, exactly like `home` — `/` is the signed-out landing
   * route, so nothing here may assume a session. A `sub` is not a secret in the way the
   * home coordinate is (it identifies an account, not a neighbourhood, and the browser
   * already holds it inside the ID token cookie), but a signed-out page has no use for
   * one and does not get one.
   */
  const uid = (await currentUserId()) ?? null

  return (
    <ExploredProvider uid={uid}>
      <MapShell home={home} />
      <FogStatus />
      {/*
        `position: fixed` and a z-index above the map's own canvas. MapLibre puts its
        attribution control at the bottom right, so this sits bottom LEFT: the Protomaps
        and OpenStreetMap credit is an acceptance criterion of 0052 and covering it with
        a button would be a poor way to satisfy it.
      */}
      <div
        style={{
          position: "fixed",
          left: "1rem",
          bottom: "2rem",
          zIndex: 1,
        }}
      >
        <SyncButton />
      </div>
    </ExploredProvider>
  )
}
