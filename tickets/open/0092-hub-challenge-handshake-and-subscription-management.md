---
id: 92
slug: hub-challenge-handshake-and-subscription-management
title: The hub.challenge handshake (the key has a dot) and subscription lifecycle management
type: feature
priority: high
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: [91]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Creating the subscription is a synchronous three-way handshake, and there is **exactly one
subscription per application, ever**.

Creation (`03-integrations.md` §2.3):

```
POST https://www.strava.com/api/v3/push_subscriptions
  client_id, client_secret,
  callback_url=https://soles.devaultsecurity.com/api/webhooks/strava,
  verify_token=<long random string we generate and store>
```

**Before that POST returns**, Strava synchronously issues a GET to `callback_url`:

```
GET ?hub.mode=subscribe&hub.challenge=X&hub.verify_token=T
  → constant-time compare T against secret("STRAVA_WEBHOOK_VERIFY_TOKEN")
  → mismatch: 400, no body detail, no log of T
  → match:    200, Content-Type: application/json, body exactly {"hub.challenge": X}
```

> **TRAP — the JSON key is literally `hub.challenge`, with a dot.** Not `hub_challenge`, not
> `hubChallenge`. **Every serialization framework that maps struct fields to camelCase will get this
> wrong**, and it fails *silently*: the handshake just does not complete and the POST never returns a
> subscription id. `08-security-privacy.md` §4.2 calls it the one that costs an hour. **Emit the
> string by hand** rather than trusting a serializer, and pin it with a test that asserts the exact
> bytes.

Three more rules from §4.2:

- **Constant-time comparison**, not `===`. Cheap, and the alternative is a timing oracle on a public
  endpoint.
- **`hub.challenge` is echoed, never interpreted.** Cap it at 256 bytes, reject anything non
  `[A-Za-z0-9]`, and emit it as a JSON string value. It is attacker-controlled input being reflected,
  which is the classic shape of an injection bug even when the sink looks inert.
- This route is live only during subscription creation. It stays deployed because Strava may
  re-validate, but a GET at any other time is a scanner.

**Subscription management**, as an operator script, not a UI: `GET /push_subscriptions` to inspect,
`DELETE /push_subscriptions/{id}` to remove, and create as above. Store the returned `{"id": 120475}`
so the webhook can filter on `subscription_id` (0093). Because the callback URL is fixed at creation,
**it is permanent infrastructure** — changing it means delete + recreate, and during that window
reconciliation (0095) is the only ingestion path. Note that in the script's output so the operator
knows what they are accepting before they press the key.

## Acceptance criteria

- [ ] A GET with `hub.mode=subscribe` and the correct `hub.verify_token` returns 200,
      `Content-Type: application/json`, and a body whose **exact bytes** are
      `{"hub.challenge":"<X>"}` — asserted on the raw response string, not on a parsed object.
- [ ] A test asserts the response body contains the substring `"hub.challenge"` and does **not**
      contain `hub_challenge` or `hubChallenge`.
- [ ] A wrong `hub.verify_token` returns 400 with no body detail, and the supplied token appears
      nowhere in the logs at any level.
- [ ] The token comparison is constant-time; a test asserts the comparison function is the
      constant-time one and not `===`.
- [ ] A `hub.challenge` longer than 256 bytes or containing any character outside `[A-Za-z0-9]` is
      rejected; a challenge of `"><script>` never reaches the response body.
- [ ] The subscription script can create, inspect and delete the subscription, and stores the
      returned subscription id where the webhook handler reads it.
- [ ] The script prints the permanence warning about `callback_url` before performing a create or
      delete, and requires an explicit confirmation.
- [ ] After a real create against Strava, `GET /push_subscriptions` shows exactly one subscription
      pointing at the production callback URL.
- [ ] `STRAVA_WEBHOOK_VERIFY_TOKEN` is generated with a CSPRNG, stored as an SSM `SecureString`, and
      appears in no repository file — asserted by the secret scan (0002's `.gitignore` and the §7.3
      scanning setup).

## Notes

Depends on 0091 (the function that serves the GET).

Do the handshake against Strava **once, deliberately, from a machine you are watching**, because a
failed create leaves no subscription and a successful one cannot be re-pointed. Test the exact
response bytes locally first; the handshake is not the place to discover a serializer's opinion about
dots in key names.

The GET route being public and unauthenticated is unavoidable: Strava sends no credentials. That is
why `verify_token` plus payload shape is the entire authentication story for this route, and why the
echo is treated as untrusted reflection.

## Operator validation

> **D-181 — most of what follows is the AGENT's to run, not the operator's.**
> Swept 2026-09-02 (ticket `0147`). This ticket's capability has no screen of its own. Before asking
> the operator for any step below, check whether AWS credentials (`AWS_PROFILE=devault`), `curl`, or
> a script can answer it — if so it is a **smoke test**, and what it proved is recorded here at
> close *instead of* the instruction. Keep only what genuinely needs a human eye, a phone, or a real
> run. The text below is the original author's intent, kept as context for **what** to verify — not
> as a list of chores for the operator.

From the desktop, run the subscription script's **inspect** command first and read the output — it
should show either nothing (before creation) or exactly one subscription. Then run create, and watch
the CloudWatch log stream for the incoming GET in real time: you should see the handshake arrive and
be answered within milliseconds, and the POST should return a subscription id.

Before that, prove the trap is closed by hand: `curl -s '<function-url>?hub.mode=subscribe&hub.
challenge=abc123&hub.verify_token=<token>'` and look at the **raw** output with your own eyes. If you
see `hubChallenge` or `hub_challenge` anywhere, stop — that is the hour this note exists to save.

Finally, `curl` the same URL with a deliberately wrong token and confirm you get a bare 400, then
check the logs and confirm the token you sent is not in them.
