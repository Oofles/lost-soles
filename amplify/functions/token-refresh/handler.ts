import { sweepExpiringTokens, type SweepResult } from "@/lib/sources/token-refresh-sweep"

/**
 * The scheduled entry point. Ticket 0094. All of the behaviour is in
 * `lib/sources/token-refresh-sweep.ts`, where it is tested without a Lambda.
 *
 * Returns the counts, which carry no credential, so a manual invocation from the console
 * or the CLI shows what the run did. Throws only if the candidate scan fails; a failure
 * on one connection is classified and counted, never thrown — a thrown handler would let
 * EventBridge's async retries re-run a transient failure minutes later, when the design
 * is that the next run, four hours on, is the retry.
 */
export const handler = async (): Promise<SweepResult> => sweepExpiringTokens()
