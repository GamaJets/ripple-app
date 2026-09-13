// The coach's roster row now says when they next see each client, and the rows
// it says it from are the ones app/(trainer)/dashboard.tsx was already reading
// for its unmarked-sessions queue and its delivered count.
//
// That read used to stop at NOW. It now reaches `BOOKED_AHEAD_DAYS` forward, and
// this file is the lock on that widening: everything else computed off those
// same rows has to be provably indifferent to a future session being in the
// list. If it is not, the dashboard quietly starts telling a coach to go and
// mark the outcome of a session that has not happened yet, or counts one as
// delivered before anybody has stood in it.
//
// Compile with tsc, run with node.
import { awaitingOutcome, deliveredBetween, DELIVERED_WINDOW_DAYS } from './trainerSessions';
import { isAwaitingOutcome, type PtSession } from './gymSessions';
import { BOOKED_AHEAD_DAYS, bookedAhead, type AheadRow } from './bookedAhead';
import { clientIsQueryable } from './clientRecord';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = Date.parse('2026-09-13T12:00:00Z');
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

const session = (over: Partial<PtSession> = {}): PtSession => ({
  id: 's1',
  trainerId: 't1',
  trainerName: 'Coach',
  clientId: 'c1',
  clientName: 'Amy',
  startsAt: at(-24 * 60),
  durationMin: 60,
  status: 'booked',
  outcome: null,
  outcomeAt: null,
  rateCents: null,
  rateCurrency: null,
  settlementId: null,
  packDrawnKind: null,
  packDrawnAt: null,
  packDrawShortfallAt: null,
  ...over,
} as PtSession);

/* ── 1 · widening the window forward cannot grow the unmarked queue ────────
 *
 * `isAwaitingOutcome` requires the session to have ENDED. A booked, unmarked
 * row starting tomorrow is not something anybody has failed to record — it is
 * an appointment — and the banner that fires off this count holds up somebody's
 * pay, so a false one is expensive in both directions. */
{
  const yesterday = session({ id: 'past', startsAt: at(-24 * 60) });
  const tomorrow = session({ id: 'future', startsAt: at(24 * 60) });
  const midSession = session({ id: 'now', startsAt: at(-30) });

  ok(isAwaitingOutcome(yesterday, NOW), 'a finished, unmarked session is awaiting an outcome');
  ok(!isAwaitingOutcome(tomorrow, NOW), 'a session that has not happened is NOT awaiting an outcome');
  ok(!isAwaitingOutcome(midSession, NOW),
    'the hour a coach is standing in has not finished, so nothing is owed about it yet');

  eq(awaitingOutcome([yesterday, tomorrow, midSession], NOW).length, 1,
    'widening the read forward leaves the unmarked queue exactly as it was');
}

/* ── 2 · and cannot inflate what was delivered ────────────────────────────
 *
 * `deliveredBetween` bounds its own upper end at now by default. A row carrying
 * `outcome: 'completed'` with a start in the future is nonsense the database
 * should not hold, and the count refuses it rather than believing it. */
{
  const done = session({ id: 'done', outcome: 'completed', startsAt: at(-48 * 60) });
  const doneAhead = session({ id: 'ahead', outcome: 'completed', startsAt: at(48 * 60) });
  const since = NOW - DELIVERED_WINDOW_DAYS * 86_400_000;

  eq(deliveredBetween([done], since, NOW), 1, 'a completed session in the window is delivered');
  eq(deliveredBetween([done, doneAhead], since, NOW), 1,
    'a completed row dated in the future is not counted as delivered');
}

/* ── 3 · the Next line itself ──────────────────────────────────────────────
 *
 * One entry per client, the SOONEST one, and only sessions they are actually
 * holding. The dashboard takes `startsAt[0]`, so the ordering inside a client
 * is the whole of what the row says. */
{
  const row = (over: Partial<AheadRow> = {}): AheadRow => ({
    clientId: 'c1', startsAt: at(24 * 60), durationMin: 60, status: 'booked', outcome: null, ...over,
  });
  const map = new Map(
    bookedAhead([
      row({ clientId: 'c1', startsAt: at(72 * 60) }),
      row({ clientId: 'c1', startsAt: at(24 * 60) }),
      row({ clientId: 'c2', startsAt: at(48 * 60) }),
      // Given back. Not something c3 is holding, so c3 gets no line at all
      // rather than a line about a session that is not happening.
      row({ clientId: 'c3', startsAt: at(36 * 60), outcome: 'cancelled' }),
      // An open slot belongs to nobody.
      row({ clientId: null, startsAt: at(12 * 60), status: 'available' }),
      // Already over.
      row({ clientId: 'c4', startsAt: at(-48 * 60) }),
      // Past the fortnight.
      row({ clientId: 'c5', startsAt: at((BOOKED_AHEAD_DAYS + 1) * 24 * 60) }),
    ], NOW).map((a) => [a.clientId, a.startsAt[0]]),
  );

  eq(map.get('c1'), at(24 * 60), 'a client with two ahead gets the sooner of them');
  eq(map.get('c2'), at(48 * 60), 'each client gets their own next');
  eq(map.get('c3'), undefined, 'a cancelled future session is not a Next');
  eq(map.get('c4'), undefined, 'a finished session is not a Next');
  eq(map.get('c5'), undefined, 'a session past the window is not in the window');
  eq(map.size, 2, 'and nobody else acquires a line');
}

/* ── 4 · the guard the three client screens were missing ──────────────────
 *
 * `coach_clients.id` is a real uuid, so the id alone proves nothing. Only the
 * roster knows which table a row came from, and every read on
 * app/(trainer)/client-goals.tsx, app/(trainer)/checklists.tsx and the food-log
 * read on the dashboard's client sheet now hangs off this answer — because RLS
 * refuses those reads for a hand-added client by returning zero rows and NO
 * error, which three screens rendered as facts about the person. */
{
  const REAL = '3f2b0c8e-11d4-4a7b-9c30-6d5e1f80a2b7';
  eq(clientIsQueryable(REAL, true), false, 'a hand-added client is never asked about');
  eq(clientIsQueryable(REAL, false), true, 'a linked client is');
  eq(clientIsQueryable(REAL, undefined), true,
    'and an unknown provenance goes on asking rather than withholding somebody real');
  eq(clientIsQueryable(null, false), false, 'nobody picked is nobody to ask about');
}

if (errors.length) {
  console.error(`rosterNextSession: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('rosterNextSession: ok');
