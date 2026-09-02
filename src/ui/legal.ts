// Opening the two documents sign-up says you agree to.
//
// ── The defect this exists to end ─────────────────────────────────────────
//
// `app/welcome.tsx` printed "By continuing you agree to the Terms & Privacy
// Policy" and the screen had no `Linking`, no `Pressable` and no route for
// either document. A repo-wide search for `privacy.html` or `terms.html` across
// `app/` and `src/` returned nothing, while both files ship in `web/` and are
// served at the brand's own site — they are the URLs registered in both store
// listings. So consent was asserted to documents the person could not read
// before agreeing, and could not find afterwards either.
//
// The only legal text a member could reach was a four-sentence paraphrase on
// the Settings screen. A summary written by us is not the policy: it is the
// part of it we thought was worth mentioning, and it is not what anybody agreed
// to. The summary stays — it is genuinely useful — but it now says what it is
// and sits above a way to the document itself.
//
// ── Why the in-app browser ────────────────────────────────────────────────
//
// `openInAppBrowser` rather than `Linking.openURL`, for the reason
// src/ui/nativeModules.ts gives: the sheet is presented by this app, over this
// screen, and dismissed back into it. A privacy policy is a public page and
// nothing here is confidential, so this is a matter of not throwing somebody
// out of a sign-up form they had half filled in.
//
// The URL is per BRAND. A chain's member must never be sent to their supplier's
// privacy policy — see `privacyUrl` in src/lib/brands.ts.
import { Alert } from 'react-native';
import { BRAND } from '../lib/brands';
import { openInAppBrowser } from './nativeModules';

export type LegalDoc = 'privacy' | 'terms';

/** The document's own name, for a button and for a failure heading. */
export function legalDocTitle(which: LegalDoc): string {
  return which === 'privacy' ? 'Privacy Policy' : 'Terms of Service';
}

/** Where that document actually lives for THIS brand. */
export function legalDocUrl(which: LegalDoc): string {
  return which === 'privacy' ? BRAND.privacyUrl : BRAND.termsUrl;
}

/**
 * Open one of them, and say so when it could not be opened.
 *
 * Never silently does nothing: a tap that appears to miss on a consent link is
 * the same as not having the link. The URL is put in front of the person so
 * they can reach the document another way, which is the whole point of it being
 * reachable at all.
 */
export async function openLegalDoc(which: LegalDoc): Promise<void> {
  const url = legalDocUrl(which);
  const opened = await openInAppBrowser(url);
  if (!opened) {
    Alert.alert(
      `Couldn’t open the ${legalDocTitle(which)}`,
      `It is published at ${url}. Open that in your browser to read it.`,
    );
  }
}
