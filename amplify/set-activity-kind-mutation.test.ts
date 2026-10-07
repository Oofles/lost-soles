import { describe, expect, it } from "vitest"

/**
 * Ticket `0244`, criterion 1: `setActivityKind` is owner-only on `logWorkout`'s pattern.
 *
 * Asserted on the GENERATED SDL, as `log-workout-mutation.test.ts` is, because that is what
 * AppSync serves. The owner half — `identity.sub`, the allowlist — is the handler's, and is
 * pinned in `functions/set-activity-kind/handler.test.ts`.
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
const mutationLine = () => sdl.split("\n").find((l) => l.trim().startsWith("setActivityKind("))!

describe("setActivityKind's surface", () => {
  it("takes exactly an activity id and a kind — no user, no XP", () => {
    const line = mutationLine()
    const args = [...line.slice(line.indexOf("(") + 1, line.indexOf(")")).matchAll(/(\w+):/g)].map((m) => m[1])
    expect(args).toEqual(["activityId", "kind"])
  })

  it("is signed-in only, never public or guest", () => {
    expect(mutationLine()).toMatch(/@auth\(rules: \[\{allow: private\}\]\)/)
    expect(mutationLine()).not.toMatch(/public|iam/)
  })
})

describe("the set-activity-kind Lambda's grants", () => {
  const template = Template.fromStack(backend.setActivityKindFunction.stack)
  const statements = () =>
    Object.values(template.findResources("AWS::IAM::Policy"))
      .filter((p) => /setactivitykind/i.test(JSON.stringify(p)))
      .flatMap((p) => (p.Properties as { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> } }).PolicyDocument.Statement)
  const actions = () => statements().flatMap((s) => [s.Action].flat())

  it("has no queue, secret or source credential", () => {
    expect(actions().filter((a) => a.startsWith("sqs:") || a.startsWith("ssm:"))).toEqual([])
    expect(JSON.stringify(statements())).not.toMatch(/SourceAccount|IngestReceipt/)
  })

  it("can delete only ledger rows and expired deltas — never a cell, an activity or raw/ (I-3, I-7)", () => {
    const deletes = statements().filter((s) => [s.Action].flat().some((a) => /Delete/.test(a)))
    const flat = JSON.stringify(deletes)
    expect([...new Set(deletes.flatMap((s) => [s.Action].flat().filter((a) => /Delete/.test(a))))].sort()).toEqual([
      "dynamodb:DeleteItem",
      "s3:DeleteObject",
    ])
    expect(flat).toMatch(/XpLedgerEntry/)
    expect(flat).toMatch(/users\/\*\/deltas\/\*/)
    expect(flat).not.toMatch(/ExploredCell|raw\/\*/)
  })

  it("is not VPC-attached (D-081)", () => {
    for (const fn of Object.values(template.findResources("AWS::Lambda::Function"))) {
      expect((fn.Properties as Record<string, unknown>).VpcConfig).toBeUndefined()
    }
  })
})
