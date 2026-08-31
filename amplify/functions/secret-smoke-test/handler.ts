import { createHash } from "node:crypto"

/**
 * Reports whether `secret()` resolved, WITHOUT EVER RETURNING THE VALUE.
 *
 * A smoke test that logs the secret to prove it arrived writes it into
 * CloudWatch, which is a second, un-audited copy of the credential in a store
 * nobody classified as a secret store — the O-005 failure exactly
 * (08-security-privacy.md §7.4). So the proof is: it is present, it is this
 * long, and its SHA-256 starts with these twelve hex characters. Compare that
 * prefix against `sha256sum` of the value you set. Twelve characters is enough
 * to be convinced and far too few to invert.
 *
 * `process.env`, NOT `$amplify/env/secret-smoke-test`. The typed accessor is
 * generated into `.amplify/` by a deploy, and `.amplify/` is gitignored — so the
 * typed import resolves locally and after a deploy but NOT in a fresh clone,
 * which is precisely how `amplify_outputs.json` broke the gate during ticket
 * 0014. `process.env` is untyped and always resolves. Same value, no landmine.
 */
export const handler = async () => {
  const value = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN

  if (!value) {
    // Fail loudly. A smoke test that returns "fine" when the mechanism is broken
    // is worse than no smoke test.
    throw new Error(
      "STRAVA_WEBHOOK_VERIFY_TOKEN is not set. secret() did not resolve — check " +
        "`npx ampx sandbox secret list`, or the branch environment's secrets in " +
        "the Amplify console.",
    )
  }

  return {
    key: "STRAVA_WEBHOOK_VERIFY_TOKEN",
    resolved: true,
    length: value.length,
    sha256Prefix: createHash("sha256").update(value).digest("hex").slice(0, 12),
  }
}
