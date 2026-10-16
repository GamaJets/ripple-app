#!/usr/bin/env bash
# Store screenshots for one app, at every size the stores require.
#
#   STORE_EMAIL=demo@… STORE_PASSWORD=… scripts/store-screenshots.sh client|coach|studio
#
# Needs a Mac with Xcode simulators, Maestro (https://maestro.dev), an Android
# emulator for Play, and a build of the app installed on each device (a
# simulator build, e.g. `eas build --profile sim-coach`, or `npx expo run:ios`).
# It only writes files under store-screenshots/<app>/<size>/. It uploads nothing.
#
# Sizes (portrait):
#   App Store 6.9"  1320x2868  iPhone 16 Pro Max   (required)
#   App Store 6.5"  1284x2778  iPhone 14 Plus      (accepted fallback)
#   App Store 13"   2064x2752  iPad Pro 13-inch    (only if the app ships on iPad)
#   Play phone      1080x1920  Pixel 7 emulator    (min 2, max 8)
set -euo pipefail
app="${1:?client|coach|studio}"
: "${STORE_EMAIL:?set STORE_EMAIL}" "${STORE_PASSWORD:?set STORE_PASSWORD}"
case "$app" in
  client) APP_ID=com.washateria.repple ;;
  coach)  APP_ID=com.washateria.repple.coach ;;
  studio) APP_ID=com.washateria.repple.studio ;;
  *) echo "unknown app $app" >&2; exit 2 ;;
esac
root="$(cd "$(dirname "$0")/.." && pwd)"
flow="$root/.maestro/screenshots/$app.yaml"

shoot_ios() { # simulator-name label width height
  local udid; udid=$(xcrun simctl list devices available | grep -m1 "$1 (" | grep -oE '[0-9A-F-]{36}')
  [ -n "$udid" ] || { echo "no simulator named $1; create it in Xcode" >&2; return 1; }
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl status_bar "$udid" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
  local out="$root/store-screenshots/$app/$2"; mkdir -p "$out"
  maestro --device "$udid" test -e OUT="$out" -e APP_ID="$APP_ID" -e STORE_EMAIL="$STORE_EMAIL" -e STORE_PASSWORD="$STORE_PASSWORD" "$flow"
  for f in "$out"/*.png; do sips -z "$4" "$3" "$f" >/dev/null; done   # exact store pixels
}
shoot_android() {
  local out="$root/store-screenshots/$app/play-phone"; mkdir -p "$out"
  adb shell settings put global sysui_demo_allowed 1 || true
  adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null || true
  maestro test -e OUT="$out" -e APP_ID="$APP_ID" -e STORE_EMAIL="$STORE_EMAIL" -e STORE_PASSWORD="$STORE_PASSWORD" "$flow"
}

shoot_ios "iPhone 16 Pro Max" ios-6.9 1320 2868
shoot_ios "iPhone 14 Plus" ios-6.5 1284 2778
if [ "${WITH_IPAD:-0}" = 1 ]; then shoot_ios "iPad Pro 13-inch (M4)" ipad-13 2064 2752; fi
if command -v adb >/dev/null && adb get-state >/dev/null 2>&1; then shoot_android; else echo "no Android emulator running; skipped Play screenshots"; fi
echo "Wrote store-screenshots/$app/"
