import { defineFunction, secret } from "@aws-amplify/backend"

/**
 * The one thing in this backend that proves `secret()` actually works
 * (ticket 0017, criterion 2).
 *
 * WHY THIS EXISTS AT ALL. `secret()` resolves only into a Lambda's environment
 * at deploy time — there is no other consumer shape. The real consumers
 * (`/api/strava/callback`, `process-activity`, `token-refresh`, `strava-webhook`)
 * arrive in capabilities 05 and 14. Establishing the secrets mechanism only when
 * the first of those lands means debugging SSM resolution, IAM, and an OAuth
 * exchange in the same session. This function decouples them: it is the exact
 * counterpart of the `DeploySmokeTest` placeholder model in ../../data/resource.ts,
 * and it exists for the same reason — prove the mechanism while it is the only
 * thing that can be wrong.
 *
 * DELETE THIS when `token-refresh` (ticket 0094) ships, since that function reads
 * the same secret in earnest. Deleting it is not a loss of coverage; the
 * bundle-leak check (scripts/check-bundle-leak.mjs) is the standing control, and
 * it does not depend on this function.
 *
 * COST: zero at rest. Manually invoked, never scheduled, never given a URL. A
 * Lambda that is not invoked bills nothing (01-architecture.md §8).
 *
 * The secret chosen is STRAVA_WEBHOOK_VERIFY_TOKEN rather than the client secret:
 * it is a value we generate ourselves, so proving the mechanism needs no Strava
 * app, and it is the least damaging of the four if the proof itself went wrong.
 */
export const secretSmokeTest = defineFunction({
  name: "secret-smoke-test",
  entry: "./handler.ts",
  timeoutSeconds: 10,
  memoryMB: 128,
  environment: {
    // THIS LINE IS THE WHOLE POINT. `secret('KEY')` is a deploy-time reference
    // to SSM at /amplify/<app-id>/<branch>-branch-<hash>/KEY (or the sandbox's
    // own path); Amplify resolves the right one per environment. The value never
    // appears in source, in CloudFormation output, or in a build artifact.
    STRAVA_WEBHOOK_VERIFY_TOKEN: secret("STRAVA_WEBHOOK_VERIFY_TOKEN"),
  },
})
