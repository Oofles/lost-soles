import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Ticket 0330, criterion 1. `lib/auth/config.ts` is `school-hub`'s `lib/auth/config.ts`, byte for
 * byte, apart from a header comment naming the source commit (D-471).
 *
 * The source repository is not in CI, so the body is pinned by its sha256 at the named commit.
 * When `../school-hub` is checked out beside this repo (the operator's machine), the live file is
 * compared too, so a change on that side shows here as a red test, not as silent drift.
 *
 * Updating the copy: replace everything below the end-of-header line with the new source, update
 * SOURCE_COMMIT in the header and SOURCE_SHA256 here, together.
 */
const SOURCE_COMMIT = "7ba7d2e0a401bd1431fac26de8034e0e972436f2"
const SOURCE_SHA256 = "421fc93476343e5728a66a502fbbcd492da24435b066c75d210700a759b9ee21"
const END_OF_HEADER = "// ── END OF HEADER ── everything below is school-hub's file, byte for byte ──\n"

const ROOT = join(__dirname, "..", "..")
const copy = readFileSync(join(ROOT, "lib/auth/config.ts"), "utf8")

/** Everything after the one end-of-header line, which must appear exactly once. */
function bodyOf(text: string): string {
  const at = text.indexOf(END_OF_HEADER)
  if (at === -1 || text.indexOf(END_OF_HEADER, at + 1) !== -1) throw new Error("end-of-header line missing or repeated")
  return text.slice(at + END_OF_HEADER.length)
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

describe("lib/auth/config.ts is school-hub's, verbatim (0330)", () => {
  it("the header is a comment naming the source commit, and nothing else", () => {
    const header = copy.slice(0, copy.indexOf(END_OF_HEADER))
    expect(header).toContain(SOURCE_COMMIT)
    // Only comment lines: no code may hide above the line the diff starts from.
    expect(header.trimEnd().startsWith("/**")).toBe(true)
    expect(header.trimEnd().endsWith("*/")).toBe(true)
    expect(header.trimEnd().slice(3, -2)).not.toContain("*/")
  })

  it("the body hashes to the source file at that commit", () => {
    expect(sha256(bodyOf(copy))).toBe(SOURCE_SHA256)
  })

  it("the check fires on a one-character change to the body", () => {
    const tampered = copy.replace('sameSite: "lax"', 'sameSite: "none"')
    expect(tampered).not.toBe(copy)
    expect(sha256(bodyOf(tampered))).not.toBe(SOURCE_SHA256)
  })

  const live = join(ROOT, "..", "school-hub", "lib/auth/config.ts")
  it.runIf(existsSync(live))("matches ../school-hub's current file, when it is checked out", () => {
    expect(bodyOf(copy)).toBe(readFileSync(live, "utf8"))
  })
})
