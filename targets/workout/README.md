# The workout clock on the lock screen — built and compiled

Registered and building. Both targets compile against the iOS 26.5 simulator
SDK:

- `WorkoutActivity` (the widget extension) — **BUILD SUCCEEDED**
- `Repple` (the app, with the native module linked in) — **BUILD SUCCEEDED**

It still **cannot** reach a phone over the air: a Live Activity is a widget
extension, a second binary inside the app, and OTA updates carry JavaScript
only. It ships with the next EAS build.

## Rebuilding it

```bash
npx expo prebuild --platform ios
cd ios && LANG=en_US.UTF-8 pod install        # the locale matters — see below
xcodebuild -workspace ios/Repple.xcworkspace -scheme Repple \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

Build the **`Repple`** scheme, not just `WorkoutActivity`. The widget building
proves only the extension; the native module compiles into the APP, and the
first two green widget builds sat on top of an app that had never linked it.

## Three things that cost time and will again

- **CocoaPods needs a UTF-8 locale.** Without `LANG=en_US.UTF-8` it dies in
  `unicode_normalize` before it reads the Podfile, with a backtrace that says
  nothing about locales until its very first line.
- **The pod must NOT be called `WorkoutActivity`.** That is the widget
  extension's name, and both would emit a `WorkoutActivity.swiftmodule` into the
  same products directory — the app then links whichever landed there, which was
  the extension's. The error blames the wrong thing entirely:
  `compiling for iOS 16.4, but module 'WorkoutActivity' has a minimum deployment
  target of iOS 18.0`. It reads as a deployment-target problem and is a naming
  collision. Hence `WorkoutLiveActivity`.
- **`Attributes.swift` is a SYMLINK,** from the module into the widget's copy.
  ActivityKit matches a running Activity by the attributes TYPE, so both
  binaries must compile the identical declaration. A relative path out of the
  pod root was tried first and is silently ignored — CocoaPods globs
  `source_files` from the podspec's own directory and will not traverse above
  it, so the pod installed cleanly, the file was never compiled, and the app
  failed with `cannot find 'WorkoutAttributes' in scope`.
- **App Groups are not needed.** Prebuild warns the target "may require" them.
  It does not: state reaches the widget through ActivityKit itself, not shared
  storage, so there is no group to create and no entitlement to add to the App
  ID — which matters, because adding one would need an interactive EAS run.

## Why the clock is a date and not a number

Nothing in this app runs while the phone is locked, which is the only time the
widget is on screen. `Text(timerInterval:)` is the system's own counting text —
given a date range, WidgetKit advances it. The same decision `useLiveVitals`
makes in `app/(client)/workouts.tsx`: count from a fact, never from a tick
somebody has to keep delivering.
