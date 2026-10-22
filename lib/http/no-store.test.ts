import { NextResponse } from "next/server"
import { describe, expect, it } from "vitest"

import { IMMUTABLE_PRIVATE, NO_STORE, withNoStore } from "./no-store"

/** C-3, `08-security-privacy.md` §2.4 (ticket 0114). */
describe("withNoStore", () => {
  it("adds `private, no-store` to a response that set nothing (the 404 path every route has)", async () => {
    const GET = withNoStore(async () => NextResponse.json({ error: "not found" }, { status: 404 }))
    const res = await GET()
    expect(res.status).toBe(404)
    expect(res.headers.get("cache-control")).toBe(NO_STORE)
  })

  it("overwrites a shared-cacheable value rather than letting it through", async () => {
    const GET = withNoStore(
      async () => new NextResponse("x", { headers: { "Cache-Control": "public, s-maxage=600" } }),
    )
    expect((await GET()).headers.get("cache-control")).toBe(NO_STORE)
  })

  it("leaves D-228's immutable carve-out exactly as the route set it", async () => {
    const GET = withNoStore(
      async () => new NextResponse("x", { headers: { "Cache-Control": IMMUTABLE_PRIVATE } }),
    )
    expect((await GET()).headers.get("cache-control")).toBe(IMMUTABLE_PRIVATE)
  })

  it("covers a redirect", async () => {
    const GET = withNoStore(async () => NextResponse.redirect("https://example.test/settings", 302))
    const res = await GET()
    expect(res.status).toBe(302)
    expect(res.headers.get("cache-control")).toBe(NO_STORE)
  })

  it("covers a Response whose headers are immutable, by rebuilding it", async () => {
    const GET = withNoStore(async () => Response.redirect("https://example.test/", 307))
    const res = await GET()
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("https://example.test/")
    expect(res.headers.get("cache-control")).toBe(NO_STORE)
  })

  it("passes the handler's arguments through untouched", async () => {
    const POST = withNoStore(async (req: Request, n: number) => new Response(`${req.method}:${n}`))
    const res = await POST(new Request("https://example.test/", { method: "POST" }), 7)
    expect(await res.text()).toBe("POST:7")
  })
})
