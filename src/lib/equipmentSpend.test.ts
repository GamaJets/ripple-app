// What a machine has cost — the register and the books, joined without being
// added together. Compile with tsc, run with node.
//
// Five rules, and the first is the one the whole module exists for:
//
//   · THE TWO FIGURES ARE NEVER ADDED. `gym_equipment_log.cost_cents` and the
//     linked `gym_costs.amount_cents` are two claims about the same repair, and
//     summing them gives exactly twice what the gym spent. The spend comes out
//     of the books alone.
//   · one invoice covering three machines is ONE cost. Deduplicated by cost id,
//     because part 2850 put the column on the log side precisely so that three
//     entries can point at one cost.
//   · a disagreement is REPORTED, never resolved. One invoice over three
//     machines, a call-out fee and the parts entered separately, a quote rather
//     than a bill — all ordinary, none of them a reason to overwrite one figure
//     from the other.
//   · two currencies about one repair is refused and both are named. That is
//     the house rule, and it is not a rounding difference.
//   · a read that did not come back whole is not "none of this is in the
//     books". That sentence sends an owner to re-type a fortnight of costs they
//     already have, after which their P&L really is wrong.
import {
  machineSpend, offBooksNote, offBooksFirst, linkBlocker,
  linkLogToCost, unlinkLogFromCost,
  SPEND_COMES_FROM_THE_BOOKS_NOTE, SPEND_IS_NOT_RECONCILED_NOTE,
  type SpendEntry,
} from './equipmentSpend';
import type { GymCost } from './gymCosts';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const entry = (over: Partial<SpendEntry> = {}): SpendEntry => ({
  id: 'e1', equipmentId: 'm1', equipmentLabel: 'Rower 3', kind: 'service',
  happenedOn: '2026-09-01', costCents: 12000, currency: 'GBP', costId: null, ...over,
});

const cost = (over: Partial<GymCost> = {}): GymCost => ({
  id: 'c1', description: 'Rower service', supplier: 'Precor UK', category: 'maintenance',
  amountCents: 12000, currency: 'GBP', paidOn: '2026-09-02', note: null, createdAt: null, ...over,
});

const byId = (...cs: GymCost[]) => new Map(cs.map((c) => [c.id, c]));

/* ── the money comes out of the books, once ────────────────────────────────── */

{
  const s = machineSpend([entry({ costId: 'c1' })], byId(cost()), 'ready');
  eq(s.state, 'known', 'a whole read of both halves is an answer');
  if (s.state === 'known') {
    eq(s.taken.pots.length, 1, 'one currency, one pot');
    // 12000 and not 24000. This is the whole module.
    eq(s.taken.pots[0].minorUnits, 12000,
      'the cost is counted ONCE — the log figure beside it is the same money, not more of it');
    eq(s.costs, 1, 'one cost row behind it');
    eq(s.offBooks.length, 0, 'nothing is missing from the books');
    eq(s.disagrees.length, 0, 'and the two records agree');
  }
}

{
  // One engineer's invoice, three machines serviced in one visit. Three log
  // entries, one cost — which is the case part 2850 put the column on the log
  // side to make possible, and the case a naive sum trebles.
  const s = machineSpend(
    [entry({ id: 'e1', costId: 'c1' }), entry({ id: 'e2', costId: 'c1' }), entry({ id: 'e3', costId: 'c1' })],
    byId(cost({ amountCents: 30000 })),
    'ready',
  );
  if (s.state === 'known') {
    eq(s.taken.pots[0].minorUnits, 30000, 'one invoice counts once however many entries point at it');
    eq(s.costs, 1, 'and it is one cost, not three');
  } else { ok(false, 'three entries on one cost should still be an answer'); }
}

{
  // Two costs, two currencies. Never one figure.
  const s = machineSpend(
    [entry({ id: 'e1', costId: 'c1' }), entry({ id: 'e2', costId: 'c2', currency: 'EUR', costCents: 5000 })],
    byId(cost(), cost({ id: 'c2', amountCents: 5000, currency: 'EUR' })),
    'ready',
  );
  if (s.state === 'known') {
    eq(s.taken.pots.length, 2, 'a British engineer and a German one are two amounts of money and not a sum');
    eq(s.disagrees.length, 0, 'and neither entry disagrees with its own cost');
  } else { ok(false, 'two currencies is an answer, in two pots'); }
}

{
  // A cost with no currency on it is a hole in the total and the size of the
  // hole is what is worth reporting. Never folded into the neighbour.
  const s = machineSpend([entry({ costId: 'c1' })], byId(cost({ currency: null })), 'ready');
  if (s.state === 'known') {
    eq(s.taken.unlabelled, 1, 'an amount with no unit on it is counted out, not added in');
    eq(s.taken.pots.length, 0, 'and there is no pot to print');
  } else { ok(false, 'an unlabelled cost is still an answer'); }
}

/* ── what the books do not know about ──────────────────────────────────────── */

{
  const s = machineSpend(
    [entry({ id: 'e1', costId: 'c1' }), entry({ id: 'e2', costCents: 4500 }), entry({ id: 'e3', costCents: null })],
    byId(cost()),
    'ready',
  );
  if (s.state === 'known') {
    eq(s.taken.pots[0].minorUnits, 12000, 'the off-books figure is NOT added to the books figure');
    eq(s.offBooks.length, 1, 'the entry with a figure and no cost is named');
    eq(s.offBooks[0].id, 'e2', 'and it is that one');
    // A warranty service or a clean that cost nothing is not missing from the
    // accounts, and listing it would bury the ones that are.
    ok(!s.offBooks.some((e) => e.id === 'e3'), 'an entry with no figure at all is not "missing from the books"');
  } else { ok(false, 'an off-books entry does not prevent an answer'); }
}

eq(offBooksNote(0), null, 'nothing to say when everything is in the books');
ok((offBooksNote(1) ?? '').includes('One maintenance record'), 'one is singular');
ok(/P&L|P&amp;L/.test(offBooksNote(2) ?? ''), 'and the sentence names what is actually wrong: the gym’s own P&L');
// No figure in the sentence. The amounts are on the log in whatever currency
// somebody typed, and a total here would be a maintenance spend figure computed
// from the record that is NOT the money record.
ok(!/\d[\d,.]*\.\d\d/.test(offBooksNote(3) ?? ''), 'and it carries no money figure of its own');

eq(offBooksFirst([entry({ id: 'a', happenedOn: '2026-01-01' }), entry({ id: 'b', happenedOn: '2026-09-01' })])[0].id, 'b',
  'newest first — that is the order somebody works down when catching the books up');

/* ── disagreements are reported, not resolved ──────────────────────────────── */

{
  const s = machineSpend([entry({ costId: 'c1', costCents: 12000 })], byId(cost({ amountCents: 30000 })), 'ready');
  if (s.state === 'known') {
    eq(s.disagrees.length, 1, 'the log said 120.00 and the books said 300.00');
    eq(s.disagrees[0].kind, 'amount', 'which is an amount disagreement');
    // And the BOOKS figure is what counts, unchanged. Neither is corrected from
    // the other: one invoice over three machines makes this the ordinary case.
    eq(s.taken.pots[0].minorUnits, 30000, 'the books are what the spend is made of, and the log did not alter it');
  } else { ok(false, 'a disagreement does not prevent an answer'); }
}

{
  const s = machineSpend([entry({ costId: 'c1', currency: 'EUR' })], byId(cost({ currency: 'GBP' })), 'ready');
  if (s.state === 'known') {
    eq(s.disagrees[0]?.kind, 'currency',
      'two currencies about one repair is its own kind — not a rounding difference, and a screen must name both');
  } else { ok(false, 'a currency disagreement does not prevent an answer'); }
}

{
  // The log has no figure on it: the gym put the money straight in the books
  // and recorded only the work, which is the RIGHT way round. Nothing to
  // disagree about.
  const s = machineSpend([entry({ costId: 'c1', costCents: null })], byId(cost()), 'ready');
  if (s.state === 'known') {
    eq(s.disagrees.length, 0, 'an entry with no figure cannot disagree with one');
    eq(s.taken.pots[0].minorUnits, 12000, 'and the cost still counts');
  } else { ok(false, 'an entry with no figure is still an answer'); }
}

{
  const s = machineSpend([entry({ costId: 'gone' })], byId(cost()), 'ready');
  if (s.state === 'known') {
    eq(s.dangling, 1, 'a link to a cost that is not here is reported rather than silently dropped');
    eq(s.costs, 0, 'and counts towards nothing');
  } else { ok(false, 'a dangling link does not prevent an answer'); }
}

/* ── an unread read is not an empty one ────────────────────────────────────── */

for (const st of ['loading', 'error', 'partial'] as const) {
  const s = machineSpend([entry({ costId: 'c1' })], byId(cost()), st);
  eq(s.state, 'unread', `under '${st}' nothing about this machine's spend may be stated`);
  ok('why' in s && !/nothing|none/i.test(s.why.split('.')[0]),
    `and the sentence under '${st}' does not open by saying it cost nothing`);
}
ok((machineSpend([], byId(), 'error') as any).why.includes('not the same as it having cost nothing'),
  'a failed read says so in as many words — the alternative sends an owner to re-type costs they already have');
ok((machineSpend([], byId(), 'partial') as any).why.includes('not all of it'),
  "'partial' says the set is a prefix");
// Rows in hand and no costs read is still unread. The costs ARE the answer.
eq(machineSpend([entry({ costId: 'c1' })], null, 'ready').state, 'unread',
  'no costs read is no answer, however many links came back');

eq(machineSpend([], byId(), 'ready').state, 'known',
  'a machine with no maintenance records at all is a real, whole answer');

/* ── the two notes a screen prints ─────────────────────────────────────────── */

ok(/never added together|never.*added/i.test(SPEND_COMES_FROM_THE_BOOKS_NOTE),
  'the note says outright that the two records are not added together');
ok(/books/i.test(SPEND_COMES_FROM_THE_BOOKS_NOTE), 'and that the figure comes from the books');
ok(/one engineer’s invoice can cover three machines/i.test(SPEND_IS_NOT_RECONCILED_NOTE),
  'and the other note gives the reason the two legitimately differ, rather than implying an error');

/* ── linking ───────────────────────────────────────────────────────────────── */

eq(linkBlocker(entry(), cost()), null, 'the ordinary case is allowed through');
eq(linkBlocker(entry({ costCents: 12000 }), cost({ amountCents: 30000 })), null,
  'a cost larger than the log figure is the commonest real case — one invoice, three machines — and is NOT refused');
eq(linkBlocker(entry({ costId: 'c1' }), cost({ id: 'c1' })), null,
  're-linking an entry to the cost it already names is a no-op, not an error');
ok((linkBlocker(entry({ costId: 'c9' }), cost({ id: 'c1' })) ?? '').includes('already linked'),
  'an entry pointing at two costs would count one repair twice');
ok((linkBlocker(entry(), null) ?? '').includes('costs screen'),
  'with no cost chosen the answer names where a cost is actually created — linking cannot mint one');
{
  const why = linkBlocker(entry({ currency: 'EUR' }), cost({ currency: 'GBP' })) ?? '';
  ok(why.includes('EUR') && why.includes('GBP'),
    'two currencies is refused and BOTH are named — that is the house rule, not a preference');
}
eq(linkBlocker(entry({ currency: null }), cost({ currency: 'GBP' })), null,
  'a log entry that never said a currency does not contradict one that did');

/* ── the writes ────────────────────────────────────────────────────────────── */

const threw = async (p: Promise<unknown>): Promise<string | null> => {
  try { await p; return null; } catch (e: any) { return String(e?.message ?? e); }
};

function db(opts: { error?: unknown; count?: number | null; data?: unknown; captured?: any[] }) {
  return {
    from: (_t: string) => ({
      update: (payload: any, _o?: unknown) => {
        opts.captured?.push(payload);
        const settled = {
          error: opts.error ?? null,
          count: opts.count === undefined ? 1 : opts.count,
          data: opts.data === undefined ? [{ id: 'e1', cost_id: payload.cost_id }] : opts.data,
        };
        const eqStep = () => Object.assign(Promise.resolve(settled), { select: () => Promise.resolve(settled) });
        return { eq: eqStep };
      },
    }),
  };
}

void (async () => {
  {
    const captured: any[] = [];
    eq(await threw(linkLogToCost(db({ captured }) as any, 'e1', 'c1')), null, 'the ordinary link goes through');
    eq(captured.length, 1, 'one column on one row');
    eq(captured[0].cost_id, 'c1', 'and it is the link');
    // Neither amount is copied. Overwriting one figure from the other would
    // destroy the disagreement this module is built to report.
    ok(!('cost_cents' in captured[0]) && !('amount_cents' in captured[0]) && !('currency' in captured[0]),
      'no figure is copied either way — the two claims stay two claims');
  }
  {
    // The defect wroteRows.ts exists for. A trainer has no UPDATE on this table
    // at all, so their attempt matches zero rows and returns no error — and the
    // screen would say the repair is in the books while the P&L still is not.
    ok(await threw(linkLogToCost(db({ count: 0, data: [] }) as any, 'e1', 'c1')) != null,
      'an update that matched no row is not a success');
    ok(await threw(linkLogToCost(db({ data: [{ id: 'e1', cost_id: null }] }) as any, 'e1', 'c1')) != null,
      'and a row that came back without the cost on it is reported rather than reported as done');
    ok(await threw(linkLogToCost(db({ error: { message: 'refused' } }) as any, 'e1', 'c1')) != null,
      'a database error is thrown rather than swallowed — supabase-js RESOLVES on one');
  }
  {
    const captured: any[] = [];
    eq(await threw(unlinkLogFromCost(db({ captured }) as any, 'e1')), null, 'unlinking goes through');
    eq(captured[0].cost_id, null, 'and it clears exactly the one column');
    ok(await threw(unlinkLogFromCost(db({ count: 0 }) as any, 'e1')) != null,
      'an unlink that matched no row is not a success either');
  }

  if (errors.length) {
    console.error(`equipmentSpend.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('equipmentSpend.test.ts — ok');
})();
