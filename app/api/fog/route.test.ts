import { beforeEach, describe, expect, it, vi } from "vitest"

import { RES } from "@/src/domain/fog"
import type { FogUpdate } from "@/lib/fog/wire"

/**
 * THE DELIVERY ROUTES. Ticket `0054`.
 *
 * The session and S3 are mocked; everything else is real — the ETag, the conditional
 * request, the cache headers, the generation parsing. `08-security-privacy.md` §5.3's
 * rule (*"re-derive `sub` from the verified session, never take a uid from a request"*) is
 * the thing these tests are mostly about, and it is enforced by there being no parameter
 * to pass one in.
 */

let signedInAs: string | undefined

vi.mock("@/lib/auth/owner", () => ({
  currentUserId: async () => signedInAs,
  isOwner: (id: string | undefined) => id !== undefined,
}))

const resolveFogUpdate = vi.fn()
const getObject = vi.fn()

vi.mock("@/lib/fog/server", () => ({
  defaultFogReadDeps: () => ({ s3: {}, bucket: "test-bucket" }),
  resolveFogUpdate: (...args: unknown[]) => resolveFogUpdate(...args),
  getObject: (...args: unknown[]) => getObject(...args),
}))

const { GET } = await import("./route")
const { GET: GET_BLOB } = await import("./blob/[gen]/route")

const update = (over: Partial<FogUpdate> = {}): FogUpdate => ({
  generation: 42,
  res: RES,
  cellCount: 1_234,
  deltasFrom: 22,
  plan: "up-to-date",
  ...over,
})

const request = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers })

beforeEach(() => {
  signedInAs = "sub-under-test"
  resolveFogUpdate.mockReset()
  getObject.mockReset()
})

describe("GET /api/fog", () => {
  it("404s a signed-out caller, byte-identical to what middleware returns", async () => {
    signedInAs = undefined
    const response = await GET(request("https://example.test/api/fog?since=0"))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "not found" })
    // And it never looked anything up: authorization runs before any S3 read.
    expect(resolveFogUpdate).not.toHaveBeenCalled()
  })

  it("reads the uid from the session and never from the query string", async () => {
    resolveFogUpdate.mockResolvedValue(update())
    await GET(request("https://example.test/api/fog?since=42&uid=somebody-else"))

    expect(resolveFogUpdate).toHaveBeenCalledWith("sub-under-test", 42, expect.anything())
  })

  it("carries the plan, an ETag of the generation, and a private no-store policy", async () => {
    resolveFogUpdate.mockResolvedValue(update({ plan: "full" }))
    const response = await GET(request("https://example.test/api/fog?since=0"))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ plan: "full", generation: 42, res: RES })
    expect(response.headers.get("ETag")).toBe('"42"')
    /**
     * `private` is doing real work: the app sits behind a CDN and this body describes one
     * person's map. `no-store` keeps it out of the browser's cache; `private` keeps it out
     * of every shared cache in between.
     */
    expect(response.headers.get("Cache-Control")).toBe("no-store, private")
  })

  /** Criterion 6's server half, and this ticket's second operator check. */
  it("answers 304 with no body to a conditional request that already has this generation", async () => {
    resolveFogUpdate.mockResolvedValue(update())
    const response = await GET(
      request("https://example.test/api/fog?since=42", { "if-none-match": '"42"' }),
    )

    expect(response.status).toBe(304)
    expect(response.headers.get("ETag")).toBe('"42"')
    expect(await response.text()).toBe("")
  })

  it("answers 200 to an unconditional caller, because a bare 304 is not a conformant reply", async () => {
    // `curl` and the deployment smoke test. The same fact, said in a body.
    resolveFogUpdate.mockResolvedValue(update())
    const response = await GET(request("https://example.test/api/fog?since=42"))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ plan: "up-to-date" })
  })

  it("does not 304 a user who has published nothing", async () => {
    // Generation 0 is the "nothing cached" sentinel on the way in and the "nothing
    // published" sentinel on the way out. A 304 between the two would leave a new user
    // with an empty body and no plan.
    resolveFogUpdate.mockResolvedValue(update({ generation: 0, plan: "empty" }))
    const response = await GET(
      request("https://example.test/api/fog?since=0", { "if-none-match": '"0"' }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ plan: "empty" })
  })

  it.each([
    ["", 0],
    ["not-a-number", 0],
    ["-4", 0],
    ["1e400", 0],
    ["3.5", 0],
    ["41", 41],
  ])("parses since=%s as %i", async (raw, expected) => {
    resolveFogUpdate.mockResolvedValue(update())
    await GET(request(`https://example.test/api/fog?since=${encodeURIComponent(raw)}`))

    expect(resolveFogUpdate).toHaveBeenCalledWith("sub-under-test", expected, expect.anything())
  })
})

describe("GET /api/fog/blob/<generation>", () => {
  const params = (gen: string) => ({ params: Promise.resolve({ gen }) })

  it("404s a signed-out caller before touching S3", async () => {
    signedInAs = undefined
    const response = await GET_BLOB(request("https://example.test/api/fog/blob/42"), params("42"))

    expect(response.status).toBe(404)
    expect(getObject).not.toHaveBeenCalled()
  })

  it("serves the bytes under the caller's own key, immutable and private", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4])
    getObject.mockResolvedValue(bytes)

    const response = await GET_BLOB(request("https://example.test/api/fog/blob/42"), params("42"))

    expect(response.status).toBe(200)
    expect(getObject).toHaveBeenCalledWith(
      "users/sub-under-test/explored/explored-r10.42.bin",
      expect.anything(),
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream")
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable")
  })

  it.each(["0", "-1", "abc", "1.5", "../../raw/secrets", "42; DROP"])(
    "404s the generation %s without building a key from it",
    async (gen) => {
      const response = await GET_BLOB(
        request(`https://example.test/api/fog/blob/${gen}`),
        params(gen),
      )

      expect(response.status).toBe(404)
      // The value is turned into a NUMBER before it can reach `objectKeys.cells`, so no
      // string a caller supplies is ever interpolated into an S3 key.
      expect(getObject).not.toHaveBeenCalled()
    },
  )

  it("404s a generation that was allocated and never published", async () => {
    // A worker that lost the manifest race (D-219) burns a number and writes no object.
    // A normal outcome: the client's remedy is to re-read the manifest.
    getObject.mockResolvedValue(undefined)
    const response = await GET_BLOB(request("https://example.test/api/fog/blob/43"), params("43"))

    expect(response.status).toBe(404)
  })
})
