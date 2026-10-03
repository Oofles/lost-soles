import { defineFunction } from "@aws-amplify/backend"

/**
 * THE `logWorkout` MUTATION'S LAMBDA. Ticket 0069, `02-data-model.md` §2.11.
 *
 * **`resourceGroupName: "data"`** because it is an AppSync resolver AND it writes the data
 * tables: in its own stack, the resolver would reference the function and the function's
 * grants would reference the tables, and CloudFormation refuses the cycle.
 *
 * **1024 MB / 30 s.** One synchronous pipeline run with no trace — no H3, no blob merge —
 * behind a user who is waiting on it. AppSync gives a resolver 30 s, so a longer timeout
 * would buy nothing but a Lambda still running after its caller gave up.
 *
 * **No VPC** (D-081), as for every function here.
 */
export const logWorkoutFunction = defineFunction({
  name: "log-workout",
  entry: "./handler.ts",
  resourceGroupName: "data",
  timeoutSeconds: 30,
  memoryMB: 1024,
})
