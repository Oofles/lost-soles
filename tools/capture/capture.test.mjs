import { execFileSync } from "node:child_process"

import { describe, expect, it } from "vitest"

/**
 * Tests for `capture.sh`, the capture endpoint's non-browser client.
 *
 * Originally ticket 0020, where this script was the reference implementation a
 * phone macro would transcribe. **That macro was declined (D-184); 0020, 0021 and
 * 0022 are closed as declined.** The script and these tests are retained because
 * the three things they assert — the 200-character title/body split, the JSON
 * escaping, and the single generation of the idempotency key per capture — are
 * requirements of *any* client of POST /api/tickets/capture, including the
 * /dev/tickets UI in capability 17. They are the three ways a captured note can be
 * silently corrupted, and they are cheaper to assert here than to discover later.
 *
 * The `0020 —` prefixes on the describe blocks below are left as written: they are
 * the provenance of each test, not a claim that the tile exists.
 */

const SCRIPT = new URL("./capture.sh", import.meta.url).pathname

const dry = (text, env = {}) =>
  JSON.parse(execFileSync(SCRIPT, ["--dry-run", text], {
    encoding: "utf8", env: { ...process.env, ...env },
  }))

describe("0020 — the request body the tile sends", () => {
  it("sends the five accepted keys and nothing else", () => {
    // §6.4 rejects unknown keys rather than stripping them, so an extra field is
    // a 400 the operator reads as "capture failed" with no clue why.
    expect(Object.keys(dry("a short note")).sort())
      .toEqual(["idempotencyKey", "priority", "title", "type"])
  })

  it("omits `body` entirely for a short dictation rather than sending an empty one", () => {
    expect(dry("a short note")).not.toHaveProperty("body")
  })

  it("uses the enum values the endpoint accepts", () => {
    const b = dry("a short note")
    expect(b.type).toBe("feature")
    expect(b.priority).toBe("med")
  })
})

describe("0020 — a dictation over 200 characters loses nothing", () => {
  const long = "x".repeat(250)

  it("truncates the title to exactly 200 characters", () => {
    expect(dry(long).title).toHaveLength(200)
  })

  it("puts the FULL text in the body, not the remainder", () => {
    // The remainder would start mid-word under a truncated title, which is
    // harder to read at triage than a truncated title above the whole thing.
    expect(dry(long).body).toHaveLength(250)
    expect(dry(long).body).toBe(long)
  })

  it("keeps the first 200 characters of the real text, in order", () => {
    const sentence = "the fog boundary reads as a hard line on the dark basemap and it should feather instead " +
      "because at night the contrast is what makes the explored area legible rather than the edge itself " +
      "which currently dominates the whole view"
    const b = dry(sentence)
    expect(sentence.length).toBeGreaterThan(200)
    expect(b.title).toBe(sentence.slice(0, 200))
    expect(b.body).toBe(sentence)
  })

  it("sends no body at exactly 200 characters, and one at 201", () => {
    expect(dry("y".repeat(200))).not.toHaveProperty("body")
    expect(dry("y".repeat(201))).toHaveProperty("body")
  })
})

describe("0020 — JSON escaping, because the phone has no jq either", () => {
  it.each([
    ['he said "run" loudly', 'double quotes'],
    ["a backslash \\ mid-sentence", "a backslash"],
    ['both " and \\ together', "both, where order of escaping matters"],
  ])("round-trips %j — %s", (text) => {
    // Parsing the output at all is the assertion: a mis-escaped payload is not
    // valid JSON, and the endpoint would answer 400 "body must be JSON".
    expect(dry(text).title).toBe(text)
  })

  it("carries a frontmatter-forging title as DATA, without breaking the JSON", () => {
    // §6.5's row "Title crafted as x\n---\nid: 1\n...". Two different jobs, and
    // this is the client's half only: the newline must be escaped so it cannot
    // terminate the JSON string, and the text must arrive intact.
    //
    // Neutralising the YAML is the SERVER's half (§6.4/6 — a real serializer,
    // newlines normalised to spaces) and is deliberately NOT duplicated here. A
    // client-side strip would make this payload look safe while telling us
    // nothing about whether the server's control still works.
    const nasty = 'x\n---\nid: 1\nstatus: closed\n---'
    expect(dry(nasty).title).toBe(nasty)
  })

  it("trims trailing newlines, which is shell substitution and not a decision", () => {
    // `$(...)` strips trailing newlines. Recorded rather than left as folklore:
    // it is harmless for dictation (speech-to-text emits none) and it means the
    // script cannot round-trip text that deliberately ends in a blank line.
    expect(dry("ends with a newline\n").title).toBe("ends with a newline")
  })
})

describe("0020 — the idempotency key (criterion 4)", () => {
  it("generates a UUID when none is supplied", () => {
    expect(dry("a note").idempotencyKey)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it("generates a DIFFERENT key for each separate capture", () => {
    expect(dry("a note").idempotencyKey).not.toBe(dry("a note").idempotencyKey)
  })

  it("reuses a supplied key verbatim, which is what makes a retry safe", () => {
    // The retry path (0022) re-runs the script with the key it already has. If
    // this regenerated, one dictated note would commit N times the first time
    // the network timed out after the server had already written the file.
    const key = "11111111-2222-3333-4444-555555555555"
    const a = dry("a note", { LOST_SOLES_IDEMPOTENCY_KEY: key })
    const b = dry("a note", { LOST_SOLES_IDEMPOTENCY_KEY: key })
    expect(a.idempotencyKey).toBe(key)
    expect(b.idempotencyKey).toBe(key)
  })
})
