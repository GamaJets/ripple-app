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

# Scope check:runtime-reach to the channels this run is actually publishing to.
#
# That gate is in check:all, and check:all takes no arguments, so without this
# it would judge all six channels during a run narrowed to one — and refuse the
# publish over five channels nobody was publishing to. Narrowing is the whole
# point of the paragraph above; it must not be the thing that blocks a publish.
export REPPLE_REACH_CHANNELS="${CHANNELS[*]}"

# ── the App Store Connect key, if this machine has one ─────────────────────
#
# `check:testflight` below reads three environment variables. On a developer's
# machine they come from their shell profile; a non-interactive runner — CI, or
# an agent shelling out — sources no profile and would therefore SKIP the one
# check that answers "can anybody install this", silently and with exit 0.
# Skipping is the correct behaviour when there is no key and the wrong
# behaviour when there is one sitting on disk unread.
#
# Guarded, so a clone without the file is untouched. The file lives outside the
# repo and holds a team-wide private key path; nothing here prints it.
if [ -z "${ASC_ISSUER_ID:-}" ] && [ -f "$HOME/.appstoreconnect/env" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.appstoreconnect/env"
fi

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
#
# `npm run check:all` and NOT a list of check:* names typed out here.
#
# There used to be a list here, and it was a different list from preflight's
# and a different list again from .github/workflows/ci.yml's. Nobody chose
# that. Each was extended by whoever added a check and happened to be looking
# at that file, so check:reachable and check:caps ran only at publish,
# check:attribution and check:deltas ran only in preflight, and check:prose and
# check:decimals ran in none of the three despite both existing as scripts.
# Publishing is the last place a divergence like that can be caught and the
# most expensive place to discover one, so this script no longer holds an
# opinion about which gates exist: package.json's `check:all` is the list, and
# the note above it in that file is why.
#
# check:schema is run on top, live rather than --offline. It is the one gate
# that needs credentials — it asks the real database what its columns are — so
# it cannot live in check:all, which CI runs with no keys at all. Publishing is
# exactly when the app and the deployed database must agree: PostgREST rejects
# a whole row for one unknown column, and an OTA carrying a write to a column
# production does not have loses every other field on that row, silently.
npx tsc -p tsconfig.json --noEmit
npm test >/dev/null
npm run check:all
printf '%-20s ' "check:schema"
npm run --silent check:schema >/dev/null 2>&1 && echo ok || { echo FAIL; exit 1; }

echo
echo "── can these channels receive this runtime? ──"
#
# Run by name and NOT only inside check:all, because this is the one gate whose
# answer is about the channels on the command line rather than about the source
# tree, and its per-channel output is worth reading at the moment of publishing.
#
# It exists because of 4 September, and it is worth being exact about how much
# of that it covers: app.json went to 1.3.0, this script published sixteen
# bundles to runtime 1.3.0, and the only live client install was a 1.0.0 build
# because the TestFlight group had never been given a newer one. Every publish
# printed an Update group ID and exited 0.
#
# This gate would have been GREEN through all of it on iOS. Builds 44 and 45
# were finished at 1.3.0 within minutes of the bump. What was missing was not a
# binary, it was that binary being RELEASED TO A TESTER GROUP — App Store
# Connect, an ASC API key this repo does not hold, and a screen no check here
# can read. Submitted and approved is not released. Somebody still has to look.
#
# What it does catch: publishing into the gap between a version bump and a
# build, and a platform where the build never followed. On 7 Sep 2026, with iOS
# green, REPPLE_REACH_PLATFORM=android failed on all three preview channels —
# the APKs, which per the note above are the ONLY installable Android artifacts
# — because none has been built since the bump. Ask it that way before
# believing an Android tester is receiving any of this.
node scripts/check-runtime-reach.mjs "${CHANNELS[@]}"

# ── and can anybody INSTALL it? ────────────────────────────────────────────
#
# The gate above proves a binary exists at this runtime. It then prints the one
# thing it cannot check and tells the reader to check it by eye: whether that
# binary is actually assigned to a TestFlight tester group. "Check it by eye"
# is the instruction that failed sixteen times in a row, because nobody eyeballs
# a thing they believe is fine.
#
# This asks Apple. It needs an App Store Connect API key, and with none
# configured it says so and exits 0 — so a clone with no key publishes exactly
# as it did before, and a machine with one gets the answer. See the script's
# header for the three variables and where they come from.
#
# Once per APP, and only for the apps whose channels are in this run. The three
# variants are three App Store records with three sets of tester groups, and
# they are not in the same state: the first run of this gate found the client's
# external group holding 1.3.0 and the COACH's holding 1.0.0 (build 7), so every
# coach OTA since the version bump has been invisible to every external coach
# tester. A check that looked only at the client app would have passed.
#
# Narrowed with the channels rather than always checking all three, so a
# deliberate `publish.sh "msg" production` is not blocked by the state of an app
# it is not publishing to. The mapping is the same 1:1 one the channel list
# uses, written out because it is two lines and a lookup table nobody can
# misread beats a clever transformation of a string.
#
# Not `&&`-guarded and not backgrounded: a non-zero exit here means what is
# about to be sent cannot reach the people it is for, and that is a reason to
# stop rather than a warning to scroll past.
tf_bundles=()
for ch in "${CHANNELS[@]}"; do
  case "$ch" in
    production|preview)             tf_bundles+=("com.washateria.repple") ;;
    coach-production|coach-preview) tf_bundles+=("com.washateria.repple.coach") ;;
    owner-production|owner-preview) tf_bundles+=("com.washateria.repple.studio") ;;
    # An example-brand or one-off channel names no app this mapping knows. Said
    # rather than skipped in silence: an unchecked channel is exactly what the
    # nine days were.
    *) echo "check:testflight — no bundle id known for channel '$ch'; not checked." ;;
  esac
done
# Deduplicated, because production and preview are the same app.
#
# The length test is not defensive padding. This script runs under `set -u`,
# and `"${tf_bundles[@]}"` on an EMPTY array is an unbound variable there — so a
# publish narrowed to channels this mapping does not know (an example-brand
# channel, say) would abort the whole run with "tf_bundles[@]: unbound
# variable", after the gates had passed and before anything was published. The
# case above already says such a channel is not checked; this is what makes
# that true rather than fatal.
if [ "${#tf_bundles[@]}" -gt 0 ]; then
  while IFS= read -r b; do
    [ -n "$b" ] && node scripts/check-testflight.mjs "$b"
  done < <(printf '%s\n' "${tf_bundles[@]}" | sort -u)
fi

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
PUBFAILED=()
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
  #
  # The output is CAPTURED rather than piped straight into grep. Piping made the
  # pipeline's status grep's, and the subshell's status was never read at all —
  # so a channel that failed to publish printed its name, printed nothing after
  # it, and the script went on to report success. On 2 Sep `owner-preview` did
  # exactly that twice in a row, and the only reason it was caught is that
  # somebody read the channel back afterwards. A publisher that cannot fail is
  # worse than no publisher: this script exists because a green check that ran
  # against something else is not a check, and the same is true of a publish.
  OUT="$( cd "$PUBTREE" && EXPO_PUBLIC_APP_VARIANT="$V" npx eas-cli update \
      --branch "$ch" --message "$MSG" \
      --environment production --non-interactive 2>&1 )"
  RC=$?
  ID="$(printf '%s' "$OUT" | grep -oE 'Update group ID +[0-9a-f-]+' | head -1)"
  if [ $RC -ne 0 ] || [ -z "$ID" ]; then
    echo "PUBLISH FAILED"
    printf '%s\n' "$OUT" | tail -25
    echo
    echo "  $ch was NOT updated. It is still serving whatever it served before."
    PUBFAILED+=("$ch")
  else
    echo "$ID"
  fi
done

if [ ${#PUBFAILED[@]} -gt 0 ]; then
  echo
  echo "FAILED TO PUBLISH: ${PUBFAILED[*]}"
  echo "Those channels are unchanged. Read the error above before retrying."
  exit 1
fi

echo
echo "published from $(git rev-parse --short HEAD) — and that commit is what the gates ran against."
