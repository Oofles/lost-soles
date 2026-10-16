import { defineFunction } from "@aws-amplify/backend"

/**
 * `token-refresh`. Ticket 0094, `01-architecture.md` §2 resource #14 (and #16, its rule).
 *
 * `schedule` IS AMPLIFY'S OWN PRIMITIVE, not the CDK escape hatch. `defineFunction`
 * creates the EventBridge rule itself, which is exactly what §2's resource table says
 * ("`defineFunction`, `schedule: 'every 4h'`"). `amplify/backend.ts` counted this
 * function among its escape-hatch uses before it existed; that count is corrected there.
 * Its IAM grants are CDK, like every other function's here — a grant is not an escape
 * hatch, it is the only way Amplify lets a function reach a CDK-created table.
 *
 * EVERY 4 HOURS against a six-hour token: two chances before any token can expire. Keep
 * this in step with `SWEEP_INTERVAL_SECONDS` in `lib/sources/token-refresh-sweep.ts`,
 * which sizes the "due" window to the gap between runs; the synth test checks both.
 *
 * **No VPC** (D-081). It needs outbound HTTPS to the provider and nothing else; a VPC
 * would force a NAT Gateway at ten times the whole budget. There is no `vpc` property
 * and the synth test asserts its absence.
 *
 * **No `secret()` and no environment.** The table name is a literal both sides state
 * (`SOURCE_ACCOUNT_TABLE`), the per-user tokens are in that table, and the client
 * credentials are read from SSM at first use by `lib/sources/oauth-credentials.ts` —
 * never placed in this function's environment, where Amplify would render them in
 * plaintext (D-166).
 *
 * 60 s and 256 MB: at most 24 connections (T7), one exchange each, run serially.
 */
export const tokenRefresh = defineFunction({
  name: "token-refresh",
  entry: "./handler.ts",
  schedule: "every 4h",
  timeoutSeconds: 60,
  memoryMB: 256,
})
