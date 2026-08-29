// Asking for the camera or the photo library, and what to do when the answer
// is no.
//
// ── The bug this replaces ──────────────────────────────────────────────────
//
// Eleven screens across the three apps did this:
//
//   const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
//   if (!perm.granted) { Alert.alert('Permission needed', 'Allow access…'); return; }
//
// which is correct exactly once. iOS shows its permission sheet the FIRST time
// an app asks and never again: after a single decline, requestX…Async returns
// { granted: false, canAskAgain: false } immediately, without showing anything.
// From then on the alert above is the whole experience — a box that says you
// need to allow access, with one button, that dismisses. There is no path from
// it to anywhere permission can actually be granted.
//
// A tester reported it as "No way to give permission." That is precisely right,
// and it silently disabled logging a meal by photo, adding a progress photo,
// setting a profile picture and uploading a coaching video.
//
// ── What this does instead ─────────────────────────────────────────────────
//
// The two failures are different and deserve different words:
//
//   canAskAgain === true   the system sheet was shown and declined just now.
//                          Saying "open Settings" would be wrong — the sheet
//                          is still available, so ask again next time.
//
//   canAskAgain === false  iOS will never prompt again. Settings is the only
//                          route, so offer to open it rather than describing
//                          a door with no handle.
//
// Linking.openSettings() lands on this app's own page in Settings, where the
// toggle is. It is the only sanctioned deep link into Settings on iOS and it
// needs no configuration.
import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export type MediaSource = 'camera' | 'library';

/**
 * Ask for the permission a picker needs. True when it is safe to open one.
 *
 * `purpose` completes the sentence "…to <purpose>", so pass a verb phrase:
 * 'log a meal by photo', 'add a progress photo', 'set your profile photo'.
 * It appears in both the request and the Settings prompt, because somebody who
 * has been sent to Settings has lost the context of what they were doing.
 */
export async function ensureMediaPermission(
  source: MediaSource,
  purpose: string,
): Promise<boolean> {
  const camera = source === 'camera';
  const perm = camera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (perm.granted) return true;

  const thing = camera ? 'the camera' : 'your photos';

  // The sheet is still available — it was just declined. Nothing to open.
  if (perm.canAskAgain) {
    Alert.alert(
      'Access not granted',
      `Repple needs ${thing} to ${purpose}. Tap it again and choose Allow.`,
    );
    return false;
  }

  // iOS will not ask again. Settings is the only way, so take them there.
  Alert.alert(
    'Turn on access in Settings',
    `iOS will not ask again, so ${thing} has to be switched on in Settings to ${purpose}.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => { Linking.openSettings().catch(() => {}); } },
    ],
  );
  return false;
}
