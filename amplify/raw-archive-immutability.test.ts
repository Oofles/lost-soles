import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * I-3, STRUCTURALLY. Ticket 0039.
 *
 * `02-data-model.md` classifies I-3 as **[S] Structural** — "cannot be deleted by a
 * future commit without the deletion being obvious in a diff of the infrastructure".
 * This file is what makes that true. It synthesizes the real backend and asserts the
 * CloudFormation it produces, so a change that quietly drops the Deny, turns
 * versioning off, or re-arms auto-delete fails here rather than at the next teardown.
 *
 * WHY A SYNTH TEST AND NOT A LIVE CHECK. Both, actually — the live half is
 * `scripts/check-auth-posture.mjs`'s counterpart for the auth pool, and this ticket's
 * close records an AWS-side smoke test of the deployed bucket. But a live check only
 * runs against a deploy that already happened. This one fails in CI, before the change
 * reaches the bucket that holds the one artifact no rebuild can reproduce.
 *
 * The CDK context below is what `ampx` normally supplies. Set before the import
 * because `defineBackend` reads it while the module is evaluating.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

const bucket = backend.storage.resources.cfnResources.cfnBucket
const template = Template.fromStack(backend.storage.stack)

/** Every `AWS::S3::BucketPolicy` statement in the storage stack, flattened. */
function policyStatements(): Array<Record<string, unknown>> {
  const policies = template.findResources("AWS::S3::BucketPolicy")
  return Object.values(policies).flatMap(
    (p) =>
      ((p.Properties as { PolicyDocument: { Statement: Array<Record<string, unknown>> } })
        .PolicyDocument.Statement ?? []),
  )
}

function statementWithSid(sid: string): Record<string, unknown> {
  const found = policyStatements().find((s) => s.Sid === sid)
  expect(found, `no bucket policy statement with Sid ${sid}`).toBeDefined()
  return found as Record<string, unknown>
}

/** CFN accepts a bare string or a list for these; normalise before asserting. */
const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : [v as string])

describe("the raw archive is undeletable (I-3)", () => {
  /**
   * The half that holds even against a caller that never runs `archiveRaw`. Without
   * it, an overwrite destroys the previous bytes and D-205's reasoning collapses.
   */
  it("has S3 versioning enabled", () => {
    expect(bucket.versioningConfiguration).toMatchObject({ status: "Enabled" })
  })

  /**
   * BOTH ACTIONS. On a versioned bucket `DeleteObject` only writes a delete marker;
   * `DeleteObjectVersion` is what destroys bytes. Denying one and not the other reads
   * as protection and prevents nothing permanent — see D-205.
   */
  it("denies both delete actions on raw/* to every principal", () => {
    const deny = statementWithSid("DenyRawArchiveDeletionExceptBreakGlass")

    expect(deny.Effect).toBe("Deny")
    expect(deny.Principal).toEqual({ AWS: "*" })
    expect(list(deny.Action).sort()).toEqual(["s3:DeleteObject", "s3:DeleteObjectVersion"])
  })

  /** Scoped to the archive, and to the archive only. */
  it("scopes the deny to the raw/ prefix", () => {
    const resource = statementWithSid("DenyRawArchiveDeletionExceptBreakGlass").Resource
    expect(JSON.stringify(resource)).toContain("raw/*")
  })

  /**
   * ONE exception, named. `01-architecture.md` §3: deletion is possible "only by a
   * person who has deliberately assumed a role whose only purpose is deletion".
   * A second ARN appearing here is the thing worth failing a build over.
   */
  it("excepts exactly one principal — the break-glass role", () => {
    const conditions = statementWithSid("DenyRawArchiveDeletionExceptBreakGlass")
      .Condition as { StringNotLike: { "aws:PrincipalArn": unknown } }

    /**
     * ONE entry. The account id is an `Fn::Join` over `AWS::AccountId` rather than a
     * literal — deliberately, so the same policy is correct in a sandbox — so the ARN
     * is asserted by its tail rather than in full.
     */
    const excepted = list(conditions.StringNotLike["aws:PrincipalArn"])
    expect(excepted).toHaveLength(1)
    expect(JSON.stringify(excepted)).toContain(":role/LostSolesArchiveDeletion")
    expect(JSON.stringify(excepted)).toContain("AWS::AccountId")
  })

  /**
   * And the role it excepts actually exists, holding deletion on `raw/*` and nothing
   * else. Before this ticket §3's "every principal except an explicit break-glass
   * role" excepted a role that had never been created.
   */
  it("creates that role, with deletion on raw/* as its only permission", () => {
    const archiveStack = backend.stack.node.findChild("RawArchive") as Stack
    const archive = Template.fromStack(archiveStack)

    const breakGlass = Object.values(archive.findResources("AWS::IAM::Role")).filter(
      (r) => (r.Properties as { RoleName?: string }).RoleName === "LostSolesArchiveDeletion",
    )
    expect(breakGlass).toHaveLength(1)

    /**
     * DELETION ONLY, and that is the part worth asserting. A break-glass role that
     * could also READ the archive would be a second, quieter copy of the lifetime GPS
     * history's threat model (08 §6.2) — and the deletion path has no reason to be
     * able to look at what it is deleting.
     */
    const statements = Object.values(archive.findResources("AWS::IAM::Policy")).flatMap(
      (p) =>
        (p.Properties as { PolicyDocument: { Statement: Array<Record<string, unknown>> } })
          .PolicyDocument.Statement,
    )
    expect(statements).toHaveLength(1)
    expect(list(statements[0].Action).sort()).toEqual([
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
    ])
    expect(JSON.stringify(statements[0].Resource)).toContain("raw/*")
  })

  /** The Deny is worthless if the policy holding it can be dropped. */
  it("denies deleting the bucket policy outside CloudFormation", () => {
    const deny = statementWithSid("DenyBucketPolicyTamperingOutsideCloudFormation")
    expect(deny.Effect).toBe("Deny")
    expect(list(deny.Action)).toEqual(["s3:DeleteBucketPolicy"])
  })

  /**
   * THE FINDING THIS TICKET STARTED FROM. Before 0039 the bucket was
   * `RemovalPolicy.DESTROY` with `autoDeleteObjects: true`, which meant a live IAM
   * role holding `s3:DeleteObject*` bucket-wide and a stack teardown that would have
   * emptied `raw/`. `keepOnDelete: true` retires both.
   */
  it("retains the bucket on stack deletion", () => {
    template.hasResource("AWS::S3::Bucket", { DeletionPolicy: "Retain" })
  })

  it("has no auto-delete-objects custom resource", () => {
    expect(Object.keys(template.findResources("Custom::S3AutoDeleteObjects"))).toEqual([])
  })
})
