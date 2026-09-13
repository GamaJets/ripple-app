// The rules behind offering a hand-added client a way onto the app.
//
// Every assertion here is about one of two mistakes: telling a coach somebody
// was invited when they were not, or writing over an invitation that had
// already been accepted. Neither is visible on a screen — `sendInvite` upserts,
// so the second one succeeds — which is why they are asserted here rather than
// looked at.
import {
  inviteEmail, inviteMode, inviteOffer, inviteSendBlocker, invitedLine,
  notRecordedLine, type PriorInvite,
} from './clientInvite';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
};

/* ── the address, normalised the way the upsert will write it ───────────── */

eq(inviteEmail('  Sam@Example.COM '), 'sam@example.com',
  'trimmed and lower-cased, because coach_invites is unique on (coach_id, email)');
eq(inviteEmail('sam'), null, 'a pasted name is not an address');
eq(inviteEmail('sam@example'), null, 'no dotted domain is not an address');
eq(inviteEmail('sam@example.com,'), null, 'a trailing comma is the commonest paste and is refused');
eq(inviteEmail(''), null, 'an empty field is not an address');
eq(inviteEmail(null), null, 'and neither is nothing at all');

// Case is normalised and nothing else is. `.` and `+` are significant on plenty
// of mail servers, and a coach whose clients are first.last@ would find two
// different people collapsing onto one invitation.
eq(inviteEmail('First.Last+gym@example.com'), 'first.last+gym@example.com',
  'dots and plus addressing survive; only case and whitespace are touched');

/* ── whether the offer appears at all ───────────────────────────────────── */

const handAdded = inviteOffer(true, 'Priya');
ok(handAdded.offer, 'a client the coach typed in is the whole point of this');
ok(handAdded.offer && handAdded.head.includes('Priya'), 'and the offer names them');

// The two withholding cases are different facts and the screen says different
// things about them, so they are not collapsed into one false.
eq(inviteOffer(false, 'Priya'), { offer: false, why: 'has-account' },
  'somebody with a Repple account is not invited onto it again');
eq(inviteOffer(undefined, 'Priya'), { offer: false, why: 'not-said' },
  'the roster has not said yet, which is not the same as them having an account');
eq(inviteOffer(null, 'Priya'), { offer: false, why: 'not-said' },
  'a row from an older build carries no flag and is treated the same way');

// The opposite default from clientIsQueryable, deliberately. That one risks a
// wasted read; this one risks a write against a live account.
ok(!inviteOffer(undefined, 'Priya').offer,
  'an unknown handAdded withholds a WRITE even though it does not withhold a read');

// A roster row with no name still gets a working offer rather than a sentence
// with a hole where the subject should be.
const nameless = inviteOffer(true, '   ');
ok(nameless.offer && !nameless.head.includes('  '), 'a blank name does not leave a gap in the heading');

/* ── the refusals ───────────────────────────────────────────────────────── */

const none: PriorInvite[] = [];

eq(inviteSendBlocker('not-an-address', none) !== null, true, 'a bad address is refused before any write');

// A failed read of the sent list is NOT an empty sent list. Under 'error'
// `sent` is empty for a coach who has sent fifty, and sending anyway is how the
// accepted-invitation case below gets reached silently.
ok(inviteSendBlocker('sam@example.com', null) !== null,
  'an unread list of prior invitations blocks the send');
ok((inviteSendBlocker('sam@example.com', null) || '').includes('Nothing has been recorded'),
  'and says so, rather than leaving the coach to guess whether it went');
ok(inviteSendBlocker('sam@example.com', undefined) !== null,
  'undefined is the same unread list as null');

eq(inviteSendBlocker('sam@example.com', none), null, 'with nothing on file, the send goes ahead');

const pending: PriorInvite[] = [{ email: 'Sam@Example.com', status: 'pending' }];
ok(inviteSendBlocker('sam@example.com', pending) !== null,
  'an invitation already waiting is not sent again');
// Matched through the same normaliser as the write, or a coach typing the
// address in a different case would sail past the duplicate check and hit the
// unique index instead — which surfaces as a system failure, not as "you
// already invited them".
ok(inviteSendBlocker('  SAM@EXAMPLE.COM ', pending) !== null,
  'the duplicate is caught whatever case it is typed in');

// The one with teeth. `sendInvite` upserts `{ status: 'pending' }` on
// (coach_id, email), so this would move an accepted row back to pending: the
// record of somebody joining is gone, a live invitation appears in front of a
// client already in the book, and the write reports success.
const accepted: PriorInvite[] = [{ email: 'sam@example.com', status: 'accepted' }];
ok(inviteSendBlocker('sam@example.com', accepted) !== null,
  'an accepted invitation is never overwritten by a second send');
ok((inviteSendBlocker('sam@example.com', accepted) || '').includes('pending'),
  'and the refusal says what the write would have done to it');

// Withdrawing one and sending it again is how a coach corrects an address they
// got wrong, so this is the one prior state that does not block.
const revoked: PriorInvite[] = [{ email: 'sam@example.com', status: 'revoked' }];
eq(inviteSendBlocker('sam@example.com', revoked), null,
  'a withdrawn invitation can be replaced — that is what withdrawing it was for');

// A status this build does not know is not treated as a clear road. Anything
// that is not pending or accepted falls through to the send, which is the same
// behaviour as revoked; what must not happen is a crash or a claim.
eq(inviteSendBlocker('sam@example.com', [{ email: 'sam@example.com', status: 'weird' }]), null,
  'an unrecognised status does not block, and does not throw');

// Somebody else's invitation is not this one.
eq(inviteSendBlocker('sam@example.com', [{ email: 'other@example.com', status: 'pending' }]), null,
  'a pending invitation to a different address is not in the way');

/* ── the sentences ──────────────────────────────────────────────────────── */

const sent = invitedLine('Priya', 'priya@example.com');
ok(sent.includes('priya@example.com'), 'the address is in the line, because that is what has to be spelled right');
ok(/does not email/i.test(sent),
  'and the app says it will not be writing to them — a coach who thinks it did waits for somebody nobody contacted');

const refused = notRecordedLine('Priya', 'priya@example.com');
ok(/NOT recorded/.test(refused), 'a refused write says so in the words the coach can act on');
ok(/coaching code/i.test(refused), 'and points at the path that does not depend on it');

// Neither sentence may start with a hole where the name goes.
ok(!invitedLine('', 'a@b.co').startsWith(' '), 'a missing name does not open the sentence with a space');
ok(!notRecordedLine('  ', 'a@b.co').startsWith(' '), 'nor the refusal');

/* ── the delivery the invitation carries ────────────────────────────────── */

eq(inviteMode('inperson'), 'inperson',
  'a client set up as in-person is invited as in-person, not defaulted to online');
eq(inviteMode('hybrid'), 'hybrid', 'part 57 widened the column to hybrid and this follows it');
eq(inviteMode('online'), 'online', 'online is carried through unchanged');
// 'solo' means nobody is coaching them, which cannot be true of somebody on
// this coach's roster, and coach_invites.mode would reject it outright.
eq(inviteMode('solo'), 'online', 'a value the column will not accept becomes the column default');
eq(inviteMode(null), 'online', 'and so does a row from an older build with nothing on it');
eq(inviteMode(undefined), 'online', 'and one that was never asked');

if (errors.length) {
  console.error(`clientInvite.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('clientInvite.test.ts — ok');
