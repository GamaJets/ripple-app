// Which entitlement pays for a session, and what each app says about it.
// Compile with tsc, run with node.
//
// Six things are defended here. Every one of them is a sentence that would look
// entirely ordinary on a screen while being false about somebody's money.
//
// 1. AN EXHAUSTED COACH PACK STILL BEATS A LIVE GYM PASS. This is the whole
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
// No formatted date is asserted against a literal — `npm test` runs under six
// timezones — and every instant here is an explicit ISO string.
import {
  chooseRoute, routeReason, creditsLeft, payingLines, passLiveOn, gymPtLines,
  coachPackLines, ledgerStateOf, buildLedger, expectedDraws,
  clientLedgerLine, coachLedgerLine, shortfallLine, bookingCreditNote,
  bookableCredits, creditsHeroNote, creditsEmptyLine,
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
  [{ id: 'z', kind: 'coach_pack', label: '10-session pack', left: 4, sessions_total: 10, expiresOn: null }],
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
  [{ id: 'w', kind: 'coach_pack', label: '10-session pack', left: 4, sessions_total: 10, expiresOn: '2026-09-30' }],
  'a pack that DOES have a window carries its own last day through');

// A pack whose window has already closed is not an entitlement and is not
// offered: nothing in the database will let it be drawn — `run_pack_expiry()`
// has reduced its `sessions_total` — so putting it in a picker offers somebody
// something that cannot be spent.
eq(coachPackLines([
  { id: 'gone', label: '10-session pack', left: 1, sessions_total: 10, expiresOn: '2026-06-30', expired: true },
  { id: 'live', label: '5-session pack', left: 2, sessions_total: 5 },
])!.map((e) => e.id), ['live'],
  'a pack whose window has closed is dropped rather than offered with a date in the past');

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


if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sessionCredits: ok (an empty coach pack still beats a gym pass, unread is never nought, a shortfall is not cash)');
