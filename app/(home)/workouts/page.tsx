import { ChroniclePanel } from "@/components/chronicle/chronicle-panel"
import { currentUserId } from "@/lib/auth/owner"
import { chroniclePage, defaultRunReadDeps } from "@/lib/runs/server"
import type { ChroniclePage } from "@/lib/runs/wire"

// `/workouts` — §2.6, D-486, ticket 0345. Every traceless activity, newest first, opened by the
// plinth's `WORKOUTS`. The Chronicle's panel in the rail's column with the map live beside it,
// under the same `(home)` layout so the map is never re-created and the camera never moves. The
// first page is read here on the server; later ones come from `/api/runs/workouts` as it scrolls.
const EMPTY: ChroniclePage = { items: [], next: null }

export default async function Workouts() {
  const uid = await currentUserId()
  const initial = uid ? await chroniclePage(uid, defaultRunReadDeps(), null, "untraced") : EMPTY
  return <ChroniclePanel initial={initial} list="workouts" />
}
