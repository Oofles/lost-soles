import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * The basemap tiles bucket and distribution, asserted structurally. Ticket 0052, D-226.
 *
 * WHY THIS FILE EXISTS. D-226 moved the basemap off Cloudflare R2 and into this
 * account on the strength of one claim: that CloudFront in front of a PRIVATE bucket
 * costs nothing at this app's volume. Two edits would quietly falsify that claim
 * without breaking anything a human would notice — opening the bucket to public read
 * (S3 egress at $0.09/GB, billed outside CloudFront's always-free tier, bypassing the
 * CDN entirely) or dropping `Range` from the CORS policy (a basemap that works on
 * desktop and fails on the phone, which is the failure 0052's Description names).
 * Both fail here instead.
 *
 * The CDK context below is what `ampx` normally supplies, set before the import
 * because `defineBackend` reads it while the module is evaluating. Same shape as
 * `raw-archive-immutability.test.ts`, and the same 6-second synth cost — hence the
 * module-scope synth rather than one per test (ticket 0041's timeout).
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template, Match } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

const tiles = Template.fromStack(backend.stack.node.findChild("BasemapTiles") as Stack)

describe("basemap tiles bucket (0052, D-226)", () => {
  it("blocks all public access — the CDN is the only reader", () => {
    tiles.hasResourceProperties("AWS::S3::Bucket", {
      BucketName: "lost-soles-tiles",
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    })
  })

  it("grants read only to the CloudFront service principal, never to *", () => {
    const policies = tiles.findResources("AWS::S3::BucketPolicy")
    const statements = Object.values(policies).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Array<Record<string, unknown>> } })
          .PolicyDocument.Statement ?? [],
    )
    expect(statements.length).toBeGreaterThan(0)

    const allows = statements.filter((s) => s.Effect === "Allow")
    expect(allows.length).toBeGreaterThan(0)

    /**
     * NOT "every principal is CloudFront" — the first draft of this test asserted
     * that and failed honestly, because `autoDeleteObjects` above adds its own
     * statement granting the teardown Lambda's role. That grant is legitimate and
     * scoped to a role in this account.
     *
     * What must hold is narrower and is the thing that actually costs money if it
     * breaks: NO statement names an anonymous principal, and CloudFront is a reader.
     */
    for (const statement of allows) {
      const principal = JSON.stringify(statement.Principal)
      expect(principal).not.toBe('"*"')
      expect(principal).not.toContain('"AWS":"*"')
    }
    expect(allows.some((s) => JSON.stringify(s.Principal).includes("cloudfront"))).toBe(
      true,
    )
  })
})

describe("basemap distribution (0052, D-226)", () => {
  it("allows the Range header in CORS — pmtiles is byte-range reads or nothing", () => {
    tiles.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        CorsConfig: Match.objectLike({
          AccessControlAllowHeaders: { Items: Match.arrayWith(["Range"]) },
          AccessControlExposeHeaders: {
            Items: Match.arrayWith(["Content-Length", "Content-Range", "ETag"]),
          },
        }),
      }),
    })
  })

  it("does not allow a wildcard origin", () => {
    const policies = tiles.findResources("AWS::CloudFront::ResponseHeadersPolicy")
    const origins = Object.values(policies).flatMap(
      (p) =>
        (
          p.Properties as {
            ResponseHeadersPolicyConfig: {
              CorsConfig: { AccessControlAllowOrigins: { Items: string[] } }
            }
          }
        ).ResponseHeadersPolicyConfig.CorsConfig.AccessControlAllowOrigins.Items,
    )
    expect(origins).not.toContain("*")
    expect(origins).toContain("https://soles.devaultsecurity.com")
  })

  /**
   * REGRESSION, and it was a live one. The first deploy shipped with no bucket CORS
   * rule, so CloudFront forwarded the preflight to S3, S3 answered 403, and the
   * response headers policy decorated that 403 with perfectly correct CORS headers.
   * The smoke test reported PASS because it asserted the headers and not the status.
   *
   * Nothing broke, because `Range` with a simple `bytes=a-b` value is CORS-safelisted
   * and pmtiles therefore does not preflight. That is a reprieve, not a fix.
   */
  it("answers the preflight at the origin — CORS on the bucket, not just the CDN", () => {
    tiles.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedHeaders: Match.arrayWith(["Range"]),
            AllowedMethods: Match.arrayWith(["GET", "HEAD"]),
          }),
        ]),
      },
    })
  })

  it("forwards Origin to the bucket, or the preflight never reaches the rule", () => {
    const policies = tiles.findResources("AWS::CloudFront::Distribution")
    const behaviour = Object.values(policies).map(
      (p) =>
        (p.Properties as { DistributionConfig: { DefaultCacheBehavior: Record<string, unknown> } })
          .DistributionConfig.DefaultCacheBehavior,
    )[0]
    expect(behaviour.OriginRequestPolicyId).toBeDefined()
  })

  it("serves over HTTPS and reads from the tile prefix only", () => {
    tiles.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: "redirect-to-https",
        }),
        Origins: Match.arrayWith([Match.objectLike({ OriginPath: "/tiles" })]),
      }),
    })
  })
})
