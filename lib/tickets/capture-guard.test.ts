import { describe, expect, it } from "vitest"

import { derivePath, slugify } from "./capture-format"
import {
  DERIVED_PATH_RE,
  inboxPathViolation,
  isDerivedPath,
  secretInPayload,
  unknownKeys,
  withCollisionSuffix,
} from "./capture-guard"

/**
 * Ticket 0019. These call the guards DIRECTLY, which is criterion 3's actual point:
 * a guard exercised only through the route it currently protects is only tested as
 * far as that route happens to reach it. Layer 3 exists for a future in which layer
 * 2 has been refactored, so it must be provable without layer 2 in the picture.
 */

const fx = (...parts: string[]) => parts.join("")

describe("unknown keys are rejected, not stripped", () => {
  it("names `path` when a client sends one", () => {
    expect(unknownKeys({ title: "x", path: "../../.github/workflows/pwn.yml" })).toEqual(["path"])
  })

  it("accepts exactly the five documented keys and no more", () => {
    expect(
      unknownKeys({
        title: "x",
        body: "y",
        type: "bug",
        priority: "low",
        idempotencyKey: "k",
      }),
    ).toEqual([])
  })

  it("reports every offender, so a client bug is fixed in one round", () => {
    expect(unknownKeys({ path: "a", sha: "b", branch: "c" }).sort()).toEqual([
      "branch",
      "path",
      "sha",
    ])
  })
})

describe("layer 2 — the derived path is re-validated (§6.4/2)", () => {
  it("accepts what derivePath actually produces", () => {
    const path = derivePath("Fog edge flickers when zoomed out", new Date("2026-09-02T14:37:00Z"))
    expect(path).toBe("tickets/inbox/2026-09-02T1437-fog-edge-flickers-when-zoomed-out.md")
    expect(isDerivedPath(path)).toBe(true)
  })

  it("REJECTS a title that slugifies to nothing rather than allowing a fallback name", () => {
    // Criterion 4, and the defect it found. All-emoji is the realistic case — a
    // one-tap capture from a phone keyboard. `derivePath` used to substitute
    // "untitled" here, which is a perfectly legal slug, so this regex PASSED it and
    // a file landed at a name derived from nothing. The fallback is gone; the empty
    // slug now produces a path this rejects, and the route answers 500.
    expect(slugify("🏃‍♂️🌫️🗺️")).toBe("")
    const path = derivePath("🏃‍♂️🌫️🗺️", new Date("2026-09-02T14:37:00Z"))
    expect(path).toBe("tickets/inbox/2026-09-02T1437-.md")
    expect(isDerivedPath(path)).toBe(false)
    expect(DERIVED_PATH_RE.source).toContain("[a-z0-9-]+")
  })

  it.each([
    ["a path outside the inbox", "tickets/open/2026-09-02T1437-x.md"],
    ["traversal", "tickets/inbox/../../x.md"],
    ["a missing timestamp", "tickets/inbox/x.md"],
    ["a malformed timestamp", "tickets/inbox/2026-9-2T1437-x.md"],
    ["an uppercase slug", "tickets/inbox/2026-09-02T1437-Xyz.md"],
    ["a dotted filename", "tickets/inbox/2026-09-02T1437-x.y.md"],
    ["the wrong extension", "tickets/inbox/2026-09-02T1437-x.yml"],
    ["a trailing newline, which $ alone would allow", "tickets/inbox/2026-09-02T1437-x.md\n"],
  ])("rejects %s", (_what, path) => {
    expect(isDerivedPath(path)).toBe(false)
  })
})

describe("layer 3 — the independent prefix guard (§6.4/3)", () => {
  /**
   * Criterion 3, verbatim: every one of these is rejected. The null byte and the
   * backslash are written as ESCAPES — a literal control character in a fixture is
   * invisible in a diff, and in 0018 a file full of literal NULs read as binary and
   * silently disabled the pre-commit scanner over itself.
   */
  it.each([
    ["a path in tickets/open", "tickets/open/x.md"],
    ["a bare traversal", "../x.md"],
    ["traversal out of the inbox", "tickets/inbox/../../x.md"],
    ["a subdirectory", "tickets/inbox/a/b.md"],
    ["a leading-dot filename", "tickets/inbox/.github.md"],
    ["a backslash", "tickets/inbox/2026-09-02T1437-a\\b.md"],
    ["an embedded null byte", "tickets/inbox/2026-09-02T1437-a\u0000b.md"],
    ["the workflows directory", ".github/workflows/pwn.yml"],
    ["the skills directory", ".claude/skills/tickets/SKILL.md"],
    ["an empty filename", "tickets/inbox/"],
  ])("rejects %s", (_what, path) => {
    expect(inboxPathViolation(path)).not.toBeNull()
  })

  it("accepts a well-formed inbox path", () => {
    expect(inboxPathViolation("tickets/inbox/2026-09-02T1437-a-note.md")).toBeNull()
  })

  it("says WHY it rejected, so a firing guard is diagnosable", () => {
    // D-176's rule one level in: a control that cannot report what it saw leaves
    // "rejected for reason X" and "rejected for reason Y" indistinguishable in a log.
    expect(inboxPathViolation("tickets/open/x.md")).toContain("tickets/inbox/")
    expect(inboxPathViolation("tickets/inbox/../x.md")).toContain("..")
    expect(inboxPathViolation("tickets/inbox/a/b.md")).toContain("/")
  })

  it("does not share an implementation with layer 2", async () => {
    // The two layers must fail independently. If layer 3 were written in terms of
    // DERIVED_PATH_RE it would agree with layer 2 by construction and back up
    // nothing — so here is a path layer 2 rejects and layer 3 accepts, which is the
    // observable signature of two genuinely separate checks.
    const path = "tickets/inbox/not-a-timestamp.md"
    expect(isDerivedPath(path)).toBe(false)
    expect(inboxPathViolation(path)).toBeNull()
  })
})

describe("the -2 collision suffix (§6.4/4)", () => {
  it("inserts the suffix before the extension and stays a valid derived path", () => {
    const path = "tickets/inbox/2026-09-02T1437-a-note.md"
    const retry = withCollisionSuffix(path)
    expect(retry).toBe("tickets/inbox/2026-09-02T1437-a-note-2.md")
    expect(isDerivedPath(retry)).toBe(true)
    expect(inboxPathViolation(retry)).toBeNull()
  })
})

describe("the payload secret scan (ticket 0004, §7.3)", () => {
  /**
   * Every fixture here is assembled at runtime rather than written as a literal —
   * the pre-commit hook's literal-pattern layer scans this file too, and it is
   * right to. It blocked the commit on the private-key header, correctly, so that
   * one is split as well rather than exempted with a `gitleaks:allow` marker: a
   * string this file only needs at runtime has no business existing in source.
   */
  it.each([
    ["an AWS key id", fx("AKIA", "QQQQWWWWEEEERRRRTT")],
    ["a classic GitHub token", fx("ghp", "_", "a".repeat(36))],
    ["a fine-grained GitHub token", fx("github_pat", "_", "b".repeat(24))],
    ["a private key header", fx("-----BEGIN RSA ", "PRIVATE KEY", "-----")],
    ["a Slack token", fx("xoxb", "-1234567890-abcdefghij")],
  ])("catches %s in the title", (_what, secret) => {
    expect(secretInPayload(secret, undefined)).not.toBeNull()
  })

  it("catches a secret in the BODY, which is where a pasted error message lands", () => {
    const pasted = `401 from the API. Authorization: Bearer ${fx("ghp", "_", "c".repeat(36))}`
    expect(secretInPayload("Ingest is failing", pasted)).not.toBeNull()
  })

  it("names the shape and never the value", () => {
    const secret = fx("AKIA", "ZZZZXXXXCCCCVVVVBB")
    const verdict = secretInPayload(secret)
    expect(verdict).toBe("an AWS access key id")
    expect(verdict).not.toContain(secret)
  })

  it("passes ordinary prose, including prose that talks about tokens", () => {
    expect(
      secretInPayload(
        "Rotate the GitHub PAT before it expires",
        "It is a fine-grained token, Contents only. Runbook is ticket 0024.",
      ),
    ).toBeNull()
  })

  it("is undisturbed by an absent optional body", () => {
    expect(secretInPayload("A perfectly ordinary note", undefined)).toBeNull()
  })
})
