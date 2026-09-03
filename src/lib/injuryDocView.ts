// How a stored injury document is opened, decided before anything opens it.
//
// ── The failure this exists to stop ───────────────────────────────────────
//
// app/(client)/injury-doc.tsx opened a stored report with `Linking.openURL`.
// That hands the signed URL to whatever app owns http on the device, and that
// app then has it — in its history, in its recently-closed tabs, and on iOS
// with iCloud tabs (or Android with a signed-in Chrome) synced to every other
// device on the account. The URL is live for an hour (`INJURY_DOC_TTL_S` in
// src/ui/injuryDocs.ts), so for that hour anybody holding any of those devices
// can open somebody else's physiotherapy report by tapping a history entry.
//
// The whole design of this feature is that NOBODY ELSE ON THIS PLATFORM gets
// the file: a private bucket, own-folder storage policies with no trainer
// branch, and a screen that tells the member out loud that their coach cannot
// see it (supabase/parts/91-injury-documents.sql). A promise kept at the
// database and broken by the Open button is not kept.
//
// That paragraph used to open "the file never leaves the member's own account",
// which was the wording the whole product used and which was not true even
// then. Reading a document means sending a copy of it to OCR.space; the member
// is now asked, per document, before it goes, and the answer is written to a
// ledger — src/lib/injuryDocConsent.ts and supabase/parts/1000. `SCREEN_PROMISE`
// there is the sentence that replaced it, and it deliberately does not promise
// the document is never sent.
//
// None of that weakens the rule THIS file holds, and it is worth being exact
// about why. The consented send is one POST to one named vendor, made by an
// edge function, that the member agreed to that minute. What `Linking.openURL`
// did was hand a live signed URL to another app on the device and leave it in
// that app's history, synced across every device on the account, for an hour,
// with nobody asked about anything. A disclosed send to one recipient and an
// undisclosed leak to any number of them are not the same act.
//
// ── Why the answer depends on the file and not on the screen ──────────────
//
// An image can be rendered by the app itself — React Native's own <Image> is in
// every binary ever built, so a photographed report can be shown full-screen
// with nothing outside this app ever seeing the URL. A PDF cannot: there is no
// PDF renderer in this dependency set, and adding one is a native dependency,
// which is a new binary rather than an over-the-air update. So a PDF goes to an
// in-app browser sheet (SFSafariViewController / a Chrome Custom Tab), which is
// presented by this app, over this screen, and dismissed back into it. That is
// a real step down in privacy from the image path and a large step up from
// handing the file to Safari, and it is the best available without a new build.
//
// The decision is pure and lives here so it can be asserted without a device.
// The one rule that must never regress is at the bottom of this file: NO kind
// of injury document is ever opened by handing it to another app.

/** What a stored document is, as far as opening it is concerned. */
export type InjuryDocKind = 'image' | 'pdf' | 'unknown';

/** Where a document of that kind is allowed to be opened. */
export type InjuryDocRoute = 'in-app-viewer' | 'in-app-browser';

/**
 * What kind of file a stored object is, from its name.
 *
 * The extension is the only thing available: `listInjuryDocs` returns storage
 * objects, and Supabase's list does not report a content type. That is not a
 * weakness here, because `injuryDocObjectPath` in src/ui/injuryDocs.ts CHOOSES
 * the extension at upload time from the content type it just decided — 'pdf'
 * for a PDF and 'jpg' for everything it re-encoded as JPEG — so for anything
 * this app stored the name and the bytes cannot disagree.
 *
 * 'unknown' is a real answer and not a synonym for 'pdf'. An object with an
 * extension this app never writes is either from a version that wrote something
 * else or is not what it says it is, and neither is a thing to hand to the
 * app's own image decoder on the strength of a guess.
 */
export function injuryDocKind(name: string | null | undefined): InjuryDocKind {
  const n = String(name ?? '').toLowerCase();
  const dot = n.lastIndexOf('.');
  if (dot < 0) return 'unknown';
  switch (n.slice(dot + 1)) {
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'heic':
    case 'webp':
      return 'image';
    case 'pdf':
      return 'pdf';
    default:
      return 'unknown';
  }
}

/**
 * Where a document opens.
 *
 * Only an image gets the in-app viewer, because only an image is something this
 * app can decode itself. Everything else — a PDF, and anything whose extension
 * this app does not recognise — goes to the in-app browser sheet, which is
 * still inside the app and is still not `Linking.openURL`.
 *
 * There is deliberately no third return value. A route that meant "hand it to
 * the system" would be the defect this module was written to remove, and the
 * type is what stops one being added back without somebody noticing.
 */
export function injuryDocRoute(kind: InjuryDocKind): InjuryDocRoute {
  return kind === 'image' ? 'in-app-viewer' : 'in-app-browser';
}

/**
 * What the member is told about where their document opens.
 *
 * Sentence case, because it is a note rather than a label. It says "in the app"
 * rather than naming a browser: the point the member cares about is that the
 * file does not go anywhere they would then have to go and clear, and the
 * mechanism differs by platform and by file type.
 */
export const OPENS_IN_APP_NOTE =
  'Your documents open inside the app. They are never handed to your web browser, where the link would sit in its history and sync to your other devices.';
