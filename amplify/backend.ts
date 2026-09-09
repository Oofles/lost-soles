import { defineBackend } from "@aws-amplify/backend"
import { Duration, RemovalPolicy } from "aws-cdk-lib"
import {
  Alarm,
  ComparisonOperator,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch"
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions"
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
import { processActivity } from "./functions/process-activity/resource"
import { secretSmokeTest } from "./functions/secret-smoke-test/resource"
import { storage } from "./storage/resource"

/**
 * All three resources are wired from the first deploy on purpose (ticket 0012).
 * Each is near-empty; what matters is that the stack deploys and that every later
 * capability extends these rather than introduces them.
 *
 * The CDK escape hatch (01-architecture.md §2) is used in exactly five places
 * later on — machine-only DynamoDB tables, the SQS queue and DLQ, the webhook
 * Function URL, the scheduled token refresh, and the basemap tiles bucket and
 * its CloudFront distribution. The first of those arrives at the bottom of this
 * file in ticket 0019.
 *
 * The fifth was FOUR until ticket 0052. D-226 moved the pmtiles basemap off
 * Cloudflare R2 and into this account, which is what added it; the count is
 * updated here rather than left to drift, because "keep it to these N uses" is
 * only a constraint while N is true.
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
 * sourceAccount". Both cannot hold. This index is the resolution: the webhook is
 * granted `dynamodb:Query` on the INDEX alone, and the index carries KEYS_ONLY.
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
 * normally empty. That is what lets the Sync action ask "did anything fail for this
 * user?" with a Query rather than a Scan — and, more to the point, what keeps the cost
 * of asking a function of how much is currently broken rather than of how many
 * activities have ever been imported.
 *
 * THE NAME IS STATED TWICE, like the table's own, and for the identical reason: the
 * reader is the Sync action on Amplify's SSR compute, which has no CloudFormation output
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
 * downloads `explored-r10.bin` and queries it in memory, so putting T6 behind
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
   * PITR. The only table in this system that carries it, and the reason is that its
   * contents cannot be re-derived from anywhere cheap: the raw traces in S3 CAN rebuild it
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
 * CloudWatch alarm on `ApproximateNumberOfMessagesVisible > 0` here as "the only alarm
 * this app needs" — that alarm is 0044's, and this is the queue it watches.
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
 */
processActivityLambda.addEventSource(
  new SqsEventSource(activityIngestQueue, { batchSize: 1 }),
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
 * `PutItem` ALONE. The transaction writes the row and never reads it back, never updates
 * it in place, and — the one that matters — never deletes it. A source-side delete
 * TOMBSTONES an activity by setting `status`, which is an update this function does not
 * perform either: `aspect_type: "delete"` handling is capability 14's, and it will need
 * its own grant, written where a reviewer can see what it permits.
 */
activityTable.grant(processActivityLambda, "dynamodb:PutItem")

/**
 * THE ARCHIVE. `PutObject` for the write, and `GetObject` because `archive.ts` issues a
 * `HeadObject` on the already-archived path — S3 authorises a HEAD with `s3:GetObject`,
 * so a grant of PutObject alone would fail on exactly the re-delivery path the archive
 * is content-addressed to make cheap.
 *
 * SCOPED TO `raw/*` AND NOTHING ELSE. The same bucket holds `explored-r10.bin` and the
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
  },
})

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
