// Tests for coachClose — the coach's own share of a month that will not close.
//
// Three things are being pinned, and the first two are refusals:
//
//   · an empty queue can never stand in for "no gym", "not read yet", or "one
//     of the two halves failed";
//   · `blocking` is true for unmarked SESSIONS and for nothing else, because a
//     class register does not block a close and this module must not be able to
//     say it does;
//   · the month bound is a bound. A session in July is not a reason August will
//     not close, whichever end of the window it falls off.
//
// Compile with tsc, run with node.
import {
  coachCloseView, unmarkedInMonth, closeQueueNote,
  CLOSE_QUEUE_UNREAD, REGISTERS_DO_NOT_BLOCK, UNMARKED_BLOCKS_THE_CLOSE,
} from './coachClose';
import type { PtSession } from './gymSessions';
import type { ClassSummaryRow } from './classRates';
import { NOT_A_QUIET_GYM } from './gymLink';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// August 2026, as a gym four hours ahead of UTC would cut it.
const MONTH = {
  key: '2026-08',
  label: 'August 2026',
  fromIso: '2026-07-31T20:00:00.000Z',
  toIso: '2026-08-31T20:00:00.000Z',
};
const NOW = Date.parse('2026-09-13T09:00:00.000Z');

function sess(over: Partial<PtSession> = {}): PtSession {
  return {
    id: 's1', trainerId: 'coach', trainerName: 'Coach', clientId: 'c1', clientName: 'Dana',
    startsAt: '2026-08-12T06:00:00.000Z', durationMin: 60, status: 'booked', outcome: null,
    outcomeAt: null, rateCents: null, rateCurrency: null, settlementId: null,
    packDrawnKind: null, packDrawnAt: null, packDrawShortfallAt: null,
    ...over,
  } as PtSession;
}

function klass(over: Partial<ClassSummaryRow> = {}): ClassSummaryRow {
  return {
    classId: 'k1', title: 'Sunrise', kind: 'hiit', branch: 'Main', trainerId: 'coach',
    trainerName: 'Coach', startsAt: '2026-08-14T05:00:00.000Z', capacity: 14,
    booked: 9, attended: 0,
    ...over,
  } as ClassSummaryRow;
}

const READY = (rows: readonly PtSession[]) => ({ status: 'ready' as LoadStatus, rows });
const CLS = (rows: readonly ClassSummaryRow[]) => ({ status: 'ready' as LoadStatus, rows });
const GONE = { status: 'error' as LoadStatus, rows: null };

/* ── the silences, kept apart ─────────────────────────────────────────────── */
{
  const none = coachCloseView('none', MONTH, READY([sess()]), CLS([klass()]), NOW);
  eq(none.kind, 'no_gym', 'a coach with no gym has no gym closing a month around them');
  ok(none.kind === 'no_gym' && none.note.includes(NOT_A_QUIET_GYM),
    'and the sentence says so rather than showing them an empty deadline list');

  const unknown = coachCloseView('unknown', MONTH, READY([sess()]), CLS([klass()]), NOW);
  eq(unknown.kind, 'unread', 'an unsettled profile read is unread, never "no gym"');
  eq(unknown.kind === 'unread' ? unknown.note : null, CLOSE_QUEUE_UNREAD, 'and says it is not a claim either way');

  const nomonth = coachCloseView('gym', null, READY([]), CLS([]), NOW);
  eq(nomonth.kind, 'unread', 'a queue with no month to scope it to is not a queue');
}

/* ── a failed half is unknown, not empty ──────────────────────────────────── */
{
  const v = coachCloseView('gym', MONTH, GONE, CLS([klass()]), NOW);
  ok(v.kind === 'month' && v.sessions.state === 'unread', 'a refused sessions read is unread');
  ok(v.kind === 'month' && v.registers.state === 'ready' && v.registers.rows.length === 1,
    'and it does not take the register half down with it');
  eq(v.kind === 'month' ? v.blocking : null, false,
    'blocking is never claimed off a read that did not land — a failed read is not a clean month');
  eq(v.kind === 'month' ? v.clear : null, false,
    'and nor is "you are clear", which is a claim half a read cannot support');

  for (const bad of ['loading', 'error', 'partial'] as LoadStatus[]) {
    const half = coachCloseView('gym', MONTH, { status: bad, rows: [sess()] }, CLS([]), NOW);
    ok(half.kind === 'month' && half.sessions.state === 'unread',
      `status ${bad} may not be counted, even holding rows`);
  }

  const bothGone = coachCloseView('gym', MONTH, GONE, { status: 'error', rows: null }, NOW);
  eq(bothGone.kind === 'month' ? bothGone.clear : null, false, 'two failed reads are not an empty queue');
  eq(closeQueueNote(bothGone), null, 'and there is no figure to put beside the heading');
}

/* ── what blocks, and what does not ───────────────────────────────────────── */
{
  const onlyRegisters = coachCloseView('gym', MONTH, READY([]), CLS([klass()]), NOW);
  eq(onlyRegisters.kind === 'month' ? onlyRegisters.blocking : null, false,
    'an open class register does NOT block the close — class attendance is not one of the five close parts');
  ok(onlyRegisters.kind === 'month' && onlyRegisters.registers.state === 'ready'
    && onlyRegisters.registers.rows.length === 1, 'it is still listed, because the gym’s record says nobody came');
  eq(onlyRegisters.kind === 'month' ? onlyRegisters.clear : null, false, 'so the month is not clear either');
  ok(!REGISTERS_DO_NOT_BLOCK.includes('cannot be signed off'),
    'and the register copy does not borrow the sentence that belongs to sessions');
  ok(UNMARKED_BLOCKS_THE_CLOSE !== REGISTERS_DO_NOT_BLOCK, 'the two halves are told apart in words as well as in code');

  const onlySessions = coachCloseView('gym', MONTH, READY([sess()]), CLS([]), NOW);
  eq(onlySessions.kind === 'month' ? onlySessions.blocking : null, true,
    'a one-to-one with no outcome is the blocker the owner’s console is already refusing on');

  const clean = coachCloseView('gym', MONTH, READY([sess({ outcome: 'completed' })]), CLS([klass({ attended: 9 })]), NOW);
  eq(clean.kind === 'month' ? clean.clear : null, true, 'both halves read whole and both empty is the one clear answer');
  eq(closeQueueNote(clean), null, 'and it carries no figure — the absence is the message');
}

/* ── the month is a bound ─────────────────────────────────────────────────── */
{
  const rows = [
    sess({ id: 'july', startsAt: '2026-07-20T06:00:00.000Z' }),
    sess({ id: 'aug', startsAt: '2026-08-12T06:00:00.000Z' }),
    sess({ id: 'sept', startsAt: '2026-09-02T06:00:00.000Z' }),
    // The gym is four hours ahead: 21:00 UTC on the 31st is already September
    // there, and the window's exclusive upper bound is what decides it.
    sess({ id: 'edge', startsAt: '2026-08-31T21:00:00.000Z' }),
    // And the first hours of the 1st in UTC are still July at the gym.
    sess({ id: 'edge2', startsAt: '2026-08-01T01:00:00.000Z' }),
  ];
  const out = unmarkedInMonth(rows, MONTH.fromIso, MONTH.toIso, NOW);
  eq(out.map((u) => u.id).join(','), 'edge2,aug',
    'only the gym’s August, oldest first — the UTC-31st-evening session belongs to September at this gym');

  // Not every unmarked-looking row is awaiting an outcome.
  const notWaiting = unmarkedInMonth([
    sess({ id: 'done', outcome: 'no_show' }),
    sess({ id: 'free', status: 'available' }),
    sess({ id: 'future', startsAt: '2026-08-31T18:00:00.000Z' }),
  ], MONTH.fromIso, MONTH.toIso, Date.parse('2026-08-15T00:00:00.000Z'));
  eq(notWaiting.length, 0,
    'a marked session, an unbooked slot and a session that has not happened yet are none of them waiting on anybody');

  const unreadable = unmarkedInMonth([sess({ id: 'junk', startsAt: 'not a date' })], MONTH.fromIso, MONTH.toIso, NOW);
  eq(unreadable.length, 0, 'a row that cannot be placed in the month is not offered as a reason the month will not close');

  eq(unmarkedInMonth([sess()], 'nonsense', MONTH.toIso, NOW).length, 0, 'and a window that is not one yields nothing rather than everything');
}

/* ── the heading figure ───────────────────────────────────────────────────── */
{
  const v = coachCloseView('gym', MONTH, READY([sess(), sess({ id: 's2', startsAt: '2026-08-20T06:00:00.000Z' })]), CLS([klass()]), NOW);
  eq(closeQueueNote(v), '2 to mark · 1 to register', 'both halves counted, and named for what they need');
  eq(closeQueueNote(coachCloseView('none', MONTH, READY([]), CLS([]), NOW)), null, 'no figure for an account with no gym');
}

if (errors.length) {
  console.error(`coachClose: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('coachClose ok');
