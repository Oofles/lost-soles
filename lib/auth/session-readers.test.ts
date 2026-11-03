import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Ticket 0330, criterion 4. No server module other than `lib/auth/owner.ts` and `middleware.ts`
 * reads a session. Every other server reader asks `currentUserId()`, so the two gates of D-471
 * (allowlist, then `IDENTITIES`) are applied in exactly one place and cannot be skipped by a
 * module that decrypts the cookie itself.
 *
 * A session read is any of:
 *   - an import from `aws-amplify/auth/server` (Amplify's server-side `fetchAuthSession`);
 *   - an import of `auth` from `@/lib/auth` (next-auth's session reader);
 *   - an import from `next-auth/jwt` (`getToken`, a raw cookie decryption);
 *   - any import from `next-auth` itself outside `lib/auth/`, where the instance is built.
 *
 * Since `0332` (D-473) no module imports `aws-amplify/auth` at all; that rule is pinned in
 * `lib/auth/no-cognito-client.test.ts`. Test files are not modules and are skipped.
 */

const ROOT = join(__dirname, "..", "..")
const ALLOWED = new Set(["lib/auth/owner.ts", "middleware.ts"])
/** Where the Auth.js instance is BUILT: may import next-auth, may not call `auth()`. */
const INSTANCE = new Set(["lib/auth/index.ts", "lib/auth/config.ts"])
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".amplify", "docs", "tickets", "tmp", "public", ".claude"])

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) out.push(p)
  }
  return out
}

const FROM = (mod: string) => new RegExp(`from\\s*["']${mod.replace(/[/.]/g, "\\$&")}["']|import\\(\\s*["']${mod.replace(/[/.]/g, "\\$&")}["']`)
const AUTH_IMPORT = /import\s*\{[^}]*\bauth\b[^}]*\}\s*from\s*["'](?:@\/lib\/auth|@\/lib\/auth\/index|\.\/index|\.\.?\/(?:lib\/)?auth)["']/

/** The reasons `rel` reads a session it is not allowed to. Empty = fine. */
function violations(rel: string, src: string): string[] {
  if (ALLOWED.has(rel)) return []
  const out: string[] = []
  if (FROM("aws-amplify/auth/server").test(src)) out.push("imports aws-amplify/auth/server")
  if (FROM("next-auth/jwt").test(src)) out.push("imports next-auth/jwt")
  if (AUTH_IMPORT.test(src)) out.push("imports auth() from @/lib/auth")
  if (!INSTANCE.has(rel) && /from\s*["']next-auth(?:\/[^"']*)?["']/.test(src)) out.push("imports next-auth")
  return out
}

describe("one server-side session reader (0330)", () => {
  it("only lib/auth/owner.ts and middleware.ts read a session", () => {
    const found = sources(ROOT).flatMap((file) => {
      const rel = relative(ROOT, file)
      return violations(rel, readFileSync(file, "utf8")).map((why) => `${rel}: ${why}`)
    })
    expect(found).toEqual([])
  })

  it("the two allowed readers do read one (the rule is not vacuous)", () => {
    for (const rel of ALLOWED) {
      const src = readFileSync(join(ROOT, rel), "utf8")
      expect(AUTH_IMPORT.test(src), rel).toBe(true)
    }
  })

  it.each([
    ['import { fetchAuthSession } from "aws-amplify/auth/server"', "imports aws-amplify/auth/server"],
    ['import { auth } from "@/lib/auth"', "imports auth() from @/lib/auth"],
    ['import { handlers, auth } from "@/lib/auth"', "imports auth() from @/lib/auth"],
    ['import { getToken } from "next-auth/jwt"', "imports next-auth/jwt"],
    ['import NextAuth from "next-auth"', "imports next-auth"],
    ['const m = await import("aws-amplify/auth/server")', "imports aws-amplify/auth/server"],
  ])("self-test: fires on %s", (line, why) => {
    expect(violations("lib/somewhere.ts", line)).toContain(why)
  })

  it("self-test: the route handler's `handlers` import is not a session read", () => {
    expect(violations("app/api/authjs/[...nextauth]/route.ts", 'import { handlers } from "@/lib/auth"')).toEqual([])
    expect(violations("lib/x.ts", 'import { currentUserId } from "@/lib/auth/owner"')).toEqual([])
  })
})
