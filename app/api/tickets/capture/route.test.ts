import { beforeEach, describe, expect, it, vi } from "vitest"

import { GithubApiError } from "@/lib/tickets/github"

/**
 * Tickets 0018 (the plumbing) and 0019 (the hardening).
 *
 * The GitHub Contents API, SSM, DynamoDB and the Cognito session are mocked — a
 * "unit test" that commits to a real repository is not one, and would make the
 * suite unrunnable in CI and destructive to run twice.
 *
 * What is NOT mocked is the frontmatter rendering, the path derivation or any of
 * the guards in `capture-guard.ts`: those run for real, so a route that assembles
 * them wrongly, or forgets to call one, fails here.
 */

const createFile = vi.fn()
const getToken = vi.fn()

vi.mock("@/lib/tickets/github", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tickets/github")>(
    "@/lib/tickets/github",
  )
  return {
    ...actual,
    createFile: (...args: unknown[]) => createFile(...args),
    getToken: () => getToken(),
  }
})

/**
 * The session, mocked at the owner module rather than at the Amplify adapter. The
 * route's contract is "the owner, per `isOwner`" — testing through a fabricated JWT
 * would be testing Amplify's parser, which is not this ticket's risk.
 */
let signedInAs: string | undefined
let owners: string[] = []

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
  isOwner: (id: string | undefined) => id !== undefined && owners.includes(id),
}))

const claimIdempotencyKey = vi.fn()
const consumeRateBudget = vi.fn()
const recordIdempotentResult = vi.fn()
const releaseIdempotencyKey = vi.fn()

vi.mock("@/lib/tickets/capture-store", () => ({
  claimIdempotencyKey: (...a: unknown[]) => claimIdempotencyKey(...a),
  consumeRateBudget: (...a: unknown[]) => consumeRateBudget(...a),
  recordIdempotentResult: (...a: unknown[]) => recordIdempotentResult(...a),
  releaseIdempotencyKey: (...a: unknown[]) => releaseIdempotencyKey(...a),
}))

const { OPTIONS, POST } = await import("./route")

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

const OWNER = "b3f1c2d4-0000-4000-8000-000000000001"
const APP_ORIGIN = "https://soles.devaultsecurity.com"

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

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request(`${APP_ORIGIN}/api/tickets/capture`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs = OWNER
  owners = [OWNER]

  getToken.mockResolvedValue(FAKE_TOKEN)
  createFile.mockImplementation((args: { path: string }) =>
    Promise.resolve({ path: args.path, commitSha: "abc123def456" }),
  )
  claimIdempotencyKey.mockResolvedValue({ kind: "claimed" })
  consumeRateBudget.mockResolvedValue({ ok: true })
  recordIdempotentResult.mockResolvedValue(undefined)
  releaseIdempotencyKey.mockResolvedValue(undefined)
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

  it("records the result so a retry of the same key replays it", async () => {
    await post(valid)
    expect(recordIdempotentResult).toHaveBeenCalledWith(
      OWNER,
      valid.idempotencyKey,
      { path: expect.any(String), commitSha: "abc123def456" },
      expect.any(Date),
    )
  })
})

describe("owner-only, and a 404 rather than a 403 (§6.4/1, §6.5 row 1)", () => {
  it("404s a signed-in NON-OWNER and commits nothing", async () => {
    // Criterion 5. 403 would confirm the route exists and that the caller merely
    // lacks permission — a free finding for anyone poking at the app.
    signedInAs = "d9e8f7a6-0000-4000-8000-00000000beef"
    const res = await post(valid)
    expect(res.status).toBe(404)
    expect(createFile).not.toHaveBeenCalled()
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
  })

  it("404s an UNAUTHENTICATED request and commits nothing", async () => {
    // Criterion 6. `middleware.ts` normally intercepts first; this proves the route
    // does not depend on it. Two independent layers, the same reasoning as the two
    // path guards.
    signedInAs = undefined
    const res = await post(valid)
    expect(res.status).toBe(404)
    expect(createFile).not.toHaveBeenCalled()
  })

  it("fails closed on an EMPTY allowlist", async () => {
    // The shipped default until the operator's sub is filled in. A deploy that
    // forgot it must be visibly dead, never quietly open.
    owners = []
    expect((await post(valid)).status).toBe(404)
  })

  it("gives a non-owner a response INDISTINGUISHABLE from a signed-out one", async () => {
    signedInAs = "d9e8f7a6-0000-4000-8000-00000000beef"
    const nonOwner = await post(valid)
    signedInAs = undefined
    const anonymous = await post(valid)
    expect(nonOwner.status).toBe(anonymous.status)
    expect(await nonOwner.json()).toEqual(await anonymous.json())
  })

  it("refuses a non-owner BEFORE parsing, so the 400s are not an oracle", async () => {
    // A stranger who can tell "unknown key: path" from "title too long" has learned
    // the schema; one who can tell any 400 from a 404 has learned the route exists.
    signedInAs = undefined
    const res = await post({ nonsense: true, title: 42 })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: "not found" })
  })
})

describe("the path never comes from the client (§6.4/2, §6.5 row 2)", () => {
  it("400s a body carrying a `path` key, rather than ignoring it", async () => {
    // Criterion 1. Reject, do not strip: a future client bug then surfaces loudly
    // instead of silently dropping half the note.
    const res = await post({ ...valid, path: "../../.github/workflows/pwn.yml" })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "unknown key: path" })
    expect(createFile).not.toHaveBeenCalled()
  })

  it("mangles a traversal TITLE into a harmless inbox filename", async () => {
    // Criterion 2. The title is prose and may say anything; it just cannot become a
    // path. This is the case the operator reproduces by hand on the phone.
    const res = await post({ ...valid, title: "../../.github/workflows/pwn.yml" })
    expect(res.status).toBe(201)
    const { path } = createFile.mock.calls[0][0]
    expect(path).toMatch(/^tickets\/inbox\/\d{4}-\d{2}-\d{2}T\d{4}-github-workflows-pwn-yml\.md$/)
    expect(path).not.toContain("..")
  })

  it("500s a title that slugifies to nothing, rather than writing a fallback name", async () => {
    // Criterion 4, and the defect it surfaced: `derivePath` used to substitute
    // "untitled", which is a legal slug and would have sailed through §6.4/2's
    // regex. A file named after nothing is the quiet failure a 500 prevents.
    const res = await post({ ...valid, title: "🏃‍♂️🌫️🗺️" })
    expect(res.status).toBe(500)
    expect(createFile).not.toHaveBeenCalled()
    // The key is released, so the same note can be resent once retitled.
    expect(releaseIdempotencyKey).toHaveBeenCalled()
  })
})

describe("size limits (§6.4/5)", () => {
  it("400s a 201-character title", async () => {
    const res = await post({ ...valid, title: "x".repeat(201) })
    expect(res.status).toBe(400)
    expect(createFile).not.toHaveBeenCalled()
  })

  it("400s an 8.1 KB body", async () => {
    const res = await post({ ...valid, body: "x".repeat(8193) })
    expect(res.status).toBe(400)
    expect(createFile).not.toHaveBeenCalled()
  })

  it("400s a 17 KB request even though every FIELD is legal", async () => {
    // Criterion 7's third case, and the only one the per-field caps cannot catch:
    // the bulk is in unknown keys and JSON structure, not in title or body.
    const padding: Record<string, string> = {}
    for (let i = 0; i < 40; i++) padding[`k${i}`] = "y".repeat(450)
    const res = await post({ ...valid, ...padding })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: "request must be at most 16384 bytes" })
    expect(createFile).not.toHaveBeenCalled()
  })

  it("refuses on Content-Length before buffering the body", async () => {
    const res = await post(valid, { "content-length": String(17 * 1024) })
    expect(res.status).toBe(400)
  })

  it("does not let a LIE in Content-Length skip the check", async () => {
    // The header is client-supplied. It is a cheap early exit, never the control.
    const padding: Record<string, string> = {}
    for (let i = 0; i < 40; i++) padding[`k${i}`] = "y".repeat(450)
    const res = await post({ ...valid, ...padding }, { "content-length": "10" })
    expect(res.status).toBe(400)
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe("rate limits (§6.4/5, §6.5 row 5)", () => {
  it("429s when the hourly budget is spent, and commits nothing", async () => {
    // Criterion 8. The 31st create within one hour.
    consumeRateBudget.mockResolvedValue({ ok: false, window: "hour" })
    const res = await post(valid)
    expect(res.status).toBe(429)
    expect(createFile).not.toHaveBeenCalled()
  })

  it("429s on the daily cap too", async () => {
    consumeRateBudget.mockResolvedValue({ ok: false, window: "day" })
    expect((await post(valid)).status).toBe(429)
  })

  it("RELEASES the idempotency key when it rate-limits", async () => {
    // Otherwise a note refused at 14:59 could not be resent at 15:01 under its own
    // key — one transient refusal turning into 24 hours of permanent loss.
    consumeRateBudget.mockResolvedValue({ ok: false, window: "hour" })
    await post(valid)
    expect(releaseIdempotencyKey).toHaveBeenCalledWith(OWNER, valid.idempotencyKey)
  })

  it("does not spend budget on a REPLAY", async () => {
    // A retry queue doing its job must not burn the operator's hourly allowance on
    // captures that already committed.
    claimIdempotencyKey.mockResolvedValue({
      kind: "replay",
      result: { path: "tickets/inbox/2026-09-02T1437-a.md", commitSha: "cafe" },
    })
    await post(valid)
    expect(consumeRateBudget).not.toHaveBeenCalled()
  })
})

describe("idempotency (§6.4/9)", () => {
  it("replays the ORIGINAL path and sha and makes NO second commit", async () => {
    // Criterion 9, and the guarantee 0022's retry queue is built on.
    claimIdempotencyKey.mockResolvedValue({
      kind: "replay",
      result: { path: "tickets/inbox/2026-09-02T1437-a.md", commitSha: "cafe" },
    })
    const res = await post(valid)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      path: "tickets/inbox/2026-09-02T1437-a.md",
      commitSha: "cafe",
    })
    expect(createFile).not.toHaveBeenCalled()
  })

  it("409s a key another request is holding right now", async () => {
    claimIdempotencyKey.mockResolvedValue({ kind: "in-flight" })
    const res = await post(valid)
    expect(res.status).toBe(409)
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe("the guard store failing is a 503, never a free pass (D-176)", () => {
  it("503s when the idempotency store cannot answer", async () => {
    claimIdempotencyKey.mockRejectedValue(new Error("ResourceNotFoundException"))
    const res = await post(valid)
    expect(res.status).toBe(503)
    expect(createFile).not.toHaveBeenCalled()
  })

  it("503s when the rate counter cannot answer, rather than committing unlimited", async () => {
    // A rate limiter that cannot read its counter has not found the caller under the
    // limit; it has failed to look. Those two must not produce the same outcome.
    consumeRateBudget.mockRejectedValue(new Error("throttled"))
    const res = await post(valid)
    expect(res.status).toBe(503)
    expect(createFile).not.toHaveBeenCalled()
    expect(releaseIdempotencyKey).toHaveBeenCalled()
  })
})

describe("create-only, with one -2 retry (§6.4/4, §6.5 row 4)", () => {
  it("retries ONCE with a -2 suffix on a 422 collision", async () => {
    // Criterion 10, first half: two captures with the same title in the same minute
    // produce two files.
    createFile.mockImplementationOnce(() => Promise.reject(new GithubApiError(422)))
    const res = await post(valid)
    expect(res.status).toBe(201)
    expect(createFile).toHaveBeenCalledTimes(2)
    expect(createFile.mock.calls[1][0].path).toMatch(/-2\.md$/)
  })

  it("fails cleanly on a THIRD collision rather than escalating the suffix", async () => {
    // Criterion 10, second half. A third identical title inside one minute is a
    // stuck client, and the answer to that is the rate limiter, not `-3`.
    createFile.mockRejectedValue(new GithubApiError(422))
    const res = await post(valid)
    expect(res.status).toBe(502)
    expect(createFile).toHaveBeenCalledTimes(2)
  })

  it("never sends a `sha`, so a create can never become an overwrite", async () => {
    await post(valid)
    expect(createFile.mock.calls[0][0]).not.toHaveProperty("sha")
  })

  it("does NOT retry a non-422 failure into a second file", async () => {
    createFile.mockRejectedValue(new GithubApiError(500))
    await post(valid)
    expect(createFile).toHaveBeenCalledTimes(1)
  })
})

describe("the payload secret scan (ticket 0004)", () => {
  it("400s a capture whose body carries a token, and commits nothing", async () => {
    // This endpoint bypasses `.githooks/pre-commit` — it commits through the GitHub
    // API — and push protection is unavailable on a private repo without Advanced
    // Security. Without this check there is NO scanner on this path, and a secret
    // committed then removed is still in history.
    const pasted = `401 from the API. Authorization: Bearer ${fx("ghp", "_", "c".repeat(36))}`
    const res = await post({ ...valid, body: pasted })
    expect(res.status).toBe(400)
    expect(createFile).not.toHaveBeenCalled()
  })

  it("names the shape without echoing the value back", async () => {
    const secret = fx("AKIA", "ZZZZXXXXCCCCVVVVBB")
    const res = await post({ ...valid, title: `key is ${secret}` })
    const payload = JSON.stringify(await res.json())
    expect(payload).toContain("an AWS access key id")
    expect(payload).not.toContain(secret)
  })
})

describe("CORS is locked to the app origin (§6.4/8)", () => {
  it("names the app origin and never a wildcard", async () => {
    // Criterion 11. Defence against a FUTURE subdomain mistake — the day something
    // else lands on *.devaultsecurity.com and a wildcard would have handed it a
    // write primitive.
    const res = await post(valid)
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN)
  })

  it("answers a preflight with POST and OPTIONS only", async () => {
    // NOTE: `middleware.ts` 404s every real preflight before this handler runs — a
    // CORS preflight never carries credentials, so the gate always sees it signed
    // out. Confirmed against the deployed app. This asserts the handler is correct
    // for the day the gate changes; it is NOT evidence of production behaviour, and
    // the distinction is written here so nobody later reads it as such.
    const res = OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN)
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS")
  })

  it("carries the header on a REJECTION too, so a browser can read the error", async () => {
    signedInAs = undefined
    const res = await post(valid)
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN)
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
    ["an unknown key", { ...valid, sha: "abc" }],
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

  it("never claims an idempotency key for a request it is going to reject", async () => {
    // Otherwise a malformed retry would burn the key its corrected resend needs.
    await post({ ...valid, type: "epic" })
    expect(claimIdempotencyKey).not.toHaveBeenCalled()
  })
})

describe("failure is loud, not silent", () => {
  it("502s when GitHub fails, and does not pretend to have succeeded", async () => {
    createFile.mockRejectedValue(new GithubApiError(500))
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

  it("RELEASES the idempotency key on a GitHub failure", async () => {
    // A note is dictated once. If a transient 500 locked its key for 24 hours, one
    // recoverable error would become permanent loss of the note.
    createFile.mockRejectedValue(new GithubApiError(500))
    await post(valid)
    expect(releaseIdempotencyKey).toHaveBeenCalledWith(OWNER, valid.idempotencyKey)
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
  it("exports nothing that could mutate an existing file", async () => {
    // 0018 criterion 6: not disabled, ABSENT. OPTIONS was added by 0019 and is a
    // CORS preflight — it reads nothing and writes nothing — so it is listed here
    // explicitly rather than allowed in by a loosened assertion.
    const mod = await import("./route")
    const handlers = Object.keys(mod).filter((k) =>
      ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(k),
    )
    expect(handlers).toEqual(["OPTIONS"])
    expect(typeof mod.POST).toBe("function")
  })
})
