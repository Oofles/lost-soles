import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * D-472, ticket `0331`: APPSYNC IS NOT A CLIENT-FACING API. The browser talks only to its own origin.
 *
 * No file under `app/`, `components/` or `lib/` may import `aws-amplify/data`, statically, with a
 * dynamic `import()`, or as a `typeof import(…)` type. A grep and not an ESLint rule, because the
 * transports this replaced used the dynamic and the type forms, and `no-restricted-imports` sees
 * neither. The schema type (`@/amplify/data/resource`) is not the client and is not matched.
 */

const ROOT = join(import.meta.dirname, "..", "..")
const DIRS = ["app", "components", "lib"]
const SELF = relative(ROOT, import.meta.filename)

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" || name === "__fixtures__" ? [] : files(path)
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [path] : []
  })
}

describe("no browser path to AppSync (D-472)", () => {
  it("no module under app/, components/ or lib/ names aws-amplify/data", () => {
    const offenders = DIRS.flatMap((d) => files(join(ROOT, d)))
      .map((p) => relative(ROOT, p))
      .filter((p) => p !== SELF)
      .filter((p) => readFileSync(join(ROOT, p), "utf8").includes("aws-amplify/data"))
    expect(offenders).toEqual([])
  })
})
