// What a notification about a notice or an invoice is allowed to say.
// Compile with tsc, run with node.
//
// The four defects these assertions are aimed at:
//
//   1. A NOTICE THAT BECOMES THE APP'S WORDS. The body of a notice
//      notification is the author's own text and nothing may be appended to
//      it, reworded in it, or written in their voice around it. `messages.sender`
//      once came from the caller's own request, so a client could post into
//      their thread as 'coach'; supabase/parts/140 and src/lib/nudge.ts are
//      both built on never doing that again, and a fan-out is where it would
//      be easiest to lose.
//
//   2. AN INVOICE NOTIFICATION THAT CLAIMS MORE THAN THE INVOICE. Part 138 is
//      deliberate that a coach invoice is not a tax invoice and NOT proof that
//      money moved — `kind` is the coach's own unverified statement. A lock
//      screen is the easiest place in the product to upgrade "your coach says
//      you paid" into "you paid".
//
//   3. A COUNT NOBODY COUNTED. app/(owner)/promotions.tsx told an owner "Sent
//      to N members" where N was the number of member ROWS, over a send that
//      swallowed every failure. Nothing in the summary below may state a
//      figure that was not measured, and "could not be read" may never be
//      rendered as zero.
//
//   4. A CLOCK TIME WRITTEN BY A SERVER. `classStartsIn` is the wording a
//      database trigger uses to tell a member a class seat has opened
//      (supabase/parts/159). It is a duration and never a time of day, because
//      the trigger has no time zone to render one in, and a member told the
//      wrong hour for a class they are now booked into is worse off than one
//      told nothing. Nothing in this repository can run that plpgsql, so these
//      assertions are the only proof its five branches are right.
import {
  CLASS_OFF_ROUTE, CLASS_OFF_TITLE, CLASS_OFF_TITLE_MANY,
  COACH_ACCEPTED_ROUTE, COACH_DECLINED_ROUTE,
  NOTICE_BODY_MAX, NOTICE_ROUTE, NOTICE_TITLE_MAX,
  classOffBuckets, classOffConfirmation, classOffNotification, classStartsIn, clip,
  coachAnswerConfirmation, coachAnswerNotification,
  deliverySummary, invoiceNotification, noticeNotification, pushConsequence,
  PUSH_PARTIAL_NOTE, pushPartialNote,
} from './notifyCopy';
import { inboxDecision, safeRoute } from './notifyInbox';
import type { CoachInvoice } from './coachInvoice';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── clipping ──────────────────────────────────────────────────────────── */

eq(clip('short', 20), 'short', 'text inside the cap is untouched');
eq(clip('  padded  ', 20), 'padded', 'the text is trimmed before it is measured');
ok(clip('x'.repeat(40), 10).length <= 10, 'a clipped string honours the cap it was given');
// The boundary itself, which `<=` and `<` disagree about and nothing else here
// distinguishes: a string EXACTLY the length of the cap is inside it and must
// come back whole, not cut to nine characters and an ellipsis.
eq(clip('abcdefghij', 10), 'abcdefghij', 'text exactly the length of the cap is untouched');
eq(clip('abcdefghijk', 10).length, 10, 'and one character over is cut to the cap');
ok(clip('x'.repeat(40), 10).endsWith('…'), 'a clipped string says it was clipped');
// A hard cut mid-word reads as a bug; a cut at the last space reads as an
// abbreviation. But only when the space is late enough to leave most of it —
// otherwise one long word would reduce the whole notice to an ellipsis.
eq(clip('we are closed on monday morning', 20), 'we are closed on…', 'the cut prefers a word boundary');
ok(!clip('supercalifragilisticexpialidocious and more', 20).startsWith('…'),
  'a body whose first word is longer than the cap is still cut to something readable');

/* ── a notice is the author's words, with the app's heading ────────────── */

const BODY = 'No 6pm class this Thursday — the room is being re-floored.';

const coach = noticeNotification('coach', BODY);
eq(coach?.title, 'A notice from your coach', 'a coach notice is headed as one');
eq(coach?.body, BODY, 'the coach’s own words reach the inbox unaltered');

const gym = noticeNotification('gym', BODY, 'Iron & Oak');
eq(gym?.title, 'A notice from Iron & Oak', 'a gym notice is headed with the gym’s own name');
// Null is what the provider passes when the tenant's name has not been read.
// "your gym" is true; a placeholder name would not be.
eq(noticeNotification('gym', BODY, null)?.title, 'A notice from your gym',
  'an unread gym name gives a true generic heading rather than an invented one');
eq(noticeNotification('gym', BODY, '   ')?.title, 'A notice from your gym',
  'a blank gym name is the same as no gym name');

// The heading is the app speaking about a row RLS has tied to an author. The
// BODY is the only place the author's own text appears, and nothing is added to
// it — no "your coach says", no closing line, no signature.
ok(!/coach|gym/i.test(coach?.body ?? 'coach'), 'nothing about the author is written into the coach’s own sentence');
ok(!/coach|gym/i.test(gym?.body ?? 'gym'), 'nothing about the gym is written into its own sentence');

// notifications.body is `not null` and a heading alone tells a reader nothing —
// the same rule inboxDecision() applies to a bodiless push.
eq(noticeNotification('coach', ''), null, 'a blank notice is not a notification');
eq(noticeNotification('gym', '   \n '), null, 'a whitespace notice is not a notification');

// notify_users() stores left(body, 500). A long notice is cut on the way in
// whatever this file does; the point is that the reader can TELL, and that the
// archive screen is where the rest of it lives.
const long = noticeNotification('coach', 'a'.repeat(4000));
ok((long?.body.length ?? 0) <= NOTICE_BODY_MAX, 'a long notice is cut to what the column will store');
ok(long?.body.endsWith('…') === true, 'a cut notice says it was cut');
const longName = noticeNotification('gym', BODY, 'g'.repeat(400));
ok((longName?.title.length ?? 0) <= NOTICE_TITLE_MAX, 'a long gym name cannot overflow the title column');

// The route it carries has to be one the client build will actually follow —
// safeRoute() is what the inbox puts every stored route through, and a notice
// pointing somewhere that fails it would be an inert row for every recipient.
eq(safeRoute(NOTICE_ROUTE, 'client'), NOTICE_ROUTE, 'a notice sends a client to the notices screen');
eq(safeRoute(NOTICE_ROUTE, 'trainer'), null, 'and cannot send a coach build into the client group');

/* ── an invoice notification claims exactly what the invoice claims ────── */

const base: CoachInvoice = {
  id: 'i1', seq: 7, billTo: 'Sam Doyle', description: 'Ten personal training sessions',
  amountCents: 45000, currency: 'AED', kind: 'requested', issuedOn: '2026-09-01',
  note: null, voidedAt: null, voidReason: null, clientId: 'c1', createdAt: null,
};

const asked = invoiceNotification(base);
eq(asked.title, 'An invoice from your coach', 'a requested invoice is headed as an invoice');
ok(asked.body.includes('0007'), 'the number is stated, so two invoices are two things');
ok(asked.body.includes('AED 450.00'), 'the amount names the currency it is charged in');
ok(asked.body.includes('states'), 'the coach’s claim is worded as their claim');
ok(/ask them/i.test(asked.body), 'the client is told where the document comes from');
// What the invoice was FOR. It is the coach's own line and it is the only thing
// in the body that says which piece of work this is about — an invoice
// notification without it is a number and an amount and no subject.
ok(asked.body.includes('Ten personal training sessions'),
  'the coach’s own description of the work reaches the body intact');
// And it is capped on the way in, because `description` is free text and the
// whole body has to fit `left(body, 500)`.
const wordy = invoiceNotification({ ...base, description: 'session '.repeat(60).trim() });
ok(wordy.body.length <= NOTICE_BODY_MAX, 'a description nobody stopped typing cannot overflow the column');
ok(wordy.body.includes('…'), 'and the reader can tell it was cut');

const paid = invoiceNotification({ ...base, kind: 'received' });
eq(paid.title, 'Your coach recorded a payment', 'a received invoice says who recorded what');
ok(paid.body.includes('states this amount has been received'),
  'it reports the coach’s statement rather than asserting the payment');
ok(/not a payment receipt/i.test(paid.body), 'and says out loud what it is not');

// The sentence this whole file exists to keep out of an inbox. Part 138: Repple
// does not verify either value, so nothing here may say the money moved.
for (const inv of [asked, paid]) {
  ok(!/\byou (have )?paid\b/i.test(inv.body), 'no notification tells a client they have paid');
  ok(!/\bpaid in full\b/i.test(inv.body), 'no notification settles an account');
  ok(!/\bconfirmed\b/i.test(inv.body), 'nothing here is confirmed by this app');
  ok(inv.body.length <= NOTICE_BODY_MAX, 'the body fits the column that stores it');
}

// A currency nobody stated means NO FIGURE. A bare number is read in whatever
// money the reader is thinking in, which is the same wrong amount with fewer
// clues — the rule scripts/check-currency.mjs enforces everywhere else.
const noCcy = invoiceNotification({ ...base, currency: null });
ok(!/450/.test(noCcy.body), 'an amount with no currency is withheld, not printed bare');
ok(/could not be stated in a currency/i.test(noCcy.body), 'and the absence is explained rather than left as a gap');
ok(!/\b0\b/.test(noCcy.body), 'a missing amount is never rendered as zero');

// A description a coach typed is not trusted to be short.
ok(invoiceNotification({ ...base, description: 'd'.repeat(2000) }).body.length <= NOTICE_BODY_MAX,
  'a long description cannot push the body past the column');

/* ── what the author is told happened ──────────────────────────────────── */

// A read that FAILED is not a count of nobody. This is the distinction
// src/ui/loadStatus.ts exists for, in the one sentence the author acts on.
const unknown = deliverySummary({ recipients: null, recorded: null, push: 'off' });
ok(/nobody could be notified/i.test(unknown), 'a failed fan-out says so');
ok(!/\b0\b/.test(unknown), 'and never states zero for something nobody counted');

const none = deliverySummary({ recipients: 0, recorded: 0, push: 'off' });
ok(/nobody to notify/i.test(none), 'a gym with no members is told there is nobody, not that a send failed');

const some = deliverySummary({ recipients: 40, recorded: 38, push: 'off' });
ok(some.includes('38 of 40'), 'both figures are stated when they differ — skipped recipients are visible');

const all = deliverySummary({ recipients: 12, recorded: 12, push: 'off' });
ok(all.includes('12 people have'), 'a whole fan-out states one figure');
ok(deliverySummary({ recipients: 1, recorded: 1, push: 'off' }).includes('1 person has'),
  'one recipient is a person, not 1 people');

// Four digits go through num(). A gym pushing a notice to a chain of gyms
// reaches this, and `1204` unseparated is what scripts/check-numbers.mjs exists
// for.
ok(deliverySummary({ recipients: 1204, recorded: 1204, push: 'off' }).includes('1,204'),
  'a four-figure count carries its separator');

// Nothing anywhere may claim delivery. A push is queued with Expo; an inbox row
// is seen when somebody opens the app. Neither is something this app witnessed.
for (const s of [unknown, none, some, all]) {
  ok(!/\bdelivered\b/i.test(s), 'no summary claims delivery');
  ok(!/\bsent to\b/i.test(s), 'no summary repeats the promotions screen’s "Sent to N members"');
}

ok(/queued/i.test(deliverySummary({ recipients: 3, recorded: 3, push: 'queued' })),
  'a push that went out is described as queued rather than received');
ok(deliverySummary({ recipients: 3, recorded: 3, push: 'failed', pushError: 'Not connected to the server.' })
  .includes('Not connected to the server.'),
  'a failed push reports the server’s own reason, which is the part an author can act on');
ok(/did not go out/i.test(deliverySummary({ recipients: 3, recorded: 3, push: 'failed', pushError: null })),
  'a failed push with no reason still says it failed');
ok(/no push/i.test(deliverySummary({ recipients: 3, recorded: 3, push: 'off' })),
  'not pushing is stated too — silence about it would read as a push');

/* ── a send that was accepted and did not reach everybody ─────────────────
 *
 * send-push pages its recipient list and returns `partial: true` when a chunk
 * of it could not be read, so `sent` is a floor. Nothing in the app read that
 * flag: `sendPushChecked` discarded the function's response and every caller
 * took `ok: true` for "it went to everybody" — the truncation-as-total defect
 * one layer out from the one send-push's paging fixed.
 */

const partial = deliverySummary({ recipients: 900, recorded: 900, push: 'queued', pushPartial: true });
ok(/not all of the recipient list could be read/i.test(partial),
  'a partly-read recipient list is said out loud rather than reported as a send that went out');
ok(/notifications/i.test(partial),
  'and the inbox rows, which DID all land, are still credited — the two halves are different facts');
ok(!/\bdelivered\b/i.test(partial), 'still nothing claims delivery');
// The ordinary queued sentence must not appear as well: two sentences about
// the same push, one of them reassuring, is worse than either alone.
ok(!/only people on a push-enabled build/i.test(partial),
  'the partial sentence REPLACES the ordinary one rather than being appended to it');
ok(!/not all of the recipient list/i.test(deliverySummary({ recipients: 3, recorded: 3, push: 'queued' })),
  'and a send with nothing wrong carries no warning — an absent flag is not a truncation');
ok(!/not all of the recipient list/i.test(deliverySummary({ recipients: 3, recorded: 3, push: 'queued', pushPartial: false })),
  'nor does an explicit false');

/* ── a fan-out that ran into the ceiling inside notify_users() ───────────── */
//
// supabase/parts/122 ends its recipient CTE with `limit 2000` and returns the
// number of rows written, so past two thousand recipients the answer is a floor
// wearing a count's clothes. An owner announcing a closure to 2,400 members was
// told "2,000 people have it", and the four hundred who were skipped were
// counted out of the sentence they were missing from.

const atCap = deliverySummary({ recipients: 2400, recorded: 2000, push: 'off', recordedAtCap: true });
ok(/at least/i.test(atCap), 'a floor is stated as a floor');
ok(atCap.includes('2,000'), 'the rows that were written are still counted, with their separator');
ok(!atCap.includes('2,400'), 'and the number addressed is not stated beside it');
// 2400 − 2000 is not the number of people who were skipped: `notify_users`
// also drops recipients the caller may not reach, so the difference conflates
// two causes. Neither figure may be presented as the shortfall.
ok(!atCap.includes('400'), 'and the difference is never presented as the number missed');
ok(!/send it again/i.test(atCap),
  'no remedy is offered — the ceiling has no ORDER BY, so a second send would address an arbitrary two thousand');
ok(!/\bdelivered\b/i.test(atCap), 'and still nothing claims delivery');
ok(!/at least/i.test(deliverySummary({ recipients: 40, recorded: 38, push: 'off' })),
  'an ordinary fan-out under the ceiling says nothing about one');

/* ── a recipient list that was itself capped ─────────────────────────────── */
//
// src/ui/announcements.tsx read the coach's roster with `capLimit()` and then
// used every row it got, probe row included, as the number of people addressed.
// `recipients` under this flag is a floor, so the sentence states neither it
// nor a comparison against it.

const cappedList = deliverySummary({ recipients: 1001, recorded: 998, push: 'off', recipientsTruncated: true });
ok(/more people to address than this app could read/i.test(cappedList),
  'a capped roster admits that the list is not the whole roster');
// 998 rows were counted by notify_users and may be stated. 1001 is the probe
// row plus the cap — a floor nobody counted — and must appear nowhere, in
// particular not as the second half of "998 of 1,001", which invites the author
// to go looking for three people who are not the ones missing.
ok(cappedList.includes('998'), 'the rows that were actually written are still counted');
ok(!cappedList.includes('1,001'), 'and the floor is never stated as a total');
ok(!/\bof\b/.test(cappedList.split('.')[0]), 'nor compared against, when one of the two is not a count');

/* ── the control that wakes people up says so ──────────────────────────── */

const warn = pushConsequence('gym', 240);
ok(warn.includes('240 members'), 'the author is told how many phones this is');
ok(/straight away/i.test(warn) && /what ?ever time it is where they are/i.test(warn.replace('whatever', 'what ever')),
  'and that it happens now, wherever they are — there is no scheduler and no timezone on record');
eq(pushConsequence('coach', 1), 'Sends a push to 1 client straight away, at whatever time it is where they are. Without it the notice still reaches their notices and their notifications — quietly.',
  'one client is a client');
ok(/every member/.test(pushConsequence('gym', null)),
  'an uncounted audience is "every member", never a figure nobody counted');

/* ── how long until a class starts ─────────────────────────────────────────
 *
 * Mirrored band for band by supabase/parts/159 · class_promotion_notify. Every
 * boundary below is a line in that plpgsql too.
 */

const T0 = Date.UTC(2026, 8, 1, 12, 0, 0);
const MIN = 60_000, HR = 60 * MIN, DAY = 24 * HR;

eq(classStartsIn(T0 - 1, T0), 'It has already started.', 'a class one millisecond into the past has started');
eq(classStartsIn(T0, T0), 'It has already started.', 'and so has one starting exactly now');
eq(classStartsIn(T0 - 3 * HR, T0), 'It has already started.',
  'a promotion into a class three hours gone says so rather than counting down');

eq(classStartsIn(T0 + 1, T0), 'It starts in under an hour.', 'a millisecond away is under an hour');
eq(classStartsIn(T0 + 59 * MIN, T0), 'It starts in under an hour.', 'fifty-nine minutes is still under an hour');
// The boundary the naive version gets wrong: rounding 30 minutes to the nearest
// hour gives 1, so "about an hour" would swallow the whole first hour and
// "under an hour" would be unreachable.
eq(classStartsIn(T0 + 30 * MIN, T0), 'It starts in under an hour.', 'half an hour is under an hour and not "about an hour"');

eq(classStartsIn(T0 + HR, T0), 'It starts in about an hour.', 'exactly an hour is an hour');
eq(classStartsIn(T0 + 89 * MIN, T0), 'It starts in about an hour.',
  'an hour and a half rounds down to one — singular, never "1 hours"');
eq(classStartsIn(T0 + 91 * MIN, T0), 'It starts in about 2 hours.', 'and just over rounds up to two');
eq(classStartsIn(T0 + 6 * HR, T0), 'It starts in about 6 hours.', 'six hours');
eq(classStartsIn(T0 + 23 * HR, T0), 'It starts in about 23 hours.', 'twenty-three hours is still counted in hours');

// 23h40m rounds to 24 hours, which must NOT render as "about 24 hours": it falls
// through to the day band and comes back as a day.
eq(classStartsIn(T0 + 23 * HR + 40 * MIN, T0), 'It starts in about a day.', 'twenty-four hours is a day, not "24 hours"');
eq(classStartsIn(T0 + DAY, T0), 'It starts in about a day.', 'exactly a day');
eq(classStartsIn(T0 + 30 * HR, T0), 'It starts in about a day.',
  'thirty hours rounds down to one day — singular, never "1 days"');
// And the far side of that boundary, so the day band is pinned at both ends.
eq(classStartsIn(T0 + 36 * HR, T0), 'It starts in about 2 days.', 'a day and a half rounds up to two');
eq(classStartsIn(T0 + 2 * DAY, T0), 'It starts in about 2 days.', 'two days');
eq(classStartsIn(T0 + 13 * DAY, T0), 'It starts in about 13 days.', 'a fortnight away is still answerable');

// Nothing here may ever produce a date, a weekday or a time of day: the trigger
// that writes it has no time zone to be right about. Swept over the whole range
// rather than checked on one value, because a single new branch is how one would
// get in.
for (const ms of [-DAY, -1, 0, 1, 30 * MIN, HR, 5 * HR, 23 * HR, DAY, 9 * DAY]) {
  const said = classStartsIn(T0 + ms, T0);
  ok(!/\d{1,2}[:.]\d{2}/.test(said), `“${said}” states no clock time`);
  ok(!/(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(said),
    `“${said}” names no day and no month`);
  ok(said.endsWith('.'), `“${said}” is a sentence — the body is concatenated either side of it`);
}

// A gap in a sentence rather than the word NaN in somebody's notifications.
eq(classStartsIn(NaN, T0), '', 'an unreadable start time produces nothing at all');
eq(classStartsIn(T0, NaN), '', 'and so does an unreadable now');
eq(classStartsIn(Infinity, T0), '', 'infinity is not a start time');


/* ── an answer to a coaching request ────────────────────────────────────────
 *
 * The fifth defect these assertions are aimed at: A PERSON LEFT WAITING ON AN
 * ANSWER THAT HAS ALREADY BEEN GIVEN. `coach_requests_notify_trainer` is
 * `after insert`, so the coach's answer wrote no row and sent nothing, and a
 * DECLINED client sees exactly what they saw the day before — a request they
 * believe is pending — for as long as they are willing to wait.
 */

{
  const yes = coachAnswerNotification(true, 'Alex Rivera');
  const no = coachAnswerNotification(false, 'Alex Rivera');
  ok(yes.title !== no.title, 'a yes and a no do not share a heading');
  ok(/accepted/i.test(yes.title), 'the yes says so in the heading, which is the half that renders on a lock screen');
  ok(/declined/i.test(no.title), 'and so does the no');
  ok(yes.body.includes('Alex Rivera'), 'the coach is named');
  ok(no.body.includes('Alex Rivera'), 'in both');
  // Two screens, because they are two different next steps.
  eq(yes.route, COACH_ACCEPTED_ROUTE, 'an accepted request opens the screen that just changed');
  eq(no.route, COACH_DECLINED_ROUTE, 'a declined one opens the only useful next step');
  ok(yes.route !== no.route, 'and they are not the same screen');
  eq(safeRoute(yes.route, 'client'), yes.route, 'the accepted route is one the client app will open');
  eq(safeRoute(no.route, 'client'), no.route, 'and so is the declined one');
  // A name that could not be read is a subject that is still there.
  for (const missing of [null, undefined, '', '   ']) {
    const n = coachAnswerNotification(false, missing);
    ok(!n.body.startsWith(' '), `a ${JSON.stringify(missing)} name does not leave the sentence starting with a space`);
    ok(n.body.includes('The coach you asked'), 'it names them as best it can rather than dropping the subject');
  }
  // The decline is not softened into a reason nobody gave.
  ok(!/not taking|right now|at the moment/i.test(no.body),
    'the decline states what happened and invents no reason on the coach\u2019s behalf');
  // Recorded, both. Nothing else in the product would ever tell them.
  ok(inboxDecision(yes.title, yes.body, yes.route).record, 'an accepted request is worth an inbox row');
  ok(inboxDecision(no.title, no.body, no.route).record, 'and a declined one is the row that matters most');
}

/* what the coach is told, which is never more than happened */
{
  const sent = coachAnswerConfirmation(true, 'Sam', { ok: true, recorded: 1 });
  const rowOnly = coachAnswerConfirmation(true, 'Sam', { ok: false, recorded: 1 });
  const neither = coachAnswerConfirmation(true, 'Sam', { ok: false, recorded: 0 });
  ok(sent !== rowOnly && rowOnly !== neither && sent !== neither,
    'three outcomes, three sentences');
  for (const line of [sent, rowOnly, neither]) {
    ok(line.startsWith('Sam is now on your roster.'), 'the write that did happen is stated first, in every branch');
    ok(!/delivered/i.test(line), 'nothing claims a delivery this app never witnessed');
  }
  ok(!/couldn/i.test(sent), 'the successful branch does not hedge');
  ok(/couldn\u2019t reach their phone/.test(rowOnly), 'the row-only branch says the phone was not reached');
  ok(/notifications the next time they open/.test(rowOnly), 'and where they will find it instead');
  ok(/nothing was written to their notifications/.test(neither), 'the nothing-happened branch says nothing happened');

  const declined = coachAnswerConfirmation(false, 'Sam', { ok: false, recorded: 0 });
  ok(declined.includes('still waiting on you'),
    'a decline nobody could deliver says the consequence out loud: their app still shows it pending');
  ok(!coachAnswerConfirmation(false, 'Sam', { ok: true, recorded: 1 }).includes('roster'),
    'a decline never says roster');
  ok(coachAnswerConfirmation(true, '   ', { ok: true, recorded: 1 }).startsWith('That client is now on your roster.'),
    'a name that could not be read still leaves a sentence with a subject, and a grammatical one');
}

/* ── a class that was called off ────────────────────────────────────────────
 *
 * The sixth: A ROW THAT IS NOT A PHONE. supabase/parts/493 writes one
 * `notifications` row per member the moment a class is called off, and nothing
 * in that schema can turn it into a push — so twelve people booked on a 6am
 * still find out when they next open the app, which is after they have
 * travelled to a locked room.
 */

{
  // Mirrors the literal in supabase/parts/493 · class_cancelled_notify. The
  // banner and the row a member later scrolls past have to be the same event.
  eq(CLASS_OFF_TITLE, 'A class you booked is not running', 'the singular title is part 493\u2019s own');

  const one = classOffNotification('Spin', 1, 'the instructor is off sick');
  eq(one.title, CLASS_OFF_TITLE, 'one class off gets the singular heading');
  ok(one.body.includes('Spin'), 'the class is named');
  ok(one.body.includes('the instructor is off sick'), 'the reason the coach typed is passed on, not summarised');
  eq(one.route, CLASS_OFF_ROUTE, 'it opens the timetable');
  eq(safeRoute(one.route, 'client'), one.route, 'which is a screen the client app has');

  const many = classOffNotification('Spin', 3, 'the room is being re-floored');
  eq(many.title, CLASS_OFF_TITLE_MANY, 'more than one gets the plural heading');
  ok(many.body.includes('3'), 'and says how many of THEIR bookings went');

  const noReason = classOffNotification('Spin', 1, '   ');
  ok(!noReason.body.includes(':'), 'a blank reason leaves no dangling colon');
  const noName = classOffNotification(null, 1, null);
  ok(noName.body.includes('A class'), 'a class with no title is still a class');

  // No clock time and no calendar date, for the reason classStartsIn is
  // written for: nothing here has a time zone to render one in.
  for (const n of [one, many, noReason]) {
    ok(!/\b\d{1,2}[:.]\d{2}\b/.test(n.body), 'no clock time in a body composed without a zone');
    ok(!/\b(mon|tue|wed|thu|fri|sat|sun)day\b/i.test(n.body), 'and no weekday either');
  }

  // NOT recorded: part 493 wrote that row already.
  ok(!inboxDecision(one.title, one.body, one.route).record,
    'the singular class-off push leaves the row to the trigger');
  ok(!inboxDecision(many.title, many.body, many.route).record,
    'and so does the plural one');
}

/* who gets which sentence */
{
  eq(classOffBuckets([]).length, 0, 'nothing cancelled reaches nobody');
  const one = classOffBuckets([{ userId: 'a', classId: 'c1' }, { userId: 'b', classId: 'c1' }]);
  eq(one.length, 1, 'one class off is one send');
  eq(one[0].classes, 1, 'and everybody on it is told one');
  eq(one[0].userIds.join(','), 'a,b', 'with the roster in it');

  // A member holding both a booking and a waiting-list row on the same class is
  // still one class they are not going to.
  const dup = classOffBuckets([{ userId: 'a', classId: 'c1' }, { userId: 'a', classId: 'c1' }]);
  eq(dup.length, 1, 'a duplicated pair is one bucket');
  eq(dup[0].classes, 1, 'and one class, not two');

  // A series. Nobody is told a figure about somebody else's diary.
  const series = classOffBuckets([
    { userId: 'a', classId: 'c1' }, { userId: 'a', classId: 'c2' }, { userId: 'a', classId: 'c3' },
    { userId: 'b', classId: 'c1' },
    { userId: 'c', classId: 'c2' }, { userId: 'c', classId: 'c3' },
  ]);
  eq(series.length, 3, 'three distinct counts is three sends, not six');
  eq(series.map((x) => x.classes).join(','), '1,2,3', 'ordered by how many each of them lost');
  eq(series[0].userIds.join(','), 'b', 'the person who lost one is told one');
  eq(series[2].userIds.join(','), 'a', 'and the person who lost three is told three');

  // Damage is dropped rather than counted.
  eq(classOffBuckets([{ userId: '', classId: 'c1' }, { userId: 'a', classId: '  ' }]).length, 0,
    'a row with no person or no class is not somebody to notify');
}

/* what the coach is told about the fan-out */
{
  const unread = classOffConfirmation(1, null, null);
  ok(unread.includes('couldn\u2019t read who had booked'),
    'a roster that could not be read is never reported as nobody');
  ok(!/\bnobody had booked\b/i.test(unread), 'and is not collapsed into the empty case');
  ok(classOffConfirmation(1, 0, 0).includes('Nobody had booked'), 'an empty class had nobody to tell');
  ok(classOffConfirmation(1, 4, 0).includes('tell them yourself'),
    'four people and no push reached is four people the coach has to tell');
  ok(classOffConfirmation(1, 4, 2).includes('2 of them'), 'a partial fan-out says which part');
  ok(classOffConfirmation(1, 4, 4).includes('all of them'), 'and a whole one says so');
  for (const line of [unread, classOffConfirmation(9, 4, 4), classOffConfirmation(1, 4, 2)]) {
    ok(!/delivered/i.test(line), 'a queued push is never called a delivery');
    // The row is part 493's and this app cannot see whether it landed, so
    // nothing here may promise it is in anybody's notifications.
    ok(!/in their notifications/i.test(line),
      'nothing claims a row this app did not write and cannot see');
  }
  ok(classOffConfirmation(1, 1, 1).includes('1 class was'), 'one is singular');
  ok(classOffConfirmation(9, 1, 1).includes('9 classes were'), 'nine is not');
}

/* ── a room that was only partly reached ───────────────────────────────────
 *
 * send-push pages `push_tokens` and says `partial` when it could not read all
 * of them. app/(trainer)/classes.tsx threw that away, so a send that resolved
 * an unknown fraction of a full class was reported as "a push was queued to
 * all of them" — the sentence a coach reads and then does not ring anybody.
 */
{
  const whole = classOffConfirmation(1, 12, 12, true);
  ok(!/all of them/i.test(whole),
    'a partly-read handset list withdraws exactly the claim that everybody got one');
  ok(whole.includes(PUSH_PARTIAL_NOTE),
    'and says why in the one wording this product has for it, not a fifth');
  ok(/tell them yourself/i.test(whole), 'and leaves the coach with something to do about it');
  ok(!/in their notifications/i.test(whole), 'still nothing claims a row this app did not write');

  const some = classOffConfirmation(1, 12, 8, true);
  ok(some.includes('8 of them'), 'the number that WAS handed over is still stated');
  ok(some.includes(PUSH_PARTIAL_NOTE), 'with the same clause after it');
  ok(!/couldn\u2019t reach the rest/i.test(some),
    'and not the confident "we could not reach the rest", which names a set nobody counted');

  // A partly-read list is not a failed send: some of the room was woken up.
  ok(!/couldn\u2019t reach any of their phones/i.test(classOffConfirmation(1, 12, 12, true)),
    'a partial send is never collapsed into the nobody-was-told branch');
  // And an absent flag changes nothing, so every existing caller keeps its
  // sentence.
  ok(classOffConfirmation(1, 12, 12) === classOffConfirmation(1, 12, 12, false),
    'an explicit false is the same as saying nothing');
  ok(!classOffConfirmation(1, 12, 12).includes(PUSH_PARTIAL_NOTE),
    'and a send with nothing wrong carries no warning');
}

/* ── one wording, and its one-person form ────────────────────────────────── */
{
  // The five screens that state a delivery count all say this, and they say it
  // with the same words. `deliverySummary` is the one that had it first.
  ok(deliverySummary({ recipients: 900, recorded: 900, push: 'queued', pushPartial: true })
    .includes(PUSH_PARTIAL_NOTE),
    'the summary that owned this sentence now shares the constant rather than a copy of it');
  ok(pushPartialNote(4) === PUSH_PARTIAL_NOTE, 'a crowd gets the crowd wording');
  ok(pushPartialNote() === PUSH_PARTIAL_NOTE, 'and so does an unstated number');
  const one = pushPartialNote(1);
  ok(one !== PUSH_PARTIAL_NOTE, 'one recipient is not "more people"');
  ok(!/more people/i.test(one), 'which is the half that would have been false');
  ok(one.startsWith('Not all of the recipient list could be read'),
    'and the CAUSE — the half a reader can act on — is word for word the same');
}

if (errors.length) {
  console.error(`notifyCopy: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(' ✗ ' + e);
  process.exit(1);
}
console.log('notifyCopy: ok');
