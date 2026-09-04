import { currentUserId, isOwner } from "@/lib/auth/owner"
import { getSourceAccountSummary } from "@/lib/sources/source-account-store"
import { connectableSources, getOAuthConnector } from "@/src/adapters/registry"

/**
 * §1.3 — small and boring, and it must stay under one screenful. Source re-auth lives
 * here (the one recurring chore S3 permits), plus sign out, the account-deletion
 * entry point and build info.
 *
 * WHAT TICKET 0032 PUT HERE AND WHY IT IS NOT THE WHOLE SCREEN. 0089 owns this page
 * (capability 13) and depends on 0032 for exactly this flow. 0032 needs the smallest
 * surface that lets a person start a connect, read a scope refusal and disconnect,
 * because criterion 3 requires the refusal to be RENDERED and because the operator
 * validation is "tap Connect on the settings screen and untick the permission".
 *
 * So: no sign out, no deletion entry, no build info, no confirmation dialog on
 * disconnect — those are 0089's, listed in its acceptance criteria, and building them
 * here would be widening a ticket rather than finishing one.
 *
 * NO VENDOR NAME APPEARS IN THIS FILE. The sources come from the registry and each
 * one carries its own display name. `check-boundaries.mjs` scans `app/` for exactly
 * that leak, and it is right to (D-100, D-121.1).
 */
export const dynamic = "force-dynamic"

const card: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: ".5rem",
  padding: "1rem",
  background: "var(--surface)",
  marginTop: "1rem",
}

const button: React.CSSProperties = {
  display: "inline-block",
  padding: ".6rem 1rem",
  borderRadius: ".375rem",
  border: "1px solid var(--accent)",
  background: "transparent",
  color: "var(--accent-text)",
  font: "inherit",
  cursor: "pointer",
  textDecoration: "none",
}

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; source?: string }>
}) {
  const { connect, source: outcomeSource } = await searchParams

  const userId = await currentUserId()
  if (userId === undefined || !isOwner(userId)) {
    // The middleware has already refused a signed-out request; this is the second
    // check, for the signed-in non-owner case (§6.5).
    return (
      <main style={{ padding: "1.5rem", maxWidth: "40rem" }}>
        <h1 style={{ color: "var(--text-primary)" }}>Settings</h1>
      </main>
    )
  }

  const sources = await Promise.all(
    connectableSources().map(async (id) => ({
      connector: getOAuthConnector(id),
      account: await getSourceAccountSummary(userId, id),
    })),
  )

  return (
    <main style={{ padding: "1.5rem", maxWidth: "40rem" }}>
      <h1 style={{ color: "var(--text-primary)", marginTop: 0 }}>Settings</h1>

      {sources.map(({ connector, account }) => {
        const connected = account !== null && account.status === "ACTIVE"
        const showOutcome = outcomeSource === connector.source ? connect : undefined

        return (
          <section key={connector.source} style={card}>
            <h2 style={{ color: "var(--text-primary)", margin: 0, fontSize: "1.125rem" }}>
              {connector.displayName}
            </h2>

            {/*
              THE REFUSAL. Criterion 3: it names the consequence, and the consequence
              text comes from the connector so that the screen and the check that
              refused cannot disagree about what the user was told.

              The re-authorize link carries `force=1`, which asks the provider for a
              fresh consent screen. Without it the provider silently re-approves the
              same reduced grant and the user never sees the box they need to tick.
            */}
            {showOutcome === "scope-refused" ? (
              <div
                style={{
                  border: "1px solid var(--accent)",
                  borderRadius: ".375rem",
                  padding: ".75rem",
                  marginTop: ".75rem",
                }}
              >
                <p style={{ color: "var(--text-primary)", marginTop: 0, fontWeight: 600 }}>
                  Not connected — a permission is missing.
                </p>
                <p style={{ color: "var(--text-secondary)" }}>{connector.scopeConsequence}</p>
                <p style={{ color: "var(--text-secondary)" }}>
                  Nothing was saved. Try again and leave every permission ticked.
                </p>
                <a href={`/api/auth/${connector.source}/start?force=1`} style={button}>
                  Try again with all permissions
                </a>
              </div>
            ) : null}

            {showOutcome === "denied" ? (
              <p style={{ color: "var(--text-secondary)" }}>
                You cancelled on {connector.displayName}. Nothing was saved.
              </p>
            ) : null}

            {showOutcome === "failed" || showOutcome === "disconnect-failed" ? (
              <p style={{ color: "var(--text-secondary)" }}>
                That didn&rsquo;t work. Nothing was changed — try again.
              </p>
            ) : null}

            {connected ? (
              <>
                <p style={{ color: "var(--text-secondary)", marginBottom: ".25rem" }}>
                  Connected as athlete {account.externalOwnerId}.
                </p>
                {/*
                  The scopes are named on screen, not merely stored. The operator
                  validation asks for exactly this: proof that the connection that
                  succeeded is the one with the full permission, not a reduced grant
                  that happens to look healthy.
                */}
                <p
                  style={{
                    color: "var(--text-muted)",
                    fontFamily: "monospace",
                    fontSize: ".8125rem",
                  }}
                >
                  {account.scopes.join(" ")}
                </p>
                <form method="post" action={`/api/auth/${connector.source}/disconnect`}>
                  <button type="submit" style={button}>
                    Disconnect
                  </button>
                </form>
                <p style={{ color: "var(--text-muted)", fontSize: ".8125rem" }}>
                  Disconnecting stops new activities arriving. Your map, your levels and
                  your history are kept — this is not account deletion.
                </p>
              </>
            ) : (
              <>
                <p style={{ color: "var(--text-secondary)" }}>
                  {account === null
                    ? "Not connected."
                    : `Not connected (${account.status.toLowerCase().replace("_", " ")}).`}
                </p>
                <a href={`/api/auth/${connector.source}/start`} style={button}>
                  Connect {connector.displayName}
                </a>
              </>
            )}
          </section>
        )
      })}

      <p style={{ color: "var(--text-muted)", fontSize: ".875rem", marginTop: "1.5rem" }}>
        Sign out, account deletion and build info arrive with ticket 0089.
      </p>
    </main>
  )
}
