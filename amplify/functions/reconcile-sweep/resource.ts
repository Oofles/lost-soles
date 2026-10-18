import { defineFunction } from "@aws-amplify/backend"

/**
 * `reconcile-sweep`. Ticket 0095, `03-integrations.md` §2.3, `01-architecture.md` §4.
 *
 * THE SIX-HOURLY SCHEDULE IS AMPLIFY'S OWN PRIMITIVE, as for `token-refresh`. It sends no
 * payload, which the handler reads as the six-hourly mode. The NIGHTLY schedule cannot be
 * declared here: every entry in `schedule` targets the function with the same empty input, so
 * the two would be indistinguishable to the handler. It is a CDK `Schedule` in
 * `amplify/backend.ts` carrying `{ "mode": "nightly" }`.
 *
 * Keep "every 6h" in step with `RECONCILE_INTERVAL_HOURS` in `lib/sources/reconcile-sweep.ts`;
 * the synth test checks both.
 *
 * **No VPC** (D-081). Outbound HTTPS to the provider, DynamoDB and SQS, nothing else.
 *
 * 60 s and 256 MB: one user, one or two list calls, and at ~115 activities in the account a
 * 14-day window is a handful of conditional writes. A connection that has never been swept
 * lists 30 days (`FIRST_SYNC_LOOKBACK_DAYS`), still one page.
 */
export const reconcileSweep = defineFunction({
  name: "reconcile-sweep",
  entry: "./handler.ts",
  schedule: "every 6h",
  timeoutSeconds: 60,
  memoryMB: 256,
})
