import { defineBackend } from "@aws-amplify/backend"

import { auth } from "./auth/resource"
import { data } from "./data/resource"
import { storage } from "./storage/resource"

/**
 * All three resources are wired from the first deploy on purpose (ticket 0012).
 * Each is near-empty; what matters is that the stack deploys and that every later
 * capability extends these rather than introducing them.
 *
 * The CDK escape hatch (01-architecture.md §2) is used in exactly four places
 * later on — machine-only DynamoDB tables, the SQS queue and DLQ, the webhook
 * Function URL, and the scheduled token refresh. None of them are here yet.
 */
defineBackend({
  auth,
  data,
  storage,
})
