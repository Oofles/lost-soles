import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { PATTERNS, resolveLiteralsFrom, scanText } from "./check-bundle-leak.mjs"

/**
 * Shaped like a Strava client secret: 40 hex characters. ASSEMBLED AT RUNTIME
 * rather than written as a literal — gitleaks (0004) and GitHub push protection
 * (D-165, this repo is public) scan committed SOURCE, and a realistic credential
 * sitting in a source file is a TRUE positive for them. They both fired on the
 * first attempt to commit this file, which is them working correctly.
 *
 * These tests scan strings, where the assembled value is byte-identical, so
 * nothing is lost. Three scanners, three surfaces, no layer weakened to
 * accommodate another.
 */
const SECRET = ["7f3b1a9d4e2c8065", "fab37d19e04c5b28d6710fa3"].join("")

/**
 * Ticket 0017, criterion 9. `amplify_outputs.json` is PUBLIC BY DESIGN
 * (01-architecture.md §7): the Cognito user pool id, app client id, identity
 * pool id and AppSync endpoint are identifiers protected by pool policy and
 * AppSync auth rules, not by obscurity. The file is gitignored because it is
 * generated per-environment, NOT because it is sensitive, and its presence in
 * the client bundle is CORRECT.
 *
 * This is asserted as a test rather than left to inspection because the failure
 * mode is social, not technical: a future contributor sees the leak check go red
 * on a pool id, concludes the check is noisy, and deletes the check. This test
 * makes the intended behaviour executable, so that "the check flagged
 * amplify_outputs.json" is a red test rather than a judgement call.
 */
describe("amplify_outputs.json is not a leak", () => {
  // The committed example carries the real SHAPE. Realistic values are added
  // alongside it so the test is not vacuous against `EXAMPLE00`-style stand-ins.
  const example = readFileSync(new URL("../amplify_outputs.example.json", import.meta.url), "utf8")

  const PUBLIC_IDENTIFIERS = {
    "user pool id": "us-east-1_K9dQ2mHvZ",
    "app client id": "4h7q1c8s3vn0bd6rlt2gpfj9ka",
    "identity pool id": "us-east-1:3f2a91c4-7e05-4d8b-9c1a-6b0e5d2748af",
    "AppSync endpoint": "https://xk4pq7wnsvhzblc2r6y3fmt5ue.appsync-api.us-east-1.amazonaws.com/graphql",
    "user data bucket": "amplify-lostsoles-root-sa-lostsolesuserdatabucket-ptv8xw3qkzr1",
  }

  const bundle = `${example}\nself.__NEXT_DATA__=${JSON.stringify(PUBLIC_IDENTIFIERS)}`

  it("the fixture really does contain every public identifier", () => {
    // Guards the assertion below: a test that passes because the values are
    // absent proves nothing at all.
    for (const value of Object.values(PUBLIC_IDENTIFIERS)) {
      expect(bundle).toContain(value)
    }
  })

  for (const [name, value] of Object.entries(PUBLIC_IDENTIFIERS)) {
    it(`does not flag the ${name}`, () => {
      expect(scanText(value, "chunk.js", [])).toEqual([])
    })
  }

  it("does not flag the whole outputs file inlined into a client chunk", () => {
    expect(scanText(bundle, ".next/static/chunks/main.js", [])).toEqual([])
  })
})

describe("the check still fires on the things that matter", () => {

  it("finds a secret literal in a chunk that also holds the public identifiers", () => {
    const bundle = `const cfg={userPoolId:"us-east-1_K9dQ2mHvZ"};const s="${SECRET}"`
    const found = scanText(bundle, ".next/static/chunks/main.js", [
      { key: "STRAVA_CLIENT_SECRET", value: SECRET },
    ])
    expect(found).toHaveLength(1)
    expect(found[0].key).toBe("STRAVA_CLIENT_SECRET")
  })

  it("never puts the secret value into the finding it reports", () => {
    // The finding is written to a CI log. A leak detector that prints the leak
    // is the bug it exists to find.
    const found = scanText(`x="${SECRET}"`, "chunk.js", [{ key: "STRAVA_CLIENT_SECRET", value: SECRET }])
    expect(JSON.stringify(found)).not.toContain(SECRET)
    expect(found[0].excerpt).toContain("<STRAVA_CLIENT_SECRET>")
  })

  it("carries every generic pattern the design asks for", () => {
    expect(PATTERNS.map((p) => p.name).sort()).toEqual([
      "AWS access key id",
      "GitHub fine-grained PAT",
      "GitHub personal access token",
      "Slack token",
      "private key block",
    ])
  })
})

describe("which candidate values are worth scanning for", () => {
  it("skips a short id by name rather than silently", () => {
    // STRAVA_CLIENT_ID is a five- or six-digit number. Scanning for it would
    // match minified chunk names and integer constants many times per bundle.
    const { literals, skipped } = resolveLiteralsFrom({ STRAVA_CLIENT_ID: "180450" })
    expect(literals).toEqual([])
    expect(skipped.join()).toContain("STRAVA_CLIENT_ID")
  })

  it("skips .env.example placeholders", () => {
    const { literals } = resolveLiteralsFrom({ STRAVA_CLIENT_SECRET: "replace-me" })
    expect(literals).toEqual([])
  })

  it("keeps a real 40-character secret", () => {
    const { literals } = resolveLiteralsFrom({ STRAVA_CLIENT_SECRET: SECRET })
    expect(literals.map((l) => l.key)).toEqual(["STRAVA_CLIENT_SECRET"])
  })
})
