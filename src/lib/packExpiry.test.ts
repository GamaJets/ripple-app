// How long a session pack is good for, and every way that could take somebody's
// paid-for sessions away without them agreeing to it.
//
// Compile with tsc, then run under plain node.
//
// This is a feature whose failure mode is deleting money somebody has already
// spent, so each assertion below is aimed at a specific way it could:
//
//   · a coach leaving the field empty and getting a window anyway — there is no
//     default anywhere in this feature and there must never be one;
//   · a zero read as "no expiry" rather than refused, which is this code
//     choosing the opposite of what somebody typed;
//   · `expiresOn` landing a day out through a DST boundary, which is the
//     difference between a credit and a conversation on the last day;
//   · a pack reported as expired before the nightly pass has actually closed it,
//     while every draw site in the database would still happily spend one;
//   · a pack that ran out of time reading as a pack somebody used up, which is
//     the app taking the coach's side in a conversation it should be starting;
//   · a stranded count of nought producing a sentence about nothing.
//
// No formatted date is asserted against a locale — `npm test` runs under six
// timezones — and every date here is an explicit ISO day.
import {
  readValidityDays, validityLine, expiresOn, packWindow, daysLeftOn,
  expiryDayLabel, expiryLine, strandedNote,
  VALIDITY_MAX_DAYS, EXPIRING_SOON_DAYS,
  NO_VALIDITY_IS_FOREVER, VALIDITY_NOT_RETROACTIVE, EXPIRY_IS_NOT_A_REFUND,
} from './packExpiry';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── 1. what the coach typed, and the absence of a default ────────────────── */

// THE assertion this whole feature turns on. An empty box is a pack that does
// not expire — which is what every pack in this database does today — and a
// default of thirty or ninety days here would put a deadline on every pack every
// coach on the platform already sells.
const empty = readValidityDays('');
ok(empty.ok && empty.days === null, 'an empty validity is no window at all, never a default number of days');
const blank = readValidityDays('   ');
ok(blank.ok && blank.days === null, 'and so is a box with only spaces in it');
const missing = readValidityDays(null);
ok(missing.ok && missing.days === null, 'and so is nothing at all');

const ninety = readValidityDays('90');
ok(ninety.ok && ninety.days === 90, 'a number of days is that number of days');

// Refused, not reinterpreted. Reading 0 as "no expiry" would be this code
// choosing the opposite of what somebody typed into a box about their own
// product.
ok(readValidityDays('0').ok === false, 'a validity of zero is refused rather than read as no expiry');
ok(readValidityDays('-30').ok === false, 'and so is a negative one');
ok(readValidityDays('9.5').ok === false, 'and so is half a day');
ok(readValidityDays('ninety').ok === false, 'and so is a word');
ok(readValidityDays(String(VALIDITY_MAX_DAYS + 1)).ok === false, 'and so is one past the cap, which is a typo catch rather than a business rule');
ok(readValidityDays(String(VALIDITY_MAX_DAYS)).ok === true, 'the cap itself is allowed');

// Every refusal carries the reason, because a coach who taps Save and is told
// nothing concludes the app is broken.
for (const bad of ['0', '-30', '9.5', 'ninety']) {
  const r = readValidityDays(bad);
  ok(r.ok === false && typeof r.reason === 'string' && r.reason.length > 10,
    `"${bad}" is refused with a sentence, not a silent no`);
}

/* ── 2. the sentence under the field ──────────────────────────────────────── */

eq(validityLine(null), null, 'a pack with no window says nothing about one');
eq(validityLine(0), null, 'and neither does a nonsense one');
ok((validityLine(90) ?? '').includes('90'), 'a window states its own length');
ok((validityLine(1) ?? '').includes('a day'), 'one day is a day and not "1 days"');
ok(NO_VALIDITY_IS_FOREVER.length > 20, 'and there is a sentence for the empty box, so "no expiry" reads as a choice');
// The one thing a coach has to understand before they set one.
ok(/already/i.test(VALIDITY_NOT_RETROACTIVE), 'the note says what happens to packs somebody is already holding');

/* ── 3. the day, computed once and computed right ─────────────────────────── */

eq(expiresOn('2026-01-01', 90), '2026-04-01', 'ninety days from new year');
eq(expiresOn('2026-01-01T14:22:09.000Z', 90), '2026-04-01', 'an instant is read as its own day');
eq(expiresOn('2026-01-01', null), null, 'no window, no date');
eq(expiresOn('2026-01-01', 0), null, 'and a nonsense window is no date rather than the same day');
eq(expiresOn('not a date', 90), null, 'and a date that will not read produces no deadline at all, never a plausible wrong one');

// Across the March boundary in the northern hemisphere and the October one in
// the southern. `Date.UTC` on the parts is what makes these exact; a local
// `new Date(y, m, d + n)` runs through a DST change twice a year and the round
// trip back to a YYYY-MM-DD lands a day out. On somebody's paid-for sessions
// that day is the whole difference.
eq(expiresOn('2026-03-01', 30), '2026-03-31', 'thirty days across the northern spring change');
eq(expiresOn('2026-10-01', 30), '2026-10-31', 'thirty days across the southern one');
eq(expiresOn('2026-12-15', 30), '2027-01-14', 'and across a year end');
// A leap year, which is the other way a hand-rolled day count goes wrong.
eq(expiresOn('2028-02-01', 30), '2028-03-02', 'thirty days from the first of a leap February');

/* ── 4. where a pack stands ───────────────────────────────────────────────── */

const NO_WINDOW = { expiresOn: null };
eq(packWindow(NO_WINDOW, '2026-09-01'), 'none', 'a pack with no window is never expiring');
eq(packWindow({ expiresOn: 'rubbish' }, '2026-09-01'), 'none', 'and neither is one whose date will not read');

eq(packWindow({ expiresOn: '2026-12-01' }, '2026-09-01'), 'open', 'three months out is comfortably open');
eq(packWindow({ expiresOn: '2026-09-10' }, '2026-09-01'), 'soon', 'nine days out is soon');
eq(packWindow({ expiresOn: '2026-09-01' }, '2026-09-01'), 'soon', 'and the last day itself is still inside the window, not past it');
eq(packWindow({ expiresOn: plus('2026-09-01', EXPIRING_SOON_DAYS) }, '2026-09-01'), 'soon', 'the whole of EXPIRING_SOON_DAYS counts as soon');
eq(packWindow({ expiresOn: plus('2026-09-01', EXPIRING_SOON_DAYS + 1) }, '2026-09-01'), 'open', 'and a day past it does not');

// THE distinction this type exists for. Between midnight on the day after the
// last day and the nightly pass, the credits are STILL SPENDABLE — part 612
// reduces `sessions_total` when the pass runs, and until it does every draw
// site in the database will take one. Reporting that pack as closed would tell
// a client their sessions are gone while a booking would still draw off them.
eq(packWindow({ expiresOn: '2026-08-31' }, '2026-09-01'), 'lapsed', 'the day after the last day is lapsed and not yet closed');
eq(packWindow({ expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z' }, '2026-09-01'), 'closed',
  'and it is closed only once the pass has actually closed it');
// `expiredAt` wins outright, because it is the fact and the date comparison is
// an inference about one.
eq(packWindow({ expiresOn: '2027-01-01', expiredAt: '2026-09-01T07:33:00.000Z' }, '2026-09-01'), 'closed',
  'a pack the pass has closed is closed whatever its date says');

eq(daysLeftOn({ expiresOn: '2026-09-01' }, '2026-09-01'), 1, 'the last day is one day left, not nought');
eq(daysLeftOn({ expiresOn: '2026-09-10' }, '2026-09-01'), 10, 'and ten days out is ten');
eq(daysLeftOn({ expiresOn: '2026-08-31' }, '2026-09-01'), null, 'a window that has passed has no days left, which is not a count of zero');
eq(daysLeftOn(NO_WINDOW, '2026-09-01'), null, 'and neither has one that never existed');

/* ── 5. the words, and the two states they must not blur ──────────────────── */

// Silent on the ninety-nine per cent of packs this does not concern. A
// "does not expire" line under every pack in the product is noise.
eq(expiryLine(NO_WINDOW, 5, '2026-09-01'), null, 'nothing is said about a pack with no window');
eq(expiryLine({ expiresOn: '2026-12-01' }, 5, '2026-09-01'), null, 'and nothing about one that is comfortably open');

const soon = expiryLine({ expiresOn: '2026-09-05' }, 4, '2026-09-01') ?? '';
ok(soon.includes('4'), 'a closing window states what is still on the pack');
ok(/Sep/.test(soon), 'and the day it closes');
// Nothing to hurry for. A pack with nothing on it running out is not news.
eq(expiryLine({ expiresOn: '2026-09-05' }, 0, '2026-09-01'), null, 'a closing window on an empty pack says nothing');

const closedWithLoss = expiryLine(
  { expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z', sessionsExpired: 6 }, 0, '2026-09-01') ?? '';
ok(closedWithLoss.includes('6'), 'a pack that ran out with six on it says six');
ok(!/used/i.test(closedWithLoss), 'and never says they used them, because they did not');

const closedClean = expiryLine(
  { expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z', sessionsExpired: 0 }, 0, '2026-09-01') ?? '';
ok(/used/i.test(closedClean), 'a pack that ran out having been fully used says exactly that');
ok(closedClean !== closedWithLoss, 'the two are different sentences, which is the whole point of the column');

// ── a credit that came BACK on to a pack that was already over ────────────
//
// `refund_pack_session` (supabase/parts/123) decrements `sessions_used` on the
// newest pack with usage and does not ask whether that pack's window has
// closed. So a member whose session is refunded after their pack ran out holds
// a credit nothing in the database will let them draw. `packBalance` keeps it
// out of the hero — correct, a figure somebody books against must not contain a
// credit that cannot be booked — and counts it in `onClosedPacks` so it can be
// talked about. Nothing talked about it, and this line said the opposite.
const refundedOntoClosed = expiryLine(
  { expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z', sessionsExpired: 0 }, 1, '2026-09-01') ?? '';
ok(!/had been used/i.test(refundedOntoClosed),
  'a pack holding a refunded credit is never described as one where everything had been used — it had not, it was given back');
ok(refundedOntoClosed.includes('1'), 'the credit is counted out loud rather than quietly dropped');
ok(/cannot be booked/i.test(refundedOntoClosed),
  'and the member is told it cannot be spent, which is the fact they would otherwise discover at the door');
ok(/coach/i.test(refundedOntoClosed),
  'with the one person who can do anything about it named');

// Both things at once are two separate events and both are said.
const lostAndBack = expiryLine(
  { expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z', sessionsExpired: 6 }, 2, '2026-09-01') ?? '';
ok(lostAndBack.includes('6') && lostAndBack.includes('2'),
  'six stranded at expiry and two refunded afterwards are different facts on different days, and neither hides the other');

// The clean sentence survives, and only where it is true: both counts read,
// both nought.
ok(/used/i.test(expiryLine(
  { expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z', sessionsExpired: 0 }, 0, '2026-09-01') ?? ''),
  'a genuinely emptied pack still says so');
// An unread balance is not a nought here either: `left` null must not be read
// as "nothing came back".
ok(!/went back/i.test(expiryLine(
  { expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z', sessionsExpired: 0 }, null, '2026-09-01') ?? ''),
  'and an unread balance claims no refund it did not read');

/* ── 6. the coach's side of it ────────────────────────────────────────────── */

// Only ever about a pack that actually lost somebody something. A note about a
// pack that ran out empty is a message with nothing in it.
eq(strandedNote('Dana', { expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z', sessionsExpired: 0 }, '2026-09-01'), null,
  'there is nothing to raise about a pack that ran out having been used');
eq(strandedNote('Dana', { expiresOn: '2026-08-31' }, '2026-09-01'), null,
  'and nothing to raise about a window that has lapsed but not been closed — the credits are still spendable');
eq(strandedNote('Dana', NO_WINDOW, '2026-09-01'), null, 'and nothing at all about a pack with no window');

const raise = strandedNote('Dana Reyes', { expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z', sessionsExpired: 3 }, '2026-09-01') ?? '';
ok(raise.startsWith('Dana Reyes'), 'the note names the person the conversation is with');
ok(raise.includes('3'), 'and how many sessions they paid for and did not take');
ok(/yours to choose|better coming from you/i.test(raise), 'and leaves the decision with the coach rather than making it');

const unnamed = strandedNote(null, { expiresOn: '2026-08-31', expiredAt: '2026-09-01T07:33:00.000Z', sessionsExpired: 3 }, '2026-09-01') ?? '';
ok(unnamed.startsWith('This client'), 'a name we could not read never renders a sentence starting with a space');

ok(/not refunded|nothing gives them back/i.test(EXPIRY_IS_NOT_A_REFUND),
  'and the list says out loud that nothing hands a stranded credit back on its own');

/* ── 7. the day label, which is a calendar day and not an instant ─────────── */

eq(expiryDayLabel('2026-09-01'), '01 Sep 2026', 'a day reads the same shape as every date in a notification');
eq(expiryDayLabel(null), null, 'and a missing one is null rather than an invented date');
eq(expiryDayLabel('nope'), null, 'and so is an unreadable one');

/** `expiresOn` used as a test helper, so the two boundary cases above are
 *  written in days rather than in hand-computed dates that would go stale the
 *  moment EXPIRING_SOON_DAYS changed. */
function plus(day: string, n: number): string {
  return expiresOn(day, n) ?? day;
}

if (errors.length) {
  console.error(`packExpiry.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('packExpiry.test.ts — ok');
