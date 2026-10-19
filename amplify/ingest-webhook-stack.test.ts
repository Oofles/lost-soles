import { describe, expect, it } from "vitest"

/**
 * Ticket 0091 criteria 1, 3 and 7 — the webhook's shape and reach, asserted against the
 * CloudFormation the backend actually synthesizes. None of this breaks a runtime test when it
 * is wrong, and every one of it fails only in production (`process-activity-stack.test.ts`).
 *
 * Synthesized at MODULE SCOPE, not inside a test: a full synth outruns vitest's per-test
 * timeout in the Amplify build container (ticket 0041).
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Stack } = await import("aws-cdk-lib")
const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

const stack = Template.fromStack(backend.ingestWebhook.stack)
const everyStack = backend.stack.node.root.node
  .findAll()
  .filter((c): c is InstanceType<typeof Stack> => Stack.isStack(c))
  .map((s) => Template.fromStack(s))

type Resource = { Properties: Record<string, unknown> }
type Statement = { Sid?: string; Action?: string | string[]; Resource?: unknown }

function webhookFunction(): [string, Resource] {
  const fns = Object.entries(stack.findResources("AWS::Lambda::Function")).filter(([, f]) =>
    JSON.stringify((f as Resource).Properties.Tags ?? []).includes("ingest-webhook"),
  )
  expect(fns, "one ingest-webhook function").toHaveLength(1)
  return fns[0] as [string, Resource]
}

function statements(): Statement[] {
  const roleId = (webhookFunction()[1].Properties.Role as { "Fn::GetAtt": [string, string] })[
    "Fn::GetAtt"
  ][0]
  return Object.values(stack.findResources("AWS::IAM::Policy"))
    .filter((p) => JSON.stringify((p as Resource).Properties.Roles).includes(roleId))
    .flatMap(
      (p) => ((p as Resource).Properties.PolicyDocument as { Statement: Statement[] }).Statement,
    )
}

const actionsOf = (s: Statement) =>
  typeof s.Action === "string" ? [s.Action] : (s.Action ?? [])

describe("the function (criteria 1 and 3)", () => {
  it("is 128 MB with a 3 s timeout", () => {
    const { MemorySize, Timeout } = webhookFunction()[1].Properties
    expect(MemorySize).toBe(128)
    expect(Timeout).toBe(3)
  })

  it("is not attached to a VPC (D-081)", () => {
    expect(webhookFunction()[1].Properties).not.toHaveProperty("VpcConfig")
  })

  it("carries the queue URL and no credential in its environment", () => {
    const env = JSON.stringify(webhookFunction()[1].Properties.Environment ?? {})
    expect(env).toContain("INGEST_QUEUE_URL")
    expect(env).not.toMatch(/CLIENT_SECRET|refresh_?token|access_?token/i)
  })

  /**
   * Ticket 0286 (D-347's fallback), replacing 0092's "exactly one `secret()`". A `secret()` is
   * resolved in init on every cold start, POSTs included, so there must be NONE: Amplify's SSM
   * config is empty, and the token's NAME — never its value — is an ordinary variable the GET path
   * reads SSM with.
   */
  it("resolves no secret at init; carries only the verify token's parameter name", () => {
    const vars = (webhookFunction()[1].Properties.Environment as { Variables: Record<string, unknown> })
      .Variables
    expect(vars).not.toHaveProperty("STRAVA_WEBHOOK_VERIFY_TOKEN")
    expect(JSON.parse((vars.AMPLIFY_SSM_ENV_CONFIG as string | undefined) ?? "{}")).toEqual({})
    expect(vars.WEBHOOK_SECRET_PARAMETER).toBe("/amplify/shared/d14fhvl4rp79nn/STRAVA_WEBHOOK_VERIFY_TOKEN")
  })
})

describe("the Function URL (criterion 1)", () => {
  it("exists, targets this function, and has authType NONE", () => {
    const [logicalId] = webhookFunction()
    const urls = Object.values(stack.findResources("AWS::Lambda::Url")).filter((u) =>
      JSON.stringify((u as Resource).Properties.TargetFunctionArn).includes(logicalId),
    ) as Resource[]
    expect(urls).toHaveLength(1)
    expect(urls[0].Properties.AuthType).toBe("NONE")
  })

  /**
   * BOTH permissions, or Strava gets a 403. Since October 2025 a public Function URL needs
   * `lambda:InvokeFunction` (conditioned on `InvokedViaFunctionUrl`) beside the URL permission;
   * CDK 2.267 emits both, and this pins that a CDK downgrade cannot silently drop the second.
   */
  it("is publicly invocable through the URL, and only through the URL", () => {
    const [logicalId] = webhookFunction()
    const perms = Object.values(stack.findResources("AWS::Lambda::Permission"))
      .map((p) => (p as Resource).Properties)
      .filter((p) => JSON.stringify(p.FunctionName).includes(logicalId))
    expect(perms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Action: "lambda:InvokeFunctionUrl", FunctionUrlAuthType: "NONE", Principal: "*" }),
        expect.objectContaining({ Action: "lambda:InvokeFunction", InvokedViaFunctionUrl: true, Principal: "*" }),
      ]),
    )
    expect(perms.filter((p) => p.Principal === "*" && p.InvokedViaFunctionUrl !== true && !p.FunctionUrlAuthType)).toEqual([])
  })

  it("is surfaced as a CloudFormation output for 0092 and the smoke test", () => {
    expect(Object.keys(stack.findOutputs("*"))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^IngestWebhookUrl/)]),
    )
  })

  it("is not fronted by API Gateway — no such resource in any stack", () => {
    for (const t of everyStack) {
      const types = Object.values(t.toJSON().Resources ?? {}).map((r) => (r as { Type: string }).Type)
      expect(types.filter((ty) => ty.startsWith("AWS::ApiGateway"))).toEqual([])
    }
  })
})

describe("its reach (criterion 7)", () => {
  /**
   * AMENDED DELIBERATELY BY 0092, 0093 AND 0286. 0091 pinned exactly two actions. 0092's verify
   * token was Amplify's `secret()`, which added `ssm:GetParameters` on two paths (branch, shared);
   * 0093's per-athlete flood counter (§4.4 item 6) needs an atomic `ADD`, which is `UpdateItem`,
   * held to keys beginning `rate#` by `dynamodb:LeadingKeys`, so the accept gate itself is still
   * `PutItem`-only and the public endpoint can still not modify a receipt. 0286 replaced the
   * `secret()` with a lazy read on GET only, so its grant is now our own explicit
   * `ssm:GetParameter` (singular — what `webhook-secret.ts` calls) on the ONE path the token
   * lives at: the shared one. The branch path it used to miss is no longer reachable at all.
   */
  it("is exactly four actions: PutItem on the receipt table, UpdateItem on rate# keys only, SendMessage on the queue, the verify token", () => {
    const actions = statements().flatMap(actionsOf).sort()
    expect(actions).toEqual(["dynamodb:PutItem", "dynamodb:UpdateItem", "sqs:SendMessage", "ssm:GetParameter"])

    // 0286: one statement, one parameter ARN, the verify token's shared path — not the client
    // secret beside it, and no wildcard.
    const ssm = statements().find((s) => actionsOf(s).includes("ssm:GetParameter"))!
    expect(actionsOf(ssm)).toEqual(["ssm:GetParameter"])
    const paths = JSON.stringify(ssm.Resource).match(/parameter\/[^"]+/g) ?? []
    expect(paths).toEqual(["parameter/amplify/shared/d14fhvl4rp79nn/STRAVA_WEBHOOK_VERIFY_TOKEN"])

    const update = statements().find((s) => actionsOf(s).includes("dynamodb:UpdateItem"))! as Statement & {
      Condition?: unknown
    }
    expect(JSON.stringify(update.Resource)).toMatch(/IngestReceiptTable/)
    expect(JSON.stringify(update.Resource)).not.toContain("index")
    expect(update.Condition).toEqual({ "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["rate#*"] } })
    // Not on the same statement as the accept gate's PutItem, which must stay unconditioned.
    expect(actionsOf(update)).toEqual(["dynamodb:UpdateItem"])

    const put = statements().find((s) => actionsOf(s).includes("dynamodb:PutItem"))!
    expect(JSON.stringify(put.Resource)).toMatch(/IngestReceiptTable/)
    expect(JSON.stringify(put.Resource)).not.toContain("index")

    const send = statements().find((s) => actionsOf(s).includes("sqs:SendMessage"))!
    expect(JSON.stringify(send.Resource)).toMatch(/ActivityIngestQueue/)
    expect(JSON.stringify(send.Resource)).not.toMatch(/DLQ/)
  })

  it("holds NO grant on LostSolesSourceAccount — by policy, not by discipline (§4.5)", () => {
    const rendered = JSON.stringify(statements())
    expect(rendered).not.toMatch(/SourceAccount/)
    expect(rendered).not.toMatch(/kms:/)
  })

  it("holds no wildcard resource and no wildcard action", () => {
    for (const s of statements()) {
      expect(actionsOf(s).some((a) => a.includes("*"))).toBe(false)
      expect(JSON.stringify(s.Resource)).not.toBe('"*"')
    }
  })
})

/**
 * Ticket 0093 — the infrastructure layers of the cost-DoS defence (`08-security-privacy.md` §4.4).
 * Each is invisible to a runtime test and only "works" in production, which is why each is pinned
 * here against the synthesized template.
 */
describe("cost-DoS defence (ticket 0093)", () => {
  it("reserves concurrency 5 on the webhook function (§4.4 item 1)", () => {
    expect(webhookFunction()[1].Properties.ReservedConcurrentExecutions).toBe(5)
  })

  it("counts `webhook-flood` lines from the webhook's own log group, and alarms on any", () => {
    const filters = Object.values(stack.findResources("AWS::Logs::MetricFilter")).map(
      (f) => (f as Resource).Properties,
    )
    expect(filters).toHaveLength(1)
    expect(filters[0].FilterPattern).toBe('"webhook-flood"')
    expect(JSON.stringify(filters[0].LogGroupName)).toContain("/aws/lambda/")
    expect(filters[0].MetricTransformations).toEqual([
      expect.objectContaining({ MetricNamespace: "LostSoles", MetricName: "WebhookOwnerFlood", MetricValue: "1" }),
    ])

    const alarms = Object.values(stack.findResources("AWS::CloudWatch::Alarm")).map(
      (a) => (a as Resource).Properties,
    )
    const flood = alarms.find((a) => a.MetricName === "WebhookOwnerFlood")!
    expect(flood).toMatchObject({
      Namespace: "LostSoles",
      Statistic: "Sum",
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
      TreatMissingData: "notBreaching",
    })
    // Emails through the same topic as the DLQ alarm.
    expect(JSON.stringify(flood.AlarmActions)).toMatch(/IngestAlarms/)
  })

  it("synthesizes no AWS Budget: cost alerting is the operator's, outside this project (D-361)", () => {
    const budgets = everyStack.flatMap((t) => Object.keys(t.findResources("AWS::Budgets::Budget")))
    expect(budgets).toEqual([])
  })
})
