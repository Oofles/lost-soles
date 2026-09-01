import { NextResponse } from "next/server"

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
import { createFile, getToken } from "@/lib/tickets/github"

/**
 * POST /api/tickets/capture — ticket 0018.
 *
 * Closes the D-092 gap: until this exists, a thought at mile six goes into a notes
 * app and gets hand-carried into the repository later, which in practice means it
 * does not. One authenticated POST becomes one new file in `tickets/inbox/` on
 * `main`, and triage turns it into a ticket later (0023).
 *
 * SCOPE. This is the plumbing only. **Ticket 0019 is a hard prerequisite before
 * anything on the phone points at this URL** — owner-only auth (not merely
 * "authenticated"), server-side rate limits, idempotency, reject-unknown-keys, CORS,
 * and the second and third path-validation layers all live there. What exists today:
 *
 *   - the request never reaches this handler unauthenticated, because `middleware.ts`
 *     gates every non-static route and 307s a signed-out request to `/`;
 *   - the path is derived ENTIRELY server-side and no key of the body can influence
 *     it — the property 0019 then double-checks;
 *   - there is no update and no delete path, here or in the GitHub client.
 *
 * NO `export async function PUT/PATCH/DELETE`. Their absence is the control
 * (criterion 6). A route file that exports only POST returns 405 for everything else
 * by construction, with nothing to misconfigure.
 */

/** SSR, never statically evaluated: this reads SSM and commits to a repository. */
export const dynamic = "force-dynamic"

type Json = Record<string, unknown>

/** 400s carry a reason; nothing here echoes the submitted value back. */
function badRequest(reason: string) {
  return NextResponse.json({ error: reason }, { status: 400 })
}

function validate(raw: Json): { ok: true; input: CaptureInput } | { ok: false; reason: string } {
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

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return badRequest("body must be JSON")
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return badRequest("body must be a JSON object")
  }

  const checked = validate(raw as Json)
  if (!checked.ok) return badRequest(checked.reason)

  // ONE clock read, shared by the path and the frontmatter, so a capture that
  // straddles a minute boundary cannot disagree with its own filename.
  const now = new Date()
  const path = derivePath(checked.input.title, now)
  const content = renderCaptureFile(checked.input, now)

  try {
    const token = await getToken()
    const result = await createFile({
      path,
      content,
      message: `capture: ${path.split("/").pop()}`,
      token,
    })
    return NextResponse.json(
      { path: result.path, commitSha: result.commitSha },
      { status: 201 },
    )
  } catch (err) {
    // The note is the user's, dictated once, with no second copy — so a failure is
    // logged loudly rather than swallowed into a generic 500. `log` redacts.
    log.error("capture failed", { path }, err)
    return NextResponse.json({ error: "capture failed" }, { status: 502 })
  }
}
