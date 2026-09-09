#!/usr/bin/env node
// THE HOME COORDINATE NEVER REACHES A CLIENT BUNDLE.
//
// Ticket 0053, D-199, 08-security-privacy.md §7.2.
//
// next.config.ts inlines LOST_SOLES_HOME_* at BUILD time, because Amplify's SSR
// compute does not carry the app's environment variables at runtime. Static
// replacement happens wherever the reference appears — so the value would follow a
// client component that read it straight into a publicly served chunk.
//
// Today only lib/map-home.ts reads it and that module is server-only. This is the
// check that keeps "today" true. Without it, next.config.ts's reasoning about why
// the inlining is safe is a comment, and a comment is not a control.
//
// WHY IT MATTERS MORE THAN IT LOOKS. `/` is the signed-out landing route, so a client
// chunk is fetchable by anyone who finds the site — no session required. The value is
// the operator's neighbourhood. 08 §7.2's whole point is that this repository and its
// public artefacts are the one place that must not go, and §7.2 records that the rule
// was already broken once, in good faith, by someone being helpful.
//
// This scans BUILT OUTPUT, which is a different surface from
// check-fixture-geography.mjs (committed fixtures) and check-bundle-leak.mjs (secret
// literals, minimum 12 characters — a coordinate is too short for it to scan without
// producing noise). Hence a third, narrow check rather than an entry in an existing one.
//
// IT NEVER PRINTS THE COORDINATE. A leak detector that echoes the leak into a public
// CI log is the bug it is looking for; findings name the variable and the file.
//
//   node scripts/check-home-not-in-client.mjs              scan .next/static
//   node scripts/check-home-not-in-client.mjs --self-test  prove it FAILS on a planted value

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
const CLIENT_DIR = join(ROOT, ".next", "static")
const KEYS = ["LOST_SOLES_HOME_LAT", "LOST_SOLES_HOME_LNG"]

function filesUnder(dir) {
  const out = []
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(full)
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

/** [{ key, file }] for every client file containing a configured value. */
export function findLeaks(files, values, read = (f) => readFileSync(f, "utf8")) {
  const hits = []
  for (const file of files) {
    let text
    try {
      text = read(file)
    } catch {
      continue // a binary asset that is not valid UTF-8 cannot carry a decimal literal
    }
    for (const { key, value } of values) {
      if (text.includes(value)) hits.push({ key, file })
    }
  }
  return hits
}

if (process.argv.includes("--self-test")) {
  const planted = findLeaks(
    ["chunk-a.js", "chunk-b.js"],
    [{ key: "LOST_SOLES_HOME_LAT", value: "12.3456" }],
    (f) => (f === "chunk-b.js" ? 'const c=[12.3456,-9.8765]' : "const x=1"),
  )
  if (planted.length !== 1 || planted[0].file !== "chunk-b.js") {
    console.error(`SELF-TEST FAILED: planted coordinate not detected (${JSON.stringify(planted)}).`)
    process.exit(1)
  }
  if (findLeaks(["c.js"], [{ key: "K", value: "12.3456" }], () => "nothing here").length !== 0) {
    console.error("SELF-TEST FAILED: a clean bundle was reported as leaking.")
    process.exit(1)
  }
  console.log("check-home-not-in-client: self-test passed")
} else {
  const values = KEYS.map((key) => ({ key, value: process.env[key] })).filter(
    ({ value }) => typeof value === "string" && value.trim() !== "",
  )

  // "Could not check" must never read as "checked" — the same rule D-225 applies to the
  // invariant ratchet. A missing variable here is a legitimate state (the map falls back
  // to the extract-wide view), so this is a report, not a failure.
  if (values.length === 0) {
    console.log(
      "check-home-not-in-client: LOST_SOLES_HOME_LAT/LNG are not set in this environment, " +
        "so there is no value to scan for. NOT a pass — nothing was checked.",
    )
    process.exit(0)
  }

  if (!existsSync(CLIENT_DIR)) {
    console.error(`check-home-not-in-client: ${relative(ROOT, CLIENT_DIR)} does not exist. Run after the build.`)
    process.exit(1)
  }

  const hits = findLeaks(filesUnder(CLIENT_DIR), values)
  if (hits.length > 0) {
    console.error(
      "The home coordinate reached a CLIENT bundle:\n" +
        hits.map((h) => `  ${h.key} in ${relative(ROOT, h.file)}`).join("\n") +
        "\n\n.next/static is served to anyone who loads the site, signed in or not, and `/`\n" +
        "is the signed-out landing route. Something now reads LOST_SOLES_HOME_* from a\n" +
        "CLIENT component; next.config.ts's build-time inlining follows that reference.\n" +
        "Move the read back behind the server (lib/map-home.ts). See D-199, 08 §7.2.",
    )
    process.exit(1)
  }
  console.log(`check-home-not-in-client: ${values.length} value(s) scanned, none in .next/static`)
}
