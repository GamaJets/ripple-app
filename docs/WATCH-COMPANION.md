# Apple Watch companion: feasibility, design and what's blocking

## Verdict

**Feasible in this repo, but not safe to switch on in one PR.** This PR is a
scaffold plus a design. It doesn't change any build.

Repple already uses `@bacons/apple-targets` (it builds the `WorkoutActivity`
Live Activity in `targets/workout`), and that plugin supports `type: 'watch'`.
So a watchOS app can be declared in the repo and survive `expo prebuild`, the
same way the Live Activity does. What blocks shipping it today:

1. **Signing.** A watch app is a new bundle id (`<app id>.watchkitapp`) for
   each of the three app variants that want it. It needs an App ID and a
   provisioning profile. EAS can create them, but only in an interactive
   `eas credentials` / `eas build` run with Apple access. Our non-interactive
   production builds would fail on the first build that includes the target.
   **The user must run that once, or approve doing it.**
2. **No watchOS toolchain here.** The box is Linux and the Swift can't be
   compiled or run in a simulator. The Live Activity was proven with
   `xcodebuild` on a Mac (see `targets/workout/README.md`). The watch app needs
   the same proof, on a Mac or in an EAS build, before it goes in a store build.
3. **A phone-side native module.** The phone needs a small WatchConnectivity
   bridge: `WCSession` on iOS, sending `updateApplicationContext` for state and
   receiving `transferUserInfo` for set-done. That's a second Expo module next
   to `modules/workout-activity`. It's native code, so it also ships only in a
   new build.

None of this can go over the air: a watch app and a native module are binaries.

## Design (minimal companion)

- **Watch shows:** "Exercise *n* of *N*", the exercise name, "Set *s* of *S*",
  target reps and load (preformatted on the phone in the member's unit), and
  a rest countdown worked out from `restEndsAt`, so the watch counts down
  without the phone.
- **One action:** Complete Set.
- **The phone is the only writer of the log.** The watch sends a `set-done`
  intent with an idempotency key. The phone checks it against what it is
  showing (`setDoneApplies` in `src/lib/watchSync.ts`), then logs it through
  the same path as a tap on the phone, so offline queueing, PR detection and
  rest timers all behave the same. It then pushes the next `state`. A stale or
  duplicate tap is dropped, never logged against the wrong set.
- **Transport:** `updateApplicationContext` (phone → watch, latest state only)
  and `transferUserInfo` (watch → phone, queued and delivered later if the
  phone is out of range).
- **Variants:** client only. Coaches and Studio don't need it.

## Files in this PR

- `src/lib/watchSync.ts` and its test: the versioned message contract and the
  stale/duplicate rule.
- `watch/RepleWatch/`: the SwiftUI app (`index.swift`), the WCSession client
  (`WatchSession.swift`) and the target config. It sits **outside `./targets`
  on purpose**, so no build picks it up.

## Steps to ship it

1. Have the bundle id and profile created (decision 1 above).
2. Add `modules/watch-bridge` (iOS WCSession) and call it from
   `src/ui/WorkoutLogger.tsx`'s `SessionRunner`. Send state on every set or
   exercise change, and handle `set-done` by calling the existing log-a-set
   handler.
3. `git mv watch/RepleWatch targets/watch`, then prebuild and build on a Mac or
   in EAS (for example a `sim-client` profile), and check it on a paired
   simulator.
4. Run a production build and send it to TestFlight.
