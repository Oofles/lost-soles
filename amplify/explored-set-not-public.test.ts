import { describe, expect, it } from "vitest"

/**
 * C-4, STRUCTURALLY. Ticket `0114`; `08-security-privacy.md` §2.4 TRIGGER C.
 *
 * The explored set's object key is predictable: `users/<sub>/explored/explored-r11.<gen>.bin`
 * (`objectKeys.cells`, D-237), and the generation is a small counter. Knowing a `sub` is therefore
 * knowing the key. What keeps the whole map private is that the bucket answers an anonymous GET
 * with 403, which holds only while public access is blocked and no bucket policy statement
 * Allows an anonymous principal.
 *
 * Asserted here on the synthesized template, so a widened bucket fails CI before it deploys. The
 * live half, an anonymous `curl` of the real key that must 403, is in the ticket's smoke test,
 * and `app/api/fog/route.test.ts` asserts the app's own route 404s a signed-out caller before it
 * touches S3.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")
const { objectKeys } = await import("@/src/pipeline/explored-blob-store")

/** One synth at module scope: `Template.fromStack` takes seconds (0041). */
const template = Template.fromStack(backend.storage.stack)

type Statement = { Sid?: string; Effect?: string; Principal?: unknown; Action?: unknown }

const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [v as string])

describe("C-4: the explored set is never a public object", () => {
  it("the key the routes read is the predictable one this test is about", () => {
    expect(objectKeys.cells("sub-x", 7)).toBe("users/sub-x/explored/explored-r11.7.bin")
  })

  /**
   * The template does not set `PublicAccessBlockConfiguration` today. The live bucket has all four
   * flags on because S3 applies them to every new bucket by default, not because this stack asks
   * for it. So this asserts the template never WEAKENS that default. The live value is checked by
   * the ticket's smoke test.
   */
  it("the user-data bucket never turns off any public-access block", () => {
    const buckets = Object.values(template.findResources("AWS::S3::Bucket"))
    expect(buckets.length).toBe(1)
    const pab = (
      buckets[0].Properties as { PublicAccessBlockConfiguration?: Record<string, unknown> }
    ).PublicAccessBlockConfiguration
    if (pab !== undefined) {
      expect(pab).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      })
    }
  })

  it("no bucket policy statement ALLOWS an anonymous or wildcard principal", () => {
    const statements = Object.values(template.findResources("AWS::S3::BucketPolicy")).flatMap(
      (p) =>
        ((p.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument
          .Statement ?? []) as Statement[],
    )
    expect(statements.length).toBeGreaterThan(0)
    const anonymousAllows = statements.filter((s) => {
      if (s.Effect !== "Allow") return false
      const principal = s.Principal
      if (principal === "*") return true
      const aws = (principal as { AWS?: unknown } | undefined)?.AWS
      return aws !== undefined && list(aws).includes("*")
    })
    expect(anonymousAllows).toEqual([])
  })

  it("no bucket ACL grants public read", () => {
    for (const bucket of Object.values(template.findResources("AWS::S3::Bucket"))) {
      const acl = (bucket.Properties as { AccessControl?: string }).AccessControl
      expect(acl === undefined || acl === "Private", `AccessControl is ${acl}`).toBe(true)
    }
  })
})
