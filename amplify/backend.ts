import { defineBackend } from "@aws-amplify/backend"

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
 * Function URL, and the scheduled token refresh. None of them are here yet.
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
/** 30 days, sliding: long enough a phone stays signed in between runs, short
 *  enough a stolen device goes stale on its own (§5.3). */
cfnUserPoolClient.refreshTokenValidity = 43200
cfnUserPoolClient.tokenValidityUnits = {
  accessToken: "minutes",
  idToken: "minutes",
  refreshToken: "minutes",
}
