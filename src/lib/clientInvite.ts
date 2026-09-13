// Offering a hand-added client a way onto the app, from that client's own screen.
//
// ── The dead end this closes ───────────────────────────────────────────────
//
// A coach adds somebody from the Clients tab with a name and nothing else. The
// Add Client sheet in app/(trainer)/dashboard.tsx has an optional email field
// captioned "records an invite", and if the coach fills it in, `sendInvite`
// writes a `coach_invites` row and the alert afterwards hands over the coaching
// code as well. That is the ONLY place in the coach app where either of those
// two things is offered about a particular person.
//
// Most coaches do not have the email to hand at that moment — the whole point of
// adding somebody by hand is that they are standing in front of you. So the
// field is skipped, and from then on the only screen about that person,
// app/(trainer)/client.tsx, says this and offers nothing:
//
//     "<Name> was added by hand and has no Repple account yet, so there are no
//      goals, planned days, ticks or photos of theirs to read. Send them your
//      coaching code and everything below starts filling in."
//
// — `noAccountNote` in ./clientBrief.ts. It names the action and there is
// nothing on the screen that performs it. The code is behind a button on a
// different tab, on a sheet titled Add a Client, about a person the coach has
// already added; the email invite is on that same sheet and cannot be reached
// for somebody who is already on the roster at all. A coach who wants to get
// this one person onto the app has to go and re-add them.
//
// ── Why the rules are here and not in the screen ───────────────────────────
//
// Because three of them are refusals, and a refusal that lives in a `.tsx`
// ternary is a refusal nobody can assert without a device. Each one below is
// the difference between a coach believing somebody was invited and somebody
// actually being invited, which is the same class of defect src/ui/invites.tsx
// has its own header about.
//
// Nothing here imports react-native, expo or the network: it runs under plain
// `node` in ./clientInvite.test.ts. The shape follows ./trainerInvite.ts, which
// holds the console's half of the same problem one table along.
import type { CoachedMode } from './types';

/**
 * The address as `sendInvite` will write it.
 *
 * `src/ui/invites.tsx` lower-cases and trims before the upsert, and
 * `coach_invites` is unique on `(coach_id, email)` with an index on
 * `lower(email)`, so this has to normalise identically or the duplicate check
 * below would clear an address the database then rejects.
 *
 * Null rather than a best guess for anything that is not an address. An invite
 * sent into a typo is a client who never arrives and a coach who believes they
 * were asked — and nothing in this product emails anybody, so there is no
 * bounce to notice.
 */
export function inviteEmail(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  // Deliberately not RFC-complete, for the reason ./trainerInvite.ts gives:
  // this refuses the mistakes a person makes while typing — a missing @, a
  // trailing comma, a pasted name — and leaves the rest to the mail server,
  // which is the only thing that knows whether an address exists.
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(s)) return null;
  return s;
}

/** Whether this person's screen should offer to get them onto the app. */
export type InviteOffer =
  | { offer: true; head: string; note: string }
  /** `has-account` — they are already on Repple. `not-said` — the roster has
   *  not yet told us which of the two tables this row came from. */
  | { offer: false; why: 'has-account' | 'not-said' };

/**
 * Whether to offer at all, and what to head it with.
 *
 * `handAdded` is the flag `src/ui/roster.tsx` puts on every row saying which of
 * its two tables the person came from: a `coach_clients` row is a note the
 * coach typed, a `clients` row is an account with somebody behind it.
 *
 * ── Why `undefined` withholds here and does not withhold in clientRecord.ts ──
 *
 * `clientIsQueryable` treats an unknown `handAdded` as "go on asking", because
 * the cost of being wrong there is a read that returns nothing, and withholding
 * a real client's whole screen on a value the roster has not supplied yet is
 * worse than a wasted query.
 *
 * This is the opposite trade and so it takes the opposite default. The cost of
 * being wrong HERE is a write: `sendInvite` upserts on `(coach_id, email)`, so
 * offering this about somebody who already has an account and has already
 * accepted would put a live pending invitation in front of a client who is
 * standing in the coach's book — an invitation to join a coach they already
 * have. Only an explicit `true` is knowledge that this person has no account,
 * and only knowledge may be acted on.
 */
export function inviteOffer(
  handAdded: boolean | null | undefined,
  name: string,
): InviteOffer {
  if (handAdded !== true) {
    return { offer: false, why: handAdded === false ? 'has-account' : 'not-said' };
  }
  const who = String(name ?? '').trim();
  return {
    offer: true,
    head: who ? `Get ${who} onto the app` : 'Get them onto the app',
    // Both halves are load-bearing. The first says what the coach gets out of
    // it, because every other line on that screen is an em dash for this
    // person and a coach reading a screen full of dashes needs to know they
    // are a consequence rather than a fault. The second is the one the Add
    // Client alert already tells coaches and this screen was not: the code
    // works whatever address they sign up with, and the email invite only
    // links if they spell it the same way.
    note: 'Nothing below can fill in until they have an account. Your coaching code works whoever they are and whatever address they sign up with; an emailed invite only links them to you if they sign in with that exact address.',
  };
}

/** A `coach_invites` row this coach already holds, as the sent list carries it. */
export interface PriorInvite {
  email: string;
  status: string;
}

/**
 * Why this invitation will not be recorded, or null when it will.
 *
 * `prior` is every invite this coach has already sent — `sent` from
 * `useInvites()`. It is nullable on purpose and null is NOT an empty list: the
 * provider's read can fail, and under 'error' `sent` is empty for a coach who
 * has sent fifty.
 *
 * ── The three refusals, in the order they cost money ───────────────────────
 *
 *  1. AN UNREAD LIST BLOCKS. A coach who cannot see the invitations already on
 *     file cannot be told which one they are about to overwrite, and the
 *     overwrite is silent — see 3.
 *
 *  2. A PENDING INVITATION IS NOT RE-SENT. It would look like a second attempt
 *     and be nothing of the sort: the upsert rewrites the same row, no email
 *     leaves this product at any point, and the client's screen does not change.
 *     A coach pressing it twice has done nothing twice.
 *
 *  3. AN ACCEPTED INVITATION IS NEVER TOUCHED. This is the one with teeth.
 *     `sendInvite` in src/ui/invites.tsx upserts `{ status: 'pending' }` with
 *     `onConflict: 'coach_id,email'`, so re-sending to an address that already
 *     accepted moves a row from accepted back to pending. That un-records the
 *     moment somebody joined, puts a live invitation back in front of a client
 *     who is already in this coach's book, and nothing anywhere reports it,
 *     because from PostgREST's point of view the write succeeded.
 */
export function inviteSendBlocker(
  raw: string | null | undefined,
  prior: ReadonlyArray<PriorInvite> | null | undefined,
): string | null {
  const email = inviteEmail(raw);
  if (!email) return 'That is not an address an invite can be recorded against. Check it and try again.';
  if (prior == null) {
    return 'The invitations already on your account could not be read, so this cannot tell whether you have invited them before. Nothing has been recorded.';
  }
  const held = prior.find((i) => inviteEmail(i.email) === email);
  if (held && held.status === 'pending') {
    return 'You already have an invitation waiting on that address. Nothing has changed — send them your coaching code instead, which works whatever address they sign up with.';
  }
  if (held && held.status === 'accepted') {
    return 'That address has already accepted an invitation from you. Recording another would put them back to pending, so nothing has been done.';
  }
  // A revoked invitation is deliberately not a blocker: withdrawing one and
  // sending it again is how a coach corrects an address they got wrong.
  return null;
}

/**
 * What to say once the row is on the server.
 *
 * The second sentence is the one that is easy to leave out and the only one
 * that changes what the coach does next: an invite is a row, not an email.
 * Nothing in Repple sends one. A coach who believes the app has written to this
 * person will wait for somebody who was never contacted — and the Add Client
 * alert says exactly this, so leaving it out here would make the same action
 * mean two different things depending on which screen it was started from.
 */
export function invitedLine(name: string, email: string): string {
  const who = String(name ?? '').trim() || 'They';
  return `${who} is recorded as invited on ${email}. Repple does not email anybody — tell them yourself, and they link to you the first time they sign in with that exact address.`;
}

/**
 * What to say when the write was refused.
 *
 * Named as a refusal rather than as a network hiccup, because the two have the
 * same remedy from the coach's side and only one of them is worth a sentence:
 * whatever happened, the invitation is not on the server, and the coaching code
 * does not depend on it having been. Never claim success from the absence of an
 * error — `sendInvite` resolves false on a refused write and this is the
 * sentence that belongs on that false.
 */
export function notRecordedLine(name: string, email: string): string {
  const who = String(name ?? '').trim() || 'They';
  return `The invitation for ${email} was NOT recorded, so ${who} will not link to you when they sign in. Send them your coaching code instead — it does not depend on this.`;
}

/**
 * The delivery the invitation should carry.
 *
 * A hand-added row already holds how the coach said they would train this
 * person, and the invitation has a `mode` column for exactly that. Dropping it
 * and letting the column default to 'online' is how a client the coach set up
 * as in-person arrives online-only with no booking calendar and nobody told —
 * the defect part 57 fixed inside `join_by_code` and which this would have
 * reintroduced one table along.
 *
 * `coach_invites.mode` is checked against ('online','inperson','hybrid'), which
 * is `CoachedMode` exactly — 'solo' lives on `clients.mode` and means nobody is
 * coaching them, which cannot be true of a person on this coach's roster. The
 * fallback is therefore for a row from an older build carrying nothing, and it
 * is the same value the column would have defaulted to.
 */
export function inviteMode(rosterMode: string | null | undefined): CoachedMode {
  return rosterMode === 'inperson' || rosterMode === 'hybrid' || rosterMode === 'online'
    ? rosterMode
    : 'online';
}
