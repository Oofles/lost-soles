/**
 * THE VERIFY TOKEN, READ ONLY WHEN SOMETHING ASKS FOR IT. Ticket 0286, D-347's fallback.
 *
 * Until 0286 the token was Amplify's `secret()`, which Amplify resolves in the function's INIT,
 * on every cold start: two `ssm:GetParameters` round trips (branch path misses, shared path
 * hits). Measured on the deployed stack, Init rose from ~300 ms to ~680 ms and a cold known-owner
 * POST from 0.71–0.90 s to 1.27 s — on events that never read the token. Only the handshake GET
 * does, and it happens once, when the subscription is created.
 *
 * So this is a GETTER, handed to `accept()` as `AcceptContext.webhookSecret`, and the adapter calls
 * it on a GET only. Three things keep a POST cold start free of SSM, each asserted in
 * `webhook-secret.test.ts` and `ssm-reader.test.ts`:
 *
 *   1. The SSM request code (`./ssm-reader`, hand-signed, D-NEW-a) is a DYNAMIC import, evaluated on the
 *      first call, not at module load.
 *   2. The client is constructed on the first call, never at module scope, and is NOT in D-346's
 *      init warm-up — warming it would put the cost straight back where 0286 took it from.
 *   3. The parameter NAME comes from `WEBHOOK_SECRET_PARAMETER`, set in `backend.ts` beside the one
 *      grant that can read it, so the name and the IAM resource cannot drift apart. This file names
 *      no source: the handler stays vendor-blind.
 *
 * Cached as a PROMISE for the life of the execution environment (Strava may re-validate; a second
 * GET in the same sandbox pays nothing). A failure is NOT cached, and never throws: it resolves
 * `undefined`, which the adapter turns into a fail-closed 400 (`handshake-unconfigured`). The value
 * is never logged; on failure only the error's class is.
 */

/** The env key `backend.ts` sets to the parameter's full SSM name. A name, never a value. */
export const WEBHOOK_SECRET_PARAMETER_ENV = "WEBHOOK_SECRET_PARAMETER"

/** Reads one SecureString. Injected by tests; production is `ssmGetParameter`. */
export type ParameterReader = (name: string) => Promise<string | undefined>

let liveReader: Promise<ParameterReader> | undefined

/** The live reader. The SDK is imported and the client built on the first call, not before. */
export const ssmGetParameter: ParameterReader = async (name) => {
  liveReader ??= import("./ssm-reader").then((m) => m.createParameterReader())
  try {
    return await (await liveReader)(name)
  } catch (error) {
    // A failed import or construction must not stick for the life of the sandbox.
    liveReader = undefined
    throw error
  }
}

function logFailure(reason: string): void {
  console.warn(JSON.stringify({ msg: "webhook-secret-unavailable", reason }))
}

/**
 * A memoizing getter for the parameter `name`. `name` undefined (the env key is not set) fails
 * closed on every call.
 */
export function lazyWebhookSecret(
  name: string | undefined,
  read: ParameterReader = ssmGetParameter,
): () => Promise<string | undefined> {
  let cached: Promise<string> | undefined
  return async () => {
    if (!name) {
      logFailure("no-parameter-name")
      return undefined
    }
    cached ??= read(name).then((value) => {
      if (typeof value !== "string" || value.length === 0) throw new Error("empty")
      return value
    })
    try {
      return await cached
    } catch (error) {
      cached = undefined
      logFailure((error as Error)?.name ?? "Error")
      return undefined
    }
  }
}
