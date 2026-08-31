// The picture that goes beside the name at the head of a chat thread — and the
// two ways it is allowed to be absent.
//
// ── Why this is a module and not two lines in the header ────────────────────
//
// TF-32 was not a bug about names. It was a bug about FALLBACKS: the client's
// screens wanted a coach and reached for whatever was readable, which on the
// client app is the client. Under "Your coach" sat the reader's own name and,
// beside it, the reader's own face — `profiles.avatar` read for
// `auth.getUser()`. src/lib/threadPeer.ts holds that line for the name. Nothing
// held it for the picture, so app/(client)/calendar.tsx deleted the avatar
// outright rather than risk drawing the wrong one again.
//
// Now that `my_coach()` returns the coach's avatar (supabase/parts/115), the
// picture can come back — but only under the same rule the name obeys, which is
// the rule this file is: an avatar is drawn only when it arrived from the read
// for the OTHER party's id, and otherwise nothing is drawn. There is no branch
// here that can reach for the signed-in user.
//
// The monogram is the second half. `initialsOf('—')` yields '—' sliced to two
// characters, which is how a labelled dash quietly becomes a circle containing
// punctuation dressed as somebody's initials. Taking initials is therefore
// gated on the same `isName` flag that gates capitalisation upstream.

import { NO_NAME, type PeerHeading } from './threadPeer';

/** What came back from the read for the other party's id. */
export interface PeerAvatarRead {
  /** True only when that party has actually been identified — a coach id from
   *  `my_coach()`, a client id from the roster. False while loading, when the
   *  link read failed, and when there is no link at all. */
  identified: boolean;
  /** The avatar as stored on THAT id's profile. null/undefined when the read
   *  was refused, matched no row, or the column is empty. */
  url: string | null | undefined;
}

/**
 * The avatar to draw, or null to draw none.
 *
 * Null is not a failure to be papered over: a coach who has set no picture and
 * a coach whose picture we could not read both render as a monogram, which
 * claims nothing either way. What must never happen is a non-null answer that
 * did not come from `identified` being true.
 */
export function resolvePeerAvatar(r: PeerAvatarRead): string | null {
  if (!r.identified) return null;
  const u = typeof r.url === 'string' ? r.url.trim() : '';
  return u ? u : null;
}

/**
 * The one or two characters that stand in for a face when there is no picture.
 *
 * Only ever taken from a real name. A dash is passed through whole — it is
 * already the honest mark for "we cannot say who this is", and slicing it into
 * initials would turn it into something that looks like an answer.
 */
export function peerMonogram(head: PeerHeading): string {
  if (!head.isName) return NO_NAME;
  // "Coach Sam Rivera" is a name a coach may type for themselves; the honorific
  // is not part of their initials. Empty parts are dropped so a double space or
  // a trailing one cannot contribute a blank letter.
  const parts = head.text.replace(/^coach\s+/i, '').split(/\s+/).filter(Boolean);
  const letters = parts.map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return letters || NO_NAME;
}
