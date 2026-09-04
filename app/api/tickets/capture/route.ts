import { NextResponse } from "next/server"

import { APP_ORIGIN } from "@/lib/app-origin"
import { currentUserId, isOwner } from "@/lib/auth/owner"
import { log } from "@/lib/log"
import {
  BODY_MAX,
  CAPTURE_PRIORITIES,
  CAPTURE_TYPES,
  type CaptureInput,
  derivePath,
  renderCaptureFile,
  TITLE_MAX,
} from "@/lib/tickets/capture-format"
import {
  inboxPathViolation,
  isDerivedPath,
  secretInPayload,
  unknownKeys,
  withCollisionSuffix,
} from "@/lib/tickets/capture-guard"
import {
  claimIdempotencyKey,
  consumeRateBudget,
  recordIdempotentResult,
  releaseIdempotencyKey,
} from "@/lib/tickets/capture-store"
import { createFile, getToken, GithubApiError } from "@/lib/tickets/github"

/**
 * POST /api/tickets/capture — tickets 0018 (the plumbing) and 0019 (the hardening).
 *
 * This is a **write primitive pointed at the source repository**, reachable from a
 * phone. `07-ticketsmith.md` §6.4 and §6.5 are applied here in full, and §6.5's
 * abuse table is this file's test plan.
 *
 * THE ORDER OF THE CHECKS BELOW IS PART OF THE DESIGN, not an accident of writing.
 * Owner authorization runs FIRST, before the body is read, parsed or validated.
 * Validating first would make the endpoint an oracle: a stranger who can tell a
 * 400 "unknown key: path" from a 400 "title too long" has learned the schema, and
 * one who can tell any 400 from a 404 has learned the route exists — which is the
 * exact thing §6.5 spends a 404-instead-of-403 to deny them.
 *
 * NO `export async function PUT/PATCH/DELETE`. Their absence is the control (0018,
 * criterion 6). A route file exporting only POST and OPTIONS returns 405 for
 * everything else by construction, with nothing to misconfigure.
 */

/** SSR, never statically evaluated: this reads SSM and DynamoDB and commits to a repository. */
export const dynamic = "force-dynamic"

type Json = Record<string, unknown>

/**
 * §6.4/8. Locked to the app's own origin.
 *
 * The route is same-origin anyway and the Android capture task (0020) is not a
 * browser, so nothing legitimate depends on this header. It is defence against a
 * FUTURE subdomain mistake — the day something else lands on
 * `*.devaultsecurity.com` and a wildcard would have handed it a write primitive.
 *
 * The literal moved to `lib/app-origin.ts` in 0032, when the OAuth start route
 * became a second caller that must not derive it from a request header.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Credentials": "true",
} as const

/**
 * §6.4/5. The whole-request cap, above and beyond the per-field caps.
 *
 * 8 KB of body plus 200 characters of title cannot reach 16 KB, so this only ever
 * fires on something that is not a well-formed capture: a huge unknown key, deep
 * JSON nesting, or the "endpoint as an exfiltration channel" row of §6.5's table.
 * Checked in BYTES, not characters — `Content-Length` is bytes, and a limit that
 * counted UTF-16 units would be a third larger than it claims for ASCII and wrong
 * in the other direction for emoji.
 */
const REQUEST_MAX_BYTES = 16 * 1024

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}

/** 400s carry a reason; nothing here echoes the submitted value back. */
const badRequest = (reason: string) => json({ error: reason }, 400)

/**
 * §6.5, row 1. **404, not 403.** A 403 confirms the route exists and that the
 * caller merely lacks permission, which is a free finding for anyone poking at the
 * app. Byte-identical to what middleware returns for a signed-out request, so the
 * two cases are indistinguishable from outside.
 */
const notFound = () => json({ error: "not found" }, 404)

/**
 * IN PRODUCTION THIS HANDLER IS NEVER REACHED, and that is fine — but it must be
 * written down, because a test asserting behaviour that cannot occur is worse than
 * no test. Verified against the deployed app on 2026-09-02: an `OPTIONS` to this
 * route returns `404 {"error":"not found"}` from `middleware.ts`.
 *
 * The reason is structural. A CORS preflight NEVER carries credentials — that is in
 * the spec, not a quirk — so the middleware gate always sees it as signed out and
 * 404s it before routing. Nothing legitimate is lost: the app's own POST is
 * same-origin and so is never preflighted, and the Android capture task (0020) is
 * not a browser and does not implement CORS at all.
 *
 * The effect is STRICTER than the CORS policy it implements — a cross-origin caller
 * is refused at the gate rather than by a header — so it is left alone deliberately.
 * Excluding `OPTIONS` from the middleware matcher would make the preflight "work" at
 * the cost of a new unauthenticated path through the gate, which is a real widening
 * bought for no functional gain.
 *
 * Kept, rather than deleted, for the day the gate changes: the correct preflight
 * response should exist in the route that owns the policy, not be re-derived then.
 */
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" },
  })
}

function validate(raw: Json): { ok: true; input: CaptureInput } | { ok: false; reason: string } {
  // §6.4: reject unknown keys, do not strip them. Runs before anything else is
  // read so a body carrying `path` is rejected for CARRYING it, not for whatever
  // else happened to be wrong — which is what criterion 1 actually asserts.
  const extra = unknownKeys(raw)
  if (extra.length > 0) return { ok: false, reason: `unknown key: ${extra.sort().join(", ")}` }

  const { title, body, type, priority, idempotencyKey } = raw

  if (typeof title !== "string") return { ok: false, reason: "title must be a string" }
  // Length is checked BEFORE sanitising. Sanitising first would let a 10,000-character
  // title of control characters pass by collapsing to something short.
  if (title.length < 1 || title.length > TITLE_MAX) {
    return { ok: false, reason: `title must be 1..${TITLE_MAX} characters` }
  }
  if (body !== undefined && typeof body !== "string") {
    return { ok: false, reason: "body must be a string when present" }
  }
  if (typeof body === "string" && body.length > BODY_MAX) {
    return { ok: false, reason: `body must be at most ${BODY_MAX} characters` }
  }
  if (!CAPTURE_TYPES.includes(type as never)) {
    return { ok: false, reason: `type must be one of ${CAPTURE_TYPES.join("|")}` }
  }
  if (!CAPTURE_PRIORITIES.includes(priority as never)) {
    return { ok: false, reason: `priority must be one of ${CAPTURE_PRIORITIES.join("|")}` }
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
    return { ok: false, reason: "idempotencyKey must be a non-empty string" }
  }

  // Ticket 0004's requirement, recorded in 0019's Notes. This endpoint bypasses
  // `.githooks/pre-commit` entirely — it commits through the GitHub API — and
  // GitHub push protection is unavailable on a private repo without Advanced
  // Security. Without this line there is NO secret scanner on this path, and a
  // secret committed and later removed is still in history.
  const secret = secretInPayload(title, typeof body === "string" ? body : undefined)
  if (secret) {
    return {
      ok: false,
      reason: `this capture looks like it contains ${secret}, so it was not committed. Remove it and resend.`,
    }
  }

  return {
    ok: true,
    input: {
      title,
      body: typeof body === "string" ? body : undefined,
      type: type as CaptureInput["type"],
      priority: priority as CaptureInput["priority"],
      idempotencyKey,
    },
  }
}

/**
 * §6.4/2 and §6.4/3 together, applied to one candidate path. Both layers, every
 * time — including on the `-2` collision retry, which is a path this function has
 * not seen before and must not be trusted merely because its parent passed.
 *
 * A violation is a SERVER fault (500), not a client one: the client cannot
 * influence this value, so a path that fails here means `derivePath` is broken,
 * and the honest answer is to say so rather than to write to a fallback.
 */
function pathIsSafe(path: string): boolean {
  if (!isDerivedPath(path)) {
    log.error("derived path failed re-validation", { path })
    return false
  }
  const violation = inboxPathViolation(path)
  if (violation) {
    log.error("derived path failed the prefix guard", { path, violation })
    return false
  }
  return true
}

export async function POST(request: Request) {
  // ── 1. Owner, before anything else (§6.4/1, §6.5 row 1) ──────────────────
  const userId = await currentUserId()
  if (!isOwner(userId)) return notFound()

  // ── 2. Size, before parsing (§6.4/5) ─────────────────────────────────────
  // Content-Length first so an oversized body can be refused without buffering it,
  // then the actual byte count, because the header is client-supplied and a client
  // that lies about it must not thereby skip the check.
  const declared = Number(request.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > REQUEST_MAX_BYTES) {
    return badRequest(`request must be at most ${REQUEST_MAX_BYTES} bytes`)
  }
  const text = await request.text()
  if (Buffer.byteLength(text, "utf8") > REQUEST_MAX_BYTES) {
    return badRequest(`request must be at most ${REQUEST_MAX_BYTES} bytes`)
  }

  // ── 3. Shape (§6.4) ──────────────────────────────────────────────────────
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return badRequest("body must be JSON")
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return badRequest("body must be a JSON object")
  }

  const checked = validate(raw as Json)
  if (!checked.ok) return badRequest(checked.reason)
  const input = checked.input

  // ── 4. Idempotency, before the rate budget (§6.4/9) ──────────────────────
  // This order is load-bearing: a replayed key must NOT spend quota. Otherwise a
  // retry queue doing its job — resending after a timeout it never saw answered —
  // burns the operator's hourly budget on captures that were already committed.
  //
  // Every store call below is inside one try. DynamoDB being unreachable means the
  // guards cannot answer, and a guard that cannot run has not passed (D-176), so
  // the answer is 503 and no commit rather than a commit with the limits switched
  // off. 503 is retryable and 0022's queue is what retries it.
  let claimed = false
  try {
    const claim = await claimIdempotencyKey(userId!, input.idempotencyKey, new Date())
    if (claim.kind === "replay") {
      // The original path and sha, and NO second commit. This is the whole point.
      return json(claim.result, 200)
    }
    if (claim.kind === "in-flight") {
      return json({ error: "a capture with this idempotencyKey is already in flight" }, 409)
    }
    claimed = true

    // ── 5. Rate limits (§6.4/5) ────────────────────────────────────────────
    const budget = await consumeRateBudget(userId!, new Date())
    if (!budget.ok) {
      await releaseIdempotencyKey(userId!, input.idempotencyKey)
      return json({ error: `rate limit exceeded for the current ${budget.window}` }, 429)
    }
  } catch (err) {
    log.error("capture guard store unavailable", {}, err)
    if (claimed) await releaseIdempotencyKey(userId!, input.idempotencyKey)
    return json({ error: "capture temporarily unavailable, retry" }, 503)
  }

  // ── 6. Derive, guard, commit (§6.4/2, /3, /4) ────────────────────────────
  // ONE clock read, shared by the path and the frontmatter, so a capture that
  // straddles a minute boundary cannot disagree with its own filename.
  const now = new Date()
  const path = derivePath(input.title, now)
  const content = renderCaptureFile(input, now)

  if (!pathIsSafe(path)) {
    await releaseIdempotencyKey(userId!, input.idempotencyKey)
    return json({ error: "could not derive a safe path for this title" }, 500)
  }

  try {
    const token = await getToken()
    const result = await commitWithCollisionRetry(path, content, token)
    await recordIdempotentResult(userId!, input.idempotencyKey, result, new Date())
    return json(result, 201)
  } catch (err) {
    // The claim is released so the SAME key can be retried. Without this, one
    // transient GitHub failure would make a note dictated once un-resendable under
    // its own idempotency key for a full 24 hours — turning a recoverable error
    // into permanent loss of the thing the endpoint exists to preserve.
    await releaseIdempotencyKey(userId!, input.idempotencyKey)
    // The note is the user's, dictated once, with no second copy — so a failure is
    // logged loudly rather than swallowed into a generic 500. `log` redacts.
    log.error("capture failed", { path }, err)
    return json({ error: "capture failed" }, 502)
  }
}

/**
 * §6.4/4. Create-only, and on a 422 retry ONCE with `-2`, then fail.
 *
 * A 422 from a `sha`-less create means the path exists. That is a same-minute
 * collision — two captures whose titles slugify identically inside one minute —
 * and not a reason to overwrite. **`-3` is deliberately not attempted.** A third
 * identical title in the same minute is a retry loop or a stuck client, and the
 * §6.5 answer to that is the rate limiter, not an ever-growing suffix; failing
 * cleanly is what criterion 10 asks for.
 *
 * The retry path re-runs BOTH guards on the new name. It is a path the caller has
 * not seen validated, and inheriting trust from its parent is how a validated
 * system acquires an unvalidated corner.
 */
async function commitWithCollisionRetry(path: string, content: string, token: string) {
  const commit = (p: string) =>
    createFile({ path: p, content, message: `capture: ${p.split("/").pop()}`, token })

  try {
    return await commit(path)
  } catch (err) {
    if (!(err instanceof GithubApiError) || err.status !== 422) throw err

    const retry = withCollisionSuffix(path)
    if (!pathIsSafe(retry)) throw err
    log.warn("capture path collided, retrying once with a -2 suffix", { path, retry })
    return await commit(retry)
  }
}
