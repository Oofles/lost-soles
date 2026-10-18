import { createHash, timingSafeEqual } from "node:crypto"

import type { AckResult, InboundRequest } from "../types"

/**
 * THE `hub.challenge` HANDSHAKE. Ticket 0092, `03-integrations.md` §2.3, `08-security-privacy.md`
 * §4.2.
 *
 * When the operator creates the push subscription, Strava — BEFORE its POST returns — sends one
 * GET to the callback:
 *
 *   GET /api/webhooks/strava?hub.mode=subscribe&hub.challenge=X&hub.verify_token=T
 *
 * and the subscription exists only if that GET answers 200, `application/json`, body exactly
 * `{"hub.challenge":"X"}`. The route stays deployed afterwards because Strava may re-validate,
 * but any other GET is a scanner, and gets the same bare 400 as a wrong token.
 *
 * ─── THE KEY HAS A DOT, AND THE BODY IS WRITTEN BY HAND ─────────────────────
 *
 * `hub.challenge`, not `hub_challenge`, not `hubChallenge`. A serializer that "helpfully" maps
 * field names gets this wrong SILENTLY: the handshake just never completes and the create returns
 * no id. So the body is built by string concatenation below, never by `JSON.stringify` of an
 * object, and the tests assert the exact bytes. The webhook handler emits a string body verbatim.
 *
 * ─── THE CHALLENGE IS REFLECTED, SO IT IS NEVER TRUSTED ─────────────────────
 *
 * X is attacker-chosen text echoed into a response: the classic injection shape, even when the
 * sink looks inert. It is accepted only as 1–256 characters of `[A-Za-z0-9]` — which is also what
 * makes concatenating it into a JSON string literal safe, since no character that could end the
 * string or escape from it can pass. Nothing else about it is interpreted.
 *
 * ─── THE TOKEN IS COMPARED IN CONSTANT TIME, AND NEVER LOGGED ───────────────
 *
 * `===` on a public endpoint is a timing oracle. Both sides are hashed to 32 bytes first, so
 * `timingSafeEqual` sees equal lengths and the comparison leaks neither content nor length. T
 * appears in no log line at any level; the one line this writes is a fixed decision word.
 *
 * The expected value is the SecureString `STRAVA_WEBHOOK_VERIFY_TOKEN`, read from SSM by the webhook
 * Lambda ON A GET ONLY, through the `webhookSecret` getter `accept.ts` is handed (ticket 0286,
 * D-347's fallback). It was Amplify's `secret()` until then, which made every cold start — event
 * POSTs included — pay the SSM round trips in init. If it is absent or unreadable the handshake
 * FAILS CLOSED — no token, no subscription.
 */

/**
 * The parameter's leaf name, and the env key a caller with no getter (the tests) reads it from.
 * The deployed function has no such env key: it reads SSM.
 */
export const VERIFY_TOKEN_ENV = "STRAVA_WEBHOOK_VERIFY_TOKEN"

/** §4.2: at most 256 bytes, `[A-Za-z0-9]` only. ASCII, so characters are bytes. */
export const CHALLENGE_PATTERN = /^[A-Za-z0-9]{1,256}$/

export type HandshakeDecision =
  | "handshake-ok"
  | "handshake-not-subscribe"
  | "handshake-unconfigured"
  | "handshake-bad-token"
  | "handshake-bad-challenge"

/** A fixed word, nothing from the request. Never T, never X. */
function logDecision(decision: HandshakeDecision): void {
  console.info(JSON.stringify({ msg: "webhook-handshake", source: "strava", decision }))
}

const sha256 = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest()

/**
 * Constant-time token equality. Hashing first gives both buffers the same length, so
 * `timingSafeEqual` never throws on a length mismatch and its runtime depends on neither input.
 */
export function tokensMatch(supplied: string, expected: string): boolean {
  return timingSafeEqual(sha256(supplied), sha256(expected))
}

/**
 * The exact response body. String concatenation, deliberately: the key must be the literal
 * `hub.challenge`, and `challenge` has already passed `CHALLENGE_PATTERN`, so it cannot contain
 * a quote or a backslash.
 */
export function challengeBody(challenge: string): string {
  if (!CHALLENGE_PATTERN.test(challenge)) throw new Error("challenge failed validation")
  return '{"hub.challenge":"' + challenge + '"}'
}

const REJECT: AckResult = { status: 400, commands: [] }

export function acceptHandshake(
  req: InboundRequest,
  expectedToken: string | undefined = process.env[VERIFY_TOKEN_ENV],
): AckResult {
  const { query } = req
  if (query["hub.mode"] !== "subscribe") {
    logDecision("handshake-not-subscribe")
    return REJECT
  }
  if (typeof expectedToken !== "string" || expectedToken.length === 0) {
    logDecision("handshake-unconfigured")
    return REJECT
  }
  const supplied = query["hub.verify_token"]
  if (typeof supplied !== "string" || !tokensMatch(supplied, expectedToken)) {
    logDecision("handshake-bad-token")
    return REJECT
  }
  const challenge = query["hub.challenge"]
  if (typeof challenge !== "string" || !CHALLENGE_PATTERN.test(challenge)) {
    logDecision("handshake-bad-challenge")
    return REJECT
  }
  logDecision("handshake-ok")
  return { status: 200, body: challengeBody(challenge), commands: [] }
}
