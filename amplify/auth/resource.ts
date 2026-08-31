import { defineAuth } from "@aws-amplify/backend"

/**
 * Cognito user pool: email sign-in, Essentials tier (ticket 0014).
 *
 * `08-security-privacy.md` §5.1 — two settings carry almost the entire security
 * posture of this application, and **neither of them is expressible here.**
 * `defineAuth` has no `selfSignUpEnabled` and no `allowUnauthenticatedIdentities`
 * option; both are L1 CloudFormation properties reached through the CDK escape
 * hatch in `../backend.ts`. That is where to look, and there is a pointer in both
 * directions so neither half can be edited without seeing the other.
 *
 * DELIBERATELY ABSENT (§5.1, and criterion 3 of ticket 0014):
 * - No `externalProviders`. No Google, Facebook, Apple, SAML or OIDC federation.
 *   A social IdP adds an external trust dependency. Cross-app SSO across
 *   devaultsecurity.com is a real and reasonable want — it is ticket 0129, and it
 *   needs a decision superseding §5.1 before any provider appears in this file.
 * - No `multifactor`. SMS MFA costs real SNS money and is the weakest second
 *   factor available; if a second factor is ever added it is TOTP, which is free.
 *
 * Passkeys (§5.2) are the preferred long-term factor but are explicitly NOT
 * required at the first-usable milestone (`09-roadmap.md` §2.3). Not enabled here
 * so that this ticket does not grow one.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },

  /**
   * Email is the only recovery channel, which makes the owner's inbox the real
   * security boundary of the account (§5.2, stated plainly rather than pretended
   * otherwise). PHONE_WITHOUT_MFA / SMS recovery would reintroduce the SNS cost
   * and the weak factor that §5.1 rejects.
   */
  accountRecovery: "EMAIL_ONLY",
})
