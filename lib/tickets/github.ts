import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm"

import { log } from "@/lib/log"

/**
 * The GitHub Contents API client, and the SSM fetch that feeds it. Ticket 0018.
 *
 * WHY SSM AND NOT AN ENVIRONMENT VARIABLE. Amplify renders environment variables in
 * plaintext into build artifacts, readable by anyone with `get-app` on the app
 * (`01-architecture.md` §7, and 0017 made it a standing rule). A PAT that acts as the
 * operator must never be one. It is read at cold start over the SSR compute role's
 * single-parameter IAM grant, and held in memory for the life of the execution
 * environment.
 *
 * WHY THIS FILE HAS NO UPDATE OR DELETE PATH. Ticket 0018, criterion 6: not disabled,
 * ABSENT. There is deliberately no function here that passes a `sha` to the Contents
 * API, because a `sha` turns create into overwrite, and an endpoint reachable from a
 * phone that can overwrite arbitrary repository files is a different thing entirely
 * from one that can only add. Absence is the control; a flag would be a bug away from
 * being flipped.
 */

const PARAMETER_NAME = "/amplify/shared/d14fhvl4rp79nn/GITHUB_TICKETS_PAT"
const REPO_OWNER = "Oofles"
const REPO_NAME = "lost-soles"
const BRANCH = "main"

/**
 * Cached for the life of the execution environment, per the ticket. Module scope, so
 * a warm invocation reuses it and only a cold start pays the SSM call.
 *
 * The cached value is a PROMISE, not a string: two concurrent cold requests would
 * otherwise each fire their own SSM call. Caching the promise makes the second await
 * the first.
 */
let cachedToken: Promise<string> | null = null

/** Exported for tests only — resets the module-level cache between cases. */
export function __resetTokenCache(): void {
  cachedToken = null
}

export function getToken(client: SSMClient = new SSMClient({})): Promise<string> {
  if (cachedToken) return cachedToken

  cachedToken = client
    .send(new GetParameterCommand({ Name: PARAMETER_NAME, WithDecryption: true }))
    .then((res) => {
      const value = res.Parameter?.Value
      if (!value) {
        // Fail closed and say which parameter, never what was in it.
        throw new Error(`${PARAMETER_NAME} is empty or absent`)
      }
      return value
    })
    .catch((err: unknown) => {
      // Do not cache a failure: a transient SSM error would otherwise poison this
      // execution environment for its entire life.
      cachedToken = null
      throw err
    })

  return cachedToken
}

export interface CommitResult {
  path: string
  commitSha: string
}

/**
 * Create ONE file. Never updates: no `sha` is sent, so GitHub returns 422 if the path
 * already exists rather than silently overwriting. 0019 adds the collision retry.
 */
export async function createFile(
  args: { path: string; content: string; message: string; token: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CommitResult> {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${args.path}`

  const res = await fetchImpl(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${args.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: args.message,
      content: Buffer.from(args.content, "utf8").toString("base64"),
      branch: BRANCH,
      // NO `sha` KEY. See the file header. Adding one turns this into an overwrite.
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    // `log` redacts, but the token is not in this string anyway — the URL and body
    // are. Logged at error because a failed capture is silent data loss otherwise:
    // the note was dictated at mile six and there is no second copy.
    log.error("github contents create failed", { status: res.status, path: args.path, detail })
    throw new Error(`GitHub Contents API returned ${res.status}`)
  }

  const json = (await res.json()) as { commit?: { sha?: string }; content?: { path?: string } }
  return {
    path: json.content?.path ?? args.path,
    commitSha: json.commit?.sha ?? "",
  }
}
