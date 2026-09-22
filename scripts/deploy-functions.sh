#!/bin/bash
# ── Deploying an edge function that will actually run ───────────────────────
#
# On 2 Sep `gym-checkout` and `stripe-webhook` were deployed by hand and would
# both have returned 500 on the first gym purchase. Neither the deploy nor any
# gate said so.
#
# Three things went wrong at once, and this script exists because fixing only
# one of them leaves the trap set:
#
#   1 · `check:functions` knew. It is in `check:all`, and a hand-run
#       `npx supabase functions deploy` does not run `check:all`. A gate on a
#       path nobody takes is not a gate.
#
#   2 · The Supabase CLI knew too, and said so, as `WARN: failed to read file:
#       open src/lib/coachMoney: no such file or directory` — six of them,
#       printed ABOVE a cheerful `"message":"Deployed Functions."`. A warning
#       that scrolls past a success line is a warning nobody reads. Here it is
#       a failure.
#
#   3 · `verify_jwt` is per-function and has to be remembered. `stripe-webhook`
#       and `notify-message` are reachable without a JWT by design; deploying
#       either without --no-verify-jwt silently makes them unreachable by
#       Stripe and by the database, and nothing on any screen would say so.
#       The list is below rather than in somebody's head.
#
# It also asks the function whether it boots, because "Deployed Functions." is
# a statement about an upload, not about a module that evaluates.
#
# Usage:  scripts/deploy-functions.sh <name> [name ...]
#         scripts/deploy-functions.sh --all
set -uo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF="${SUPABASE_PROJECT_REF:-phgfwzpkkwdysftlgkoq}"

# Functions Stripe or the database calls without a Supabase JWT. Deploying one
# of these without the flag is the silent breakage described at 3 above.
NO_JWT=("stripe-webhook" "notify-message")

if [ $# -eq 0 ]; then
  echo "usage: scripts/deploy-functions.sh <name> [name ...]   (or --all)" >&2
  exit 1
fi

if [ "${1:-}" = "--all" ]; then
  NAMES=()
  for d in supabase/functions/*/; do
    n="$(basename "$d")"
    [ "${n:0:1}" = "_" ] && continue
    NAMES+=("$n")
  done
else
  NAMES=("$@")
fi

# ── the gate, before anything is uploaded ──────────────────────────────────
echo "── check:functions ──"
if ! npm run --silent check:functions; then
  echo >&2
  echo "REFUSING TO DEPLOY. An import above cannot be resolved by Deno, so the" >&2
  echo "function would upload cleanly and then throw on its first request." >&2
  exit 1
fi
echo

FAILED=()
for name in "${NAMES[@]}"; do
  if [ ! -d "supabase/functions/$name" ]; then
    echo "no such function: $name" >&2; FAILED+=("$name"); continue
  fi

  FLAG=""
  for j in "${NO_JWT[@]}"; do
    [ "$j" = "$name" ] && FLAG="--no-verify-jwt"
  done

  printf '── %s %s\n' "$name" "${FLAG:+($FLAG)}"
  OUT="$(npx supabase functions deploy "$name" --project-ref "$PROJECT_REF" ${FLAG} 2>&1)"

  # Two spellings, because the CLI changed its mind and this script did not
  # notice. It used to print the JSON `{"message":"Deployed Functions."}`; it now
  # prints a human line, `Deployed Functions on project <ref>: <name>`. Matching
  # only the old one meant three functions that deployed perfectly on 4 Sep 2026
  # were reported as DEPLOY FAILED — and, worse, `continue` then skipped the boot
  # check that would have shown them answering. A success detector that matches
  # one release of somebody else's output is a coin toss; match either, and treat
  # neither-matching as the failure it is.
  if ! grep -qE '"message":"Deployed Functions\."|Deployed Functions on project' <<<"$OUT"; then
    echo "$OUT" | grep -vE "PostHog|_tag" | tail -12 >&2
    echo "   DEPLOY FAILED" >&2; FAILED+=("$name"); continue
  fi

  # The warning that scrolled past. An unreadable file here means Deno will not
  # resolve it either — see 2 above.
  if grep -q "failed to read file" <<<"$OUT"; then
    echo "   the CLI could not read a file this function imports:" >&2
    grep "failed to read file" <<<"$OUT" | sed 's/^/     /' >&2
    echo "   That is the same defect check:functions catches, arriving from the" >&2
    echo "   other direction. It is NOT a warning — the module will not resolve." >&2
    FAILED+=("$name"); continue
  fi

  echo "   deployed"
done

echo
echo "── does each one boot? ──"
# `Deployed Functions.` is about an upload. A module that throws while being
# evaluated deploys perfectly well and 500s on the first request, which is
# exactly the failure this whole script exists for. A 4xx here is HEALTHY: it
# means the module evaluated and the function's own guard answered.
if [ -f .env ]; then set -a; . ./.env; set +a; fi
URL="${EXPO_PUBLIC_SUPABASE_URL:-}"
KEY="${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}"

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "   skipped: EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set, so nothing was asked." >&2
else
  for name in "${NAMES[@]}"; do
    case " ${FAILED[*]:-} " in *" $name "*) continue;; esac
    CODE="$(curl -s -o /tmp/.fnprobe -w '%{http_code}' -X POST "$URL/functions/v1/$name" \
      -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
      -H "Content-Type: application/json" -d '{}' || echo 000)"
    # A 5xx is only evidence of a dead module when the platform produced it.
    # A handler that fails CLOSED answers 5xx too — sweep-stale-visits returns
    # 503 {"ok":false,"error":"not configured"} on an unset secret, which is the
    # module having evaluated and done exactly the right thing. Reporting that
    # as a failed deploy is how a guard gets ignored, and an ignored guard is
    # what let the 2 Sep hand-deploys through in the first place. So: a body
    # this repo's own json() helper shaped — an object carrying "ok" — means the
    # handler ran, whatever the status beside it.
    BODY="$(head -c 400 /tmp/.fnprobe)"
    HANDLED=0
    case "$BODY" in *'"ok"'*) HANDLED=1;; esac
    if [ "$CODE" = "000" ]; then
      printf '   %-20s no answer at all\n' "$name" >&2
      echo "     The function could not be reached. Nothing was proved either way." >&2
      FAILED+=("$name")
    elif [ "$CODE" -ge 500 ] 2>/dev/null && [ "$HANDLED" -eq 0 ]; then
      printf '   %-20s HTTP %s  %s\n' "$name" "$CODE" "$BODY" >&2
      echo "     A 5xx that is not the handler's own answer is a module that did not evaluate." >&2
      FAILED+=("$name")
    elif [ "$CODE" -ge 500 ] 2>/dev/null; then
      printf '   %-20s HTTP %s — the handler ran and refused: %s\n' "$name" "$CODE" "$BODY"
      echo "     Deployed and evaluating. That refusal is the function's own, so read it." >&2
    else
      printf '   %-20s HTTP %s — the handler ran and answered\n' "$name" "$CODE"
    fi
  done
fi

echo
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "FAILED: ${FAILED[*]}" >&2
  exit 1
fi
echo "all deployed and answering: ${NAMES[*]}"
