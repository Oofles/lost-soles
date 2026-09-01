import { beforeEach, describe, expect, it, vi } from "vitest"

import { __resetTokenCache, createFile, getToken } from "./github"

/**
 * Ticket 0018. `fetch` and the SSM client are injected, so nothing here touches the
 * network or AWS. Criterion 6 — no update path, no delete path — is asserted on the
 * actual request this builds, not on a promise in a comment.
 */

const token = ["github_pat", "_testtoken000000000000000000"].join("")

describe("createFile is create-only", () => {
  let seen: { url: string; init: RequestInit } | null = null
  const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(url), init: init! }
    return new Response(
      JSON.stringify({ content: { path: "tickets/inbox/x.md" }, commit: { sha: "deadbeef" } }),
      { status: 201, headers: { "content-type": "application/json" } },
    )
  }) as unknown as typeof fetch

  beforeEach(() => {
    seen = null
  })

  const call = () =>
    createFile(
      { path: "tickets/inbox/x.md", content: "hello", message: "capture: x.md", token },
      fakeFetch,
    )

  it("NEVER sends a sha — the key that turns create into overwrite", () => {
    // THE assertion of criterion 6. With a `sha`, GitHub overwrites the file at that
    // path. Without it, an existing path is a 422. An endpoint reachable from a phone
    // that can overwrite arbitrary repository files is a different thing entirely
    // from one that can only add.
    return call().then(() => {
      const body = JSON.parse(seen!.init.body as string)
      expect(body).not.toHaveProperty("sha")
      expect(Object.keys(body).sort()).toEqual(["branch", "content", "message"])
    })
  })

  it("uses PUT against the contents API on main", async () => {
    await call()
    expect(seen!.init.method).toBe("PUT")
    expect(seen!.url).toBe(
      "https://api.github.com/repos/Oofles/lost-soles/contents/tickets/inbox/x.md",
    )
    expect(JSON.parse(seen!.init.body as string).branch).toBe("main")
  })

  it("base64-encodes the content, round-tripping exactly", async () => {
    await createFile(
      { path: "tickets/inbox/x.md", content: "héllo\n---\nnot frontmatter\n", message: "m", token },
      fakeFetch,
    )
    const body = JSON.parse(seen!.init.body as string)
    expect(Buffer.from(body.content, "base64").toString("utf8")).toBe(
      "héllo\n---\nnot frontmatter\n",
    )
  })

  it("returns the committed path and sha", async () => {
    await expect(call()).resolves.toEqual({ path: "tickets/inbox/x.md", commitSha: "deadbeef" })
  })

  it("throws on a non-2xx rather than reporting success", async () => {
    const failing = (async () =>
      new Response("path already exists", { status: 422 })) as unknown as typeof fetch
    await expect(
      createFile({ path: "p", content: "c", message: "m", token }, failing),
    ).rejects.toThrow(/422/)
  })

  it("does not put the token in the thrown error", async () => {
    const failing = (async () =>
      new Response("nope", { status: 401 })) as unknown as typeof fetch
    await expect(
      createFile({ path: "p", content: "c", message: "m", token }, failing),
    ).rejects.toThrow(expect.not.stringContaining("github_pat") as unknown as string)
  })
})

describe("the token is fetched once and cached", () => {
  beforeEach(() => __resetTokenCache())

  const clientReturning = (value: string | undefined, calls: { n: number }) =>
    ({
      send: async () => {
        calls.n += 1
        return { Parameter: value === undefined ? undefined : { Value: value } }
      },
    }) as never

  it("reads SSM once across concurrent callers", async () => {
    // The promise is cached, not the resolved string — two concurrent cold requests
    // would otherwise each fire their own SSM call.
    const calls = { n: 0 }
    const client = clientReturning(token, calls)
    const [a, b] = await Promise.all([getToken(client), getToken(client)])
    expect(a).toBe(token)
    expect(b).toBe(token)
    expect(calls.n).toBe(1)
  })

  it("reuses the cache on a later call", async () => {
    const calls = { n: 0 }
    const client = clientReturning(token, calls)
    await getToken(client)
    await getToken(client)
    expect(calls.n).toBe(1)
  })

  it("fails closed on an absent parameter, naming the parameter and not its value", async () => {
    const calls = { n: 0 }
    await expect(getToken(clientReturning(undefined, calls))).rejects.toThrow(
      /GITHUB_TICKETS_PAT is empty or absent/,
    )
  })

  it("does NOT cache a failure — a transient SSM error must not poison the process", async () => {
    // Caching the rejected promise would break capture for the entire life of the
    // execution environment, which on a warm Lambda can be hours.
    let attempt = 0
    const flaky = {
      send: async () => {
        attempt += 1
        if (attempt === 1) throw new Error("transient")
        return { Parameter: { Value: token } }
      },
    } as never
    await expect(getToken(flaky)).rejects.toThrow("transient")
    await expect(getToken(flaky)).resolves.toBe(token)
    expect(attempt).toBe(2)
  })
})
