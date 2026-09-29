import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * T1 `Profile`, asserted against the synthesized backend. Ticket 0066, `02-data-model.md` T1, D-258.
 *
 * The field-level narrowing is the assertion that matters: the owner may edit their preferences,
 * and may only READ the four attributes the pipeline owns. A dropped `.authorization()` on
 * `totalLevel` would let a client forge the headline, and nothing else would notice.
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

  it("is owner-scoped at the model", () => {
    expect(profileType().split("\n")[0]).toMatch(/^type Profile @model @auth\(rules: \[\{allow: owner, ownerField: "owner"\}\]\)/)
  })

  it.each(["totalLevel", "totalXp", "replayInProgress", "exploredGeneration"])(
    "the owner can only READ %s",
    (field) => {
      const line = profileType()
        .split("\n")
        .find((l) => l.trim().startsWith(`${field}:`))
      expect(line, `no ${field} on Profile`).toBeDefined()
      expect(line).toMatch(/@auth\(rules: \[\{allow: owner, operations: \[read\], ownerField: "owner"\}\]\)/)
    },
  )

  it.each(["displayName", "mapMode", "showColdTerritory", "rulesVersionPinned"])(
    "%s stays the owner's to write",
    (field) => {
      const line = profileType()
        .split("\n")
        .find((l) => l.trim().startsWith(`${field}:`))
      expect(line).toBeDefined()
      expect(line).not.toMatch(/@auth/)
    },
  )
})
