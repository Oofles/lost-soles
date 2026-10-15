import Link from "next/link"

/**
 * THE HOME SCREEN'S ONE ADD-WORKOUT AFFORDANCE. Ticket 0068, D-061.
 *
 * One link to `/log`, and never a button per exercise: per-exercise buttons put every future
 * workout type on the map's surface, and the fifth one forces a redesign. This takes nothing from
 * the registry, so a new workout type changes the home screen by zero pixels (§6.5).
 *
 * A `Link`, not a button, because `/log` is a real route: the browser back button returns here,
 * and Next prefetches the static page so it renders with the network off (D-282).
 *
 * `0086`: the centre and widest of the plinth's three destinations (`06` §2.2 row 9). Its look is
 * the plinth's `.plinth-dest` class (`components/plinth/plinth.tsx`), so the three buttons are drawn
 * by one rule; the `+` is decoration and is not read aloud.
 */
export function AddWorkoutLink() {
  return (
    <Link href="/log" className="plinth-dest plinth-dest-primary">
      <span aria-hidden="true">+{"\u00a0"}</span>Add workout
    </Link>
  )
}
