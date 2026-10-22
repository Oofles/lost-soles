import { describe, expect, it, vi } from "vitest"

import {
  ConfirmationMismatch,
  OwnerRefused,
  inventory,
  principalArnOf,
  renderConfirmation,
  runAccountDeletion,
  type DeletionEnv,
  type TableNames,
} from "./deletion"
import { revokeAllSources } from "./revoke"

/**
 * Ticket `0106`. The whole run, against a FAKE versioned bucket that enforces the real bucket
 * policy's shape (`raw/*` deletes denied to everyone but the break-glass role, which can do nothing
 * else), fake DynamoDB tables and a fake `aws` CLI. Two users live in the world; only one is
 * deleted, and the other is checked untouched.
 *
 * The live half of "the default role cannot delete under raw/*" is not here — it is the run's own
 * preflight (`verifyArchiveGuard`, IAM simulation against the deployed policy, and
 * `probeArchiveGuard`, S3's own answer), recorded in the written confirmation.
 */

const UID = "11111111-2222-4333-8444-555555555555"
const OWNER = "5488e4b8-d081-7014-748e-edd1937f8083"
const ACCOUNT = "123456789012"
const OPERATOR = `arn:aws:iam::${ACCOUNT}:user/cli-user`
const BREAK_GLASS = `arn:aws:iam::${ACCOUNT}:role/LostSolesArchiveDeletion`
const BUCKET = "test-bucket"

const TABLES: TableNames = {
  SourceAccount: "LostSolesSourceAccount",
  ExploredCell: "LostSolesExploredCell",
  IngestReceipt: "LostSolesIngestReceipt",
  OAuthState: "LostSolesOAuthState",
  Activity: "Activity-x-NONE",
  XpLedgerEntry: "XpLedgerEntry-x-NONE",
  SkillState: "SkillState-x-NONE",
  Landmark: "Landmark-x-NONE",
  Profile: "Profile-x-NONE",
}

type Item = Record<string, unknown>
/** Fake clients read command inputs loosely; the real SDK types are not the subject here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any
type Principal = "operator" | "break-glass"

/** Every observable action, in order. The ordering test reads this. */
type Event = string

function world(opts: { guardBroken?: boolean; probePermitted?: boolean; lifecycle?: boolean } = {}) {
  const events: Event[] = []
  let seq = 0
  const s3: Array<{ Key: string; VersionId: string; marker: boolean; seq: number }> = []
  const put = (Key: string) => s3.push({ Key, VersionId: `v${++seq}`, marker: false, seq })

  const rowsFor = (u: string): Record<string, Item[]> => ({
    [TABLES.SourceAccount]: [{ pk: `U#${u}`, sk: "SRC#strava", accessToken: "t" }],
    [TABLES.ExploredCell]: [
      { pk: `U#${u}#C#87abc`, sk: "8babc1" },
      { pk: `U#${u}#C#87abd`, sk: "8babd1" },
      { pk: `U#${u}#AGG#7`, sk: "87abc" },
    ],
    [TABLES.Activity]: [{ id: `act-${u}`, userId: u }],
    [TABLES.XpLedgerEntry]: [
      { id: `l1-${u}`, userId: u },
      { id: `l2-${u}`, userId: u },
    ],
    [TABLES.SkillState]: [{ userId: u, skillId: "wayfaring" }],
    [TABLES.Landmark]: [{ userId: u, skillLevel: "wayfaring#10" }],
    [TABLES.Profile]: [{ id: u }],
    [TABLES.IngestReceipt]: [{ ingestKey: `k-${u}`, userId: u }],
    [TABLES.OAuthState]: [],
  })
  const ddb: Record<string, Item[]> = {}
  for (const u of [UID, OWNER]) {
    for (const [t, items] of Object.entries(rowsFor(u))) (ddb[t] ??= []).push(...items)
  }
  for (const u of [UID, OWNER]) {
    put(`raw/${u}/strava/100/aaa.json`)
    put(`raw/${u}/strava/100/aaa.json`) // a second version: the first is now noncurrent
    put(`raw/${u}/strava/100.kind-override/1.json`)
    put(`raw/${u}/strava/200.duplicate-of.json`)
    put(`users/${u}/explored/explored-r11.1.bin`)
    put(`users/${u}/manifest.json`)
    put(`snapshots/skillstate/${u}/1.json`)
  }
  // A U-prefixed key that is NOT the user's: `users/<uid>x/` must survive a `users/<uid>/` delete.
  put(`users/${UID}x/manifest.json`)

  const latestSeq = (key: string) => Math.max(...s3.filter((v) => v.Key === key).map((v) => v.seq))
  const denied = (principal: Principal, key: string) =>
    key.startsWith("raw/") ? principal !== "break-glass" && !(opts.probePermitted && key.includes("probe")) : principal === "break-glass"

  const deleteOne = (principal: Principal, Key: string, VersionId?: string): string | null => {
    if (denied(principal, Key)) return "AccessDenied"
    events.push(`s3:${VersionId ? "deleteVersion" : "delete"}:${principal}:${Key}`)
    if (VersionId) {
      const at = s3.findIndex((v) => v.Key === Key && v.VersionId === VersionId)
      if (at >= 0) s3.splice(at, 1)
    } else if (s3.some((v) => v.Key === Key)) {
      s3.push({ Key, VersionId: `m${++seq}`, marker: true, seq })
    }
    return null
  }

  const s3Client = (principal: Principal) => ({
    send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, Loose> }) => {
      const { input } = command
      switch (command.constructor.name) {
        case "ListObjectVersionsCommand": {
          if (principal === "break-glass") throw Object.assign(new Error("denied"), { name: "AccessDenied" })
          const hit = s3.filter((v) => v.Key.startsWith(input.Prefix))
          const shape = (v: (typeof s3)[number]) => ({ Key: v.Key, VersionId: v.VersionId, IsLatest: v.seq === latestSeq(v.Key) })
          return {
            Versions: hit.filter((v) => !v.marker).map(shape),
            DeleteMarkers: hit.filter((v) => v.marker).map(shape),
            IsTruncated: false,
          }
        }
        case "ListObjectsV2Command":
          return { CommonPrefixes: [] }
        case "GetBucketPolicyCommand":
          return { Policy: '{"Statement":[]}' }
        case "GetBucketLifecycleConfigurationCommand":
          if (opts.lifecycle === false) throw Object.assign(new Error("none"), { name: "NoSuchLifecycleConfiguration" })
          return { Rules: [{ ID: "AbortIncompleteMultipartUploads", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }] }
        case "DeleteObjectCommand": {
          const err = deleteOne(principal, input.Key, input.VersionId)
          if (err) throw Object.assign(new Error(err), { name: err })
          return {}
        }
        case "DeleteObjectsCommand": {
          const Errors = []
          for (const o of input.Delete.Objects) {
            const err = deleteOne(principal, o.Key, o.VersionId)
            if (err) Errors.push({ Key: o.Key, Code: err })
          }
          return { Errors }
        }
      }
      throw new Error(`fake S3: unexpected ${command.constructor.name}`)
    }),
  })

  const matches = (item: Item, input: Record<string, Loose>, expr: string) => {
    const attr = input.ExpressionAttributeNames["#k"]
    const v = input.ExpressionAttributeValues[":v"]
    return expr.startsWith("begins_with") ? String(item[attr]).startsWith(v) : item[attr] === v
  }
  const ddbClient = {
    send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, Loose> }) => {
      const { input } = command
      const rows = ddb[input.TableName] ?? []
      switch (command.constructor.name) {
        case "GetCommand":
          return { Item: rows.find((r) => Object.entries(input.Key).every(([k, v]) => r[k] === v)) }
        case "QueryCommand":
          return { Items: rows.filter((r) => matches(r, input, input.KeyConditionExpression)) }
        case "ScanCommand":
          return { Items: rows.filter((r) => matches(r, input, input.FilterExpression)) }
        case "BatchWriteCommand": {
          for (const [table, requests] of Object.entries(input.RequestItems as Record<string, Array<{ DeleteRequest: { Key: Item } }>>)) {
            events.push(`ddb:delete:${table}`)
            for (const { DeleteRequest } of requests) {
              const at = ddb[table]!.findIndex((r) => Object.entries(DeleteRequest.Key).every(([k, v]) => r[k] === v))
              if (at >= 0) ddb[table]!.splice(at, 1)
            }
          }
          return { UnprocessedItems: {} }
        }
      }
      throw new Error(`fake DynamoDB: unexpected ${command.constructor.name}`)
    }),
  }

  const cognito = new Set([UID, OWNER])
  const cli = vi.fn(async (args: string[]): Promise<unknown> => {
    const op = `${args[0]} ${args[1]}`
    const arg = (name: string) => args[args.indexOf(name) + 1]!
    switch (op) {
      case "sts get-caller-identity":
        return { Arn: OPERATOR, Account: ACCOUNT }
      case "iam simulate-principal-policy": {
        const principal = arg("--policy-source-arn")
        const decision = principal === BREAK_GLASS || opts.guardBroken ? "allowed" : "explicitDeny"
        return {
          EvaluationResults: ["s3:DeleteObject", "s3:DeleteObjectVersion"].map((a) => ({ EvalActionName: a, EvalDecision: decision })),
        }
      }
      case "cognito-idp list-users": {
        const sub = /sub = "(.+)"/.exec(arg("--filter"))![1]!
        return { Users: cognito.has(sub) ? [{ Username: sub }] : [] }
      }
      case "cognito-idp admin-disable-user":
      case "cognito-idp admin-user-global-sign-out":
        events.push(`cognito:${args[1]}:${arg("--username")}`)
        return null
      case "cognito-idp admin-delete-user":
        events.push(`cognito:${args[1]}:${arg("--username")}`)
        cognito.delete(arg("--username"))
        return null
      case "sts assume-role":
        events.push(`sts:assume-role:${arg("--role-arn")}`)
        return { Credentials: { AccessKeyId: "AK", SecretAccessKey: "SK", SessionToken: "ST" } }
    }
    throw new Error(`fake CLI: unexpected ${op}`)
  })

  const operatorS3 = s3Client("operator")
  const breakGlassS3 = s3Client("break-glass")
  const env = (answer: string): DeletionEnv => ({
    uid: UID,
    bucket: BUCKET,
    userPoolId: "us-east-1_test",
    breakGlassRoleArn: BREAK_GLASS,
    tables: TABLES,
    s3: operatorS3,
    ddb: ddbClient,
    cli,
    makeS3: () => breakGlassS3,
    revokeUpstream: async () => {
      events.push("revoke")
      return [{ source: "strava", outcome: "revoked" }]
    },
    pitr: async (table) => ({ enabled: table === TABLES.ExploredCell, days: 35 }),
    ask: async () => answer,
    now: () => new Date("2026-10-20T12:00:00Z"),
    probeId: () => "p1",
  })
  return { events, env, s3, ddb, cognito, operatorS3, breakGlassS3 }
}

const ownerSnapshot = (w: ReturnType<typeof world>) => ({
  rows: Object.fromEntries(Object.entries(w.ddb).map(([t, rows]) => [t, rows.filter((r) => JSON.stringify(r).includes(OWNER)).length])),
  s3: w.s3.filter((v) => v.Key.includes(OWNER)).length,
})

describe("typed confirmation (I-30)", () => {
  it("a non-matching answer aborts with zero side effects", async () => {
    const w = world()
    await expect(runAccountDeletion(w.env(UID.slice(0, -1)))).rejects.toBeInstanceOf(ConfirmationMismatch)
    expect(w.events).toEqual([])
    expect(w.cognito.has(UID)).toBe(true)
  })

  it("an empty answer aborts too", async () => {
    const w = world()
    await expect(runAccountDeletion(w.env(""))).rejects.toBeInstanceOf(ConfirmationMismatch)
    expect(w.events).toEqual([])
  })
})

describe("the owner gate", () => {
  it("refuses the owner without --delete-owner: zero side effects, no AWS call, no prompt", async () => {
    const w = world()
    const env = { ...w.env(UID), isOwner: true }
    const ask = vi.spyOn(env, "ask")
    await expect(runAccountDeletion(env)).rejects.toBeInstanceOf(OwnerRefused)
    expect(ask).not.toHaveBeenCalled()
    expect(env.cli).not.toHaveBeenCalled()
    expect(w.operatorS3.send).not.toHaveBeenCalled()
    expect(w.events).toEqual([])
  })

  it("with --delete-owner it proceeds to the typed confirmation, which still applies", async () => {
    const w = world()
    const env = { ...w.env("not-the-uid"), isOwner: true, deleteOwner: true }
    const ask = vi.spyOn(env, "ask")
    await expect(runAccountDeletion(env)).rejects.toBeInstanceOf(ConfirmationMismatch)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(w.events).toEqual([])
  })
})

describe("the run, in the documented order", () => {
  it("revokes before any delete, disables before any data delete, and deletes the Cognito user last", async () => {
    const w = world()
    const result = await runAccountDeletion(w.env(UID))
    const e = w.events
    const first = (p: string) => e.findIndex((x) => x.startsWith(p))
    const last = (p: string) => e.map((x) => x.startsWith(p)).lastIndexOf(true)

    expect(first("revoke")).toBe(0)
    expect(first(`ddb:delete:${TABLES.SourceAccount}`)).toBe(1)
    expect(first("cognito:admin-disable-user")).toBe(2)
    expect(first("cognito:admin-user-global-sign-out")).toBe(3)
    // Every other table after sign-out, and before the S3 work.
    const otherDdb = e.findIndex((x) => x.startsWith("ddb:delete:") && !x.includes(TABLES.SourceAccount))
    expect(otherDdb).toBeGreaterThan(3)
    expect(first("sts:assume-role")).toBeGreaterThan(last("ddb:delete:"))
    expect(first("s3:")).toBeGreaterThan(first("sts:assume-role"))
    // Step 5 (markers) before step 6 (versions).
    expect(last("s3:delete:")).toBeLessThan(first("s3:deleteVersion:"))
    expect(first("cognito:admin-delete-user")).toBeGreaterThan(last("s3:"))
    expect(first("cognito:admin-delete-user")).toBe(e.length - 1)

    expect(result.steps).toEqual([
      "1 revoke upstream",
      "2 delete SourceAccount",
      "3a disable Cognito user",
      "3b global sign-out",
      "4 delete DynamoDB rows",
      "5a assume break-glass role",
      "5b delete S3 objects",
      "6a purge noncurrent versions and delete markers",
      "6b check multipart-abort lifecycle rule",
      "3c delete Cognito user",
      "7 logs age out under the 30-day retention",
      "8 confirm in writing",
    ])
  })

  it("deletes every row, object, version and delete marker the user had, and nothing of anyone else's", async () => {
    const w = world()
    const owner = ownerSnapshot(w)
    const result = await runAccountDeletion(w.env(UID))

    expect(result.couldNotDelete).toEqual([])
    expect(Object.values(result.after.tables).every((n) => n === 0)).toBe(true)
    for (const p of result.after.prefixes) expect(p.current + p.noncurrent + p.deleteMarkers).toBe(0)
    // Zero versions AND zero delete markers left under raw/<uid>/ — the criterion's check.
    expect(w.s3.filter((v) => v.Key.startsWith(`raw/${UID}/`))).toEqual([])
    expect(w.cognito.has(UID)).toBe(false)

    expect(ownerSnapshot(w)).toEqual(owner)
    expect(w.cognito.has(OWNER)).toBe(true)
    expect(w.s3.some((v) => v.Key === `users/${UID}x/manifest.json`)).toBe(true)
  })

  it("counts before and after, including D-284 kind overrides and duplicate-of markers", async () => {
    const w = world()
    const result = await runAccountDeletion(w.env(UID))
    const raw = result.before.prefixes.find((p) => p.prefix === `raw/${UID}/`)!
    expect(raw).toMatchObject({ current: 3, noncurrent: 1, deleteMarkers: 0, kindOverrides: 1, duplicateOf: 1 })
    expect(result.before.tables).toMatchObject({ ExploredCell: 3, Activity: 1, XpLedgerEntry: 2, Profile: 1 })
    expect(result.deleted.rows).toMatchObject({ SourceAccount: 1, ExploredCell: 3, IngestReceipt: 1 })
  })
})

describe("step 5 and the break-glass role", () => {
  it("every raw/ deletion goes through the assumed role; the operator's client never deletes under raw/", async () => {
    const w = world()
    await runAccountDeletion(w.env(UID))
    const rawDeletes = w.events.filter((e) => e.startsWith("s3:") && e.includes(":raw/"))
    expect(rawDeletes.length).toBeGreaterThan(0)
    for (const e of rawDeletes) expect(e).toContain(":break-glass:")
    // ...and the role touched nothing outside raw/.
    for (const e of w.events.filter((x) => x.includes(":break-glass:"))) expect(e).toMatch(/:raw\//)
  })

  it("the operator's default credentials are refused under raw/ — the fake enforces the bucket policy", async () => {
    const w = world()
    const res = await w.operatorS3.send(
      new (await import("@aws-sdk/client-s3")).DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: [{ Key: `raw/${UID}/strava/100/aaa.json` }] },
      }),
    )
    expect(res.Errors![0]!.Code).toBe("AccessDenied")
  })

  it("refuses to start if the live bucket policy does not deny the operator — before the prompt, zero writes", async () => {
    const w = world({ guardBroken: true })
    const env = w.env(UID)
    const ask = vi.spyOn(env, "ask")
    await expect(runAccountDeletion(env)).rejects.toThrow(/does NOT deny s3:DeleteObject/)
    expect(ask).not.toHaveBeenCalled()
    expect(w.events).toEqual([])
  })

  it("refuses to proceed if S3 itself lets the operator delete under raw/ — zero writes", async () => {
    const w = world({ probePermitted: true })
    await expect(runAccountDeletion(w.env(UID))).rejects.toThrow(/PERMITTED/)
    expect(w.events.filter((e) => !e.includes("deletion-guard-probe"))).toEqual([])
  })

  it("maps an assumed-role session to its role ARN for the simulation", () => {
    expect(principalArnOf(`arn:aws:sts::${ACCOUNT}:assumed-role/Admin/me`)).toBe(`arn:aws:iam::${ACCOUNT}:role/Admin`)
    expect(principalArnOf(OPERATOR)).toBe(OPERATOR)
  })
})

describe("step 8, the written confirmation", () => {
  it("says PITR holds rows for up to 35 days and that the deletion completes at the end of that window", async () => {
    const w = world()
    const text = renderConfirmation(await runAccountDeletion(w.env(UID)), BUCKET)
    expect(text).toContain("PITR holds deleted rows for up to 35 days")
    expect(text).toContain("this deletion is complete at the end of that window, 2026-11-24T12:00:00.000Z")
    expect(text).toMatch(/## What could not be deleted\n\nNothing\./)
    expect(text).toContain("strava revoked")
    expect(text).toContain("AbortIncompleteMultipartUploads")
  })

  it("names a missing multipart-abort rule rather than claiming a clean run", async () => {
    const w = world({ lifecycle: false })
    const result = await runAccountDeletion(w.env(UID))
    expect(result.couldNotDelete.join()).toMatch(/multipart-abort/)
  })
})

describe("inventory", () => {
  it("is read-only", async () => {
    const w = world()
    await inventory(w.env(UID))
    expect(w.events).toEqual([])
  })
})

describe("step 1 with no connection (D-348)", () => {
  it("is a recorded no-op, not a failure, and calls no provider", async () => {
    const revoke = vi.fn()
    const out = await revokeAllSources(UID, {
      sources: () => ["strava"],
      readToken: async () => null,
      connector: () => ({ revoke }),
      credentials: async () => ({ clientId: "1", clientSecret: "x" }),
    })
    expect(out).toEqual([{ source: "strava", outcome: "no-connection" }])
    expect(revoke).not.toHaveBeenCalled()
  })

  it("revokes a live token through the connector, and a failure propagates (the run aborts before step 2)", async () => {
    const revoke = vi.fn(async () => {})
    const deps = {
      sources: () => ["strava"],
      readToken: async () => "tok",
      connector: () => ({ revoke }),
      credentials: async () => ({ clientId: "1", clientSecret: "x" }),
    }
    expect(await revokeAllSources(UID, deps)).toEqual([{ source: "strava", outcome: "revoked" }])
    expect(revoke).toHaveBeenCalledWith({ accessToken: "tok", credentials: { clientId: "1", clientSecret: "x" } })
    revoke.mockRejectedValueOnce(new Error("500"))
    await expect(revokeAllSources(UID, deps)).rejects.toThrow("500")
  })
})
