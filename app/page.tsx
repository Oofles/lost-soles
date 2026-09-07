import { Stub } from "@/components/stub"
import { SyncButton } from "@/components/sync-button"

// §2.1 — fullscreen map plus one card at the bottom: the plinth. §4.1 is emphatic
// that there is NO separate map screen; this route is the map. Cold start lands
// here and back from everywhere returns here (§1.5).
//
// This is also where a SIGNED-OUT visitor lands: middleware.ts redirects every
// other route here, and the Authenticator in the root layout renders sign-in in
// place of this content. There is no separate /sign-in route, which keeps §1.2's
// "seven routes" true.
// The Sync button lands here rather than in the layout (ticket 0043). Cold start arrives
// on this route and back-from-everywhere returns to it (§1.5), so it is one tap after a
// run — which is what the ticket's operator validation describes. In the layout it would
// render over the fullscreen map when capability 08 lands, and on six other stubs that
// have nothing to do with ingest.
//
// Its long-term home is the plinth (§2.1), which is capability 13's. Until then it sits
// under the stub text, unstyled, exactly as 09-roadmap.md §2.3 says this milestone should
// look.
export default function Home() {
  return (
    <>
      <Stub
        route="/"
        becomes="Map + plinth"
        note="The map is the home screen. The plinth carries glanceable state and the three destinations — there is no bottom tab bar (§1.5)."
      />
      <div style={{ padding: "0 1.5rem 1.5rem", maxWidth: "40rem" }}>
        <SyncButton />
      </div>
    </>
  )
}
