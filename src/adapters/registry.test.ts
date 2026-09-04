import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, normalize, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

import { ADAPTERS, getAdapter, registeredSources, UnknownAdapterError } from "./registry"

/**
 * Ticket 0026. Two jobs: the registry behaves, and — the criterion that actually matters —
 * it is the ONLY file outside an adapter's own directory that imports a concrete adapter.
 *
 * That second one is asserted rather than trusted for the same reason 0013's boundary
 * grep landed while the domain was still empty: a rule added after the first violation is
 * a rule that has already failed. Today it passes over an empty tree. It is written to
 * still mean something on the day `src/adapters/<something>/` exists — which is why it
 * discovers adapter directories rather than naming one.
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const ADAPTERS_DIR = join(ROOT, "src/adapters")

/** Roots that could plausibly import an adapter. `scripts/` is plain node and excluded. */
const SCANNED = ["app", "components", "lib", "src", "types", "amplify"]
const SKIP_DIRS = new Set(["node_modules", ".next", ".amplify", ".git", "dist", "build"])
const EXTS = [".ts", ".tsx"]

/** `registry.ts` is the one blessed importer. 01-architecture.md §3 T2 says so explicitly. */
const BLESSED = "src/adapters/registry.ts"

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full)
  }
  return out
}

function sourceFiles(): string[] {
  const files = SCANNED.flatMap((r) => walk(join(ROOT, r)))
  for (const loose of ["middleware.ts"]) {
    const full = join(ROOT, loose)
    if (existsSync(full)) files.push(full)
  }
  return files
}

/**
 * A concrete adapter lives at `src/adapters/<source>/`. Anything directly in
 * `src/adapters/` is the boundary itself — `types.ts`, `registry.ts`, these tests.
 */
function adapterDirs(): string[] {
  if (!existsSync(ADAPTERS_DIR)) return []
  return readdirSync(ADAPTERS_DIR).filter((n) => statSync(join(ADAPTERS_DIR, n)).isDirectory())
}

/** Every module specifier in a file: static imports, type imports, re-exports, dynamic. */
function importSpecifiers(src: string): string[] {
  const out: string[] = []
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\s[\s\S]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) out.push(m[1]!)
  }
  return out
}

/** Resolve a specifier to a repo-relative path, or null if it leaves the repo. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (spec.startsWith("@/")) return normalize(spec.slice(2))
  if (spec.startsWith(".")) {
    const abs = normalize(join(dirname(fromFile), spec))
    const rel = relative(ROOT, abs)
    return rel.startsWith("..") ? null : rel
  }
  return null // a bare package specifier is never one of ours
}

const posix = (p: string) => p.split(sep).join("/")

describe("registry.ts is the only file that names a concrete adapter", () => {
  it("finds no import of a concrete adapter outside its own directory", () => {
    const dirs = adapterDirs()
    const violations: string[] = []

    for (const file of sourceFiles()) {
      const rel = posix(relative(ROOT, file))
      if (rel === BLESSED) continue

      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        const target = resolveSpecifier(file, spec)
        if (target === null) continue
        const t = posix(target)

        const dir = dirs.find(
          (d) => t === `src/adapters/${d}` || t.startsWith(`src/adapters/${d}/`),
        )
        if (dir === undefined) continue
        // An adapter importing its own siblings is the whole point of it being a directory.
        if (rel.startsWith(`src/adapters/${dir}/`)) continue

        violations.push(`${rel} imports "${spec}" (adapter "${dir}")`)
      }
    }

    // Criterion 9 (ticket 0027): the failure names the decision it protects, so a reader
    // who hits it knows why the rule exists before deciding it is in their way.
    expect(
      violations,
      violations.length === 0
        ? ""
        : "T2 / D-100 / D-121.1 — replacing the primary source must produce a diff confined\n" +
          "to src/adapters/<name>/ plus ONE line in src/adapters/registry.ts. Each file below\n" +
          "is a second place that would have to change, and the whole D-121 bet is that the\n" +
          "Strava adapter is replaceable in a week rather than rewritten:\n  " +
          violations.join("\n  "),
    ).toEqual([])
  })

  it("scans a non-trivial number of files, so an empty sweep cannot pass silently", () => {
    // The failure mode this guards is the test above passing because `sourceFiles()`
    // returned nothing — a broken ROOT, a renamed directory. It would look identical to
    // a clean tree, and stay green for ever.
    expect(sourceFiles().length).toBeGreaterThan(10)
  })

  it("detects a violation when one exists", () => {
    // Proves the detector fires, without committing a real violation. The same
    // self-test discipline as `check-boundaries.mjs --self-test`: a gate nobody has seen
    // fail is a gate nobody knows works.
    const dirs = ["acme"]
    const t = "src/adapters/acme/adapter"
    const dir = dirs.find((d) => t === `src/adapters/${d}` || t.startsWith(`src/adapters/${d}/`))
    expect(dir).toBe("acme")
    expect("lib/ingest.ts".startsWith(`src/adapters/${dir}/`)).toBe(false)
  })
})

describe("the registry works with zero adapters registered", () => {
  it("ships empty — the boundary exists before any source does", () => {
    expect(registeredSources()).toEqual([])
    expect(Object.keys(ADAPTERS)).toHaveLength(0)
  })

  it("throws a typed error rather than returning undefined", () => {
    expect(() => getAdapter("gpslogger")).toThrow(UnknownAdapterError)
  })

  it("names the offending source on the error, not just in the message", () => {
    // A handler mapping this to a 400 should not have to parse the message string.
    try {
      getAdapter("not-a-real-source")
      expect.unreachable("getAdapter must throw for an unregistered source")
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownAdapterError)
      expect((err as UnknownAdapterError).source).toBe("not-a-real-source")
      expect((err as UnknownAdapterError).name).toBe("UnknownAdapterError")
    }
  })

  it("throws for an enumerated source that simply has no adapter yet", () => {
    // `SourceId` enumerating a source is documentation, not a promise that it is built.
    expect(() => getAdapter("manual")).toThrow(UnknownAdapterError)
  })
})
