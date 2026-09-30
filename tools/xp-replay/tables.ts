import { ListTablesCommand, type DynamoDBClient } from "@aws-sdk/client-dynamodb"

export type ModelTables = Record<"Profile" | "SkillState" | "XpLedgerEntry" | "Activity", string>

/** `defineData` names each table `<Model>-<apiId>-NONE`. Exactly one of each, or stop. */
export async function modelTables(raw: DynamoDBClient): Promise<ModelTables> {
  const names: string[] = []
  let ExclusiveStartTableName: string | undefined
  do {
    const page = await raw.send(new ListTablesCommand({ ExclusiveStartTableName }))
    names.push(...(page.TableNames ?? []))
    ExclusiveStartTableName = page.LastEvaluatedTableName
  } while (ExclusiveStartTableName)
  const one = (model: string) => {
    const hits = names.filter((n) => new RegExp(`^${model}-[a-z0-9]+-NONE$`).test(n))
    if (hits.length !== 1) throw new Error(`expected one ${model} table, found ${JSON.stringify(hits)}`)
    return hits[0]!
  }
  return {
    Profile: one("Profile"),
    SkillState: one("SkillState"),
    XpLedgerEntry: one("XpLedgerEntry"),
    Activity: one("Activity"),
  }
}
