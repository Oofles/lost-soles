import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

import {
  NIGHTLY_UTC_HOUR,
  RECONCILE_INTERVAL_HOURS,
  RECONCILE_METRIC_NAMESPACE,
  RECONCILE_METRICS,
} from "@/lib/sources/reconcile-sweep"

/**
 * Ticket 0095 criteria 1, 2 and 8, and the function's reach — asserted against the
 * CloudFormation the backend actually synthesizes (see `token-refresh-stack.test.ts`).
 * Synthesized at MODULE SCOPE: a full synth outruns vitest's per-test timeout in CI.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

const stack = Template.fromStack(backend.reconcileSweep.stack)
const ingest = Template.fromStack(backend.stack.node.findChild("IngestPipeline") as Stack)

type Resource = { Properties: Record<string, unknown> }

function sweepFunction(): [string, Resource] {
  const fns = Object.entries(stack.findResources("AWS::Lambda::Function")).filter(([, f]) =>
    JSON.stringify((f as Resource).Properties.Tags ?? []).includes("reconcile-sweep"),
  )
  expect(fns, "one reconcile-sweep function").toHaveLength(1)
  return fns[0] as [string, Resource]
}

function statements(): Array<{ Action?: string | string[]; Resource?: unknown }> {
  const roleId = (sweepFunction()[1].Properties.Role as { "Fn::GetAtt": [string, string] })["Fn::GetAtt"][0]
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

function schedules(): Resource[] {
  const [logicalId] = sweepFunction()
  return Object.values(stack.findResources("AWS::Scheduler::Schedule")).filter((r) =>
    JSON.stringify((r as Resource).Properties.Target).includes(logicalId),
  ) as Resource[]
}

describe("the schedules (criteria 1 and 2)", () => {
  it("has exactly two, both enabled, in UTC", () => {
    const all = schedules()
    expect(all).toHaveLength(2)
    for (const s of all) {
      expect(s.Properties.State).toBe("ENABLED")
      expect(s.Properties.ScheduleExpressionTimezone).toMatch(/^(Etc\/)?UTC$/)
    }
  })

  it("runs six-hourly with no payload", () => {
    const six = schedules().filter(
      (s) => s.Properties.ScheduleExpression === `cron(0 */${RECONCILE_INTERVAL_HOURS} * * ? *)`,
    )
    expect(six).toHaveLength(1)
    expect((six[0].Properties.Target as { Input?: unknown }).Input).toBeUndefined()
  })

  it("runs nightly with the nightly payload", () => {
    const nightly = schedules().filter(
      (s) => s.Properties.ScheduleExpression === `cron(0 ${NIGHTLY_UTC_HOUR} * * ? *)`,
    )
    expect(nightly).toHaveLength(1)
    const input = (nightly[0].Properties.Target as { Input?: string }).Input
    expect(JSON.parse(String(input))).toEqual({ mode: "nightly" })
  })
})

describe("the function", () => {
  it("is not attached to a VPC (D-081)", () => {
    expect(sweepFunction()[1].Properties).not.toHaveProperty("VpcConfig")
  })

  it("carries the queue URL and no credential in its environment", () => {
    const env = JSON.stringify(sweepFunction()[1].Properties.Environment ?? {})
    expect(env).toContain("INGEST_QUEUE_URL")
    expect(env).not.toMatch(/STRAVA_CLIENT_SECRET|refresh_?token|access_?token/i)
  })
})

describe("its reach", () => {
  it("reads and updates T7 by key, and never scans, creates or deletes a connection", () => {
    const actions = allActions()
    expect(actions).toEqual(expect.arrayContaining(["dynamodb:GetItem", "dynamodb:UpdateItem"]))
    for (const forbidden of [
      "dynamodb:Scan",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:Query",
      "dynamodb:*",
    ]) {
      expect(actions).not.toContain(forbidden)
    }
  })

  it("puts and reads receipts, sends to the queue, and nothing broader", () => {
    const receipt = statements().find((s) => JSON.stringify(s.Resource).includes("IngestReceiptTable"))
    expect(receipt && actionsOf(receipt).sort()).toEqual(["dynamodb:GetItem", "dynamodb:PutItem"])
    const sqs = allActions().filter((a) => a.startsWith("sqs:"))
    expect(sqs).toEqual(["sqs:SendMessage"])
  })

  it("can read the two OAuth client parameters, and only those two", () => {
    const ssm = statements().filter((s) => actionsOf(s).includes("ssm:GetParameter"))
    expect(ssm).toHaveLength(1)
    const rendered = JSON.stringify(ssm[0].Resource)
    expect(rendered).toContain("STRAVA_CLIENT_ID")
    expect(rendered).toContain("STRAVA_CLIENT_SECRET")
    expect(rendered).not.toContain("*")
  })

  it("has no PutMetricData: the metrics are log lines", () => {
    expect(allActions()).not.toContain("cloudwatch:PutMetricData")
  })
})

describe("the alarm (criterion 8)", () => {
  it("fires on sweep-enqueued activities on two of the last three days, to the ingest topic", () => {
    const alarms = Object.values(ingest.findResources("AWS::CloudWatch::Alarm")).filter(
      (a) => (a as Resource).Properties.MetricName === RECONCILE_METRICS.enqueued,
    ) as Resource[]
    expect(alarms).toHaveLength(1)
    const p = alarms[0].Properties
    expect(p).toMatchObject({
      Namespace: RECONCILE_METRIC_NAMESPACE,
      Statistic: "Sum",
      Period: 86400,
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
      EvaluationPeriods: 3,
      DatapointsToAlarm: 2,
      TreatMissingData: "notBreaching",
    })
    expect(p.Dimensions).toBeUndefined()
    expect(JSON.stringify(p.AlarmActions)).toContain("IngestAlarms")
  })
})
