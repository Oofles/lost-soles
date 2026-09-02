#!/bin/sh
# capture.sh — the reference implementation of the Lost Soles quick-capture task.
# Ticket 0020. See docs/capabilities/03-capture-tile.md for the phone build.
#
# WHY THIS EXISTS. The thing that actually runs is a MacroDroid macro (or a Tasker
# task) on a phone, which cannot be unit-tested from a laptop and cannot be read
# in a diff. This script does exactly what that macro must do, in the same order,
# with the same two HTTP calls — so the LOGIC has one written-down, runnable,
# testable definition, and the macro is a transcription of it rather than the only
# copy of it.
#
# It is also the thing to reach for when the tile misbehaves: run this from a
# laptop with the same refresh token, and it tells you whether the problem is the
# phone or the endpoint.
#
#   ./capture.sh "some dictated sentence"
#   ./capture.sh --dry-run "some dictated sentence"     # print the request, send nothing
#
# Environment:
#   LOST_SOLES_REFRESH_TOKEN   required unless --dry-run. The Cognito refresh
#                              token, obtained once by signing in (0149).
#
# NO GITHUB CREDENTIAL IS INVOLVED (§6.1). The phone holds a Cognito refresh token
# and nothing else; the PAT lives in SSM and is read server-side by the endpoint.

set -eu

CLIENT_ID='5vc5e8t2ljv1hg3doau5mp0m00'
COGNITO='https://cognito-idp.us-east-1.amazonaws.com/'
ENDPOINT='https://soles.devaultsecurity.com/api/tickets/capture'

# The endpoint's caps, restated here so a violation is caught on the device rather
# than as a 400 the operator sees as "capture failed" (07-ticketsmith.md §6.4).
TITLE_MAX=200
BODY_MAX=8192

DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi

TEXT="${1:-}"
if [ -z "$TEXT" ]; then
  echo "usage: capture.sh [--dry-run] \"dictated text\"" >&2
  exit 2
fi

# ── JSON string escaping ────────────────────────────────────────────────────
# Hand-rolled because the phone has no jq either, so the macro must do exactly
# this and the two had better agree. Order matters: backslash FIRST, or every
# escape introduced afterwards gets escaped again.
json_escape() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g' \
    | tr -d '\000-\010\013\014\016-\037'
}

# ── Title and body (§6.4, and 0020's "nothing is silently dropped") ─────────
# The title is the first 200 characters; if the dictation ran longer, the FULL
# text goes in the body. It is deliberately not "the remainder" — a title that is
# a truncated sentence plus a body that starts mid-word is harder to read at
# triage than a truncated title above the whole thing.
#
# Counted in characters. The endpoint counts UTF-16 code units, which differ only
# for astral characters (emoji) — speech-to-text does not produce them, and the
# 400 that would result is a clean refusal rather than a silent truncation.
TITLE=$(printf '%s' "$TEXT" | cut -c "1-$TITLE_MAX")
BODY=''
if [ "$(printf '%s' "$TEXT" | wc -m | tr -d ' ')" -gt "$TITLE_MAX" ]; then
  BODY=$(printf '%s' "$TEXT" | cut -c "1-$BODY_MAX")
fi

# ── The idempotency key: generated ONCE, reused on every retry ──────────────
# This is the whole reason 0022's retry queue is safe. A key regenerated per
# attempt turns one dictated note into N committed files the first time the
# network is slow enough to time out after the server already wrote the file.
IDEMPOTENCY_KEY="${LOST_SOLES_IDEMPOTENCY_KEY:-$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)}"

if [ -n "$BODY" ]; then
  PAYLOAD=$(printf '{"title":"%s","body":"%s","type":"feature","priority":"med","idempotencyKey":"%s"}' \
    "$(json_escape "$TITLE")" "$(json_escape "$BODY")" "$IDEMPOTENCY_KEY")
else
  PAYLOAD=$(printf '{"title":"%s","type":"feature","priority":"med","idempotencyKey":"%s"}' \
    "$(json_escape "$TITLE")" "$IDEMPOTENCY_KEY")
fi

if [ "$DRY" -eq 1 ]; then
  printf '%s\n' "$PAYLOAD"
  exit 0
fi

: "${LOST_SOLES_REFRESH_TOKEN:?set LOST_SOLES_REFRESH_TOKEN (see 0149)}"

# ── 1. Refresh token → ID token (D-183) ────────────────────────────────────
# A plain POST. No SigV4, no SDK, no client secret — the app client has none,
# which is what makes this reproducible in a phone automation app at all.
REFRESH_RESPONSE=$(curl -s --max-time 20 -X POST "$COGNITO" \
  -H 'Content-Type: application/x-amz-json-1.1' \
  -H 'X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth' \
  -d "{\"AuthFlow\":\"REFRESH_TOKEN_AUTH\",\"ClientId\":\"$CLIENT_ID\",\"AuthParameters\":{\"REFRESH_TOKEN\":\"$LOST_SOLES_REFRESH_TOKEN\"}}")

ID_TOKEN=$(printf '%s' "$REFRESH_RESPONSE" | sed -n 's/.*"IdToken":"\([^"]*\)".*/\1/p')

if [ -z "$ID_TOKEN" ]; then
  # The refresh token is dead (expired, or revoked). This is NOT retryable and a
  # queue that treats it as retryable will hammer a dead credential forever —
  # 0022 must distinguish this case. Exit 3 says "re-pair the phone".
  echo "REFRESH FAILED — re-pair the phone (0149). Response:" >&2
  printf '%s\n' "$REFRESH_RESPONSE" | head -c 300 >&2
  echo >&2
  exit 3
fi

# ── 2. The capture itself ──────────────────────────────────────────────────
HTTP_BODY_FILE=$(mktemp)
trap 'rm -f "$HTTP_BODY_FILE"' EXIT
STATUS=$(curl -s --max-time 20 -o "$HTTP_BODY_FILE" -w '%{http_code}' -X POST "$ENDPOINT" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD")

case "$STATUS" in
  201|200)
    # 200 is a replay: the key was already committed and the server returned the
    # original result without a second commit. Both are success for the operator.
    echo "captured ($STATUS): $(cat "$HTTP_BODY_FILE")"
    exit 0 ;;
  404)
    echo "REJECTED (404) — the token did not verify, or this account is not the owner." >&2
    exit 4 ;;
  429)
    echo "RATE LIMITED (429) — retry later; the note is not lost, resend the same key." >&2
    exit 5 ;;
  503)
    # D-179: the guards failed closed. Retryable, and the same key is safe.
    echo "UNAVAILABLE (503) — guards could not run. Retry with the SAME idempotency key." >&2
    exit 5 ;;
  *)
    echo "FAILED ($STATUS): $(cat "$HTTP_BODY_FILE")" >&2
    exit 1 ;;
esac
