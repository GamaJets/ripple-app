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

  if ! grep -q '"message":"Deployed Functions."' <<<"$OUT"; then
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
    if [ "$CODE" -ge 500 ] 2>/dev/null || [ "$CODE" = "000" ]; then
      printf '   %-20s HTTP %s  %s\n' "$name" "$CODE" "$(head -c 160 /tmp/.fnprobe)" >&2
      echo "     A 5xx to an empty body is a module that did not evaluate." >&2
      FAILED+=("$name")
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
