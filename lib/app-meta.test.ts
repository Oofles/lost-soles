import { describe, expect, it } from "vitest"

import { readFileSync } from "node:fs"

import { APP_NAME, APP_TAGLINE, APP_VERSION } from "@/lib/app-meta"

describe("app metadata", () => {
  it("names the app", () => {
    expect(APP_NAME).toBe("Lost Soles")
  })

  it("states the D-020 promise, which is the whole product", () => {
    expect(APP_TAGLINE).toContain("only ever grows")
  })

  /**
   * APP_VERSION is stamped into raw archive metadata and is the field a future
   * backfill reads to know what wrote an object (ticket 0039). A literal that has
   * drifted from package.json is worse than no version: it does not look stale.
   */
  it("states the same version package.json does", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string }
    expect(APP_VERSION).toBe(manifest.version)
  })
})
