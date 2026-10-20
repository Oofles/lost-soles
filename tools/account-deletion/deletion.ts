import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketPolicyCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3"
import { BatchWriteCommand, GetCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"

/**
 * DELETE ONE ACCOUNT. Ticket `0106`; `08-security-privacy.md` §6.4, `02-data-model.md` §8.5.
 *
 * The one operation in this system permitted to delete `ExploredCell` items and `raw/` objects
 * (§8.5). Everything here is ordered, and the order is the design:
 *
 *   1  revoke upstream            — the third party stops sending data before anything is removed
 *   2  delete SourceAccount       — tokens gone; stop the inflow before the outflow
 *   3  disable + global sign-out  — sessions stop NOW, while the slower deletes run
 *   4  DynamoDB rows by uid       — every owner-scoped table (D-307)
 *   5  S3 current objects         — `raw/<uid>/` under the BREAK-GLASS role, the rest as the operator
 *   6  purge every version        — a delete marker over live bytes is not a deletion
 *   6b multipart-abort lifecycle  — checked, not set: it is infrastructure (`amplify/backend.ts`)
 *   3c delete the Cognito user    — LAST of the destructive steps (see below)
 *   7  logs age out               — the 30-day retention is the answer; nothing is scrubbed
 *   8  confirm in writing         — `renderConfirmation`
 *
 * WHY THE COGNITO DELETE IS AFTER THE DATA, not inside step 3. The three texts agree once read
 * together: `02` §8.5 lists "Delete the Cognito user" last; `08` §6.4 says sign-out "fails on a user
 * that no longer exists, so delete comes last"; and `0106` says disabling first "stops sessions
 * immediately while the slower deletes run" — which only means something if the delete waits for
 * them. It also keeps a failed run resumable: until the very end the uid still names a (disabled)
 * user, so a re-run with `--resume` finds what is left.
 *
 * ─── THE BREAK-GLASS SPLIT ──────────────────────────────────────────────────
 *
 * The bucket policy denies `s3:DeleteObject` and `s3:DeleteObjectVersion` on `raw/*` to every
 * principal but `LostSolesArchiveDeletion` (`amplify/backend.ts`, ticket `0039`, D-205). That role
 * can delete under `raw/*` and do NOTHING else — no list, no read. So enumeration always runs as the
 * operator and only the raw deletions run as the role. Nothing here grants anybody `raw/*` delete
 * rights; the friction of assuming the role is the protection (§6.4 step 5).
 *
 * The guard is checked before it is relied on: `verifyArchiveGuard` simulates the operator's own
 * principal against the LIVE bucket policy and requires an explicit deny, and `probeArchiveGuard`
 * then asks S3 itself, with a delete of a version that cannot exist under a key that cannot exist —
 * a request that changes nothing whether or not it is allowed — and requires AccessDenied.
 */

// ─── Seams ────────────────────────────────────────────────────────────────────

/** Structural, so a test passes a fake versioned bucket. */
export interface S3Like {
  send(command: object): Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
}
/** A `DynamoDBDocumentClient`, structurally. */
export interface DdbLike {
  send(command: object): Promise<any> // eslint-disable-line @typescript-eslint/no-explicit-any
}
/** One `aws` CLI call, `--output json` appended, parsed. `null` for an empty response. */
export type Cli = (args: string[]) => Promise<unknown>

export interface TableNames {
  SourceAccount: string
  ExploredCell: string
  IngestReceipt: string
  OAuthState: string
  Activity: string
  XpLedgerEntry: string
  SkillState: string
  Landmark: string
  Profile: string
}

export interface RevokeOutcome {
  source: string
  /** `no-connection` covers a row with no token too: nothing live to revoke (D-348). */
  outcome: "revoked" | "no-connection"
}

export interface DeletionEnv {
  uid: string
  bucket: string
  userPoolId: string
  breakGlassRoleArn: string
  /** The identity-pool id, if the operator supplied it (`users/{entity_id}/`). */
  identityId?: string
  tables: TableNames
  /** The operator's ambient credentials. */
  s3: S3Like
  ddb: DdbLike
  cli: Cli
  /** Builds an S3 client from assumed-role credentials. */
  makeS3(credentials: { AccessKeyId: string; SecretAccessKey: string; SessionToken: string }): S3Like
  /** Step 1. Wired to the real connector's `revoke` in the entry point. */
  revokeUpstream(uid: string): Promise<RevokeOutcome[]>
  pitr(table: string): Promise<{ enabled: boolean; days: number }>
  /** A typed answer to `prompt`. */
  ask(prompt: string): Promise<string>
  /** Permits a Cognito user that is already gone (a re-run after a partial failure). */
  resume?: boolean
  /** True when the uid is in `OWNER_USER_IDS`. Refused unless `deleteOwner` is also set. */
  isOwner?: boolean
  /** `--delete-owner`. The typed-uid confirmation still applies on top of it. */
  deleteOwner?: boolean
  now?: () => Date
  log?: (line: string) => void
  /** Probe key suffix; injected so a test is deterministic. */
  probeId?: () => string
}

// ─── What gets enumerated ─────────────────────────────────────────────────────

type Item = Record<string, unknown>

interface TableSpec {
  label: keyof TableNames
  /** How this table is enumerated for one uid. */
  find:
    | { kind: "query"; index?: string; attr: string; value: (uid: string) => string }
    | { kind: "scan-prefix"; attr: string; prefix: (uid: string) => string }
    | { kind: "scan-eq"; attr: string }
    | { kind: "get"; key: (uid: string) => Item }
  /** The base table's primary key, projected out of whatever `find` returned. */
  keyAttrs: string[]
}

/**
 * EVERY OWNER-SCOPED TABLE (D-307), in the order step 4 deletes them. `SourceAccount` is here so
 * the inventory counts it, but step 2 deletes it, before step 3.
 *
 * Two scans, both deliberate. `ExploredCell`'s partitions are `U#<uid>#C#<parent>` and
 * `U#<uid>#AGG#<res>` — many per user, so a `begins_with` over the partition key is the only
 * enumeration that cannot miss a stray row. `IngestReceipt` has no user index outside its sparse
 * failure index. Both tables are thousands of rows at this scale (one user, D-014), and a deletion
 * that leaves a row behind is not a deletion.
 *
 * NOT HERE: `LostSolesCaptureGuard` (rate-limits the ticket-capture endpoint, holds no user data)
 * and `DeploySmokeTest`. `OAuthState` rows TTL in minutes but are swept anyway — free, and §6.4
 * says "any un-TTL'd rows".
 */
export const TABLE_SPECS: readonly TableSpec[] = [
  { label: "SourceAccount", find: { kind: "query", attr: "pk", value: (u) => `U#${u}` }, keyAttrs: ["pk", "sk"] },
  { label: "ExploredCell", find: { kind: "scan-prefix", attr: "pk", prefix: (u) => `U#${u}#` }, keyAttrs: ["pk", "sk"] },
  { label: "Activity", find: { kind: "query", index: "byUserAndStart", attr: "userId", value: (u) => u }, keyAttrs: ["id"] },
  { label: "XpLedgerEntry", find: { kind: "query", index: "byUserAndSeq", attr: "userId", value: (u) => u }, keyAttrs: ["id"] },
  { label: "SkillState", find: { kind: "query", attr: "userId", value: (u) => u }, keyAttrs: ["userId", "skillId"] },
  { label: "Landmark", find: { kind: "query", attr: "userId", value: (u) => u }, keyAttrs: ["userId", "skillLevel"] },
  { label: "Profile", find: { kind: "get", key: (u) => ({ id: u }) }, keyAttrs: ["id"] },
  { label: "IngestReceipt", find: { kind: "scan-eq", attr: "userId" }, keyAttrs: ["ingestKey"] },
  { label: "OAuthState", find: { kind: "scan-eq", attr: "userId" }, keyAttrs: ["pk"] },
]

const RAW = (uid: string) => `raw/${uid}/`

/** Every S3 prefix that belongs to one uid. `raw/` is the only one behind the break-glass role. */
export function s3Prefixes(uid: string, identityId?: string): string[] {
  return [
    RAW(uid),
    // The delivery layer and traces, keyed by the Cognito sub (`explored-blob-store.ts`).
    `users/${uid}/`,
    // D-143 skill-state snapshots, D-259 (`0067`'s note on this ticket).
    `snapshots/skillstate/${uid}/`,
    // `entity('identity')` — `users/{identityId}/`, a DIFFERENT string from the sub.
    ...(identityId ? [`users/${identityId}/`] : []),
  ]
}

const isRaw = (key: string) => key.startsWith("raw/")

// ─── DynamoDB ─────────────────────────────────────────────────────────────────

async function findItems(env: DeletionEnv, spec: TableSpec): Promise<Item[]> {
  const TableName = env.tables[spec.label]
  const { find } = spec
  if (find.kind === "get") {
    const got = await env.ddb.send(new GetCommand({ TableName, Key: find.key(env.uid) }))
    return got.Item ? [got.Item as Item] : []
  }
  const out: Item[] = []
  let ExclusiveStartKey: Item | undefined
  do {
    const page =
      find.kind === "query"
        ? await env.ddb.send(
            new QueryCommand({
              TableName,
              IndexName: find.index,
              KeyConditionExpression: "#k = :v",
              ExpressionAttributeNames: { "#k": find.attr },
              ExpressionAttributeValues: { ":v": find.value(env.uid) },
              ExclusiveStartKey,
            }),
          )
        : await env.ddb.send(
            new ScanCommand({
              TableName,
              FilterExpression: find.kind === "scan-prefix" ? "begins_with(#k, :v)" : "#k = :v",
              ExpressionAttributeNames: { "#k": find.attr },
              ExpressionAttributeValues: { ":v": find.kind === "scan-prefix" ? find.prefix(env.uid) : env.uid },
              ExclusiveStartKey,
            }),
          )
    out.push(...((page.Items ?? []) as Item[]))
    ExclusiveStartKey = page.LastEvaluatedKey as Item | undefined
  } while (ExclusiveStartKey)
  return out
}

async function deleteItems(env: DeletionEnv, spec: TableSpec): Promise<number> {
  const TableName = env.tables[spec.label]
  const items = await findItems(env, spec)
  const keys = items.map((item) => Object.fromEntries(spec.keyAttrs.map((a) => [a, item[a]])))
  for (let i = 0; i < keys.length; i += 25) {
    let pending: unknown[] = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }))
    for (let attempt = 0; pending.length > 0; attempt++) {
      if (attempt === 8) throw new Error(`${spec.label}: ${pending.length} delete(s) still unprocessed after 8 attempts`)
      const res = await env.ddb.send(new BatchWriteCommand({ RequestItems: { [TableName]: pending as never } }))
      pending = (res.UnprocessedItems?.[TableName] as unknown[] | undefined) ?? []
      if (pending.length > 0) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt))
    }
  }
  return keys.length
}

// ─── S3 ───────────────────────────────────────────────────────────────────────

interface Version {
  Key: string
  VersionId: string
  marker: boolean
  latest: boolean
}

async function listVersions(s3: S3Like, bucket: string, prefix: string): Promise<Version[]> {
  const out: Version[] = []
  let KeyMarker: string | undefined
  let VersionIdMarker: string | undefined
  do {
    const page = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: prefix, KeyMarker, VersionIdMarker }))
    for (const v of page.Versions ?? []) out.push({ Key: v.Key, VersionId: v.VersionId, marker: false, latest: !!v.IsLatest })
    for (const m of page.DeleteMarkers ?? []) out.push({ Key: m.Key, VersionId: m.VersionId, marker: true, latest: !!m.IsLatest })
    if (!page.IsTruncated) break
    KeyMarker = page.NextKeyMarker
    VersionIdMarker = page.NextVersionIdMarker
  } while (KeyMarker)
  return out
}

/** `DeleteObjects` reports refusals per key instead of throwing; a refusal here is an abort. */
async function deleteBatch(
  s3: S3Like,
  bucket: string,
  objects: Array<{ Key: string; VersionId?: string }>,
): Promise<void> {
  for (let i = 0; i < objects.length; i += 1000) {
    const res = await s3.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects.slice(i, i + 1000), Quiet: true } }),
    )
    const errors = (res.Errors ?? []) as Array<{ Key?: string; Code?: string }>
    if (errors.length > 0) {
      throw new Error(`S3 refused ${errors.length} delete(s), first: ${errors[0]!.Key} ${errors[0]!.Code}`)
    }
  }
}

export interface PrefixCount {
  prefix: string
  current: number
  noncurrent: number
  deleteMarkers: number
  /** D-284 kind overrides, `raw/` only. */
  kindOverrides: number
  /** D-284/0179 `.duplicate-of.json` pointers, `raw/` only. */
  duplicateOf: number
}

function countPrefix(prefix: string, versions: Version[]): PrefixCount {
  const live = versions.filter((v) => v.latest && !v.marker)
  return {
    prefix,
    current: live.length,
    noncurrent: versions.filter((v) => !v.latest && !v.marker).length,
    deleteMarkers: versions.filter((v) => v.marker).length,
    kindOverrides: live.filter((v) => v.Key.includes(".kind-override/")).length,
    duplicateOf: live.filter((v) => v.Key.endsWith(".duplicate-of.json")).length,
  }
}

// ─── Inventory ────────────────────────────────────────────────────────────────

export interface Inventory {
  tables: Record<string, number>
  prefixes: PrefixCount[]
}

export async function inventory(env: DeletionEnv): Promise<Inventory> {
  const tables: Record<string, number> = {}
  for (const spec of TABLE_SPECS) tables[spec.label] = (await findItems(env, spec)).length
  const prefixes: PrefixCount[] = []
  for (const prefix of s3Prefixes(env.uid, env.identityId)) {
    prefixes.push(countPrefix(prefix, await listVersions(env.s3, env.bucket, prefix)))
  }
  return { tables, prefixes }
}

// ─── Preflight ────────────────────────────────────────────────────────────────

/** `arn:aws:sts::<acct>:assumed-role/<Name>/<session>` → `arn:aws:iam::<acct>:role/<Name>`. */
export function principalArnOf(callerArn: string): string {
  const m = /^arn:aws:sts::(\d+):assumed-role\/([^/]+)\/.+$/.exec(callerArn)
  return m ? `arn:aws:iam::${m[1]}:role/${m[2]}` : callerArn
}

export interface GuardEvidence {
  caller: string
  callerDecisions: Record<string, string>
  breakGlassDecisions: Record<string, string>
  probe?: string
}

const DELETE_ACTIONS = ["s3:DeleteObject", "s3:DeleteObjectVersion"]

async function simulate(env: DeletionEnv, principal: string, policy: string): Promise<Record<string, string>> {
  const res = (await env.cli([
    "iam",
    "simulate-principal-policy",
    "--policy-source-arn",
    principal,
    "--action-names",
    ...DELETE_ACTIONS,
    "--resource-arns",
    `arn:aws:s3:::${env.bucket}/${RAW(env.uid)}deletion-guard-probe`,
    "--resource-policy",
    policy,
    "--context-entries",
    JSON.stringify([
      { ContextKeyName: "aws:PrincipalArn", ContextKeyValues: [principal], ContextKeyType: "string" },
      { ContextKeyName: "aws:SecureTransport", ContextKeyValues: ["true"], ContextKeyType: "boolean" },
    ]),
  ])) as { EvaluationResults?: Array<{ EvalActionName: string; EvalDecision: string }> }
  return Object.fromEntries((res.EvaluationResults ?? []).map((r) => [r.EvalActionName, r.EvalDecision]))
}

/**
 * THE DEFAULT PRINCIPAL CANNOT DELETE UNDER `raw/*`, and the break-glass role can — against the
 * LIVE bucket policy, as an IAM policy simulation. Read-only. Throws unless both hold.
 */
export async function verifyArchiveGuard(env: DeletionEnv): Promise<GuardEvidence> {
  const policy = (await env.s3.send(new GetBucketPolicyCommand({ Bucket: env.bucket }))).Policy as string
  const caller = principalArnOf(((await env.cli(["sts", "get-caller-identity"])) as { Arn: string }).Arn)
  if (caller === env.breakGlassRoleArn) {
    throw new Error("running AS the break-glass role. Run as the operator; the script assumes the role for step 5 only.")
  }
  const callerDecisions = await simulate(env, caller, policy)
  const breakGlassDecisions = await simulate(env, env.breakGlassRoleArn, policy)
  for (const action of DELETE_ACTIONS) {
    if (callerDecisions[action] !== "explicitDeny") {
      throw new Error(
        `the bucket policy does NOT deny ${action} on raw/* to ${caller} (${callerDecisions[action] ?? "no result"}). ` +
          "The archive is unprotected; stop and fix the bucket policy before deleting anything.",
      )
    }
    if (breakGlassDecisions[action] !== "allowed") {
      throw new Error(`the break-glass role cannot ${action} on raw/* (${breakGlassDecisions[action] ?? "no result"})`)
    }
  }
  return { caller, callerDecisions, breakGlassDecisions }
}

/**
 * THE SAME FACT, FROM S3 ITSELF. `DeleteObject` with a `VersionId` on a key that does not exist:
 * if permitted it removes nothing and writes no delete marker (markers are only written WITHOUT a
 * version id), so the request is harmless either way. Anything but AccessDenied aborts.
 * The id is the literal `"null"`, the one version id S3 accepts without having issued it: a made-up
 * id fails S3's format check (`InvalidArgument`) before authorisation is evaluated, which proves
 * nothing (first live run, 2026-10-20).
 */
export async function probeArchiveGuard(env: DeletionEnv): Promise<string> {
  const id = env.probeId?.() ?? Math.random().toString(36).slice(2)
  const Key = `${RAW(env.uid)}.deletion-guard-probe-${id}`
  try {
    await env.s3.send(new DeleteObjectCommand({ Bucket: env.bucket, Key, VersionId: "null" }))
  } catch (error) {
    const name = (error as { name?: string; Code?: string }).name ?? (error as { Code?: string }).Code
    if (name === "AccessDenied") return `AccessDenied for the default credentials on ${Key}`
    throw new Error(`guard probe expected AccessDenied, got ${name ?? String(error)}`)
  }
  throw new Error("guard probe: the default credentials were PERMITTED to delete under raw/. Stop.")
}

async function cognitoUsername(env: DeletionEnv): Promise<string | null> {
  const res = (await env.cli([
    "cognito-idp",
    "list-users",
    "--user-pool-id",
    env.userPoolId,
    "--filter",
    `sub = "${env.uid}"`,
  ])) as { Users?: Array<{ Username: string }> }
  const users = res.Users ?? []
  if (users.length > 1) throw new Error(`${users.length} Cognito users share sub ${env.uid}`)
  return users[0]?.Username ?? null
}

/** The `entity('identity')` prefixes present in the bucket, `users/<region>:<uuid>/`. */
async function identityPrefixes(env: DeletionEnv): Promise<string[]> {
  const res = await env.s3.send(new ListObjectsV2Command({ Bucket: env.bucket, Prefix: "users/", Delimiter: "/" }))
  return ((res.CommonPrefixes ?? []) as Array<{ Prefix: string }>)
    .map((p) => p.Prefix)
    .filter((p) => /^users\/[a-z]{2}-[a-z]+-\d:[0-9a-f-]{36}\/$/.test(p))
}

async function multipartAbortRule(env: DeletionEnv): Promise<string | null> {
  try {
    const res = await env.s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: env.bucket }))
    const rule = ((res.Rules ?? []) as Array<{ ID?: string; Status?: string; AbortIncompleteMultipartUpload?: { DaysAfterInitiation?: number } }>).find(
      (r) => r.Status === "Enabled" && r.AbortIncompleteMultipartUpload?.DaysAfterInitiation !== undefined,
    )
    return rule ? `${rule.ID ?? "(unnamed)"}: abort after ${rule.AbortIncompleteMultipartUpload!.DaysAfterInitiation} day(s)` : null
  } catch (error) {
    if ((error as { name?: string }).name === "NoSuchLifecycleConfiguration") return null
    throw error
  }
}

// ─── The run ──────────────────────────────────────────────────────────────────

export class OwnerRefused extends Error {
  constructor(uid: string) {
    super(`${uid} is in OWNER_USER_IDS. Deleting the owner needs --delete-owner as well as the typed uid. Nothing was changed.`)
    this.name = "OwnerRefused"
  }
}

export class ConfirmationMismatch extends Error {
  constructor() {
    super("confirmation did not match the uid. Nothing was changed.")
    this.name = "ConfirmationMismatch"
  }
}

export interface DeletionResult {
  uid: string
  startedAt: string
  finishedAt: string
  cognitoUsername: string | null
  before: Inventory
  after: Inventory
  guard: GuardEvidence
  revoked: RevokeOutcome[]
  deleted: { rows: Record<string, number>; s3Current: number; s3Versions: number }
  identityNote: string
  lifecycleRule: string | null
  pitr: Array<{ table: string; enabled: boolean; days: number }>
  couldNotDelete: string[]
  steps: string[]
}

export async function runAccountDeletion(env: DeletionEnv): Promise<DeletionResult> {
  const log = env.log ?? (() => {})
  const now = env.now ?? (() => new Date())
  const steps: string[] = []
  const step = (name: string) => {
    steps.push(name)
    log(`── ${name}`)
  }

  // ── Preflight. Read-only. ────────────────────────────────────────────────
  /**
   * THE OWNER IS REFUSED WITHOUT A SECOND, EXPLICIT FLAG (operator decision, 0106). Checked before
   * any AWS call, so a refusal has zero side effects. With `--delete-owner` the run proceeds to the
   * same preflight and the same typed confirmation as any other account.
   */
  if (env.isOwner && !env.deleteOwner) throw new OwnerRefused(env.uid)
  if (!/^[0-9a-f-]{36}$/.test(env.uid)) throw new Error(`not a Cognito sub: ${JSON.stringify(env.uid)}`)
  const username = await cognitoUsername(env)
  if (!username && !env.resume) {
    throw new Error(`no Cognito user with sub ${env.uid} in ${env.userPoolId}. (A re-run after a partial failure takes --resume.)`)
  }
  let identityNote: string
  if (env.identityId) {
    identityNote = `users/${env.identityId}/ (identity-pool id supplied by the operator)`
  } else {
    const found = await identityPrefixes(env)
    if (found.length > 0) {
      throw new Error(
        `identity-pool prefixes exist (${found.join(", ")}) and no --identity-id was given. ` +
          "Which one is this user's cannot be derived from the sub; supply it.",
      )
    }
    identityNote = "no users/<identityId>/ prefix exists in the bucket for any user; nothing was ever written under entity('identity')"
  }
  const before = await inventory(env)
  const guard = await verifyArchiveGuard(env)
  log(`uid ${env.uid}, Cognito user ${username ?? "(absent — resume)"}`)
  log(`before: ${JSON.stringify(before)}`)
  log(`guard: ${JSON.stringify(guard)}`)
  if (env.isOwner) log("WARNING: --delete-owner given. This deletes the OWNER's map, ledger and archive.")

  // ── Typed confirmation. Nothing above wrote anything. ──────────────────
  const typed = (await env.ask(`Type the uid to delete ${env.uid} and everything it owns: `)).trim()
  if (typed !== env.uid) throw new ConfirmationMismatch()

  const startedAt = now().toISOString()
  guard.probe = await probeArchiveGuard(env)

  step("1 revoke upstream")
  const revoked = await env.revokeUpstream(env.uid)

  step("2 delete SourceAccount")
  const rows: Record<string, number> = {}
  rows.SourceAccount = await deleteItems(env, TABLE_SPECS.find((s) => s.label === "SourceAccount")!)

  step("3a disable Cognito user")
  if (username) await env.cli(["cognito-idp", "admin-disable-user", "--user-pool-id", env.userPoolId, "--username", username])
  step("3b global sign-out")
  if (username) {
    await env.cli(["cognito-idp", "admin-user-global-sign-out", "--user-pool-id", env.userPoolId, "--username", username])
  }

  step("4 delete DynamoDB rows")
  for (const spec of TABLE_SPECS) {
    if (spec.label === "SourceAccount") continue
    rows[spec.label] = await deleteItems(env, spec)
  }

  step("5a assume break-glass role")
  const assumed = (await env.cli([
    "sts",
    "assume-role",
    "--role-arn",
    env.breakGlassRoleArn,
    "--role-session-name",
    `account-deletion-${env.uid.slice(0, 8)}`,
    "--duration-seconds",
    "3600",
  ])) as { Credentials: { AccessKeyId: string; SecretAccessKey: string; SessionToken: string } }
  const breakGlass = env.makeS3(assumed.Credentials)
  const clientFor = (key: string) => (isRaw(key) ? breakGlass : env.s3)

  const prefixes = s3Prefixes(env.uid, env.identityId)
  const routed = async (objects: Array<{ Key: string; VersionId?: string }>) => {
    const raw = objects.filter((o) => isRaw(o.Key))
    const rest = objects.filter((o) => !isRaw(o.Key))
    if (raw.length) await deleteBatch(clientFor(raw[0]!.Key), env.bucket, raw)
    if (rest.length) await deleteBatch(clientFor(rest[0]!.Key), env.bucket, rest)
  }

  step("5b delete S3 objects")
  let s3Current = 0
  for (const prefix of prefixes) {
    const live = (await listVersions(env.s3, env.bucket, prefix)).filter((v) => v.latest && !v.marker)
    await routed(live.map((v) => ({ Key: v.Key })))
    s3Current += live.length
  }

  step("6a purge noncurrent versions and delete markers")
  let s3Versions = 0
  for (const prefix of prefixes) {
    const all = await listVersions(env.s3, env.bucket, prefix)
    await routed(all.map((v) => ({ Key: v.Key, VersionId: v.VersionId })))
    s3Versions += all.length
  }

  step("6b check multipart-abort lifecycle rule")
  const lifecycleRule = await multipartAbortRule(env)

  step("3c delete Cognito user")
  if (username) await env.cli(["cognito-idp", "admin-delete-user", "--user-pool-id", env.userPoolId, "--username", username])
  const stillThere = await cognitoUsername(env)

  step("7 logs age out under the 30-day retention")

  step("8 confirm in writing")
  const after = await inventory(env)
  const couldNotDelete: string[] = []
  for (const [table, n] of Object.entries(after.tables)) if (n > 0) couldNotDelete.push(`${table}: ${n} row(s)`)
  for (const p of after.prefixes) {
    const n = p.current + p.noncurrent + p.deleteMarkers
    if (n > 0) couldNotDelete.push(`s3://${env.bucket}/${p.prefix}: ${n} version(s)/marker(s)`)
  }
  if (stillThere) couldNotDelete.push(`Cognito user ${stillThere}`)
  if (!lifecycleRule) couldNotDelete.push("bucket has no multipart-abort lifecycle rule (infrastructure, not this user's data)")

  const pitr: DeletionResult["pitr"] = []
  for (const label of Object.keys(env.tables) as Array<keyof TableNames>) {
    pitr.push({ table: env.tables[label], ...(await env.pitr(env.tables[label])) })
  }

  return {
    uid: env.uid,
    startedAt,
    finishedAt: now().toISOString(),
    cognitoUsername: username,
    before,
    after,
    guard,
    revoked,
    deleted: { rows, s3Current, s3Versions },
    identityNote,
    lifecycleRule,
    pitr,
    couldNotDelete,
    steps,
  }
}

// ─── Step 8 ───────────────────────────────────────────────────────────────────

/** The written confirmation. Says the true thing about PITR (§6.4 "Backups"). */
export function renderConfirmation(r: DeletionResult, bucket: string): string {
  const withPitr = r.pitr.filter((p) => p.enabled)
  const days = Math.max(0, ...withPitr.map((p) => p.days))
  const completeAt = new Date(Date.parse(r.finishedAt) + days * 86_400_000).toISOString()
  const tableRows = Object.keys(r.before.tables).map(
    (t) => `| ${t} | ${r.before.tables[t]} | ${r.after.tables[t]} |`,
  )
  const prefixRows = r.before.prefixes.map((b, i) => {
    const a = r.after.prefixes[i]!
    const fmt = (p: PrefixCount) =>
      `${p.current} / ${p.noncurrent} / ${p.deleteMarkers}` +
      (p.prefix.startsWith("raw/") ? ` (kind-override ${p.kindOverrides}, duplicate-of ${p.duplicateOf})` : "")
    return `| \`${b.prefix}\` | ${fmt(b)} | ${fmt(a)} |`
  })
  return [
    `# Account deletion — ${r.uid}`,
    "",
    `Run ${r.startedAt} → ${r.finishedAt}. Cognito user: ${r.cognitoUsername ?? "(already absent)"}.`,
    "",
    "## What was deleted",
    "",
    "| Table | Before | After |",
    "|---|---|---|",
    ...tableRows,
    "",
    `S3, bucket \`${bucket}\` — current / noncurrent / delete markers:`,
    "",
    "| Prefix | Before | After |",
    "|---|---|---|",
    ...prefixRows,
    "",
    `Identity prefix: ${r.identityNote}.`,
    "",
    `Upstream: ${r.revoked.length ? r.revoked.map((o) => `${o.source} ${o.outcome}`).join(", ") : "no connectable sources"}.`,
    "",
    `Archive guard: default principal ${r.guard.caller} → ${JSON.stringify(r.guard.callerDecisions)}; ` +
      `break-glass → ${JSON.stringify(r.guard.breakGlassDecisions)}; live probe: ${r.guard.probe ?? "not run"}.`,
    "",
    `Multipart-abort lifecycle rule: ${r.lifecycleRule ?? "MISSING"}.`,
    "",
    "## What could not be deleted",
    "",
    r.couldNotDelete.length ? r.couldNotDelete.map((c) => `- ${c}`).join("\n") : "Nothing.",
    "",
    "## Backups, and when this is actually complete",
    "",
    "There are no backups beyond S3 versioning — purged above, for every prefix — and DynamoDB " +
      "point-in-time recovery.",
    withPitr.length
      ? `**PITR holds deleted rows for up to ${days} days** on ${withPitr.map((p) => `\`${p.table}\``).join(", ")}, ` +
        `so **this deletion is complete at the end of that window, ${completeAt}**, not the moment the script ` +
        "exited. The same window is what would let a wrong-user deletion be undone."
      : "PITR is enabled on none of these tables, so the DynamoDB deletion was complete when the script exited.",
    `Tables without PITR (rows gone at once): ${r.pitr.filter((p) => !p.enabled).map((p) => `\`${p.table}\``).join(", ") || "none"}.`,
    "",
    "CloudWatch log lines that mention this user expire under the 30-day retention; they are not hand-scrubbed (§6.4 step 7).",
    "",
    `Steps, in order: ${r.steps.join(" → ")}.`,
    "",
  ].join("\n")
}
