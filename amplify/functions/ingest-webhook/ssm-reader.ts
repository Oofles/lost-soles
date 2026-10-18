import { createHash, createHmac } from "node:crypto"

import { defaultProvider } from "@aws-sdk/credential-provider-node"
import { SignatureV4 } from "@smithy/signature-v4"

/**
 * ONE SSM `GetParameter`, SIGNED BY HAND. Ticket 0286, D-NEW-a (operator, Q1 = A).
 *
 * WHY NOT `@aws-sdk/client-ssm`: measured, it adds ~200 KB minified to this bundle (783 KB against
 * 0091's pinned 700 KB ceiling). Amplify's esbuild resolves the package's CJS build, so nothing is
 * tree-shaken, and even the ESM build is 161 KB of serde schemas for ~150 commands we never call.
 * Every byte of that is parsed in init on every cold start, which is the cost 0286 exists to remove.
 * `@smithy/signature-v4` and `@aws-sdk/credential-provider-node` are already in the bundle (the
 * DynamoDB and SQS clients use them), so this file costs ~0 B.
 *
 * WHAT IT SPEAKS: the SSM JSON 1.1 protocol, which is one POST to `https://ssm.<region>.amazonaws.com/`
 * with `X-Amz-Target: AmazonSSM.GetParameter` and a SigV4 `Authorization` for service `ssm`. That is
 * the entire contract, and `ssm-reader.test.ts` pins it.
 *
 * FAILS CLOSED, AND QUIETLY: a non-200, a body that is not JSON, or a body with no string `Value`
 * throws an error whose message names the HTTP status or the shape, never a byte of the response.
 * An SSM error body can quote the parameter name; the VALUE is never in an error or a log line.
 *
 * Imported DYNAMICALLY by `webhook-secret.ts`, so none of this — not even the credential chain — is
 * evaluated until a handshake GET asks for the token.
 */

/** What `@smithy/signature-v4` hands a hash: smithy's `SourceData`. */
type SourceData = string | ArrayBuffer | ArrayBufferView

const bytes = (d: SourceData): string | Uint8Array =>
  typeof d === "string"
    ? d
    : d instanceof ArrayBuffer
      ? new Uint8Array(d)
      : new Uint8Array(d.buffer, d.byteOffset, d.byteLength)

/** `@smithy/signature-v4`'s hash constructor shape, on `node:crypto`. */
class Sha256 {
  private readonly hash: ReturnType<typeof createHash> | ReturnType<typeof createHmac>
  constructor(secret?: SourceData) {
    this.hash = secret === undefined ? createHash("sha256") : createHmac("sha256", bytes(secret))
  }
  update(data: SourceData): void {
    this.hash.update(bytes(data))
  }
  async digest(): Promise<Uint8Array> {
    return new Uint8Array(this.hash.digest())
  }
}

export interface ParameterReaderDeps {
  region?: string
  credentials?: ConstructorParameters<typeof SignatureV4>[0]["credentials"]
  fetch?: typeof fetch
}

/** Thrown on any failure. The message never contains a response body. */
export class ParameterReadError extends Error {
  override name = "ParameterReadError"
}

export function createParameterReader(
  deps: ParameterReaderDeps = {},
): (name: string) => Promise<string | undefined> {
  const region = deps.region ?? process.env.AWS_REGION ?? "us-east-1"
  const doFetch = deps.fetch ?? fetch
  const signer = new SignatureV4({
    service: "ssm",
    region,
    credentials: deps.credentials ?? defaultProvider(),
    sha256: Sha256,
  })
  const hostname = `ssm.${region}.amazonaws.com`

  return async (name) => {
    const body = JSON.stringify({ Name: name, WithDecryption: true })
    const signed = await signer.sign({
      method: "POST",
      protocol: "https:",
      hostname,
      path: "/",
      headers: {
        host: hostname,
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "AmazonSSM.GetParameter",
      },
      body,
    })
    const res = await doFetch(`https://${hostname}/`, {
      method: "POST",
      headers: signed.headers,
      body,
    })
    if (res.status !== 200) throw new ParameterReadError(`SSM GetParameter answered ${res.status}`)
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      throw new ParameterReadError("SSM GetParameter answered a body that is not JSON")
    }
    const value = (parsed as { Parameter?: { Value?: unknown } } | null)?.Parameter?.Value
    if (typeof value !== "string") throw new ParameterReadError("SSM GetParameter answered no Value")
    return value
  }
}
