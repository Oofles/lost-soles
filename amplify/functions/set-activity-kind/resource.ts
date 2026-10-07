import { defineFunction } from "@aws-amplify/backend"

/**
 * THE `setActivityKind` MUTATION'S LAMBDA. Ticket `0244`, D-284, D-285.
 *
 * **`resourceGroupName: "data"`** for `logWorkout`'s reason: it is an AppSync resolver that
 * writes the data tables, and in its own stack the resolver → function → table references
 * would form a cycle CloudFormation refuses.
 *
 * **1024 MB / 30 s.** One activity's re-score, plus — only when the new kind opens ground the
 * old did not — one trace's cells and one blob regeneration. Behind a user who is waiting on
 * it, and AppSync gives a resolver 30 s, so a longer timeout would buy nothing.
 *
 * **No VPC** (D-081).
 */
export const setActivityKindFunction = defineFunction({
  name: "set-activity-kind",
  entry: "./handler.ts",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  memoryMB: 1024,
})
