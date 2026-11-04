import { describe, expect, it } from "vitest"

/**
 * Ticket 0069, and I-20's carve-out: `log-workout` takes MEASURED WORK ONLY.
 *
 * Until `0334` this asserted the `logWorkout` mutation's generated SDL. `0334` (D-472, D-475)
 * deleted the mutation: the browser reaches the Lambda through `POST /api/log`, which picks the
 * five measured-work fields and sets `userId` from the session, and `app/api/log/route.test.ts`
 * pins that ("ignores a userId in the body, and every field the mutation never had"). What is
 * asserted here now is that AppSync serves no mutation of its own at all, and the Lambda's grants.
 */

process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")
const { data } = await import("./data/resource")

const sdl = (data as unknown as { props: { schema: { transform(): { schema: string } } } }).props.schema.transform().schema

describe("AppSync serves no custom mutation (0334, D-472)", () => {
  it("has no logWorkout or setActivityKind, and no Mutation type beyond the models' own", () => {
    expect(sdl).not.toMatch(/\blogWorkout\b|\bsetActivityKind\b/)
    expect(sdl).not.toMatch(/LogWorkout|SetActivityKind/)
  })
})

describe("the log-workout Lambda's grants", () => {
  const template = Template.fromStack(backend.logWorkoutFunction.stack)
  const statements = () =>
    Object.values(template.findResources("AWS::IAM::Policy"))
      .filter((p) => JSON.stringify(p).includes("logworkout") || JSON.stringify(p).includes("LogWorkout"))
      .flatMap((p) => (p.Properties as { PolicyDocument: { Statement: Array<{ Action: string | string[] }> } }).PolicyDocument.Statement)
  const actions = () => statements().flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]))

  it("can write the ledger and the activity, and has no queue, secret or delete", () => {
    expect(actions()).toContain("dynamodb:PutItem")
    expect(actions().filter((a) => a.startsWith("sqs:") || a.startsWith("ssm:") || a.startsWith("kms:"))).toEqual([])
    expect(actions().filter((a) => /Delete/.test(a))).toEqual([])
  })

  it("has no grant on the explored cell table — a pushup cannot reveal ground (I-27)", () => {
    expect(JSON.stringify(statements())).not.toMatch(/ExploredCell/)
  })

  it("can list raw/ for a kind override, and nothing else in the bucket (0243)", () => {
    const lists = statements().filter((s) => [s.Action].flat().includes("s3:ListBucket")) as Array<{
      Condition?: { StringLike?: { "s3:prefix"?: string[] } }
    }>
    expect(lists).toHaveLength(1)
    expect(lists[0]!.Condition?.StringLike?.["s3:prefix"]).toEqual(["raw/*"])
  })

  it("is not VPC-attached (D-081)", () => {
    for (const fn of Object.values(template.findResources("AWS::Lambda::Function"))) {
      expect((fn.Properties as Record<string, unknown>).VpcConfig).toBeUndefined()
    }
  })
})
