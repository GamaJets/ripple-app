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
 * The same sentence as UPDATE_REQUIRED_NOTE, for the two modules that landed
 * after it was written. Same shape deliberately: name the missing thing, say a
 * newer build brings it back, and rule out the thing the person would otherwise
 * blame — their link, or their file.
 */
export const CLIPBOARD_UNAVAILABLE_NOTE =
  'This version of the app was installed before copying was added, so it cannot put anything on the clipboard. The link is shown here in full to copy by hand, and updating to the latest build brings the button back.';

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
