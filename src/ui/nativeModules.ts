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
// expo-audio's own entry point does `requireNativeModule('ExpoAudio')`, which
// THROWS on a binary that predates the dependency rather than returning null.
// Asking here instead means src/ui/sounds.ts can decide it has no audio without
// the question taking the workouts screen down with it.
const AUDIO = 'ExpoAudio';
// expo-clipboard and expo-document-picker do the same thing as expo-audio, and
// they did it to the coach app's HOME TAB. Both entry points are one line —
// `export default requireNativeModule('ExpoClipboard')` — so the throw happens
// while the screen's imports are being evaluated, before any component renders
// and before any `if` anybody writes inside one can run. Three screens imported
// them directly (the coach dashboard and both document screens), and the next
// over-the-air update would have taken all three down on every Android install
// made before the morning those two dependencies landed.
const CLIPBOARD = 'ExpoClipboard';
const DOCUMENT_PICKER = 'ExpoDocumentPicker';
// expo-image is the fourth of these and the widest. Its entry point resolves to
// `requireNativeModule('ExpoImage')`, which THROWS, and src/ui/ExerciseDemo.tsx
// imported it bare — so the throw happened while that module was being
// evaluated, taking down every screen that imports it. That is nine screens
// across all three apps, including the client's workout player and the stretch
// runner, which is to say the app.
//
// It is live, not hypothetical. expo-image entered package.json on 30 Aug; the
// version was last moved to 1.1.0 on 27 Aug, and runtimeVersion follows the
// version. Every binary built 27-29 Aug therefore accepts today's bundle and
// has no ExpoImage in it.
const IMAGE = 'ExpoImage';
// expo-file-system landed on the same day as expo-image and is exposed the same
// way. Only src/ui/injuryDocs.ts reads it, and only to turn a chosen PDF into
// base64 — but that module is imported by app/(client)/injury-doc.tsx, so a
// throw there is the whole screen.
const FILE_SYSTEM = 'ExpoFileSystem';
// expo-web-browser's entry point reaches `requireNativeModule('ExpoWebBrowser')`
// the same way the four above do, so it throws on a binary without it.
//
// It is on scripts/check-native.mjs's SETTLED_IN_EVERY_BINARY list — it entered
// package.json at f0b0e2fb, before any binary now in anybody's pocket was built
// — so a direct import of it is permitted and app/(client)/coach-documents.tsx
// takes that route. The guard is here anyway, and only for the injury document:
// that screen is the one place in the client app where a module-scope throw
// costs somebody access to their own medical records, and the list of settled
// modules "shrinks, it does not grow" — a screen that never joins it can never
// be the reason it has to be re-argued.
const WEB_BROWSER = 'ExpoWebBrowser';

// Not 'ExpoCalendar'. The package registers its native module as `CalendarNext`
// — `requireNativeModule('CalendarNext')` in its own build output — and a probe
// for the wrong name answers "no" on every binary including the ones that have
// it, which would hide the feature for ever with nothing to show why.
const CALENDAR = 'CalendarNext';

export const HAS_NATIVE_VIDEO = requireOptionalNativeModule(VIDEO) != null;
/** Whether the rest timer can make a noise on THIS install. expo-audio landed
 *  after several builds shipped, and on those the sound is simply absent — the
 *  haptic at zero is not, so the timer still announces itself. */
export const HAS_NATIVE_AUDIO = requireOptionalNativeModule(AUDIO) != null;

/**
 * What to tell somebody whose install predates a native module.
 *
 * Names the app store rather than saying "update the app", because on iOS
 * during testing the update is in TestFlight and nowhere else, and "check for
 * updates" sends people to the App Store listing where nothing is waiting.
 */
export const UPDATE_REQUIRED_NOTE =
  'This version of the app was installed before video playback was added, so the player is not in it. Updating to the latest build restores it — there is nothing wrong with the clip itself.';

/** Whether this binary can put text on the clipboard. */
export const HAS_NATIVE_CLIPBOARD = requireOptionalNativeModule(CLIPBOARD) != null;

/** Whether this binary can open the system file picker. */
export const HAS_NATIVE_DOCUMENT_PICKER = requireOptionalNativeModule(DOCUMENT_PICKER) != null;

/**
 * Whether this binary can render an animated image.
 *
 * The fallback is React Native's own <Image>, which is in every binary ever
 * built. On Android it animates WebP and GIF anyway; on iOS it holds the first
 * frame, which reads as a still photograph of the movement rather than as a
 * fault — and a still of the right exercise is a far better answer than a
 * screen that does not open.
 */
export const HAS_NATIVE_IMAGE = requireOptionalNativeModule(IMAGE) != null;

/** Whether this binary can read a file off disk. */
export const HAS_NATIVE_FILE_SYSTEM = requireOptionalNativeModule(FILE_SYSTEM) != null;

/** Whether this binary can open a page WITHOUT handing it to another app. */
export const HAS_NATIVE_WEB_BROWSER = requireOptionalNativeModule(WEB_BROWSER) != null;

/**
 * Whether this binary can read the phone's own calendar.
 *
 * `expo-calendar` was added on 2 Sep, well after the binaries in people's
 * hands, and the version was DELIBERATELY not moved with it. With
 * `runtimeVersion` on the `appVersion` policy, bumping it would have stopped
 * every install already out there receiving any update at all until its owner
 * took a store update — frozen, not broken, but frozen. Guarding the module
 * instead costs one branch and orphans nobody: an older binary answers `false`
 * here, the feature says so in words, and every other thing in the same bundle
 * keeps working.
 *
 * This is the same trade the app already makes for clipboard, document picking,
 * video and audio. It is only worth restating because the alternative looks
 * cheaper right up until the day somebody cannot be reached.
 */
export const HAS_NATIVE_CALENDAR = requireOptionalNativeModule(CALENDAR) != null;

/**
 * The same sentence as UPDATE_REQUIRED_NOTE, for the two modules that landed
 * after it was written. Same shape deliberately: name the missing thing, say a
 * newer build brings it back, and rule out the thing the person would otherwise
 * blame — their link, or their file.
 */
export const CLIPBOARD_UNAVAILABLE_NOTE =
  'This version of the app was installed before copying was added, so it cannot put anything on the clipboard. The link is shown here in full to copy by hand, and updating to the latest build brings the button back.';

export const CALENDAR_UNAVAILABLE_NOTE =
  'This version of the app was installed before reading your phone\u2019s calendar was added, so it cannot see what is already in your diary. Blocking time by hand still works and is unaffected, and updating to the latest build brings this in.';

export const DOCUMENT_PICKER_UNAVAILABLE_NOTE =
  'This version of the app was installed before choosing a file was added, so it cannot open your files. Updating to the latest build restores it — there is nothing wrong with the file itself.';

// Required through try/catch rather than imported, exactly as src/ui/sounds.ts
// requires expo-audio and for the same reason: a bare `import` is evaluated at
// module scope, and on a binary that predates the dependency the throw takes
// down whatever imported it. The probes above already know the answer, so these
// two only ever resolve on a build that has them — the catch is the belt to
// that pair of braces, not a second opinion.
let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { /* not in this build yet */ }

let DocumentPicker: any = null;
try { DocumentPicker = require('expo-document-picker'); } catch { /* not in this build yet */ }

let CalendarMod: any = null;
try { CalendarMod = require('expo-calendar'); } catch { /* not in this build yet */ }

/**
 * expo-calendar, or null on a binary that predates the dependency.
 *
 * Every caller must branch on `HAS_NATIVE_CALENDAR` rather than on this being
 * non-null: `require` succeeding only means the JavaScript is in the bundle,
 * which it always is. Whether the NATIVE half is in the binary is the separate
 * question, and it is the one that decides whether a call throws.
 */
export const deviceCalendar = (): any => (HAS_NATIVE_CALENDAR ? CalendarMod : null);

// Required, not imported, for the reason given at IMAGE above. Exported as the
// component itself so a caller can render it directly; null on a binary without
// it, and every caller must branch on HAS_NATIVE_IMAGE rather than on this.
let ExpoImageComponent: any = null;
try { ExpoImageComponent = require('expo-image')?.Image ?? null; } catch { /* not in this build yet */ }

/** expo-image's <Image>, or null on a binary that predates the dependency. */
export const NativeExpoImage: any = ExpoImageComponent;

let FileSystemModule: any = null;
try { FileSystemModule = require('expo-file-system'); } catch { /* not in this build yet */ }

let WebBrowserModule: any = null;
try { WebBrowserModule = require('expo-web-browser'); } catch { /* not in this build yet */ }

/**
 * Open a URL in a browser sheet that belongs to THIS app.
 *
 * ── Why this is not `Linking.openURL`, and why it matters most here ───────
 *
 * `Linking.openURL` hands the URL to whatever app owns http on the device. That
 * app then has it: in its history, in its recently-closed tabs, and — on iOS
 * with iCloud tabs on, or on Android with a signed-in Chrome — synced to every
 * other device on that account. For a link to a public page that is a shrug.
 * For a member's physiotherapy report it is the report leaving the Face-ID
 * locked app that stores it privately, and landing somewhere they never chose
 * and cannot easily clear.
 *
 * `openBrowserAsync` renders SFSafariViewController on iOS and a Chrome Custom
 * Tab on Android. Both are presented BY this app, over this screen, and are
 * dismissed back into it. `createTask: false` keeps the Android tab out of the
 * recent-apps list, where it would otherwise sit as a separate card showing the
 * document to anybody who picks the phone up; `showInRecents: false` says the
 * same thing to the older API level.
 *
 * Returns whether it opened. Reported rather than assumed, for the reason
 * `copyToClipboard` above gives: the caller has a sentence to show if it did
 * not, and silently doing nothing reads as the tap having missed.
 */
export async function openInAppBrowser(url: string): Promise<boolean> {
  if (!HAS_NATIVE_WEB_BROWSER || !WebBrowserModule?.openBrowserAsync) return false;
  try {
    await WebBrowserModule.openBrowserAsync(url, {
      createTask: false,
      showInRecents: false,
      // No reader mode: it re-renders the page as article text, which for a
      // scanned report is either nothing or a mangled half of it.
      readerMode: false,
      dismissButtonStyle: 'close',
    });
    return true;
  } catch {
    return false;
  }
}

/** What to tell somebody whose install predates expo-web-browser.
 *
 *  It is on check-native.mjs's settled list, so no install in circulation can
 *  actually reach this — the sentence exists so the branch has one rather than
 *  falling through to the system browser, which is the whole thing the caller
 *  is avoiding. */
export const IN_APP_BROWSER_UNAVAILABLE_NOTE =
  'This version of the app cannot open a document without handing it to your web browser, and this one is too private for that. Updating to the latest build opens it inside the app instead.';

/**
 * A file's bytes as base64, or null when this binary cannot read files.
 *
 * Null rather than a throw, and separate from a read that failed, because the
 * caller has a different sentence for each: one asks for a different file, and
 * the other cannot be solved by choosing one.
 */
export async function readFileBase64(uri: string): Promise<string | null> {
  if (!HAS_NATIVE_FILE_SYSTEM || !FileSystemModule?.readAsStringAsync) return null;
  return FileSystemModule.readAsStringAsync(uri, { encoding: 'base64' });
}

/** What to tell somebody whose install predates expo-file-system. */
export const FILE_READ_UNAVAILABLE_NOTE =
  'This version of the app was installed before reading a PDF was added, so it cannot open one. Photograph the page instead, or update to the latest build.';

/**
 * Put text on the clipboard, and say whether it actually landed there.
 *
 * Reported rather than assumed, and that is the whole point of the return
 * value. "Copied" is a sentence somebody ACTS on — they go to Instagram and
 * press paste — so claiming it against a binary with no clipboard costs them
 * the post, not just the copy. src/lib/social.ts has carried this reasoning for
 * its caption copy since before either of these screens existed.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!HAS_NATIVE_CLIPBOARD || !Clipboard?.setStringAsync) return false;
  try { await Clipboard.setStringAsync(text); return true; } catch { return false; }
}

/** One file, as much of it as any caller here needs. */
export interface PickedDocument {
  uri: string;
  name: string;
  mimeType: string | null;
  size: number | null;
}

/**
 * What came back from the picker — four answers, not two.
 *
 * `unavailable` is separate from `cancelled` because they are opposite facts
 * about the same silent screen. A caller that folds them together shows nothing
 * either way, and the person who tapped Choose a File on a build that has no
 * picker concludes their tap missed and taps again.
 */
export type DocumentPick =
  | { outcome: 'picked'; file: PickedDocument }
  | { outcome: 'cancelled' }
  | { outcome: 'unavailable' }
  | { outcome: 'error'; error: unknown };

/**
 * Open the system file picker.
 *
 * `type` is passed through unchanged — each screen knows what it can read and
 * this is not the place to have an opinion about it. `copyToCacheDirectory` is
 * not optional here: both callers immediately fetch the URI to get the bytes,
 * and a content:// URI on Android that has not been copied is not readable by
 * the time they do.
 */
export async function pickDocument(opts: { type: string | string[]; multiple?: boolean }): Promise<DocumentPick> {
  if (!HAS_NATIVE_DOCUMENT_PICKER || !DocumentPicker?.getDocumentAsync) return { outcome: 'unavailable' };
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: opts.type,
      copyToCacheDirectory: true,
      multiple: opts.multiple ?? false,
    });
    const a = res?.assets?.[0];
    if (res?.canceled || !a) return { outcome: 'cancelled' };
    return {
      outcome: 'picked',
      file: { uri: a.uri, name: a.name ?? '', mimeType: a.mimeType ?? null, size: a.size ?? null },
    };
  } catch (error) {
    return { outcome: 'error', error };
  }
}
