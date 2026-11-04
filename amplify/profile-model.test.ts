import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * T1 `Profile`, asserted against the synthesized backend. Ticket 0066, `02-data-model.md` T1, D-258.
 *
 * Until `0334` the field-level narrowing was the assertion that mattered (D-258): the owner could
 * edit preferences and only READ what the pipeline owns. `0334` (D-472) left AppSync with no
 * caller, so the assertion now is the stronger one: the model is IAM-only read, no field carries a
 * rule of its own that could widen it, and nothing in the schema is owner-scoped any more.
 *
 * Synthesized once at module scope — see `activity-model.test.ts` on the 5 s timeout.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")
const { data } = await import("./data/resource")

const profileTable = backend.data.resources.tables["Profile"]
const template = Template.fromStack(profileTable.stack as Stack)
const sdl = (data as unknown as { props: { schema: { transform(): { schema: string } } } }).props.schema.transform().schema

/** The SDL block for `type Profile … { … }`. */
function profileType(): string {
  const start = sdl.indexOf("type Profile ")
  expect(start, "no Profile type in the generated schema").toBeGreaterThan(-1)
  return sdl.slice(start, sdl.indexOf("\n}", start) + 2)
}

describe("T1 Profile", () => {
  it("PK is id (the Cognito sub), with no sort key and no GSIs", () => {
    const [, t] = Object.entries(template.findResources("Custom::AmplifyDynamoDBTable")).find(([id]) =>
      id.startsWith("Profile"),
    )!
    const props = t.Properties as {
      keySchema: Array<{ attributeName: string; keyType: string }>
      globalSecondaryIndexes?: unknown[]
    }
    expect(props.keySchema).toEqual([{ attributeName: "id", keyType: "HASH" }])
    expect(props.globalSecondaryIndexes ?? []).toEqual([])
  })

  it("is IAM-only read at the model, with no owner rule (D-472)", () => {
    expect(profileType().split("\n")[0]).toBe(
      "type Profile @model @auth(rules: [{allow: private, provider: identityPool, operations: [read]}])",
    )
    expect(profileType()).not.toMatch(/allow: owner|ownerField/)
  })

  it.each([
    "totalLevel",
    "totalXp",
    "replayInProgress",
    "exploredGeneration",
    "ledgerRulesVersion",
    "displayName",
    "showColdTerritory",
    "rulesVersionPinned",
  ])("%s carries no field rule of its own (nothing could widen it past the model's)", (field) => {
    const line = profileType()
      .split("\n")
      .find((l) => l.trim().startsWith(`${field}:`))
    expect(line, `no ${field} on Profile`).toBeDefined()
    expect(line).not.toMatch(/@auth/)
  })
})
