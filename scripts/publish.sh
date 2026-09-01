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

MSG="${1:?usage: scripts/publish.sh \"update message\" [channel ...]}"
shift || true

# Which channels. All six by default; naming them narrows it.
#
# The reason to narrow is never convenience — it is that an OTA replaces the JS
# and NOT the binary, so a bundle can reach an install too old to run it. On 1
# Sep the production builds carried expo-clipboard and expo-document-picker and
# the preview APKs did not, and both are imported unguarded: the same bundle was
# safe on one family of installs and fatal on the other. Publishing to the safe
# ones immediately, and holding the rest until a new build or a guard landed,
# was the honest thing to do and there was no way to say it.
CHANNELS=("$@")
if [ ${#CHANNELS[@]} -eq 0 ]; then
  CHANNELS=(production coach-production owner-production preview coach-preview owner-preview)
fi
cd "$(dirname "$0")/.."

# Where the bundling actually happens. Set below to a detached worktree at HEAD
# rather than this directory, so an agent writing a file mid-publish cannot
# reach the thing being bundled at all. The first version of this script only
# ASSERTED the tree was clean, and within minutes of being written it correctly
# refused two of three channels because an agent had written between publishes —
# which left the three apps on different bundles. Refusing is better than
# shipping the wrong thing, and not being reachable is better than refusing.
PUBTREE=""

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

# A worktree needs the dependency tree and the public config to bundle. Both are
# symlinked rather than copied: node_modules is gigabytes, and .env holds the
# EXPO_PUBLIC_* values without which the bundle builds fine and then crashes on
# launch with "supabaseUrl is required" — which is its own hard-won lesson.
make_pubtree() {
  PUBTREE="$(mktemp -d)/tree"
  git worktree add --detach "$PUBTREE" HEAD >/dev/null
  ln -s "$PWD/node_modules" "$PUBTREE/node_modules"
  [ -f .env ] && cp .env "$PUBTREE/.env"
  echo "bundling from a detached worktree at $(git -C "$PUBTREE" rev-parse --short HEAD)"
}

drop_pubtree() {
  [ -n "$PUBTREE" ] && git worktree remove --force "$PUBTREE" >/dev/null 2>&1 || true
}
trap drop_pubtree EXIT

echo "── tree must be a commit before anything else ──"
clean_or_die
echo "at $(git rev-parse --short HEAD)"

echo
echo "── gates ──"
npx tsc -p tsconfig.json --noEmit
npm test >/dev/null
for c in check:tabs check:reads check:numbers check:currency check:contrast \
         check:reachable check:traps check:caps check:catalogue check:native \
         check:roundtrip \
         db:check check:schema; do
  printf '%-20s ' "$c"
  npm run --silent "$c" >/dev/null 2>&1 && echo ok || { echo FAIL; exit 1; }
done

echo
echo "── publish ──"
make_pubtree
# ── Six channels, not three ─────────────────────────────────────────────────
#
# Every OTA before 1 Sep went to the three PRODUCTION channels only, and on
# Android that meant every OTA went nowhere.
#
# The Android artifacts are split by profile: `production*` builds are .aab
# Play Store bundles, which Android cannot install directly, and the only
# installable Android artifacts are the `preview*` APKs. Those APKs listen on
# `preview` / `coach-preview` / `owner-preview`. A channel maps 1:1 to the
# branch of the same name, so an update published to `production` is invisible
# to a device running the `preview` APK — no error, no fallback, nothing. The
# report was "I don't see any of these updates in the android apps", and it was
# exactly true.
#
# Publishing to both is right rather than a workaround: the preview APKs are
# how testers get the Android apps at all, and a tester on a build that can
# never receive an update is a tester reporting bugs that were fixed weeks ago.
#
# --environment production for ALL six deliberately. That flag picks which EAS
# environment's variables are baked in, not which channel is targeted, and
# `production` is the one confirmed to actually hold EXPO_PUBLIC_SUPABASE_URL.
# An empty environment is how a whole evening of updates shipped, crashed on
# launch with "supabaseUrl is required" and rolled back while the publisher
# reported success. Both channel families talk to the same backend.
for ch in "${CHANNELS[@]}"; do
  case "$ch" in
    production|preview)             V=client  ;;
    coach-production|coach-preview) V=trainer ;;
    owner-production|owner-preview) V=owner   ;;
    *) echo "unknown channel: $ch"; exit 1 ;;
  esac
  printf '%-20s ' "$ch"
  # Run FROM the worktree. Nothing an agent does to the working tree between
  # these three publishes can change what is bundled, so all three channels get
  # the same commit — which is the property that failed the first time.
  ( cd "$PUBTREE" && EXPO_PUBLIC_APP_VARIANT="$V" npx eas-cli update \
      --branch "$ch" --message "$MSG" \
      --environment production --non-interactive 2>&1 \
      | grep -oE 'Update group ID +[0-9a-f-]+' | head -1 )
done

echo
echo "published from $(git rev-parse --short HEAD) — and that commit is what the gates ran against."
