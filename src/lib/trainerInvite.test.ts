// Inviting a coach from the console. Compile with tsc, run with node.
//
// Two failures worth a test, and both cost somebody real time: an invite sent
// to a typo'd address, which is a coach who never arrives and an owner who
// thinks they did; and a confirmation that implies an email was sent, when
// nothing in this product sends one.
import { readEmail, inviteBlocker, invitedLine, inviteStatusLine } from './trainerInvite';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── what counts as an address ────────────────────────────────────────────── */

eq(readEmail('  Coach@Example.COM '), 'coach@example.com', 'trimmed and folded, so two spellings are one address');
eq(readEmail('coach@example.com'), 'coach@example.com', 'an ordinary one is returned as it is');
eq(readEmail(''), null, 'an empty field is not an address');
eq(readEmail(null), null, 'and neither is nothing at all');
eq(readEmail('Dayne Gilson-Clarke'), null, 'a pasted NAME is refused rather than sent to');
eq(readEmail('coach@example'), null, 'a bare hostname with no dot is refused');
eq(readEmail('coach@@example.com'), null, 'and so is a double at-sign');
// The mistakes a person actually makes at a desk: a pasted list, a trailing
// comma from a spreadsheet.
eq(readEmail('a@b.com, c@d.com'), null, 'two addresses in one box is not one address');
eq(readEmail('coach@example.com,'), null, 'a trailing comma is a paste artefact, not an address');

/* ── the duplicate, caught before the unique index catches it ─────────────── */

const pending = [{ email: 'coach@example.com', status: 'pending' }];
const accepted = [{ email: 'coach@example.com', status: 'accepted' }];
const revoked = [{ email: 'coach@example.com', status: 'revoked' }];

eq(inviteBlocker('new@example.com', []), null, 'a first invite to a new address is fine');
ok(/already have an invite waiting/.test(inviteBlocker('coach@example.com', pending) ?? ''),
  'a second invite to a pending address is refused in words, not by a 23505');
ok(/already accepted/.test(inviteBlocker('COACH@example.com', accepted) ?? ''),
  'and the match is case-insensitive, because the index is on the folded address');
eq(inviteBlocker('coach@example.com', revoked), null,
  'a withdrawn invite may be sent again — that is the whole point of withdrawing one');

// A read that did not land blocks, and says why. Sending anyway risks the
// duplicate the owner cannot see, and the refusal is the cheaper direction.
{
  const line = inviteBlocker('new@example.com', null) ?? '';
  ok(/could not be read/.test(line), 'an unread invite list says so');
  ok(/Nothing has been sent/.test(line), 'and states that nothing happened');
  // Not a bare /already/: the sentence legitimately says "the invites ALREADY
  // ON FILE could not be read". What must never appear is the claim itself.
  ok(!/already have an invite|already accepted/.test(line),
    'and never claims they were invited or accepted, which it cannot know');
}

ok(/not an email address/.test(inviteBlocker('not-an-address', []) ?? ''),
  'a bad address is refused before anything else is considered');

/* ── the sentence that stops somebody waiting for a mail nobody sent ──────── */

{
  const line = invitedLine('coach@example.com');
  ok(line.includes('coach@example.com'), 'the confirmation names the address it wrote');
  ok(/does not email them/.test(line), 'and says outright that nothing was sent');
  ok(/tell them yourself/.test(line), 'and hands the next step to the person who has to do it');
  ok(/that exact address/.test(line), 'and warns that the address must match on sign-in');
}

/* ── a status this build does not know is not "fine" ──────────────────────── */

eq(inviteStatusLine('pending'), 'Waiting for them to sign in', 'pending reads as waiting');
eq(inviteStatusLine('accepted'), 'Accepted', 'accepted reads as accepted');
eq(inviteStatusLine('revoked'), 'Withdrawn', 'revoked reads as withdrawn');
ok(/not recognised/.test(inviteStatusLine('something_new')),
  'a status a later part adds shows as unknown rather than quietly as accepted');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('trainerInvite: ok (a name is not an address, a duplicate is refused in words, and nothing claims to have emailed anybody)');
