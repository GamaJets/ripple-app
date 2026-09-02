// Permission to PUBLISH one progress photo, which is not the same thing as
// permission to look at it.
//
// ── The two sentences, and why one does not imply the other ────────────────
//
// src/lib/photoShare.ts holds the first: a client sends ONE photo to ONE coach,
// per photo, revocable, and it dies with the coaching relationship. It says
// that this coach may OPEN this picture.
//
// This file holds the second: that the same client agreed the same coach may
// use that same photo in something they PUBLISH. A progress photo is typically
// taken in underwear, alone, in a bathroom (supabase/parts/45's words). Being
// allowed to look at one in a coaching context is not being allowed to post it
// to a business account, and no quantity of the first adds up to the second.
//
// A coach may not put a client's progress photo on a public card because they
// can see it. They may do so because that client agreed to that use, and this
// module is where that difference is written down in TypeScript. The database
// half is supabase/parts/331: a separate table, written only by the client,
// readable but not writable by the coach, and a child row of the share grant so
// that taking the photo back takes this with it.
//
// ── The rule that decides every function below ─────────────────────────────
//
// A CONSENT READ THAT FAILED IS NOT CONSENT.
//
// `LoadStatus` says an empty list under 'error' means UNKNOWN, never "there are
// none". For most reads in this app that distinction protects somebody from
// being told a false fact about their own history. Here it decides whether
// somebody's body goes on the internet, so 'unknown' is a value the type
// carries rather than a state a caller is trusted to remember, and it behaves
// exactly like 'absent' at every gate. The only difference between them is the
// sentence the coach is shown, because they are two different things to fix.
//
// Pure. No supabase, no React. src/ui/photoPublish.ts does the talking.

import type { LoadStatus } from '../ui/loadStatus';

/** One permission: this photo, from this client, to this coach. */
export interface PublishGrant {
  photoId: string;
  clientId: string;
  coachId: string;
  grantedAt: string;
}

/**
 * Whether a photo may go on something the coach publishes.
 *
 * Three values, not a boolean, and the third is the point. 'unknown' is what a
 * failed read produces, and a boolean would have to render it as one of the
 * other two: `false` silently loses a permission the client did give, and
 * `true` publishes somebody on the strength of a request that never came back.
 */
export type PublishConsent = 'granted' | 'absent' | 'unknown';

/**
 * THE gate. Nothing else in this app decides this.
 *
 * Only an explicit grant, read successfully, allows an image onto a card.
 */
export function mayPublishPhoto(consent: PublishConsent): boolean {
  return consent === 'granted';
}

/**
 * What the grants say about one photo and one coach.
 *
 * `status` is the honesty of the read that produced `grants`, and it is checked
 * FIRST. A caller that passes an empty array from a failed read gets 'unknown'
 * either way, because `grants` being null is also 'unknown' — the two ways of
 * representing a read that did not land agree here rather than depending on
 * which one the caller chose.
 */
export function publishConsentOf(
  photoId: string,
  coachId: string,
  grants: readonly PublishGrant[] | null,
  status: LoadStatus,
): PublishConsent {
  if (status === 'loading' || status === 'error') return 'unknown';
  if (grants == null) return 'unknown';
  if (!photoId || !coachId) return 'absent';
  return grants.some((g) => g.photoId === photoId && g.coachId === coachId) ? 'granted' : 'absent';
}

/**
 * The photos this coach may actually use, from the photos they can see.
 *
 * Null rather than an empty array when the permissions are not known. An empty
 * array is a claim — "this client has agreed to none of them" — and a picker
 * built from it would be indistinguishable from one built from a read that
 * failed, which is how a coach concludes their client refused when in fact
 * nobody asked the server successfully.
 *
 * Note the direction: this filters DOWN from what the coach can see. There is
 * no function anywhere that goes the other way, and that is deliberate — the
 * only route to an image on a card is through a permission that exists.
 */
export function publishablePhotos<T extends { id: string }>(
  visible: readonly T[] | null,
  coachId: string | null,
  grants: readonly PublishGrant[] | null,
  status: LoadStatus,
): T[] | null {
  if (!coachId || visible == null || grants == null) return null;
  if (status === 'loading' || status === 'error') return null;
  return visible.filter((p) => grants.some((g) => g.photoId === p.id && g.coachId === coachId));
}

/* ── what the coach is told ───────────────────────────────────────────────── */

/**
 * The sentence beside the picker, for each of the three answers.
 *
 * Null for 'granted': there is nothing to say about a permission that exists
 * and is being used, and a line there would read as a caveat about it.
 *
 * The other two are deliberately different. 'absent' is a thing the coach can
 * do something about, by asking their client. 'unknown' is not their fault and
 * not their client's, and telling them it was refused would have them go and
 * ask somebody who already said yes.
 */
export function publishConsentNote(consent: PublishConsent): string | null {
  switch (consent) {
    case 'granted':
      return null;
    case 'absent':
      return 'Your client has not agreed to this photo being used in anything you publish, so the card is made without it. They can agree to it on their own Progress screen, one photo at a time.';
    case 'unknown':
    default:
      return 'What your client has agreed to could not be read, so no photo goes on this card. This is not a client who refused, and nothing has been posted.';
  }
}

/**
 * Why a photo a coach can see is not offered for a card.
 *
 * Said on the coach's own screen, in the coach's own words, because the
 * alternative is a coach who can plainly see a photo in their inbox concluding
 * the app is broken when it will not put it on a card.
 */
export const SEEING_IS_NOT_PUBLISHING =
  'A photo your client sent you is for your coaching. Putting one in something you post in public is a separate thing to agree to, and only your client can agree to it.';

/** What a coach is told when they have picked nobody. Not an error: it is the
 *  first state of the screen. */
export const PICK_A_CLIENT_FIRST =
  'Choose the client this card is about and Repple will show the photos they have agreed you can publish. There will be none until they have.';

/* ── what the client is asked ─────────────────────────────────────────────── */

/**
 * The question, and it names the coach.
 *
 * A permission given to "my coach" is a permission that survives a change of
 * coach; part 331 records the PERSON, and the wording has to match the row.
 */
export function publishAskTitle(coachName: string | null | undefined): string {
  const who = (coachName ?? '').trim();
  return who ? `Let ${who} publish this photo?` : 'Let your coach publish this photo?';
}

/**
 * What agreeing actually means, said in full before it is agreed to.
 *
 * Three facts, and none of them is softened:
 *   · public means public, and a post cannot be recalled once somebody has it;
 *   · this is one photo, and a later one is not covered;
 *   · taking it back stops future use and cannot unpost anything.
 */
export function publishAskBody(coachName: string | null | undefined): string {
  const who = (coachName ?? '').trim() || 'your coach';
  return `${who} could use this one photo in something they post in public, such as a social media card about your progress. `
    + 'It is this photo only. Photos you add later are not covered, and neither are the ones you have already sent. '
    + 'You can take this back whenever you like, which stops them using it again. It cannot unpost anything they have already put out.';
}

/** What taking it back does, and the one thing it cannot do. */
export function withdrawPublishBody(coachName: string | null | undefined): string {
  const who = (coachName ?? '').trim() || 'your coach';
  return `${who} will no longer be able to put this photo in anything they publish. They can still open it, because it is still sent to them. `
    + 'Anything already posted stays posted, so this stops future use rather than undoing past use.';
}

/**
 * What the client's own screen says about one photo, and the third state is
 * again the point.
 *
 * 'unknown' is offered no action at all by the screen above, for the reason
 * `photoActions` in app/(client)/scans.tsx already gives about sharing: an
 * action that depends on knowing must not be offered when nothing is known.
 */
export type PublishState = 'unknown' | 'allowed' | 'not-allowed';

export function publishStateOf(
  photoId: string,
  grants: readonly PublishGrant[] | null,
): PublishState {
  if (grants == null) return 'unknown';
  return grants.some((g) => g.photoId === photoId) ? 'allowed' : 'not-allowed';
}

/** The badge under a photo. Sentence case: it is a description, not a label. */
export function publishLabel(state: PublishState): string {
  switch (state) {
    case 'allowed':
      return 'Can be published';
    case 'not-allowed':
      return 'Not for publishing';
    case 'unknown':
    default:
      return 'Not known';
  }
}

/**
 * Why this photo cannot be agreed to yet, or null when it can.
 *
 * Publication permission is a child of the share grant in part 331, so a photo
 * that has not been sent has nothing to hang it on. That is a foreign key, and
 * an insert without the parent fails with a constraint violation — which is a
 * correct refusal and a terrible sentence. This is the same rule said before
 * the request, in words.
 */
export function publishBlocker(
  photoId: string,
  coach: { id: string } | null,
  shared: readonly { photoId: string }[] | null,
): string | null {
  if (!coach) {
    return 'You do not have a coach linked, so there is nobody this could be agreed with.';
  }
  if (shared == null) {
    return 'Repple could not check which of your photos your coach can see, so nothing is being changed. Try again in a moment.';
  }
  if (!shared.some((s) => s.photoId === photoId)) {
    return 'Send this photo to your coach first. Agreeing that it can be published is a separate thing, and it only makes sense for a photo they can already see.';
  }
  return null;
}

/** The line under the photo grid on the client's screen, which has to hold both
 *  halves of the distinction in one breath. */
export const PUBLISH_IS_SEPARATE_NOTE =
  'Sending a photo to your coach lets them look at it. It does not let them put it in anything they post in public. That is a separate thing you agree to per photo, and you can take it back.';
