#!/bin/bash
# ── Publishing an OTA that is actually the thing you checked ─────────────────
#
# `eas update` bundles the WORKING TREE, not HEAD. On a quiet machine those are
# the same thing and the distinction never comes up. On this one they are not:
# several agents write to this tree at once, and on 1 Sep a bundle went out that
# threw "Property 'deltaLabel' doesn't exist" the moment anybody opened Body
# Trends or the Weekly Report — because an agent was mid-refactor and the import
# had not landed yet.
#
# Preflight had been green. It was green ten minutes earlier, against a
# different tree. A check that ran before an edit is not a check.
#
# So this script refuses to publish anything that is not exactly a commit:
# it re-runs the gates and then asserts the tree is clean IMMEDIATELY before
# each publish, so what ships is the state that passed. If an agent writes a
# file while the gates are running, the tree is dirty at the assert and nothing
# goes out.
#
# Usage:  scripts/publish.sh "the message"
set -euo pipefail

MSG="${1:?usage: scripts/publish.sh \"update message\"}"
cd "$(dirname "$0")/.."

clean_or_die() {
  local dirty
  dirty="$(git status --porcelain)"
  if [ -n "$dirty" ]; then
    echo "REFUSING TO PUBLISH — the working tree is not a commit:"
    echo "$dirty" | head -20
    echo
    echo "eas update bundles the working tree. Commit or stash first, so that"
    echo "what ships is the state the gates were run against."
    exit 1
  fi
}

echo "── tree must be a commit before anything else ──"
clean_or_die
echo "at $(git rev-parse --short HEAD)"

echo
echo "── gates ──"
npx tsc -p tsconfig.json --noEmit
npm test >/dev/null
for c in check:tabs check:reads check:numbers check:currency check:contrast \
         check:reachable check:traps check:caps check:catalogue check:native \
         db:check check:schema; do
  printf '%-20s ' "$c"
  npm run --silent "$c" >/dev/null 2>&1 && echo ok || { echo FAIL; exit 1; }
done

echo
echo "── publish ──"
for ch in production coach-production owner-production; do
  case "$ch" in
    production)       V=client  ;;
    coach-production) V=trainer ;;
    owner-production) V=owner   ;;
  esac
  # Re-asserted per channel rather than once at the top: the three publishes
  # take minutes between them, which is long enough for an agent to write.
  clean_or_die
  printf '%-20s ' "$ch"
  EXPO_PUBLIC_APP_VARIANT="$V" npx eas-cli update \
    --branch "$ch" --message "$MSG" \
    --environment production --non-interactive 2>&1 \
    | grep -oE 'Update group ID +[0-9a-f-]+' | head -1
done

echo
echo "published from $(git rev-parse --short HEAD) — and that commit is what the gates ran against."
