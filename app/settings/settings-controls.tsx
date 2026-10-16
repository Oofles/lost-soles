"use client"

import { signOut } from "aws-amplify/auth"
import { useState, type CSSProperties } from "react"

import { button } from "./styles"

/**
 * The three interactive pieces of `/settings` (ticket 0089). The page itself stays a
 * server component; only these hold state.
 *
 * EACH ONE TAKES ITS STAGE AS A PROP, with the click as the only thing that moves it.
 * The repo has no DOM test environment, so every stage is rendered statically in
 * `page.test.tsx` and `settings-controls.test.tsx` by passing `initialStage`. The
 * transitions themselves are one `setStage` call each.
 *
 * NO VENDOR NAME. The source's display name arrives as a prop from the registry, the
 * same way the page gets it (`check-boundaries.mjs` scans `app/`).
 */

const quiet: CSSProperties = {
  ...button,
  border: "1px solid var(--line)",
  color: "var(--text-secondary)",
}

/** `--destructive` is `--oxblood`: "the destructive confirm in /settings. Only." (06 §8.2). */
const destructive: CSSProperties = {
  ...button,
  border: "1px solid var(--destructive)",
  background: "var(--destructive)",
  color: "var(--on-destructive)",
}

const muted: CSSProperties = { color: "var(--text-muted)", fontSize: ".8125rem" }

/* ─── Disconnect ──────────────────────────────────────────────────────────── */

export type DisconnectStage = "idle" | "confirming"

/**
 * Criteria 3 and 4. One confirmation, and the confirmation is where the reassurance
 * lives: someone worried about their map reads it at the moment they are about to act.
 * 08 §6.5 — disconnect revokes and stops ingest; it does not delete anything.
 */
export function DisconnectControl({
  action,
  displayName,
  initialStage = "idle",
}: {
  action: string
  displayName: string
  initialStage?: DisconnectStage
}) {
  const [stage, setStage] = useState<DisconnectStage>(initialStage)

  if (stage === "idle") {
    return (
      <button type="button" style={quiet} onClick={() => setStage("confirming")}>
        Disconnect
      </button>
    )
  }

  return (
    <div
      role="group"
      aria-label={`Disconnect ${displayName}`}
      style={{ border: "1px solid var(--line)", borderRadius: ".375rem", padding: ".75rem" }}
    >
      <p style={{ color: "var(--text-primary)", marginTop: 0, fontWeight: 600 }}>
        Disconnect {displayName}?
      </p>
      <p style={{ color: "var(--text-secondary)" }}>
        New activities stop arriving and {displayName}&rsquo;s access is revoked.
      </p>
      <p style={{ color: "var(--text-secondary)" }}>
        Your map, your XP and levels, and your run history are all kept. Nothing is deleted.
        This is not account deletion. You can reconnect at any time.
      </p>
      <form method="post" action={action} style={{ display: "inline" }}>
        <button type="submit" style={button}>
          Yes, disconnect
        </button>
      </form>{" "}
      <button type="button" style={quiet} onClick={() => setStage("idle")}>
        Cancel
      </button>
    </div>
  )
}

/* ─── Sign out ────────────────────────────────────────────────────────────── */

/**
 * Criterion 6. `signOut()` clears the Amplify session from cookie storage and revokes
 * the refresh token. A full navigation to `/`, not a client route change, so the
 * server renders the signed-out state. That is the Authenticator, because `/` is the
 * signed-out landing (`middleware.ts`).
 */
export async function signOutAndLeave(
  deps: { signOut: () => Promise<void>; navigate: (href: string) => void } = {
    signOut: () => signOut(),
    navigate: (href) => window.location.assign(href),
  },
): Promise<void> {
  await deps.signOut()
  deps.navigate("/")
}

export function SignOutButton() {
  const [pending, setPending] = useState(false)
  return (
    <button
      type="button"
      style={quiet}
      disabled={pending}
      onClick={() => {
        setPending(true)
        void signOutAndLeave().catch(() => setPending(false))
      }}
    >
      Sign out
    </button>
  )
}

/* ─── Account deletion — the entry point only ─────────────────────────────── */

/** The phrase the operator types. Plain words, so typing it is reading it. */
export const DELETION_PHRASE = "delete my account"

export const deletionPhraseMatches = (typed: string) =>
  typed.trim().toLowerCase() === DELETION_PHRASE

/**
 * The stable runbook path (D-325, ticket 0089). Today it is a stub saying it is not
 * executable. Ticket 0106 owns filling it in. The repo is public (D-199), so the
 * link works from any browser.
 */
export const ACCOUNT_DELETION_RUNBOOK_URL =
  "https://github.com/Oofles/lost-soles/blob/main/docs/runbooks/account-deletion.md"

export type DeletionStage = "idle" | "confirming" | "acknowledged"

/**
 * Criterion 7. This DELETES NOTHING, and no server call is reachable from it. The typed
 * confirmation unlocks a link to the runbook, because deletion is an operator action
 * (08 §6.4). The ticket's note covers this: a deletion path that has never been
 * executed is not a deletion path, and ticket 0106 is where one first is.
 */
export function DeletionEntry({
  initialStage = "idle",
  initialTyped = "",
}: {
  initialStage?: DeletionStage
  initialTyped?: string
}) {
  const [stage, setStage] = useState<DeletionStage>(initialStage)
  const [typed, setTyped] = useState(initialTyped)
  const matches = deletionPhraseMatches(typed)

  if (stage === "idle") {
    return (
      <button type="button" style={quiet} onClick={() => setStage("confirming")}>
        Delete account&hellip;
      </button>
    )
  }

  if (stage === "confirming") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (matches) setStage("acknowledged")
        }}
      >
        <p style={{ color: "var(--text-primary)", marginTop: 0, fontWeight: 600 }}>
          This erases everything: the map, every level, every run, and the archive.
        </p>
        <p style={{ color: "var(--text-secondary)" }}>
          It cannot be undone. If you only want to stop activities arriving, use Disconnect
          above instead.
        </p>
        <label style={{ display: "block", color: "var(--text-secondary)" }}>
          Type <strong>{DELETION_PHRASE}</strong> to continue
          <input
            type="text"
            name="deletion-confirmation"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            style={{
              display: "block",
              marginTop: ".375rem",
              minHeight: "2rem",
              width: "100%",
              boxSizing: "border-box",
              font: "inherit",
              padding: ".375rem .5rem",
              border: "1px solid var(--line)",
              borderRadius: ".375rem",
              background: "var(--surface)",
              color: "var(--text-primary)",
            }}
          />
        </label>
        <p>
          <button
            type="submit"
            style={{ ...destructive, opacity: matches ? 1 : 0.5 }}
            disabled={!matches}
          >
            Continue to deletion
          </button>{" "}
          <button
            type="button"
            style={quiet}
            onClick={() => {
              setTyped("")
              setStage("idle")
            }}
          >
            Cancel
          </button>
        </p>
      </form>
    )
  }

  return (
    <div>
      <p style={{ color: "var(--text-primary)", marginTop: 0, fontWeight: 600 }}>
        Nothing has been deleted.
      </p>
      <p style={{ color: "var(--text-secondary)" }}>
        Deleting an account is done by the operator, step by step, from the account-deletion
        runbook. This screen never deletes anything itself.
      </p>
      <p>
        <a href={ACCOUNT_DELETION_RUNBOOK_URL} target="_blank" rel="noopener noreferrer" style={button}>
          Open the account-deletion runbook
        </a>
      </p>
      <p style={muted}>Your data is unchanged until that runbook is carried out.</p>
    </div>
  )
}
