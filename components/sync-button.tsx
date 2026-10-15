"use client"

import { useActionState, useEffect } from "react"

import { syncNowAction, type SyncSummary } from "@/app/sync-action"
import { plinthSyncResult } from "@/lib/plinth/sync-result"

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
 * 14 deletes.
 *
 * `0087`, `06` §2.3–§2.4: THE IN-FLIGHT INDICATION IS THIS LINE AND NOTHING ELSE — the label reads
 * `Syncing…` beside one caption; no overlay, nothing over the map, no input blocked but this button.
 * AFTERWARDS IT SAYS ONLY GOOD NEWS. Activities queued is a line; "nothing new", a provider that did
 * not answer, an old failed import — none of them is an event (D-013), so none of them is text
 * (`lib/plinth/sync-result.ts`). A broken token is handed up through `onReconnect` and becomes the
 * plinth's one ink reconnect line, never a sentence here.
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

/**
 * `0087`. A THROWN ACTION IS A FAILED SYNC, AND A FAILED SYNC SHOWS NOTHING. Uncaught, a server action
 * that throws (the network gone mid-press, a deploy missing its queue URL) reaches the nearest error
 * boundary — an error screen over the map for a state D-013 says is not an event. The server logs its
 * own failures; here it is simply "nothing to say".
 */
async function quietSync(previous: SyncSummary | null): Promise<SyncSummary | null> {
  try {
    return await syncNowAction(previous)
  } catch {
    return null
  }
}

export function SyncButton({ onReconnect }: { onReconnect?: (sourceIds: string[]) => void } = {}) {
  const [summary, formAction, pending] = useActionState<SyncSummary | null>(quietSync, null)
  const result = plinthSyncResult(summary)
  const reconnect = result.reconnect.join("\n")

  useEffect(() => {
    if (reconnect) onReconnect?.(reconnect.split("\n"))
  }, [reconnect, onReconnect])

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
        {pending ? "Checking for new activities…" : (result.line ?? "")}
      </p>
    </form>
  )
}
