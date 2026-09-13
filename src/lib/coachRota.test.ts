// Tests for coachRota — the rota read back to the person working it.
//
// The load-bearing assertions are the refusals: an empty fortnight can never
// stand in for "no gym" or "the read failed", two currencies are never added,
// and a pulled shift is neither hidden nor counted as cover.
//
// Compile with tsc, run with node.
import {
  coachRotaView, myRotaDays, shiftPay, liveHours, rotaHeadNote, rotaEmptyNote,
  ROTA_UNREAD_NOTE, SHIFT_ROLE_LABEL,
} from './coachRota';
import type { Shift } from './gymRota';
import { NOT_A_QUIET_GYM } from './gymLink';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A gym four hours ahead of UTC, which is where this product is sold. */
const ZONE = 'Asia/Dubai';

function shift(over: Partial<Shift> = {}): Shift {
  return {
    id: 'sh1', trainerId: 'coach', trainerName: 'Coach',
    startsAt: '2026-09-15T02:00:00.000Z', endsAt: '2026-09-15T06:00:00.000Z',
    role: 'floor', status: 'scheduled', note: null, rateCents: null, currency: null,
    ...over,
  };
}

/* ── the four silences ────────────────────────────────────────────────────── */
{
  const none = coachRotaView('none', 'ready', [shift()], ZONE, 14);
  eq(none.kind, 'no_gym', 'a coach with no gym is not a coach with an empty rota');
  ok(none.kind === 'no_gym' && none.note.includes(NOT_A_QUIET_GYM),
    'and the sentence separates the reader from the gym');

  const unknown = coachRotaView('unknown', 'ready', [shift()], ZONE, 14);
  eq(unknown.kind, 'unread', 'an unsettled profile read is unread, never "no gym"');
  eq(unknown.kind === 'unread' ? unknown.note : null, ROTA_UNREAD_NOTE, 'and says it is not a claim that there are no shifts');

  for (const bad of ['loading', 'error', 'partial'] as LoadStatus[]) {
    const v = coachRotaView('gym', bad, [shift()], ZONE, 14);
    eq(v.kind, 'unread', `status ${bad} may not be drawn as a rota, even holding rows`);
    eq(rotaHeadNote(v), null, `and carries no figure beside the heading under ${bad}`);
  }

  const empty = coachRotaView('gym', 'ready', [], ZONE, 14);
  eq(empty.kind, 'none', 'a whole read that found nothing is its own answer');
  ok(empty.kind === 'none' && empty.note.includes('14'), 'and it names the window it looked at');
  ok(rotaEmptyNote(7) !== rotaEmptyNote(14), 'a different window is a different sentence');
  ok(ROTA_UNREAD_NOTE !== rotaEmptyNote(14), 'and "we could not read it" is not "you are not on"');
}

/* ── the gym's day, not the phone's ───────────────────────────────────────── */
{
  // 21:00 UTC on the 15th is 01:00 on the 16th in Dubai. A coach reading this
  // in London must see the gym's day or they turn up on the wrong one.
  const late = myRotaDays([shift({ startsAt: '2026-09-15T21:00:00.000Z', endsAt: '2026-09-16T01:00:00.000Z' })], ZONE);
  eq(late.length, 1, 'one day');
  eq(late[0].day, '2026-09-16', 'bucketed on the gym’s calendar, which is already tomorrow');
  eq(late[0].shifts[0].fromLabel, '01:00', 'and the clock label is the gym’s wall clock too');

  // With no zone at all the reader's day is used, which is what the screen must
  // caption. It is still a day rather than nothing.
  const noZone = myRotaDays([shift()], null);
  eq(noZone.length, 1, 'a gym with no timezone still produces a day, on the reader’s calendar');

  const junk = myRotaDays([shift({ id: 'bad', startsAt: 'not a date' })], ZONE);
  eq(junk.length, 0, 'a shift that cannot be placed on a day is dropped rather than dated by guess');
}

/* ── ordering is total ────────────────────────────────────────────────────── */
{
  const days = myRotaDays([
    shift({ id: 'b', startsAt: '2026-09-16T02:00:00.000Z', endsAt: '2026-09-16T06:00:00.000Z' }),
    shift({ id: 'a', startsAt: '2026-09-15T10:00:00.000Z', endsAt: '2026-09-15T12:00:00.000Z' }),
    shift({ id: 'z', startsAt: '2026-09-15T02:00:00.000Z', endsAt: '2026-09-15T06:00:00.000Z' }),
    shift({ id: 'y', startsAt: '2026-09-15T02:00:00.000Z', endsAt: '2026-09-15T05:00:00.000Z' }),
  ], ZONE);
  eq(days.map((d) => d.day).join(','), '2026-09-15,2026-09-16', 'days ascending');
  eq(days[0].shifts.map((s) => s.id).join(','), 'y,z,a',
    'within a day by start, and two shifts at the same hour break on id rather than on the sort’s luck');
}

/* ── a pulled shift is kept, shown, and never counted as cover ────────────── */
{
  const v = coachRotaView('gym', 'ready', [
    shift({ id: 'on' }),
    shift({ id: 'off', status: 'cancelled', startsAt: '2026-09-17T02:00:00.000Z', endsAt: '2026-09-17T06:00:00.000Z' }),
  ], ZONE, 14);
  eq(v.kind, 'rota', 'a fortnight with something in it');
  eq(v.kind === 'rota' ? v.live : null, 1, 'one shift to plan around');
  eq(v.kind === 'rota' ? v.pulled : null, 1, 'and one the gym dropped, counted apart rather than netted off');
  eq(v.kind === 'rota' ? v.days.length : null, 2, 'the pulled one is still on the list — the hole in the week is a fact');
  eq(rotaHeadNote(v), '1 shift', 'the heading counts cover, not rows');
  eq(v.kind === 'rota' ? v.hours : null, 4, 'and the hours are the live ones only');
}

/* ── money: one pot per currency, and unpriced is not free ────────────────── */
{
  const lines = myRotaDays([
    shift({ id: 'a', rateCents: 6000, currency: 'GBP' }),
    shift({ id: 'b', rateCents: 4000, currency: 'gbp ', startsAt: '2026-09-16T02:00:00.000Z', endsAt: '2026-09-16T06:00:00.000Z' }),
    shift({ id: 'c', rateCents: 22000, currency: 'AED', startsAt: '2026-09-17T02:00:00.000Z', endsAt: '2026-09-17T06:00:00.000Z' }),
    shift({ id: 'd', startsAt: '2026-09-18T02:00:00.000Z', endsAt: '2026-09-18T06:00:00.000Z' }),
    shift({ id: 'e', rateCents: 9900, currency: 'GBP', status: 'cancelled', startsAt: '2026-09-19T02:00:00.000Z', endsAt: '2026-09-19T06:00:00.000Z' }),
  ], ZONE).flatMap((d) => d.shifts);
  const pay = shiftPay(lines);
  eq(pay.pots.length, 2, 'two moneys, two pots — never one figure');
  eq(pay.pots.map((p) => p.currency).join(','), 'AED,GBP', 'ordered by code so the list does not move between renders');
  eq(pay.pots[1].cents, 10000, 'and “gbp ” is the same money as “GBP”, not a third pot');
  eq(pay.pots[1].shifts, 2, 'two priced shifts in it');
  eq(pay.unpriced, 1, 'the unpriced one is counted rather than added in as nought');
  ok(!pay.pots.some((p) => p.cents === 19900), 'a pulled shift contributes nothing, and is not deducted either');
}

/* ── hours are all-or-nothing ─────────────────────────────────────────────── */
{
  const good = myRotaDays([
    shift({ id: 'a' }),
    shift({ id: 'b', startsAt: '2026-09-16T02:00:00.000Z', endsAt: '2026-09-16T05:30:00.000Z' }),
  ], ZONE).flatMap((d) => d.shifts);
  eq(liveHours(good), 7.5, 'hours add up across the window');

  // A row whose end is not after its start cannot be read as a span. The
  // database refuses one (`gym_shifts_span`) and this refuses to total over it.
  const bad = myRotaDays([
    shift({ id: 'a' }),
    shift({ id: 'b', startsAt: '2026-09-16T06:00:00.000Z', endsAt: '2026-09-16T06:00:00.000Z' }),
  ], ZONE).flatMap((d) => d.shifts);
  eq(liveHours(bad), null, 'one unreadable span withholds the total rather than quietly shrinking it');

  eq(liveHours([]), null, 'and no live shifts is no total, not zero hours');
}

/* ── every role a shift can hold has words ────────────────────────────────── */
{
  for (const role of ['floor', 'classes', 'pt', 'desk', 'admin'] as const) {
    ok(!!SHIFT_ROLE_LABEL[role] && SHIFT_ROLE_LABEL[role].length > 2,
      `${role} is named in words a coach reads, not left as a column value`);
  }
}

if (errors.length) {
  console.error(`coachRota: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('coachRota ok');
