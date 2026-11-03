import { signInWithGoogle } from "@/app/auth-actions"
import { button } from "@/app/settings/styles"
import { APP_NAME, APP_TAGLINE } from "@/lib/app-meta"

/**
 * `/` SIGNED OUT. Ticket 0332, the cutover (D-473), replacing ticket 0014's Authenticator.
 *
 * The app's name and ONE action. There is no email field, no password and no sign-up: the only
 * way in is Google, and who gets past it is decided by `AUTH_ALLOWED_EMAILS` and `IDENTITIES`
 * (D-471), never by this page. Adding a second door here is `08` §2.4's Trigger A, not a UI change.
 *
 * A server component with a plain `<form>`: it works before hydration, and the action is a full
 * page redirect to Google's account chooser (`prompt: select_account`, `lib/auth/config.ts`).
 *
 * WHAT IT DOES NOT CARRY. Rendered by the `(home)` layout in place of the home screen, so a
 * signed-out payload holds no map, no home coordinate and nothing about the account (0186).
 */
export function SignInLanding() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "1rem",
        background: "var(--bg)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "2.25rem", margin: 0 }}>
        {APP_NAME}
      </h1>
      <p style={{ color: "var(--text-secondary)", margin: 0 }}>{APP_TAGLINE}</p>
      <form action={signInWithGoogle}>
        <button type="submit" style={{ ...button, fontWeight: 600 }}>
          Sign in with Google
        </button>
      </form>
    </main>
  )
}
