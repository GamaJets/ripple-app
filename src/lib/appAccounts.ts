// Who on a gym's roster has a Repple account, and who is somebody the gym typed
// into a box.
//
// ── The question, and why the console could not answer it ─────────────────
//
// An owner about to send anything — a notice, a price change, a closure on
// Sunday — needs to know who it will actually reach. studio-web/app/members
// shows a roster, a Reach panel that posts to `announcements` and fans out to
// `notify_users`, and nowhere on it a line saying which of those people the
// fan-out can write a row for. `deliveryNote` in src/lib/gymReach.ts is the
// evidence that this was being discovered after the fact, one send at a time:
// "The difference is accounts the database would not write to." The owner reads
// that sentence AFTER pressing send, and it names a number, not the people.
//
// ── What the schema actually says, which is the answer's whole shape ──────
//
// `memberships.member_id` references `profiles(id)`, and `profiles.id`
// references `auth.users(id)` (parts 29, 01, 07). So a membership CANNOT be
// filed against somebody without a Repple account — the header of
// src/lib/memberInvites.ts says the same thing from the other side: "until
// somebody has a Repple account they cannot hold a membership".
//
// That makes the answer to "who has an account" exact rather than a guess:
// everybody holding a membership. The people a gym means when it says "members
// I added by hand" are its OUTSTANDING INVITES — a name and an email address
// the gym typed, held until that person exists and claims it. They are on the
// gym's roster in every sense that matters to the gym, they are on nobody's
// roster in this database, and nothing this console sends can reach them.
//
// And there is a third group nothing named either: a membership whose
// `member_id` has gone null. Part 184 keeps the contract and snapshots the name
// into `member_label` when an account is erased, because the invoices hang off
// it. `memberIds` in src/lib/memberView.ts skips those rows, which is right for
// a page about people and wrong for a count of who can be reached — they were
// silently absent from both halves of the answer.
//
// ── The one arithmetic this module refuses ────────────────────────────────
//
// It never adds the two counts together, and `COUNTS_ARE_NOT_A_TOTAL` says why
// on the screen. They count different records: a membership row and an invite
// row. A gym that invited somebody by email in March and signed them up at the
// desk in April has two records for one person, and this database cannot join
// them — `auth.users.email` is not readable under any policy in this schema, so
// there is nothing to match the invite's address against. A "roster total" made
// of these would double-count exactly the members a gym chased twice.
import type { Membership } from './gymRecord';
import { inviteState, normaliseEmail, type MemberInvite, type MemberInviteState } from './memberInvites';
import { rowsOf, sliceNote, type Slice } from './memberView';

/**
 * What the app can do about one person on the roster.
 *
 * Four states rather than a boolean, because "cannot be reached in the app" has
 * three causes and each one is a different thing for an owner to do: send the
 * invitation, send it AGAIN, or stop expecting to reach a person who has gone.
 */
export type AppAccount =
  /** Holds a membership, so an account exists and the inbox fan-out reaches it. */
  | 'on-the-app'
  /** Typed in by the gym, invitation still good, no account yet. */
  | 'invited'
  /** The invitation expired or was withdrawn. Nothing reaches them until it is sent again. */
  | 'invite-lapsed'
  /** The membership is kept for the books; the person's account has been erased. */
  | 'account-erased';

/** Title case, and each one short enough to head a column. */
export const APP_ACCOUNT_LABEL: Record<AppAccount, string> = {
  'on-the-app': 'On the App',
  invited: 'Invited, Not Joined',
  'invite-lapsed': 'Invitation Lapsed',
  'account-erased': 'Account Erased',
};

/** Sentence case: what the state means, in the words an owner would use. */
export const APP_ACCOUNT_MEANS: Record<AppAccount, string> = {
  'on-the-app':
    'Holds a membership, which this database cannot record without a Repple account behind it. A notice posted from this screen lands in their inbox.',
  invited:
    'The gym typed them in and the invitation is still open. There is no account yet, so nothing sent from this console reaches them — only the email address on the invitation does.',
  'invite-lapsed':
    'The invitation ran out or was withdrawn, and it was never claimed. Send another one, or this person stays outside the app.',
  'account-erased':
    'The membership is kept because the invoices hang off it, and the account it belonged to has been erased. There is nothing left to send anything to.',
};

/** Why the two counts are never added. On the screen, under them. */
export const COUNTS_ARE_NOT_A_TOTAL =
  'These count two different records — a membership and an invitation — and this app cannot tell when they are the same person: the address on an invitation cannot be compared against the address on an account, which no policy in this database lets the console read. Somebody invited in March and signed up at the desk in April is in both columns, so adding them up would overstate the roster by exactly the people who were chased twice.';

/** Somebody on the gym's roster that nothing in the app can reach. */
export interface OffAppPerson {
  /** The row this came from — an invite id, or a membership id. Stable, so it
   *  is safe as a React key and it does not pretend to be a person's id. */
  key: string;
  name: string | null;
  /** The address the gym typed, for an invitation. Null for an erased account:
   *  there is no address left, and a blank is not one. */
  email: string | null;
  state: Exclude<AppAccount, 'on-the-app'>;
  /** The invitation's state as `inviteState` reads it, or null where this row is
   *  not an invitation. Kept so the screen can say 'expired' and 'revoked'
   *  apart without re-deriving them. */
  invite: MemberInviteState | null;
}

/**
 * How many are in each group, or null where the read behind that group did not
 * come back whole.
 *
 * Four independent nulls rather than one, because the two reads fail
 * separately: a gym whose invite table is refused still knows exactly how many
 * of its members hold an account, and blanking that as well would withhold a
 * true answer to protect a question nobody asked.
 */
export interface AppAccountCounts {
  onTheApp: number | null;
  accountErased: number | null;
  invited: number | null;
  inviteLapsed: number | null;
}

export interface AppAccountSplit {
  counts: AppAccountCounts;
  /**
   * Everybody the app cannot reach, listed. Null unless BOTH reads came back
   * whole — a partial list here is the worst possible object, because its
   * purpose is to be worked through, and a name missing from it is a person
   * nobody ever chases.
   */
  offTheApp: OffAppPerson[] | null;
}

/**
 * Sort a gym's roster by whether the app can reach the person.
 *
 * `rowsOf` throughout, so a truncated read counts as nothing rather than as a
 * smaller gym: 'partial' is not 'ready' (src/ui/loadStatus.ts), and a count over
 * a prefix would under-report the people who cannot be reached, which is the
 * one direction of error that makes this screen look reassuring when it is not.
 */
export function appAccountSplit(
  memberships: Slice<Membership>,
  invites: Slice<MemberInvite>,
  now: number = Date.now(),
): AppAccountSplit {
  const ms = rowsOf(memberships);
  const invs = rowsOf(invites);

  // One row per PERSON, not per membership: somebody who lapsed and rejoined
  // holds two, and they are one account.
  const held = new Set<string>();
  const erased: OffAppPerson[] = [];
  for (const m of ms ?? []) {
    // `Membership.memberId` is still typed `string` while the column is
    // nullable live — see the note on the field in src/lib/gymRecord.ts. This
    // is the falsy check `memberIds` makes for the same reason, and it is the
    // whole of what part 184 leaves behind.
    if (m.memberId) held.add(m.memberId);
    else {
      erased.push({
        key: m.id,
        name: m.memberName,
        email: null,
        state: 'account-erased',
        invite: null,
      });
    }
  }

  // Two invitations to one address are one person being chased twice, so they
  // are folded — and an OPEN one outranks a lapsed one, because what matters is
  // whether anything is currently in flight to them. An address that does not
  // parse is kept as its own row rather than dropped: it is a real invitation
  // that will never arrive, and dropping it would hide the reason.
  const byAddress = new Map<string, OffAppPerson>();
  const unaddressed: OffAppPerson[] = [];
  for (const inv of invs ?? []) {
    const st = inviteState(inv, now);
    // Accepted means the account exists and they are counted above, under the
    // membership they now hold. Counting them here as well is the double-count
    // COUNTS_ARE_NOT_A_TOTAL describes, committed inside one function.
    if (st === 'accepted') continue;
    const person: OffAppPerson = {
      key: inv.id,
      name: inv.fullName,
      email: inv.email,
      state: st === 'pending' ? 'invited' : 'invite-lapsed',
      invite: st,
    };
    const addr = normaliseEmail(inv.email);
    if (!addr) { unaddressed.push(person); continue; }
    const seen = byAddress.get(addr);
    if (!seen || (seen.state === 'invite-lapsed' && person.state === 'invited')) {
      byAddress.set(addr, person);
    }
  }
  const invited = [...byAddress.values(), ...unaddressed];

  return {
    counts: {
      onTheApp: ms ? held.size : null,
      accountErased: ms ? erased.length : null,
      invited: invs ? invited.filter((p) => p.state === 'invited').length : null,
      inviteLapsed: invs ? invited.filter((p) => p.state === 'invite-lapsed').length : null,
    },
    offTheApp: ms && invs
      ? [...invited, ...erased].sort(
        (a, b) => (a.name ?? a.email ?? '￿').localeCompare(b.name ?? b.email ?? '￿')
          || a.key.localeCompare(b.key),
      )
      : null,
  };
}

/**
 * The half-sentence that goes where the list would have been, naming which read
 * is missing. Null when there is a list.
 *
 * Composed from `sliceNote` rather than written again here: this console had
 * eleven hand-written two-armed versions of that sentence and every one of them
 * read a truncated slice as one still loading.
 */
export function offAppWithheld(
  memberships: Slice<Membership>,
  invites: Slice<MemberInvite>,
): string | null {
  const parts = [
    sliceNote(memberships, 'the membership list'),
    sliceNote(invites, 'the invitations'),
  ].filter((s): s is string => s != null);
  if (!parts.length) return null;
  return `${parts.join(', and ')}. Nobody is listed below rather than nobody being outside the app.`;
}
