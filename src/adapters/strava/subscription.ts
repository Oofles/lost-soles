/**
 * OUR PUSH SUBSCRIPTION'S ID. Ticket 0093 (`08-security-privacy.md` §4.1, filter 1).
 *
 * Strava allows exactly one push subscription per application, ever, and every event it sends
 * carries that subscription's `subscription_id`. An event naming any other id did not come from
 * our subscription and is dropped with a 200.
 *
 * It FILTERS NOISE, NOT ATTACKERS. The id is a small integer, guessable and visible to anyone
 * who sees one event. The security property is elsewhere: the payload is a pointer we re-fetch
 * with our own token, never data (§4.1).
 *
 * WHY A COMMITTED CONSTANT, and not SSM or an environment variable: it is an identifier, not a
 * credential (the same argument `owner-map.ts` makes), it changes only when the subscription is
 * deleted and recreated, and a constant has no runtime dependency to fail on a cold start.
 *
 * `null` UNTIL THE SUBSCRIPTION EXISTS. Ticket 0092's script creates it and prints the id, and
 * the id is committed here then. While this is `null` every POST event is dropped, logged as
 * `no-subscription`: that is FAIL-CLOSED and LOSSLESS, because the reconciliation sweep (0095)
 * ingests whatever the webhook did not.
 */
export const STRAVA_SUBSCRIPTION_ID: number | null = null
