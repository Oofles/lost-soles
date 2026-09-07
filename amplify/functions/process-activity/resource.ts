import { defineFunction } from "@aws-amplify/backend"

/**
 * THE WORKER. Ticket 0042, `01-architecture.md` §2 resource 13 and §4 step 6.
 *
 * ─── THE THREE NUMBERS, AND WHAT EACH ONE IS FOR ────────────────────────────
 *
 * **2048 MB** is not about memory. Lambda allocates CPU in proportion to memory, and
 * the expensive phase here is the densify + H3 pass capability 07 adds — a pure-JS loop
 * over every sample of a trace. Under-provisioning it would not fail, it would take four
 * times as long and cost the same GB-seconds, which is the trap: the bill is flat across
 * this range and the latency is not.
 *
 * **900 s** is Lambda's maximum and it is enormous headroom for one activity (§2, "the
 * 15-minute wall"). It is set high deliberately rather than tuned: `batchSize: 1` means
 * a timeout can only ever affect one message, and the queue's visibility timeout is
 * derived FROM this number — 16 minutes, so a still-running invocation never has its
 * message handed to a second one. Lower this and `amplify/backend.ts` has to move too.
 *
 * **No VPC** (D-081). Nothing here needs one: the provider's API is on the public
 * internet, and every AWS service it touches is reachable without one. A VPC-attached
 * Lambda that also needs the internet forces a NAT gateway at $33/month — ten times the
 * whole infrastructure budget (D-083). There is no `vpc` property below, and the synth
 * test asserts its absence rather than trusting that nobody adds one.
 *
 * ─── NO `secret()` HERE, AND THAT IS NOT AN OVERSIGHT ───────────────────────
 *
 * `secret-smoke-test/resource.ts` reads one because proving `secret()` resolves was its
 * whole purpose. This function needs no static secret: the per-user OAuth tokens live in
 * `LostSolesSourceAccount` (§7), reached with an IAM grant, and the client credentials
 * are only needed by the token EXCHANGE, which happens in `lib/sources/token-refresh.ts`
 * under the SSR compute's own grant. Adding `STRAVA_CLIENT_SECRET` here "for later"
 * would put a credential into a second Lambda's environment for no current reader.
 *
 * The environment this function DOES need — the storage bucket and the generated
 * `Activity` table name — is wired in `amplify/backend.ts`, because both are values only
 * the backend can resolve.
 */
export const processActivity = defineFunction({
  name: "process-activity",
  entry: "./handler.ts",
  timeoutSeconds: 900,
  memoryMB: 2048,
})
