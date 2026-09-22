// Tests for coachKit — the gym's register as the coach reads it.
//
// The assertions that matter are the negative ones. This module's whole job is
// that an empty list can never reach the screen standing in for "no gym",
// "nobody filled the register in" or "the read failed", so most of what is
// checked below is which SHAPE comes back rather than what is in it — and,
// crucially, that the rows are never the thing that decides.
//
// Compile with tsc, run with node.
import {
  coachKitView, downItems, serviceItems, kitLabel, kitHeadNote,
  KIT_UNREAD_NOTE, KIT_UNWRITTEN_NOTE, KIT_ALL_CLEAR_NOTE, KIT_SERVICE_NOTE,
} from './coachKit';
import type { Equipment } from './gymEquipment';
import { NOT_A_QUIET_GYM } from './gymLink';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-13';

/** A register row with everything in service and nothing scheduled. Each test
 *  overrides only the columns it is about, so a row's defaults cannot quietly
 *  supply the fact under test. */
function kit(over: Partial<Equipment> = {}): Equipment {
  return {
    id: 'e1', name: 'Rower', category: 'rower', identifier: null, quantity: 1,
    status: 'in_service', purchasedOn: null, serviceIntervalDays: null,
    lastServicedOn: null, note: null, outOfServiceReason: null, outOfServiceSince: null,
    ...over,
  };
}

/* ── the four silences, kept apart ────────────────────────────────────────── */
{
  // The same empty array under every link and every status. If the rows were
  // ever consulted before the link, these would all be one answer.
  const none = coachKitView('none', 'ready', [], TODAY);
  eq(none.kind, 'no_gym', 'an account with no gym gets the no-gym view, not an empty register');
  ok(none.kind === 'no_gym' && none.note.includes(NOT_A_QUIET_GYM),
    'and the sentence separates the reader from the gym — without it a coach reads "nothing is broken"');

  const unknown = coachKitView('unknown', 'ready', [], TODAY);
  eq(unknown.kind, 'unread', 'a profile read that has not settled is unread, never "no gym"');
  eq(unknown.kind === 'unread' ? unknown.note : null, KIT_UNREAD_NOTE, 'and says so in as many words');

  // A gym, rows present, and a status that is not whole. The rows are real and
  // are still not enough to state anything from.
  for (const bad of ['loading', 'error', 'partial'] as LoadStatus[]) {
    const v = coachKitView('gym', bad, [kit({ status: 'out_of_service' })], TODAY);
    eq(v.kind, 'unread', `status ${bad} may not be rendered as a register, even holding rows`);
  }

  const unwritten = coachKitView('gym', 'ready', [], TODAY);
  eq(unwritten.kind, 'unwritten', 'a gym with an empty register is an unfilled form');
  eq(unwritten.kind === 'unwritten' ? unwritten.note : null, KIT_UNWRITTEN_NOTE, 'said as a fact about the form');
  ok(KIT_UNWRITTEN_NOTE !== KIT_ALL_CLEAR_NOTE,
    'and it is NOT the all-clear sentence — an unfilled register is not a working gym');

  const clear = coachKitView('gym', 'ready', [kit(), kit({ id: 'e2' })], TODAY);
  eq(clear.kind, 'clear', 'a whole read of a register with nothing wrong is the one silence that is an answer');
  eq(clear.kind === 'clear' ? clear.usableUnits : null, 2, 'and it may count, because the read was whole');
}

/* ── retired kit is gone, not broken ──────────────────────────────────────── */
{
  const v = coachKitView('gym', 'ready', [kit({ status: 'retired' })], TODAY);
  eq(v.kind, 'unwritten', 'a register holding only disposed-of kit has nothing in it to program on');

  const mixed = coachKitView('gym', 'ready', [kit(), kit({ id: 'e2', status: 'retired' })], TODAY);
  eq(mixed.kind === 'clear' ? mixed.items : null, 1, 'retired rows are not counted as stock');
  eq(mixed.kind === 'clear' ? mixed.usableUnits : null, 1, 'nor as usable units');
}

/* ── what is out of action ────────────────────────────────────────────────── */
{
  const rows = [
    kit({ id: 'new', name: 'Rower 9', status: 'out_of_service', outOfServiceSince: '2026-09-11', outOfServiceReason: 'Chain snapped' }),
    kit({ id: 'old', name: 'Rower 1', status: 'out_of_service', outOfServiceSince: '2026-06-01' }),
    kit({ id: 'undated', name: 'Rower 4', status: 'out_of_service' }),
  ];
  const out = downItems(rows, TODAY);
  eq(out.map((d) => d.id).join(','), 'old,new,undated', 'longest out first, and an undated breakage sorts last rather than first');
  eq(out[0].daysDown, 104, 'whole days out, counted across the summer without a timezone shifting it');
  eq(out[2].daysDown, null, 'a row with no date is undated — never "out for 0 days", which would read as this morning');
  eq(out[0].reason, null, 'nobody said why, and that is null rather than an empty string a screen would render as a gap');
  eq(out[1].reason, 'Chain snapped', 'and the reason is carried in the words of whoever took it out');

  // A date in the future is not a duration.
  const ahead = downItems([kit({ status: 'out_of_service', outOfServiceSince: '2026-12-25' })], TODAY);
  eq(ahead[0].daysDown, null, 'a future out-of-service date yields no duration rather than a negative one or a zero');

  // Quantity, not rows. A rack of eight taken out is eight units down.
  const rack = downItems([kit({ status: 'out_of_service', quantity: 8 })], TODAY);
  eq(rack[0].units, 8, 'a row that stands for eight units is eight units down, not one');
}

/* ── what is due a service ────────────────────────────────────────────────── */
{
  const rows = [
    kit({ id: 'due', name: 'Bike', serviceIntervalDays: 90, lastServicedOn: '2026-06-20' }),
    kit({ id: 'over', name: 'Treadmill', serviceIntervalDays: 30, lastServicedOn: '2026-07-01' }),
    kit({ id: 'never', name: 'Rig', serviceIntervalDays: 180, lastServicedOn: null }),
    kit({ id: 'fine', name: 'Bench', serviceIntervalDays: 365, lastServicedOn: '2026-09-01' }),
    kit({ id: 'nosched', name: 'Kettlebell' }),
  ];
  const svc = serviceItems(rows, TODAY);
  eq(svc.map((s) => s.id).join(','), 'over,due,never', 'overdue, then due, then never recorded — and neither of the two healthy rows');
  eq(svc[0].daysOverdue, 44, 'overdue by whole days from the date it actually fell due');
  eq(svc[1].daysOverdue, null, 'something merely due is not overdue by zero days');
  eq(svc[2].dueOn, null, 'a schedule with no service ever logged has no due date to invent one from');
  eq(svc[2].state, 'unrecorded', 'and it is reported as its own state rather than folded into "due"');
  ok(KIT_SERVICE_NOTE.unrecorded !== KIT_SERVICE_NOTE.due,
    'the two are said differently on screen too, which is the point of keeping them apart');

  // A machine that is both broken and overdue appears once.
  const both = [kit({ id: 'x', status: 'out_of_service', serviceIntervalDays: 30, lastServicedOn: '2026-01-01' })];
  eq(serviceItems(both, TODAY).length, 0, 'a machine already out of action is not also listed as needing a service');
  eq(downItems(both, TODAY).length, 1, 'it is named once, where the coach will act on it');
}

/* ── the label, which is what the coach walks past ────────────────────────── */
{
  eq(kitLabel({ name: 'Rower', identifier: 'C2-114' }), 'Rower · C2-114', 'the asset tag is on the label, because nine rowers are all called Rower');
  eq(kitLabel({ name: 'Rower', identifier: null }), 'Rower', 'and is left off entirely when the register has none');
  eq(kitLabel({ name: '  ', identifier: null }), 'Unnamed item',
    'a blank name renders as words rather than as a hole, which reads as the screen having broken');
  eq(kitLabel({ name: 'Rower', identifier: '   ' }), 'Rower', 'a blank tag is no tag, not a trailing separator');
}

/* ── the heading figure, withheld wherever it would be a claim ────────────── */
{
  eq(kitHeadNote(coachKitView('none', 'ready', [], TODAY)), null, 'no figure beside the heading for an account with no gym');
  eq(kitHeadNote(coachKitView('unknown', 'loading', null, TODAY)), null, 'nor for a read that has not landed — a "0" there says nothing is broken');
  eq(kitHeadNote(coachKitView('gym', 'ready', [], TODAY)), null, 'nor for an unfilled register');

  const v = coachKitView('gym', 'ready', [
    kit({ id: 'a', status: 'out_of_service', quantity: 3 }),
    kit({ id: 'b', serviceIntervalDays: 30, lastServicedOn: '2026-01-01' }),
  ], TODAY);
  eq(v.kind, 'attention', 'a broken rack and an overdue service is something to say');
  eq(kitHeadNote(v), '3 out of action · 1 to service', 'and the heading counts units down, not rows down');
  eq(v.kind === 'attention' ? v.downUnits : null, 3, 'three units are down');
  eq(v.kind === 'attention' ? v.usableUnits : null, 1, 'and the broken three are not counted as usable');
}

if (errors.length) {
  console.error(`coachKit: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('coachKit ok');
