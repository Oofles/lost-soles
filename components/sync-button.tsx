"use client"

import { useActionState } from "react"

import { syncNowAction, type SyncSummary } from "@/app/sync-action"

/**
 * THE ONE TAP. Ticket 0043 criterion 6, `09-roadmap.md` §4.5.
 *
 * A client component for exactly one reason: `useActionState` gives the pending state the
 * criterion asks for, and a pending state is the difference between "the button did
 * nothing" and "the button is working". A sweep takes a second or two of provider
 * round-trips, which is long enough to press twice.
 *
 * DELIBERATELY UGLY, and that is `09-roadmap.md` §2.3's instruction rather than a
 * shortcut: "the token system is DEFINED but applied only to the map and one button". No
 * toast, no progress bar, no choreography — the post-run moment is capability 12, and
 * building a version of it here would be something capability 12 has to delete.
 *
 * NO VENDOR NAME IN THIS FILE. The sentence is composed on the server from the registry's
 * `displayName`, so this component renders a string it does not interpret.
 */

/**
 * Tokens only — `scripts/check-design-tokens.mjs` fails the build on a raw colour
 * anywhere outside `app/tokens.css`. Matched to `/settings`'s button, because two
 * buttons that are almost the same is worse than one that is plain.
 */
const button: React.CSSProperties = {
  padding: ".6rem 1rem",
  borderRadius: ".375rem",
  border: "1px solid var(--accent)",
  background: "transparent",
  color: "var(--accent-text)",
  font: "inherit",
  cursor: "pointer",
}

export function SyncButton() {
  const [summary, formAction, pending] = useActionState<SyncSummary | null>(
    syncNowAction,
    null,
  )

  return (
    <form action={formAction} style={{ marginTop: "1.5rem" }}>
      {/*
        `disabled` while pending is the half that matters. Without it a second press
        starts a second sweep against the same watermark, and while that is SAFE — the
        receipt gate makes the duplicate enqueues no-ops — it spends the provider rate
        limit twice to achieve nothing, and the two sweeps would race to advance the
        watermark.
      */}
      <button type="submit" disabled={pending} style={{ ...button, opacity: pending ? 0.6 : 1 }}>
        {pending ? "Syncing…" : "Sync"}
      </button>

      {/*
        ONE LINE, and it is `aria-live` because the whole point of it is that it appears
        after the press. A screen reader user who has just activated the button is not
        going to go looking for text that silently arrived somewhere below it.
      */}
      <p
        aria-live="polite"
        style={{ color: "var(--text-secondary)", marginTop: ".75rem", minHeight: "1.25rem" }}
      >
        {pending ? "Checking for new activities…" : (summary?.line ?? "")}
      </p>
    </form>
  )
}
