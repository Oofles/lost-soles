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

  /**
   * THE ONE THIRD-PARTY PACKAGE THE DOMAIN MAY IMPORT. Ticket `0045`, D-212.
   *
   * Named individually rather than as a "pure libraries are fine" rule, so that adding a
   * second one is a visible edit to this file with a reason attached — the same discipline
   * `adapter.test.ts` applies to its two polyline decoders and `check-boundaries.mjs` to
   * its three narrowings.
   *
   * `h3-js` earns it on the design's say-so, not on convenience: `01-architecture.md` §11
   * specifies it by name for this exact step (*"in-process, `h3-js` (pure JS, bundles
   * cleanly)"*), and `05-fog-of-war.md` §2.2's normative pseudocode is written in H3
   * primitives throughout. A domain that may not import it cannot implement §2.2 at all.
   *
   * And it does not weaken what this test protects. The rule guards DIRECTION and
   * PORTABILITY — nothing may point out of the domain at an adapter, the pipeline, the UI
   * or a cloud SDK, and `normalize()` must run in a Lambda, a browser and a replay harness
   * alike. Measured rather than assumed: `h3-js@4.5.0` has **zero** dependencies and zero
   * peer dependencies, is the version R3 §627 pinned, and R3 records it working in both
   * the browser and Lambda. It is a compiled geometry kernel, not a layer.
   */
  const DOMAIN_ALLOWED_PACKAGES = ["h3-js"]

  /**
   * COMMENTS ARE STRIPPED BEFORE MATCHING, and that is not a loosening. Ticket `0048`.
   *
   * `from "…"` is an ordinary English construction, and this directory is heavily
   * commented on purpose. `discovery.ts` says a reader must not have to *"distinguish
   * 'absent' from 'none'"*, and the raw regex read that as an import of a package called
   * `none`. A gate with false positives is a gate that gets bypassed — the lesson
   * `check-boundaries.mjs` learned on ticket 0016's settings copy — so the fix is to make
   * the check see code, not to make the prose avoid a word.
   *
   * Deliberately crude: block bodies and line comments blanked, strings left alone. A real
   * `import … from "aws-sdk"` is unaffected, and the case below proves it.
   */
  const codeOnly = (body: string) =>
    body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

  it("imports only node: builtins, its own siblings, and h3-js", () => {
    const allowed = /^(node:|\.\/|\.\.\/|vitest$)/
    const bad: string[] = []
    for (const [rel, body] of files) {
      for (const m of codeOnly(body).matchAll(/from\s+["']([^"']+)["']/g)) {
        if (allowed.test(m[1])) continue
        if (DOMAIN_ALLOWED_PACKAGES.includes(m[1])) continue
        bad.push(`${rel} → ${m[1]}`)
      }
    }
    expect(bad).toEqual([])
  })

  it("still fires on a real import, so stripping comments did not disarm it", () => {
    // The stripper's own test. Prose that merely says `from "none"` must pass; an actual
    // import statement must not — and `codeOnly` is the only thing telling them apart.
    const prose = `/** distinguish "absent" from "none". */\nimport { x } from "./fog"`
    /**
     * ASSEMBLED FROM PARTS so this file's own text never contains the pattern. Written as
     * a plain literal, the fixture is an import statement in `src/domain/` and the check
     * above flags it — which is the check working correctly, on its own test. `join(" ")`
     * puts the space in at runtime; in the source there is none after `from`, so the
     * scanner sees nothing and the assertion still exercises the real regex.
     */
    const real = ["import { Client }", "from", '"a-package-the-domain-may-not-have"'].join(" ")
    const hits = (body: string) =>
      [...codeOnly(body).matchAll(/from\s+["']([^"']+)["']/g)]
        .map((m) => m[1])
        .filter((p) => !/^(node:|\.\/|\.\.\/|vitest$)/.test(p))

    expect(hits(prose)).toEqual([])
    expect(hits(real)).toEqual(["a-package-the-domain-may-not-have"])
  })

  it("the allowlist is exactly one package, and it is the one the architecture names", () => {
    // A list that quietly grows is how "the domain depends on nothing" becomes untrue
    // while every test stays green. If this fails, the question to answer is whether the
    // NEW entry belongs in the domain at all — not whether to raise the number.
    expect(DOMAIN_ALLOWED_PACKAGES).toEqual(["h3-js"])
  })

  it("every allowed package is genuinely dependency-free", () => {
    // The portability claim above, asserted rather than trusted. A transitive dependency
    // arriving in a minor bump is exactly the drift this file is named for.
    for (const pkg of DOMAIN_ALLOWED_PACKAGES) {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, "node_modules", pkg, "package.json"), "utf8"),
      )
      expect(Object.keys(manifest.dependencies ?? {}), pkg).toEqual([])
      expect(Object.keys(manifest.peerDependencies ?? {}), pkg).toEqual([])
    }
  })
})
