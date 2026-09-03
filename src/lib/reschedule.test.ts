// Moving a session instead of losing it, and taking a fortnight off.
// Compile with tsc, run with node.
//
// Two things are pinned hardest. That a MOVE never claims to have charged
// anything and never claims a credit was returned, because it does neither. And
// that a PAUSE never adds two fees in two currencies, because that is not a sum
// of money.
import {
  canOfferMove, rescheduleRefusalLine, rescheduleLines, moveConfirm, noSlotsLine,
  pausePreviewLine, pauseOutcomeLines, pausedRangeLine, resumeConfirm, resumedLine,
  NOT_MOVED, COACH_NOT_MOVED, coachMoveRefusalLine, coachMovedLine,
  type RescheduleReport, type RescheduleRefusal, type PauseReport, type CoachMoveReport,
} from './reschedule';
import type { CancellationPolicy } from './booking';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-02T09:00:00Z');
const inHours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

const charges: CancellationPolicy = { applies: true, noticeHours: 24, fee: 30, currency: 'GBP' };
const free: CancellationPolicy = { applies: false, noticeHours: 24, fee: null, currency: 'GBP' };

/* ── when Move is offered ──────────────────────────────────────────────── */

ok(canOfferMove(inHours(72), charges, NOW), 'a session three days out may be moved');
ok(!canOfferMove(inHours(3), charges, NOW), 'one three hours out may not, under a 24-hour policy');
ok(!canOfferMove(inHours(-1), charges, NOW),
  'and neither may one already in progress — the window has no lower bound, exactly as insideNoticeWindow has none');

// A coach who has not set a policy has no window to be inside. Same default
// part 126 chose for the fee: nobody is held to a rule nobody stated.
ok(canOfferMove(inHours(1), free, NOW), 'a coach with no policy has no notice window to be inside');

// An unread policy falls back to the 24 hours the app has always warned about,
// and the control is still OFFERED — the server decides, and being told "no,
// and here is why" beats a button that was never there.
ok(canOfferMove(inHours(72), null, NOW), 'an unread policy still offers the move well in advance');
ok(!canOfferMove(inHours(2), null, NOW), 'and still holds it to the default notice period up close');

/* ── the refusals ──────────────────────────────────────────────────────── */

const refusal = (reason: RescheduleRefusal, over: Partial<RescheduleReport> = {}): RescheduleReport =>
  ({ ...NOT_MOVED, reason, ...over });

const REASONS: RescheduleRefusal[] = [
  'same_slot', 'not_yours', 'taken', 'other_coach', 'already_started', 'inside_notice', 'clash', 'unreachable',
];
for (const r of REASONS) {
  const line = rescheduleRefusalLine(refusal(r), '7:00 am');
  ok(line.length > 20, `${r}: has a sentence`);
  ok(/[.]$/.test(line), `${r}: is a finished sentence`);
  ok(!/—/.test(line), `${r}: no dash inside the sentence`);
}

// Every refusal except the unreachable one can promise the session is still
// booked, because a refusal means nothing changed. The unreachable one cannot,
// and must not.
for (const r of REASONS) {
  const line = rescheduleRefusalLine(refusal(r), '7:00 am');
  const promises = /still booked/.test(line);
  if (r === 'unreachable' || r === 'not_yours') {
    ok(!promises, `${r}: does not promise a state it cannot know`);
  } else {
    ok(promises, `${r}: says the session is still booked, so a refusal is not read as a loss`);
  }
}
ok(/cannot say whether anything moved/.test(rescheduleRefusalLine(refusal('unreachable'), null)),
  'an unreachable server says it does not know, and says to check');

// The notice refusal is the one that has to teach something. It names the
// period, points at the path that does exist, and quotes what that path costs.
const late = rescheduleRefusalLine(refusal('inside_notice', { noticeHours: 48, fee: 30, currency: 'GBP' }), '7:00 am');
ok(/48 hours/.test(late), 'the notice refusal names the coach’s actual notice period');
ok(/cancel it and book another time/.test(late), 'and names the path that does exist');
ok(/GBP 30/.test(late), 'and quotes what that path costs, in the currency it is in');

// No currency, no symbol. The oldest rule in this codebase.
const noCcy = rescheduleRefusalLine(refusal('inside_notice', { noticeHours: 24, fee: 30, currency: null }), '7:00 am');
ok(!/[$£€]/.test(noCcy), 'a fee with no currency is never given a symbol');
ok(/30/.test(noCcy), 'though the figure itself is still stated');
// And the figure alone is not enough in a SENTENCE. booking.ts states the rule
// — "a slot may print the figure alone; a sentence may not" — and this is the
// sentence a member reads immediately before deciding to cancel and rebook.
ok(/ask them what that amount is in/.test(noCcy),
  'and a bare figure in a sentence carries the clause saying nobody set a currency');
ok(!/ask them what that amount is in/.test(late),
  'while a stated currency adds no such clause');

// A policy that applies with no amount behind it quotes nothing at all.
const unpriced = rescheduleRefusalLine(refusal('inside_notice', { noticeHours: 24, fee: null, currency: 'GBP' }), '7:00 am');
ok(!/Cancelling it now would cost/.test(unpriced), 'no amount is invented for a fee the coach never stated');

// The one hour / many hours split, because "1 hours" is the kind of thing that
// makes a member trust the rest of the sentence less.
ok(/1 hour of notice/.test(rescheduleRefusalLine(refusal('inside_notice', { noticeHours: 1 }), null)),
  'one hour is singular');

/* ── the move that worked ──────────────────────────────────────────────── */

const moved: RescheduleReport = {
  moved: true, reason: null, noticeHours: 24, fee: null, currency: null, promoted: false, waiting: 0,
};
const lines = rescheduleLines(moved, 'Tue 7:00 am', 'Thu 6:00 pm');
ok(lines[0].includes('Tue 7:00 am') && lines[0].includes('Thu 6:00 pm'), 'both times are named');

// The sentence this whole feature turns on. A member who has just moved a
// session is thinking about what it cost, and silence is not an answer.
const money = lines.join(' ');
ok(/Nothing was charged/.test(money), 'says nothing was charged');
ok(/no session was taken off your pack/.test(money), 'and that no credit was drawn');
ok(!/refund|returned to your pack/.test(money), 'and does not claim a refund either — nothing moved in either direction');

ok(/back on your coach/.test(rescheduleLines(moved, 'a', 'b').join(' ')),
  'an unwanted slot with nobody waiting goes back on the calendar');
ok(/gone straight to them/.test(rescheduleLines({ ...moved, promoted: true }, 'a', 'b').join(' ')),
  'and one somebody was waiting for is reported as gone, from the server’s own answer');

const mc = moveConfirm('Tue 7:00 am', 'Thu 6:00 pm');
ok(/Nothing is charged/.test(mc.body), 'the confirm says it before the tap as well as after');
ok(/same coach/.test(mc.body), 'and that it stays with the same coach');

/* ── the slot picker's empty state ─────────────────────────────────────── */

eq(noSlotsLine('loading').endsWith('…'), true, 'a read in flight says so');
ok(/could not read/.test(noSlotsLine('error')), 'a failed read is not "no times"');
ok(/unchanged/.test(noSlotsLine('error')), 'and says the session is untouched');
ok(/not all of them/.test(noSlotsLine('partial')), 'a truncated read says it is short');
ok(/no other open times/.test(noSlotsLine('ready')), 'and only a completed one claims there are none');

/* ── pausing: the preview ──────────────────────────────────────────────── */

ok(/do not expect anything to be cancelled/.test(pausePreviewLine(0, 0, charges)),
  'an empty range promises nothing');
ok(/authority/.test(pausePreviewLine(0, 0, charges)),
  'and does not claim the device has the last word on the coach’s calendar');

// The preview counts what THIS DEVICE can see, matched to the series by its
// slot — `TrainingSession` carries no series id — so it may not be the set the
// server acts on. It used to say "will be cancelled" as fact over every booked
// session in the window, including a second standing slot and a one-off.
ok(/of this arrangement/.test(pausePreviewLine(4, 0, charges)),
  'the preview names the arrangement it is about rather than the whole diary');
ok(/we expect/.test(pausePreviewLine(4, 0, charges)),
  'and states an expectation rather than a fact about somebody’s coach’s calendar');
ok(/costs nothing/.test(pausePreviewLine(4, 0, charges)),
  'four sessions all outside the window cost nothing, and it says so');
ok(/does not charge/.test(pausePreviewLine(4, 2, free)),
  'a coach with no policy costs nothing however late it is');
ok(/could not read your coach/.test(pausePreviewLine(4, 2, null)),
  'and an unread policy is never softened into "no fee"');
const preview = pausePreviewLine(4, 2, charges);
ok(/2 of them/.test(preview), 'the ones inside the window are counted');
ok(/GBP 30/.test(preview), 'and priced in the currency they are in');
ok(/One of them is inside/.test(pausePreviewLine(3, 1, charges)), 'one of them is singular');

// A sentence that names a figure names its currency, or says it cannot. The
// pause preview quoted "their late fee of 25" to a gym with no currency set and
// let the member price it in whatever money they happened to think in.
const pauseNoCcy: CancellationPolicy = { applies: true, noticeHours: 24, fee: 25, currency: null };
const previewNoCcy = pausePreviewLine(4, 2, pauseNoCcy);
ok(/hasn’t set a currency/.test(previewNoCcy), 'an unstated currency is said out loud in the preview');
ok(!/hasn’t set a currency/.test(preview), 'and never when the currency is known');
ok(!/hasn’t set a currency/.test(pausePreviewLine(4, 2, { ...pauseNoCcy, fee: null })),
  'nor when there is no figure to be in doubt about');


/* ── pausing: what it actually did ─────────────────────────────────────── */

const base: PauseReport = {
  skipId: 'k1', fromOn: '2026-09-07', toOn: '2026-09-21',
  freed: 0, charged: 0, fees: null, currency: null, mixedCurrencies: false, notFreed: 0,
};

const nothing = pauseOutcomeLines(base).join(' ');
ok(/Nothing was booked in them/.test(nothing), 'an empty pause says nothing was cancelled');
ok(/Nothing was charged/.test(nothing), 'and that nothing was charged');
ok(/not ended/.test(nothing), 'and that the arrangement itself survives — the fear that stops people pausing');
ok(/starts again by itself/.test(nothing), 'and that it comes back on its own');

const priced = pauseOutcomeLines({ ...base, freed: 2, charged: 1, fees: 30, currency: 'GBP' }).join(' ');
ok(/2 sessions/.test(priced), 'the freed sessions are counted');
ok(/GBP 30\.00 in total/.test(priced), 'and the fee is totalled in one currency, to the minor unit');
const outcomeNoCcy = pauseOutcomeLines({ ...base, freed: 2, charged: 1, fees: 25, currency: null }).join(' ');
ok(/hasn’t set a currency/.test(outcomeNoCcy), 'and the same of the total afterwards');
ok(!/hasn’t set a currency/.test(priced), 'which a stated currency does not carry');


// The rule that must never bend. AED 30 plus GBP 30 is not 60 of anything.
const mixed = pauseOutcomeLines({ ...base, freed: 3, charged: 2, fees: null, currency: null, mixedCurrencies: true }).join(' ');
ok(/not in the same currency/.test(mixed), 'two currencies are never added');
ok(!/\b60\b/.test(mixed), 'and no total is printed for them');
ok(/listed on your bookings screen/.test(mixed), 'the member is told where to see the fees instead');

const partly = pauseOutcomeLines({ ...base, freed: 1, notFreed: 2 }).join(' ');
ok(/2 could not be cancelled/.test(partly), 'sessions that could not be freed are counted, never hidden');
ok(/Check your calendar/.test(partly), 'and the member is told to look');

/* ── the pause, and lifting it ─────────────────────────────────────────── */

eq(pausedRangeLine('7 Sep', '7 Sep', null), 'Paused on 7 Sep.', 'a single day reads as one day');
eq(pausedRangeLine('7 Sep', '21 Sep', null), 'Paused from 7 Sep to 21 Sep.', 'and a range as a range');
ok(/\(away\)/.test(pausedRangeLine('7 Sep', '21 Sep', 'away')), 'a reason is carried when there is one');

const rc = resumeConfirm('7 Sep', '21 Sep');
ok(/already passed do not come back/.test(rc.body),
  'resuming says what cannot happen, which is the thing people expect it to do');
ok(/still to come/.test(rc.body), 'and what can');

ok(/no sessions were booked back in/.test(resumedLine(0)),
  'lifting a pause that had nothing left in it says so rather than implying a failure');
ok(/one session has been booked back in/.test(resumedLine(1)), 'one is singular');
ok(/3 sessions have been booked back in/.test(resumedLine(3)), 'and more than one is not');

/* ── the coach moving a client's hour ───────────────────────────────────── */

const moveRep = (over: Partial<CoachMoveReport> = {}): CoachMoveReport =>
  ({ moved: false, reason: null, clientId: null, promoted: false, waiting: 0, ...over });

// Every refusal ends with where the session actually is, because a coach who
// walks away believing an hour has changed will not be there for it.
for (const reason of ['taken', 'clash', 'already_started', 'not_yours', 'same_slot'] as const) {
  const line = coachMoveRefusalLine(moveRep({ reason }), 'Ana', '7am');
  ok(/has not moved/.test(line), `a ${reason} refusal says the session did not move`);
  ok(!/undefined|null/.test(line), `and a ${reason} refusal never renders a gap as a word`);
}

// The one that must NOT claim anything either way. A request that did not reach
// the server may still have landed.
const lost = coachMoveRefusalLine(COACH_NOT_MOVED, 'Ana', '7am');
ok(/may or may not/.test(lost), 'an unreachable move claims neither outcome');
ok(/Do not tell Ana/.test(lost), 'and says not to tell the client yet');
ok(!/has not moved/.test(lost), 'and never states the session stayed put, which nobody knows');

// A refusal with no client and no time still says the important half.
const bare = coachMoveRefusalLine(moveRep({ reason: 'taken' }), null, null);
ok(/has not moved/.test(bare), 'the sentence survives a missing name and a missing time');
ok(!/undefined|null/.test(bare), 'without rendering either as a word');

// And the success line. It names where the freed hour went, because a coach who
// does not know will offer it to a second person.
const promoted = coachMovedLine(moveRep({ moved: true, promoted: true, waiting: 1 }), 'Ana', '7am', '8am', true);
ok(/Ana moved from 7am to 8am/.test(promoted), 'the move is stated plainly');
ok(/waitlist/.test(promoted), 'and the freed hour is accounted for');
ok(/was sent a notification/.test(promoted), 'and the client is said to have been told');

const untold = coachMovedLine(moveRep({ moved: true }), 'Ana', '7am', '8am', false);
ok(/could NOT be notified/.test(untold), 'a failed push is said out loud');
ok(/expecting 7am/.test(untold), 'with what the client still believes');
ok(/nobody was waiting/.test(untold), 'and an empty waitlist is stated rather than left blank');

const openAgain = coachMovedLine(moveRep({ moved: true, waiting: 2 }), 'Ana', '7am', '8am', true);
ok(/open again/.test(openAgain), 'an unpromoted hour is reported as open');
ok(!/nobody was waiting/.test(openAgain), 'and is not called empty while two people are in line');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('reschedule.test.ts — ok');
