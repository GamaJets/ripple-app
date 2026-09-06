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
// 7. A PACK WHOSE WINDOW CLOSED IS LISTED, AND SAID OUT LOUD. Part 370 route 1
//    is `status = 'paid' and cp.sessions_total is not null` with no expiry
//    clause, so an expired pack still WINS the route — hiding it here would
//    have the app naming a different payer than the server. The price of
//    keeping it is that it must never be captioned in the future tense: an
//    expired pack reads "0 of 10" and "Expires 14 Aug" in September is this
//    app telling somebody their money is still waiting for them.
//
// No formatted date is asserted against a literal — `npm test` runs under six
// timezones — and every instant here is an explicit ISO string.
import {
  chooseRoute, routeReason, creditsLeft, payingLines, passLiveOn, gymPtLines,
  coachPackLines, ledgerStateOf, buildLedger, expectedDraws,
  clientLedgerLine, coachLedgerLine, shortfallLine, bookingCreditNote,
  entitlementWindowLine, creditsEmptyLine, creditsHeroNote,
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
  'a pack with no window carries none — which is every pack sold before part 612, and most of them');

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

/* ── 7 · a window that has closed ─────────────────────────────────────────── */

// The pack part 370 still spends the route on, and the one this module used to
// flatten: `coachPackLines` set `expiresOn: null` on every line and carried no
// flag at all, so the screens had nothing to say about a nought they were
// printing.
const closed = coachPackLines([
  { id: 'e1', label: '10-session pack', left: 0, sessions_total: 10, expired: true, expiresOn: '2026-08-14' },
]) as Entitlement[];

eq(closed.length, 1,
  'a pack whose window closed is LISTED, not filtered — route 1 of part 370 has no expiry clause, so it is still the answer to who is paying');
eq(closed[0].expired, true, 'and it says so, which is the only way a screen can explain the nought beside it');
eq(closed[0].expiresOn, '2026-08-14', 'carrying the day the window closed on, rather than the null the old mapping invented');
eq(chooseRoute(closed.length > 0, true), 'coach_pack',
  'an expired coach pack still beats a live gym pass, exactly as the server picks it — the app and the database name one payer or neither can be trusted');
eq(creditsLeft(closed), 0, 'and the figures are untouched: nothing here manufactures a credit to soften the sentence');

// A gym pass never reaches a screen expired, because `gymPtLines` drops one
// that is not live on the day. Stated rather than assumed: it is what makes
// `expired` a coach-pack fact everywhere else in this module.
ok(pt.every((l) => l.expired === false),
  'every gym line is live by construction, so none of them arrives claiming a closed window');

// The tense. This is the whole of the defect, and it is one word.
eq(entitlementWindowLine({ expiresOn: '2026-08-14', expired: false }, '14 Aug 2026'), 'Expires 14 Aug 2026',
  'a window still open is a promise about a day that has not come yet');
eq(entitlementWindowLine({ expiresOn: '2026-08-14', expired: true }, '14 Aug 2026'), 'Ran out of time on 14 Aug 2026',
  'and one that has closed is a fact about a day that has passed, naming the day either way');
ok(!(entitlementWindowLine({ expiresOn: '2026-08-14', expired: true }, '14 Aug 2026') || '').includes('Expires'),
  'the closed sentence never borrows the open one, which is the future tense read over a nought');
ok((entitlementWindowLine({ expiresOn: '2026-08-14', expired: true }, '14 Aug 2026') || '').includes('14 Aug 2026'),
  'and it names the day: "this ran out" with no date is a fact somebody cannot check against their own receipt');
eq(entitlementWindowLine({ expiresOn: null, expired: false }, '14 Aug 2026'), null,
  'a pack with no window gets no line — "this does not expire" under every pack in the product is noise on the ninety-nine per cent');
eq(entitlementWindowLine({ expiresOn: '2026-08-14', expired: true }, null), null,
  'and a day that would not format gives null rather than a sentence with a hole where the date goes');

// Why the balance is nought, when the reason is a window rather than a spend.
const usedUp: Entitlement[] = [
  { id: 'u', kind: 'coach_pack', label: '10-session pack', left: 0, sessions_total: 10, expiresOn: null, expired: false },
];
eq(creditsEmptyLine(usedUp), null,
  'a pack somebody used up is explained by nothing here: they got what they paid for, and packDraw keeps that nought apart from this one on purpose');
ok((creditsEmptyLine(closed) || '').includes('ran out of time'),
  'a nought caused by a closed window says so, in the words packExpiry already uses for it rather than a fourth phrasing');
ok(!(creditsEmptyLine(closed) || '').includes('refund'),
  'and promises no refund, which is not a thing this app can make happen');
ok(!/[0-9]/.test(creditsEmptyLine(closed) || ''),
  'and carries no figure at all: a pack used up and THEN closed reads nought here too, and only packDraw holds the number that was genuinely stranded');
eq(creditsEmptyLine([...closed, { id: 'l', kind: 'coach_pack', label: '5-session pack', left: 2, sessions_total: 5, expiresOn: null, expired: false }]), null,
  'nothing is explained while anything is still spendable — the sentence is about a whole balance of nought, not about one dead pack in a list');
eq(creditsEmptyLine(null), null, 'an unread list has no balance to explain, and will not be given one');
eq(creditsEmptyLine([]), null, 'and somebody who holds nothing is told nothing about packs running out of time');

// The note under the figure a member plans a month against.
eq(creditsHeroNote(null, 0), null, 'no note over a list nobody could read');
eq(creditsHeroNote([], 0), null, 'and none over a client who holds nothing at all');
eq(creditsHeroNote(packs, 0), 'Across 2 packs · nothing booked is due to draw one',
  'the ordinary note is unchanged, so moving it out of the screen moved nothing else with it');
eq(creditsHeroNote(packs, 2), 'Across 2 packs · 2 booked sessions still to draw',
  'and the booking clause still counts what is expected to draw');
eq(creditsHeroNote(packs, null), 'Across 2 packs',
  'a booking count nobody could read is left off rather than printed as a nought nobody counted');
eq(creditsHeroNote(closed, null), 'Across 1 pack whose validity has run out',
  'a member whose only pack has expired is told that above the figure, not left to work it out from a nought');
const mixed: Entitlement[] = [...closed, ...packs];
eq(creditsHeroNote(mixed, null), 'Across 3 packs · 1 whose validity has run out',
  'and where some are live it says how many are not, because 8 across three packs one of which is dead is not the same 8');
ok((creditsHeroNote(mixed, 0) || '').includes('whose validity has run out'),
  'the closed window keeps its clause even when a booking clause has to fit in beside it');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('sessionCredits: ok (an empty coach pack still beats a gym pass, a closed window is past tense, unread is never nought, a shortfall is not cash)');
