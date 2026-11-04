import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * D-472 / D-473, STRUCTURALLY. Ticket `0334`.
 *
 * Cognito is gone, AppSync is IAM-only, and nothing can call it. This file synthesizes the WHOLE
 * backend once and reads every template in the assembly (the root and each nested stack), because
 * each of these could come back in a stack nobody thought to check:
 *
 *   - a Cognito user pool or identity pool (a reverted `defineAuth` makes a NEW pool with a new
 *     `sub`, D-473: there is no rollback to Cognito);
 *   - an AppSync auth mode other than `AWS_IAM`;
 *   - any IAM statement granting `appsync:GraphQL`. The auth transformer emits one for every IAM
 *     model rule, attached to the identity pool's role, which without `defineAuth` is named
 *     "undefined"; `backend.ts` removes it before synth;
 *   - AppSync's Lambda data source, and with it its `lambda:InvokeFunction` on `log-workout` and
 *     `set-activity-kind` (D-475). The SSR compute role is the only invoker.
 *
 * The deployed half is `scripts/check-auth-posture.mjs`, which reads the live account.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { App } = await import("aws-cdk-lib")
const { backend } = await import("./backend")

type Resource = { Type: string; Properties?: Record<string, unknown> }
type CfnTemplate = { Resources?: Record<string, Resource> }

/** One synth at module scope (0041's timeout), then every template the assembly wrote. */
const assembly = App.of(backend.stack)!.synth() as unknown as { directory: string }
const templates: Array<[string, CfnTemplate]> = readdirSync(assembly.directory)
  .filter((f) => f.endsWith(".template.json"))
  .map((f) => [f, JSON.parse(readFileSync(join(assembly.directory, f), "utf8")) as CfnTemplate])
const resources = templates.flatMap(([file, t]) => Object.entries(t.Resources ?? {}).map(([id, r]) => ({ file, id, ...r })))

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v])

/** Every IAM statement in the assembly: inline policies, managed policies, role policies. */
function statements(): Array<{ id: string; Action?: unknown; NotAction?: unknown }> {
  return resources.flatMap((r) => {
    const docs = [r.Properties?.PolicyDocument, ...list(r.Properties?.Policies).map((p) => (p as { PolicyDocument?: unknown }).PolicyDocument)]
    return docs.flatMap((d) => list((d as { Statement?: unknown } | undefined)?.Statement).map((s) => ({ id: r.id, ...(s as object) })))
  })
}

describe("0334: no Cognito, an IAM-only API, and no caller", () => {
  it("synthesized a real assembly (the data stack is in it)", () => {
    expect(templates.length).toBeGreaterThan(5)
    expect(resources.some((r) => r.Type === "AWS::AppSync::GraphQLApi")).toBe(true)
  })

  it("has no Cognito resource in any stack (D-473)", () => {
    expect(resources.filter((r) => r.Type.startsWith("AWS::Cognito::")).map((r) => `${r.file}:${r.id}`)).toEqual([])
  })

  it("the API's one auth mode is AWS_IAM, with no additional provider and no user pool", () => {
    const apis = resources.filter((r) => r.Type === "AWS::AppSync::GraphQLApi")
    expect(apis).toHaveLength(1)
    const p = apis[0]!.Properties!
    expect(p.AuthenticationType).toBe("AWS_IAM")
    expect(list(p.AdditionalAuthenticationProviders)).toEqual([])
    expect(p.UserPoolConfig).toBeUndefined()
    expect(p.OpenIDConnectConfig).toBeUndefined()
    expect(p.LambdaAuthorizerConfig).toBeUndefined()
  })

  it("no IAM statement anywhere grants appsync:GraphQL (or appsync:*)", () => {
    const granting = statements().filter((s) =>
      list(s.Action).some((a) => typeof a === "string" && /^appsync:(GraphQL|\*)$|^\*$/i.test(a)),
    )
    expect(granting.map((s) => s.id)).toEqual([])
  })

  it("no managed policy names a role that does not exist (the transformer's 'undefined')", () => {
    expect(JSON.stringify(templates)).not.toMatch(/"undefined"/)
  })

  it("AppSync has no Lambda data source, so it cannot invoke log-workout or set-activity-kind (D-475)", () => {
    const lambdaSources = resources.filter((r) => r.Type === "AWS::AppSync::DataSource" && r.Properties?.Type === "AWS_LAMBDA")
    expect(lambdaSources.map((r) => r.id)).toEqual([])
  })

  it("the storage stack grants no identity-pool principal anything (the access block is gone)", () => {
    expect(JSON.stringify(templates)).not.toMatch(/cognito-identity\.amazonaws\.com/)
  })
})
