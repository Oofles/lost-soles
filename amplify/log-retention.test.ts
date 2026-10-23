import { describe, expect, it } from "vitest"

/**
 * Ticket 0305 — every Lost Soles log group expires after 30 days (`08-security-privacy.md` §3.1,
 * §6.1). Asserted against the CloudFormation the backend actually synthesizes, across EVERY stack,
 * so a function added anywhere — `defineFunction`, raw CDK, or a framework Lambda some construct
 * brings with it — fails here if its group would never expire.
 *
 * Synthesized at MODULE SCOPE, not inside a test: a full synth outruns vitest's per-test timeout
 * in the Amplify build container (ticket 0041).
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { App, Stack } = await import("aws-cdk-lib")
const { Template } = await import("aws-cdk-lib/assertions")
const { Function: LambdaFunction, Code, Runtime } = await import("aws-cdk-lib/aws-lambda")
const { backend } = await import("./backend")
const {
  AMPLIFY_HOSTING_LOG_GROUP,
  LOG_RETENTION_DAYS,
  LOG_RETENTION_PROVIDER_ID,
  applyLogRetention,
} = await import("./log-retention")

type Resource = { Type: string; Properties?: Record<string, unknown> }
type Template = ReturnType<typeof Template.fromStack>

/** Every function in `template` whose `/aws/lambda/<name>` group has no 30-day retention. */
function uncovered(template: Template): string[] {
  const all = template.toJSON().Resources as Record<string, Resource>
  const retained = new Set(
    Object.values(all)
      .filter((r) => r.Type === "Custom::LogRetention")
      .filter((r) => r.Properties?.RetentionInDays === LOG_RETENTION_DAYS)
      .map((r) => JSON.stringify(r.Properties?.LogGroupName)),
  )
  return Object.entries(all)
    .filter(([, r]) => r.Type === "AWS::Lambda::Function")
    .filter(([id]) => !id.startsWith(LOG_RETENTION_PROVIDER_ID))
    .filter(
      ([id]) => !retained.has(JSON.stringify({ "Fn::Join": ["", ["/aws/lambda/", { Ref: id }]] })),
    )
    .map(([id]) => id)
}

const stacks = backend.stack.node.root.node
  .findAll()
  .filter((c): c is InstanceType<typeof Stack> => Stack.isStack(c))
const templates = stacks.map((s) => ({ name: s.node.path, template: Template.fromStack(s) }))

describe("30-day log retention (ticket 0305)", () => {
  it("covers every Lambda in every stack, framework Lambdas included", () => {
    const functions = templates.flatMap(
      ({ template }) => Object.keys(template.findResources("AWS::Lambda::Function")),
    )
    // Seven `defineFunction`s plus seven framework Lambdas at 0305; a vacuous pass would read zero.
    expect(functions.length).toBeGreaterThanOrEqual(10)
    for (const { name, template } of templates) {
      expect(uncovered(template), `functions in ${name} with no 30-day retention`).toEqual([])
    }
  })

  it("keeps every group at its default /aws/lambda/<name> path", () => {
    // A LoggingConfig.LogGroup would send logs somewhere the retention above never reaches, and
    // detach the webhook flood alarm's metric filter, which reads the default path by name.
    for (const { template } of templates) {
      for (const fn of Object.values(template.findResources("AWS::Lambda::Function"))) {
        const config = (fn as Resource).Properties?.LoggingConfig as { LogGroup?: unknown } | undefined
        expect(config?.LogGroup).toBeUndefined()
      }
    }
  })

  it("sets the Amplify Hosting app's group to 30 days on a branch deploy", () => {
    const hosting = templates.flatMap(({ template }) =>
      Object.values(
        template.findResources("Custom::LogRetention", {
          Properties: { LogGroupName: AMPLIFY_HOSTING_LOG_GROUP },
        }),
      ),
    )
    expect(hosting).toHaveLength(1)
    expect((hosting[0] as Resource).Properties?.RetentionInDays).toBe(LOG_RETENTION_DAYS)
  })

  it("never deletes a group when the retention resource is removed", () => {
    for (const { template } of templates) {
      for (const r of Object.values(template.findResources("Custom::LogRetention"))) {
        expect((r as Resource).Properties?.RemovalPolicy).not.toBe("destroy")
      }
    }
  })

  it("fails on a function the aspect does not reach — the check is not vacuous", () => {
    const app = new App()
    const stack = new Stack(app, "Probe")
    new LambdaFunction(stack, "Bare", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromInline("exports.handler = async () => {}"),
    })
    expect(uncovered(Template.fromStack(stack))).toHaveLength(1)

    const covered = new App()
    const coveredStack = new Stack(covered, "Probe")
    new LambdaFunction(coveredStack, "Bare", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: Code.fromInline("exports.handler = async () => {}"),
    })
    applyLogRetention(coveredStack)
    expect(uncovered(Template.fromStack(coveredStack))).toEqual([])
  })
})
