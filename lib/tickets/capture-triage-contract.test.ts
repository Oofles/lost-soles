import { describe, expect, it } from "vitest"

import { type CaptureInput, renderCaptureFile } from "./capture-format"

/**
 * THE CONTRACT NOTHING ELSE CHECKS. Ticket 0018.
 *
 * The capture endpoint writes a file; `tickets.mjs triage-move` reads it later, at
 * the other end of a delay that could be days. Two components, two authors, one file
 * format, and until this test nothing asserted they agreed.
 *
 * It matters more than it looks, because `tickets.mjs`'s frontmatter parser is
 * DELIBERATELY NOT a YAML parser (its own comment: "a real YAML parser would happily
 * accept nested structures the format does not allow"). It is line-based: one
 * `key: value` per line, surrounding quotes stripped naively, and any line that does
 * not match the key regex is a hard parse error.
 *
 * So "valid YAML" is NOT the bar. Valid YAML that this specific parser accepts is.
 * A block scalar, a folded line, or a multi-line value would all be legal YAML and
 * would all make the captured note unreadable by the tool meant to triage it — and
 * the failure would surface days later, on a note dictated once with no second copy.
 */

// The REAL parser, imported from the real script rather than reimplemented. A
// reimplementation would drift, and the whole point is to catch the day these two
// disagree. Typed by types/tickets-script.d.ts.
const { parse } = await import("../../.claude/skills/tickets/scripts/tickets.mjs")

const NOW = new Date("2026-08-31T19:04:12.000Z")

const base: CaptureInput = {
  title: "Fog edge flickers when the map is zoomed out",
  body: "Noticed at mile six.",
  type: "bug",
  priority: "med",
  // A fixture, not a credential. gitleaks' generic-api-key rule fires on any
  // high-entropy value beside a key-shaped field name, which a UUID is. Kept
  // UUID-shaped because that is the schema (§6.4), and exempted per-line where a
  // reviewer sees it rather than by weakening the rule. gitleaks:allow
  idempotencyKey: "8f1a0c62-4f0b-4a1e-9c3d-2b6e5a7d0f11", // gitleaks:allow
}

describe("triage can read what capture writes", () => {
  it("parses a plain capture with no error", () => {
    const r = parse(renderCaptureFile(base, NOW), "tickets/inbox/x.md")
    expect(r.error).toBeNull()
    expect(r.fm).toMatchObject({
      status: "inbox",
      type: "bug",
      priority: "med",
      source: "ui",
      title: base.title,
    })
  })

  it("keeps the body reachable as markdown", () => {
    const r = parse(renderCaptureFile(base, NOW), "tickets/inbox/x.md")
    expect(r.body).toContain("## Description")
    expect(r.body).toContain("Noticed at mile six.")
  })

  it.each([
    ["a colon, which would look like a nested key", "deploy prod: broken"],
    ["a YAML tag", "!!python/object:os.system"],
    ["a document break", "pwned\n---\nstatus: closed\n---\n"],
    ["a leading dash", "- not a list item"],
    ["a hash, which would look like a comment", "zoom #12 is wrong"],
    ["an embedded double quote", 'he said "run" loudly'],
    ["an embedded single quote", "it's the fog edge again"],
    ["a leading ampersand", "&anchor evil"],
    ["a very long title", "x".repeat(200)],
    ["unicode and emoji", "🏃 fog edge — zoom ①①"],
    ["a leading space", "   leading space"],
    ["a trailing colon and space", "broken: "],
  ])("survives a title containing %s", (_what, title) => {
    const file = renderCaptureFile({ ...base, title }, NOW)
    const r = parse(file, "tickets/inbox/x.md")

    // The parser must not error...
    expect(r.error).toBeNull()
    // ...the structural fields must be exactly what we wrote, not what the title
    // tried to become...
    expect(r.fm?.status).toBe("inbox")
    expect(r.fm?.source).toBe("ui")
    expect(r.fm?.type).toBe("bug")
    // ...and no key may have appeared that we did not write.
    expect(r.order.sort()).toEqual(
      ["created", "priority", "source", "status", "title", "type"].sort(),
    )
  })

  it("never emits a block scalar or a wrapped line", () => {
    // Both are legal YAML and both break the line-based parser. Asserted directly
    // rather than trusted to the serializer options staying as they are.
    const long = "word ".repeat(60).trim() // longer than any default line width
    const file = renderCaptureFile({ ...base, title: long.slice(0, 200) }, NOW)
    const frontmatter = /^---\n([\s\S]*?)\n?---\n/.exec(file)![1]

    expect(frontmatter).not.toMatch(/:\s*[|>]/) // no `key: |` or `key: >`
    for (const line of frontmatter.split("\n")) {
      if (!line.trim()) continue
      // Every non-empty frontmatter line must itself be a `key: value` line —
      // exactly what tickets.mjs requires.
      expect(line).toMatch(/^[A-Za-z_][A-Za-z0-9_]*:\s/)
    }
  })

  it("writes exactly the six keys triage expects, in a stable order", () => {
    const r = parse(renderCaptureFile(base, NOW), "tickets/inbox/x.md")
    expect(r.order).toEqual(["status", "title", "type", "priority", "source", "created"])
  })
})
