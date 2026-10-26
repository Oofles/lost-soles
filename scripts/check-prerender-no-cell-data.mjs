#!/usr/bin/env node
// PRERENDER CHECK: no statically rendered page, and no static asset, carries cell or trace data.
//
// docs/08-security-privacy.md §2.4 TRIGGER C, item C-2. Ticket 0114.
//
// A page rendered at build time is a static file on a CDN. Amplify serves it to anyone who can
// reach the edge, cached. "No page containing cell data may be statically rendered." The explored
// set is fetched client-side from an authed route, or rendered per-request with the session in
// hand. This check runs AFTER `next build`, over what the build actually produced.
//
// Two halves:
//
//   1. THE PRERENDERED ROUTE SET IS AN ALLOWLIST. Every route in .next/prerender-manifest.json
//      must be one of the routes below, each of which renders from committed, user-independent
//      data (skill definitions, a static form, a stub). A NEW static route fails until someone
//      adds it here, and that line is where it gets asked whether the page shows anyone's map.
//      A denylist could not do this, because it would have to predict the new page.
//
//   2. THE OUTPUT IS SCANNED FOR DATA SHAPES. Every prerendered body (.html/.rsc/.body) and
//      every file under .next/static is searched for the shapes cell and trace data take on the
//      wire: an H3 cell index, a [lat, lng] pair at GPS precision, a `latlng` array. Prerendered
//      bodies are also searched for the field names a run or a cell carries, and for the binary
//      blob magic. Those field names appear in client CODE legitimately, so they are not
//      searched for in .next/static.
//
// Fails closed (D-176): no build, no manifest, an empty route list or no static files is exit 1.
//
//   node scripts/check-prerender-no-cell-data.mjs              check .next
//   node scripts/check-prerender-no-cell-data.mjs --self-test  prove each half FIRES

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/**
 * The routes allowed to be prerendered, as the manifest names them, and why each is safe.
 * `[param]` matches one path segment.
 */
export const ALLOWED_STATIC = new Map([
  ["/_not-found", "Next's own 404 page"],
  ["/skills", "renders null; the panel is layout.tsx, static by D-282 with no session read"],
  ["/skills/[skillId]", "generateStaticParams over committed skill DEFINITIONS; XP is fetched client-side"],
  ["/log", "the manual-log form; no stored data is rendered into it"],
])

/** Shapes that are DATA wherever they appear, code included. */
export const DATA_SHAPES = [
  // A res 0-15 H3 cell index as hex: mode 1 => leading 8, 15 hex digits. `RES` is 11 (D-237).
  { name: "H3 cell index", re: /\b8[0-9a-f]{14}\b/ },
  // [lat, lng] or [lng, lat] at GPS precision (5+ decimals is ~1 m).
  { name: "coordinate pair", re: /\[\s*-?\d{1,3}\.\d{5,}\s*,\s*-?\d{1,3}\.\d{5,}\s*\]/ },
  { name: "latlng stream", re: /["']?latlng["']?\s*:\s*\[\s*\[/ },
]

/** Shapes that are data in a RENDERED PAGE, but appear in client code legitimately. */
export const PAGE_ONLY_SHAPES = [
  { name: "run or cell timestamp field", re: /\b(firstRunAt|lastRunAt|startedAt)\b/ },
  { name: "latlng field", re: /\blatlng\b/ },
  { name: "explored-set blob magic", re: /LSF[GDL]/ },
  { name: "explored-set object key", re: /explored-r\d+\./ },
]

function segmentsMatch(pattern, route) {
  const p = pattern.split("/")
  const r = route.split("/")
  return p.length === r.length && p.every((seg, i) => (/^\[.+\]$/.test(seg) ? r[i] !== "" : seg === r[i]))
}

export function unexpectedRoutes(routes) {
  return routes.filter((r) => ![...ALLOWED_STATIC.keys()].some((p) => segmentsMatch(p, r)))
}

export function findShapes(text, shapes) {
  return shapes.filter((s) => s.re.test(text)).map((s) => s.name)
}

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

/** Runs both halves over a `.next` directory. Returns { routes, failures }. */
export function check(nextDir) {
  const failures = []
  const manifestPath = join(nextDir, "prerender-manifest.json")
  if (!existsSync(manifestPath)) {
    return { routes: [], failures: [`${manifestPath} does not exist. Run \`npm run build\` first; this is not a pass`] }
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const routes = Object.keys(manifest.routes ?? {}).sort()
  const dynamicRoutes = Object.keys(manifest.dynamicRoutes ?? {}).sort()
  if (routes.length === 0) {
    failures.push("prerender-manifest.json lists NO routes. Next always prerenders /_not-found, so this manifest is not one this check understands")
  }
  for (const r of unexpectedRoutes([...routes, ...dynamicRoutes])) {
    failures.push(`${r} is statically rendered and is not on the C-2 allowlist`)
  }

  const appDir = join(nextDir, "server", "app")
  for (const route of routes) {
    const base = route === "/" ? "index" : route.replace(/^\//, "")
    const bodies = [".html", ".rsc", ".body"].map((ext) => join(appDir, base + ext)).filter(existsSync)
    if (bodies.length === 0) {
      failures.push(`${route} is in the manifest but none of its prerendered bodies was found under ${relative(ROOT, appDir)}`)
    }
    for (const body of bodies) {
      const hits = findShapes(readFileSync(body, "utf8"), [...DATA_SHAPES, ...PAGE_ONLY_SHAPES])
      if (hits.length) failures.push(`${relative(nextDir, body)} (prerendered ${route}) contains: ${hits.join(", ")}`)
    }
  }

  const staticDir = join(nextDir, "static")
  const staticFiles = existsSync(staticDir) ? walk(staticDir).filter((p) => /\.(js|json|html|txt|css|rsc)$/.test(p)) : []
  if (staticFiles.length === 0) failures.push(`${relative(ROOT, staticDir)} has no files to scan. This is not a pass`)
  for (const file of staticFiles) {
    const hits = findShapes(readFileSync(file, "utf8"), DATA_SHAPES)
    if (hits.length) failures.push(`${relative(nextDir, file)} contains: ${hits.join(", ")}`)
  }
  return { routes, dynamicRoutes, scanned: staticFiles.length, failures }
}

function selfTest() {
  const fixture = (routes, files) => {
    const dir = mkdtempSync(join(tmpdir(), "prerender-check-"))
    writeFileSync(join(dir, "prerender-manifest.json"), JSON.stringify({ routes: Object.fromEntries(routes.map((r) => [r, {}])), dynamicRoutes: {} }))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return dir
  }
  const clean = { "server/app/_not-found.html": "<html>404</html>", "static/chunks/a.js": 'let a="LSFG";function f(x){return x.latlng}' }
  const cases = [
    ["unlisted static route", ["/_not-found", "/map"], { ...clean, "server/app/map.html": "<html></html>" }],
    ["H3 index in a page", ["/_not-found"], { ...clean, "server/app/_not-found.html": "<p>8b2a1072b59ffff</p>" }],
    ["coordinate pair in a page", ["/_not-found"], { ...clean, "server/app/_not-found.rsc": "[-48.876123,-123.393456]" }],
    ["timestamp field in a page", ["/_not-found"], { ...clean, "server/app/_not-found.rsc": '{"lastRunAt":1}' }],
    ["coordinate pair in a static chunk", ["/_not-found"], { ...clean, "static/chunks/b.js": "const t=[[-48.876123,-123.393456]]" }],
    ["latlng stream in a static chunk", ["/_not-found"], { ...clean, "static/chunks/b.js": '{"latlng":[[1,2]]}' }],
    ["no prerendered body", ["/_not-found", "/log"], clean],
    ["empty manifest", [], clean],
    ["no static files", ["/_not-found"], { "server/app/_not-found.html": "x" }],
  ]
  for (const [name, routes, files] of cases) {
    const dir = fixture(routes, files)
    const { failures } = check(dir)
    rmSync(dir, { recursive: true, force: true })
    if (failures.length === 0) {
      console.error(`SELF-TEST FAILED: "${name}" passed. The check cannot be trusted.`)
      process.exit(1)
    }
  }
  const dir = fixture(["/_not-found", "/skills/wayfaring"], { ...clean, "server/app/skills/wayfaring.html": "<h1>Wayfaring</h1>" })
  const { failures } = check(dir)
  rmSync(dir, { recursive: true, force: true })
  if (failures.length) {
    console.error(`SELF-TEST FAILED: a clean build was reported: ${failures.join("; ")}`)
    process.exit(1)
  }
  const missing = check(join(tmpdir(), "prerender-check-does-not-exist"))
  if (missing.failures.length === 0) {
    console.error("SELF-TEST FAILED: a missing build passed.")
    process.exit(1)
  }
  console.log(`check-prerender-no-cell-data: self-test passed (${cases.length + 1} planted failures caught)`)
}

if (process.argv.includes("--self-test")) {
  selfTest()
} else {
  const { routes, dynamicRoutes, scanned, failures } = check(join(ROOT, ".next"))
  console.log("prerendered routes:")
  for (const r of routes) console.log(`  ${r}`)
  for (const r of dynamicRoutes ?? []) console.log(`  ${r}  (generateStaticParams)`)
  if (failures.length) {
    console.error(
      `\n${failures.map((f) => `  ${f}`).join("\n")}\n\n` +
        "08-security-privacy.md §2.4, TRIGGER C, C-2: no page containing cell data may be statically\n" +
        "rendered. A prerendered page is a static file on a CDN, served without a session. Fetch the\n" +
        "data client-side from an authed route, or render the page per request (`dynamic`). If a\n" +
        "new static route really carries no user data, add it to ALLOWED_STATIC with the reason.\n" +
        "If it does carry user data, that is TRIGGER C: D-123 is reopened before it merges.",
    )
    process.exit(1)
  }
  console.log(`\ncheck-prerender-no-cell-data: ${routes.length} prerendered routes on the allowlist, none carries cell or trace data; ${scanned} static files scanned`)
}
