import { currentUserId, isOwner } from "@/lib/auth/owner"
import { getSourceAccountSummary } from "@/lib/sources/source-account-store"
import { buildInfo } from "@/lib/build-info"
import { connectableSources, getOAuthConnector } from "@/src/adapters/registry"

import { DeletionEntry, DisconnectControl, SignOutButton } from "./settings-controls"
import { button } from "./styles"

/**
 * §1.3, small and boring. Ticket 0089: exactly four things and nothing else.
 *
 *   1. Connect / disconnect each activity source (0032's flow, behind one confirmation).
 *   2. Sign out.
 *   3. The account-deletion ENTRY POINT. A typed confirmation that leads to the runbook,
 *      never a deletion (08 §6.4; ticket 0106 owns the runbook).
 *   4. Build info: version and commit.
 *
 * NOT A PREFERENCES SCREEN. No theme, units, notifications, map mode or sound. Every
 * preference is state the user has to maintain, which is D-013's exact prohibition.
 * `page.test.tsx` asserts that no preference control exists over the rendered tree.
 *
 * DISCONNECT AND DELETION ARE KEPT FAR APART. They differ in colour and in wording, and
 * sign out sits between them, so the deletion entry cannot be hit while reaching for
 * disconnect. Conflating the two is how a user destroys years of data while trying to
 * stop a sync (§6.5).
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

const h2: React.CSSProperties = { color: "var(--text-primary)", margin: 0, fontSize: "1.125rem" }

function BuildLine() {
  const build = buildInfo()
  return (
    <p style={{ color: "var(--text-muted)", fontSize: ".8125rem", marginTop: "2rem" }}>
      Build {build.version} &middot;{" "}
      <code title={build.sha} data-commit={build.sha}>
        {build.shortSha}
      </code>
    </p>
  )
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
        <h1 style={{ color: "var(--text-primary)", fontFamily: "var(--font-serif)", fontWeight: 600 }}>Settings</h1>
        <SignOutButton />
        <BuildLine />
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
      <h1 style={{ color: "var(--text-primary)", marginTop: 0, fontFamily: "var(--font-serif)", fontWeight: 600 }}>Settings</h1>

      {sources.map(({ connector, account }) => {
        const connected = account !== null && account.status === "ACTIVE"
        const showOutcome = outcomeSource === connector.source ? connect : undefined

        return (
          <section key={connector.source} style={card}>
            <h2 style={h2}>{connector.displayName}</h2>

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

            {showOutcome === "disconnected" && !connected ? (
              <p style={{ color: "var(--text-secondary)" }}>
                Disconnected. Your map, your levels and your history are all still here.
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
                {/*
                  One confirmation (criterion 3), and the reassurance sits in it
                  (criterion 4). The POST and its CSRF check are 0032's, unchanged.
                */}
                <DisconnectControl
                  action={`/api/auth/${connector.source}/disconnect`}
                  displayName={connector.displayName}
                />
              </>
            ) : (
              <>
                {/*
                  A DISCONNECTED row may have got that way without this screen: the
                  provider's inbound deauthorization webhook (0093) lands here too, and
                  it reads the same as a disconnect the user made.
                */}
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

      <section style={card}>
        <SignOutButton />
      </section>

      {/*
        Deliberately far from disconnect: a 3rem gap, a rule, its own heading, and a
        trigger that only opens the typed confirmation. 08 §6.4 is an operator runbook,
        so this deletes nothing.
      */}
      <section
        aria-labelledby="delete-account"
        style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid var(--line)" }}
      >
        <h2 id="delete-account" style={{ ...h2, marginBottom: ".75rem" }}>
          Delete account
        </h2>
        <DeletionEntry />
      </section>

      <BuildLine />
    </main>
  )
}
