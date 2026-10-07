import { describe, expect, it } from "vitest"

/**
 * Ticket 0069, criterion 4, and I-20's carve-out: `logWorkout` accepts MEASURED WORK ONLY.
 *
 * Asserted on the GENERATED SDL — what AppSync will actually serve — rather than on the
 * `a.mutation()` source, because the transform is where an argument could appear that the
 * source does not obviously spell (a `ref` to a widened type, a default the builder adds).
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

/** The body of `type X {…}` or `input X {…}`, one field per line, names only. */
function fieldsOf(kind: "type" | "input", name: string): string[] {
  const start = sdl.split("\n").findIndex((l) => l.startsWith(`${kind} ${name} `) || l === `${kind} ${name} {`)
  expect(start, `${kind} ${name} not in the generated SDL`).toBeGreaterThanOrEqual(0)
  const out: string[] = []
  for (const line of sdl.split("\n").slice(start + 1)) {
    if (line.startsWith("}")) break
    out.push(line.trim().split(/[(:]/)[0]!)
  }
  return out
}

const mutationLine = () => sdl.split("\n").find((l) => l.trim().startsWith("logWorkout("))!

/** Anything that names a reward rather than a measurement. */
const FORBIDDEN = /xp|skill|level|award|score|rating|cell|generation/i

describe("logWorkout's arguments are measured work only (I-20)", () => {
  it("takes exactly: exercise, sets, when, idempotency key, zone", () => {
    const line = mutationLine()
    const list = line.slice(line.indexOf("(") + 1, line.indexOf(")"))
    const args = [...list.matchAll(/(\w+):/g)].map((m) => m[1])
    expect(args).toEqual(["exerciseId", "sets", "occurredAt", "idempotencyKey", "timezone"])
  })

  it("no argument and no set field names a reward", () => {
    const line = mutationLine()
    // The argument NAMES only: the return type `LogWorkoutResult` legitimately reports xp.
    const names = [...line.slice(line.indexOf("(") + 1, line.indexOf(")")).matchAll(/(\w+):/g)].map((m) => m[1])
    for (const name of names) expect(name).not.toMatch(FORBIDDEN)
    for (const field of fieldsOf("input", "LogWorkoutSetInput")) expect(field).not.toMatch(FORBIDDEN)
  })

  it("a set carries only the measurement fields `WorkoutSet` has", () => {
    expect(fieldsOf("input", "LogWorkoutSetInput")).toEqual(["reps", "durationS", "weightKg"])
  })

  it("is one of exactly two custom mutations the API serves (0244 added setActivityKind)", () => {
    expect(fieldsOf("type", "Mutation")).toEqual(["logWorkout", "setActivityKind"])
  })

  it("is signed-in only, never public or guest", () => {
    expect(mutationLine()).toMatch(/@auth\(rules: \[\{allow: private\}\]\)/)
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
