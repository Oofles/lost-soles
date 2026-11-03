import type { ReactNode } from "react"

import { ExploredProvider } from "@/components/map/explored-provider"
import { FogStatus } from "@/components/map/fog-status"
import { HomeScreen } from "@/components/plinth/home-screen"
import { SignInLanding } from "@/components/sign-in-landing"
import { currentUserId } from "@/lib/auth/owner"
import { homeCameraForSession } from "@/lib/map-home"
import { sourceConnections } from "@/lib/plinth/connections"

// §2.1 — the plinth, a fixed opaque rail down the left edge at ≥1024px, and the map, full bleed
// across the pane beside it (D-313). That is the whole home screen. §4.1 is emphatic that there is
// NO separate map screen; this route is the map. Cold start lands here and back from everywhere
// returns here (§1.5).
//
// A LAYOUT, NOT A PAGE (ticket 0088). `/chronicle` opens in the rail's column with the map live
// beside it (§2.5, D-313), and is a route so back and deep links behave (§1.5). Both `/` and
// `/chronicle` sit in this `(home)` group, so the map is mounted ONCE under both: opening and
// dismissing the Chronicle never re-creates MapLibre and never moves the camera. The route group
// adds no URL segment. `page.tsx` beside this is `/`, and renders nothing of its own.
//
// This is also where a SIGNED-OUT visitor lands: middleware.ts redirects every
// other route here, and this layout renders `<SignInLanding>` in place of the home
// screen (ticket 0332; it was the Authenticator in the root layout until then). There
// is no separate /sign-in route, which keeps §1.2's "seven routes" true.
//
// Ticket 0086 replaced the bare Add workout / Sync pair that sat over the map with the plinth
// (`components/plinth/`). Sync moved INTO the rail as a caption line (D-313); capability 14
// deletes it.

/**
 * ASYNC, AND THEREFORE DYNAMIC. Reading the session costs this route its static
 * prerender. That is the point rather than a side effect — see `lib/map-home.ts`:
 * `/` is the signed-out landing route, so a prerendered `/` would carry the operator's
 * home coordinate to anyone who fetched it.
 */
export default async function HomeLayout({ children }: { children: ReactNode }) {
  /**
   * The IndexedDB key for the explored set (`02-data-model.md` §6.4, ticket 0054). A client
   * component cannot read it at all: the session is an `httpOnly` cookie (D-471).
   *
   * SIGNED OUT, THIS IS THE LANDING (ticket 0332, D-473). The Authenticator that used to hide the
   * home screen on the client is gone, so the server decides: no uid, no home screen, no map, and
   * nothing about the account in the payload (0186). Just the name and Sign in with Google.
   */
  const uid = (await currentUserId()) ?? null
  if (!uid) return <SignInLanding />

  const home = await homeCameraForSession()

  /**
   * `0087`. Connected, not connected, or broken — the plinth's connect line and its one
   * reconnect line (`lib/plinth/connections.ts`). Signed in only: a signed-out payload carries
   * nothing about the account, so the prop is absent rather than empty.
   */
  const sources = uid ? await sourceConnections(uid) : undefined

  return (
    <ExploredProvider uid={uid}>
      <HomeScreen home={home} {...(sources ? { sources } : {})}>
        {children}
      </HomeScreen>
      <FogStatus />
    </ExploredProvider>
  )
}
