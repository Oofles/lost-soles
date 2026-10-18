import { describe, expect, it, vi } from "vitest"

import { createParameterReader, ParameterReadError } from "./ssm-reader"

/**
 * Ticket 0286 — the hand-signed SSM `GetParameter` (D-NEW-a). The request shape IS the contract with
 * SSM, so it is pinned byte for byte where it can be, and by pattern where SigV4 makes it vary.
 */
const NAME = "/amplify/shared/app/WEBHOOK_TOKEN_UNDER_TEST"
const VALUE = "secretValueThatMustNeverBeLogged9Qx"
const credentials = async () => ({ accessKeyId: "AKIDTESTONLY", secretAccessKey: "test-secret-key" })

function fakeFetch(status: number, body: string) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(body, { status, headers: { "content-type": "application/x-amz-json-1.1" } })
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe("the request", () => {
  it("is one signed JSON-1.1 POST to the region's SSM host, asking for decryption", async () => {
    const { fn, calls } = fakeFetch(200, JSON.stringify({ Parameter: { Name: NAME, Value: VALUE } }))
    const read = createParameterReader({ region: "us-east-1", credentials, fetch: fn })

    expect(await read(NAME)).toBe(VALUE)
    expect(calls).toHaveLength(1)
    const [{ url, init }] = calls
    expect(url).toBe("https://ssm.us-east-1.amazonaws.com/")
    expect(init.method).toBe("POST")
    expect(JSON.parse(String(init.body))).toEqual({ Name: NAME, WithDecryption: true })

    const headers = init.headers as Record<string, string>
    expect(headers["x-amz-target"]).toBe("AmazonSSM.GetParameter")
    expect(headers["content-type"]).toBe("application/x-amz-json-1.1")
    expect(headers.host).toBe("ssm.us-east-1.amazonaws.com")
    expect(headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/)
    expect(headers["x-amz-content-sha256"] ?? "").not.toBe("UNSIGNED-PAYLOAD")
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDTESTONLY\/\d{8}\/us-east-1\/ssm\/aws4_request, SignedHeaders=[a-z0-9;-]*x-amz-target[a-z0-9;-]*, Signature=[0-9a-f]{64}$/,
    )
    // The target header is SIGNED, so it cannot be swapped for another action in flight.
    expect(headers.authorization).toMatch(/SignedHeaders=[^,]*\bhost\b/)
  })

  it("follows the region it is given", async () => {
    const { fn, calls } = fakeFetch(200, JSON.stringify({ Parameter: { Value: VALUE } }))
    await createParameterReader({ region: "eu-west-2", credentials, fetch: fn })(NAME)
    expect(calls[0].url).toBe("https://ssm.eu-west-2.amazonaws.com/")
    expect((calls[0].init.headers as Record<string, string>).authorization).toContain("/eu-west-2/ssm/aws4_request")
  })
})

describe("a bad answer fails closed, and never quotes the response", () => {
  const cases: Array<[string, number, string]> = [
    ["a 400 (ParameterNotFound)", 400, JSON.stringify({ __type: "ParameterNotFound", message: `${NAME} ${VALUE}` })],
    ["a 403 (AccessDenied)", 403, JSON.stringify({ __type: "AccessDeniedException", message: VALUE })],
    ["a 500", 500, VALUE],
    ["a 200 that is not JSON", 200, `<html>${VALUE}`],
    ["a 200 with no Parameter", 200, JSON.stringify({ other: VALUE })],
    ["a 200 with a non-string Value", 200, JSON.stringify({ Parameter: { Value: 42 } })],
    ["a 200 of JSON null", 200, "null"],
  ]
  for (const [label, status, body] of cases) {
    it(label, async () => {
      const { fn } = fakeFetch(status, body)
      const read = createParameterReader({ region: "us-east-1", credentials, fetch: fn })
      const err = await read(NAME).then(
        () => undefined,
        (e: unknown) => e as Error,
      )
      expect(err).toBeInstanceOf(ParameterReadError)
      expect(err!.message).not.toContain(VALUE)
    })
  }
})
