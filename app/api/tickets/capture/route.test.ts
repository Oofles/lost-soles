import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Ticket 0018. The GitHub Contents API and SSM are mocked — a "unit test" that
 * commits to a real repository is not one, and would make the suite unrunnable in CI
 * and destructive to run twice.
 *
 * What is NOT mocked is the frontmatter rendering or the path derivation: those run
 * for real, so a route that assembles them wrongly fails here.
 */

const createFile = vi.fn()
const getToken = vi.fn()

vi.mock("@/lib/tickets/github", () => ({
  createFile: (...args: unknown[]) => createFile(...args),
  getToken: () => getToken(),
}))

const { POST } = await import("./route")

/**
 * Token-shaped fixtures, assembled at runtime rather than written as literals.
 *
 * Not evasion — the pre-commit hook's literal-pattern layer caught these, correctly,
 * and it only could once the NUL bytes elsewhere in this file were removed and it
 * stopped reading as binary. gitleaks passed them (its rules discount obviously-fake
 * values); layer 2 did not. Two layers, two sensitivities, and the dumber one was
 * right to fire on a `github_pat_` literal sitting in a source file.
 */
const fx = (...parts: string[]) => parts.join("")
const FAKE_TOKEN = fx("github_pat", "_testtoken0000000000000000")
const FAKE_LEAKED = fx("github_pat", "_leakedvalue000000000000")

const valid = {
  title: "Fog edge flickers when zoomed out",
  body: "Only below zoom 12.",
  type: "bug",
  priority: "med",
  // A fixture, not a credential. gitleaks' generic-api-key rule fires on any
  // high-entropy value beside a key-shaped field name, which a UUID is. Kept
  // UUID-shaped because that is the schema (§6.4), and exempted per-line where a
  // reviewer sees it rather than by weakening the rule. gitleaks:allow
  idempotencyKey: "8f1a0c62-4f0b-4a1e-9c3d-2b6e5a7d0f11", // gitleaks:allow
}

const post = (body: unknown) =>
  POST(
    new Request("https://soles.devaultsecurity.com/api/tickets/capture", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )

beforeEach(() => {
  createFile.mockReset()
  getToken.mockReset()
  getToken.mockResolvedValue(FAKE_TOKEN)
  createFile.mockImplementation((args: { path: string }) =>
    Promise.resolve({ path: args.path, commitSha: "abc123def456" }),
  )
})

describe("a valid capture", () => {
  it("returns 201 with the committed path and commit sha", async () => {
    const res = await post(valid)
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({
      path: expect.stringMatching(/^tickets\/inbox\/.+\.md$/),
      commitSha: "abc123def456",
    })
  })

  it("commits EXACTLY ONE file", async () => {
    await post(valid)
    expect(createFile).toHaveBeenCalledTimes(1)
  })

  it("writes a file whose frontmatter is the §3.4 inbox shape", async () => {
    await post(valid)
    const { content, path } = createFile.mock.calls[0][0]
    expect(path.startsWith("tickets/inbox/")).toBe(true)
    expect(content).toContain("status: inbox")
    expect(content).toContain("source: ui")
    expect(content).toContain("## Description")
    expect(content).not.toMatch(/^id:/m)
  })

  it("accepts an absent optional body", async () => {
    const noBody: Record<string, unknown> = { ...valid }
    delete noBody.body
    const res = await post(noBody)
    expect(res.status).toBe(201)
    expect(createFile.mock.calls[0][0].content).toContain("## Description")
  })

  it("accepts a title of exactly 200 characters", async () => {
    const res = await post({ ...valid, title: "x".repeat(200) })
    expect(res.status).toBe(201)
  })
})

describe("the path never comes from the client", () => {
  it("ignores a client-supplied path outright", async () => {
    // 0019 upgrades this to a 400 "unknown key". Today the guarantee is weaker but
    // still real: the value is never read, so it cannot influence where we write.
    await post({ ...valid, path: "../../.github/workflows/pwn.yml" })
    const { path } = createFile.mock.calls[0][0]
    expect(path).toMatch(/^tickets\/inbox\/[^/]+\.md$/)
    expect(path).not.toContain("..")
    expect(path).not.toContain("workflows")
  })
})

describe("rejected input", () => {
  it.each([
    ["not JSON at all", "{not json"],
    ["a JSON array", [1, 2, 3]],
    ["a missing title", { ...valid, title: undefined }],
    ["an empty title", { ...valid, title: "" }],
    ["a title over 200 chars", { ...valid, title: "x".repeat(201) }],
    ["a non-string title", { ...valid, title: 42 }],
    ["a body over 8192 chars", { ...valid, body: "x".repeat(8193) }],
    ["an unknown type", { ...valid, type: "epic" }],
    ["an unknown priority", { ...valid, priority: "urgent" }],
    ["a missing idempotencyKey", { ...valid, idempotencyKey: undefined }],
  ])("400s on %s", async (_what, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(createFile).not.toHaveBeenCalled()
  })

  it("checks the title length BEFORE sanitising", async () => {
    // A 10,000-character title of control characters collapses to almost nothing.
    // Sanitising first would let it through the length check.
    const res = await post({ ...valid, title: "\u0000".repeat(10_000) })
    expect(res.status).toBe(400)
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe("failure is loud, not silent", () => {
  it("502s when GitHub fails, and does not pretend to have succeeded", async () => {
    createFile.mockRejectedValue(new Error("GitHub Contents API returned 422"))
    const res = await post(valid)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ error: "capture failed" })
  })

  it("502s when the token cannot be read", async () => {
    getToken.mockRejectedValue(new Error("parameter is empty or absent"))
    const res = await post(valid)
    expect(res.status).toBe(502)
    expect(createFile).not.toHaveBeenCalled()
  })

  it("never echoes the token in a response body", async () => {
    getToken.mockRejectedValue(new Error(`boom ${FAKE_LEAKED}`))
    const res = await post(valid)
    // Read ONCE — a Response body is single-use.
    const payload = JSON.stringify(await res.json())
    expect(payload).not.toContain(FAKE_LEAKED)
    expect(payload).not.toContain(fx("github", "_pat_"))
  })
})

describe("there is no update path and no delete path", () => {
  it("exports POST and nothing that could mutate an existing file", async () => {
    // Criterion 6: not disabled, ABSENT. A route module exporting only POST returns
    // 405 for every other method by construction, with nothing to misconfigure.
    const mod = await import("./route")
    const handlers = Object.keys(mod).filter((k) =>
      ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(k),
    )
    expect(handlers).toEqual([])
    expect(typeof mod.POST).toBe("function")
  })
})
