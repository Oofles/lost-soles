import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { buildInfo } from "./build-info"

/** Ticket 0089 criterion 8 — the half a script can prove; the deployed match is the smoke test. */
describe("buildInfo", () => {
  it("shows the version and a 7-char sha from a full commit id", () => {
    const sha = "2614c51aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5"
    expect(buildInfo({ version: "0.1.0", sha })).toEqual({ version: "0.1.0", sha, shortSha: "2614c51" })
  })

  it("says so plainly outside a Next build rather than inventing a value", () => {
    expect(buildInfo({})).toEqual({ version: "dev", sha: "unknown", shortSha: "unknown" })
  })

  it("next.config.ts inlines both, from package.json and AWS_COMMIT_ID with a git fallback", () => {
    const config = readFileSync(join(process.cwd(), "next.config.ts"), "utf8")
    expect(config).toContain("LOST_SOLES_BUILD_VERSION")
    expect(config).toContain("LOST_SOLES_BUILD_SHA")
    expect(config).toContain("AWS_COMMIT_ID")
    expect(config).toContain("git rev-parse HEAD")
  })
})
