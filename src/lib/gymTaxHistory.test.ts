// What a gym said about its tax registration DURING a period. Compile with
// tsc, run with node.
//
// The defect these assertions stand against is one boolean printed over a
// quarter it was not true in: `tenants.tax_registered` is current state, /tax
// renders it above whichever period the picker is on, and a gym that registered
// in April therefore reads "This gym says it is registered, under the number
// below" over its Q1 figures — under a number that did not exist in January.
//
// Four things have to hold and every one of them fails silently:
//
//   · a period that ENDED before the gym registered must not read as
//     registered, and the other way round;
//   · a period the registration CHANGED inside has no single answer, and must
//     say so with the date rather than pick one;
//   · a period nobody has answered for must not read as "not registered" —
//     that is the confident-voice failure `tenants.tax_registered` is nullable
//     to avoid;
//   · a refused READ must not read as a business that has said nothing.
//
// And one arithmetic property: 31 March and 1 April are adjacent, not a gap.
import {
  registrationDuring, standingLine, standingBlockers, byDate, covers, isoDay,
  recordTaxStanding, endTaxStanding, fetchTaxStandings,
  CURRENT_FLAG_IS_NOT_A_PERIOD_NOTE, STANDING_LABEL,
  type TaxStanding, type TaxStandingDraft,
} from './gymTaxHistory';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const s = (over: Partial<TaxStanding> & Pick<TaxStanding, 'fromOn'>): TaxStanding => ({
  id: `st-${over.fromOn}`,
  status: 'registered',
  registration: 'GB123456789',
  toOn: null,
  note: null,
  ...over,
});

/** Q1 and Q2 of 2026, which is the shape `taxPeriod` hands this. */
const Q1 = ['2026-01-01', '2026-03-31'] as const;
const Q2 = ['2026-04-01', '2026-06-30'] as const;

/* ── the April gym ─────────────────────────────────────────────────────────── */

// Registered from 6 April 2026, still now, and nothing said about before.
const april = [s({ fromOn: '2026-04-06' })];

{
  const d = registrationDuring(april, Q1[0], Q1[1], 'ready');
  eq(d.state, 'unstated',
    'a quarter that ended before the gym registered is UNSTATED — the defect is it reading as registered');
  const line = standingLine(d, 'Q1 2026 · January to March');
  ok(/Nobody has said/.test(line), 'and the sentence says nobody has said');
  ok(!/is registered/.test(line), 'and never claims the registration that came later');
  ok(/not the same as saying it was not/.test(line),
    'and refuses the other confident voice too — unstated is not a denial');
  ok(/Q1 2026/.test(line), 'the sentence names the period it is about, which is the whole fix');
}
{
  // Q2 contains 6 April, so the answer CHANGES inside it — from unanswered to
  // registered. That is a gap, not a change of standing: nothing was said about
  // 1–5 April, so there is nothing for it to have changed from.
  const d = registrationDuring(april, Q2[0], Q2[1], 'ready');
  eq(d.state, 'gap', 'the quarter the gym registered in is only partly answered for');
  eq(d.state === 'gap' ? d.from : null, '2026-04-01', 'the unanswered stretch starts on the first of the quarter');
  eq(d.state === 'gap' ? d.to : null, '2026-04-05', 'and ends the day before the registration did');
  ok(/2026-04-01 to 2026-04-05/.test(standingLine(d, 'Q2 2026')), 'and the sentence names those days');
}
{
  // Q3, entirely after. One answer throughout.
  const d = registrationDuring(april, '2026-07-01', '2026-09-30', 'ready');
  eq(d.state, 'registered', 'a quarter wholly inside the registration is answered');
  eq(d.state === 'registered' ? d.registration : null, 'GB123456789', 'and carries the number that was in force');
}

/* ── the gym that deregistered ─────────────────────────────────────────────── */

const left = [
  s({ id: 'a', fromOn: '2024-01-01', toOn: '2026-06-05' }),
  s({ id: 'b', fromOn: '2026-06-06', status: 'not_registered', registration: null }),
];

{
  const d = registrationDuring(left, Q2[0], Q2[1], 'ready');
  eq(d.state, 'changed', 'a quarter the standing changed inside has no single answer');
  eq(d.state === 'changed' ? d.on : null, '2026-06-06', 'and it names the day it changed');
  eq(d.state === 'changed' ? d.before : null, 'registered', 'what it was');
  eq(d.state === 'changed' ? d.after : null, 'not_registered', 'and what it became');
  const line = standingLine(d, 'Q2 2026');
  ok(/2026-06-06/.test(line), 'the date is in the sentence, because the date is the actionable part');
  ok(/no single answer/.test(line), 'and it refuses to print one');
}
{
  // Q1 2026 is wholly inside the registration, even though the gym has since
  // left. This is the half the current-state flag gets backwards.
  const d = registrationDuring(left, Q1[0], Q1[1], 'ready');
  eq(d.state, 'registered',
    'a quarter the gym WAS registered in stays registered after it deregisters — the flag reads the opposite');
}
{
  const d = registrationDuring(left, '2026-07-01', '2026-09-30', 'ready');
  eq(d.state, 'not_registered', 'and a quarter wholly after it left says so');
  ok(/was not registered/.test(standingLine(d, 'Q3 2026')), 'in the past tense, about that period');
}

/* ── 31 March and 1 April are adjacent ─────────────────────────────────────── */
//
// The one piece of arithmetic in the module. Part 2641 stores the LAST day a
// statement was true, so a walk that could not compute "the day after 31 March"
// would report a one-day hole at every quarter boundary in the product.

const backToBack = [
  s({ id: 'a', fromOn: '2026-01-01', toOn: '2026-03-31', registration: 'OLD' }),
  s({ id: 'b', fromOn: '2026-04-01', registration: 'NEW' }),
];
{
  const d = registrationDuring(backToBack, '2026-01-01', '2026-06-30', 'ready');
  eq(d.state, 'registered', 'two adjacent registered periods are one answer, not a gap and not a change');
  eq(d.state === 'registered' ? d.registration : 'x', null,
    'but the NUMBER is withheld: two numbers were in force and printing either would print the wrong one for half the period');
  ok(/has not stated a number/.test(standingLine(d, 'H1 2026')), 'and the sentence asks for one rather than inventing it');
}
{
  const d = registrationDuring(backToBack, Q1[0], Q1[1], 'ready');
  eq(d.state === 'registered' ? d.registration : null, 'OLD',
    'a period inside one statement gets that statement’s own number');
}

// A genuine one-day hole is still a hole.
const oneDayHole = [
  s({ id: 'a', fromOn: '2026-01-01', toOn: '2026-03-30' }),
  s({ id: 'b', fromOn: '2026-04-01' }),
];
{
  const d = registrationDuring(oneDayHole, Q1[0], '2026-06-30', 'ready');
  eq(d.state, 'gap', 'a day nobody answered for is a gap');
  eq(d.state === 'gap' ? d.from : null, '2026-03-31', 'named exactly');
  eq(d.state === 'gap' ? d.to : null, '2026-03-31', 'at both ends');
  ok(/but not for 2026-03-31/.test(standingLine(d, 'H1 2026')), 'and the single-day wording is not pluralised');
}

/* ── nothing said at all, and nothing read ─────────────────────────────────── */

eq(registrationDuring([], Q1[0], Q1[1], 'ready').state, 'unstated',
  'a gym that has recorded nothing has said nothing — NOT that it is unregistered');

for (const status of ['loading', 'error', 'partial'] as const) {
  const d = registrationDuring(status === 'error' ? null : [], Q1[0], Q1[1], status);
  eq(d.state, 'unread', `a ${status} read must not answer for a period`);
  ok((d.state === 'unread' ? d.why : '').length > 0, `and ${status} must say which silence it is`);
}
ok(/could not be read/.test(standingLine(registrationDuring(null, Q1[0], Q1[1], 'error'), 'Q1 2026')),
  'a refused read says so rather than saying the gym has said nothing');
ok(/still stands/.test(standingLine(registrationDuring(null, Q1[0], Q1[1], 'error'), 'Q1 2026')),
  'and says what is already recorded is unaffected');

// A statement that ended years before the period must not join the walk: as the
// first of two it would report the period as "changed".
eq(registrationDuring([s({ id: 'old', fromOn: '2019-01-01', toOn: '2019-12-31' })], Q1[0], Q1[1], 'ready').state,
  'unstated', 'a registration that ended in 2019 says nothing about 2026');

/* ── the current flag is not an answer to this question ────────────────────── */

ok(/cannot answer for a period that has already ended/.test(CURRENT_FLAG_IS_NOT_A_PERIOD_NOTE),
  'the note about tenants.tax_registered has to say why it is kept apart');
ok(!!STANDING_LABEL.registered && !!STANDING_LABEL.not_registered, 'both statuses have words a screen shows');

/* ── helpers ───────────────────────────────────────────────────────────────── */

ok(covers(s({ fromOn: '2026-01-01', toOn: '2026-03-31' }), '2026-03-31'), 'the last day is inside');
ok(!covers(s({ fromOn: '2026-01-01', toOn: '2026-03-31' }), '2026-04-01'), 'the day after is not');
ok(covers(s({ fromOn: '2026-01-01' }), '2099-01-01'), 'an open statement covers everything after it');
eq(byDate([s({ id: 'b', fromOn: '2026-04-01' }), s({ id: 'a', fromOn: '2026-01-01' })])[0].fromOn,
  '2026-01-01', 'oldest first');

ok(isoDay('2026-02-28'), 'a real day');
ok(!isoDay('2026-02-31'), 'and one that only looks like one — Date rolls it into March and says nothing');
ok(!isoDay(''), 'empty is not a day');

/* ── what will not be recorded ─────────────────────────────────────────────── */

const draft = (over: Partial<TaxStandingDraft> = {}): TaxStandingDraft => ({
  status: 'registered', registration: 'GB1', fromOn: '2026-04-06', toOn: '', ...over,
});

eq(standingBlockers(draft(), []).length, 0, 'the ordinary case is allowed through');
ok(standingBlockers(draft({ fromOn: '' }), []).some((b) => /start day/.test(b)),
  'a statement with no start day is the flag this replaces, and is refused as that');
ok(standingBlockers(draft({ toOn: '2026-01-01' }), []).some((b) => /ends before it starts/.test(b)),
  'and one that ends before it starts');
ok(standingBlockers(draft({ status: 'not_registered' }), []).some((b) => /still carries a registration number/.test(b)),
  '"not registered, number GB1" is a row nobody can act on — the same CHECK part 701 already has');
ok(standingBlockers(draft({ registration: 'x'.repeat(61) }), []).length > 0, 'and a number longer than the column');

{
  const clash = standingBlockers(draft({ fromOn: '2026-05-01' }), [s({ fromOn: '2026-01-01' })]);
  ok(clash.some((b) => /overlaps/.test(b)), 'an overlap is refused while somebody is still typing, not by a 23P01 afterwards');
  ok(clash.some((b) => /close the existing period/i.test(b)), 'and the answer says what to do instead');
}
eq(standingBlockers(draft({ fromOn: '2026-04-01' }), [s({ fromOn: '2026-01-01', toOn: '2026-03-31' })]).length, 0,
  'adjacent is not overlapping — 31 March and 1 April, again');

/* ── the writes are confirmed by the row ───────────────────────────────────── */

const threw = async (p: Promise<unknown>): Promise<string | null> => {
  try { await p; return null; } catch (e: any) { return String(e?.message ?? e); }
};

function insertDb(opts: { row?: unknown; error?: unknown; captured?: any[] }) {
  return {
    from: (_t: string) => ({
      insert: (payload: any) => {
        opts.captured?.push(payload);
        return { select: () => ({ single: () => Promise.resolve({ data: opts.row ?? null, error: opts.error ?? null }) }) };
      },
    }),
  };
}

void (async () => {
  {
    const captured: any[] = [];
    const row = { id: 'st-1', status: 'registered', registration: 'GB1', from_on: '2026-04-06', to_on: null, note: null };
    const r = await recordTaxStanding(insertDb({ row, captured }) as any, 't1', draft());
    eq(r.fromOn, '2026-04-06', 'the ordinary case comes back');
    eq(captured[0].to_on, null, 'an empty end day is stored as "and still", not as an empty string');
  }
  {
    const captured: any[] = [];
    await recordTaxStanding(insertDb({ row: { id: 'x', status: 'not_registered', registration: null, from_on: '2026-06-06', to_on: null, note: null }, captured }) as any,
      't1', draft({ status: 'not_registered', registration: '   ' }));
    eq(captured[0].registration, null, 'a blank number is null — the CHECK refuses an empty string, and null is what an empty box means');
  }
  {
    const why = await threw(recordTaxStanding(insertDb({ row: null }) as any, 't1', draft()));
    ok(why != null && /was NOT recorded/.test(why),
      'no error and no row is a policy filtering the insert to nothing, not a success');
  }

  {
    // The count, not the error. `gym_tax_registrations_owner` is
    // `is_owner_of(tenant_id)`, so an update by anybody else matches zero rows
    // and returns no error at all.
    const sb = { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null, count: 0 }) }) }) };
    const why = await threw(endTaxStanding(sb as any, 'st-1', '2026-06-05'));
    ok(why != null, 'closing a period that matched no row is reported, not reported as done');
  }
  {
    const sb = { from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null, count: 1 }) }) }) };
    eq(await threw(endTaxStanding(sb as any, 'st-1', '2026-06-05')), null, 'and the ordinary case is quiet');
  }

  {
    // The read ends on the SECOND `.order()`, so the fake resolves there.
    const reading = (data: any[] | null, error: unknown = null) => ({
      from: (_t: string) => {
        const q: any = {};
        q.select = () => q;
        q.eq = () => q;
        let n = 0;
        q.order = () => { n += 1; return n >= 2 ? Promise.resolve({ data, error }) : q; };
        return q;
      },
    });
    const rows = await fetchTaxStandings(reading([
      { id: 'a', status: 'registered', registration: ' GB1 ', from_on: '2026-04-06', to_on: null, note: null },
    ]) as any, 't1');
    eq(rows[0].registration, 'GB1', 'the number is trimmed, and an all-space one becomes null');
    const why = await threw(fetchTaxStandings(reading(null, { message: 'refused' }) as any, 't1'));
    ok(why != null, 'a refused read THROWS — an empty list is a real answer here and the two must not look alike');
  }

  if (errors.length) {
    console.error(`gymTaxHistory.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('gymTaxHistory.test.ts — ok');
})();
