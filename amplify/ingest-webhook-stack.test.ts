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
    expect(env).not.toMatch(/CLIENT_SECRET|refresh_?token|access_?token|AMPLIFY_SSM_ENV_CONFIG":"\{[^}]/i)
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
  it("is exactly two grants: PutItem on the receipt table, SendMessage on the queue", () => {
    const actions = statements().flatMap(actionsOf).sort()
    expect(actions).toEqual(["dynamodb:PutItem", "sqs:SendMessage"])

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
