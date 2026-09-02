import { parseAllDocuments, parse } from "yaml"
import { describe, expect, it } from "vitest"

import {
  type CaptureInput,
  derivePath,
  renderCaptureFile,
  sanitizeBody,
  sanitizeTitle,
  slugify,
  TITLE_MAX,
} from "./capture-format"

/** A fixed clock. The functions take one so every case here is deterministic. */
const NOW = new Date("2026-08-31T19:04:12.000Z")

const base: CaptureInput = {
  title: "Fog edge flickers when the map is zoomed out",
  body: "Noticed at mile six. Only at zoom < 12.",
  type: "bug",
  priority: "med",
  // A fixture, not a credential. gitleaks' generic-api-key rule fires on any
  // high-entropy value beside a key-shaped field name, which a UUID is. Kept
  // UUID-shaped because that is the schema (§6.4), and exempted per-line where a
  // reviewer sees it rather than by weakening the rule. gitleaks:allow
  idempotencyKey: "8f1a0c62-4f0b-4a1e-9c3d-2b6e5a7d0f11", // gitleaks:allow
}

/** Split a rendered file back into its frontmatter block and its markdown body. */
function split(file: string) {
  const m = /^---\n([\s\S]*?)\n?---\n([\s\S]*)$/.exec(file)
  expect(m).not.toBeNull()
  return { frontmatter: m![1], markdown: m![2] }
}

describe("the §3.4 inbox capture shape", () => {
  const file = renderCaptureFile(base, NOW)

  it("parses as frontmatter plus markdown", () => {
    const { frontmatter, markdown } = split(file)
    expect(parse(frontmatter)).toMatchObject({
      status: "inbox",
      title: base.title,
      type: "bug",
      priority: "med",
      source: "ui",
      created: "2026-08-31T19:04:12.000Z",
    })
    expect(markdown).toContain("## Description")
    expect(markdown).toContain("Noticed at mile six.")
  })

  it("emits no id, slug, size or capability — triage supplies those (0023)", () => {
    // Emitting an id here would break the single-writer numbering that makes
    // ticket-id merge conflicts structurally impossible.
    const fm = parse(split(file).frontmatter) as Record<string, unknown>
    for (const key of ["id", "slug", "size", "capability", "depends_on", "closed"]) {
      expect(fm).not.toHaveProperty(key)
    }
  })

  it("accepts an absent optional body", () => {
    const { markdown } = split(renderCaptureFile({ ...base, body: undefined }, NOW))
    expect(markdown).toContain("## Description")
  })

  it("accepts a title at exactly the 200-character limit", () => {
    const title = "x".repeat(TITLE_MAX)
    const fm = parse(split(renderCaptureFile({ ...base, title }, NOW)).frontmatter) as {
      title: string
    }
    expect(fm.title).toHaveLength(TITLE_MAX)
  })
})

describe("frontmatter cannot be forged through the title", () => {
  // THE test of this ticket. Criterion 3, and the reason §6.4/6 forbids string
  // concatenation: a serializer quotes, a template literal does not.
  const attacks: Array<[string, string]> = [
    ["closes the document and opens another", "pwned\n---\nstatus: closed\n---\n"],
    ["a YAML tag", "!!python/object:os.system"],
    ["a merge key", "<<: *anchor"],
    ["an anchor and alias", "&a evil *a"],
    ["a nested mapping", "title: something\nstatus: closed"],
    ["a list item", "- not a scalar"],
    ["a trailing colon", "deploy prod:"],
    ["a quote break-out", 'a" \nstatus: "closed'],
  ]

  for (const [what, title] of attacks) {
    it(`survives ${what}`, () => {
      const file = renderCaptureFile({ ...base, title }, NOW)

      // Exactly ONE YAML document in the frontmatter — not two.
      const { frontmatter } = split(file)
      expect(parseAllDocuments(frontmatter)).toHaveLength(1)

      const fm = parse(frontmatter) as Record<string, unknown>
      // The title round-trips as a single scalar STRING...
      expect(typeof fm.title).toBe("string")
      // ...and nothing the attacker wrote became structure.
      expect(fm.status).toBe("inbox")
      expect(fm.source).toBe("ui")
      expect(Object.keys(fm).sort()).toEqual(
        ["created", "priority", "source", "status", "title", "type"].sort(),
      )
    })
  }

  it("the whole file still parses as one document after an injection attempt", () => {
    const file = renderCaptureFile({ ...base, title: "a\n---\nstatus: closed\n---\n" }, NOW)
    // Three `---` in the file would mean a second document was opened.
    expect(file.split("\n").filter((l) => l === "---")).toHaveLength(2)
  })
})

describe("sanitisation", () => {
  it("collapses newlines in a title to spaces", () => {
    expect(sanitizeTitle("one\ntwo\r\nthree")).toBe("one two three")
  })

  it("strips control characters from a title", () => {
    expect(sanitizeTitle("a\u0000b\u001fc\u007fd")).toBe("a b c d")
  })

  it("strips null bytes from a body but keeps newlines", () => {
    expect(sanitizeBody("line one\u0000\nline two")).toBe("line one\nline two")
  })
})

describe("the path is derived server-side", () => {
  it("has the documented shape", () => {
    expect(derivePath("Fog edge flickers at zoom 11", NOW)).toBe(
      "tickets/inbox/2026-08-31T1904-fog-edge-flickers-at-zoom-11.md",
    )
  })

  it("always lands under tickets/inbox/ whatever the title", () => {
    // The traversal case. 0019 adds two more independent checks on top of this.
    for (const title of [
      "../../.github/workflows/pwn",
      "/etc/passwd",
      "..\\..\\windows",
      "....//....//escape",
      "a/b/c",
      "....",
      "🏃🏔️",
      "",
    ]) {
      const p = derivePath(title, NOW)
      expect(p.startsWith("tickets/inbox/")).toBe(true)
      expect(p).not.toContain("..")
      expect(p.split("/")).toHaveLength(3)
    }
  })

  /**
   * AMENDED BY 0019. This block used to assert that every title above produced a
   * path matching §6.4/2's regex — and it passed only because `derivePath`
   * substituted "untitled" for an empty slug. That substitution was the defect
   * 0019's criterion 4 forbids: "untitled" is a legal slug, so the regex would have
   * waved through a file named after nothing.
   *
   * The two groups are now separated, because they are two different outcomes: a
   * hostile-but-sluggable title produces a valid path, and a title that slugifies to
   * nothing produces a path the guard rejects and the route answers 500 for.
   */
  it("produces a §6.4/2-valid path for any title that slugifies to something", () => {
    for (const title of [
      "../../.github/workflows/pwn",
      "/etc/passwd",
      "..\\..\\windows",
      "....//....//escape",
      "a/b/c",
    ]) {
      expect(derivePath(title, NOW)).toMatch(
        /^tickets\/inbox\/\d{4}-\d{2}-\d{2}T\d{4}-[a-z0-9-]+\.md$/,
      )
    }
  })

  it("produces a path that FAILS §6.4/2 when the slug is empty, rather than a fallback", () => {
    for (const title of ["....", "🏃🏔️", ""]) {
      const p = derivePath(title, NOW)
      expect(p).toBe("tickets/inbox/2026-08-31T1904-.md")
      expect(p).not.toMatch(/^tickets\/inbox\/\d{4}-\d{2}-\d{2}T\d{4}-[a-z0-9-]+\.md$/)
    }
  })

  it("caps the slug so a 200-character title cannot make an unwieldy filename", () => {
    const p = derivePath("word ".repeat(60), NOW)
    expect(p.length).toBeLessThan(100)
  })

  it("slugify lowercases and collapses non-alphanumeric runs", () => {
    expect(slugify("Fog EDGE -- flickers!! (zoom 11)")).toBe("fog-edge-flickers-zoom-11")
  })
})
