import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, it } from "vitest"

/**
 * Ticket 0145. `build-index.mjs` guards "read by section, never whole" (D-151),
 * and until now nothing guarded it. 0140 fixed a real defect here — `--check`
 * wrote the sidecar on every run — and could not add a regression test for it.
 *
 * Every test runs the script AS A CHILD PROCESS against a FIXTURE TREE via
 * `--root`, never against the real docs/. A test reading docs/ changes meaning on
 * every doc edit, which is how a test becomes noise and then gets deleted. A child
 * process is also the only honest way to assert "read-only": the property is about
 * what lands on disk, not about any function's return value.
 */

const SCRIPT = new URL("./build-index.mjs", import.meta.url).pathname

let root
afterEach(() => root && rmSync(root, { recursive: true, force: true }))

/** A minimal repo root: docs/ and docs/contracts/, both of which the script reads. */
function fixture(docs) {
  root = mkdtempSync(join(tmpdir(), "build-index-"))
  mkdirSync(join(root, "docs/contracts"), { recursive: true })
  for (const [name, body] of Object.entries(docs)) writeFileSync(join(root, "docs", name), body)
  return root
}

const run = (...args) =>
  spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], { encoding: "utf8" })
const regenerate = () => execFileSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" })
const read = (rel) => readFileSync(join(root, rel), "utf8")
const sidecar = () => JSON.parse(read("docs/.index-summaries.json"))

/** The index row for a section title, as `{ range, summary }`. */
function row(title) {
  const line = read("docs/INDEX.md")
    .split("\n")
    .find((l) => l.startsWith("| ") && l.split(" | ")[0].endsWith(title))
  if (!line) return undefined
  const [, range, summary] = line.slice(2, -2).split(" | ")
  return { range: range.replace(/`/g, ""), summary }
}

const DOC = [
  "# Fixture doc", //                                                              1
  "", //                                                                           2
  "## Alpha", //                                                                   3
  "", //                                                                           4
  "Alpha is the first section and its prose is long enough to summarise.", //     5
  "", //                                                                           6
  "### Alpha child", //                                                            7
  "", //                                                                           8
  "The child section ends where the next level-two heading begins, not later.", // 9
  "", //                                                                          10
  "## Beta", //                                                                   11
  "", //                                                                          12
  "Beta carries an example ticket body inside a fenced block, as 07 does.", //    13
  "", //                                                                          14
  "```markdown", //                                                               15
  "## Acceptance criteria", //                                                    16
  "", //                                                                          17
  "- [ ] an example, not a section", //                                           18
  "```", //                                                                       19
  "", //                                                                          20
  "### Beta child", //                                                            21
  "", //                                                                          22
  "Last section in the file, so its range runs to the final line.", //            23
].join("\n")

describe("build-index.mjs", () => {
  it("--check is read-only, even when it fails (D-178, the 0140 regression)", () => {
    fixture({ "01-fixture.md": DOC })
    regenerate()
    // Make the index stale AND leave the sidecar missing a key the script would
    // add — the exact state in which the old ordering wrote the sidecar.
    writeFileSync(join(root, "docs/01-fixture.md"), DOC + "\n\n## Gamma\n\nA new section the index has not seen yet.\n")
    const before = { index: read("docs/INDEX.md"), side: read("docs/.index-summaries.json") }

    const r = run("--check")

    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/out of date/)
    expect(read("docs/INDEX.md")).toBe(before.index)
    expect(read("docs/.index-summaries.json")).toBe(before.side)
  })

  it("--check passes on a fresh index, and ignores the regeneration date", () => {
    fixture({ "01-fixture.md": DOC })
    regenerate()
    const index = read("docs/INDEX.md")
    writeFileSync(join(root, "docs/INDEX.md"), index.replace(/regenerated \d{4}-\d{2}-\d{2}/, "regenerated 1999-01-01"))
    expect(read("docs/INDEX.md")).not.toBe(index)

    const r = run("--check")
    expect(r.status).toBe(0)
  })

  it("does not index a heading inside a fenced code block (the 07:463 case)", () => {
    fixture({ "01-fixture.md": DOC })
    regenerate()
    expect(row("Acceptance criteria")).toBeUndefined()
    expect(Object.keys(sidecar()).some((k) => k.endsWith("#Acceptance criteria"))).toBe(false)
    // and the fence closing does not swallow the heading after it
    expect(row("Beta child")).toBeDefined()
  })

  it("ends a section at the next heading of the same or higher level", () => {
    fixture({ "01-fixture.md": DOC })
    regenerate()
    expect(row("Alpha").range).toBe("3-10") //       ## ends before the next ##, spanning its ###
    expect(row("Alpha child").range).toBe("7-10") // ### followed by ## ends before the ##
    expect(row("Beta").range).toBe("11-23") //       last ## runs to end of file
    expect(row("Beta child").range).toBe("21-23")
  })

  it("keeps a hand-written summary through a regeneration that moves its lines", () => {
    fixture({ "01-fixture.md": DOC })
    regenerate()
    const key = "docs/01-fixture.md#Beta"
    expect(sidecar()[key]).toMatch(/^Beta carries/) // derived first time round

    const HAND = "Hand-written: what Beta settles."
    writeFileSync(join(root, "docs/.index-summaries.json"), JSON.stringify({ ...sidecar(), [key]: HAND }))
    // Push every line down so Beta's range changes.
    writeFileSync(join(root, "docs/01-fixture.md"), DOC.replace("## Alpha", "## Alpha\n\nExtra.\nExtra.\nExtra."))
    regenerate()

    expect(row("Beta").range).toBe("15-27")
    expect(row("Beta").summary).toBe(HAND)
    expect(sidecar()[key]).toBe(HAND)
  })
})
