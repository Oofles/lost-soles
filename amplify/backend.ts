import { defineBackend } from "@aws-amplify/backend"
import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib"
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch"
import { Metric } from "aws-cdk-lib/aws-cloudwatch"
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions"
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler"
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets"
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb"
import {
  AccountRootPrincipal,
  AnyPrincipal,
  Effect,
  PolicyStatement,
  Role,
} from "aws-cdk-lib/aws-iam"
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  PriceClass,
  OriginRequestPolicy,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront"
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins"
import { Key } from "aws-cdk-lib/aws-kms"
import { FilterPattern, LogGroup, MetricFilter } from "aws-cdk-lib/aws-logs"
import { FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda"
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources"
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
} from "aws-cdk-lib/aws-s3"
import { Topic } from "aws-cdk-lib/aws-sns"
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions"
import { Queue } from "aws-cdk-lib/aws-sqs"

import { auth } from "./auth/resource"
import { data } from "./data/resource"
import { ingestWebhook } from "./functions/ingest-webhook/resource"
import { logWorkoutFunction } from "./functions/log-workout/resource"
import { setActivityKindFunction } from "./functions/set-activity-kind/resource"
import { processActivity } from "./functions/process-activity/resource"
import { reconcileSweep } from "./functions/reconcile-sweep/resource"
import { secretSmokeTest } from "./functions/secret-smoke-test/resource"
import { tokenRefresh } from "./functions/token-refresh/resource"
import { storage } from "./storage/resource"

/**
 * All three resources are wired from the first deploy on purpose (ticket 0012).
 * Each is near-empty; what matters is that the stack deploys and that every later
 * capability extends these rather than introduces them.
 *
 * The CDK escape hatch (01-architecture.md §2) is used in exactly four places
 * later on — machine-only DynamoDB tables, the SQS queue and DLQ, the webhook
 * Function URL, and the basemap tiles bucket and its CloudFront distribution.
 * The first of those arrives at the bottom of this file in ticket 0019.
 *
 * The count was FOUR, then FIVE after ticket 0052 — D-226 moved the pmtiles
 * basemap off Cloudflare R2 and into this account — and is FOUR again after
 * ticket 0094: the scheduled token refresh was listed here, but its EventBridge
 * rule is `defineFunction`'s own `schedule` (01 §2 resource #14 always said so),
 * not CDK. Updated here rather than left to drift, because "keep it to these N
 * uses" is only a constraint while N is true.
 *
 * Ticket 0091 adds the webhook Function URL, at the bottom of this file. It was
 * already one of the four, so the count stays FOUR — it was counted before it
 * existed, which is what the list is for.
 *
 * Ticket 0095 makes it FIVE: the reconcile sweep's NIGHTLY schedule, at the bottom of
 * this file. `defineFunction`'s `schedule` targets every entry with the same empty
 * input, so a second Amplify schedule could not tell the handler which window to use.
 */
/**
 * EXPORTED so `raw-archive-immutability.test.ts` can synthesize this stack and assert
 * the I-3 controls in CI (ticket 0039). Amplify only requires that this module call
 * `defineBackend`; exporting the result changes nothing about the deploy.
 */
export const backend = defineBackend({
  auth,
  data,
  storage,
  // Ticket 0017. Proves secret() resolves end to end; deleted when token-refresh
  // (ticket 0094) reads the same secret in earnest. See its resource.ts.
  secretSmokeTest,
  // Ticket 0042. The ingest worker. Its queue, DLQ, grants and environment are at the
  // bottom of this file — `defineFunction` has no queue primitive, which is the second
  // of the four escape-hatch uses 01-architecture.md §2 sanctions.
  processActivity,
  // Ticket 0069. The `logWorkout` resolver (`data/resource.ts`). Its grants are below the
  // worker's, and are a strict subset of them: no queue, no source credentials, no cells.
  logWorkoutFunction,
  // Ticket 0244. The `setActivityKind` resolver; its grants are below `logWorkout`'s.
  setActivityKindFunction,
  // Ticket 0094. The scheduled token sweep. Its schedule is Amplify-native
  // (`resource.ts`); its grants on T7 are below the worker's environment.
  tokenRefresh,
  // Ticket 0091. The public webhook. Its Function URL, two grants and output are at the
  // bottom of this file — the third of the four escape-hatch uses.
  ingestWebhook,
  // Ticket 0095. The listSince backstop. Six-hourly schedule Amplify-native; the nightly
  // schedule, grants and alarm at the bottom of this file.
  reconcileSweep,
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
 * Session handling, §5.3. Token storage is left at Amplify's default, and §5.3
 * reasons about that as localStorage — an accepted decision there rather than an
 * oversight, since an XSS in this app could equally just read the map, which is
 * the asset.
 *
 * IN PRACTICE IT IS COOKIES, NOT localStorage. `components/auth-gate.tsx` calls
 * `Amplify.configure(outputs, { ssr: true })`, and the Next.js adapter stores the
 * tokens in cookies so `middleware.ts` can read the session server-side. Noted
 * here because the sentence above sent ticket 0149's operator to an empty Local
 * Storage panel; the reasoning is unchanged, the storage medium is not what §5.3
 * says it is.
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

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SOURCE CONNECTION TABLES  (ticket 0032, 02-data-model.md T7)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two tables, and they are separate on purpose: one holds credentials for as long
 * as a connection lives, the other holds a ten-minute nonce. Nothing that can write
 * the second needs to be able to write the first.
 */
const sourcesStack = backend.createStack("SourceConnections")

/**
 * T7 `SourceAccount`. OAuth access and refresh tokens, one row per (user, source).
 *
 * NOT IN APPSYNC, AT ANY AUTH LEVEL, EVER (I-28, I-20, I-29). Not "protected by an
 * auth rule" — absent. No auth rule is as safe as no reachability, and a rule is one
 * careless edit from being widened. This is the reason 01-architecture.md §2 lists
 * machine-only tables as a CDK escape hatch rather than a `defineData` model.
 *
 * WHAT 0032 DOES NOT BUILD HERE, deliberately: the `byExternalOwner` GSI (KEYS_ONLY,
 * for the webhook's owner_id → userId lookup) and the customer-managed key. Both are
 * ticket 0033's, alongside the rotation handling they exist to serve. A GSI added
 * now, before anything queries it, is a projection decision made without its caller.
 */
/**
 * THE CUSTOMER-MANAGED KEY. Ticket 0033 criterion 3; T7's attribute table says
 * "encrypted at rest with a CMK".
 *
 * DynamoDB encrypts every table at rest already, with an AWS-owned key, and for most
 * tables that is the right answer — it is free, invisible, and nothing about it is
 * weaker cryptographically. So the reason to pay $1/month for a CMK here is not
 * secrecy. It is CONTROL SURFACE:
 *
 *   1. An AWS-owned key has no key policy anyone can read, no grants to audit, and no
 *      CloudTrail `Decrypt` events attributable to a caller. A CMK gives all three, so
 *      "who read the tokens, and when" becomes a question with an answer.
 *   2. It is revocable. Disabling this key makes every credential in T7 unreadable in
 *      one action, by anyone, without touching the table — which is the containment
 *      move if a compute role is ever suspected. Nothing equivalent exists for an
 *      AWS-owned key.
 *
 * RETAIN, and `pendingWindow` at the 30-day maximum. Deleting this key destroys every
 * token in T7 irrecoverably — the same class of loss as deleting the table, which the
 * removal policy below exists to prevent, so guarding one and not the other would be
 * theatre. Thirty days is the longest window AWS offers to notice and cancel.
 *
 * Rotation is on. It is annual and transparent: old material is retained so existing
 * items stay readable, which is why this is safe to enable on a table nothing rewrites.
 */
const sourceAccountKey = new Key(sourcesStack, "SourceAccountKey", {
  alias: "alias/lost-soles-source-account",
  description: "Encrypts the OAuth access and refresh tokens in T7 SourceAccount",
  enableKeyRotation: true,
  removalPolicy: RemovalPolicy.RETAIN,
  pendingWindow: Duration.days(30),
})

const sourceAccountTable = new Table(sourcesStack, "SourceAccountTable", {
  /**
   * NAMED EXPLICITLY, same trade-off `LostSolesCaptureGuard` records: the reader is a
   * Next.js route handler on Amplify's SSR compute, which is not a `defineFunction`
   * Lambda and has no CloudFormation output to be handed a generated name through.
   * `lib/sources/source-account-store.ts` states the identical literal and a test
   * asserts the two agree.
   *
   * THE COST IS SHARPER HERE THAN ON THE GUARD TABLE, because of the removal policy
   * below: an explicit name is account-and-region unique, and RETAIN means a torn-down
   * stack leaves the table behind still holding the name. Recreating the stack then
   * fails with a name collision until the orphan is adopted or deleted by hand.
   *
   * That is the correct trade. The alternative — DESTROY, so redeploys are frictionless
   * — makes a stack teardown silently delete the one thing in this system that cannot
   * be rebuilt (02-data-model.md §1.1, §8, I-2). Recorded in the capability doc so the
   * next person to hit the collision knows it is a guard rather than a defect.
   */
  tableName: "LostSolesSourceAccount",
  partitionKey: { name: "pk", type: AttributeType.STRING },
  sortKey: { name: "sk", type: AttributeType.STRING },
  /** ≤ 24 rows in five years (T7). Provisioned capacity would bill for idle (D-083). */
  billingMode: BillingMode.PAY_PER_REQUEST,
  /**
   * CUSTOMER-MANAGED, not the default AWS-owned key. See `sourceAccountKey` above for
   * why that is worth $1/month on a table holding twenty-four rows.
   *
   * `grantReadWriteData` below picks this up automatically and adds the matching
   * `kms:Decrypt` / `kms:GenerateDataKey` to the compute role. That is worth knowing
   * rather than discovering: without the KMS half, every read of this table fails with
   * an AccessDenied that names DynamoDB and not the key.
   */
  encryption: TableEncryption.CUSTOMER_MANAGED,
  encryptionKey: sourceAccountKey,
  /**
   * NO TTL. Every other machine-only table in this project expires its rows; this one
   * must not. A credential that vanishes on a schedule is a connection that dies
   * silently, and the row survives disconnection on purpose — tokens removed, history
   * kept, because disconnecting is not deleting an account (08 §6.5).
   */
  /**
   * RETAIN, and this is the table the policy exists for. T7 is the ONE thing the
   * rebuild drill does not restore (§8.3): tokens are not derivable from the archive
   * and must not be backed up, so recovery from losing this table is re-authorisation.
   * `02-data-model.md` §7 states T6/T7/T8 are RETAIN for exactly this reason.
   */
  removalPolicy: RemovalPolicy.RETAIN,
  /**
   * NO POINT-IN-TIME RECOVERY, and that is the opposite of the usual advice for a
   * table you would hate to lose. `02-data-model.md` §1.1 lists T7's tokens as "not
   * rebuildable, AND MUST NOT BE" — recovery is re-authorisation, by design. PITR is
   * a continuous second copy of live credentials, restorable by anyone who can restore
   * a table, and it would make the drill's §8.3 claim untrue. RETAIN above stops an
   * accidental teardown; a backup of secrets is a different and worse thing to own.
   */
})

/**
 * The OAuth `state` nonces. Ten-minute rows, issued when a connect starts and deleted
 * when the callback consumes one.
 *
 * A SEPARATE TABLE FROM T7, and the reasoning is `lib/sources/oauth-state-store.ts`'s:
 * every item shape added to the credential table is another reason for something to
 * hold a write grant where the tokens live. It is also not folded into
 * `LostSolesCaptureGuard`, whose own comment argues for one table with several item
 * shapes — correctly, for items on the SAME request path. These are not.
 */
const oauthStateTable = new Table(sourcesStack, "OAuthStateTable", {
  /** Explicit for the same reason; `lib/sources/oauth-state-store.ts` states the same literal. */
  tableName: "LostSolesOAuthState",
  partitionKey: { name: "pk", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  /**
   * DynamoDB deletes expired items for free. Note that its sweep is LAZY — up to 48
   * hours late — so the store checks its own `expiresAt` on consumption and this
   * attribute is housekeeping, not the control.
   */
  timeToLiveAttribute: "ttl",
  /**
   * DESTROY. Everything in it is a nonce with a ten-minute life; losing the table
   * costs the in-flight connect attempts and nothing else. RETAIN would leave an
   * orphan holding the explicit name and block the next deploy — a worse failure than
   * the one it would guard against.
   */
  removalPolicy: RemovalPolicy.DESTROY,
})

/**
 * GSI1 `byExternalOwner`. Ticket 0033 criterion 2, and the resolution of the conflict
 * `02-data-model.md` T7 records in full.
 *
 * `01-architecture.md` §2 says both "on POST an `owner_id` → `SourceAccount` lookup
 * that discards events for unknown athletes" AND "strava-webhook gets NO access to
 * sourceAccount". Both cannot hold. This index was the resolution: the webhook would be
 * granted `dynamodb:Query` on the INDEX alone, and the index carries KEYS_ONLY.
 *
 * AS BUILT (D-343, D-365): the webhook resolves owners through a static owner map and holds NO
 * grant here. Nothing queries this index; it is kept, still written, for a multi-user lookup.
 *
 * KEYS_ONLY IS THE WHOLE POINT AND IS NOT AN OPTIMISATION. A projection is not an
 * access rule — it is an absence. The token attributes are not stored in this index,
 * so a fully compromised webhook Lambda holding a valid `Query` grant on it reads a
 * userId and cannot read a credential, because there is no credential there to read.
 * `INCLUDE` or `ALL` would turn a structural guarantee back into an IAM policy that
 * one careless widening undoes.
 *
 * Only rows that carry `gsi1pk` appear here, which is `putConnectedAccount`'s job in
 * `lib/sources/source-account-store.ts`. A row written before this ticket has no
 * `gsi1pk` and is simply absent from the index until it reconnects — see the ticket's
 * Resolution for the one existing row and what was done about it.
 */
sourceAccountTable.addGlobalSecondaryIndex({
  indexName: "byExternalOwner",
  partitionKey: { name: "gsi1pk", type: AttributeType.STRING },
  projectionType: ProjectionType.KEYS_ONLY,
})

sourceAccountTable.grantReadWriteData(computeRole)
oauthStateTable.grantReadWriteData(computeRole)

/**
 * The client credentials, read from SSM at cold start by
 * `lib/sources/oauth-credentials.ts`. Ticket 0017 put them under the shared Amplify
 * secret path; this is the grant that lets the SSR compute read them.
 *
 * TWO PARAMETER ARNs, NAMED. Not a path wildcard: `/amplify/shared/<app>/*` also
 * covers `GITHUB_TICKETS_PAT`, which acts as the operator on the repository, and a
 * grant written for convenience would have quietly widened the SSR compute's reach to
 * it. The role's total credential reach stays "the three parameters it actually
 * reads", which is what makes the narrowness in 0018's own grant worth keeping.
 *
 * The by-hand `ReadTicketsCapturePat` inline policy from 0018 is left alone. It is
 * not managed here and re-declaring it in CDK would fight it.
 */
computeRole.addToPrincipalPolicy(
  new PolicyStatement({
    sid: "ReadSourceOAuthClientCredentials",
    actions: ["ssm:GetParameter"],
    resources: [
      `arn:aws:ssm:${sourcesStack.region}:${sourcesStack.account}:parameter/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_ID`,
      `arn:aws:ssm:${sourcesStack.region}:${sourcesStack.account}:parameter/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_SECRET`,
    ],
  }),
)

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RAW ARCHIVE IS UNDELETABLE  (ticket 0039, I-3, 01-architecture.md §3,
 * 08-security-privacy.md §6.2)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * I-3: *"`raw/` objects are immutable and undeletable; the only operation permitted
 * to remove one is account deletion."* It is classified **[S] Structural** — a
 * policy, explicitly "not a convention" — because everything else in this system is
 * derived and rebuildable and these bytes are not (D-101). Lose an archived trace
 * and the run it encoded is gone from a map that never re-fogs (D-020).
 *
 * Two mechanisms, and the split is the point. Versioning and `keepOnDelete` are in
 * `./storage/resource.ts`; the two Deny statements are here.
 */
const archiveStack = backend.createStack("RawArchive")

/**
 * THE BREAK-GLASS ROLE. `01-architecture.md` §3 and §6.2 both name it: deletion of
 * an archived object is possible, "but only by a person who has deliberately assumed
 * a role whose only purpose is deletion."
 *
 * It did not exist before this ticket, which meant §3's "every principal except an
 * explicit break-glass role" had no role to except and the sentence was unenforceable
 * as written.
 *
 * NAMED EXPLICITLY, and here the reason is not the usual one about CloudFormation
 * outputs — it is that this ARN is written into a bucket policy as a STRING rather
 * than as a CDK reference. A reference would make the storage stack depend on this
 * one, and a dependency cycle between the bucket and the role that guards it is a
 * deploy failure at exactly the wrong moment. A literal ARN in a condition is
 * validated by nobody and breaks nothing if the role is absent — the Deny simply
 * applies to everyone, which is the safe direction to fail.
 *
 * TRUSTED BY THE ACCOUNT ROOT, which does NOT mean "anyone in the account". It means
 * an IAM principal must additionally hold an explicit `sts:AssumeRole` grant for this
 * role and must then deliberately assume it. That two-step is the whole control: the
 * operator's day-to-day credentials cannot delete an archived trace by accident, by
 * a mistyped `aws s3 rm --recursive`, or by a compromised session that never thought
 * to look for a role.
 *
 * IT GRANTS NOTHING ELSE. No read, no list, no write — deletion only, on `raw/*`
 * only. A role that could also read the archive would be a second, quieter copy of
 * the lifetime GPS history's threat model (§6.2), and there is no reason for the
 * deletion path to be able to look at what it is deleting.
 */
const ARCHIVE_DELETION_ROLE_NAME = "LostSolesArchiveDeletion"
const ARCHIVE_DELETION_ROLE_ARN = `arn:aws:iam::${archiveStack.account}:role/${ARCHIVE_DELETION_ROLE_NAME}`

const archiveDeletionRole = new Role(archiveStack, "ArchiveDeletionRole", {
  roleName: ARCHIVE_DELETION_ROLE_NAME,
  assumedBy: new AccountRootPrincipal(),
  description:
    "BREAK GLASS ONLY. The single principal permitted to delete objects under raw/*. " +
    "See 08-security-privacy.md §6.4/§6.5 before assuming it.",
  /**
   * One hour. Long enough for a deliberate deletion under §6.5's procedure, short
   * enough that a forgotten session is not a standing capability to erase the
   * system of record.
   */
  maxSessionDuration: Duration.hours(1),
})

const rawArchiveObjects = backend.storage.resources.bucket.arnForObjects("raw/*")

archiveDeletionRole.addToPrincipalPolicy(
  new PolicyStatement({
    sid: "DeleteArchivedRawObjects",
    /**
     * BOTH ACTIONS. `DeleteObject` on a versioned bucket writes a delete marker and
     * hides the object; `DeleteObjectVersion` is what actually destroys bytes. A
     * break-glass role that could only do the first would leave §6.5's account
     * deletion unable to finish, which is the tension §6.3 exists to resolve.
     */
    actions: ["s3:DeleteObject", "s3:DeleteObjectVersion"],
    resources: [rawArchiveObjects],
  }),
)

/**
 * THE DENY. `Principal: "*"`, excepted only by the role above.
 *
 * WHY A CONDITION AND NOT `NotPrincipal`: a `Deny` with `NotPrincipal` matches every
 * principal not named, including anonymous and cross-account callers, and its
 * evaluation is notoriously easy to get backwards. `aws:PrincipalArn` is a plain
 * string comparison, and for an assumed role it resolves to the ROLE's ARN rather
 * than the session ARN — so one entry covers every session of it. A request with no
 * principal ARN at all (an anonymous caller) fails the `StringNotLike` and is denied,
 * which is the correct default.
 *
 * BOTH `DeleteObject` AND `DeleteObjectVersion`, and the second is the one that is
 * easy to omit. Denying only `DeleteObject` on a versioned bucket stops the delete
 * MARKER and leaves the actual destruction of bytes wide open — versioning would then
 * be decorative, and `storage/resource.ts` leans on it for the overwrite half of I-3.
 *
 * WHAT THIS DELIBERATELY DOES NOT DENY is `s3:PutObject`. I-3 names overwrite as well
 * as deletion, and there is no IAM condition that refuses a PUT onto an existing key
 * while permitting the first one — a policy able to stop an overwrite would stop
 * every write, including the archive's own. D-205 records the resolution: versioning
 * plus this Deny makes an overwrite structurally non-destructive (the prior bytes
 * remain and cannot be removed), and `src/pipeline/archive.ts` PUTs with
 * `IfNoneMatch: "*"` so the common case never writes a second version at all.
 */
backend.storage.resources.bucket.addToResourcePolicy(
  new PolicyStatement({
    sid: "DenyRawArchiveDeletionExceptBreakGlass",
    effect: Effect.DENY,
    principals: [new AnyPrincipal()],
    actions: ["s3:DeleteObject", "s3:DeleteObjectVersion"],
    resources: [rawArchiveObjects],
    conditions: {
      StringNotLike: { "aws:PrincipalArn": ARCHIVE_DELETION_ROLE_ARN },
    },
  }),
)

/**
 * AND THE BUCKET POLICY ITSELF IS PROTECTED. Without this, the Deny above is one
 * `PutBucketPolicy` away from being deleted by anything that can edit the policy —
 * which, before this statement, included the SSR compute role's account-admin
 * neighbours and any future CDK deploy running under a broad role. An immutability
 * control that can be switched off by the same credentials it constrains is not a
 * control, it is a comment.
 *
 * CloudFormation deploys are excepted by `aws:CalledVia`, because the storage stack
 * must still be able to update its own policy — otherwise the next `ampx` deploy
 * fails and the only fix is a manual policy edit under root, which is worse.
 */
backend.storage.resources.bucket.addToResourcePolicy(
  new PolicyStatement({
    sid: "DenyBucketPolicyTamperingOutsideCloudFormation",
    effect: Effect.DENY,
    principals: [new AnyPrincipal()],
    actions: ["s3:DeleteBucketPolicy"],
    resources: [backend.storage.resources.bucket.bucketArn],
    conditions: {
      StringNotEquals: { "aws:CalledVia": "cloudformation.amazonaws.com" },
    },
  }),
)

/**
 * ABORT INCOMPLETE MULTIPART UPLOADS. Ticket `0106`, `08-security-privacy.md` §6.4 step 6: "set a
 * lifecycle rule to abort incomplete multipart uploads while you are there."
 *
 * The parts of an upload that never completed are invisible to `ListObjectVersions`, so the
 * account-deletion purge cannot see them, and they are billed and kept forever. This rule is what
 * removes them. It is infrastructure, not a step the deletion script performs: a script that
 * `PutBucketLifecycleConfiguration`s would drift from this stack and be silently reverted by the
 * next deploy, and the script only CHECKS that the rule is present.
 *
 * THIS IS THE ONLY LIFECYCLE RULE, AND IT EXPIRES NOTHING. No `expiration`, no
 * `noncurrentVersionExpiration`, no transition. A rule that expired objects or old versions would
 * be a deletion path for `raw/` that walks straight around the bucket policy's Deny, because S3
 * lifecycle actions are not evaluated against it — `raw-archive-immutability.test.ts` holds this
 * to exactly one rule with exactly this one action. Seven days: an interrupted upload worth
 * resuming is resumed within the hour, and nothing here uploads in parts at all today.
 */
backend.storage.resources.cfnResources.cfnBucket.lifecycleConfiguration = {
  rules: [
    {
      id: "AbortIncompleteMultipartUploads",
      status: "Enabled",
      abortIncompleteMultipartUpload: { daysAfterInitiation: 7 },
    },
  ],
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INGEST RECEIPT  (ticket 0040, 02-data-model.md T8, 01-architecture.md §4)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The table that makes webhook replay unable to double-award XP. It ships at the
 * first import rather than when duplicates start arriving, because idempotency
 * cannot be retrofitted onto an append-only ledger: D-135 says XP never decreases,
 * so once two awards exist for one run there is no operation that removes the wrong
 * one and no way to tell which was the duplicate.
 *
 * A CDK table, not a `defineData` model, for §2.1 reason 2 — and reason 5 is the one
 * that bites here: T6/T7/T8 must survive a stack teardown, which a `defineData`
 * model cannot promise.
 *
 * `src/pipeline/ingest-receipt.ts` holds the four layers this table implements and
 * the reasoning for each. What lives here is only its shape.
 */
const ingestStack = backend.createStack("IngestPipeline")

const ingestReceiptTable = new Table(ingestStack, "IngestReceiptTable", {
  /**
   * NAMED EXPLICITLY, the same trade `LostSolesCaptureGuard` and
   * `LostSolesSourceAccount` record: the accept gate's first caller is the Sync
   * action (0043) on Amplify's SSR compute, which is not a `defineFunction` Lambda
   * and has no CloudFormation output to be handed a generated name through.
   * `src/pipeline/ingest-receipt.ts` states the identical literal and a test asserts
   * the two agree.
   */
  tableName: "LostSolesIngestReceipt",
  /** T8: `pk = ingestKey`, no sort key. One receipt per gate, looked up by key alone. */
  partitionKey: { name: "ingestKey", type: AttributeType.STRING },
  /**
   * ~250 live items at five years (90-day TTL × ~2 keys/activity × ~400/yr). T8 says
   * it plainly: "this is not a scale problem; it is a correctness structure."
   */
  billingMode: BillingMode.PAY_PER_REQUEST,
  /**
   * 90 days, and SAFE TO EXPIRE — which is worth stating because a table guarding
   * against double-awards looks like one that should keep its rows forever.
   *
   * It is safe because layer 4 is the permanent backstop (§4): the explored set is a
   * SET, so `delta = newCells \ explored` is empty on a replay and a re-run of the
   * same activity yields zero new cells and zero discovery credit even with no
   * receipt at all. The ledger's deterministic id is the second backstop. This table
   * is an optimisation over two structural guarantees, not the guarantee itself.
   */
  timeToLiveAttribute: "ttl",
  /**
   * RETAIN. `02-data-model.md` §7.2/5 names T6, T7 and T8 together: "CDK tables with
   * `removalPolicy: RETAIN` — they survive a stack teardown by construction. That is
   * the whole reason they are outside `defineData`."
   *
   * Note this differs from `LostSolesCaptureGuard`, which is DESTROY on the argument
   * that its rows are disposable guard state with a TTL in hours. These rows are
   * disposable too — but the window is 90 days, and losing the table mid-window means
   * every in-flight activity loses its receipt at once, which is the one moment the
   * two structural backstops are being asked to work unaided. §7 settles it; the
   * orphaned-name cost is accepted, as it is for T7.
   */
  removalPolicy: RemovalPolicy.RETAIN,
})

/**
 * THE SPARSE FAILURE INDEX (ticket 0044, criterion 4).
 *
 * `failedUserId` is written only by `recordFailure` and removed again by
 * `claimForScoring`, so this index holds one entry per OUTSTANDING failure and is
 * normally empty. That is what lets a reader ask "did anything fail for this user?"
 * with a Query rather than a Scan — and, more to the point, what keeps the cost of
 * asking a function of how much is currently broken rather than of how many activities
 * have ever been imported. (The Sync action asked on every press until 0281 removed the
 * read under D-318; `listFailedReceipts` stays as the tested reader.)
 *
 * THE NAME IS STATED TWICE, like the table's own, and for the identical reason: the
 * reader was written for Amplify's SSR compute, which has no CloudFormation output
 * to be handed a generated one through. `src/pipeline/ingest-receipt.ts` states the same
 * literal and `ingest-receipt-table.test.ts` asserts the two agree.
 *
 * PROJECTION IS `INCLUDE`, NOT `ALL`, and at ~250 rows that is not about cost. It is
 * about a projection being a statement of what the index is FOR: a failure report needs
 * the identity of the run, its error class and whether the raw bytes survived. It does
 * not need `xpAwarded`, and an index that carried the DONE-path fields would invite a
 * reader to answer a different question from the one it was built for.
 */
ingestReceiptTable.addGlobalSecondaryIndex({
  indexName: "failedByUser",
  partitionKey: { name: "failedUserId", type: AttributeType.STRING },
  /** Newest failure first, which is the one the operator is asking about. */
  sortKey: { name: "failedAt", type: AttributeType.STRING },
  projectionType: ProjectionType.INCLUDE,
  nonKeyAttributes: [
    "activityId",
    "source",
    "externalId",
    "errorClass",
    "rawArchived",
    "attempts",
  ],
})

/**
 * The Sync action (0043) runs the accept gate on the SSR compute, so that role needs
 * read/write here — and from 0044, a Query on the index above, which
 * `grantReadWriteData` covers because CDK extends a table grant to `<table>/index/*`.
 * The `process-activity` Lambda gets its own grant in 0042 — this one is not it, and
 * neither grant is a wildcard over the account's DynamoDB.
 */
ingestReceiptTable.grantReadWriteData(computeRole)

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FOG  (ticket 0047, 02-data-model.md T6, 05-fog-of-war.md §2.4)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The table that holds the map. **This is the one table whose loss would feel
 * final**, and every property below is chosen for that sentence.
 *
 * Not a `defineData` model: the client never reads it (01 §2). The browser
 * downloads `explored-r11.<gen>.bin` and queries it in memory, so putting T6 behind
 * AppSync would add $4.00/M operations for a path nobody uses — and §2.1 reason 5
 * settles it anyway, because a `defineData` model cannot promise RETAIN.
 */
const exploredCellTable = new Table(ingestStack, "ExploredCellTable", {
  /**
   * NAMED, like `LostSolesIngestReceipt` and `LostSolesSourceAccount`, and here the
   * argument is sharper than for either of them: RETAIN exists so the table SURVIVES a
   * stack teardown, and a generated name is orphaned by the very teardown it is meant to
   * survive — the next deploy would stand up an empty table beside a full one and the map
   * would silently start from nothing. `src/pipeline/explored-cells.ts` states the same
   * literal and `explored-cells-table.test.ts` asserts the two agree.
   */
  tableName: "LostSolesExploredCell",
  /**
   * T6: `pk = U#<uid>#C#<res6ParentCellId>`, `sk = <res10CellId>`.
   *
   * The res-6 parent is not decoration — a res-6 cell holds at most 7⁴ = 2,401 res-10
   * children, a HARD ceiling, so a partition cannot exceed ~384 KB. One decision, three
   * payoffs: bounded partitions, a 1–20 `Query` viewport read, and the client's bucketing
   * for free (05 §6.2). See `parentOf` in `src/domain/fog.ts`.
   *
   * NO SOURCE ANYWHERE IN THE KEY (§7.4). That absence is the structural reason
   * "remove Strava's cells" is not an operation this schema can express, which is what
   * makes D-020 a property of the data model rather than a rule anyone has to remember.
   */
  partitionKey: { name: "pk", type: AttributeType.STRING },
  sortKey: { name: "sk", type: AttributeType.STRING },
  /**
   * 20k–150k items at five years, ~160 B each — 4–24 MB, inside the free tier. T6's own
   * note applies: this is not a scale problem.
   */
  billingMode: BillingMode.PAY_PER_REQUEST,
  /**
   * RETAIN, and NO TTL — the two together are the point. `LostSolesIngestReceipt` expires
   * its rows at 90 days because it is an optimisation over two structural backstops. This
   * table IS the backstop. D-020 says the map only ever grows, so nothing here may expire,
   * and §7.2/5 names T6 first among the tables that must survive a teardown.
   */
  removalPolicy: RemovalPolicy.RETAIN,
  /**
   * PITR. The first table in this system to carry it (the `defineData` model tables have
   * it too since `0300`), and the reason is that its contents cannot be re-derived from
   * anywhere cheap: the raw traces in S3 CAN rebuild it
   * (§2.9, ticket 0103), but that is a drill measured in hours, and 35 days of
   * point-in-time restore turns "the map is wrong" from an incident into an afternoon.
   */
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE QUEUE, THE DLQ AND THE WORKER  (ticket 0042, 01-architecture.md §2 and §4)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The second of the four sanctioned escape-hatch uses. Amplify has no queue primitive
 * and `defineFunction` has no event-source property, so all of this is CDK — and AWS is
 * explicit that anything added this way is ours to get right, which is why the synth
 * test `process-activity-stack.test.ts` asserts each number below rather than trusting
 * the diff that introduced it.
 *
 * IT IS BUILT QUEUE-SHAPED WITH ONE PRODUCER, ON PURPOSE. Today only the Sync action
 * (0043) enqueues. Capability 14 adds the webhook producer to this same queue with NO
 * change to this consumer — that is the entire argument for a queue over a direct call,
 * and it only holds if the queue exists before the second producer does. §4's 2-second
 * ack deadline cannot be met any other way: the ack has to happen before the fetch.
 */

/**
 * THE DEAD LETTER QUEUE, DECLARED FIRST because the main queue references it.
 *
 * FOURTEEN DAYS, which is SQS's maximum and is chosen for what it protects rather than
 * for tidiness: a message here is an activity that failed to import, the map cannot
 * re-fog (D-020), and the raw bytes it points at may be the only surviving copy of a
 * run if the source has since deleted it. Two weeks is enough for a holiday. §4 names a
 * CloudWatch alarm on `ApproximateNumberOfMessagesVisible > 0` here (one of two alarms
 * since ticket 0095) — that alarm is 0044's, and this is the queue it watches.
 */
const activityIngestDlq = new Queue(ingestStack, "ActivityIngestDLQ", {
  retentionPeriod: Duration.days(14),
})

/**
 * THE INGEST QUEUE.
 *
 * `visibilityTimeout` is 16 MINUTES AND IT IS DERIVED, not chosen: it must exceed the
 * worker's 900-second timeout, or SQS hands a still-running message to a second
 * invocation and two workers race for the same claim. The score gate would survive that
 * — one of them loses the conditional update — but it would burn a receive attempt and
 * two API calls against a shared rate limit to discover it. If `resource.ts`'s timeout
 * ever changes, this changes with it.
 *
 * `maxReceiveCount: 3` is §4's "3 receive attempts, then the DLQ". SQS counts receives,
 * so the message moves on the FOURTH delivery — the redrive policy is a ceiling on
 * successful receives, not on failures.
 *
 * STANDARD, NOT FIFO. Ordering is meaningless here (activities are independent and the
 * `Activity` row is keyed on a deterministic id) and exactly-once is not something this
 * system is willing to depend on — the receipt table exists precisely because
 * at-least-once is assumed. A FIFO queue would cost a content-deduplication window that
 * silently overlaps the receipt's own 90 days and answers the same question worse.
 */
const activityIngestQueue = new Queue(ingestStack, "ActivityIngestQueue", {
  visibilityTimeout: Duration.minutes(16),
  deadLetterQueue: { queue: activityIngestDlq, maxReceiveCount: 3 },
})

const processActivityLambda = backend.processActivity.resources.lambda

/**
 * `batchSize: 1` — one activity per invocation, and the reason is in the ticket: one
 * poisoned message cannot fail a batch of good ones. Without partial-batch reporting a
 * thrown handler fails every message in its batch, so a batch of ten would send nine
 * healthy activities back to the queue and, after three rounds, into the DLQ alongside
 * the one that was actually broken.
 *
 * `maxConcurrency: 5` — `0196`, D-266. Every worker is the same user's in a single-user
 * app, and every one of them commits through ONE conditional `manifest.json` PUT
 * (`explored-blob-store.ts`). Unbounded, a backfill of hundreds of activities lets the
 * poller scale to dozens of workers fighting over that object, and the unluckiest exhausts
 * any sane retry budget. Five bounds it to four rivals inside a ten-attempt budget. It is
 * the event source's cap, NOT reserved concurrency, on purpose: a message the poller does
 * not hand over is not received, so it burns none of `maxReceiveCount`'s three — reserved
 * concurrency would throttle the invocation and count it.
 */
processActivityLambda.addEventSource(
  new SqsEventSource(activityIngestQueue, { batchSize: 1, maxConcurrency: 5 }),
)

/**
 * THE GRANTS. Amplify grants a CDK-created resource NOTHING for you, and least privilege
 * here is not ceremony — this function holds the only principal in the account that can
 * read a user's OAuth tokens and write to the archive.
 */

/**
 * EVERY GRANT BELOW IS AN EXPLICIT ACTION LIST, not `grantReadWriteData`.
 *
 * That convenience method was the first draft and the synth test rejected it, correctly:
 * it hands out `dynamodb:DeleteItem`, `BatchWriteItem` and `Scan` on every table it
 * touches. Criterion 3 asks for the absence of `DeleteItem` because of I-7 — *"no code
 * path deletes an `ExploredCell` item, at any level of retreat"* — and the cell table
 * arrives in capability 07, into a role that would already have carried the action if
 * this had been left as a convenience call. The invariant is classified **[S]
 * Structural**, meaning it must not be removable without the removal showing up in an
 * infrastructure diff; a role that never held the action in the first place is the only
 * version of that which survives someone reaching for `grantReadWriteData` out of habit.
 *
 * `table.grant()` still grants the encryption key alongside the table, so T7's CMK is
 * covered without a second statement.
 */

/**
 * T8. `UpdateItem` counts the delivery, claims the receipt, and closes it inside the
 * persist transaction; `GetItem` is the read on the losing side of a lost claim. The
 * accept gate's `PutItem` is NOT here — that runs on the SSR compute (0043), and a
 * worker able to create receipts could manufacture the row it is supposed to be checked
 * against.
 */
ingestReceiptTable.grant(processActivityLambda, "dynamodb:GetItem", "dynamodb:UpdateItem")

/**
 * T6. **`UpdateItem` AND NOTHING ELSE**, and every absence here is deliberate.
 *
 * NO `DeleteItem` — I-7: *"no code path deletes an `ExploredCell` item, at any level of
 * retreat"*. The invariant is classified **[S] Structural**, meaning it must not be
 * removable without the removal showing up in an infrastructure diff. A role that never
 * held the action is the only version of that which survives someone reaching for
 * `grantReadWriteData` out of habit — which is precisely the trap the comment above the
 * T8 grant was written to describe, one capability before this table existed.
 *
 * NO `BatchWriteItem` — same reason, since a batch carries `DeleteRequest`. It is also
 * useless here: a batch cannot carry a `ConditionExpression`, which is the entire
 * mechanism by which `firstRunAt` takes a `min` and `lastRunAt` a `max` (I-8).
 *
 * NO `PutItem` — a `Put` replaces the item, which is the unconditional `SET` that lets a
 * 2024 backfill stomp a 2026 `lastRunAt`. The absence makes that write unavailable rather
 * than merely discouraged.
 *
 * NO `Query`/`GetItem`. 0047 granted no read at all and said each later ticket must add
 * the one it needs here, where a reviewer can see it. **0048 is the first to do that** and
 * adds `BatchGetItem` — AP-15, "which of this run's cells already exist". It is the whole
 * read: 40–130 keys in one round trip, returning only the cells the run touched.
 *
 * NOT `Query`, which AP-15 originally specified and which was corrected in the same
 * commit: a `Query` returns the entire res-6 partition — up to 2,401 cells — to classify
 * the 45 this run crossed. `Scan` is absent for the reason it always is.
 *
 * STILL NO `Query`, AND 0049 IS THE TICKET THAT DECIDED NOT TO ADD IT. The blob rebuild
 * (AP-16/AP-17) is the one operation that wants it, and 0049 built that path —
 * `src/pipeline/explored-rebuild.ts`. It is deliberately not reachable from this role.
 * §5.6: *"AP-16 is the repair path. **Calling it from `process-activity` is a
 * review-blocking bug.**"* A grant is what turns that sentence from a rule someone has to
 * remember into a thing the role cannot do, so the repair path will take its `Query` when
 * it gets an execution context of its own (the drill, `0105`), where the cost is chosen
 * rather than inherited. `check-fog-hot-path.mjs` is the same guard at build time.
 *
 * 0049 adds NO new DynamoDB action at all: the generation counter (D-218) and the AGG
 * items are both `UpdateItem` on this table, and both were already covered.
 */
exploredCellTable.grant(
  processActivityLambda,
  "dynamodb:UpdateItem",
  "dynamodb:BatchGetItem",
)

/**
 * T7. READ **AND WRITE**, and this is a deliberate departure from ticket 0042's third
 * acceptance criterion, which says "read `SourceAccount`".
 *
 * §4 step 7 and §2's own grants block both say read/write, and the reason is concrete:
 * the provider may return a NEW refresh token on any refresh (`03-integrations.md` §2.2),
 * so an inline refresh that cannot write the rotation back leaves the row holding a
 * refresh token the provider has already retired. The connection would then be dead
 * until a human reconnected it — and it would break on the FIRST refresh, not eventually.
 *
 * A read-only grant would also break the lease `lib/sources/token-refresh.ts` takes to
 * stop two refreshers racing, which is itself a conditional write.
 *
 * The criterion is amended at close with this reasoning rather than quietly satisfied
 * with a grant that does not match it.
 *
 * `GetItem` and `UpdateItem` only — the two commands the credential path actually issues
 * (`loadCredentials` reads; the lease, the rotation and `markNeedsReauth` are all
 * conditional updates). No `PutItem`: creating a connection is the OAuth callback's job,
 * and no `Query`, which would reach the `byExternalOwner` index the webhook uses to turn
 * a provider's owner id into a user id — a lookup this function has no reason to perform
 * and §7 explicitly wants kept off the ingest path.
 */
sourceAccountTable.grant(processActivityLambda, "dynamodb:GetItem", "dynamodb:UpdateItem")

/**
 * AND THE KEY, SEPARATELY — which `grantReadWriteData` would have done for free and
 * `Table.grant()` does not.
 *
 * T7 is the one table in this system encrypted with a customer-managed key, and a CMK's
 * default policy delegates to IAM (`kms:*` to the account root) rather than granting
 * anything itself. So a role holding `dynamodb:GetItem` and no `kms:Decrypt` is refused
 * by KMS on every read — the table permission is necessary and not sufficient.
 *
 * THIS WAS CAUGHT BY THE LIVE SMOKE TEST, NOT BY THE BUILD, and that is worth recording
 * rather than tidying away. Narrowing the grants above (to keep `dynamodb:DeleteItem`
 * off this role for I-7) silently dropped the key grant that the convenience method had
 * been supplying, and nothing in CI noticed: the synth test asserted the actions that
 * must be ABSENT and the ones the pipeline calls, and a missing KMS action is neither.
 * The failure would have been an `AccessDeniedException` on the first activity, from
 * KMS, naming a key rather than a table.
 *
 * `grantEncryptDecrypt` and not `grantDecrypt`: DynamoDB needs the encrypt half to WRITE
 * the row back after a token rotation, which is the whole reason the write grant above
 * exists.
 */
sourceAccountKey.grantEncryptDecrypt(processActivityLambda)

/**
 * PITR ON EVERY `defineData` MODEL TABLE — ticket `0300`. Every model in
 * `data/resource.ts` is owner-scoped, so this loop IS "every owner-scoped table": `Activity`,
 * `Profile`, `SkillState`, `XpLedgerEntry`, `Landmark` (and `DeploySmokeTest`, which costs
 * nothing). A loop rather than a list so a model added later inherits it; `pitr-tables.test.ts`
 * fails the build if any model table lacks it.
 *
 * Why: `02` §8.2. D-135's waterline lives in `SkillState.displayedXp`/`levelHighWater` and the
 * `isFloor` ledger rows, and is not in `raw/`. The D-259 snapshots cover it, but only up to the
 * newest one; 35 days of point-in-time restore covers a bad write or a mistaken delete without
 * the hours-long §8.3 drill. Cost at this size is pennies (PITR bills on table bytes).
 *
 * NOT T7 `LostSolesSourceAccount` (a backup of live credentials, §1.1 — see its own comment),
 * nor `LostSolesOAuthState` (ten-minute nonces), `LostSolesIngestReceipt` (TTL 90 days; an
 * optimisation over permanent backstops) or `LostSolesCaptureGuard` (not owner data). T6
 * `ExploredCell` already carries it.
 */
for (const table of Object.values(backend.data.resources.cfnResources.amplifyDynamoDbTables)) {
  table.pointInTimeRecoveryEnabled = true
}

/**
 * T3, the Amplify-generated `Activity` table. Reached through `backend.data`, because
 * `defineData` generates the physical name and nothing may hard-code it — the worker is
 * handed it in the environment below.
 *
 * WRITE ACCESS TO AN APPSYNC MODEL'S TABLE, DIRECTLY, is the D-207 consequence: the row
 * must be able to join a `TransactWriteItems` with the receipt, and an AppSync mutation
 * cannot join a transaction. §4 layer 3 dies without one.
 */
const activityTable = backend.data.resources.tables["Activity"]
/**
 * `PutItem` and `GetItem`. The transaction writes the row and — the one that matters — never
 * deletes it.
 *
 * `GetItem` is `0220`'s: before the put, `readStoredAward` reads the row's discovery award so
 * a second delivery keeps the first one rather than overwriting it with an all-`cooled`
 * reclassification (D-260). A single-key read of the award columns, nothing wider.
 */
activityTable.grant(processActivityLambda, "dynamodb:PutItem", "dynamodb:GetItem")
/**
 * `UpdateItem` — ticket `0282`, the grant the comment above said a source-side delete would need,
 * written here on its own so a reviewer sees what it is for. ONE caller: `tombstoneActivity`
 * (`src/pipeline/persist.ts`), which sets `status = TOMBSTONED` and `updatedAt` on an existing row
 * of the message's own user, after the source has confirmed the deletion. It never removes a
 * row (still no `DeleteItem`, I-7), and it widens nothing a reviewer should worry about: the role
 * already holds `PutItem` on this table, which can write any attribute.
 */
activityTable.grant(processActivityLambda, "dynamodb:UpdateItem")

/**
 * `0179`, pipeline step 3 — `dynamodb:Query` on GSI2 `byUserAndDedupe` ALONE (contract §3, I-22).
 *
 * The index, not the table: a table-level `Query` would let the worker read whole activity rows by
 * user, which step 3 never needs. GSI2 is `KEYS_ONLY`, so this grant yields ids and nothing else,
 * and the three fields `isSameActivity` compares come through the `GetItem` granted above.
 */
processActivityLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [`${activityTable.tableArn}/index/byUserAndDedupe`],
  }),
)

/**
 * T4 `XpLedgerEntry` and T2 `SkillState`, ticket `0062`. Written directly for the reason T3
 * is (D-207): the ledger rows and the `SkillState` ADDs join the ingest transaction, and an
 * AppSync mutation cannot. The models expose NO mutation at all (`disableOperations`), so
 * this role is the only writer either table has.
 *
 * T4: `PutItem` for the conditional append, and `Query` on `byActivity` ALONE for the
 * layer-1 "has this activity been scored" check (`src/pipeline/xp-ledger.ts`). No `UpdateItem`
 * and no `DeleteItem`: ingest never changes or removes a row (I-18). The replay job (`0066`)
 * deletes, under its own role.
 *
 * T2: `UpdateItem` for the ADD, and `Query` on the base table for the strongly consistent
 * pre-read the ADD's condition compares against. No `DeleteItem` either.
 *
 * T1: `UpdateItem` for §4.3's `Update Profile` totals (`0219`), and `GetItem` for ONE
 * attribute: `ledgerRulesVersion`, the version fallback for a user with no T2 rows (`0235`,
 * D-275). The totals are still computed from the T2 pre-read. Never `DeleteItem`.
 */
const xpLedgerTable = backend.data.resources.tables["XpLedgerEntry"]
const skillStateTable = backend.data.resources.tables["SkillState"]
xpLedgerTable.grant(processActivityLambda, "dynamodb:PutItem")
processActivityLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [`${xpLedgerTable.tableArn}/index/byActivity`],
  }),
)
skillStateTable.grant(processActivityLambda, "dynamodb:UpdateItem", "dynamodb:Query")
const profileTable = backend.data.resources.tables["Profile"]
profileTable.grant(processActivityLambda, "dynamodb:UpdateItem", "dynamodb:GetItem")

/**
 * `Landmark`, ticket `0248` (D-301). `UpdateItem` ALONE: the row joins the ledger transaction as a
 * write-once `if_not_exists` update. No `PutItem`, which could overwrite a landmark, and no
 * `DeleteItem` anywhere — a landmark never un-happens. The same grant goes to `log-workout` and
 * `set-activity-kind`, the other two paths that add XP.
 */
const landmarkTable = backend.data.resources.tables["Landmark"]
landmarkTable.grant(processActivityLambda, "dynamodb:UpdateItem")

/**
 * THE ARCHIVE. `PutObject` for the write, and `GetObject` because `archive.ts` issues a
 * `HeadObject` on the already-archived path — S3 authorises a HEAD with `s3:GetObject`,
 * so a grant of PutObject alone would fail on exactly the re-delivery path the archive
 * is content-addressed to make cheap.
 *
 * SCOPED TO `raw/*` AND NOTHING ELSE. The same bucket holds `explored-r11.<gen>.bin` and the
 * aggregates (capability 07), which this function will also write — under their own
 * grant, when that ticket adds it. A prefix-free grant now would quietly hand the worker
 * the whole bucket and there would be no diff to notice later.
 *
 * WRITTEN AS A STATEMENT rather than `bucket.grantRead`/`grantPut`, for the same reason
 * the table grants above are explicit: those two convenience methods also grant
 * `s3:List*` and `s3:GetBucket*` on the WHOLE bucket — object-level access is scoped to
 * the prefix, bucket-level access cannot be — so the worker would be able to enumerate
 * every user blob in it. Two actions on one prefix is the entire need.
 *
 * IT CANNOT DELETE. Not stated as a restriction but as an absence: I-3 denies deletion
 * under `raw/*` to every principal except the break-glass role, and this grant never
 * asks for it.
 */
processActivityLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "WriteAndReadRawArchive",
    actions: ["s3:PutObject", "s3:GetObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("raw/*")],
  }),
)

/**
 * `s3:ListBucket`, SCOPED BY PREFIX — and it is needed for TWO independent reasons. Ticket `0192`.
 *
 * ─── REASON 1, `raw/`: FINDING A CONTENT-ADDRESSED KEY ──────────────────────
 *
 * A `command: "reingest"` job re-runs the pipeline over the ARCHIVED bytes rather than re-fetching,
 * because a source can return a different payload for the same activity and ground revealed from
 * bytes the original ingest never saw is permanent on a map that never re-fogs (D-020). Finding
 * those bytes means listing `raw/<uid>/<source>/<externalId>/`, because the key carries a content
 * digest that only the bytes themselves produce.
 *
 * `s3:ListBucket` IS A BUCKET-LEVEL ACTION, hence its own statement on the bucket ARN rather than an
 * addition to the object grants above — those deliberately hold only object-level actions on
 * `arnForObjects(...)`, and appending a bucket action would silently change what `resources` means.
 *
 * ─── REASON 2, `users/`: A MISSING OBJECT MUST READ AS MISSING ──────────────
 *
 * This one is a latent bug that has nothing to do with replay, and it would have bitten the
 * operator's first ever real run. **S3 returns `403 AccessDenied` instead of `404 NoSuchKey` when
 * the caller lacks `s3:ListBucket` on the bucket** — deliberately, so a probe cannot learn whether
 * an object exists. `explored-blob-store.ts`'s `getBytes` catches `NoSuchKey` and returns
 * `undefined`, which is how "there is no previous generation" is expressed; with only `GetObject`
 * granted it receives an `AccessDenied` it cannot recognise and throws instead.
 *
 * That only happens when the object is genuinely absent, which is only true on the FIRST publish —
 * so no test, no review and no ordinary deploy could have surfaced it. It took an account with cells
 * and no manifest, which is exactly the state this ticket created. Found on the first replay:
 * `phase: "blobs"`, `errorClass: "AccessDenied"`, after 12 cells had already been written.
 *
 * ─── SCOPED BY CONDITION, WHICH IS THE PART THAT MATTERS ────────────────────
 *
 * The grant above warns that `bucket.grantRead` hands out `s3:List*` on the WHOLE bucket. An
 * `s3:prefix` condition is the answer that comment implies but does not spell out: bucket-level
 * access cannot be scoped by resource ARN, and it CAN be scoped by condition. A request for any
 * prefix outside these two is denied.
 *
 * ONE STATEMENT RATHER THAN TWO, unlike the object-level grants above, and the difference is real:
 * those are separate because the two prefixes have OPPOSITE rules — `raw/` is immutable and
 * deletion is denied to every principal, `users/` is derived and rewritten constantly. For listing
 * the rule is identical ("may enumerate"), so splitting it would suggest a distinction that does
 * not exist.
 */
processActivityLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ListOwnPrefixes",
    actions: ["s3:ListBucket"],
    resources: [backend.storage.resources.bucket.bucketArn],
    conditions: { StringLike: { "s3:prefix": ["raw/*", "users/*"] } },
  }),
)

/**
 * THE DELIVERY LAYER. `0049`, `02-data-model.md` §2.10 and §6.1.
 *
 * A SECOND STATEMENT ON A SECOND PREFIX, rather than widening the one above. The comment
 * on that grant predicted this exact ticket — *"the same bucket holds `explored-r10.bin`
 * and the aggregates (capability 07), which this function will also write — under their
 * own grant, when that ticket adds it"* — and the reason it is separate is that the two
 * prefixes have opposite rules. Under `raw/*` the bytes are the system of record and
 * deletion is denied to every principal (I-3). Under `users/*` everything is derived and
 * regenerable from `raw/` plus T6, and objects are added constantly.
 *
 * `GetObject` is not a convenience: §2.10's whole point is that regeneration READS the
 * previous generation's blob instead of `Query`ing 24 MB out of DynamoDB. This grant is
 * what makes the cheap path available, and the absent `dynamodb:Query` above is what makes
 * the expensive one unavailable.
 *
 * STILL NO DELETE. Delta garbage collection (`0051`) is the first thing that will want
 * `s3:DeleteObject` here, and it can argue for it in its own diff. Note what it would and
 * would not reach: `users/*` only, and the bucket is versioned, so even that GC cannot
 * destroy bytes — it writes a delete marker, and `s3:DeleteObjectVersion` is denied
 * bucket-wide by the policy above.
 *
 * `users/*`, NOT `users/<uid>/*`: one worker serves every user, and the per-user scoping
 * is the browser's, enforced by `entity('identity')` in `storage/resource.ts`.
 */
processActivityLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "WriteAndReadExploredDeliveryLayer",
    actions: ["s3:PutObject", "s3:GetObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("users/*")],
  }),
)

/**
 * THE SKILL-STATE SNAPSHOT. `0067`, D-143, `02-data-model.md` §8.2.
 *
 * A THIRD PREFIX WITH A THIRD RULE. `snapshots/skillstate/*` is derived like `users/*` and
 * system-of-record like `raw/*`: what the user was SHOWN is not re-derivable from the archive,
 * so the D-135 waterline survives losing every table only through these objects.
 *
 * `PutObject` ONLY. The ingest writes one after every commit with `IfNoneMatch: "*"` and never
 * reads one back — the reader is the replay job, which runs under the operator's credentials.
 * No `GetObject`, no list, no delete. Outside `users/*`, so no browser grant reaches it either.
 */
processActivityLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "WriteSkillStateSnapshots",
    actions: ["s3:PutObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("snapshots/skillstate/*")],
  }),
)

/**
 * DELTA GARBAGE COLLECTION. `0051`, `02-data-model.md` §6.5 — deltas are kept for ~20
 * generations and dropped after that.
 *
 * `0049` predicted this grant and named the conditions on it: *"Delta GC (`0051`) is the first
 * thing that will want `s3:DeleteObject` here, and it can argue for it in its own diff."*
 * The argument:
 *
 *   - **Nothing under `users/` is a system of record.** Every object in the delivery layer is
 *     re-derivable from `raw/` plus T6 (§1.1) — that is the difference between this prefix and
 *     `raw/*`, where deletion is denied to every principal including this one (I-3), and it is
 *     why the two prefixes were split into separate statements rather than one.
 *   - **A delete here cannot destroy bytes.** The bucket is versioned and
 *     `s3:DeleteObjectVersion` is denied bucket-wide by the resource policy above, so this
 *     writes a delete marker and the object stays recoverable.
 *   - **It is scoped to the deltas and to nothing else.** `deltas/` only: not the manifest, not
 *     `explored/`. A bug in the GC arithmetic can therefore drop a delta a client wanted —
 *     which costs that client one 300 KB immutable GET, the outcome §6.5 already calls correct
 *     — and cannot touch the set, the sidecar or the aggregate.
 *
 * SEPARATE FROM THE READ/WRITE STATEMENT ABOVE, deliberately. Folding `s3:DeleteObject` into
 * it would widen deletion to the whole `users/*` prefix for one line of convenience, and there
 * would be no diff later to notice it in.
 */
processActivityLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ExpireExploredDeltas",
    actions: ["s3:DeleteObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("users/*/deltas/*")],
  }),
)

/**
 * THE BROWSER'S READ PATH, THROUGH THE SSR COMPUTE. `0054`, D-228.
 * `05-fog-of-war.md` §7.3; `02-data-model.md` §6.4; `01-architecture.md` §5.
 *
 * ─── WHY THE COMPUTE ROLE AND NOT THE BROWSER'S OWN CREDENTIAL ──────────────
 *
 * `storage/resource.ts` grants `users/{entity_id}/*` to `allow.entity("identity")`, where
 * `{entity_id}` is the Cognito **identity-pool identity id**. The worker writes
 * `users/<sub>/…`, where `<sub>` is the **user-pool sub** (`02` T1: *"the `<uid>` in every
 * S3 key"*). Those are different strings, so that grant has never covered a single object
 * in the delivery layer. `0049` found it and assigned it to `0054`.
 *
 * The fix is not to widen the browser's grant. `05` §7.4's chain is walked BACKWARDS
 * (D-220), so a browser holding S3 credentials would still need a round trip to this app
 * per hop to learn the next key; and a credential in a browser is a credential in a
 * browser. The map is fetched through `/api/fog`, which re-derives `sub` from the verified
 * session (`08-security-privacy.md` §5.3) and reads S3 as this role.
 *
 * ─── READ ONLY, AND NOTHING ELSE ON THIS PREFIX ─────────────────────────────
 *
 * `s3:GetObject`, no `PutObject`, no `DeleteObject`, no `s3:List*`. The SSR compute
 * serves a map; it never publishes one. Every write to `users/*` belongs to
 * `processActivityLambda` above, and the asymmetry is the point: a bug in a route handler
 * cannot alter a delivery-layer object, and a map that cannot re-fog (D-020) is exactly
 * the kind of thing to keep a reader away from write verbs.
 *
 * `users/*` and not `users/<uid>/*` for the same reason the worker's grant is: one role
 * serves every user, and the per-user scoping is the ROUTE's, from a verified session.
 * Note what this does NOT reach — `raw/*` is absent here as it is from every browser-facing
 * grant (I-3, `storage/resource.ts`): a lifetime GPS archive has no read path through the
 * app at all.
 */
computeRole.addToPrincipalPolicy(
  new PolicyStatement({
    sid: "ReadExploredDeliveryLayerForTheBrowser",
    actions: ["s3:GetObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("users/*")],
  }),
)
/**
 * `0264`, D-306. Without `s3:ListBucket` S3 answers a GET on an absent key with 403 rather than
 * 404, so `/api/runs/web` failed with 500 for a user whose trace web does not exist yet, instead of
 * reading it as missing. Scoped by `s3:prefix` to `users/*`, as `0192` and `0243` scope theirs: the
 * role can name keys it can already read, and still cannot list `raw/`.
 */
computeRole.addToPrincipalPolicy(
  new PolicyStatement({
    sid: "ListDeliveryLayerSoAbsentReadsAs404",
    actions: ["s3:ListBucket"],
    resources: [backend.storage.resources.bucket.bucketArn],
    conditions: { StringLike: { "s3:prefix": ["users/*"] } },
  }),
)

/**
 * THE CLIENT CREDENTIALS, and this grant was missed on the first pass — worth recording
 * because the failure it causes is invisible until the first token expires.
 *
 * §4 step 7 has the worker refresh inline when `expiresAt` is inside its skew window,
 * and a refresh is a token EXCHANGE: it posts the client id and client secret to the
 * provider. `lib/sources/oauth-credentials.ts` reads both from SSM at first use, so
 * without this the ordinary path works perfectly for an hour and then every activity
 * fails with an `AccessDeniedException` from SSM — long after the deploy that caused it.
 *
 * §7's registry sanctions exactly this: the two parameters are granted to "exactly three
 * principals: `process-activity`, `token-refresh`, and the callback route."
 *
 * TWO PARAMETER ARNs, NAMED, not a path wildcard — the same care the SSR compute's own
 * grant takes, and for the same reason: `/amplify/shared/<app>/*` also covers
 * `GITHUB_TICKETS_PAT`, which acts as the operator on the repository. A grant written
 * for convenience would hand the ingest worker the ability to write to this repo.
 */
processActivityLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ReadSourceOAuthClientCredentials",
    actions: ["ssm:GetParameter"],
    resources: [
      `arn:aws:ssm:${ingestStack.region}:${ingestStack.account}:parameter/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_ID`,
      `arn:aws:ssm:${ingestStack.region}:${ingestStack.account}:parameter/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_SECRET`,
    ],
  }),
)

/**
 * The environment. Two generated names the function cannot know any other way, plus the
 * queue's own URL — needed for `ChangeMessageVisibility`, which is how §4's "a 429
 * returns the message to the queue with a delay" is actually performed.
 *
 * `backend.processActivity.addEnvironment` rather than `environment:` in `resource.ts`,
 * because all three are CloudFormation references that only exist once the backend has
 * been assembled — and on the FACTORY rather than on `resources.lambda`, which Amplify
 * exposes as an `IFunction` with no such method.
 */
backend.processActivity.addEnvironment("ACTIVITY_TABLE", activityTable.tableName)
/** `0062`. T4 and T2 — generated names, like T3's. */
backend.processActivity.addEnvironment("XP_LEDGER_TABLE", xpLedgerTable.tableName)
backend.processActivity.addEnvironment("SKILL_STATE_TABLE", skillStateTable.tableName)
/** `0219`. T1, for the Profile totals in the ledger transaction. */
backend.processActivity.addEnvironment("PROFILE_TABLE", profileTable.tableName)
/** `0248`. Landmarks, in the same transaction. */
backend.processActivity.addEnvironment("LANDMARK_TABLE", landmarkTable.tableName)
backend.processActivity.addEnvironment(
  "RAW_ARCHIVE_BUCKET",
  backend.storage.resources.bucket.bucketName,
)
backend.processActivity.addEnvironment(
  "ACTIVITY_INGEST_QUEUE_URL",
  activityIngestQueue.queueUrl,
)
/**
 * `0049`. The same bucket as `RAW_ARCHIVE_BUCKET` — there is one `defineStorage` bucket —
 * under its own name because the two prefixes carry different grants and different rules:
 * `raw/*` is undeletable system-of-record bytes (I-3), `users/<uid>/*` is a derived,
 * regenerable delivery layer whose objects are overwritten never but added to constantly.
 */
backend.processActivity.addEnvironment(
  "USER_DATA_BUCKET",
  backend.storage.resources.bucket.bucketName,
)

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * `token-refresh` — THE SCHEDULED SWEEP  (ticket 0094, 01 §2 resource #14)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The schedule itself is in `functions/token-refresh/resource.ts`. What is here is the
 * reach, and it is the worker's T7 reach plus exactly one action.
 *
 * `Scan` — THE ONE ADDITION, and the only principal that holds it on T7. The sweep has to
 * find every connection near expiry without knowing its user first; `listRefreshCandidates`
 * projects keys and `expiresAt` only, so the scan's own results never carry a token.
 * `GetItem`/`UpdateItem` are `accessTokenFor`'s: the credential load, the lease, the
 * conditional rotation write-back and `markNeedsReauth`. No `PutItem` (creating a
 * connection is the callback's), no `DeleteItem`, no `Query` on `byExternalOwner`.
 *
 * The CMK separately, as for the worker: `Table.grant()` does not cover it, and the
 * rotation write-back needs the encrypt half.
 *
 * The two OAuth client parameters, named — a refresh is an exchange that posts them.
 * Not a path wildcard, for the same reason as the worker's grant: the prefix also holds
 * `GITHUB_TICKETS_PAT`.
 *
 * NO table name in the environment: `SOURCE_ACCOUNT_TABLE` is a literal both sides state.
 */
const tokenRefreshLambda = backend.tokenRefresh.resources.lambda
const tokenRefreshStack = backend.tokenRefresh.stack

sourceAccountTable.grant(
  tokenRefreshLambda,
  "dynamodb:Scan",
  "dynamodb:GetItem",
  "dynamodb:UpdateItem",
)
sourceAccountKey.grantEncryptDecrypt(tokenRefreshLambda)
tokenRefreshLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ReadSourceOAuthClientCredentials",
    actions: ["ssm:GetParameter"],
    resources: [
      `arn:aws:ssm:${tokenRefreshStack.region}:${tokenRefreshStack.account}:parameter/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_ID`,
      `arn:aws:ssm:${tokenRefreshStack.region}:${tokenRefreshStack.account}:parameter/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_SECRET`,
    ],
  }),
)

/**
 * SURFACED FOR THE PRODUCER. 0043's Sync action runs on the SSR compute, which has no
 * CloudFormation output of its own to read — the same structural gap that made the three
 * CDK tables carry explicit names. `amplify_outputs.json` is the one channel available,
 * and a queue URL is not a secret: possessing it grants nothing without `sqs:SendMessage`.
 */
backend.addOutput({
  custom: {
    activityIngestQueueUrl: activityIngestQueue.queueUrl,
    activityIngestDlqUrl: activityIngestDlq.queueUrl,
    /**
     * `0195`. `/api/runs/latest` reads T3 directly, on the SSR compute, for the same reason
     * `0043`'s Sync action reads the queue URL from here: the route has no CloudFormation
     * output of its own. A TABLE NAME IS NOT A SECRET — possessing it grants nothing without
     * the `dynamodb:Query` granted a few lines below, which is scoped to this table alone.
     */
    activityTableName: activityTable.tableName,
    /**
     * `0081`. The run page's tally reads T4's `byUserAndSeq` on the SSR compute, for "where each
     * skill stood before this run" (`lib/runs/tally-server.ts`). Same argument as the line above.
     */
    xpLedgerTableName: backend.data.resources.tables["XpLedgerEntry"].tableName,
  },
})

/**
 * `0195`. THE SSR COMPUTE READS T3, AND ONLY QUERIES IT.
 *
 * `/api/runs/latest` answers "where did my last run go" from the `byUserAndStart` index. This
 * is the same shape as the S3 delivery grant D-228 records for `/api/fog`: the browser's whole
 * reach into T3 is this one action, on this one table, and the route re-derives the partition
 * key from the verified session so a caller can only ever read their own rows.
 *
 * `dynamodb:Query` ALONE, and deliberately not `grantReadData` — which would add `GetItem`,
 * `BatchGetItem` and `Scan`. A `Scan` on T3 is every activity of every user in one call, which
 * is precisely what the per-user partition key exists to make impossible; handing it to the
 * public-facing compute role to save one line is the trap the comment at the CDK grants above
 * warns about ("EVERY GRANT BELOW IS AN EXPLICIT ACTION LIST").
 *
 * THE SECOND RESOURCE IS NOT OPTIONAL. A GSI is a separate ARN — `<table>/index/*` — and a
 * grant naming only the table authorises a query of the base table and fails, at runtime and
 * only in a deploy, on every query that names an index. `grantReadData` would have covered it
 * for free, which is exactly how this is normally discovered the expensive way.
 */
computeRole.addToPrincipalPolicy(
  new PolicyStatement({
    sid: "QueryActivityForLatestRun",
    actions: ["dynamodb:Query"],
    resources: [activityTable.tableArn, `${activityTable.tableArn}/index/*`],
  }),
)

/**
 * `0081`, D-296. THE SSR COMPUTE QUERIES T4's `byUserAndSeq`, AND NOTHING ELSE ON T4.
 *
 * Beat 2's tally needs each skill's XP as of the run being shown — the sum of the ledger rows ahead
 * of it in replay order (`lib/runs/tally-server.ts`). `dynamodb:Query` on that ONE index ARN: not the
 * base table, not `Scan`, not `GetItem`, for the reasons the T3 grant above gives. The partition key
 * is the session's `sub`, re-derived on the server, so this reads the caller's own ledger only.
 * The browser's other T4 reads go through AppSync's owner rule and are unchanged.
 */
computeRole.addToPrincipalPolicy(
  new PolicyStatement({
    sid: "QueryXpLedgerByUserAndSeqForRunTally",
    actions: ["dynamodb:Query"],
    resources: [`${backend.data.resources.tables["XpLedgerEntry"].tableArn}/index/byUserAndSeq`],
  }),
)

/** The Sync action is the only producer today. It sends; it never receives. */
activityIngestQueue.grantSendMessages(computeRole)

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE ALARM  (ticket 0044, 01-architecture.md §4 "Failure handling")
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * §4 is unusually specific and it is worth quoting rather than paraphrasing: *"A
 * CloudWatch alarm on `ApproximateNumberOfMessagesVisible > 0` on the DLQ is the only
 * alarm this app needs."*
 *
 * THE WORD DOING THE WORK IS "ONLY". `09-roadmap.md` §8.6 is the Habitica risk turned
 * inward — a system that nags stops being read — and at three to five runs a week an
 * alarm on Lambda errors or duration fires on cold starts and network blips until the
 * operator filters the sender. The DLQ is the one signal that is never noise: a message
 * is here if and only if an activity failed three deliveries, and on a map that cannot
 * re-fog (D-020) that is ground permanently missing until someone acts. Do not add a
 * second alarm without deleting a sentence from §4 first.
 *
 * Ticket 0095 did exactly that: §4 now names two, and the second (the reconcile sweep's,
 * at the bottom of this file) shares this topic. It is the same kind of signal — never
 * noise on a healthy system — for a failure the DLQ cannot see.
 */
const ingestAlarms = new Topic(ingestStack, "IngestAlarms", {
  displayName: "Lost Soles ingest",
})

/**
 * EMAIL, AND IT COSTS ONE CLICK ONCE. SNS sends a confirmation request on first deploy
 * and delivers nothing until it is accepted, so an unconfirmed subscription is a silent
 * alarm — which is the exact failure this ticket exists to end. The close records
 * confirming it as an operator step for that reason.
 *
 * THE ADDRESS IS IN SOURCE, deliberately, on the same argument `lib/auth/owner.ts` makes
 * for the Cognito sub: it is an identifier, not a credential, the repository is private,
 * and it already appears in `docs/capabilities/02-deploy-and-auth.md` and ticket 0014.
 * Routing it through SSM would add a parameter that must exist before a deploy succeeds,
 * in exchange for hiding something already written down twice.
 */
ingestAlarms.addSubscription(new EmailSubscription("amazingbrandon@gmail.com"))

/**
 * THE ALARM NAME IS THE PRODUCT SURFACE, which is a strange sentence until you read one
 * of these on a phone. SNS renders a CloudWatch alarm as `ALARM: "<name>" in <region>`,
 * so the name is the entire subject line and the whole of what the operator sees before
 * deciding whether to open it. A generated name would identify the CloudFormation stack;
 * this one identifies the app and the problem.
 *
 * AN EXPLICIT NAME IS ACCOUNT-AND-REGION UNIQUE, the same cost the four named tables
 * carry — but it adds nothing new here: `LostSolesIngestReceipt` already prevents an
 * `ampx sandbox` deploy from coexisting with the `main` branch's stack, and that is
 * recorded in the capability doc.
 */
const dlqNotEmpty = new Alarm(ingestStack, "IngestDlqNotEmpty", {
  alarmName: "Lost Soles — an activity failed to import",
  alarmDescription:
    "A message reached the ingest dead letter queue, which means an activity failed " +
    "three delivery attempts and is not on the map. The map cannot re-fog (D-020), so " +
    "this does not resolve itself. Runbook: docs/capabilities/06-ingest-pipeline.md.",
  /**
   * `Maximum` OVER ONE MINUTE, not `Average` and not five. A DLQ that holds one message
   * for ten minutes averages down toward zero over a long period and can fail to breach
   * a threshold of zero; the maximum of a queue depth is the only statistic that means
   * "something was in here".
   */
  metric: activityIngestDlq.metricApproximateNumberOfMessagesVisible({
    period: Duration.minutes(1),
    statistic: "Maximum",
  }),
  threshold: 0,
  comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
  evaluationPeriods: 1,
  datapointsToAlarm: 1,
  /**
   * MISSING IS NOT BREACHING, and this is the setting that decides whether the alarm is
   * usable at all. SQS publishes queue-depth metrics only while the queue is being
   * polled, so a DLQ that has been empty for a week emits NOTHING — under any other
   * treatment that gap either holds the alarm permanently in INSUFFICIENT_DATA or, with
   * `BREACHING`, emails the operator about a queue that is fine. Both end with the
   * sender filtered, which is the failure §8.6 names.
   */
  treatMissingData: TreatMissingData.NOT_BREACHING,
})

dlqNotEmpty.addAlarmAction(new SnsAction(ingestAlarms))

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BASEMAP TILES BUCKET AND ITS DISTRIBUTION
 * (ticket 0052, D-226, 01-architecture.md §8 Risk 1, inventory row 20)
 *
 * The fifth and last use of the CDK escape hatch. `defineStorage` cannot express
 * this: Amplify Storage is auth-scoped user data behind signed URLs, and these are
 * anonymous public reads by a map library that speaks HTTP Range.
 *
 * WHY IT IS HERE AT ALL, given the ticket said Cloudflare R2. Because the number
 * R2 was chosen against does not survive contact with this app. §8 Risk 1 prices a
 * map-heavy app at 100 GB/month = $15/month, 3-5x the entire D-083 budget. Measured
 * for real in 0052: the Florida extract is 1.1 GB stored, pmtiles range-requests
 * only the tiles in view, and a hard 30-second pan moves 2-6 MB. Forty sessions a
 * month is ~200 MB. That is inside Amplify's own free 15 GB, and past it would bill
 * about $0.15/month. R2 was insurance against a volume one person cannot generate,
 * priced at a second vendor, a long-lived credential outside `devault` (O-005 was a
 * credential leak) and a manual step outside IaC. R5 and §8 always listed S3 + our
 * own CloudFront as rung (b); this is that rung, not a stopgap.
 *
 * THE RULE THAT SURVIVED INTACT: tiles never route through Amplify Hosting, whose
 * egress bills at $0.15/GB. That is what Risk 1 was actually protecting.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const tilesStack = backend.createStack("BasemapTiles")

const tilesBucket = new Bucket(tilesStack, "TilesBucket", {
  /**
   * NAMED EXPLICITLY, with the same trade-off `LostSolesCaptureGuard` above states
   * and for a different reason. Nothing in the app resolves this name — CloudFront
   * reaches the bucket through the origin, and the browser never sees S3 at all.
   * The name is for the OPERATOR: regenerating the extract is `aws s3 cp` against a
   * name a human can type, and a runbook that opens with "first look up the
   * generated bucket name in CloudFormation" is a runbook that stops being followed.
   * It also keeps 01-architecture.md inventory row 20 literally true.
   *
   * THE COST, identical to the table's: the name is globally unique, so an
   * `ampx sandbox` deploy cannot coexist with the `main` branch's stack. Acceptable
   * at one branch and one operator; recorded in the capability doc.
   */
  bucketName: "lost-soles-tiles",
  /**
   * BLOCK ALL PUBLIC ACCESS, which reads backwards against a ticket criterion that
   * said "public-read for the tile prefix only" and is strictly better than it.
   * That criterion was written for R2, where the browser fetches the bucket
   * directly and public-read is the only way in. Here CloudFront is in front, so
   * Origin Access Control below grants exactly one principal — this distribution —
   * read on exactly one prefix. A publicly readable bucket would additionally let
   * anyone bypass the CDN and bill S3 egress at $0.09/GB *outside* CloudFront's
   * always-free tier, which is the one cost this whole decision exists to avoid.
   */
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  /**
   * SSE-S3, not the CMK the token table uses. This is a public street map cut from
   * an open planet build — there is nothing here an attacker could not download
   * from build.protomaps.com themselves. A CMK would add key cost and a decrypt
   * grant to protect data that is public by construction.
   */
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  /**
   * DESTROY plus autoDelete, and the reasoning is the CaptureGuard table's exactly:
   * the contents are regenerable in about forty seconds from a command recorded in
   * the capability doc, while an orphaned bucket holding a globally-unique name
   * would block the next deploy with a CREATE_FAILED. Losing tiles costs a
   * re-extract; keeping an orphan costs the name.
   */
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
  /**
   * S3-SIDE CORS, WHICH EXISTS FOR EXACTLY ONE REQUEST: the preflight.
   *
   * An earlier revision of this file argued that bucket CORS was configuration for
   * a request that cannot happen, since the browser only ever talks to CloudFront.
   * That was WRONG, and 0052's smoke test caught it. `OPTIONS` is forwarded to the
   * origin, and a bucket with no CORS configuration answers it `403` — whereupon the
   * response headers policy below cheerfully decorates that 403 with correct-looking
   * CORS headers. A browser rejects any preflight that is not 2xx, so the headers
   * being right is worth nothing.
   *
   * It survives today only because `Range` with a simple `bytes=a-b` value is a
   * CORS-safelisted request header, so pmtiles does not normally preflight at all.
   * That is a property of the Fetch spec, not of this app, and "works until someone
   * adds a header" is the shape of the desktop-works/phone-fails bug 0052's
   * Description warns about.
   */
  cors: [
    {
      allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
      allowedOrigins: [
        "https://soles.devaultsecurity.com",
        "https://main.d14fhvl4rp79nn.amplifyapp.com",
        "http://localhost:3000",
      ],
      allowedHeaders: ["Range", "If-Match", "If-None-Match"],
      exposedHeaders: ["Content-Length", "Content-Range", "ETag"],
      maxAge: 3600,
    },
  ],
})

/**
 * The CORS headers the BROWSER actually sees, added by CloudFront to every response.
 * The bucket rule above answers the preflight; this one dresses the GETs, and
 * `originOverride` makes it authoritative when both have an opinion.
 *
 * `Range` is the load-bearing header: pmtiles works by asking for byte ranges of one
 * large archive, so a policy that forgets it produces the exact failure the ticket
 * warns about — tiles that load on desktop and fail on the phone. `Content-Range`,
 * `Content-Length` and `ETag` are exposed because the client reads them back.
 */
const tilesCors = new ResponseHeadersPolicy(tilesStack, "TilesCorsPolicy", {
  responseHeadersPolicyName: "LostSolesTilesCors",
  corsBehavior: {
    accessControlAllowCredentials: false,
    accessControlAllowHeaders: ["Range"],
    accessControlAllowMethods: ["GET", "HEAD", "OPTIONS"],
    /**
     * Restricted rather than `*`. CORS does not stop a determined hotlinker — a
     * non-browser client ignores it entirely — so this is a low fence, not a wall.
     * It is still worth having, because casual embedding by someone else's web page
     * is the one hotlinking shape it DOES stop, and egress is the entire cost story
     * of this bucket. Preview branches are deliberately absent: a PR preview that
     * cannot draw a basemap is a cheap failure, and widening this list to a wildcard
     * subdomain would undo the point of having it.
     */
    accessControlAllowOrigins: [
      "https://soles.devaultsecurity.com",
      "https://main.d14fhvl4rp79nn.amplifyapp.com",
      "http://localhost:3000",
    ],
    accessControlExposeHeaders: ["Content-Length", "Content-Range", "ETag"],
    accessControlMaxAge: Duration.hours(1),
    originOverride: true,
  },
})

const tilesDistribution = new Distribution(tilesStack, "TilesDistribution", {
  comment: "Lost Soles pmtiles basemap (ticket 0052, D-226)",
  defaultBehavior: {
    /**
     * Origin Access Control, scoped to the tile prefix by the bucket policy CDK
     * generates from it. The bucket has no other reader.
     */
    origin: S3BucketOrigin.withOriginAccessControl(tilesBucket, {
      originPath: "/tiles",
    }),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    /**
     * GET and HEAD only. Nothing about a basemap is writable, and the app holds no
     * credential that could write here — uploads are an operator action from the
     * CLI against the bucket, never through the distribution.
     */
    allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
    /**
     * CACHING_OPTIMIZED, and the archive key carries its source build date
     * (`basemap-YYYYMMDD.pmtiles`) so the object is immutable for its whole life.
     *
     * THIS IS NOT COSMETIC. Replacing an archive in place under a stable key is a
     * genuine correctness bug with pmtiles, not just a staleness annoyance: a client
     * that has cached the directory of the old archive and then reads byte ranges
     * served from the new one gets coherent-looking garbage. A dated key makes that
     * unrepresentable, at the price of a one-line config change per re-extract.
     */
    cachePolicy: CachePolicy.CACHING_OPTIMIZED,
    responseHeadersPolicy: tilesCors,
    /**
     * Forwards `Origin` and the two `Access-Control-Request-*` headers to S3, which
     * is what lets the bucket rule above see a preflight at all. Without it
     * CloudFront strips them and S3 answers 403 no matter how the bucket is
     * configured. Not part of the cache key, so it does not fragment the cache.
     */
    originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
    compress: false, // pmtiles bodies are already gzipped per tile; re-compressing spends CPU to add bytes
  },
  httpVersion: HttpVersion.HTTP2_AND_3,
  /**
   * PRICE_CLASS_100 (North America + Europe). The operator runs in Florida and this
   * is a single-user app; paying for Asia-Pacific and South America edges would buy
   * latency for nobody. Reversible in one line if that ever stops being true.
   */
  priceClass: PriceClass.PRICE_CLASS_100,
  /**
   * NO custom domain, and this is deliberate rather than unfinished. A
   * `*.cloudfront.net` name needs no ACM certificate and no Route 53 record, which
   * keeps this ticket clear of the retired S3/CloudFront/ACM architecture whose
   * teardown R5 (lines 142, 354) records as UNVERIFIED and names as the precondition
   * for CNAMEAlreadyExistsException. Nobody types this hostname; it lives in one
   * config module and is read by a map library.
   */
})

backend.addOutput({
  custom: {
    /**
     * Read by `lib/basemap.ts`, which is the single place the app knows where tiles
     * come from. Capability 15's parchment fork changes the style there and nothing
     * else — that is why the URL is a config value and not a literal in a component.
     */
    basemapTilesUrl: `https://${tilesDistribution.distributionDomainName}`,
    basemapDistributionId: tilesDistribution.distributionId,
  },
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE `logWorkout` RESOLVER  (ticket 0069, `02` §2.11)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It runs `processActivity`, so it needs what the worker's MANUAL path touches and nothing
 * more. What it is deliberately NOT granted, and why each absence is a statement:
 *
 *   - `ExploredCell` and the explored blobs' write: a manual log has no trace, so it projects
 *     no cells and publishes no generation (I-27). If a change ever made it try, the call
 *     should fail loudly here rather than quietly reveal ground from a pushup.
 *   - `SourceAccount`, its key, SSM: it has no credentials to read.
 *   - SQS: it is synchronous; there is no queue between the user and the pipeline.
 *
 * Every grant is an explicit action list, for the worker's reason above.
 */
const logWorkoutLambda = backend.logWorkoutFunction.resources.lambda

/** `PutItem` for the accept gate (`acceptIngest`), which the worker never runs — Sync does, for it. */
ingestReceiptTable.grant(logWorkoutLambda, "dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem")
activityTable.grant(logWorkoutLambda, "dynamodb:PutItem", "dynamodb:GetItem")
logWorkoutLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [`${activityTable.tableArn}/index/byUserAndDedupe`, `${xpLedgerTable.tableArn}/index/byActivity`],
  }),
)
xpLedgerTable.grant(logWorkoutLambda, "dynamodb:PutItem")
skillStateTable.grant(logWorkoutLambda, "dynamodb:UpdateItem", "dynamodb:Query")
profileTable.grant(logWorkoutLambda, "dynamodb:UpdateItem", "dynamodb:GetItem")
landmarkTable.grant(logWorkoutLambda, "dynamodb:UpdateItem")
logWorkoutLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "WriteAndReadRawArchive",
    actions: ["s3:PutObject", "s3:GetObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("raw/*")],
  }),
)
/**
 * `0243`. `processActivity` looks for an operator's kind correction beside the archive (D-284) on
 * every activity, a manual log included, and a missing correction is answered by a LIST: without
 * `s3:ListBucket` S3 answers a GET on an absent key with 403 rather than 404, and the log fails.
 * Scoped by prefix to `raw/*`, as the worker's `ListOwnPrefixes` is.
 */
logWorkoutLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ListRawArchive",
    actions: ["s3:ListBucket"],
    resources: [backend.storage.resources.bucket.bucketArn],
    conditions: { StringLike: { "s3:prefix": ["raw/*"] } },
  }),
)
/** The skill-state snapshot reads the manifest for its generation stamp; it never writes there. */
logWorkoutLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ReadExploredManifest",
    actions: ["s3:GetObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("users/*")],
  }),
)
logWorkoutLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "WriteSkillStateSnapshots",
    actions: ["s3:PutObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("snapshots/skillstate/*")],
  }),
)

backend.logWorkoutFunction.addEnvironment("ACTIVITY_TABLE", activityTable.tableName)
backend.logWorkoutFunction.addEnvironment("XP_LEDGER_TABLE", xpLedgerTable.tableName)
backend.logWorkoutFunction.addEnvironment("SKILL_STATE_TABLE", skillStateTable.tableName)
backend.logWorkoutFunction.addEnvironment("PROFILE_TABLE", profileTable.tableName)
backend.logWorkoutFunction.addEnvironment("LANDMARK_TABLE", landmarkTable.tableName)
backend.logWorkoutFunction.addEnvironment("USER_DATA_BUCKET", backend.storage.resources.bucket.bucketName)

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE `setActivityKind` RESOLVER  (ticket 0244, D-284, D-285)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * It runs `rescoreKind` for one activity, so it needs what that function touches and nothing
 * more. Explicit action lists, as everywhere above. What it holds that `logWorkout` does not, and
 * why each is narrow:
 *
 *   - `XpLedgerEntry` `DeleteItem`: D-142's re-score takes the activity's own non-floor rows out
 *     before writing the new kind's. Every delete is conditioned `isFloor = false` at the table
 *     (I-18), and a skill that would lose XP keeps it as a `retained_floor` (D-135). The replay
 *     job holds the same action for the same reason.
 *   - `Activity` `UpdateItem`: the T3 mirror (`kind`, `derivedKind`, `kindOverride`), conditioned
 *     on the kind it was read with. Never `DeleteItem`.
 *   - `Profile` `ConditionCheckItem`: the replay guard when no XP moves.
 *   - `ExploredCell` and `users/*`: only when the new kind reveals ground and the old did not
 *     (D-284 c). The worker's exact cell grants — `UpdateItem` and `BatchGetItem`, no delete, no
 *     put (I-7, I-8) — and its delivery-layer grants, delta expiry included.
 *
 * Absent: SQS, SSM, `SourceAccount`, the receipt table, the snapshot prefix. A kind correction
 * fetches nothing from a source and accepts no ingest.
 */
const setActivityKindLambda = backend.setActivityKindFunction.resources.lambda

activityTable.grant(setActivityKindLambda, "dynamodb:GetItem", "dynamodb:UpdateItem")
xpLedgerTable.grant(setActivityKindLambda, "dynamodb:PutItem", "dynamodb:DeleteItem")
setActivityKindLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["dynamodb:Query"],
    resources: [`${xpLedgerTable.tableArn}/index/byActivity`],
  }),
)
skillStateTable.grant(setActivityKindLambda, "dynamodb:UpdateItem", "dynamodb:Query")
profileTable.grant(setActivityKindLambda, "dynamodb:UpdateItem", "dynamodb:GetItem", "dynamodb:ConditionCheckItem")
landmarkTable.grant(setActivityKindLambda, "dynamodb:UpdateItem")
exploredCellTable.grant(setActivityKindLambda, "dynamodb:UpdateItem", "dynamodb:BatchGetItem")
/** The override's PUT (`raw/<uid>/<source>/<externalId>.kind-override/<id>.json`) and the archive's GET. Never delete (I-3). */
setActivityKindLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "WriteAndReadRawArchive",
    actions: ["s3:PutObject", "s3:GetObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("raw/*")],
  }),
)
/** `raw/` for the override's newest-key list; `users/` so a missing blob reads as 404, not 403 (`0192`). */
setActivityKindLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ListOwnPrefixes",
    actions: ["s3:ListBucket"],
    resources: [backend.storage.resources.bucket.bucketArn],
    conditions: { StringLike: { "s3:prefix": ["raw/*", "users/*"] } },
  }),
)
setActivityKindLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "WriteAndReadExploredDeliveryLayer",
    actions: ["s3:PutObject", "s3:GetObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("users/*")],
  }),
)
setActivityKindLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ExpireExploredDeltas",
    actions: ["s3:DeleteObject"],
    resources: [backend.storage.resources.bucket.arnForObjects("users/*/deltas/*")],
  }),
)

backend.setActivityKindFunction.addEnvironment("ACTIVITY_TABLE", activityTable.tableName)
backend.setActivityKindFunction.addEnvironment("XP_LEDGER_TABLE", xpLedgerTable.tableName)
backend.setActivityKindFunction.addEnvironment("SKILL_STATE_TABLE", skillStateTable.tableName)
backend.setActivityKindFunction.addEnvironment("PROFILE_TABLE", profileTable.tableName)
backend.setActivityKindFunction.addEnvironment("LANDMARK_TABLE", landmarkTable.tableName)
backend.setActivityKindFunction.addEnvironment("USER_DATA_BUCKET", backend.storage.resources.bucket.bucketName)

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WEBHOOK  (ticket 0091, 01-architecture.md §2, 08-security-privacy.md §4)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The only unauthenticated, internet-facing surface in the system, so what is MISSING here is
 * the point. A Function URL and not API Gateway (its cost and its hop buy nothing, §4.4); a
 * dedicated Lambda and not a Next.js route (the SSR cold start risks the 2-second deadline and a
 * UI deploy would redeploy it, §4.5); no VPC (D-081).
 *
 * TWO GRANTS, BOTH NARROW, BOTH EXPLICIT ACTION LISTS (§4.5, criterion 7):
 *   - `dynamodb:PutItem` on the receipt table — the conditional accept gate, and nothing else.
 *     Not `grantWriteData`, which adds `UpdateItem`, `DeleteItem` and `BatchWriteItem`.
 *   - `sqs:SendMessage` on the ingest queue. Not `grantSendMessages`, which adds
 *     `GetQueueAttributes` and `GetQueueUrl` this function never calls.
 * And NOTHING on `LostSolesSourceAccount`: the public endpoint can never read a token, by
 * policy, not by discipline. `ingest-webhook-stack.test.ts` asserts all three.
 *
 * THE CALLBACK IS THE RAW FUNCTION URL plus `/api/webhooks/<source>` (ticket 0091 Q2, option A).
 * No custom domain: `soles.devaultsecurity.com` is Amplify Hosting's, and every way of putting
 * this path on it either routes through the SSR compute (forbidden above) or puts our own
 * CloudFront in front of the whole app. The URL is stable for the life of this function's
 * logical id; if it ever changes, ticket 0092's script re-registers the subscription.
 */
const ingestWebhookLambda = backend.ingestWebhook.resources.lambda

/** ESCAPE HATCH (3 of 4). `defineFunction` has no `url` property. */
const ingestWebhookUrl = ingestWebhookLambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
})

ingestWebhookLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "AcceptGatePutReceipt",
    actions: ["dynamodb:PutItem"],
    resources: [ingestReceiptTable.tableArn],
  }),
)
ingestWebhookLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "SendToIngestQueue",
    actions: ["sqs:SendMessage"],
    resources: [activityIngestQueue.queueArn],
  }),
)
backend.ingestWebhook.addEnvironment("INGEST_QUEUE_URL", activityIngestQueue.queueUrl)

/**
 * THE HANDSHAKE'S VERIFY TOKEN, READ ON A GET ONLY (ticket 0286, D-347's fallback). ONE parameter
 * ARN, named — the shared path, where the token lives, and not the branch path `secret()` also
 * tried and missed. Not a path wildcard, for the reason the OAuth grants above give:
 * `/amplify/shared/<app>/*` also covers the client secret and `GITHUB_TICKETS_PAT`.
 *
 * The NAME goes into the environment from the same constant, so the grant and what the handler
 * reads cannot drift apart. A name is not a secret; the value never leaves SSM except into the
 * handler's memory, and only after a GET asks for it (`webhook-secret.ts`). SecureString under the
 * AWS-managed `aws/ssm` key, so no `kms:` grant — the same as every other parameter read here.
 */
const WEBHOOK_VERIFY_TOKEN_PARAMETER = "/amplify/shared/d14fhvl4rp79nn/STRAVA_WEBHOOK_VERIFY_TOKEN"
ingestWebhookLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ReadWebhookVerifyToken",
    actions: ["ssm:GetParameter"],
    resources: [
      `arn:aws:ssm:${backend.ingestWebhook.stack.region}:${backend.ingestWebhook.stack.account}:parameter${WEBHOOK_VERIFY_TOKEN_PARAMETER}`,
    ],
  }),
)
backend.ingestWebhook.addEnvironment("WEBHOOK_SECRET_PARAMETER", WEBHOOK_VERIFY_TOKEN_PARAMETER)

/*
 * ─── COST-DoS DEFENCE  (ticket 0093, 08-security-privacy.md §4.4) ───────────
 *
 * An attacker cannot read anything through this endpoint; they can only spend money, against a
 * $3–5/month budget (D-083). Layered, cheapest first — the code-side layers (method allowlist,
 * 8 KB cap, strict field set, receipt gate) are in the handler and the adapter; these are the
 * infrastructure ones.
 */

/**
 * RESERVED CONCURRENCY: 5. §4.4 calls it the single most important control in the section. It
 * bounds any flood to five concurrent 128 MB invocations and, as important, protects the REST of
 * the account: without it a flood exhausts regional concurrency and throttles `process-activity`
 * and the SSR compute. Excess requests get a 429 from the Function URL — Strava retries those,
 * and the sweep (0095) is the path of record either way.
 *
 * A property on the L1 function, not a new escape hatch: `defineFunction` has no setting for it,
 * and this is the same `cfnResources` override the other functions' tuning would use.
 */
backend.ingestWebhook.resources.cfnResources.cfnFunction.reservedConcurrentExecutions = 5

/**
 * THE FLOOD COUNTER'S ONE ACTION (§4.4 item 6, `owner-rate.ts`). `UpdateItem`, for its atomic
 * `ADD` — and ONLY on keys beginning `rate#`, by `dynamodb:LeadingKeys`. The public endpoint can
 * bump a counter row and can still not modify a receipt: the accept gate stays `PutItem`-only.
 */
ingestWebhookLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "OwnerFloodCounter",
    actions: ["dynamodb:UpdateItem"],
    resources: [ingestReceiptTable.tableArn],
    conditions: { "ForAllValues:StringLike": { "dynamodb:LeadingKeys": ["rate#*"] } },
  }),
)

/**
 * THE FLOOD ALARM. The handler logs `webhook-flood` for every event dropped past 50 an hour for
 * one athlete; a metric filter counts those lines and the alarm emails through the same topic as
 * the DLQ alarm. A TERM match, not a JSON selector, because Lambda's text log format prefixes each
 * line with a timestamp and request id.
 *
 * The second alarm `01-architecture.md` §4 said this app would never need, and §4 now says why it
 * does: it can only fire when something is looping, so it is never the noise §8.6 warns of.
 */
const webhookFloodFilter = new MetricFilter(backend.ingestWebhook.stack, "WebhookOwnerFloodFilter", {
  // Lambda's default group. It exists: the function has logged since 0091 deployed it.
  logGroup: LogGroup.fromLogGroupName(
    backend.ingestWebhook.stack,
    "IngestWebhookLogGroup",
    `/aws/lambda/${ingestWebhookLambda.functionName}`,
  ),
  filterPattern: FilterPattern.allTerms("webhook-flood"),
  metricNamespace: "LostSoles",
  metricName: "WebhookOwnerFlood",
  metricValue: "1",
  defaultValue: 0,
})
const webhookFlood = new Alarm(backend.ingestWebhook.stack, "WebhookOwnerFlood", {
  alarmName: "Lost Soles — the webhook is being flooded",
  alarmDescription:
    "More than 50 webhook events arrived in one hour for one athlete, and the excess is being " +
    "dropped. That is a loop or a replay, not a person running. Nothing is lost — the sweep " +
    "ingests anything real — but check the ingest-webhook logs. 08-security-privacy.md §4.4, §8.4.",
  metric: webhookFloodFilter.metric({ period: Duration.minutes(5), statistic: "Sum" }),
  threshold: 0,
  comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
  evaluationPeriods: 1,
  datapointsToAlarm: 1,
  treatMissingData: TreatMissingData.NOT_BREACHING,
})
webhookFlood.addAlarmAction(new SnsAction(ingestAlarms))

/**
 * SURFACED TWICE, for two readers. `amplify_outputs.json` (`custom.ingestWebhookUrl`) for
 * anything in the app; a plain CloudFormation output on the function's stack for ticket 0092's
 * subscription script and the post-deploy smoke test, which read it with `describe-stacks`.
 * A Function URL is not a secret: Strava has to be told it, and it grants nothing.
 */
backend.addOutput({ custom: { ingestWebhookUrl: ingestWebhookUrl.url } })
new CfnOutput(backend.ingestWebhook.stack, "IngestWebhookUrl", {
  value: ingestWebhookUrl.url,
  description: "Function URL of the public ingest webhook (ticket 0091). Callback = this + api/webhooks/<source>.",
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * `reconcile-sweep` — THE listSince BACKSTOP  (ticket 0095, 03-integrations.md §2.3)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Strava drops a webhook after three failed deliveries, silently and for good. This is the
 * manual Sync's code path (`lib/sources/sync.ts`) on two schedules, so a dropped event is
 * recovered within six hours and nothing depends on the webhook arriving.
 *
 * THE REACH IS THE SYNC'S, on a function role instead of the SSR compute's:
 *   - T7 `GetItem` (the status read, the watermark read, the credential load) and `UpdateItem`
 *     (the watermark advance, and `accessTokenFor`'s lease, rotation and `markNeedsReauth`).
 *     No `Scan`: the users are the owner allowlist, so every row is read by key. No `PutItem`,
 *     no `DeleteItem`.
 *   - The T7 CMK, both halves, for the same reason as the token sweep's: an inline refresh
 *     writes a rotated token back.
 *   - The two OAuth client parameters, named, for that inline refresh.
 *   - The receipt table: `PutItem` (the accept gate) and `GetItem` (`needsEnqueue`'s check
 *     for an accepted-but-never-delivered receipt). Nothing else on it.
 *   - `sqs:SendMessage` on the ingest queue, as the webhook's grant: not
 *     `grantSendMessages`, which adds two actions this function never calls.
 * No `PutMetricData`: the metrics are Embedded Metric Format log lines.
 */
const reconcileLambda = backend.reconcileSweep.resources.lambda
const reconcileStack = backend.reconcileSweep.stack

sourceAccountTable.grant(reconcileLambda, "dynamodb:GetItem", "dynamodb:UpdateItem")
sourceAccountKey.grantEncryptDecrypt(reconcileLambda)
reconcileLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "ReadSourceOAuthClientCredentials",
    actions: ["ssm:GetParameter"],
    resources: [
      `arn:aws:ssm:${reconcileStack.region}:${reconcileStack.account}:parameter/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_ID`,
      `arn:aws:ssm:${reconcileStack.region}:${reconcileStack.account}:parameter/amplify/shared/d14fhvl4rp79nn/STRAVA_CLIENT_SECRET`,
    ],
  }),
)
reconcileLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "AcceptGateReceipt",
    actions: ["dynamodb:PutItem", "dynamodb:GetItem"],
    resources: [ingestReceiptTable.tableArn],
  }),
)
reconcileLambda.addToRolePolicy(
  new PolicyStatement({
    sid: "SendToIngestQueue",
    actions: ["sqs:SendMessage"],
    resources: [activityIngestQueue.queueArn],
  }),
)
backend.reconcileSweep.addEnvironment("INGEST_QUEUE_URL", activityIngestQueue.queueUrl)

/**
 * ESCAPE HATCH (5 of 5). THE NIGHTLY SCHEDULE, carrying `{ "mode": "nightly" }`: the 14-day
 * window. 08:00 UTC (04:00 EDT, 03:00 EST), off the six-hourly grid. MUST MATCH
 * `NIGHTLY_UTC_HOUR` in `lib/sources/reconcile-sweep.ts`; the synth test checks it. A literal
 * here rather than an import, because this file imports no application code.
 */
new Schedule(reconcileLambda, "NightlySchedule", {
  schedule: ScheduleExpression.cron({ minute: "0", hour: "8" }),
  description: "Lost Soles reconcile sweep, nightly 14-day window (ticket 0095)",
  target: new LambdaInvoke(reconcileLambda, {
    input: ScheduleTargetInput.fromObject({ mode: "nightly" }),
  }),
})

/**
 * THE SECOND ALARM, and `01-architecture.md` §4 was amended first, as the DLQ alarm's comment
 * requires. Ticket 0095: *"Silent recovery is good; invisible recovery means a broken webhook
 * can go unnoticed for months."* The DLQ alarm cannot see this failure, because an activity
 * the sweep recovers imports successfully, so it needs its own signal.
 *
 * WHAT IT COUNTS: `SweepEnqueued`, activities the sweep found with no receipt. On a healthy
 * system the webhook put one down first, so the daily sum is 0.
 *
 * TWO DAYS OUT OF THREE, not one day. "More than occasionally" (the ticket): Strava dropping
 * one event is the thing the sweep exists to absorb, and an email for each would be the noise
 * §8.6 warns against. But a threshold on the count WITHIN one day cannot work either: at three
 * to five runs a week most days hold one run at most, so "more than one in a day" would never
 * fire on a webhook that is completely dead. Two recovering days in any three is what a broken
 * webhook looks like at this running cadence, and a single drop never is.
 *
 * The sweep emits the metric on every run, zeros included, so every daily datapoint exists.
 * Missing data (no sweep ran at all) is not breaching: that failure is a Lambda error, not a
 * dropped webhook. Namespace and name MUST MATCH `lib/sources/reconcile-sweep.ts`; the synth
 * test checks them.
 */
const sweepRecovering = new Alarm(ingestStack, "ReconcileSweepRecovering", {
  alarmName: "Lost Soles — the webhook is missing runs",
  alarmDescription:
    "The reconciliation sweep enqueued activities the webhook never delivered, on two of the " +
    "last three days. They were imported, so nothing is lost, but the webhook is not working: " +
    "check the Strava subscription and the ingest-webhook function's logs. Ticket 0095.",
  metric: new Metric({
    namespace: "LostSoles/Reconcile",
    metricName: "SweepEnqueued",
    statistic: "Sum",
    period: Duration.days(1),
  }),
  threshold: 0,
  comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
  evaluationPeriods: 3,
  datapointsToAlarm: 2,
  treatMissingData: TreatMissingData.NOT_BREACHING,
})
sweepRecovering.addAlarmAction(new SnsAction(ingestAlarms))
