import { ChroniclePanel } from "@/components/chronicle/chronicle-panel"
import { currentUserId } from "@/lib/auth/owner"
import { chroniclePage, defaultRunReadDeps } from "@/lib/runs/server"
import type { ChroniclePage } from "@/lib/runs/wire"

// `/chronicle` — §2.5, D-313, ticket 0088. The run list, opened by the plinth's `RUNS` and nothing
// else, IN THE RAIL'S COLUMN with the map live beside it. It is a route only so back and deep
// links behave (§1.5): the map underneath is the `(home)` layout's, already mounted.
//
// The first page is read here, on the server, so the list is there on the first paint; later pages
// come from `/api/runs/chronicle` as the list scrolls. The session is the only source of the uid.
const EMPTY: ChroniclePage = { items: [], next: null }

export default async function Chronicle() {
  const uid = await currentUserId()
  const initial = uid ? await chroniclePage(uid, defaultRunReadDeps()) : EMPTY
  return <ChroniclePanel initial={initial} />
}
