// Handing something a coach made to the phone's share sheet. That is the whole
// module now, and it is the whole feature.
//
// ── What was here, and why none of it survived ──────────────────────────────
//
// This file used to export `SOCIAL_PLATFORMS`, `socialConnected()` and
// `publishToSocials()`. Read together they described an app that posted a
// session clip to YouTube, Instagram, Facebook and TikTok at once. It never
// posted anything, to anywhere, in any build:
//
//   · `publishToSocials` was, in its entirety, `for (const p of opts.platforms)
//     pending.push(p)`. No upload, no request, no endpoint — the function
//     returned a list of the platforms it had not posted to and the screen
//     above it announced "Posted to YouTube, Instagram, Facebook."
//
//   · `socialConnected()` tested `!!process.env.EXPO_PUBLIC_YOUTUBE_CLIENT_ID`
//     and three like it. A build-time string says nothing about whether an
//     account is linked: there was no OAuth session, no token store, no refresh
//     and no account record anywhere in this codebase. The green dot beside
//     each network was a dot beside a `.env` line.
//
//   · The screen told the coach to "connect each account once (Settings →
//     Integrations)". There is no Integrations screen in this app. There never
//     has been. A coach following that instruction searches Settings, finds
//     nothing, and concludes the app is broken — which is a worse outcome than
//     never having offered it, because now they distrust the parts that work.
//
// A later pass rewrote the alerts to admit all of this, which was right as far
// as it went, and left the platform picker standing so the coach could tick
// four boxes marked "Not available" before pressing a button that opened the
// share sheet. That is the shape this codebase has already ruled on twice — for
// Studio's "Connect Accounting" and for Apple Music: a control whose only
// function is to explain that it does not work is worse than no control. So the
// picker, the platform list and the connection probe are gone, not reworded.
//
// ── What direct publishing would actually take ──────────────────────────────
//
// Not hidden in the UI, because a coach cannot act on it — but recorded here,
// because the next person to read this file will otherwise assume it is a
// morning's work. Per network: a developer app registered to a legal entity, an
// app review with a screencast of the exact flow, an OAuth authorisation code
// flow with PKCE, a server-side token store with refresh (the tokens are
// long-lived credentials and cannot sit on the device), a resumable upload
// endpoint, and a status poller because none of these publish synchronously.
// Instagram is the hard one and the one coaches ask for: the Content Publishing
// API only accepts a Business or Creator account linked to a Facebook Page, the
// media has to be fetched by Meta from a public HTTPS URL we would have to host,
// and personal accounts cannot be published to at all. TikTok's Content Posting
// API additionally gates unaudited apps to private-visibility posts. That is a
// project with a review queue in the middle of it, not an evening.
//
// ── What is real, tonight, with no key and no review ────────────────────────
//
// The OS share sheet. It is already in the binary, it lists every app the phone
// actually has — including the ones that have not been invented yet — it keeps
// working when any of them changes its SDK, and Repple gets no posting access
// from it: the coach picks the destination and confirms the post themselves.
// Two taps. The same argument `exportShare.ts` makes at `shareText`, and it was
// right there while this file was pretending to be an upload client.
//
// So: `shareSessionNatively` hands over a clip and a caption, and
// `sharePngAsset` hands over a composed graphic (`src/lib/shareAsset.ts` builds
// what goes on it, `app/(trainer)/share-kit.tsx` draws it).
import { Share } from 'react-native';

// Both are real dependencies and both are in ios/Podfile.lock — see the
// post-mortem at the top of src/lib/exportShare.ts, which is where this pattern
// and its reasoning come from. The probes stay regardless: neither module
// reaches a phone over the air, so a JS-only update landing on an older binary
// still finds no expo-sharing, and the honest answer there is a named reason
// and the text fallback rather than a button that quietly does nothing.
let Sharing: any = null;
try { Sharing = require('expo-sharing'); } catch { /* absent from a binary made before it was added */ }

let FileSystem: any = null;
try { FileSystem = require('expo-file-system'); } catch { /* would be a broken install */ }

// Native too, and added to this app late enough that a binary in somebody's
// pocket may predate it — which is precisely how the coach app's home tab once
// failed to render at all. Optional here, and the caller is told whether the
// copy actually happened rather than being shown a message that assumes it.
let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { /* absent from an older binary */ }

/**
 * Whether this build can write a PNG and hand it over as a file.
 *
 * Both generations of the expo-file-system API are asked about, because SDK 54
 * replaced `cacheDirectory`/`writeAsStringAsync` with `Paths.cache`/`new
 * File()` and left the old names on the module as stubs that THROW when called.
 * A probe naming only one of them gets a confident wrong answer rather than an
 * error anybody would notice — the exact fault that had `exportShare.ts`
 * telling clients "this build cannot attach a file" against a module that was
 * present and working.
 */
export function imageShareAvailable(): boolean {
  const canWrite = !!(FileSystem?.Paths?.cache && FileSystem?.File)
    || !!(FileSystem?.cacheDirectory && FileSystem?.writeAsStringAsync);
  return canWrite && !!Sharing?.shareAsync;
}

/**
 * Why an image cannot be sent, in a sentence the coach can act on — or null.
 *
 * The point of naming the cause is that the two causes have different answers.
 * A missing expo-sharing means the binary is behind and updating fixes it; a
 * missing file system means the same thing but for a different reason, and
 * neither is "the graphic failed to render", which is what a coach assumes when
 * a share button does nothing.
 */
export function imageShareBlocker(): string | null {
  if (!Sharing?.shareAsync) {
    return 'This version of the app can’t attach an image to the share sheet. Update to the next release and the graphic itself will send — the caption goes as text in the meantime.';
  }
  if (!imageShareAvailable()) {
    return 'This version of the app can’t save the image to your phone before sending it. Update to the next release and the graphic itself will send — the caption goes as text in the meantime.';
  }
  return null;
}

/**
 * Write a base64 PNG into the cache and return its `file://` URI.
 *
 * Throws rather than returning null, so a caller cannot mistake "the write
 * failed" for "there was nothing to write". The share path below turns the
 * throw into the caption-only fallback, which is the one place that decision
 * belongs.
 */
async function writePng(base64: string, filename: string): Promise<string> {
  if (FileSystem?.Paths?.cache && FileSystem?.File) {
    const f = new FileSystem.File(FileSystem.Paths.cache, filename);
    // A card shared a minute ago is still sitting at this path on a second
    // share within the same minute, and `create()` refuses an existing one.
    f.create({ overwrite: true, intermediates: true });
    // Synchronous in the new API — `write` returns void, so there is nothing to
    // await and awaiting it would silently succeed on a failed write.
    f.write(base64, { encoding: 'base64' });
    return f.uri;
  }
  const uri = FileSystem.cacheDirectory + filename;
  // Must stay awaited on the old API: handing the share sheet a URI before the
  // bytes are on disk attaches an empty file, which the coach then posts.
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType?.Base64 ?? 'base64' });
  return uri;
}

/**
 * What actually left the phone, so the screen can say so rather than guess.
 *
 * `sent` is the graphic or, when this build cannot attach one, the caption as
 * plain text. `captionCopied` is separate and is the honest half of a small
 * problem described at `sharePngAsset`.
 */
export interface AssetShareResult { sent: 'image' | 'text'; captionCopied: boolean }

/**
 * Hand a composed graphic to the share sheet, and put its caption on the
 * clipboard.
 *
 * ── why the caption is copied rather than attached ──────────────────────────
 *
 * A share sheet will not carry an image and a caption together to the place the
 * coach is going. `Sharing.shareAsync` shares a file and takes no text at all;
 * React Native's own `Share.share({ message, url })` accepts both but only iOS
 * reads `url`, Android silently drops it and sends the text alone, and the
 * apps that do receive both frequently keep one and discard the other —
 * Instagram among them. There is no arrangement of these two APIs that reliably
 * delivers both, on both platforms, to an arbitrary destination.
 *
 * So this does the thing that works everywhere: the image goes through the
 * sheet, and the caption goes on the clipboard for the coach to paste into the
 * box that is already waiting for it. One extra tap, and it is the same tap
 * whichever app they picked.
 *
 * `captionCopied` comes back rather than being assumed, because expo-clipboard
 * is native and may be missing from an older binary — and "caption copied" is a
 * sentence a coach will act on by pasting. Telling them it is on the clipboard
 * when it is not means an empty paste and a post with no words.
 *
 * A dismissed share sheet rejects on some platforms. The coach changing their
 * mind is not an error and must not raise one at the call site.
 */
export async function sharePngAsset(base64: string, filename: string, caption: string): Promise<AssetShareResult> {
  // Before the sheet opens, not after: on iOS the activity view controller
  // takes over the app, and a copy racing that transition is a copy that may
  // not have landed by the time the coach is in Instagram pressing paste.
  let captionCopied = false;
  if (caption && Clipboard?.setStringAsync) {
    try { await Clipboard.setStringAsync(caption); captionCopied = true; } catch { /* stays false, and the screen says so */ }
  }

  if (base64 && imageShareAvailable()) {
    try {
      const uri = await writePng(base64, filename);
      const ok = Sharing.isAvailableAsync ? await Sharing.isAvailableAsync() : true;
      if (ok) {
        // `dialogTitle` is Android-only and `UTI` iOS-only; each platform
        // ignores the other's. Naming the UTI matters on iOS — without it the
        // sheet offers fewer destinations for the same file, which reads to the
        // coach as Instagram not being installed.
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your card', UTI: 'public.png' });
        return { sent: 'image', captionCopied };
      }
    } catch { /* fall through to the caption, which always works */ }
  }
  try { await Share.share({ message: caption }); } catch { /* dismissed */ }
  return { sent: 'text', captionCopied };
}

/**
 * The share sheet with a clip and a caption.
 *
 * Unchanged in behaviour and the one thing in this file that always worked. It
 * is `Share.share` rather than `Sharing.shareAsync` deliberately: the RN sheet
 * takes a message AND a url together, so the caption travels with the video
 * into whichever app the coach picks, and it needs nothing from the binary.
 */
export async function shareSessionNatively(caption: string, uri?: string): Promise<void> {
  try { await Share.share(uri ? { message: caption, url: uri } : { message: caption }); } catch { /* cancelled */ }
}
