import { defineBackend } from "@aws-amplify/backend"
import { RemovalPolicy } from "aws-cdk-lib"
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb"
import { Role } from "aws-cdk-lib/aws-iam"

import { auth } from "./auth/resource"
import { data } from "./data/resource"
import { secretSmokeTest } from "./functions/secret-smoke-test/resource"
import { storage } from "./storage/resource"

/**
 * All three resources are wired from the first deploy on purpose (ticket 0012).
 * Each is near-empty; what matters is that the stack deploys and that every later
 * capability extends these rather than introduces them.
 *
 * The CDK escape hatch (01-architecture.md §2) is used in exactly four places
 * later on — machine-only DynamoDB tables, the SQS queue and DLQ, the webhook
 * Function URL, and the scheduled token refresh. The first of those arrives at
 * the bottom of this file in ticket 0019.
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  // Ticket 0017. Proves secret() resolves end to end; deleted when token-refresh
  // (ticket 0094) reads the same secret in earnest. See its resource.ts.
  secretSmokeTest,
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO LINES THAT CARRY THE SECURITY POSTURE  (08-security-privacy.md §5.1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These are L1 CloudFormation properties because `defineAuth` exposes neither.
 * Ticket 0014's description writes them as `selfSignUpEnabled: false` and
 * `allowUnauthenticatedIdentities: false`; those are the INTENT, not the API.
 * The real API is below, and the names differ enough to be worth stating.
 *
 * Both were live-verified WRONG on the deployed pool before this ticket:
 * AllowAdminCreateUserOnly was `false` and AllowUnauthenticatedIdentities was
 * `true` from 0012's skeleton deploy onward. They were not theoretical holes.
 *
 * `scripts/check-auth-posture.mjs` asserts all of this against the DEPLOYED pool
 * on every Amplify build (amplify.yml), because a console click can flip any of
 * it back and a source-code read would never notice (§5.1, D-163).
 */
const { cfnUserPool, cfnUserPoolClient, cfnIdentityPool } =
  backend.auth.resources.cfnResources

/**
 * NO PUBLIC REGISTRATION ENDPOINT. The single most important line in the auth
 * config (§5.1). A default-on Cognito pool *is* a public signup endpoint: leave
 * this and anyone on the internet can mint an account, making the threat model's
 * core premise — "the only accounts are ones the owner created" — false from the
 * day it deploys, and firing §2.4's Trigger A without anyone noticing it had.
 * Self-signup is not a convenience being declined; it is a hole not being drilled.
 */
cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
}

/**
 * Essentials tier: Managed Login and passwordless/passkey (WebAuthn) sign-in,
 * 10,000 MAU free and — confirmed — non-expiring, so auth costs $0.00 forever at
 * this scale (D-083). Pinned explicitly rather than relied on as a default: a
 * silent tier change is a silent bill.
 */
cfnUserPool.userPoolTier = "ESSENTIALS"

/**
 * NO ANONYMOUS IDENTITY, EVER. The identity pool vends no guest credentials.
 * Combined with the `entity('identity')` S3 scoping in ./storage/resource.ts
 * (§6.2), there is then no unauthenticated principal in the account that can
 * touch storage at all.
 */
cfnIdentityPool.allowUnauthenticatedIdentities = false

/**
 * Session handling, §5.3. Token storage stays Amplify's default (localStorage) —
 * that is an accepted, reasoned decision there, not an oversight: an XSS in this
 * app could equally just read the map, which is the asset, so cookie storage buys
 * complexity and no defence.
 *
 * Revocation is enabled so `globalSignOut` actually invalidates outstanding
 * refresh tokens. §5.3 is pointed that "untested revocation is not revocation".
 */
cfnUserPoolClient.enableTokenRevocation = true

/** 1 hour, the default, not extended (§5.3). Units must be set or CFN assumes days. */
cfnUserPoolClient.accessTokenValidity = 60
cfnUserPoolClient.idTokenValidity = 60
/**
 * ONE YEAR, raised from 30 days in ticket 0151. Sliding.
 *
 * The original 30 days was reasoned for a BROWSER — "long enough a phone stays
 * signed in between runs, short enough a stolen device goes stale on its own".
 * D-183 changed what this number governs. The Android capture task (0020) holds a
 * refresh token and exchanges it for a 1-hour ID token per capture, so at 30 days
 * the quick-settings tile stops working every month — and it stops SILENTLY. The
 * tile still exists, still listens, still takes the dictation; the note is simply
 * never committed. That is the exact failure capability 03 is built to prevent: a
 * thought captured once, with no second copy.
 *
 * The short-lived half of the pair is unchanged and is where the protection
 * actually lives: the ID token above is still 60 minutes, so a token intercepted
 * in transit is worthless within the hour. Lengthening BOTH would be a different
 * and much worse change.
 *
 * What makes a year defensible rather than lazy is that revocation is real and
 * immediate: `enableTokenRevocation` above is true, so a lost phone is one
 * `AdminUserGlobalSignOut` away from being cut off, and §5.3's "untested
 * revocation is not revocation" is why that line is not decorative.
 *
 * Cognito's ceiling is 10 years. A year was chosen over the maximum because
 * re-pairing the phone annually is a cheap forcing function that proves the
 * recovery path still works before it is needed in anger.
 */
cfnUserPoolClient.refreshTokenValidity = 525600
cfnUserPoolClient.tokenValidityUnits = {
  accessToken: "minutes",
  idToken: "minutes",
  refreshToken: "minutes",
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CAPTURE GUARD TABLE  (ticket 0019, 07-ticketsmith.md §6.4/5 and §6.4/9)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Rate-limit counters and idempotency records for /api/tickets/capture. The first
 * machine-only table, through the CDK escape hatch as 01-architecture.md §2 says
 * they arrive — it is written and read by the SSR compute alone and has no business
 * in AppSync, where every model is a thing the client is allowed to ask about.
 *
 * WHY IT CANNOT LIVE IN MODULE MEMORY: a Lambda scales out, so an in-memory counter
 * is per-container and "30 per hour" quietly becomes "30 per hour per warm
 * container" under exactly the burst it exists to stop. The reasoning is in full in
 * lib/tickets/capture-store.ts.
 */
const guardStack = backend.createStack("CaptureGuard")

const captureGuardTable = new Table(guardStack, "CaptureGuardTable", {
  /**
   * NAMED EXPLICITLY, and that is a trade-off worth stating rather than hiding.
   *
   * The reader is a Next.js route handler on Amplify's SSR compute, which is not a
   * `defineFunction` Lambda and therefore has no CloudFormation output, no env var
   * and no way to be handed a generated name — the same structural gap that made
   * 0018's PAT come from SSM rather than `secret()`. A literal both sides can state
   * is the only thing available, so `lib/tickets/capture-store.ts` states the same
   * one and a test asserts the two agree.
   *
   * THE COST: an explicit name is account-and-region unique, so a `ampx sandbox`
   * deploy cannot coexist with the `main` branch's stack. Acceptable at one branch
   * and one operator, and recorded in the capability doc so the next person to run
   * a sandbox is not surprised by a CREATE_FAILED with an unhelpful message.
   */
  tableName: "LostSolesCaptureGuard",
  partitionKey: { name: "pk", type: AttributeType.STRING },
  /**
   * On demand. This table takes a handful of writes per capture and nothing at all
   * between runs; provisioned capacity would bill for idle to save nothing (D-083).
   */
  billingMode: BillingMode.PAY_PER_REQUEST,
  /**
   * DynamoDB deletes expired items for free. Every item here is a counter for a
   * window that has closed or an idempotency record past its 24 hours, so without a
   * TTL this table grows forever to hold nothing anyone will read.
   */
  timeToLiveAttribute: "ttl",
  /**
   * DESTROY, unusually for a table. Everything in it is disposable guard state with
   * a TTL measured in hours — losing it costs one hour of rate-limit history, not
   * data. RETAIN would leave an orphan holding the explicit name above and block the
   * next deploy, which is a worse failure than the one it guards against.
   */
  removalPolicy: RemovalPolicy.DESTROY,
})

/**
 * The grant. `LostSolesAmplifyComputeRole` was created BY HAND in ticket 0018 —
 * Amplify's `computeRoleArn` was null, so SSR was running under an AWS-managed role
 * that cannot be given policies, and there was nothing to attach anything to. See
 * docs/capabilities/03-ticket-capture-endpoint.md for that history, including why
 * the usual `aws:SourceArn` confused-deputy condition is not available on it.
 *
 * `mutable: true` is what lets CDK attach a policy to a role it does not own. The
 * import is by ARN because the role is not in any stack here and never will be.
 *
 * `grantReadWriteData` on ONE table — not on the account's DynamoDB, not with a
 * wildcard. The role's total reach after this is: read one SSM parameter, read and
 * write one guard table. That narrowness IS the containment, since the trust-policy
 * condition that would normally provide it was refused by Amplify.
 */
const computeRole = Role.fromRoleArn(
  guardStack,
  "AmplifyComputeRole",
  "arn:aws:iam::286588821906:role/LostSolesAmplifyComputeRole",
  { mutable: true },
)

captureGuardTable.grantReadWriteData(computeRole)
