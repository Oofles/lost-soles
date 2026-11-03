import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * D-473, ticket `0332`, criterion 1: COGNITO HAS NO CLIENT OR SESSION PATH LEFT.
 *
 * No file under `app/`, `components/` or `lib/`, and not `middleware.ts`, may import
 * `aws-amplify/auth` (the Authenticator's session, `getCurrentUser`, `signOut`, and the server
 * `fetchAuthSession`), `@aws-amplify/ui-react` (the Authenticator) or `@aws-amplify/adapter-nextjs`
 * (the server runner that read the Cognito cookie). Statically, with a dynamic `import()`, or as a
 * `typeof import(…)` type: a grep, like `lib/http/no-appsync-in-browser.test.ts`, because
 * `no-restricted-imports` sees neither of the last two. Test files are skipped, as in
 * `lib/auth/session-readers.test.ts`: their self-tests name these modules on purpose.
 *
 * Cognito's pool and `defineAuth` stay until `0334`; nothing here reads them.
 */

const ROOT = join(import.meta.dirname, "..", "..")
const DIRS = ["app", "components", "lib"]
const FORBIDDEN = ["aws-amplify/auth", "@aws-amplify/ui-react", "@aws-amplify/adapter-nextjs"]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "__fixtures__" ? [] : files(path)
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

/** `mod` named as a module specifier: in quotes, optionally with a subpath. */
const names = (src: string, mod: string) =>
  new RegExp(`["']${mod.replace(/[/.@-]/g, "\\$&")}(?:/[^"']*)?["']`).test(src)

describe("no Cognito client or session path (D-473)", () => {
  it("no module under app/, components/, lib/ or middleware.ts names a Cognito client package", () => {
    const offenders = [...DIRS.flatMap((d) => files(join(ROOT, d))), join(ROOT, "middleware.ts")]
      .map((p) => relative(ROOT, p))
      .flatMap((p) => {
        const src = readFileSync(join(ROOT, p), "utf8")
        return FORBIDDEN.filter((m) => names(src, m)).map((m) => `${p}: ${m}`)
      })
    expect(offenders).toEqual([])
  })

  it.each([
    ['import { signOut } from "aws-amplify/auth"', "aws-amplify/auth"],
    ['const { getCurrentUser } = await import("aws-amplify/auth")', "aws-amplify/auth"],
    ['import { fetchAuthSession } from "aws-amplify/auth/server"', "aws-amplify/auth"],
    ['import { Authenticator } from "@aws-amplify/ui-react"', "@aws-amplify/ui-react"],
    ['import "@aws-amplify/ui-react/styles.css"', "@aws-amplify/ui-react"],
    ['import { createServerRunner } from "@aws-amplify/adapter-nextjs"', "@aws-amplify/adapter-nextjs"],
  ])("self-test: fires on %s", (line, mod) => {
    expect(names(line, mod)).toBe(true)
  })

  it("self-test: does not fire on a mention in prose or on aws-amplify/authx", () => {
    expect(names("// the aws-amplify/auth session is gone", "aws-amplify/auth")).toBe(false)
    expect(names('import x from "aws-amplify/authx"', "aws-amplify/auth")).toBe(false)
  })
})
