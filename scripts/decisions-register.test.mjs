import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Ticket 0170. A `D-xxx` names exactly one decision, forever.
 *
 * Numbers are allocated by reading DECISIONS.md and adding one — a read-modify-write
 * with no lock, and every session is a writer that does not re-read before
 * committing. That produced TWO collisions before anything checked: D-194 (0032's
 * OAuth routes and 0035's raw archive) and D-176 (0137's guard rule and the
 * capability 02 audit). Each later entry was renumbered in place, to D-244 and D-245.
 *
 * Monotonicity is asserted as well as uniqueness, because a register whose numbers
 * go backwards is one where the next writer's "highest plus one" reads the wrong
 * line. Entries that are out of file order ON PURPOSE are listed below, each with
 * the reason, and each must still exist and still be out of order — an exemption
 * that no longer exempts anything is removed, not kept "just in case".
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const REGISTER = join(ROOT, "docs/decisions/DECISIONS.md")

/** A decision entry is a top-level bullet whose first token is the bold id. */
const ENTRY_RE = /^- \*\*D-(\d+)\*\*/

const OUT_OF_ORDER = {
  154: "O-005 standing rule — filed under 'Remaining open' beside that finding, between D-123 and D-124",
  244: "Renumbered in place from D-194 by 0170; kept beside 0035's section heading",
  245: "Renumbered in place from D-176 by 0170; kept under the capability 02 audit heading",
}

/** @returns {{ id: number, line: number }[]} */
export function parseRegister(text) {
  return text.split("\n").flatMap((l, i) => {
    const m = ENTRY_RE.exec(l)
    return m ? [{ id: Number(m[1]), line: i + 1 }] : []
  })
}

/** Ids whose number repeats, with every line each appears on. */
export function duplicates(entries) {
  const byId = new Map()
  for (const e of entries) byId.set(e.id, [...(byId.get(e.id) ?? []), e.line])
  return [...byId].filter(([, lines]) => lines.length > 1).map(([id, lines]) => ({ id, lines }))
}

/** Entries not strictly above every non-exempt entry before them. */
export function outOfOrder(entries, exempt = {}) {
  const bad = []
  let high = -1
  for (const e of entries) {
    if (e.id in exempt) continue
    if (e.id <= high) bad.push({ ...e, after: high })
    high = Math.max(high, e.id)
  }
  return bad
}

describe("parser (so a clean result means the register was read)", () => {
  const sample = ["- **D-001** a", "  - **D-002** a sub-bullet, not an entry", "- **D-003** b"].join("\n")

  it("reads top-level entries only", () => {
    expect(parseRegister(sample).map((e) => e.id)).toEqual([1, 3])
  })
  it("reports a collision with both lines", () => {
    expect(duplicates(parseRegister("- **D-7** x\n- **D-7** y"))).toEqual([{ id: 7, lines: [1, 2] }])
  })
  it("reports a number that goes backwards, and honours an exemption", () => {
    const e = parseRegister("- **D-5** x\n- **D-3** y\n- **D-6** z")
    expect(outOfOrder(e).map((x) => x.id)).toEqual([3])
    expect(outOfOrder(e, { 3: "why" })).toEqual([])
  })
})

describe("docs/decisions/DECISIONS.md", () => {
  const text = readFileSync(REGISTER, "utf8")
  const entries = parseRegister(text)

  it("parses as a register at all — an empty parse is not a clean one (D-176)", () => {
    expect(entries.length).toBeGreaterThan(150)
  })

  it("assigns every D-xxx to exactly one decision", () => {
    expect(duplicates(entries)).toEqual([])
  })

  it("never goes backwards, outside the listed exemptions", () => {
    expect(outOfOrder(entries, OUT_OF_ORDER)).toEqual([])
  })

  it("has no stale exemption — each listed id exists and is genuinely out of order", () => {
    for (const id of Object.keys(OUT_OF_ORDER).map(Number)) {
      const rest = Object.fromEntries(Object.entries(OUT_OF_ORDER).filter(([k]) => Number(k) !== id))
      const stillNeeded =
        outOfOrder(entries, rest).some((e) => e.id === id) ||
        outOfOrder(entries, rest).some((e) => e.after === id)
      expect(entries.some((e) => e.id === id), `D-${id} is exempt but absent`).toBe(true)
      expect(stillNeeded, `D-${id} is exempt but already in order`).toBe(true)
    }
  })

  it("keeps the renumbering note on each renumbered entry", () => {
    expect(text).toMatch(/- \*\*D-244\*\*[\s\S]*?Renumbered from D-194/)
    expect(text).toMatch(/- \*\*D-245\*\*[\s\S]*?Renumbered from D-176/)
  })
})
