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
 * DELIBERATELY QUIET. No toast, no progress bar, no choreography — the post-run moment is
 * capability 12's, and since `0086` this is a caption line in the plinth (D-313) that capability
 * 14 deletes. The in-flight indication is `0087`'s.
 *
 * NO VENDOR NAME IN THIS FILE. The sentence is composed on the server from the registry's
 * `displayName`, so this component renders a string it does not interpret.
 */

/**
 * Tokens only — `scripts/check-design-tokens.mjs` fails the build on a raw colour anywhere outside
 * `app/tokens.css`.
 *
 * `0086`, D-313: A QUIET CAPTION-SIZE TEXT BUTTON on its own line in the plinth, below the three
 * destinations — never a fourth destination button (`06` §2.2). Ink text with a gold underline: gold
 * is a rule here, never the text (D-148). Capability `14` deletes this line and nothing else moves.
 */
const button: React.CSSProperties = {
  padding: "6px 0",
  minHeight: 24,
  border: 0,
  background: "transparent",
  color: "var(--text-secondary)",
  font: "400 12px/1.35 var(--font-sans)",
  textDecorationLine: "underline",
  textDecorationColor: "var(--accent)",
  textUnderlineOffset: 3,
  cursor: "pointer",
}

export function SyncButton() {
  const [summary, formAction, pending] = useActionState<SyncSummary | null>(
    syncNowAction,
    null,
  )

  return (
    <form action={formAction} style={{ marginTop: 8 }}>
      {/*
        `disabled` while pending is the half that matters. Without it a second press
        starts a second sweep against the same watermark, and while that is SAFE — the
        receipt gate makes the duplicate enqueues no-ops — it spends the provider rate
        limit twice to achieve nothing, and the two sweeps would race to advance the
        watermark.
      */}
      <button type="submit" disabled={pending} style={{ ...button, opacity: pending ? 0.6 : 1 }}>
        {pending ? "Syncing…" : "Sync now"}
      </button>

      {/*
        ONE LINE, and it is `aria-live` because the whole point of it is that it appears
        after the press. A screen reader user who has just activated the button is not
        going to go looking for text that silently arrived somewhere below it.
      */}
      <p
        aria-live="polite"
        style={{ color: "var(--text-secondary)", font: "400 12px/1.35 var(--font-sans)", margin: 0, minHeight: "1rem" }}
      >
        {pending ? "Checking for new activities…" : (summary?.line ?? "")}
      </p>
    </form>
  )
}
