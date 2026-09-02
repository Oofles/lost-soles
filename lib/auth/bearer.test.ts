import { generateKeyPairSync, createSign } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Ticket 0149. The bearer path's verification, tested against a REAL RSA
 * signature rather than a stubbed verifier.
 *
 * A test that mocks `verify()` and asserts the mock was called proves the
 * plumbing and nothing about the security property. Here a keypair is generated,
 * tokens are signed with it, and the JWKS endpoint the library fetches is stubbed
 * to serve the matching public key — so "a tampered token is rejected" is
 * asserted by the actual signature check, which is the only version of that
 * assertion worth having.
 */

const PRODUCTION_POOL = "us-east-1_3lreDA1d1"
const SANDBOX_POOL = "us-east-1_RV7QIiViX"
const PRODUCTION_CLIENT = "5vc5e8t2ljv1hg3doau5mp0m00"
const SANDBOX_CLIENT = "mvld8ja1nrdmmi9n9ji7j217v"
const REGION = "us-east-1"
const SUB = "5488e4b8-d081-7014-748e-edd1937f8083"

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const KID = "test-key-1"

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

/** The public half, in the JWK shape Cognito's `/.well-known/jwks.json` serves. */
const jwks = () => {
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string }
  return { keys: [{ kty: "RSA", kid: KID, use: "sig", alg: "RS256", n: jwk.n, e: jwk.e }] }
}

type Claims = Record<string, unknown>

function signToken(claims: Claims, { alg = "RS256", kid = KID } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg, kid, typ: "JWT" }))
  const payload = b64url(JSON.stringify({
    sub: SUB,
    iss: `https://cognito-idp.${REGION}.amazonaws.com/${PRODUCTION_POOL}`,
    aud: PRODUCTION_CLIENT,
    token_use: "id",
    auth_time: now,
    iat: now,
    exp: now + 3600,
    ...claims,
  }))
  const signer = createSign("RSA-SHA256")
  signer.update(`${header}.${payload}`)
  return `${header}.${payload}.${b64url(signer.sign(privateKey))}`
}

/** Every JWKS fetch the library makes, so a cache claim can be counted. */
let jwksFetches = 0
let jwksResponder: () => Response

beforeEach(() => {
  jwksFetches = 0
  jwksResponder = () => new Response(JSON.stringify(jwks()), {
    status: 200, headers: { "content-type": "application/json" },
  })
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes("/.well-known/jwks.json")) {
      jwksFetches++
      return jwksResponder()
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

/** Fresh module each time, so module-scope JWKS caching can be observed. */
const load = async () => (await import("./bearer")).verifiedBearerSub

describe("0149 — a valid production ID token", () => {
  it("returns the sub from the verified payload", async () => {
    const verifiedBearerSub = await load()
    expect(await verifiedBearerSub(`Bearer ${signToken({})}`)).toBe(SUB)
  })

  it("accepts the scheme case-insensitively, as RFC 7235 requires", async () => {
    const verifiedBearerSub = await load()
    expect(await verifiedBearerSub(`bearer ${signToken({})}`)).toBe(SUB)
  })
})

describe("0149 — rejection is total, and always looks the same", () => {
  /**
   * Criteria 2, 5, 6 and 7. Every one of these returns undefined, which the
   * callers turn into the SAME 404 a signed-out request gets. A caller that could
   * distinguish "expired" from "wrong pool" from "no header" would be an oracle,
   * which is what §6.5 row 1 spends a 404-instead-of-403 to deny.
   */
  it.each([
    ["no header", () => null],
    ["an empty header", () => ""],
    ["a bare token with no scheme", () => signToken({})],
    ["the wrong scheme", () => `Basic ${signToken({})}`],
    ["a malformed token", () => "Bearer not-a-jwt"],
    ["an EXPIRED token", () => `Bearer ${signToken({ exp: Math.floor(Date.now() / 1000) - 10 })}`],
    ["a token from the SANDBOX pool", () =>
      `Bearer ${signToken({ iss: `https://cognito-idp.${REGION}.amazonaws.com/${SANDBOX_POOL}` })}`],
    ["a token for the SANDBOX app client", () => `Bearer ${signToken({ aud: SANDBOX_CLIENT })}`],
    ["an ACCESS token rather than an ID token", () =>
      `Bearer ${signToken({ token_use: "access" })}`],
    ["a token with no sub", () => `Bearer ${signToken({ sub: undefined })}`],
    ["a token signed by an unknown key", () => `Bearer ${signToken({}, { kid: "other-key" })}`],
  ])("rejects %s", async (_label, make) => {
    const verifiedBearerSub = await load()
    expect(await verifiedBearerSub(make())).toBeUndefined()
  })

  it("rejects a TAMPERED token — the signature check is real", async () => {
    const verifiedBearerSub = await load()
    const token = signToken({})
    // Flip a character in the MIDDLE of the signature. See the test below for
    // why the last character is the wrong one to pick.
    const cut = token.length - 40
    const tampered = token.slice(0, cut) + (token[cut] === "A" ? "B" : "A") + token.slice(cut + 1)
    expect(tampered).not.toBe(token)
    expect(await verifiedBearerSub(`Bearer ${tampered}`)).toBeUndefined()
  })

  /**
   * A trap, asserted so nobody re-lays it. Ticket 0149's criterion 9 originally
   * proposed smoke-testing rejection by altering "the token's last character",
   * and that check can PASS A TAMPERED TOKEN — not because verification is weak,
   * but because the edit does not change the signature.
   *
   * An RSA-2048 signature is 256 bytes = 2048 bits, which base64url encodes in
   * 342 characters carrying 2052 bits. The final character therefore contributes
   * only 2 significant bits and 4 bits of padding, so any two final characters
   * sharing their top 2 bits — 'A' (000000) and 'B' (000001) among them — decode
   * to byte-identical signatures.
   *
   * This test documents the property rather than asserting the token is
   * accepted, so it stays true if a future key size changes the arithmetic:
   * what it pins is that "last character" is not a safe way to corrupt a token.
   */
  it("shows why 'flip the last character' is NOT a valid tamper test", async () => {
    const token = signToken({})
    const swap = (t: string, i: number, c: string) => t.slice(0, i) + c + t.slice(i + 1)
    const decode = (t: string) =>
      Buffer.from(t.split(".")[2].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("hex")
    const last = token.length - 1
    // 'A' and 'B' differ in a padding bit only, so the signature BYTES match.
    expect(decode(swap(token, last, "A"))).toBe(decode(swap(token, last, "B")))
  })

  it("rejects a token whose PAYLOAD was swapped for another sub", async () => {
    const verifiedBearerSub = await load()
    const [header, , signature] = signToken({}).split(".")
    const forged = b64url(JSON.stringify({ sub: "someone-else", token_use: "id" }))
    expect(await verifiedBearerSub(`Bearer ${header}.${forged}.${signature}`)).toBeUndefined()
  })

  it("rejects alg:none — the classic JWT downgrade", async () => {
    const verifiedBearerSub = await load()
    const header = b64url(JSON.stringify({ alg: "none", kid: KID, typ: "JWT" }))
    const payload = b64url(JSON.stringify({
      sub: SUB, token_use: "id", aud: PRODUCTION_CLIENT,
      iss: `https://cognito-idp.${REGION}.amazonaws.com/${PRODUCTION_POOL}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }))
    expect(await verifiedBearerSub(`Bearer ${header}.${payload}.`)).toBeUndefined()
  })
})

describe("0149 — JWKS caching (criterion 3)", () => {
  it("fetches the JWKS once and reuses it across verifications", async () => {
    const verifiedBearerSub = await load()
    expect(await verifiedBearerSub(`Bearer ${signToken({})}`)).toBe(SUB)
    expect(await verifiedBearerSub(`Bearer ${signToken({})}`)).toBe(SUB)
    expect(await verifiedBearerSub(`Bearer ${signToken({})}`)).toBe(SUB)
    expect(jwksFetches).toBe(1)
  })

  it("does NOT cache a failed fetch — a transient error must not disable capture", async () => {
    const verifiedBearerSub = await load()
    // The property `lib/tickets/github.ts` spells out for the SSM token: caching
    // a rejection would kill capture for the whole life of a warm execution
    // environment, which can be hours, on one bad network moment.
    jwksResponder = () => new Response("upstream boom", { status: 500 })
    expect(await verifiedBearerSub(`Bearer ${signToken({})}`)).toBeUndefined()

    jwksResponder = () => new Response(JSON.stringify(jwks()), {
      status: 200, headers: { "content-type": "application/json" },
    })
    expect(await verifiedBearerSub(`Bearer ${signToken({})}`)).toBe(SUB)
    expect(jwksFetches).toBe(2)
  })
})

describe("0149 — the trust anchor is the production pool, stated in one place", () => {
  it("fetches JWKS from the production pool's issuer and nowhere else", async () => {
    const seen: string[] = []
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      seen.push(String(input instanceof Request ? input.url : input))
      return new Response(JSON.stringify(jwks()), {
        status: 200, headers: { "content-type": "application/json" },
      })
    })
    const verifiedBearerSub = await load()
    await verifiedBearerSub(`Bearer ${signToken({})}`)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(
      `https://cognito-idp.${REGION}.amazonaws.com/${PRODUCTION_POOL}/.well-known/jwks.json`)
    // The sandbox pool must appear nowhere in the URL the trust anchor is read from.
    expect(seen[0]).not.toContain(SANDBOX_POOL)
  })
})
