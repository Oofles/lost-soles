import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * THE SSR COMPUTE ROLE'S NEW REACH, ticket `0331`, D-472. In the style of
 * `fog-delivery-read-grant.test.ts` and `activity-query-grant.test.ts`.
 *
 * The browser stopped calling AppSync: its skills, ledger and kind reads are route handlers that
 * query the model tables as this role, and its two writes are route handlers that invoke the two
 * mutation Lambdas as this role. So these grants are the whole of the browser's reach into those
 * tables and functions, and this pins what that reach is:
 *
 * - `dynamodb:Query` ONLY on the tables and indexes the routes read. No `GetItem`, `Scan` or write.
 * - `lambda:InvokeFunction` on EXACTLY `log-workout` and `set-activity-kind`. Because the route
 *   sets `userId` in the payload, a principal that can invoke them can name any user: the grant is
 *   the trust anchor, and a widened one is a forged identity.
 *
 * Synthesized, not checked live, so it fails in CI before a widened grant deploys.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

/** `computeRole` is imported by ARN into `CaptureGuard`; every policy on it is synthesized there. */
const guard = backend.stack.node.findChild("CaptureGuard") as Stack
const template = Template.fromStack(guard)

type Statement = { Sid?: string; Effect?: string; Action?: unknown; Resource?: unknown }

function statements(): Statement[] {
  return Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) =>
      ((policy.Properties as { PolicyDocument: { Statement: Statement[] } }).PolicyDocument
        .Statement ?? []) as Statement[],
  )
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v])

const bySid = (sid: string): Statement => {
  const found = statements().find((s) => s.Sid === sid)
  expect(found, `the SSR compute role has no ${sid} statement`).toBeDefined()
  return found!
}

/**
 * A resource as text. The table and function ARNs live in the `data` nested stack, so in this
 * template they are `Ref`s to parameters whose logical names carry the construct path
 * (`…amplifyDataSkillStateNestedStack…`, `…datalogworkoutlambda…Arn`), which is what is matched.
 */
const text = (resource: unknown): string => JSON.stringify(resource)

describe("the SSR compute's model-table reads (0331)", () => {
  it("are dynamodb:Query and nothing else", () => {
    for (const sid of ["QueryXpLedgerForSkillsAndRunCard", "QueryModelTablesForSkills"]) {
      const s = bySid(sid)
      expect(s.Effect).toBe("Allow")
      expect(list(s.Action)).toEqual(["dynamodb:Query"])
    }
  })

  it("reach T4 only through byActivity and bySkill, never the base table", () => {
    const resources = list(bySid("QueryXpLedgerForSkillsAndRunCard").Resource).map(text)
    expect(resources).toHaveLength(2)
    expect(resources[0]).toMatch(/XpLedgerEntry/)
    expect(resources[0]).toContain("/index/byActivity")
    expect(resources[1]).toMatch(/XpLedgerEntry/)
    expect(resources[1]).toContain("/index/bySkill")
  })

  it("reach SkillState, Profile and Landmark as base tables, and no other table", () => {
    const resources = list(bySid("QueryModelTablesForSkills").Resource).map(text)
    expect(resources).toHaveLength(3)
    expect(resources[0]).toMatch(/SkillState/)
    expect(resources[1]).toMatch(/Profile/)
    expect(resources[2]).toMatch(/Landmark/)
    for (const r of resources) expect(r).not.toContain("/index/")
  })

  /**
   * Matched on the resource rather than a Sid, because the failure this guards against is a
   * `grantReadData` reached for out of habit, which arrives unnamed with `Scan` and `GetItem`.
   */
  it("grant no Scan, GetItem or write on any model table to the SSR compute", () => {
    const forbidden = /^dynamodb:(Scan|GetItem|BatchGetItem|Put|Update|Delete|BatchWrite|TransactWrite)/
    for (const s of statements()) {
      const bad = list(s.Action).filter((a) => forbidden.test(String(a)))
      if (bad.length === 0) continue
      expect(text(s.Resource), `statement ${s.Sid ?? "(unnamed)"} grants ${bad.join(", ")} on a model table`).not.toMatch(
        /XpLedgerEntry|SkillState|Profile|Landmark|Activity/,
      )
    }
  })
})

describe("the SSR compute's Lambda invokes (0331)", () => {
  it("are lambda:InvokeFunction on exactly the two mutation functions", () => {
    const s = bySid("InvokeMutationFunctions")
    expect(s.Effect).toBe("Allow")
    expect(list(s.Action)).toEqual(["lambda:InvokeFunction"])
    const resources = list(s.Resource).map(text)
    expect(resources).toHaveLength(2)
    expect(resources[0]).toMatch(/logworkout/i)
    expect(resources[1]).toMatch(/setactivitykind/i)
    for (const r of resources) expect(r).not.toContain("*")
  })

  it("is the only statement on this role that can invoke any Lambda", () => {
    const invokers = statements().filter((s) => list(s.Action).some((a) => /^lambda:(Invoke|\*)|^\*$/.test(String(a))))
    expect(invokers.map((s) => s.Sid)).toEqual(["InvokeMutationFunctions"])
  })
})
