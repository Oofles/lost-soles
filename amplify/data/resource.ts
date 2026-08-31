import { a, defineData, type ClientSchema } from "@aws-amplify/backend"

/**
 * SKELETON ONLY. The real models (Activity, SourceAccount, XpLedgerEntry,
 * ExploredCell, …) arrive with capabilities 04-06; the machine-only tables come
 * through the CDK escape hatch instead (01-architecture.md §2).
 *
 * `defineData` refuses an empty schema, so one trivially small owner-scoped model
 * stands in. It is a placeholder, not a design: nothing should build on it.
 */
const schema = a.schema({
  DeploySmokeTest: a
    .model({
      note: a.string(),
    })
    .authorization((allow) => [allow.owner()]),
})

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
})
