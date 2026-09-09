#!/usr/bin/env node
// DECK.GL CHECK — deck.gl must never enter the dependency tree.
//
// 05-fog-of-war.md §4.6, ticket 0053.
//
// §4.6 exists so "a future session does not rediscover them the expensive way", and
// deck.gl is the entry on that list most likely to be retried, because it is the one
// that is nearly right. R4's verdict: "correct architecture, wrong ergonomics". The
// MaskExtension tests the mask as a BOOLEAN in the masked layer's fragment shader, so
// there is a hard binary edge with no feather parameter, no alpha ramp and no noise
// hook — which is most of what the fog design is. Fixing it means forking deck.gl's
// mask shader module: all the cost of a ~500 KB dependency and all the work of writing
// our own shader anyway. Plus max 4 simultaneous masks and no GlobeView support.
//
// A prose warning in a design document does not survive `npm install @deck.gl/react`
// at 11pm. This does.
//
// It reads the LOCKFILE rather than package.json on purpose: deck.gl arriving as a
// transitive dependency of something else is exactly as fatal to the bundle budget as
// installing it directly, and only the lockfile can see that.
//
// Written in plain node, no dependencies — same reason as check-boundaries.mjs: it runs
// in the GitHub Actions gate, in the Amplify build container, and in a git hook.
//
//   node scripts/check-no-deckgl.mjs              check the lockfile
//   node scripts/check-no-deckgl.mjs --self-test  prove it FAILS on a tree containing deck.gl

import { readFileSync } from "node:fs"

const LOCKFILE = new URL("../package-lock.json", import.meta.url)

/**
 * Matches `deck.gl` and every `@deck.gl/*` scoped package, at any depth of a
 * `node_modules/` path key. Deliberately NOT a bare `includes("deck.gl")`: a package
 * legitimately named something like `maplibre-deck.gl-adapter` should fail too, but a
 * doc or a comment mentioning the string should not be what this reads, and it never
 * looks at anything but dependency names.
 */
const DECK = /(^|\/)(@deck\.gl\/[^/]+|deck\.gl)$/

/** Every dependency name in an npm v2/v3 lockfile, from both shapes it can carry. */
function dependencyNames(lock) {
  const names = new Set()

  // v2/v3: "packages" keyed by path, e.g. "node_modules/@deck.gl/core"
  for (const path of Object.keys(lock.packages ?? {})) {
    if (path === "") continue
    const name = path.split("node_modules/").pop()
    if (name) names.add(name)
  }

  // v1 and the legacy mirror v2 still writes: nested "dependencies"
  const walk = (deps) => {
    for (const [name, entry] of Object.entries(deps ?? {})) {
      names.add(name)
      if (entry && typeof entry === "object") walk(entry.dependencies)
    }
  }
  walk(lock.dependencies)

  return names
}

function offenders(lock) {
  return [...dependencyNames(lock)].filter((name) => DECK.test(name)).sort()
}

function selfTest() {
  const planted = {
    packages: {
      "": { name: "lost-soles" },
      "node_modules/maplibre-gl": { version: "6.6.0" },
      "node_modules/@deck.gl/core": { version: "9.0.0" },
    },
  }
  const found = offenders(planted)
  if (found.length !== 1 || found[0] !== "@deck.gl/core") {
    console.error(
      `SELF-TEST FAILED: planted @deck.gl/core was not detected (found: ${JSON.stringify(found)}).\n` +
        "The check cannot be trusted, because it just passed a tree it should have failed.",
    )
    process.exit(1)
  }
  // And the other direction: a clean tree must not be reported as dirty.
  if (offenders({ packages: { "node_modules/maplibre-gl": {} } }).length !== 0) {
    console.error("SELF-TEST FAILED: a clean tree was reported as containing deck.gl.")
    process.exit(1)
  }
  console.log("check-no-deckgl: self-test passed")
}

if (process.argv.includes("--self-test")) {
  selfTest()
} else {
  const found = offenders(JSON.parse(readFileSync(LOCKFILE, "utf8")))
  if (found.length > 0) {
    console.error(
      `deck.gl is in the dependency tree: ${found.join(", ")}\n\n` +
        "05-fog-of-war.md §4.6 rules it out — the MaskExtension's mask is a boolean in the\n" +
        "fragment shader, so there is no feather, no alpha ramp and no noise hook, and fixing\n" +
        "that means forking its shader module for the price of a ~500 KB dependency.\n" +
        "If this is a considered reversal, supersede §4.6 with a new D-xxx first.",
    )
    process.exit(1)
  }
  console.log("check-no-deckgl: no deck.gl in the dependency tree")
}
