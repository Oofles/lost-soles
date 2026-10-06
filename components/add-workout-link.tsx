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
 * Styled to match the Sync button beside it, tokens only.
 */
export function AddWorkoutLink() {
  return (
    <Link
      href="/log"
      style={{
        display: "inline-block",
        padding: ".6rem 1rem",
        borderRadius: ".375rem",
        border: "1px solid var(--accent)",
        background: "var(--surface)",
        color: "var(--accent-text)",
        textDecoration: "none",
      }}
    >
      Add workout
    </Link>
  )
}
