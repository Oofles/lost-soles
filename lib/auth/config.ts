/**
 * COPIED VERBATIM from `school-hub`'s `lib/auth/config.ts` at commit
 * 7ba7d2e0a401bd1431fac26de8034e0e972436f2. Capability `19-authjs-migration`, ticket 0330, D-471;
 * re-copied at ticket 0339, D-478 (core's SSO: `AUTH_SESSION_COOKIE`, `ssoLoginUrl()`,
 * `isSsoUrl()` and the `redirect` callback).
 *
 * DO NOT EDIT BELOW THE END-OF-HEADER LINE. Lost Soles' additions (basePath, pages, the
 * email -> uid map) live in `lib/auth/index.ts`, `lib/auth/identity.ts` and
 * `lib/auth/owner-ids.ts`, so this module stays diffable against its source.
 * `lib/auth/config.test.ts` pins the body to the source's sha256.
 *
 * ONE DIVERGENCE, AND IT IS THE PACKAGE, NOT THIS FILE (D-474, amending D-471): Lost Soles
 * pins `next-auth` 5.0.0-beta.32. (`school-hub` moved to beta.32 too, at 6ef6880.) beta.25 carries
 * critical advisories that `npm audit --omit=dev --audit-level=high` in `amplify.yml` refuses with
 * no exceptions: GHSA-8fpg-xm3f-6cx3 (config errors fail existence checks open),
 * GHSA-7rqj-j65f-68wh (email normaliser homoglyph `@` bypass), GHSA-x445-f3h2-j279 (OAuth
 * check cookies not bound to their provider), GHSA-xmf8-cvqr-rfgj, GHSA-5jpx-9hw9-2fx4.
 * This file compiles unchanged against beta.32.
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
 * valid across every subdomain. Only set it together with the shared
 * AUTH_SECRET and AUTH_SESSION_COOKIE (see below), on EVERY app that joins
 * SSO: any app may re-issue the cookie, and a re-issue without the domain
 * would leave a host-only duplicate. Until an app joins, keep it unset.
 *
 * Always leave it unset locally: a browser rejects a Domain attribute that does
 * not match the current host, so login would fail silently with no cookie set.
 */
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined
const useSecureCookies = process.env.NODE_ENV === "production"

/**
 * Session cookie name, without the `__Secure-` prefix (added in production).
 *
 * Every app MUST use its own name (e.g. "eve-ops.session-token") until it joins
 * SSO, and exactly the shared name ("devault.session-token") once it does.
 * Auth.js uses the name as the JWE salt, so apps sharing a cookie need the same
 * name AND the same AUTH_SECRET. Two apps sharing a name with different
 * secrets, one of them domain-wide, is the sign-in loop seen on 2026-11-02.
 * The prefix is `__Secure-`, never `__Host-`, because `__Host-` forbids Domain.
 */
const sessionCookieBase =
  process.env.AUTH_SESSION_COOKIE?.trim() || "authjs.session-token"

/** Every SSO app lives on this domain or a subdomain of it. */
const SSO_PARENT_DOMAIN = "devaultsecurity.com"

/**
 * True for an absolute https URL on devaultsecurity.com or a subdomain. This is
 * where core may send someone back to after sign-in or sign-out. Anything else
 * (other hosts, http, credentials in the URL, garbage) is false.
 */
export function isSsoUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== "https:" || u.username || u.password) return false
  return (
    u.hostname === SSO_PARENT_DOMAIN ||
    u.hostname.endsWith(`.${SSO_PARENT_DOMAIN}`)
  )
}

/**
 * Where to send a signed-out visitor, or null to use this app's own /login.
 *
 * AUTH_SSO_URL is the origin of the app that does the Google sign-in
 * ("https://core.devaultsecurity.com"). Set it on every app that joins SSO
 * EXCEPT core itself, and leave it unset locally (cookies cannot span
 * localhost and devaultsecurity.com). The return address is built from
 * AUTH_URL, the public origin, because the request URL behind Amplify can be
 * an internal host.
 */
export function ssoLoginUrl(pathAndQuery: string): URL | null {
  const sso = process.env.AUTH_SSO_URL?.trim()
  const publicOrigin = process.env.AUTH_URL?.trim()
  if (!sso || !publicOrigin) return null
  const login = new URL("/login", sso)
  login.searchParams.set("next", new URL(pathAndQuery, publicOrigin).toString())
  return login
}

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
        ? `__Secure-${sessionCookieBase}`
        : sessionCookieBase,
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
    /**
     * Auth.js only allows same-origin redirects by default. Also allow
     * https://*.devaultsecurity.com, so core can send people back to the app
     * they came from after signing in or out.
     */
    redirect({ url, baseUrl }) {
      if (url.startsWith("/") && !url.startsWith("//")) return `${baseUrl}${url}`
      try {
        if (new URL(url).origin === baseUrl) return url
      } catch {
        return baseUrl
      }
      return isSsoUrl(url) ? url : baseUrl
    },

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
