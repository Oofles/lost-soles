import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Ticket 0025. Two guards that are about the domain's RELATIONSHIPS rather than its
 * shape: it must not drift from its contract, and it must not depend on anything.
 *
 * On the first: the ticket's own Notes are the reason — "a domain that quietly disagrees
 * with the contract is worse than either one being wrong, because the disagreement is
 * invisible." A drift test makes it visible. It is NOT a substitute for
 * `activity.types.test.ts`; 0123 established that "matches the spec" verifies
 * transcription, not correctness, and inherits every defect the spec has. The two files
 * do different jobs and both are needed.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const DOMAIN = join(ROOT, "src/domain")
const CONTRACT = join(ROOT, "docs/contracts/ingestion-contract.md")

/** The ```ts block inside §2 of the contract, and nothing else. */
function contractSection2(): string {
  const md = readFileSync(CONTRACT, "utf8").split("\n")
  const from = md.findIndex((l) => l.startsWith("## 2."))
  const to = md.findIndex((l, i) => i > from && l.startsWith("## 3."))
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  const section = md.slice(from, to)
  const open = section.findIndex((l) => l === "```ts")
  const close = section.findIndex((l, i) => i > open && l === "```")
  expect(open).toBeGreaterThan(-1)
  expect(close).toBeGreaterThan(open)
  return section.slice(open + 1, close).join("\n")
}

/** activity.ts from its first declaration onward — the header comment is ours, not the contract's. */
function transcribedRegion(): string {
  const src = readFileSync(join(DOMAIN, "activity.ts"), "utf8").split("\n")
  const start = src.findIndex((l) => l.startsWith("/** Known sources"))
  expect(start).toBeGreaterThan(-1)
  return src.slice(start).join("\n").replace(/\n+$/, "")
}

describe("src/domain/activity.ts does not drift from the canonical contract", () => {
  it("is byte-identical to contract §2", () => {
    // If this fails, ONE of two things is true and they need different responses:
    //   - the contract changed  → re-transcribe, and check the reasoning changed too
    //   - the file was edited   → revert it and file a ticket AGAINST THE CONTRACT
    // Never reconcile by editing whichever is more convenient (D-140).
    expect(transcribedRegion()).toBe(contractSection2())
  })

  it("compares a non-trivial amount of text, so a pass means something", () => {
    // Guards the assertion above: if either extractor silently returned "" this suite
    // would go green while checking nothing. That exact shape of vacuous pass is what
    // 0013 found in the lint script and 0016 found in the design-token grep.
    expect(contractSection2().length).toBeGreaterThan(2000)
    expect(contractSection2()).toContain("export interface Activity")
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe("the domain depends on nothing", () => {
  const files = walk(DOMAIN).map((f) => [relative(ROOT, f).split(sep).join("/"), readFileSync(f, "utf8")] as const)

  it("finds the files it claims to check", () => {
    expect(files.map(([rel]) => rel)).toContain("src/domain/activity.ts")
  })

  it.each([
    ["an adapter", /from\s+["'][^"']*adapters/],
    ["the game or rules layer", /from\s+["'][^"']*(game|rules|skills|xp)\b/],
    ["the pipeline", /from\s+["'][^"']*pipeline/],
    ["a React or Next module", /from\s+["'](react|next)[/"']/],
    ["an AWS SDK", /from\s+["']@aws-sdk/],
  ])("imports nothing from %s", (_what, pattern) => {
    // The direction of dependency IS the architecture (01-architecture.md §3). Everything
    // may point at the domain; the domain points at nothing. A single import the other way
    // makes `normalize()` unportable and the migration seam fictional.
    const offenders = files.filter(([, body]) =>
      body.split("\n").some((l) => !/^\s*(\/\/|\*|\/\*)/.test(l) && pattern.test(l)),
    )
    expect(offenders.map(([rel]) => rel)).toEqual([])
  })

  it("imports only node: builtins and its own siblings", () => {
    const allowed = /^(node:|\.\/|\.\.\/|vitest$)/
    const bad: string[] = []
    for (const [rel, body] of files) {
      for (const m of body.matchAll(/from\s+["']([^"']+)["']/g)) {
        if (!allowed.test(m[1])) bad.push(`${rel} → ${m[1]}`)
      }
    }
    expect(bad).toEqual([])
  })
})
