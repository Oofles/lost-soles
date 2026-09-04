/**
 * The app's one canonical origin. Ticket 0032.
 *
 * WHY A CONSTANT AND NOT A DERIVED VALUE. Two callers now need it and both are
 * security-load-bearing, which is exactly when a value must stop being copied.
 *
 *   - `/api/tickets/capture` locks CORS to it (§6.4/8), as defence against a future
 *     subdomain landing on `*.devaultsecurity.com` and inheriting a write primitive.
 *   - The OAuth start route builds `redirect_uri` from it. That one is the sharper
 *     case: deriving the redirect from the request's `Host` header would let anyone
 *     who can set that header choose where the provider sends the authorization
 *     code. The redirect URI must be a value the server states, never one the
 *     request suggests — and it must be stable, because the provider matches its
 *     host against the callback domain registered in the app settings.
 *
 * Hard-coded for the same reason `LostSolesCaptureGuard` and the SSM parameter paths
 * are: the SSR compute has no CloudFormation output to read, and a literal both sides
 * can state is the only thing available. Recorded in the capability doc.
 */
export const APP_ORIGIN = "https://soles.devaultsecurity.com"
