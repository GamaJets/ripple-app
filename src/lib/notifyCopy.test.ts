// What a notification about a notice or an invoice is allowed to say.
// Compile with tsc, run with node.
//
// The three defects these assertions are aimed at:
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
import {
  NOTICE_BODY_MAX, NOTICE_ROUTE, NOTICE_TITLE_MAX,
  clip, deliverySummary, invoiceNotification, noticeNotification, pushConsequence,
} from './notifyCopy';
import { safeRoute } from './notifyInbox';
import type { CoachInvoice } from './coachInvoice';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── clipping ──────────────────────────────────────────────────────────── */

eq(clip('short', 20), 'short', 'text inside the cap is untouched');
eq(clip('  padded  ', 20), 'padded', 'the text is trimmed before it is measured');
ok(clip('x'.repeat(40), 10).length <= 10, 'a clipped string honours the cap it was given');
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

/* ── the control that wakes people up says so ──────────────────────────── */

const warn = pushConsequence('gym', 240);
ok(warn.includes('240 members'), 'the author is told how many phones this is');
ok(/straight away/i.test(warn) && /what ?ever time it is where they are/i.test(warn.replace('whatever', 'what ever')),
  'and that it happens now, wherever they are — there is no scheduler and no timezone on record');
eq(pushConsequence('coach', 1), 'Sends a push to 1 client straight away, at whatever time it is where they are. Without it the notice still reaches their notices and their notifications — quietly.',
  'one client is a client');
ok(/every member/.test(pushConsequence('gym', null)),
  'an uncounted audience is "every member", never a figure nobody counted');

if (errors.length) {
  console.error(`notifyCopy: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(' ✗ ' + e);
  process.exit(1);
}
console.log('notifyCopy: ok');
