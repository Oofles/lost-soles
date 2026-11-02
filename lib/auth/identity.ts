import { isAllowedEmail } from "@/lib/auth/config"
import { uidForEmail } from "@/lib/auth/owner-ids"

/**
 * An Auth.js session's email -> the Lost Soles uid, or undefined. Ticket 0330, D-471.
 *
 * TWO GATES, BOTH REQUIRED. The email must be on `AUTH_ALLOWED_EMAILS` (the sign-in gate,
 * `school-hub`'s `isAllowedEmail`, which fails closed on an empty list) AND have an
 * `IDENTITIES` entry (the authorization). The session cookie is set on `.devaultsecurity.com`
 * and signed with a secret shared across the domain's apps, so a valid cookie proves only that
 * SOME app on the domain admitted this email. Holding one is not being a user here (D-470).
 *
 * Takes the email, never a uid: the caller passes what the verified session says, and this
 * decides what that is worth (`08` §5.3).
 */
export function authjsUid(email: string | null | undefined): string | undefined {
  if (!isAllowedEmail(email)) return undefined
  return uidForEmail(email)
}
