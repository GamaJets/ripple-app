# The workout clock on the lock screen — built, not switched on

Everything here is written and none of it has been COMPILED. It is deliberately
**not registered**, so it cannot break a build until somebody has compiled it.

## To turn it on

Two lines in `app.json`, then a build:

```jsonc
"plugins": [ …, "@bacons/apple-targets" ],
"ios": { "infoPlist": { "NSSupportsLiveActivities": true } }
```

```bash
npx expo prebuild --platform ios
cd ios && LANG=en_US.UTF-8 pod install        # the locale matters — see below
xcodebuild -workspace ios/Repple.xcworkspace -scheme WorkoutActivity \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

If that succeeds, register the plugin and ship it in the next EAS build. It
**cannot** reach a phone over the air: a Live Activity is a widget extension, a
second binary inside the app, and OTA updates carry JavaScript only.

## What was verified, and what was not

- `npx expo prebuild` succeeds and the target lands: `WorkoutActivity` appears
  as a scheme in `Repple.xcworkspace`, and `project.pbxproj` carries it.
- `NSSupportsLiveActivities` reaches the generated `Info.plist`.
- All three Swift files pass `swiftc -parse`.
- **The extension has never been compiled.** `xcodebuild` failed with
  `No space left on device` — the machine had 2.0 GiB free of 460 GiB. That is
  an environment fault, not a code one, and it is why the plugin is left off.

So the Swift is syntactically sound and has not been type-checked against
ActivityKit. Expect to fix something on the first real build.

## Two things that cost time and will again

- **CocoaPods needs a UTF-8 locale.** Without `LANG=en_US.UTF-8` it dies in
  `unicode_normalize` before it reads the Podfile, with a backtrace that says
  nothing about locales until the very first line.
- **App Groups are not needed.** Prebuild warns that the target "may require"
  them. It does not: state reaches the widget through ActivityKit itself, not
  through shared storage, so there is no group to create and no entitlement to
  add to the App ID. That matters because adding one would need an interactive
  EAS run.

## Why the clock is a date and not a number

Nothing in this app runs while the phone is locked, which is the only time the
widget is on screen. `Text(timerInterval:)` is the system's own counting text —
given a date range, WidgetKit advances it. The same decision `useLiveVitals`
makes in `app/(client)/workouts.tsx`: count from a fact, never from a tick
somebody has to keep delivering.
