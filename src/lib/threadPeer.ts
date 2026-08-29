// Who is on the other end of a chat thread — and, when the app cannot read
// their name, saying that plainly instead of borrowing somebody else's.
//
// ── The bug this module exists for (TF-32) ──────────────────────────────────
//
// The client's Messages screen headed the thread with `useCoachProfile().name`.
// That provider is the COACH-side one: it calls `supabase.auth.getUser()` and
// loads THAT user's own `profiles.full_name`. On the client app the signed-in
// user is the client, so the header — under the kicker "Your coach" — was the
// reader's own name. Every message still went to the right place: the thread is
// keyed by `messages.client_id` and RLS (10-messages-setup.sql) decides who may
// read it, so this was a label naming the wrong person, not a message reaching
// the wrong one. That is still the worst possible label to get wrong, because
// the name shown is one the reader recognises and therefore trusts.
//
// ── Why an unreadable name is the ordinary case, not a failure ──────────────
//
// A client cannot read their coach's `profiles` row. `profiles_self` restricts
// a user to `id = auth.uid()` (07-auth-setup.sql), and every other SELECT policy
// on `profiles` runs the other way — trainer reading their clients
// (08-roster-access.sql), trainer reading tenant peers (28-fix-profiles-
// recursion.sql). Nothing grants client → coach. So for most clients the coach's
// name simply is not readable, and the fix cannot be "read it properly": it has
// to be a labelled dash that says why, because the alternative — falling back to
// whichever name IS readable — is exactly how the reader ended up looking at
// their own.
//
// Kept pure and separate from the hook so the four outcomes can be asserted
// directly (threadPeer.test.ts) rather than through a Supabase client.

/** The one character a name renders as when there is no name to render. */
export const NO_NAME = '—';

/** Which side of the thread the person being named is on. */
export type PeerSide = 'coach' | 'client';

/**
 * What is known about the other party's name.
 *
 * 'withheld' and 'unlinked' are deliberately distinct: one means there is
 * somebody there whose name we may not read, the other means there is nobody
 * there at all, and a client with no coach needs to be told the second rather
 * than left staring at a thread that can never be delivered.
 */
export type PeerName =
  | { kind: 'loading' }
  | { kind: 'named'; name: string }
  | { kind: 'withheld' }
  | { kind: 'unlinked' }
  | { kind: 'unknown' };

/** The raw outcome of the two reads the hook performs, before interpretation. */
export interface PeerRead {
  /** False while a read is still in flight. Nothing else here means anything yet. */
  settled: boolean;
  /** True when the link lookup itself was refused or threw — we do not know
   *  whether there is a coach, which is not the same as knowing there is none. */
  linkFailed: boolean;
  /** The other party's profile id, or null when no link exists. */
  peerId: string | null;
  /** The name read for `peerId`: null/undefined when the read was refused,
   *  matched no row, or the row's name is blank. */
  name: string | null | undefined;
}

/**
 * Interpret the two reads. Never returns a name that did not come back from the
 * read for `peerId` — in particular there is no branch that reaches for the
 * signed-in user's own profile.
 */
export function resolvePeerName(r: PeerRead): PeerName {
  if (!r.settled) return { kind: 'loading' };
  // Ordered before the peerId check: on a failed link read `peerId` is null for
  // the same reason it is null when nobody is linked, and reporting "you have no
  // coach" to a client who has one is the same class of lie this file is about.
  if (r.linkFailed) return { kind: 'unknown' };
  if (!r.peerId) return { kind: 'unlinked' };
  const n = typeof r.name === 'string' ? r.name.trim() : '';
  return n ? { kind: 'named', name: n } : { kind: 'withheld' };
}

/** What the header draws: a name, or a dash and the reason it is a dash. */
export interface PeerHeading {
  /** The name, or NO_NAME. */
  text: string;
  /** Why `text` is a dash. Null exactly when `text` is a real name. */
  note: string | null;
  /** True only when `text` is somebody's actual name — screens that capitalise
   *  or take initials must not do either to a dash. */
  isName: boolean;
}

/**
 * Turn what is known into what the header says.
 *
 * The notes name the party by role ("your coach") rather than leaving the
 * sentence about an anonymous "them": the whole point of the dash is that the
 * reader still knows who the thread is with, just not what they are called.
 */
export function peerHeading(p: PeerName, side: PeerSide): PeerHeading {
  const theirs = side === 'coach' ? 'Your coach' : 'This client';
  switch (p.kind) {
    case 'named':
      return { text: p.name, note: null, isName: true };
    case 'loading':
      return { text: NO_NAME, note: 'Checking who this thread is with…', isName: false };
    case 'unknown':
      return { text: NO_NAME, note: `We could not check who ${side === 'coach' ? 'your coach' : 'this client'} is.`, isName: false };
    case 'unlinked':
      return side === 'coach'
        ? { text: NO_NAME, note: 'No coach is linked to your account yet, so nobody can read this thread.', isName: false }
        : { text: NO_NAME, note: 'This thread is not linked to a client.', isName: false };
    case 'withheld':
      return { text: NO_NAME, note: `${theirs}'s name is not shared with your app.`, isName: false };
  }
}
