// Which entitlement pays for a session, and what each app says about it.
// Compile with tsc, run with node.
//
// Eight things are defended here. Every one of them is a sentence that would look
// entirely ordinary on a screen while being false about somebody's money.
//
// 1. AN EXHAUSTED COACH PACK STILL BEATS A LIVE GYM PASS.  (And so does an
//    EXPIRED one — see 7.) This is the whole
//    choice rule and it is the one that is tempting to get wrong: falling
//    through onto the gym's pass when the coach's pack runs out looks generous,
//    spends a second business's money, and hides the conversation the coach and
//    the client need to have. `chooseRoute(true, true)` is 'coach_pack' and so
//    is `chooseRoute(true, false)`.
//
// 2. A BALANCE THAT WAS NOT READ IS NOT A BALANCE OF ZERO. Every count in here
//    propagates null. `creditsLeft(null)` is null, not 0, and a route with an
//    unread input is 'unknown' rather than 'none' — "you have none" and "we
//    could not look" are opposite statements to make to somebody who has paid.
//
// 3. AN EMPTY LEDGER UNDER A FAILED READ IS NOT AN EMPTY HISTORY.
//    `buildLedger(null, …)` is null, not `{past: [], upcoming: []}` — the
//    second reads as "you have never used a session" to somebody who has used
//    nine.
//
// 4. PAST AND FUTURE READ DIFFERENTLY. A draw is a fact with a date; an
//    upcoming booking is an expectation a cancellation can still change. Part
//    135's header refuses to draw 56 days ahead, so nothing here may claim a
//    credit is already spent for a session that has not happened — unless it
//    genuinely was, at booking, which is its own state.
//
// 5. A SHORTFALL IS NOT THE SAME AS PAYING CASH. A completed session with
//    nothing drawn is ordinary when the client holds nothing and is a defect
//    when they hold an entitlement that was empty. The two must never share a
//    sentence: one of them means a coach delivered an hour unpaid.
//
// 6. A PASS THAT DOES NOT COVER PT NEVER PAYS FOR A ONE-TO-ONE. A ten-CLASS
//    pack is not a ten-PT-session pack, and spending one on the other is the
//    "wrong credit" failure pointed at the member instead of the coach.
//
// 7. AN EXPIRED COACH PACK STILL WINS THE ROUTE. Part 370 picks route 1 on
//    `status = 'paid' and cp.sessions_total is not null` — no expiry clause,
//    no room clause — and part 612 closes a window without falsifying either.
//    So the app must not fall through onto the gym's pass when a pack runs out
//    of TIME, for the same reason it must not when one runs out of SESSIONS.
//
// 8. A SESSION SOMEBODY MARKED IS NOT "NOT MARKED YET". A no-show and a
//    cancellation are recorded facts with a person's name on them, and
//    'unmarked' means the opposite: nobody has said what happened.
//
// 9. A GYM PASS PAYS ONLY AT THE GYM THAT SOLD IT. Route 2 of part 370 matches
//    `p.tenant_id = new.tenant_id` — the pass's gym must equal the SESSION's
//    gym — and `sessions.tenant_id` is the TRAINER's `profiles.tenant_id`. So a
//    member's live gym PT pass pays for nothing when the hour is with an
//    independent coach or with a coach on another gym's staff, and counting it
//    is the same defect as 7 pointed the other way: the app naming a payer the
//    server will not use, and the coach later told they delivered it unpaid.
//    The pass is real, though, so it is named rather than shown as a nought.
//
// No formatted date is asserted against a literal — `npm test` runs under six
// timezones — and every instant here is an explicit ISO string.
import {
  chooseRoute, routeReason, creditsLeft, payingLines, passLiveOn, gymPtLines,
  coachPackLines, ledgerStateOf, buildLedger, expectedDraws,
  clientLedgerLine, coachLedgerLine, shortfallLine, bookingCreditNote,
  bookableCredits, creditsHeroNote, creditsEmptyLine,
  passesElsewhere, passesElsewhereLine,
  type CreditSession, type Entitlement, type LedgerState,
} from './sessionCredits';

const errors: string[] = [];
const ok = (c: boolean, m: string) => { if (!c) errors.push(`FAIL ${m}`); };
const eq = (a: unknown, b: unknown, m: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`FAIL ${m}\n  got      ${JSON.stringify(a)}\n  expected ${JSON.stringify(b)}`);
};

const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const PAST = '2026-08-20T10:00:00.000Z';
const FUTURE = '2026-09-20T10:00:00.000Z';

const session = (p: Partial<CreditSession> & { id: string }): CreditSession => ({
  startsAt: PAST,
  status: 'booked',
  outcome: null,
  seriesId: null,
  packDrawnAt: null,
  packDrawnKind: null,
  packDrawnPurchaseId: null,
  packDrawnPassId: null,
  shortfallAt: null,
  bookingDrewCreditAt: null,
  ...p,
});

/* ── 1 · the choice ───────────────────────────────────────────────────────── */

eq(chooseRoute(true, true), 'coach_pack',
  'holding both, the coach pack pays — it names both people who were in the room');
eq(chooseRoute(true, false), 'coach_pack', 'a coach pack with no gym pass beside it is still the coach pack');
eq(chooseRoute(false, true), 'gym_pass', 'no coach pack and a gym PT pass: the gym pass pays');
eq(chooseRoute(false, false), 'none', 'holding neither is an ordinary answer, not a failure');

// The one that costs somebody money if it is wrong. `holdsCoachPack` is "do
// they hold one AT ALL", empty included, so an empty coach pack does NOT fall
// through onto the gym's money.
eq(chooseRoute(true, true), 'coach_pack',
  'an exhausted coach pack is still the answer — a fall-through would spend the gym’s credit to hide the coach’s empty pack');

eq(chooseRoute(null, true), 'unknown', 'an unread coach history makes the route unknown, never “none”');
eq(chooseRoute(false, null), 'unknown', 'and so does an unread pass list, once it is the half that decides');
eq(chooseRoute(undefined, undefined), 'unknown', 'undefined is unread too, not false');

// Reading the coach pack answers the question on its own, so a failed pass read
// must NOT drag a known answer back to unknown.
eq(chooseRoute(true, null), 'coach_pack',
  'a pass read that failed cannot unsettle a route the coach pack has already decided');

ok((routeReason('unknown') || '').includes('could not'), 'the unknown route says we could not read it');
eq(routeReason('none'), null, 'somebody who holds nothing is told nothing — there is no pack to explain');

/* ── 2 · counting, and refusing to count ──────────────────────────────────── */

eq(creditsLeft(null), null, 'a list that could not be read is null, and null is not nought');
eq(creditsLeft(undefined), null, 'undefined is unread as well');
eq(creditsLeft([]), 0, 'an empty list IS an answer: they hold nothing, and 0 may be printed');

const packs: Entitlement[] = [
  { id: 'a', kind: 'coach_pack', label: '10-session pack', left: 3, sessions_total: 10, expiresOn: null },
  { id: 'b', kind: 'coach_pack', label: '5-session pack', left: 5, sessions_total: 5, expiresOn: null },
];
eq(creditsLeft(packs), 8, 'credits add up across packs');
eq(creditsLeft([{ id: 'c', kind: 'coach_pack', label: 'x', left: -4, sessions_total: 10, expiresOn: null }]), 0,
  'a negative balance never reaches a screen as a negative number');

eq(payingLines('none', packs, []), [], 'a client who holds nothing is shown nothing, not their old packs');
eq(payingLines('unknown', packs, []), null, 'an unknown route shows no lines at all rather than the wrong ones');
eq(payingLines('coach_pack', null, []), null, 'the paying side being unread is null, not an empty list');
eq((payingLines('gym_pass', packs, []) || []).length, 0,
  'on the gym route the coach packs are not listed — a screen showing both invites somebody to add them up');

/* ── 3 · gym passes: expiry, coverage and spend order ─────────────────────── */

ok(passLiveOn(null, '2026-09-01'), 'a pass with no expiry is live on any day');
ok(passLiveOn('2026-09-01', '2026-09-01'), 'a pass is live on the day it expires, not the day before it');
ok(!passLiveOn('2026-08-31', '2026-09-01'), 'and dead the day after');

const rawPasses = [
  { id: 'p1', passTypeId: 't1', passTypeName: 'Class ten', covers: 'visit', expiresOn: null, usesTotal: 10, usesSpent: 2 },
  { id: 'p2', passTypeId: 't2', passTypeName: 'PT ten', covers: 'pt', expiresOn: '2026-12-31', usesTotal: 10, usesSpent: 4 },
  { id: 'p3', passTypeId: 't3', passTypeName: 'PT five', covers: 'pt', expiresOn: '2026-09-30', usesTotal: 5, usesSpent: 0 },
  { id: 'p4', passTypeId: 't4', passTypeName: 'PT old', covers: 'pt', expiresOn: '2026-01-01', usesTotal: 5, usesSpent: 0 },
];
const pt = gymPtLines(rawPasses, '2026-09-01') as Entitlement[];
eq(pt.map((l) => l.id), ['p3', 'p2'],
  'only PT-covering passes, expiry soonest first, and the one that expired in January is gone');
eq(creditsLeft(pt), 11, 'six left on the PT ten and five on the PT five');
eq(gymPtLines(null, '2026-09-01'), null, 'an unread pass list is null');
eq(gymPtLines([], '2026-09-01'), [], 'a member with no passes has an empty list, which is a real answer');
eq((gymPtLines([rawPasses[0]], '2026-09-01') || []).length, 0,
  'a ten-CLASS pack pays for no part of a one-to-one, however many visits are left on it');

const unnamed = gymPtLines(
  [{ id: 'p9', passTypeId: null, passTypeName: null, covers: 'pt', expiresOn: null, usesTotal: 8, usesSpent: 1 }],
  '2026-09-01',
) as Entitlement[];
eq(unnamed[0].label, '8-session PT pass',
  'a pass whose type we cannot name is DESCRIBED by its size, never given a name we invented');

eq(coachPackLines(null), null, 'unread coach packs stay unread');
eq(coachPackLines([{ id: 'z', label: '10-session pack', left: 4, sessions_total: 10 }]),
  [{ id: 'z', kind: 'coach_pack', label: '10-session pack', left: 4, sessions_total: 10, expiresOn: null, expired: false }],
  'a pack with no window reports no date, rather than one this code chose');

/* THE LITERAL NULL THAT PART 612 MADE FALSE.

   This assertion used to read "a coach pack carries no expiry, because a coach
   pack has none in this schema", and `coachPackLines` wrote `expiresOn: null`
   on every line to match. Part 612 put a real `expires_on` on a coach pack,
   `PackLine` has carried it since, and this function threw it away — so a coach
   pack with three weeks left on it reached the picker as a pass that never runs
   out, sorted BEHIND every dated gym pass, and was offered with nothing saying
   it was about to be lost. The one ordering that does not throw a client's
   money away is soonest-to-expire first, and it was being fed a null. */

eq(coachPackLines([{ id: 'w', label: '10-session pack', left: 4, sessions_total: 10, expiresOn: '2026-09-30' }]),
  [{ id: 'w', kind: 'coach_pack', label: '10-session pack', left: 4, sessions_total: 10, expiresOn: '2026-09-30', expired: false }],
  'a pack that DOES have a window carries its own last day through');

/* THE PACK THAT WAS DROPPED BEFORE THE ROUTE WAS CHOSEN.

   This assertion used to read `['live']`, on the argument that a closed window
   is not an entitlement and putting one in a picker offers something that
   cannot be spent. It was answering a question about SPENDING with the list
   that answers a question about CHOOSING, and part 370 decides those with two
   different predicates. Its route-1 test — verified against the live function —
   is `status = 'paid' and cp.sessions_total is not null`, with no expiry clause
   and no room clause, and part 612 closes a window by moving `sessions_total`
   down to `sessions_used` while leaving both of those true.

   So the pack stays in the list and the caller who routes on it counts it. */
eq(coachPackLines([
  { id: 'gone', label: '10-session pack', left: 0, sessions_total: 10, expiresOn: '2026-06-30', expired: true },
  { id: 'live', label: '5-session pack', left: 2, sessions_total: 5 },
])!.map((e) => [e.id, e.expired]), [['gone', true], ['live', false]],
  'a pack whose window has closed is still a pack this coach sold them, and it is still what part 370 draws against');

/* ── 4 · one session's state ──────────────────────────────────────────────── */

const st = (s: CreditSession, r: Parameters<typeof ledgerStateOf>[1]): LedgerState => ledgerStateOf(s, r, NOW);

eq(st(session({ id: '1', outcome: 'completed', packDrawnAt: PAST, packDrawnKind: 'coach_pack' }), 'coach_pack'), 'drawn',
  'a stamped session is drawn, and that is a fact with a date on it');
eq(st(session({ id: '2', outcome: 'completed', packDrawnAt: PAST, packDrawnKind: 'gym_pass' }), 'gym_pass'), 'drawn',
  'and so is one paid by a gym pass');
eq(st(session({ id: '3', outcome: 'completed', bookingDrewCreditAt: '2026-08-01T09:00:00.000Z' }), 'coach_pack'), 'drawn_at_booking',
  'a one-off the client booked drew its credit at booking, and the ledger says when');
eq(st(session({ id: '4', outcome: 'completed', shortfallAt: PAST }), 'coach_pack'), 'shortfall',
  'delivered against an empty pack is a shortfall — the defect, not a quiet nothing');
eq(st(session({ id: '5', outcome: 'completed' }), 'none'), 'not_covered',
  'delivered while holding nothing is ordinary: they are paying another way');
eq(st(session({ id: '6', outcome: 'completed' }), 'unknown'), 'unknown',
  'delivered with an unreadable entitlement is unknown, never “nothing came off”');
eq(st(session({ id: '7' }), 'coach_pack'), 'unmarked',
  'a past session nobody has marked has drawn nothing, and says so');

eq(st(session({ id: '8', startsAt: FUTURE }), 'coach_pack'), 'expected',
  'a coach-booked one-off in the future is expected to draw at delivery');
eq(st(session({ id: '9', startsAt: FUTURE, bookingDrewCreditAt: '2026-09-01T09:00:00.000Z' }), 'coach_pack'), 'reserved',
  'a one-off the client booked themselves has ALREADY paid, out of the pack, at booking');
eq(st(session({ id: '10', startsAt: FUTURE, seriesId: 'S', bookingDrewCreditAt: '2026-09-01T09:00:00.000Z' }), 'coach_pack'), 'expected',
  'a standing appointment always draws at delivery, whatever else is stamped on it');
eq(st(session({ id: '11', startsAt: FUTURE, bookingDrewCreditAt: '2026-09-01T09:00:00.000Z' }), 'gym_pass'), 'expected',
  'the booking-time draw only ever touched a coach pack, so on the gym route it is still to come');
eq(st(session({ id: '12', startsAt: FUTURE }), 'none'), 'expected_none',
  'nothing is expected off a client who holds nothing');
eq(st(session({ id: '13', startsAt: FUTURE }), 'unknown'), 'unknown',
  'and nothing is predicted at all when we could not read what pays');

eq(st(session({ id: '14', outcome: 'no_show', bookingDrewCreditAt: PAST }), 'coach_pack'), 'drawn_at_booking',
  'a no-show that had already spent a credit at booking still spent one, and the client may see it');

/* ── 5 · the ledger ───────────────────────────────────────────────────────── */

eq(buildLedger(null, 'coach_pack', NOW), null,
  'a sessions read that failed is null — an empty ledger would read as “you have never used a session”');

const led = buildLedger([
  session({ id: 'past1', startsAt: PAST, outcome: 'completed', packDrawnAt: PAST, packDrawnKind: 'coach_pack', packDrawnPurchaseId: 'cp1' }),
  session({ id: 'past2', startsAt: '2026-08-25T10:00:00.000Z', outcome: 'completed', shortfallAt: PAST }),
  session({ id: 'soon', startsAt: FUTURE }),
  session({ id: 'later', startsAt: '2026-09-25T10:00:00.000Z' }),
  session({ id: 'openslot', startsAt: FUTURE, status: 'available' }),
], 'coach_pack', NOW)!;

eq(led.past.map((r) => r.sessionId), ['past2', 'past1'], 'the past reads newest first');
eq(led.upcoming.map((r) => r.sessionId), ['soon', 'later'], 'and the future soonest first');
ok(!led.past.concat(led.upcoming).some((r) => r.sessionId === 'openslot'),
  'an open slot nobody is booked into is not in anybody’s credit ledger');
eq(led.past[1].entitlementId, 'cp1', 'a drawn row names the pack it came off, so a return goes back to the same one');

eq(expectedDraws(led), 2, 'two upcoming bookings are each expected to take one credit');
eq(expectedDraws(null), null, 'an unread ledger predicts nothing');
eq(expectedDraws(buildLedger([session({ id: 'x', startsAt: FUTURE })], 'unknown', NOW)), null,
  'one unknown row makes the whole forecast unknown rather than an undercount');
eq(expectedDraws(buildLedger([session({ id: 'y', startsAt: FUTURE, bookingDrewCreditAt: PAST })], 'coach_pack', NOW)), 0,
  'a booking that already paid is not counted again as a credit still to come');

eq(shortfallLine(null), null, 'an unread ledger reports no shortfalls, because it counted none');
eq(shortfallLine({ past: [], upcoming: [] }), null, 'no shortfalls shows nothing, not a reassuring zero');
ok((shortfallLine(led) || '').startsWith('One '), 'one shortfall is named in words, not as “1”');

/* ── 6 · wording ──────────────────────────────────────────────────────────── */

const row = (state: LedgerState, kind: 'coach_pack' | 'gym_pass' | null = null) =>
  ({ sessionId: 's', startsAt: PAST, state, kind, drawnAt: null, entitlementId: null });

for (const s of ['drawn', 'drawn_at_booking', 'not_covered', 'shortfall', 'unmarked',
  'missed', 'late_cancelled', 'cancelled',
  'expected', 'reserved', 'expected_none', 'unknown'] as LedgerState[]) {
  const c = clientLedgerLine(row(s));
  const k = coachLedgerLine(row(s));
  ok(c.length > 0 && k.length > 0, `${s} has a sentence on both sides of the relationship`);
  ok(!c.includes(' — ') && !k.includes(' — '), `${s} carries no dash inside a sentence`);
  ok(c.trim().endsWith('.') && k.trim().endsWith('.'), `${s} is a sentence and ends like one`);
}

// The two that must never be confused, in either app.
ok(clientLedgerLine(row('not_covered')).toLowerCase().includes('another way'),
  'paying cash is described as paying another way, not as owing anything');
ok(coachLedgerLine(row('shortfall')).toLowerCase().includes('unpaid'),
  'a shortfall says out loud that the coach delivered an hour unpaid');
ok(clientLedgerLine(row('unknown')).toLowerCase().includes('could not'),
  'unknown says we could not read it, never that nothing was drawn');

// An upcoming draw is an expectation and is worded as one. Part 135 refuses to
// take credits 56 days ahead; a sentence claiming one is already gone would be
// describing a balance the database does not hold.
ok(clientLedgerLine(row('expected')).includes('comes off'),
  'an expected draw is in the present tense of a thing that has not happened');
ok(!clientLedgerLine(row('expected')).includes('came off'),
  'and never in the past tense of one that has');
ok(clientLedgerLine(row('drawn')).includes('came'), 'a real draw IS in the past tense');
ok(clientLedgerLine(row('drawn', 'gym_pass')).includes('gym pass'),
  'a gym-paid session says which of the two systems paid, because they are two different businesses');

eq(clientLedgerLine(row('drawn'), '10-session pack'), 'One session came off 10-session pack when this was marked complete.',
  'a named pack is named, rather than described as “your pack”');

// The sentence at the moment of booking.
ok((bookingCreditNote('coach_pack', 4) || '').includes('4'), 'the booking note states what is left before the tap');
ok((bookingCreditNote('coach_pack', null) || '').includes('could not'),
  'an unreadable balance says so at the booking screen rather than printing a nought');
ok((bookingCreditNote('coach_pack', 0) || '').includes('no sessions left'),
  'a real zero is stated plainly, because their next booking is not covered');
ok((bookingCreditNote('gym_pass', 3) || '').includes('marks this complete'),
  'on the gym route the credit is taken at delivery, and the booking screen says exactly that');
ok(!(bookingCreditNote('gym_pass', 3) || '').includes('the moment you book'),
  'and never claims a credit is spent at booking when the design spends it at delivery');
eq(bookingCreditNote('none', 0), null, 'somebody who holds nothing is told nothing about packs at all');


/* ── 7 · the one answer the three screens now share ───────────────────────── */
//
// The defect this section exists for: `app/(client)/pt-sessions.tsx` and
// `app/(client)/packages.tsx` both read `client_purchases` alone, so a member
// whose GYM sold them a PT pass was told "Sessions Remaining 0 · You have not
// bought a session pack" on one and shown no balance at all on the other,
// while `app/(client)/session-credits.tsx` — the only screen reading both —
// showed the eight sessions they actually held.

const DAY = '2026-09-01';
const pack = (p: Partial<{ id: string; label: string; left: number; sessions_total: number; expiresOn: string | null; expired: boolean }> = {}) =>
  ({ id: 'p1', label: '10-session pack', left: 4, sessions_total: 10, ...p });
const ptPass = (p: Partial<{ id: string; passTypeId: string | null; passTypeName: string | null; covers: string | null; expiresOn: string | null; usesTotal: number; usesSpent: number }> = {}) =>
  ({ id: 'g1', passTypeId: 't1', passTypeName: 'PT 8-pack', covers: 'pt', expiresOn: null, usesTotal: 8, usesSpent: 0, ...p });

// The member the bug was about: a gym PT pass and no coach pack at all.
const gymOnly = bookableCredits([], [ptPass()], DAY);
eq(gymOnly.route, 'gym_pass', 'no coach pack and a live PT pass: the gym pass is what pays');
eq(gymOnly.left, 8, 'and the figure is the eight sessions they are actually holding, not the nought client_purchases reports');
ok((creditsHeroNote(gymOnly) || '').includes('gym'),
  'the note names the business whose credit it is, because two businesses are involved and only one of them is being spent');
eq(creditsEmptyLine(gymOnly), null,
  'somebody with eight credits is never told they have not bought a pack — the exact sentence pt-sessions.tsx printed');

// The case that makes summing the two balances wrong.
const spentPackLivePass = bookableCredits([pack({ left: 0 })], [ptPass()], DAY);
eq(spentPackLivePass.route, 'coach_pack',
  'an exhausted coach pack still beats a live gym pass, exactly as chooseRoute and part 370 have it');
eq(spentPackLivePass.left, 0,
  'so the bookable figure is 0 — a sum would print 8 and send them to book a week of shortfalls on their coach’s unpaid hours');
ok((creditsEmptyLine(spentPackLivePass) || '').includes('pack'),
  'and the empty line points at the pack that is empty, not at the pass that is not being spent');
ok(!(creditsEmptyLine(spentPackLivePass) || '').includes('not bought'),
  'never “you have not bought a session pack” to somebody who bought one and used it');

// Both held, both with credit: still one number, and it is the coach's.
const both = bookableCredits([pack({ left: 3 })], [ptPass()], DAY);
eq(both.left, 3, 'holding both, the figure is the route that pays and never the total of the two');

// Holding nothing at all — an ordinary answer, and the only case where the old
// sentence was true.
const neither = bookableCredits([], [], DAY);
eq(neither.route, 'none', 'holding neither is ordinary');
eq(neither.left, 0, 'and it is a real nought, because both halves were read');
eq(creditsHeroNote(neither), null, 'with no entitlement there is no figure for a note to sit under');
ok((creditsEmptyLine(neither) || '').includes('gym PT pass'),
  'and the sentence names BOTH systems, so it is a statement about everything that was checked');

// Unread, in each half, is never a nought.
const packsUnread = bookableCredits(null, [ptPass()], DAY);
eq(packsUnread.route, 'unknown', 'an unread purchase history makes the route unknown even with a live pass beside it');
eq(packsUnread.left, null, 'and the figure is null, never 0');
eq(creditsHeroNote(packsUnread), null, 'no note over a figure that does not exist');
ok((creditsEmptyLine(packsUnread) || '').includes('could not'),
  'the unread sentence says it is our end, not a statement about what they hold');

const passesUnread = bookableCredits([], null, DAY);
eq(passesUnread.route, 'unknown',
  'an unread pass list is unknown too, once it is the half that decides — this is the read pt-sessions.tsx never made');
eq(passesUnread.left, null, 'and it is null rather than the 0 client_purchases would have supplied');

// A coach pack read that answers the question on its own survives a failed pass
// read: the coach pack wins whatever the pass list says, so there is nothing
// unknown about it.
const packReadPassFailed = bookableCredits([pack({ left: 5 })], null, DAY);
eq(packReadPassFailed.route, 'coach_pack', 'a coach pack answers the route on its own');
eq(packReadPassFailed.left, 5, 'so a failed pass read does not blank a balance it could not have changed');

// A class pass is not a PT pass.
const classOnly = bookableCredits([], [ptPass({ covers: 'visit' })], DAY);
eq(classOnly.route, 'none', 'a ten-CLASS pack never pays for an hour of one-to-one');

// An expired pass is not a balance.
const lapsed = bookableCredits([], [ptPass({ expiresOn: '2026-08-31' })], DAY);
eq(lapsed.route, 'none', 'a pass whose last day has passed is not something to book against');

// The note's plurals and the diary clause.
eq(creditsHeroNote(bookableCredits([pack({ left: 4 })], [], DAY)), 'On the pack you bought from your coach',
  'one pack is singular and says who sold it');
eq(creditsHeroNote(bookableCredits([pack({ id: 'a', left: 2 }), pack({ id: 'b', left: 2 })], [], DAY)),
  'Across 2 packs you bought from your coach', 'two are counted');
ok((creditsHeroNote(gymOnly, 3) || '').includes('3 booked sessions still to draw'),
  'a diary that was read adds what it is due to take');
ok((creditsHeroNote(gymOnly, 0) || '').includes('nothing booked'),
  'a read diary with nothing in it says so');
eq(creditsHeroNote(gymOnly, null), creditsHeroNote(gymOnly),
  'a diary that would not read adds nothing, rather than claiming nothing is booked');


/* ── 8 · the expired pack, and the money it must not move ────────────────── */
//
// A member holds a 10-pack from their coach whose validity ran out, and a live
// gym PT pass with six credits on it. `coachPackLines` used to drop the pack
// before the route was chosen, so the app answered 'gym_pass' and printed
// "Sessions Remaining 6". The server answers route 1 — the pack — finds no row
// with `sessions_used < sessions_total`, draws nothing and stamps
// `pack_draw_shortfall_at`. The gym's pass was never touched, and the coach was
// then told by `app/(trainer)/client.tsx` that they had delivered an hour
// unpaid, off the same route this file computes.

const closedPack = {
  id: 'x1', label: '10-session pack', left: 0, sessions_total: 10,
  expiresOn: '2026-06-30', expired: true,
};

// The route decision exactly as the coach's screen makes it: the length of the
// coach-pack list. This is the line the defect ran through.
eq(chooseRoute((coachPackLines([closedPack]) || []).length > 0, true), 'coach_pack',
  'a pack whose window has closed is still a pack from this coach, which is the whole of part 370’s route-1 test');

const expiredVsPass = bookableCredits([closedPack], [ptPass({ usesTotal: 6, usesSpent: 0 })], DAY);
eq(expiredVsPass.route, 'coach_pack',
  'so the route is the coach’s pack and never the gym’s pass — the app and the trigger name the same payer');
eq(expiredVsPass.left, 0,
  'and the figure is 0, not the pass’s 6: those six credits are not going to be spent on this hour');
eq((expiredVsPass.lines || []).map((l) => l.id), ['x1'],
  'the pass is not listed either, because listing it invites somebody to book against it');
ok((creditsEmptyLine(expiredVsPass) || '').includes('ran out of time'),
  'the member is told the pack ran out of TIME, which is a different thing from having used every session');
ok(!(creditsEmptyLine(expiredVsPass) || '').includes('gym'),
  'and is never pointed at a gym pass that will not pay for it');
ok((creditsHeroNote(expiredVsPass) || '').includes('validity has run out'),
  'the caption over the nought says why it is a nought');

// What the ledger then says about the hour that was delivered against it.
eq(st(session({ id: 'sf', outcome: 'completed', shortfallAt: PAST }), expiredVsPass.route), 'shortfall',
  'the delivered hour is a shortfall, which is what the server actually stamped');
eq(st(session({ id: 'nx', startsAt: FUTURE }), expiredVsPass.route), 'expected',
  'and the next one is expected to draw off the pack');
ok(clientLedgerLine(row('expected')).includes('pack'),
  'so the sentence before it names the pack, rather than promising a gym credit that will not move');

// A credit refunded ONTO a closed pack. `refund_pack_session` decrements
// `sessions_used` on the newest pack with usage and never asks whether that
// pack's window has closed, and neither draw site filters on the window — so
// the credit really is spendable, and this figure says so.
const refunded = bookableCredits(
  [{ id: 'r1', label: '10-session pack', left: 1, sessions_total: 10, expiresOn: '2026-06-30', expired: true }],
  [], DAY,
);
eq(refunded.left, 1, 'a credit returned onto a closed pack is one the database will still draw, so it is counted');
eq(creditsEmptyLine(refunded), null, 'there IS a figure, so there is no sentence instead of one');
ok((creditsHeroNote(refunded) || '').includes('validity has run out'),
  'but the caption still says the window is closed, because that is the conversation to have about it');

// A live pack beside a closed one is unaffected: the figure is what can be drawn.
const oneOfEach = bookableCredits([closedPack, pack({ id: 'live', left: 3 })], [], DAY);
eq(oneOfEach.left, 3, 'the closed pack adds nothing to a live one, and takes nothing off it');
eq(creditsHeroNote(oneOfEach), 'Across 2 packs you bought from your coach',
  'and the caption does not claim everything they hold has run out when one of them has not');

/* ── 9 · a session somebody marked is not one nobody marked ──────────────── */
//
// `ledgerStateOf` returned 'unmarked' for every outcome that was not
// 'completed', while `LedgerState`'s own definition of 'unmarked' is "nobody has
// said what happened yet". So a session the coach recorded as a no-show told
// the client "Your coach has not said what happened yet" and told the coach who
// recorded it "Not marked yet".

eq(st(session({ id: 'm1', outcome: 'no_show' }), 'coach_pack'), 'missed',
  'a no-show is a recorded fact, and it says so');
eq(st(session({ id: 'm2', outcome: 'cancelled' }), 'coach_pack'), 'cancelled',
  'a cancellation with notice is its own state');
eq(st(session({ id: 'm3', outcome: 'late_cancelled' }), 'gym_pass'), 'late_cancelled',
  'and a late one is kept apart from it, exactly as sessions.outcome and isPayable keep them apart');
eq(st(session({ id: 'm4' }), 'coach_pack'), 'unmarked',
  'while a session with no outcome at all is still, and only, unmarked');
eq(st(session({ id: 'm5', outcome: 'no_show', bookingDrewCreditAt: PAST }), 'coach_pack'), 'drawn_at_booking',
  'a no-show that had already spent a credit at booking still spent one, and that comes first');
eq(st(session({ id: 'm6', outcome: 'teleported' }), 'coach_pack'), 'unknown',
  'an outcome the live CHECK does not allow is unknown, never “nobody has marked this” — that would be a claim about their coach');

ok(!clientLedgerLine(row('missed')).toLowerCase().includes('has not said'),
  'the client is never told nobody has said what happened about a session somebody marked');
ok(!coachLedgerLine(row('cancelled')).toLowerCase().includes('not marked'),
  'and the coach who marked it is never told they have not');
ok(coachLedgerLine(row('missed')).includes('not attended'),
  'the words are sessionHistory’s own, so a history row and a credit row describe the same session the same way');
ok(coachLedgerLine(row('late_cancelled')).includes('notice period'),
  'and a late cancellation is named as one, because gyms pay for those and not for the other');
ok(clientLedgerLine(row('cancelled')).includes('Nothing came off'),
  'each of them still answers the question this module exists for: what happened to the credit');


/* ── 10 · a pass pays at the gym that sold it, and nowhere else ──────────── */
//
// The same shape as 8, run the other way. There, a pack the server WOULD pick
// had been filtered out, so the app named the wrong route. Here a pass the
// server will NOT pick was left in.
//
// Route 2 of part 370, read live:
//
//     where p.holder_id = new.client_id
//       and p.tenant_id = new.tenant_id     ← and again in the shortfall test
//       and ty.covers = 'pt' … and (p.expires_on is null or p.expires_on >= v_on)
//
// `sessions.tenant_id` is filled by `sessions_fill_tenant()` from
// `profiles.tenant_id` OF THE TRAINER, and part 06 gives every account its own
// personal tenant at signup. So an hour with an independent coach carries that
// coach's personal tenant and no gym's pass can equal it. `myPtPasses` read on
// `holder_id` alone — `gym_passes_own_r` has no tenant clause either — so a
// member holding a live six-credit pass from Gym A, booking with an independent
// coach or with a coach on Gym B's staff, was routed to 'gym_pass' and shown
// six credits that nothing was ever going to draw.

const GYM_A = 'tenant-a';
const GYM_B = 'tenant-b';
// An independent coach's "gym" is their own personal tenant (part 06), which is
// a real uuid that simply matches no gym_pass anywhere.
const SOLO = 'tenant-personal-of-the-coach';

const passOf = (tenantId: string, p: Partial<{ id: string; passTypeName: string; usesTotal: number; usesSpent: number; expiresOn: string | null; covers: string }> = {}) =>
  ({ id: 'g1', passTypeId: 't1', passTypeName: 'PT 6-pack', covers: 'pt', expiresOn: null, usesTotal: 6, usesSpent: 0, tenantId, ...p });

// (a) A pass from the session's OWN gym still pays. Nothing about this fix may
//     take a credit away from the member it was sold to.
const ownGym = bookableCredits([], [passOf(GYM_A)], DAY, GYM_A);
eq(ownGym.route, 'gym_pass', 'a pass sold by the gym this session belongs to is still what pays');
eq(ownGym.left, 6, 'and the six credits are counted, exactly as before');
eq(ownGym.elsewhere, [], 'with nothing set aside, because nothing was held anywhere else');
eq(passesElsewhereLine(ownGym), null, 'so there is no sentence about another gym');
eq(creditsEmptyLine(ownGym), null, 'and no sentence instead of a figure, because there is a figure');
eq(creditsHeroNote(ownGym), 'On the PT pass your gym sold you',
  'the caption is the plain one — no clause about a pass that does not exist');

// (b) A pass from ANOTHER gym does not pay, and is not shown as paying.
const otherGym = bookableCredits([], [passOf(GYM_A)], DAY, GYM_B);
eq(otherGym.route, 'none',
  'a pass sold by a different gym cannot be drawn on here, so it is not the route — part 370 matches p.tenant_id = new.tenant_id');
eq(otherGym.left, 0, 'and it contributes nothing to the bookable figure it was never going to cover');
eq(otherGym.lines, [], 'it is not in the paying lines, because listing it invites somebody to book against it');
eq((otherGym.elsewhere || []).map((l) => l.id), ['g1'],
  'but it is carried, because it is a real pass with real credits on it');

const elsewhereLine = creditsEmptyLine(otherGym) || '';
ok(elsewhereLine.includes('do not belong to the gym that sold you'),
  'the member is told WHY it cannot pay, which is a fact about the session and not about their pass');
ok(elsewhereLine.includes('6 PT credits') && elsewhereLine.includes('still yours'),
  'and that the six credits are still theirs — telling somebody their valid pass shows 0 would be its own wrong answer');
ok(!elsewhereLine.includes('You are not on a session pack or a gym PT pass'),
  'never the old sentence, which was false about somebody who is holding one');
ok(!elsewhereLine.includes(' 0 '), 'and no nought anywhere in it');
eq(creditsHeroNote(otherGym), null,
  'there is no figure for a caption to sit under, so there is no caption — not a caption over a nought');

// The independent coach. Same member, same pass; the coach is on no gym's
// staff, so the session carries their personal tenant.
const independent = bookableCredits([], [passOf(GYM_A)], DAY, SOLO);
eq(independent.route, 'none',
  'an hour with an independent coach belongs to that coach’s own tenant, which no gym pass will ever equal');
eq(independent.left, 0, 'so the pass buys nothing here');
eq((independent.elsewhere || []).map((l) => l.id), ['g1'], 'and is set aside rather than dropped');
ok((creditsEmptyLine(independent) || '').includes('still good at the gym that sold it'),
  'the sentence works for an independent coach too, without making the member learn the word tenant');

// A coach who is on NO tenant at all — `staff_tenant_of` returns null, and
// route 2's first line is `if new.tenant_id is null then return new`.
const noTenant = bookableCredits([], [passOf(GYM_A)], DAY, null);
eq(noTenant.route, 'none', 'a session belonging to no gym draws on no gym pass, which is route 2’s own first line');
eq((noTenant.elsewhere || []).length, 1, 'and the pass is still named rather than silently gone');

// (c) A member holding BOTH: one from this gym, one from another.
const bothGyms = bookableCredits([], [passOf(GYM_A, { id: 'a1', usesTotal: 6 }), passOf(GYM_B, { id: 'b1', usesTotal: 4 })], DAY, GYM_A);
eq(bothGyms.route, 'gym_pass', 'the pass from this gym is what pays');
eq(bothGyms.left, 6, 'and the figure is its six — never the ten a sum of the two would print');
eq((bothGyms.lines || []).map((l) => l.id), ['a1'], 'only the one this session can draw on is listed');
eq((bothGyms.elsewhere || []).map((l) => l.id), ['b1'], 'the other is carried');
ok((creditsHeroNote(bothGyms) || '').includes('another gym'),
  'and the caption under the six says a second pass exists and is not behind that figure');
eq(creditsEmptyLine(bothGyms), null, 'there is a figure, so nothing is printed instead of one');

// A coach pack beats both, and neither pass is named — the same silence the
// coach-pack route has always kept about a gym pass it is not spending.
const packBeatsBoth = bookableCredits([pack({ left: 2 })], [passOf(GYM_A)], DAY, GYM_A);
eq(packBeatsBoth.route, 'coach_pack', 'a coach pack still names both people in the room and still wins');
eq(packBeatsBoth.left, 2, 'and the figure is the pack’s');
ok(!(creditsHeroNote(packBeatsBoth) || '').includes('another gym'),
  'with no clause about passes, because none of them is what pays');

// (d) The discriminator is three-state, like everything else on this path.
const noDiscriminator = bookableCredits([], [ptPass()], DAY);
eq(noDiscriminator.route, 'gym_pass',
  'a caller who names no gym judges nothing — this is app/(trainer)/client.tsx, whose read gym_passes_staff_r has already narrowed to my_tenant()');
eq(noDiscriminator.left, 8, 'so its figure is unchanged by this fix');
eq(noDiscriminator.elsewhere, [], 'and nothing is set aside, because nothing was judged');

// Carried on the rows by `myPtPasses`, which is how the three client screens
// get the answer without being handed an extra argument.
const carried = bookableCredits([], [{ ...passOf(GYM_A), sessionTenantId: GYM_B }], DAY);
eq(carried.route, 'none', 'a session gym carried up on the row is judged exactly as one passed as an argument');
eq((carried.elsewhere || []).length, 1, 'and the pass is set aside the same way');

const carriedMatching = bookableCredits([], [{ ...passOf(GYM_A), sessionTenantId: GYM_A }], DAY);
eq(carriedMatching.route, 'gym_pass', 'and a row whose gyms agree still pays');
eq(carriedMatching.left, 6, 'for its full six');

// The argument wins over the row: the caller is answering for the session in
// front of them, the row for whenever it was fetched.
const argWins = gymPtLines([{ ...passOf(GYM_A), sessionTenantId: GYM_B }], DAY, GYM_A);
eq((argWins || []).map((l) => l.id), ['g1'], 'an explicit session gym overrides the one carried on the row');

// A row that cannot be compared is not counted — the safe direction — and is
// still named, so nothing is silently blanked.
const noRowTenant = bookableCredits([], [{ ...ptPass(), sessionTenantId: GYM_A }], DAY);
eq(noRowTenant.route, 'none', 'a pass whose own gym did not come back cannot be shown as paying');
eq((noRowTenant.elsewhere || []).length, 1, 'but it is named rather than dropped into silence');

// Unread stays unread on both sides.
eq(passesElsewhere(null, DAY, GYM_A), null, 'an unread pass list has no “elsewhere” either — it has no answer at all');
const unread = bookableCredits([], null, DAY, GYM_A);
eq(unread.elsewhere, null, 'and bookableCredits carries that null through rather than manufacturing an empty list');
eq(unread.route, 'unknown', 'with the route unknown, as it already was');
ok((creditsEmptyLine(unread) || '').includes('could not'), 'and the unread sentence, not the other-gym one');

// Things that cannot be spent anywhere are in neither list. "Your class pack is
// from another gym" would be a sentence about the wrong thing.
eq(passesElsewhere([passOf(GYM_A, { covers: 'visit' })], DAY, GYM_B), [],
  'a class pass is not a PT pass and is not the subject of this sentence');
eq(passesElsewhere([passOf(GYM_A, { expiresOn: '2026-08-31' })], DAY, GYM_B), [],
  'and neither is one whose last day has passed — it pays nowhere, not merely not here');

// A foreign pass with nothing left on it: named, without the hollow
// reassurance about credits it does not have.
const spentElsewhere = bookableCredits([], [passOf(GYM_A, { usesTotal: 6, usesSpent: 6 })], DAY, GYM_B);
ok((passesElsewhereLine(spentElsewhere) || '').includes('nothing comes off it'),
  'a spent pass from another gym is still explained');
ok(!(passesElsewhereLine(spentElsewhere) || '').includes('still yours'),
  'but “its 0 credits are still yours” is not a kindness, so it is not said');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sessionCredits: ok (an empty OR EXPIRED coach pack still beats a gym pass, a pass pays only at the gym that sold it, unread is never nought)');
