// Whether a native module is actually in THIS binary.
//
// ── The failure this exists to stop ───────────────────────────────────────
//
// A native dependency does not ship in an over-the-air update. Add one, push
// the JavaScript, and every install made before that build has the UI for the
// feature and none of the code — the screens render, the buttons are live, and
// the thing simply does not happen.
//
// It has already happened once here, with expo-video: the library screens
// rendered, a coach could record and upload, a client saw the clip listed, and
// nothing played. There was no error to read, because the code that would have
// errored was not in the binary. docs/LAUNCH-CHECKLIST.md item 6 is the
// process answer — ship a build made after the commit — and this is the
// runtime one, because a process step is a thing a person has to remember and
// somebody is always on an old install anyway.
//
// requireOptionalNativeModule returns null rather than throwing, so asking is
// safe on a binary that does not have it. The answer cannot change while the
// app is running — a binary either contains the module or does not — so it is
// resolved once at import.
import { requireOptionalNativeModule } from 'expo-modules-core';

/** Native module names, as registered on the native side. */
const VIDEO = 'ExpoVideo';

export const HAS_NATIVE_VIDEO = requireOptionalNativeModule(VIDEO) != null;

/**
 * What to tell somebody whose install predates a native module.
 *
 * Names the app store rather than saying "update the app", because on iOS
 * during testing the update is in TestFlight and nowhere else, and "check for
 * updates" sends people to the App Store listing where nothing is waiting.
 */
export const UPDATE_REQUIRED_NOTE =
  'This version of the app was installed before video playback was added, so the player is not in it. Updating to the latest build restores it — there is nothing wrong with the clip itself.';
