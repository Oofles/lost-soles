/**
 * COPIED VERBATIM from `school-hub`'s `lib/auth/config.ts` at commit
 * 099f1ada15142f0cc6bf33bee5e228d20ed4dfb6. Capability `19-authjs-migration`, ticket 0330, D-471.
 *
 * DO NOT EDIT BELOW THE END-OF-HEADER LINE. Lost Soles' additions (basePath, pages, the
 * email -> uid map) live in `lib/auth/index.ts`, `lib/auth/identity.ts` and
 * `lib/auth/owner-ids.ts`, so this module stays diffable against its source.
 * `lib/auth/config.test.ts` pins the body to the source's sha256.
 *
 * ONE DIVERGENCE, AND IT IS THE PACKAGE, NOT THIS FILE (D-NEW-a, amending D-471): Lost Soles
 * pins `next-auth` 5.0.0-beta.32, not `school-hub`'s 5.0.0-beta.25. beta.25 carries critical
 * advisories that `npm audit --omit=dev --audit-level=high` in `amplify.yml` refuses with no
 * exceptions: GHSA-8fpg-xm3f-6cx3 (config errors fail existence checks open),
 * GHSA-7rqj-j65f-68wh (email normaliser homoglyph `@` bypass), GHSA-x445-f3h2-j279 (OAuth
 * check cookies not bound to their provider), GHSA-xmf8-cvqr-rfgj, GHSA-5jpx-9hw9-2fx4.
 * beta.32 audits clean. This file compiles unchanged against it.
 */
// ── END OF HEADER ── everything below is school-hub's file, byte for byte ──
import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

/**
 * Edge-safe Auth.js configuration.
 *
 * This file must stay free of Prisma, Node built-ins, and anything else that
 * cannot run in the Edge runtime, because `middleware.ts` imports it. Anything
 * needing the database goes in `lib/auth/index.ts` instead.
 *
 * PORTABILITY: this module is intended to be copied verbatim into the other
 * devaultsecurity.com Next.js apps. It reads everything it needs from env vars
 * and has no app-specific imports.
 */

/** Comma-separated allowlist. Nobody outside it can sign in, ever. */
function allowedEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const list = allowedEmails()
  // Fail closed: an unset or empty allowlist permits nobody.
  if (list.length === 0) return false
  return list.includes(email.toLowerCase())
}

/**
 * Setting AUTH_COOKIE_DOMAIN to ".devaultsecurity.com" makes the session cookie
 * valid across every subdomain. Combined with a shared AUTH_SECRET that gives
 * real single-sign-on - but it also makes the cookie readable by every other
 * app on the domain, so only set it once a second app actually uses this
 * module. Until then, host-only is tighter and costs nothing.
 *
 * Always leave it unset locally: a browser rejects a Domain attribute that does
 * not match the current host, so login would fail silently with no cookie set.
 */
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined
const useSecureCookies = process.env.NODE_ENV === "production"

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      // Only non-sensitive scopes. This is why the OAuth app can be published
      // to production without a Google verification review, and why there is
      // no refresh-token expiry problem.
      authorization: {
        params: { scope: "openid email profile", prompt: "select_account" },
      },
    }),
  ],

  // JWT sessions, no database adapter: keeps middleware Edge-compatible.
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },

  pages: { signIn: "/login", error: "/login" },

  // Amplify terminates TLS upstream; without this Auth.js rejects the host.
  trustHost: true,

  cookies: {
    sessionToken: {
      name: useSecureCookies
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
        ...(cookieDomain ? { domain: cookieDomain } : {}),
      },
    },
  },

  callbacks: {
    /** The allowlist gate. Returning false sends the user back to /login. */
    signIn({ profile, user }) {
      return isAllowedEmail(profile?.email ?? user?.email)
    },

    jwt({ token, profile }) {
      if (profile?.email) {
        token.email = profile.email
        token.name = profile.name ?? token.name
        token.picture = profile.picture ?? token.picture
      }
      return token
    },

    session({ session, token }) {
      if (session.user) {
        session.user.email = token.email ?? session.user.email
        session.user.name = token.name ?? session.user.name
        session.user.image = token.picture ?? session.user.image
      }
      return session
    },

    /**
     * Re-checked on every request by middleware. Belt-and-braces against a
     * session minted while an email was still on the allowlist.
     */
    authorized({ auth }) {
      return isAllowedEmail(auth?.user?.email)
    },
  },
}
