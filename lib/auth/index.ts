import NextAuth from "next-auth"

import { authConfig } from "@/lib/auth/config"

/**
 * The Auth.js instance. Ticket 0330, D-471. `config.ts` is `school-hub`'s, verbatim; everything
 * Lost Soles needs that differs from it is here, as overrides, so that file stays diffable.
 *
 * - `basePath: "/api/authjs"`. `/api/auth/[source]` is the Strava OAuth route family (D-194), and
 *   Next will not put a `[...nextauth]` catch-all beside a `[source]` segment. The Google
 *   redirect URI is therefore `https://soles.devaultsecurity.com/api/authjs/callback/google`.
 *   `AUTH_URL` must be the bare origin: next-auth only derives a basePath from it when it has a
 *   path, and this explicit one wins either way.
 * - `pages` -> `/`. `school-hub` has a `/login` page; Lost Soles has none, and `/` is the
 *   signed-out landing (middleware.ts). Auth.js sends a refused or failed sign-in there.
 *
 * Edge-safe: `middleware.ts` imports this. No Node built-ins, no database.
 *
 * WHO MAY CALL `auth()`. Only `lib/auth/owner.ts` (`currentUserId()`) and `middleware.ts`.
 * Everything else asks `currentUserId()`. `lib/auth/session-readers.test.ts` pins it.
 */
export const { handlers, auth } = NextAuth({
  ...authConfig,
  basePath: "/api/authjs",
  pages: { signIn: "/", error: "/" },
})
