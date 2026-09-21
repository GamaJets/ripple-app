// What a member owes, shown to somebody standing at a turnstile. Compile with
// tsc, run with node.
//
// This is the most dangerous figure in the console: it is read out loud, to a
// person who cannot see the screen and cannot check it. Four properties have to
// hold and every one of them fails silently rather than loudly.
//
//   1. TWO CURRENCIES ARE NEVER ADDED. A member billed in two is owed two
//      amounts and this product holds no rate between them.
//   2. "OWES NOTHING" AND "COULD NOT BE READ" ARE DIFFERENT ANSWERS, and only
//      one of them may be said to a member's face.
//   3. A LOGIN THAT MAY NOT READ THE BILLING IS TOLD SO. `gym_invoices` is the
//      owner's and the member's own (part 29); row-level security FILTERS
//      rather than raising, so an unguarded read hands a receptionist an empty
//      list and a clean bill of health for every member in the building.
//   4. NOTHING HERE DECIDES THE DOOR. There is no verdict, and no wording that
//      implies one.
import {
  doorBalance, doorBalanceLine, overdueOn, isOwed, OWED_STATUSES, readStatus,
  fetchMemberDebt, DOOR_BALANCE_IS_NOT_A_DECISION, DOOR_BALANCE_IS_THE_RECORD,
  type DoorInvoice, type DoorBalance,
} from './doorBalance';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const TODAY = '2026-09-13';

const inv = (over: Partial<DoorInvoice> = {}): DoorInvoice => ({
  id: `i-${Math.random()}`,
  amountCents: 5000,
  currency: 'GBP',
  issuedOn: '2026-08-01',
  dueOn: '2026-08-31',
  status: 'open',
  ...over,
});

const owes = (b: DoorBalance) => (b.state === 'owes' ? b : null);

/* ── 1. two currencies are never added ─────────────────────────────────────── */

{
  const b = doorBalance([
    inv({ amountCents: 5000, currency: 'GBP' }),
    inv({ amountCents: 30000, currency: 'AED' }),
  ], TODAY, 'ready', true);
  eq(b.state, 'owes', 'a member with two open bills owes something');
  eq(owes(b)?.pots.length, 2, 'and it is TWO amounts, not one — no rate exists anywhere in this product');
  const line = doorBalanceLine(b) ?? '';
  ok(/AED/.test(line) && /£|GBP/.test(line), 'both currencies are named');
  ok(!/35000|350\.00|35,000/.test(line), 'and nothing anywhere added them');
}
{
  // One currency is the ordinary case and must still read as one figure.
  const b = doorBalance([inv({ amountCents: 5000 }), inv({ amountCents: 2500 })], TODAY, 'ready', true);
  eq(owes(b)?.pots.length, 1, 'two bills in one currency are one pot');
  eq(owes(b)?.pots[0].minorUnits, 7500, 'added, because they are the same money');
}

/* ── 2. nothing owed, and nothing known ────────────────────────────────────── */

eq(doorBalance([], TODAY, 'ready', true).state, 'clear', 'a whole read with nothing outstanding is clear');
eq(doorBalanceLine({ state: 'clear' }), null,
  'and says NOTHING — a line against every member who is up to date is a line the desk stops reading, and then the one that matters is invisible too');

for (const status of ['loading', 'error', 'partial'] as const) {
  const b = doorBalance(status === 'error' ? null : [], TODAY, status, true);
  eq(b.state, 'unreadable', `a ${status} read must never report a member as up to date`);
  ok((doorBalanceLine(b) ?? '').length > 0, `and ${status} says which silence it is, out loud`);
}
// A truncated read HAS rows and they are real. It still may not be totalled:
// the member's debt is exactly the kind of figure src/ui/loadStatus.ts forbids
// over a prefix.
eq(doorBalance([inv(), inv()], TODAY, 'partial', true).state, 'unreadable',
  'a truncated read is not a balance, even though the invoices in hand are real');

{
  const why = doorBalanceLine(doorBalance(null, TODAY, 'error', true)) ?? '';
  ok(/NOT a member who is up to date/.test(why), 'the refused-read sentence says what it is not');
  ok(/do not tell them either way/i.test(why), 'and tells the desk not to say anything to the person in front of them');
}
// The two silences share no words with "clear", which has none at all — the
// property that matters is that neither can be mistaken for the other.
ok(doorBalanceLine(doorBalance(null, TODAY, 'error', true))
  !== doorBalanceLine(doorBalance([], TODAY, 'loading', true)),
  'a refused read and a read still in flight do not say the same thing');

/* ── 3. a login that may not read the billing ──────────────────────────────── */

{
  // The default failure of this whole feature. A receptionist's query is
  // FILTERED to nothing by row-level security, with no error — so without this
  // arm the desk is told every member in the building is up to date.
  const b = doorBalance([], TODAY, 'ready', false);
  eq(b.state, 'withheld', 'a login that may not read the billing gets its own answer, not "clear"');
  const why = doorBalanceLine(b) ?? '';
  ok(/may not read/.test(why), 'and the sentence says the read was not made');
  ok(/Nothing here says they are up to date/.test(why),
    'and refuses the reading a blank would invite');
}
// Even holding rows — which cannot happen for that role and is checked anyway,
// because the guard must not be an inference from the data.
eq(doorBalance([inv()], TODAY, 'ready', false).state, 'withheld',
  'the guard is the caller’s stated role, never something read off the list');

/* ── 4. nothing here decides the door ──────────────────────────────────────── */

const ALL: DoorBalance[] = [
  { state: 'clear' },
  { state: 'withheld', why: 'x' },
  { state: 'unreadable', why: 'x' },
  doorBalance([inv({ dueOn: '2026-01-01' })], TODAY, 'ready', true),
];
for (const b of ALL) {
  const line = doorBalanceLine(b) ?? '';
  for (const word of ['refuse', 'deny', 'turn away', 'do not let', 'bar ', 'block']) {
    ok(!line.toLowerCase().includes(word),
      `the desk line must never say "${word}" — the door decision is the gym's, and this screen's job is to inform it`);
  }
}
ok(/does not refuse anybody entry over a bill/.test(DOOR_BALANCE_IS_NOT_A_DECISION),
  'and the note beside the figure says so in as many words');
ok(/quiet word rather than a turnstile/.test(DOOR_BALANCE_IS_NOT_A_DECISION),
  'and names what the gym actually does instead');
ok(/never entered looks exactly the same/.test(DOOR_BALANCE_IS_THE_RECORD),
  'the second note says an open invoice is the record being behind, not necessarily the member');

/* ── which invoices count ──────────────────────────────────────────────────── */

ok(isOwed('open') && isOwed('overdue'), 'open and overdue are money still owed');
ok(!isOwed('paid'), 'paid is not');
ok(!isOwed('draft'),
  'and neither is a DRAFT — nobody sent it, so a member has not been asked for it and must not be told at a turnstile that they owe it');
ok(!isOwed('void') && !isOwed('written_off'),
  'nor money the gym has already decided not to collect — asking for that at the door is worse than saying nothing');
ok(!isOwed(null) && !isOwed(''), 'and a row with no status states nothing');
eq(OWED_STATUSES.length, 2, 'exactly the two');

{
  const b = doorBalance([
    inv({ status: 'draft' }), inv({ status: 'paid' }),
    inv({ status: 'void' }), inv({ status: 'written_off' }),
  ], TODAY, 'ready', true);
  eq(b.state, 'clear', 'a member whose only invoices are drafts, paid, voided or written off owes nothing');
}

/* ── overdue is a string comparison ────────────────────────────────────────── */

ok(overdueOn({ status: 'open', dueOn: '2026-09-12' }, TODAY), 'yesterday’s due date is late today');
ok(!overdueOn({ status: 'open', dueOn: TODAY }, TODAY), 'an invoice due today is NOT late today');
ok(!overdueOn({ status: 'open', dueOn: null }, TODAY),
  'and one with no due date is never late — the gym never said when it wanted the money');
ok(overdueOn({ status: 'overdue', dueOn: null }, TODAY), 'a stored "overdue" is taken at its word');
ok(!overdueOn({ status: 'paid', dueOn: '2020-01-01' }, TODAY), 'a paid invoice is not late');
ok(!overdueOn({ status: 'open', dueOn: '2026-09-12' }, ''), 'with no day to compare against, nothing is late');
// The boundary that a Date would move. 1 January is the day after 31 December
// in every calendar, and neither is parsed.
ok(overdueOn({ status: 'open', dueOn: '2025-12-31' }, '2026-01-01'), 'across a year boundary, as strings');

/* ── what the figure is missing ────────────────────────────────────────────── */

{
  const b = doorBalance([
    inv({ amountCents: 5000 }),
    inv({ amountCents: null }),
    inv({ amountCents: 900, currency: null }),
  ], TODAY, 'ready', true);
  eq(owes(b)?.count, 3, 'all three are outstanding');
  eq(owes(b)?.unpriced, 1, 'one carries no amount at all');
  eq(owes(b)?.unlabelled, 1, 'and one carries an amount with no currency on it');
  eq(owes(b)?.pots.length, 1, 'so exactly one of them reaches the figure');
  const line = doorBalanceLine(b) ?? '';
  ok(/Not in the figure above/.test(line), 'and the line says the figure is short');
  ok(/more is outstanding than is shown/.test(line), 'and which direction it is short in');
}
{
  // Every invoice unpriced: there is a debt and no figure for it. The desk must
  // not be handed a blank, and must not be handed a zero.
  const b = doorBalance([inv({ amountCents: null }), inv({ amountCents: null })], TODAY, 'ready', true);
  eq(owes(b)?.pots.length, 0, 'nothing can be totalled');
  const line = doorBalanceLine(b) ?? '';
  ok(/no amount can be stated/.test(line), 'so no amount is stated');
  ok(!/\b0\b/.test(line), 'and certainly not zero');
}

/* ── the lateness sentence ─────────────────────────────────────────────────── */

{
  const line = doorBalanceLine(doorBalance([inv({ dueOn: '2026-12-01' })], TODAY, 'ready', true)) ?? '';
  ok(/not past the date they were given yet/.test(line),
    'a bill that is not due yet is said to be not due yet, rather than left to read as lateness');
}
{
  const line = doorBalanceLine(doorBalance(
    [inv({ dueOn: '2026-01-01' }), inv({ dueOn: '2026-12-01' })], TODAY, 'ready', true,
  )) ?? '';
  ok(/1 of 2 is past the date/.test(line), 'and where some are late, how many');
}
ok(/The gym’s record shows/.test(doorBalanceLine(doorBalance([inv()], TODAY, 'ready', true)) ?? ''),
  'the claim is about the RECORD, never "they have not paid" — a cash payment nobody entered looks identical');

/* ── which of the four states a read is in ─────────────────────────────────── */

eq(readStatus(false, false, true), 'loading', 'not back yet');
eq(readStatus(true, true, true), 'error', 'refused');
eq(readStatus(true, false, false), 'partial', 'back, and short — which is NOT ready');
eq(readStatus(true, false, true), 'ready', 'back and whole');
eq(readStatus(false, true, true), 'error', 'a failure outranks a read still in flight');

/* ── the read ──────────────────────────────────────────────────────────────── */

const threw = async (p: Promise<unknown>): Promise<string | null> => {
  try { await p; return null; } catch (e: any) { return String(e?.message ?? e); }
};

const reading = (data: any[] | null, error: unknown = null, captured?: any[]) => ({
  from: (_t: string) => {
    const q: any = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = (_c: string, v: string[]) => { captured?.push(v); return q; };
    q.order = () => q;
    q.limit = () => Promise.resolve({ data, error });
    return q;
  },
});

void (async () => {
  {
    const captured: any[] = [];
    const row = { id: 'i1', amount_cents: 5000, currency: 'GBP', issued_on: '2026-08-01', due_on: '2026-08-31', status: 'open' };
    const r = await fetchMemberDebt(reading([row], null, captured) as any, 't1', 'm1');
    eq(r.invoices.length, 1, 'the ordinary case comes back');
    eq(r.whole, true, 'and a short page is the whole set');
    eq(captured[0].join(','), 'open,overdue',
      'and the query asks the database for the two statuses, so a draft never crosses the wire to the desk');
  }
  {
    const row = { id: 'i1', amount_cents: null, currency: null, issued_on: '2026-08-01', due_on: null, status: 'open' };
    const r = await fetchMemberDebt(reading([row]) as any, 't1', 'm1');
    eq(r.invoices[0].amountCents, null, 'a missing amount stays null — never 0, which would be a claim');
    eq(r.invoices[0].currency, null, 'and a missing currency stays null — there is no default in this product');
  }
  {
    const why = await threw(fetchMemberDebt(reading(null, { message: 'refused' }) as any, 't1', 'm1'));
    ok(why != null,
      'a refused read THROWS — an empty list here means "they are up to date", said to somebody’s face');
  }
  {
    const full = Array.from({ length: 1001 }, (_v, i) => ({
      id: `i${i}`, amount_cents: 100, currency: 'GBP', issued_on: '2026-08-01', due_on: null, status: 'open',
    }));
    const r = await fetchMemberDebt(reading(full) as any, 't1', 'm1');
    eq(r.whole, false, 'a page that came back at the ceiling is a prefix, and no total may be taken over it');
  }

  if (errors.length) {
    console.error(`doorBalance.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('doorBalance.test.ts — ok');
})();
