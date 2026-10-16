import { describe, expect, it } from "vitest"

import { SWEEP_INTERVAL_SECONDS } from "@/lib/sources/token-refresh-sweep"

/**
 * Ticket 0094 criterion 1, and the function's reach — asserted against the
 * CloudFormation the backend actually synthesizes, for the reason
 * `process-activity-stack.test.ts` gives: none of this breaks a runtime test when it is
 * wrong, and every one of it fails only in production.
 *
 * Synthesized at MODULE SCOPE, not inside a test: a full synth outruns vitest's
 * per-test timeout in the Amplify build container (ticket 0041).
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

const stack = Template.fromStack(backend.tokenRefresh.stack)

type Resource = { Properties: Record<string, unknown> }

/** The token-refresh function itself, told apart from its neighbours by its handler name. */
function refreshFunction(): [string, Resource] {
  const fns = Object.entries(stack.findResources("AWS::Lambda::Function")).filter(([, f]) =>
    JSON.stringify((f as Resource).Properties.Tags ?? []).includes("token-refresh"),
  )
  expect(fns, "one token-refresh function").toHaveLength(1)
  return fns[0] as [string, Resource]
}

/** Every statement on the function's role. */
function statements(): Array<{ Action?: string | string[]; Resource?: unknown }> {
  const roleId = (refreshFunction()[1].Properties.Role as { "Fn::GetAtt": [string, string] })[
    "Fn::GetAtt"
  ][0]
  return Object.values(stack.findResources("AWS::IAM::Policy"))
    .filter((p) => JSON.stringify((p as Resource).Properties.Roles).includes(roleId))
    .flatMap(
      (p) =>
        ((p as Resource).Properties.PolicyDocument as { Statement: unknown[] }).Statement as Array<{
          Action?: string | string[]
          Resource?: unknown
        }>,
    )
}

const actionsOf = (s: { Action?: string | string[] }) =>
  typeof s.Action === "string" ? [s.Action] : (s.Action ?? [])
const allActions = () => statements().flatMap(actionsOf)

describe("the schedule (criterion 1)", () => {
  /**
   * EVENTBRIDGE SCHEDULER, not a classic EventBridge rule — `defineFunction`'s `schedule`
   * synthesizes an `AWS::Scheduler::Schedule`, and renders "every 4h" as a cron on the
   * hour (00, 04, 08 … UTC) rather than as `rate()`. Either satisfies "an EventBridge
   * rule invokes the function every 4 hours"; this is the one Amplify actually emits.
   */
  it("is an EventBridge schedule invoking the function every four hours", () => {
    const [logicalId] = refreshFunction()
    const schedules = Object.values(stack.findResources("AWS::Scheduler::Schedule")).filter((r) =>
      JSON.stringify((r as Resource).Properties.Target).includes(logicalId),
    ) as Resource[]

    expect(schedules, "one schedule targeting token-refresh").toHaveLength(1)
    const { ScheduleExpression, ScheduleExpressionTimezone, State } = schedules[0].Properties
    expect(ScheduleExpression).toBe(`cron(0 */${SWEEP_INTERVAL_SECONDS / 3600} * * ? *)`)
    expect(ScheduleExpressionTimezone).toBe("UTC")
    expect(State).toBe("ENABLED")
  })
})

describe("the function", () => {
  it("is not attached to a VPC (D-081)", () => {
    expect(refreshFunction()[1].Properties).not.toHaveProperty("VpcConfig")
  })

  it("carries no credential in its environment", () => {
    const env = JSON.stringify(refreshFunction()[1].Properties.Environment ?? {})
    expect(env).not.toMatch(/STRAVA_CLIENT_SECRET|refresh_?token|access_?token/i)
  })

})

describe("its reach on T7", () => {
  it("can scan, read and conditionally update the credentials table", () => {
    expect(allActions()).toEqual(
      expect.arrayContaining(["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:UpdateItem"]),
    )
  })

  it("can never create, delete or batch-write a connection", () => {
    const actions = allActions()
    for (const forbidden of [
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:*",
    ]) {
      expect(actions).not.toContain(forbidden)
    }
  })

  it("can encrypt and decrypt with the credentials key — the rotation write-back needs both", () => {
    expect(allActions()).toEqual(expect.arrayContaining(["kms:Decrypt", "kms:Encrypt"]))
  })

  it("can read the two OAuth client parameters, and only those two", () => {
    const ssm = statements().filter((s) => actionsOf(s).includes("ssm:GetParameter"))
    expect(ssm).toHaveLength(1)
    const resources = ssm[0].Resource as unknown[]
    expect(resources).toHaveLength(2)
    const rendered = JSON.stringify(resources)
    expect(rendered).toContain("STRAVA_CLIENT_ID")
    expect(rendered).toContain("STRAVA_CLIENT_SECRET")
    expect(rendered).not.toContain("*")
  })
})
