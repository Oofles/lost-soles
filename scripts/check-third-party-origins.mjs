#!/usr/bin/env node
// THIRD-PARTY ORIGINS CHECK: the built app names no origin it could request at runtime except its own.
//
// docs/06-ui-ux.md §9.5, ticket 0113: "No third-party requests at runtime. Fonts are self-hosted;
// there is no analytics, no tag manager, no font CDN." Each of those is a slow-connection failure
// mode bought for nothing. This runs AFTER `next build`, over what the build produced.
//
// FIRST-PARTY means this project's own infrastructure: the app's origin (lib/app-origin.ts) and every
// endpoint amplify_outputs.json names — AppSync, the basemap tiles distribution, the queue URLs. Those
// are AWS hostnames, but they are this account's resources, not someone else's service. Amplify also
// builds Cognito's endpoint at runtime (cognito-idp.<region>.amazonaws.com) from the region, so it is
// never a literal here; it is the same kind of origin.
//
// Two halves, with different strictness:
//
//   1. REQUEST POSITIONS, NO EXCEPTIONS. A CSS `url(...)` or `@import`, an HTML `<script src>`,
//      `<link href>`, `<img src>`, `<iframe src>`, `<source src>`, and a JS `fetch("…")`,
//      `new WebSocket("…")`, `new EventSource("…")` or `importScripts("…")` naming a third-party
//      host. Nothing on the link allowlist below excuses one of these.
//
//   2. EVERY ABSOLUTE HOST IN THE CLIENT BUNDLE. A URL a bundle carries as a string is a URL some
//      code path can request, and a scan cannot see how a string is later used. So every host must
//      be first-party or on LINK_ONLY_HOSTS, each with the reason it is never fetched. A NEW third-
//      party host fails the build until someone writes that reason down — which is the point: a font
//      CDN or an analytics beacon arrives as exactly such a string.
//
// Dotless hosts (`new URL(x, "http://n")`, core-js's `https://a`) are base-URL idioms that resolve
// nothing over the network, and are ignored.
//
// Fails closed (D-176): no build, no static files or no first-party origin is exit 1.
//
//   node scripts/check-third-party-origins.mjs              check .next
//   node scripts/check-third-party-origins.mjs --self-test  prove both halves FIRE

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")

/** Hosts a bundle names that the browser never requests, and why. Links and identifiers only. */
export const LINK_ONLY_HOSTS = new Map([
  ["www.w3.org", "XML/SVG namespace URIs (createElementNS); identifiers, never fetched"],
  ["nextjs.org", "Next.js error-message documentation links"],
  ["react.dev", "React error-message documentation links"],
  ["github.com", "library error messages and licence notices; the settings page's runbook <a href>"],
  ["docs.amplify.aws", "Amplify error-message documentation links"],
  ["aws-amplify.github.io", "Amplify error-message documentation links"],
  ["wiki.openstreetmap.org", "MapLibre's no-WebGL error message"],
  ["maplibre.org", "MapLibre's attribution <a href>"],
  ["protomaps.com", "basemap attribution <a href>, required by the licence"],
  ["openstreetmap.org", "ODbL attribution <a href>, required by the licence"],
])

/** `scheme://host` where host has at least one dot. */
const ABSOLUTE = /\b(?:https?|wss?):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi

/** Request-bearing positions. Group 1 is the URL. */
const REQUEST_POSITIONS = {
  css: [/url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/gi, /@import\s+(?:url\(\s*)?["']?((?:https?:)?\/\/[^"')\s;]+)/gi],
  html: [/<(?:script|img|iframe|source|embed|video|audio)\b[^>]*?\bsrc\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi, /<link\b[^>]*?\bhref\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi],
  js: [/\b(?:fetch|importScripts)\(\s*["'`]((?:https?:|wss?:)?\/\/[^"'`]+)/g, /\bnew\s+(?:WebSocket|EventSource)\(\s*["'`]((?:https?:|wss?:)?\/\/[^"'`]+)/g],
}

function hostOf(url) {
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url).host.toLowerCase()
  } catch {
    return null
  }
}

/** The app origin and every URL host in amplify_outputs.json. */
export function firstPartyHosts(root = ROOT) {
  const hosts = new Set()
  const origin = /APP_ORIGIN\s*=\s*"([^"]+)"/.exec(readFileSync(join(root, "lib/app-origin.ts"), "utf8"))?.[1]
  if (origin) hosts.add(new URL(origin).host)
  const outputsPath = join(root, "amplify_outputs.json")
  if (existsSync(outputsPath)) {
    const visit = (v) => {
      if (typeof v === "string") {
        for (const m of v.matchAll(ABSOLUTE)) hosts.add(m[1].toLowerCase())
      } else if (v && typeof v === "object") Object.values(v).forEach(visit)
    }
    visit(JSON.parse(readFileSync(outputsPath, "utf8")))
  }
  return hosts
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

/** Scan one file's text. Returns failure strings. */
export function scanText(text, kind, firstParty, label) {
  const failures = []
  for (const re of REQUEST_POSITIONS[kind] ?? []) {
    for (const m of text.matchAll(re)) {
      const host = hostOf(m[1])
      if (host && host.includes(".") && !firstParty.has(host)) {
        failures.push(`${label}: requests ${m[1].slice(0, 120)} — a third-party origin in a request position`)
      }
    }
  }
  for (const m of text.matchAll(ABSOLUTE)) {
    const host = m[1].toLowerCase()
    if (!firstParty.has(host) && !LINK_ONLY_HOSTS.has(host)) {
      failures.push(`${label}: names ${host}, which is neither first-party nor on LINK_ONLY_HOSTS`)
    }
  }
  return failures
}

/** Runs both halves over a `.next` directory. */
export function check(nextDir, firstParty) {
  const failures = []
  if (firstParty.size === 0) failures.push("no first-party origin could be read. This is not a pass")
  const staticDir = join(nextDir, "static")
  const appDir = join(nextDir, "server", "app")
  const files = [
    ...(existsSync(staticDir) ? walk(staticDir).filter((p) => /\.(js|css)$/.test(p)) : []),
    ...(existsSync(appDir) ? walk(appDir).filter((p) => /\.html$/.test(p)) : []),
  ]
  if (!files.some((p) => p.endsWith(".js"))) {
    failures.push(`${relative(ROOT, staticDir)} has no scripts to scan. Run \`npm run build\` first; this is not a pass`)
  }
  const seen = new Set()
  for (const file of files) {
    const kind = file.endsWith(".css") ? "css" : file.endsWith(".html") ? "html" : "js"
    for (const f of scanText(readFileSync(file, "utf8"), kind, firstParty, relative(nextDir, file))) {
      // One line per file and host is enough to act on; a minified chunk repeats a URL dozens of times.
      if (!seen.has(f)) {
        seen.add(f)
        failures.push(f)
      }
    }
  }
  return { scanned: files.length, failures }
}

function selfTest() {
  const fp = new Set(["soles.example.com", "d123.cloudfront.net"])
  const fixture = (files) => {
    const dir = mkdtempSync(join(tmpdir(), "third-party-check-"))
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), text)
    }
    return dir
  }
  const clean = {
    "static/chunks/a.js":
      'fetch("/api/fog/update");const t="https://d123.cloudfront.net/b.pmtiles";' +
      'document.createElementNS("http://www.w3.org/2000/svg","svg");new URL(p,"http://n");' +
      'const a=\'<a href="https://openstreetmap.org/copyright">OSM</a>\'',
    "static/css/a.css": '@font-face{src:url(/_next/static/media/inter.woff2)}',
    "server/app/log.html": '<script src="/_next/static/chunks/a.js"></script><a href="https://github.com/x">x</a>',
  }
  const cases = [
    ["a clean build", clean, 0],
    ["a font CDN in CSS", { ...clean, "static/css/b.css": "@import url(https://fonts.googleapis.com/css2?family=Inter);" }, 2],
    ["a font file from a CDN", { ...clean, "static/css/b.css": "@font-face{src:url(//fonts.gstatic.com/s/inter.woff2)}" }, 1],
    ["an analytics beacon in JS", { ...clean, "static/chunks/b.js": 'fetch("https://www.google-analytics.com/collect")' }, 2],
    ["a tag manager script tag", { ...clean, "server/app/skills.html": '<script src="https://www.googletagmanager.com/gtm.js"></script>' }, 2],
    ["a link-only host in a request position", { ...clean, "static/chunks/b.js": 'fetch("https://github.com/x.json")' }, 1],
    ["a websocket to a third party", { ...clean, "static/chunks/b.js": 'new WebSocket("wss://push.example.org/s")' }, 2],
  ]
  let ok = true
  for (const [name, files, want] of cases) {
    const dir = fixture(files)
    try {
      const { failures } = check(dir, fp)
      const pass = want === 0 ? failures.length === 0 : failures.length === want
      console.log(`${pass ? "ok  " : "FAIL"} ${name}: ${failures.length} failure(s)${pass ? "" : ` (wanted ${want})\n  ${failures.join("\n  ")}`}`)
      ok &&= pass
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const empty = fixture({ "static/css/a.css": "" })
  try {
    const { failures } = check(empty, fp)
    const pass = failures.some((f) => /no scripts to scan/.test(f))
    console.log(`${pass ? "ok  " : "FAIL"} an empty build fails closed`)
    ok &&= pass
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
  const cleanDir = fixture(clean)
  const noOrigin = check(cleanDir, new Set())
  rmSync(cleanDir, { recursive: true, force: true })
  const failsWithoutOrigin = noOrigin.failures.some((f) => /no first-party origin/.test(f))
  console.log(`${failsWithoutOrigin ? "ok  " : "FAIL"} no first-party origin fails closed`)
  ok &&= failsWithoutOrigin
  if (!ok) process.exit(1)
  console.log("check-third-party-origins self-test: every case behaved")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--self-test")) {
    selfTest()
  } else {
    const firstParty = firstPartyHosts()
    const { scanned, failures } = check(join(ROOT, ".next"), firstParty)
    if (failures.length) {
      console.error(`check-third-party-origins: ${failures.length} failure(s) over ${scanned} files`)
      for (const f of failures) console.error(`  ${f}`)
      console.error("06 §9.5: no third-party requests at runtime. A host that is only ever a link goes on LINK_ONLY_HOSTS with its reason.")
      process.exit(1)
    }
    console.log(`check-third-party-origins: ${scanned} files, first-party ${[...firstParty].sort().join(", ")}. No third-party origin.`)
  }
}
