import { Stub } from "@/components/stub"

// §2.1 — fullscreen map plus one card at the bottom: the plinth. §4.1 is emphatic
// that there is NO separate map screen; this route is the map. Cold start lands
// here and back from everywhere returns here (§1.5).
//
// This is also where a SIGNED-OUT visitor lands: middleware.ts redirects every
// other route here, and the Authenticator in the root layout renders sign-in in
// place of this content. There is no separate /sign-in route, which keeps §1.2's
// "seven routes" true.
export default function Home() {
  return (
    <Stub
      route="/"
      becomes="Map + plinth"
      note="The map is the home screen. The plinth carries glanceable state and the three destinations — there is no bottom tab bar (§1.5)."
    />
  )
}
