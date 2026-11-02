/**
 * The cross-site check for state-changing route handlers. D-471, capability `19-authjs-migration`.
 *
 * The Auth.js session cookie is set on `.devaultsecurity.com`, so every sibling subdomain is
 * same-site and `SameSite=Lax` no longer stops their requests from carrying it. A state-changing
 * route therefore refuses a request whose `Origin` names any other origin. Server actions get the
 * same check from Next.
 *
 * A request with NO `Origin` is not refused here. Browsers send `Origin` on every non-GET fetch and
 * form post, so a forged cross-site request always carries one. Its absence means a non-browser
 * client, which is not CSRF; whether such a client is authenticated is the session check's job.
 */
export const APP_ORIGIN = "https://soles.devaultsecurity.com"

/** `next dev` only. Never honoured in a production build. */
const DEV_ORIGINS: readonly string[] = ["http://localhost:3000"]

export function hasForeignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (origin === null) return false
  if (origin === APP_ORIGIN) return false
  return !(process.env.NODE_ENV !== "production" && DEV_ORIGINS.includes(origin))
}
