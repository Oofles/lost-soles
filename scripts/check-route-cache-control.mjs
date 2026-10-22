#!/usr/bin/env node
// ROUTE CACHE-CONTROL CHECK: every authed response is `private, no-store`.
//
// docs/08-security-privacy.md §2.4 TRIGGER C, item C-3. Ticket 0114.
//
// "A shared CDN cache in front of a per-user map is a cross-user disclosure waiting for a
// second account." The app sits behind CloudFront, and every route under app/ describes one
// person's data. If one of them is cacheable by a shared cache, the second account to sign in
// can be served the first one's map from the edge.
//
// The header itself is set in ONE place, `lib/http/no-store.ts` `withNoStore`, on whatever a
// handler returns (404s, 304s and redirects included). This check proves every route goes
// through it. It reads source, not a running server, because a signed-out request to a running
// server never reaches a handler (middleware 404s it), and a signed-in one needs a session CI
// does not hold.
//
// The rules, per app/**/route.ts:
//   1. No HTTP method is exported as a bare function. Each is `export const M = withNoStore(...)`.
//   2. Every exported method goes through `withNoStore`.
//   3. No `public`, `s-maxage` or `stale-while-revalidate` cache directive, and no ISR
//      `revalidate` export. Those are the shapes a shared cache stores.
//   4. D-228's carve-out (`IMMUTABLE_PRIVATE`) appears only in the two routes it names.
//      The literal value appears only in lib/http/no-store.ts.
//
// Plain node, no dependencies: it runs in the GitHub Actions gate and the Amplify build.
//
//   node scripts/check-route-cache-control.mjs              check app/
//   node scripts/check-route-cache-control.mjs --self-test  prove each rule FIRES

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

/** D-228 and `0100`: generation-named, immutable, still `private`. Nothing else. */
export const CARVE_OUT = new Set([
  "app/api/fog/blob/[gen]/route.ts",
  "app/api/fog/lastrun/[gen]/route.ts",
])

/** Rules 1-4 over one file. Returns failure strings; [] means the file is fine. */
export function violations(rel, src) {
  const out = []
  const bare = new RegExp(`^\\s*export\\s+(?:async\\s+)?function\\s+(${METHODS.join("|")})\\b`, "gm")
  for (const m of src.matchAll(bare)) {
    out.push(`${rel}: \`export function ${m[1]}\` bypasses withNoStore. Write \`export const ${m[1]} = withNoStore(handler)\``)
  }
  const named = new RegExp(`^\\s*export\\s+(?:const|let|var)\\s+(${METHODS.join("|")})\\s*=\\s*(.*)$`, "gm")
  for (const m of src.matchAll(named)) {
    if (!/^withNoStore\(/.test(m[2].trim())) {
      out.push(`${rel}: \`export const ${m[1]}\` is not wrapped in withNoStore`)
    }
  }
  const reexport = new RegExp(`export\\s*\\{[^}]*\\b(${METHODS.join("|")})\\b[^}]*\\}`, "g")
  for (const m of src.matchAll(reexport)) {
    out.push(`${rel}: re-exports ${m[1]}, which this check cannot follow. Wrap it in this file`)
  }
  if (/["'`][^"'`\n]*\b(public|s-maxage|stale-while-revalidate)\b[^"'`\n]*["'`]/i.test(stripComments(src))) {
    out.push(`${rel}: sets a shared-cacheable directive (public / s-maxage / stale-while-revalidate)`)
  }
  if (/^\s*export\s+const\s+revalidate\s*=/m.test(src)) {
    out.push(`${rel}: exports \`revalidate\`. An ISR route is a statically rendered one (C-2)`)
  }
  if (/force-static/.test(stripComments(src))) {
    out.push(`${rel}: is \`force-static\`. A static route handler is a public file on a CDN (C-2)`)
  }
  if (/\bIMMUTABLE_PRIVATE\b/.test(stripComments(src)) && !CARVE_OUT.has(rel)) {
    out.push(`${rel}: uses D-228's IMMUTABLE_PRIVATE carve-out, which is only for ${[...CARVE_OUT].join(", ")}`)
  }
  if (/max-age=\d+|immutable/.test(stripComments(src).replace(/IMMUTABLE_PRIVATE/g, ""))) {
    out.push(`${rel}: spells a cache lifetime by hand. Use NO_STORE or (carve-out only) IMMUTABLE_PRIVATE`)
  }
  return out
}

/** Comments may discuss `public` and `max-age` freely. Only code is checked. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
}

function routeFiles(dir) {
  const found = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) found.push(...routeFiles(p))
    else if (/^route\.(ts|tsx|js|mjs)$/.test(name)) found.push(p)
  }
  return found
}

function selfTest() {
  const good = 'import { withNoStore } from "@/lib/http/no-store"\nasync function h() {}\nexport const GET = withNoStore(h)\n'
  const cases = [
    ["bare export", "export async function GET() {}\n"],
    ["unwrapped const", "export const POST = handler\n"],
    ["re-export", 'export { GET } from "./other"\n'],
    ["public directive", good + 'const x = { "Cache-Control": "public, max-age=60" }\n'],
    ["s-maxage", good + "const x = 's-maxage=60'\n"],
    ["revalidate export", good + "export const revalidate = 60\n"],
    ["force-static", good + 'export const dynamic = "force-static"\n'],
    ["carve-out outside its routes", good + "const h2 = { 'Cache-Control': IMMUTABLE_PRIVATE }\n"],
    ["hand-spelled lifetime", good + "const h2 = { 'Cache-Control': 'private, max-age=31536000, immutable' }\n"],
  ]
  for (const [name, src] of cases) {
    if (violations("app/api/x/route.ts", src).length === 0) {
      console.error(`SELF-TEST FAILED: "${name}" was not detected. The check cannot be trusted.`)
      process.exit(1)
    }
  }
  const clean = [
    ["wrapped", good],
    ["comment mentions public", good + "// a public cache would be bad; max-age=1 is wrong too\n"],
  ]
  for (const [name, src] of clean) {
    const v = violations("app/api/x/route.ts", src)
    if (v.length) {
      console.error(`SELF-TEST FAILED: clean case "${name}" was reported: ${v.join("; ")}`)
      process.exit(1)
    }
  }
  const carve = good + "const h2 = { 'Cache-Control': IMMUTABLE_PRIVATE }\n"
  if (violations("app/api/fog/blob/[gen]/route.ts", carve).length) {
    console.error("SELF-TEST FAILED: D-228's carve-out was refused in a route it names.")
    process.exit(1)
  }
  console.log(`check-route-cache-control: self-test passed (${cases.length} planted violations caught)`)
}

if (process.argv.includes("--self-test")) {
  selfTest()
} else {
  const files = routeFiles(join(ROOT, "app"))
  // D-176: a scan of nothing is not a pass. app/ has had route handlers since 0018.
  if (files.length === 0) {
    console.error("check-route-cache-control: found NO route files under app/. Refusing to report a pass.")
    process.exit(1)
  }
  const all = files.flatMap((p) => violations(relative(ROOT, p), readFileSync(p, "utf8")))
  if (all.length) {
    console.error(
      `${all.join("\n")}\n\n` +
        "08-security-privacy.md §2.4, TRIGGER C, C-3: every authed response is `private, no-store`.\n" +
        "A shared CDN cache in front of a per-user map is a cross-user disclosure. Wrap the handler\n" +
        "in withNoStore (lib/http/no-store.ts). If this route really must be cacheable or public,\n" +
        "that is TRIGGER C: D-123 is reopened and a decision recorded before it merges.",
    )
    process.exit(1)
  }
  console.log(`check-route-cache-control: ${files.length} route files, every handler wrapped in withNoStore`)
}
