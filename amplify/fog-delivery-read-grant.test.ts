import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * THE SSR COMPUTE ROLE'S READ ON THE DELIVERY LAYER. Ticket `0054`, D-228.
 * `05-fog-of-war.md` §7.3; `02-data-model.md` §6.4; `08-security-privacy.md` §6.2.
 *
 * The browser reads its map through `/api/fog`, which reads S3 as this role. The grant is
 * therefore the whole of the browser's reach into the delivery layer, and this file
 * asserts what that reach is — READ, on `users/*`, and nothing else.
 *
 * SYNTHESIZED, NOT CHECKED LIVE. A live check only runs against a deploy that already
 * happened; this fails in CI, before a widened grant reaches the bucket that also holds
 * `raw/` — the one prefix in this system that no rebuild can reproduce (I-3). The same
 * argument `raw-archive-immutability.test.ts` makes, applied to the reader instead of the
 * writer.
 *
 * The CDK context below is what `ampx` normally supplies. Set before the import because
 * `defineBackend` reads it while the module is evaluating.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

/**
 * `computeRole` is imported by ARN into the `CaptureGuard` stack, so every policy CDK
 * attaches to it is synthesized there. One synth at module scope: `Template.fromStack`
 * takes seconds, and ticket `0041` failed a deploy on vitest's 5 s per-test default.
 */
const template = Template.fromStack(backend.stack.node.findChild("CaptureGuard") as Stack)

type Statement = { Sid?: string; Effect?: string; Action?: unknown; Resource?: unknown }

function statements(): Statement[] {
  return Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) =>
      ((policy.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument
        .Statement ?? []) as Statement[],
  )
}

const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [v as string])

const grant = (): Statement => {
  const found = statements().find((s) => s.Sid === "ReadExploredDeliveryLayerForTheBrowser")
  expect(found, "the SSR compute role has no delivery-layer read grant").toBeDefined()
  return found!
}

/** `Fn::Join` parts, flattened to the literal fragments, so a prefix is assertable. */
function resourceText(resource: unknown): string {
  const one = Array.isArray(resource) ? resource[0] : resource
  if (typeof one === "string") return one
  const join = (one as { "Fn::Join"?: [string, unknown[]] })["Fn::Join"]
  if (!join) return JSON.stringify(one)
  return join[1].map((part) => (typeof part === "string" ? part : "*")).join("")
}

describe("the browser's read path into the delivery layer", () => {
  it("grants s3:GetObject, and only that", async () => {
    const statement = grant()

    expect(statement.Effect).toBe("Allow")
    expect(list(statement.Action)).toEqual(["s3:GetObject"])
  })

  it("is scoped to users/*, so raw/ has no read path through the app at all", async () => {
    const text = resourceText(grant().Resource)

    expect(text).toMatch(/\/users\/\*$/)
    expect(text).not.toMatch(/\/raw\//)
  })

  /**
   * The asymmetry is the point. Every write to `users/*` belongs to the ingest worker; a
   * bug in a route handler must not be able to alter a delivery-layer object, because the
   * map it serves can never re-fog (D-020).
   */
  it("gives the SSR compute no write or delete anywhere in the bucket", async () => {
    const forbidden = /^s3:(Put|Delete|Restore|Abort)/
    for (const statement of statements()) {
      const actions = list(statement.Action).filter((a) => typeof a === "string")
      const s3Writes = actions.filter((a) => forbidden.test(a))
      expect(s3Writes, `statement ${statement.Sid ?? "(unnamed)"} grants ${s3Writes}`).toEqual([])
    }
  })

  it("gives it no bucket-level listing, which a prefix scope cannot constrain", async () => {
    for (const statement of statements()) {
      const actions = list(statement.Action).filter((a) => typeof a === "string")
      expect(actions.filter((a) => a.startsWith("s3:List"))).toEqual([])
      expect(actions.filter((a) => a.startsWith("s3:GetBucket"))).toEqual([])
    }
  })
})
