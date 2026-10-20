import { execFile } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { promisify } from "node:util"

import { DescribeContinuousBackupsCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { S3Client } from "@aws-sdk/client-s3"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

import { isOwner } from "../../lib/auth/owner-ids"
import { SOURCE_ACCOUNT_TABLE } from "../../lib/sources/source-account-store"
import { EXPLORED_CELL_TABLE } from "../../src/pipeline/explored-cells"
import { INGEST_RECEIPT_TABLE } from "../../src/pipeline/ingest-receipt"
import { modelTables } from "../xp-replay/tables"
import { ConfirmationMismatch, OwnerRefused, renderConfirmation, runAccountDeletion } from "./deletion"
import { revokeAllSources } from "./revoke"

/**
 * DELETE AN ACCOUNT. Ticket `0106`. The runbook is `docs/runbooks/account-deletion.md`; read it first.
 *
 *   npx vite-node --config vitest.config.ts tools/account-deletion/delete-account.ts -- --user <cognito-sub>
 *        [--identity-id <us-east-1:uuid>]   the user's identity-pool id, if users/<it>/ exists
 *        [--resume]                         the Cognito user is already gone (a re-run)
 *        [--delete-owner]                   required, on top of the typed uid, if the sub is the owner
 *
 * Read-only until you TYPE THE UID. A mismatch exits 3 having changed nothing. Run as the operator
 * (`AWS_PROFILE=devault`); the script assumes `LostSolesArchiveDeletion` itself, for step 5 only.
 * The operator's own principal must NOT be able to delete under `raw/*` — the script proves that
 * against the live bucket policy before it starts, and refuses to run if it is not true.
 *
 * The written confirmation (step 8) is printed and saved to `tmp/account-deletion/` (gitignored).
 */

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "")
const outputs = JSON.parse(readFileSync(`${ROOT}/amplify_outputs.json`, "utf8")) as {
  auth?: { user_pool_id?: string; aws_region?: string }
  storage?: { bucket_name?: string }
}

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
const uid = flag("user")
if (!uid) {
  console.error("usage: delete-account.ts --user <cognito-sub> [--identity-id <id>] [--resume] [--delete-owner]")
  process.exit(2)
}
const region = outputs.auth?.aws_region ?? "us-east-1"
const bucket = outputs.storage?.bucket_name
const userPoolId = outputs.auth?.user_pool_id
if (!bucket || !userPoolId) {
  console.error("amplify_outputs.json has no storage.bucket_name or auth.user_pool_id")
  process.exit(2)
}

const run = promisify(execFile)
async function cli(cliArgs: string[]): Promise<unknown> {
  const { stdout } = await run("aws", [...cliArgs, "--region", region, "--output", "json"], { maxBuffer: 64 * 1024 * 1024 })
  return stdout.trim() ? JSON.parse(stdout) : null
}

const raw = new DynamoDBClient({ region })
const ddb = DynamoDBDocumentClient.from(raw)
const s3 = new S3Client({ region })
const models = await modelTables(raw)
const caller = (await cli(["sts", "get-caller-identity"])) as { Account: string }

/** Created only when the question is asked, so stdin is not read during the preflight. */
async function ask(prompt: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await readline.question(prompt)
  } catch {
    return "" // stdin closed: no answer is a non-matching answer
  } finally {
    readline.close()
  }
}

try {
  const result = await runAccountDeletion({
    uid,
    bucket,
    userPoolId,
    breakGlassRoleArn: `arn:aws:iam::${caller.Account}:role/LostSolesArchiveDeletion`,
    identityId: flag("identity-id"),
    resume: args.includes("--resume"),
    isOwner: isOwner(uid),
    deleteOwner: args.includes("--delete-owner"),
    tables: {
      SourceAccount: SOURCE_ACCOUNT_TABLE,
      ExploredCell: EXPLORED_CELL_TABLE,
      IngestReceipt: INGEST_RECEIPT_TABLE,
      OAuthState: "LostSolesOAuthState",
      Activity: models.Activity,
      XpLedgerEntry: models.XpLedgerEntry,
      SkillState: models.SkillState,
      Landmark: models.Landmark,
      Profile: models.Profile,
    },
    s3,
    ddb,
    cli,
    makeS3: (c) =>
      new S3Client({
        region,
        credentials: { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken },
      }),
    revokeUpstream: (userId) => revokeAllSources(userId),
    async pitr(table) {
      const d = await raw.send(new DescribeContinuousBackupsCommand({ TableName: table }))
      const p = d.ContinuousBackupsDescription?.PointInTimeRecoveryDescription
      return { enabled: p?.PointInTimeRecoveryStatus === "ENABLED", days: p?.RecoveryPeriodInDays ?? 35 }
    },
    ask,
    log: (line) => console.log(line),
  })
  const text = renderConfirmation(result, bucket)
  mkdirSync(`${ROOT}/tmp/account-deletion`, { recursive: true })
  const file = `${ROOT}/tmp/account-deletion/${uid}-${result.finishedAt.replace(/[:.]/g, "-")}.md`
  writeFileSync(file, text)
  console.log(`\n${text}\nsaved: ${file}`)
  process.exitCode = result.couldNotDelete.length ? 1 : 0
} catch (error) {
  if (error instanceof ConfirmationMismatch || error instanceof OwnerRefused) {
    console.error(error.message)
    process.exitCode = 3
  } else {
    console.error("ABORTED:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
