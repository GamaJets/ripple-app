// Who trained recently and has nothing booked. Compile with tsc, run with node.
//
// Two failures are worth the file.
//
// THE FIRST is the false positive, which is the one that costs a coach their
// credibility: telling them to chase somebody who is already in the diary. Every
// shape of "already booked" is asserted below — a plain future booking, a
// session in progress, and the one that is NOT a booking at all, a future row
// somebody has already cancelled.
//
// THE SECOND is the empty list. `useSessions` reads newest-first and capped, so
// a short list can mean "nobody" or "the read stopped before last month". The
// two are different sentences and `rebookCoverageNote` is the difference.
import {
  unrebooked, rebookingListable, rebookCoverageNote, unrebookedHeading,
  unrebookedNote, noUnrebookedLine, REBOOK_LOOKBACK_DAYS, REBOOK_CANCELLED_GAP_NOTE,
  type RebookRow,
} from './rebooking';
import { readBoundary } from './sessionHistory';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const DAY = 86_400_000;
const NOW = new Date(2027, 1, 10, 12, 0, 0, 0).getTime();
const agoISO = (days: number, hours = 0) => new Date(NOW - days * DAY - hours * 3_600_000).toISOString();
const aheadISO = (days: number) => new Date(NOW + days * DAY).toISOString();

const booked = (clientId: string, startsAt: string, over: Partial<RebookRow> = {}): RebookRow =>
  ({ clientId, startsAt, durationMin: 60, status: 'booked', ...over });

/* ── the person who is not there ────────────────────────────────────────── */

const one = unrebooked([booked('ana', agoISO(9))], NOW);
eq(one.length, 1, 'a client who trained nine days ago and has nothing booked is on the list');
eq(one[0].clientId, 'ana', 'by name');
eq(one[0].daysSince, 9, 'with the days counted from when the session ended');
eq(one[0].lastMissed, false, 'and nothing said about what happened, because nobody said');

/* ── the people who are ─────────────────────────────────────────────────── */

eq(unrebooked([booked('ana', agoISO(9)), booked('ana', aheadISO(3))], NOW).length, 0,
  'a client with something in the diary is not chased');

// Mid-session. Its END has not passed, so it is not history; it is also
// certainly not a reason to ring somebody.
eq(unrebooked([booked('ana', agoISO(0, 0.5))], NOW).length, 0,
  'a session happening right now counts as being in the diary');

// The row that looks like a booking and is the opposite of one.
const cancelledAhead = unrebooked([
  booked('ana', agoISO(9)),
  booked('ana', aheadISO(3), { outcome: 'cancelled' }),
], NOW);
eq(cancelledAhead.length, 1, 'a cancelled future session is not something booked');
ok(cancelledAhead[0].clientId === 'ana', 'so the client is still on the list');

eq(unrebooked([{ clientId: null, startsAt: agoISO(2), durationMin: 60, status: 'available' }], NOW).length, 0,
  'an open slot that has gone by belongs to nobody and is not a session anybody had');

// The other half of the same rule, and the half a name on the row makes
// tempting. `status` is the SLOT state, never the delivery result: an hour the
// coach blocked out is not somebody's session, and neither is a row caught
// mid-release, whoever is named on it. Nothing may be counted as an
// appointment on the strength of a client id alone.
eq(unrebooked([{ clientId: 'ana', startsAt: agoISO(2), durationMin: 60, status: 'blocked' }], NOW).length, 0,
  'blocked time is not a session anybody had');
eq(unrebooked([{ clientId: 'ana', startsAt: agoISO(2), durationMin: 60, status: 'available' }], NOW).length, 0,
  'and nor is an open hour with a name still on it');
eq(unrebooked([{ clientId: 'ana', startsAt: agoISO(2), durationMin: 60, status: 'available', outcome: 'completed' }], NOW).length, 1,
  'but a row somebody recorded an outcome against is a session, whatever its slot state says');

eq(unrebooked([booked('ana', agoISO(REBOOK_LOOKBACK_DAYS + 3))], NOW).length, 0,
  'somebody last seen before the window is a different conversation');

/* ── what happened to the last one ──────────────────────────────────────── */

const missed = unrebooked([booked('ana', agoISO(4), { outcome: 'no_show' })], NOW);
eq(missed[0].lastMissed, true, 'a no-show is flagged as a session that did not go ahead');
const lateCancelled = unrebooked([booked('ana', agoISO(4), { outcome: 'late_cancelled' })], NOW);
eq(lateCancelled[0].lastMissed, true, 'and so is a late cancellation');
const delivered = unrebooked([booked('ana', agoISO(4), { outcome: 'completed' })], NOW);
eq(delivered[0].lastMissed, false, 'a delivered one is not');

// Their most recent appointment, not the first one found.
const many = unrebooked([
  booked('ana', agoISO(20)), booked('ana', agoISO(3)), booked('ana', agoISO(11)),
], NOW);
eq(many.length, 1, 'one row per client');
eq(many[0].daysSince, 3, 'counted from the latest of them');

/* ── the order ──────────────────────────────────────────────────────────── */

const ranked = unrebooked([
  booked('ana', agoISO(3)), booked('bo', agoISO(19)), booked('cy', agoISO(11)),
], NOW);
eq(ranked.map((u) => u.clientId).join(','), 'bo,cy,ana', 'longest gone first — that is the order a coach loses people in');

const tied = unrebooked([booked('zed', agoISO(5)), booked('abe', agoISO(5))], NOW);
eq(tied.map((u) => u.clientId).join(','), 'abe,zed', 'and a tie is broken stably, so the list does not reshuffle');

/* ── whether the list may be shown at all ───────────────────────────────── */

eq(rebookingListable('ready'), true, 'a whole read supports the list');
eq(rebookingListable('partial'), true,
  'and so does a truncated one — the cut is at the OLD end, so nothing booked ahead can be missing');
eq(rebookingListable('loading'), false, 'a read still in flight does not');
eq(rebookingListable('error'), false, 'and a failed one certainly does not');

/* ── how far back the read actually reached ─────────────────────────────── */

const label = (s: string) => s.slice(0, 10);
const whole = readBoundary([{ startsAt: agoISO(90) }], false);
eq(rebookCoverageNote(whole, 'ready', NOW, label), null,
  'a read that was not truncated covers the window and says nothing');

const edge = readBoundary([{ startsAt: agoISO(10) }], true);
const edgeNote = rebookCoverageNote(edge, 'partial', NOW, label) ?? '';
ok(edgeNote.length > 0, 'a read that stopped inside the window says so');
ok(/missing from this list rather than absent/.test(edgeNote),
  'and says the shortfall is the screen’s, not the coach’s book');

const beyond = readBoundary([{ startsAt: aheadISO(2) }], true);
const beyondNote = rebookCoverageNote(beyond, 'partial', NOW, label) ?? '';
ok(/none of the last/.test(beyondNote), 'a read that never reached the window says none of it was read');
ok(beyondNote !== edgeNote, 'and the two shortfalls are different sentences');

ok((rebookCoverageNote(whole, 'loading', NOW, label) ?? '').length > 0,
  'an unfinished read is never silently treated as complete');

/* ── the words ─────────────────────────────────────────────────────────── */

eq(unrebookedHeading(0), null, 'nothing to head means no heading');
ok(!/\d/.test(unrebookedHeading(1) ?? ''), 'one is counted in words');
ok(/3/.test(unrebookedHeading(3) ?? ''), 'and more than one carries the count');

const line = unrebookedNote(one[0], label);
ok(/9 days ago/.test(line), 'the line says how long it has been');
ok(/Nothing booked since/.test(line), 'and that there is nothing since');
ok(!/risk|churn|losing/i.test(line),
  'and never states a verdict this module cannot support — that is src/lib/clientDrift.ts’ job');

const yesterday = unrebookedNote(unrebooked([booked('ana', agoISO(1))], NOW)[0], label);
ok(/yesterday/.test(yesterday), 'yesterday is called yesterday, not "1 days ago"');
const today = unrebookedNote(unrebooked([booked('ana', agoISO(0, 3))], NOW)[0], label);
ok(/earlier today/.test(today), 'and today is called today');

const didNotGo = unrebookedNote(missed[0], label);
ok(/did not go ahead/.test(didNotGo), 'a missed last session is described as one');
ok(didNotGo !== unrebookedNote(delivered[0], label), 'which is a different conversation from a delivered one');

ok(/\b28\b/.test(noUnrebookedLine()), 'the good answer names the window it is making a claim about');
ok(/cancelled their own last session/.test(REBOOK_CANCELLED_GAP_NOTE),
  'the gap nothing can close is stated rather than worked around');

eq(REBOOK_LOOKBACK_DAYS, 28, 'four weeks is the window in which rebooking is still an ordinary thing to say');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('rebooking: ok');
