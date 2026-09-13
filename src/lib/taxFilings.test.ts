// What a gym says it has filed, and the three answers a period gets.
// Compile with tsc, run with node.
//
// Five rules, and the first is the whole reason the module exists:
//
//   · NOTHING HERE SAYS "NOT FILED". A period with no row against it is one
//     NOBODY HAS ANSWERED FOR. Every gym running this is in that state for
//     every period it has ever traded, and telling a compliant business it is
//     in default — over a return its accountant filed in a portal Repple cannot
//     see — is the one sentence this must never produce.
//   · a read that did not come back whole is not "nothing has been filed"
//     either, and 'partial' is refused with the failures: a dropped filing
//     reads exactly like a period nobody answered for.
//   · two rows about one period is ORDINARY. Two kinds, or an amendment — and
//     an amendment does not undo the first submission, which really was made
//     and really was received.
//   · a period covered in part is reported as covered in part, with the
//     uncovered days NAMED. A gym filing monthly that has recorded two of a
//     quarter's three months has neither answered for it nor failed to.
//   · dates are bare days compared as strings. Every comparison here is a
//     period boundary, which is the one place a day out is a wrong answer.
import {
  FILING_KINDS, FILING_KIND_LABEL, FILINGS_ARE_YOUR_OWN_RECORD,
  MAX_REFERENCE_CHARS, MAX_FILED_BY_CHARS,
  isFilingKind, covers, filingsFor, kindsInUse, filingBlockers,
  recordFiling, deleteFiling,
  type TaxFiling, type FilingDraft,
} from './taxFilings';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const filing = (over: Partial<TaxFiling> = {}): TaxFiling => ({
  id: 'f1', kind: 'sales_tax', periodFrom: '2026-07-01', periodTo: '2026-09-30',
  filedOn: '2026-10-12', reference: null, filedBy: null, note: null, ...over,
});

const draft = (over: Partial<FilingDraft> = {}): FilingDraft => ({
  kind: 'sales_tax', periodFrom: '2026-07-01', periodTo: '2026-09-30', filedOn: '2026-10-12', ...over,
});

/** Q3 2026, as `taxPeriod` builds it. */
const Q3 = { from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026' };

/* ── the five kinds belong to no jurisdiction ──────────────────────────────── */

eq(FILING_KINDS.length, 5, 'exactly the five the CHECK in supabase/parts/2910 permits');
for (const k of FILING_KINDS) {
  ok(!!FILING_KIND_LABEL[k], `${k} needs the sentence it is shown under, or it renders as its own raw code`);
  ok(isFilingKind(k), `${k} is a kind`);
}
ok(!isFilingKind('vat') && !isFilingKind(null) && !isFilingKind('') && !isFilingKind('SALES_TAX'),
  'and nothing else is — an unrecognised stored kind is reported as unrecognised, never relabelled');

// White-label. This product sells into countries whose returns share no name,
// and a label naming one of them is wrong everywhere else — the same assumption
// src/lib/wholeUnits.ts exists to stop being made about minor units.
for (const k of FILING_KINDS) {
  const label = FILING_KIND_LABEL[k];
  ok(!/\bVAT\b|\bGST\b|\bHMRC\b|\bIRS\b|Companies House|Corporation Tax|1120|Self Assessment/i.test(label),
    `${k}'s label must not name one jurisdiction's return: "${label}"`);
}

/* ── absence is unstated, never "not filed" ────────────────────────────────── */

{
  const s = filingsFor([], 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label);
  eq(s.state, 'unstated', 'a whole read with nothing covering the period is UNSTATED');
  ok(/Nobody has recorded/.test(s.line), 'and the sentence is about the record');
  ok(!/not filed|failed to file|has not been filed|in default/i.test(s.line),
    `and never about the business: "${s.line}"`);
  ok(/not about whether it was filed/i.test(s.line),
    'it says outright that this is not a statement about whether the gym filed');
}

// The whole module, swept: nothing any state can produce may claim the gym did
// not file. This is cheap to assert and is the exact failure the part header
// says every gym would otherwise be shown for every period it has traded.
{
  const lines = [
    filingsFor([], 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label).line,
    filingsFor([], 'sales_tax', Q3.from, Q3.to, 'error', Q3.label).line,
    filingsFor([], 'sales_tax', Q3.from, Q3.to, 'partial', Q3.label).line,
    filingsFor([], 'sales_tax', Q3.from, Q3.to, 'loading', Q3.label).line,
    filingsFor([filing({ periodTo: '2026-08-31' })], 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label).line,
    filingsFor([filing()], 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label).line,
  ];
  for (const l of lines) {
    ok(!/\bfailed to file\b|\bhas not been filed\b|\bwas not filed\b|\bin default\b/i.test(l),
      `no sentence this module builds may say the gym did not file: "${l}"`);
  }
  // FILINGS_ARE_YOUR_OWN_RECORD is deliberately NOT in that sweep. It is the
  // only string here allowed to contain the phrase, because it contains it in
  // the negative — "it is not a period this gym failed to file for" — which is
  // the disclaimer every other line is being held to. A sweep that could not
  // tell the claim from its denial would have forced the one sentence that says
  // the right thing out loud to say it in weaker words.
  ok(/not a period this gym failed to file for/i.test(FILINGS_ARE_YOUR_OWN_RECORD),
    'and the standing note denies it in as many words');
}

ok(/NOBODY HAS ANSWERED FOR/.test(FILINGS_ARE_YOUR_OWN_RECORD),
  'the standing note says what an empty period means');
ok(/Nothing tells Repple when a gym files/.test(FILINGS_ARE_YOUR_OWN_RECORD),
  'and that this product is not watching — otherwise a silence reads as a reassurance');
ok(/no deadline, penalty or amount/i.test(FILINGS_ARE_YOUR_OWN_RECORD),
  'and that nothing is computed, which is TAX_NO_RETURN_FIGURE applied to a date');

/* ── an unread list is not an empty one ────────────────────────────────────── */

for (const st of ['loading', 'error', 'partial'] as const) {
  const s = filingsFor([filing()], 'sales_tax', Q3.from, Q3.to, st, Q3.label);
  eq(s.state, 'unread', `under '${st}' nothing may be said about the period`);
  ok(!/Nobody has recorded/.test(s.line), `and the sentence under '${st}' is about the READ, not about the record`);
}
ok(/not the same as nothing having been filed/i.test(
  filingsFor([], 'sales_tax', Q3.from, Q3.to, 'error', Q3.label).line),
  'a failed read says so in as many words');
ok(/not all of it/i.test(filingsFor([], 'sales_tax', Q3.from, Q3.to, 'partial', Q3.label).line),
  "'partial' says the set is a prefix — a dropped filing reads exactly like a period nobody answered for");

/* ── covered, and covered in part ──────────────────────────────────────────── */

{
  const s = filingsFor([filing()], 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label);
  eq(s.state, 'filed', 'one filing spanning the whole quarter covers it');
  ok(/filed on 2026-10-12/.test(s.line), 'and the line says when');
}
{
  // A gym filing monthly. Three months, three filings, and the quarter is
  // covered by the union of them.
  const monthly = [
    filing({ id: 'a', periodFrom: '2026-07-01', periodTo: '2026-07-31', filedOn: '2026-08-07' }),
    filing({ id: 'b', periodFrom: '2026-08-01', periodTo: '2026-08-31', filedOn: '2026-09-07' }),
    filing({ id: 'c', periodFrom: '2026-09-01', periodTo: '2026-09-30', filedOn: '2026-10-07' }),
  ];
  eq(filingsFor(monthly, 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label).state, 'filed',
    'three adjacent months cover the quarter — 31 July and 1 August are adjacent, not a gap');
}
{
  const two = [
    filing({ id: 'a', periodFrom: '2026-07-01', periodTo: '2026-07-31', filedOn: '2026-08-07' }),
    filing({ id: 'b', periodFrom: '2026-08-01', periodTo: '2026-08-31', filedOn: '2026-09-07' }),
  ];
  const s = filingsFor(two, 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label);
  eq(s.state, 'partly', 'two of the three months is neither answered nor unanswered');
  if (s.state === 'partly') {
    eq(s.from, '2026-09-01', 'and the first uncovered day is named');
    eq(s.to, '2026-09-30', 'as is the last');
  }
  ok(!/not filed/i.test(s.line), 'and the missing part is still not called unfiled');
}
{
  // A gap at the START of the period, which the walk has to catch as readily as
  // one at the end.
  const late = [filing({ periodFrom: '2026-08-01', periodTo: '2026-09-30' })];
  const s = filingsFor(late, 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label);
  eq(s.state, 'partly', 'a filing starting a month into the period leaves the first month uncovered');
  if (s.state === 'partly') eq(s.from, '2026-07-01', 'and it is named from the period’s own first day');
}
{
  // A financial year that is not one of this app's quarters — the case the
  // part refused a `period_key` column for.
  const fy = [filing({ kind: 'accounts', periodFrom: '2026-04-01', periodTo: '2027-03-31', filedOn: '2027-09-01' })];
  eq(filingsFor(fy, 'accounts', '2026-10-01', '2026-12-31', 'ready', 'Q4 2026').state, 'filed',
    'a 1 April to 31 March year covers Q4, which no period key could have expressed');
}

/* ── two rows about one period ─────────────────────────────────────────────── */

{
  // Two KINDS. A sales return does not answer for a payroll return.
  const both = [filing({ id: 'a' }), filing({ id: 'b', kind: 'payroll', filedOn: '2026-10-19' })];
  eq(filingsFor(both, 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label).state, 'filed', 'the sales return is there');
  eq(filingsFor(both, 'income_tax', Q3.from, Q3.to, 'ready', Q3.label).state, 'unstated',
    'and nothing has been recorded about a return on profits — the other two do not answer for it');
}
{
  // An AMENDMENT. Both stand, and the later one does not undo the earlier.
  const amended = [filing({ id: 'a', filedOn: '2026-10-12' }), filing({ id: 'b', filedOn: '2026-11-14' })];
  const s = filingsFor(amended, 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label);
  eq(s.state, 'filed', 'still covered');
  ok(/2026-10-12/.test(s.line) && /2026-11-14/.test(s.line), 'and both days are said');
  ok(/does not undo an earlier one/.test(s.line),
    'with the reason: the first submission really was made and really was received');
  if (s.state === 'filed') eq(s.filings.length, 2, 'and both rows are handed over');
}
{
  const s = filingsFor([filing({ reference: 'SUB-99123', filedBy: 'Harper & Co' })], 'sales_tax', Q3.from, Q3.to, 'ready', Q3.label);
  ok(/Harper & Co/.test(s.line) && /SUB-99123/.test(s.line),
    'the reference and who filed it are on the line — they are what somebody needs to find the submission again');
}

/* ── which kinds this gym actually files ───────────────────────────────────── */

eq(kindsInUse([filing(), filing({ id: 'b', kind: 'accounts' })], 'ready')?.join(','), 'sales_tax,accounts',
  'the kinds it has used, in the declared order');
eq(kindsInUse([], 'ready')?.length, 0, 'a gym that has recorded nothing has used none');
for (const st of ['loading', 'error', 'partial'] as const) {
  eq(kindsInUse([filing()], st), null,
    `under '${st}' "this gym files these kinds" is itself a claim, and there is no answer`);
}

eq(covers(filing(), '2026-09-30'), true, 'the last day is inside — the span is inclusive at both ends');
eq(covers(filing(), '2026-10-01'), false, 'and the day after is not');
eq(covers(filing(), '2026-06-30'), false, 'nor the day before it starts');

/* ── what will not be recorded ─────────────────────────────────────────────── */

eq(filingBlockers(draft(), '2026-10-20').length, 0, 'the ordinary case is allowed through');
eq(filingBlockers(draft({ filedOn: '2026-10-20' }), '2026-10-20').length, 0, 'filed today is not in the future');

ok(filingBlockers(draft({ filedOn: '2026-10-21' }), '2026-10-20')
  .some((b) => /has not happened yet/.test(b)),
  'a filing dated tomorrow is refused here — `current_date` is not IMMUTABLE, so the database cannot');
ok(filingBlockers(draft({ filedOn: '2025-10-12' }), '2026-10-20')
  .some((b) => /before the period it covers/.test(b)),
  'and one dated before its own period began is a mistyped year, said as one');
ok(filingBlockers(draft({ periodTo: '2026-06-30' }), '2026-10-20')
  .some((b) => /ends before it starts/.test(b)),
  'a period that ends before it starts is refused');
ok(filingBlockers(draft({ periodFrom: '2026-02-31' }), '2026-10-20').length > 0,
  '2026-02-31 passes a regex, is not a date, and `new Date` rolls it into March without saying so');
ok(filingBlockers(draft({ kind: 'vat' as any }), '2026-10-20')
  .some((b) => /Something else/.test(b)),
  'an unknown kind is refused and the escape hatch is named, so nobody invents a sixth');
ok(filingBlockers(draft({ reference: 'x'.repeat(MAX_REFERENCE_CHARS + 1) }), '2026-10-20')
  .some((b) => /still a filing/.test(b)),
  'a reference past the ceiling is refused, and the refusal says a filing without one is still a filing');
ok(filingBlockers(draft({ filedBy: 'x'.repeat(MAX_FILED_BY_CHARS + 1) }), '2026-10-20').length > 0,
  'and so is an over-long name for who filed it');
// Every reason at once, not the first — somebody with three fields wrong is not
// corrected three times.
ok(filingBlockers(draft({ filedOn: '2027-01-01', periodTo: '2026-06-30' }), '2026-10-20').length >= 2,
  'all the reasons come back together');

/* ── the writes ────────────────────────────────────────────────────────────── */

const threw = async (p: Promise<unknown>): Promise<string | null> => {
  try { await p; return null; } catch (e: any) { return String(e?.message ?? e); }
};

function insertDb(opts: { error?: unknown; data?: unknown; captured?: any[] }) {
  return {
    from: (_t: string) => ({
      insert: (payload: any) => {
        opts.captured?.push(payload);
        return {
          select: () => ({
            single: () => Promise.resolve({
              error: opts.error ?? null,
              data: opts.data === undefined
                ? {
                  id: 'f-new', kind: payload.kind, period_from: payload.period_from,
                  period_to: payload.period_to, filed_on: payload.filed_on,
                  reference: payload.reference, filed_by: payload.filed_by, note: payload.note,
                }
                : opts.data,
            }),
          }),
        };
      },
    }),
  };
}

function deleteDb(opts: { error?: unknown; count?: number | null }) {
  return {
    from: (_t: string) => ({
      delete: (_o?: unknown) => ({
        eq: () => Promise.resolve({ error: opts.error ?? null, count: opts.count === undefined ? 1 : opts.count, data: null }),
      }),
    }),
  };
}

void (async () => {
  {
    const captured: any[] = [];
    const row = await recordFiling(insertDb({ captured }) as any, 't-1', {
      ...draft(), reference: '  SUB-99123  ', filedBy: '  Harper & Co  ', createdBy: 'owner-1',
    });
    eq(captured.length, 1, 'one insert');
    eq(captured[0].reference, 'SUB-99123', 'the reference, trimmed and held verbatim');
    eq(captured[0].filed_by, 'Harper & Co', 'and who filed it');
    eq(captured[0].period_to, '2026-09-30', 'the last day it covers, inclusive');
    eq(row.filedOn, '2026-10-12', 'and the row comes back');
    // Nothing about registration, month closes or a deadline goes anywhere near
    // this write. Filing a return is not closing a month and implies no
    // registration.
    ok(!('tax_registered' in captured[0]) && !('due_on' in captured[0]) && !('closed_at' in captured[0]),
      'and nothing else in the schema is touched by recording a filing');
  }
  {
    const captured: any[] = [];
    await recordFiling(insertDb({ captured }) as any, 't-1', draft());
    eq(captured[0].reference, null, 'an absent reference is null and never an empty string — the CHECK refuses a blank');
    eq(captured[0].filed_by, null, 'and so is an absent filer');
  }
  {
    const why = await threw(recordFiling(
      insertDb({ data: { id: 'f-new', kind: 'sales_tax', period_from: '2026-07-01', period_to: '2026-09-30', filed_on: '2026-10-13' } }) as any,
      't-1', draft(),
    ));
    ok(why != null && /did not come back matching/.test(why),
      'a row that landed with a different day is reported rather than reported as done');
    ok(why != null && /recorded twice/.test(why),
      'and the message names the risk of trying again blind');
  }
  {
    ok(await threw(recordFiling(insertDb({ data: null }) as any, 't-1', draft())) != null,
      'an insert that returned no row is not a success');
    ok(await threw(recordFiling(insertDb({ error: { message: 'refused' } }) as any, 't-1', draft())) != null,
      'a database error is thrown rather than swallowed — supabase-js RESOLVES on one');
  }
  {
    eq(await threw(deleteFiling(deleteDb({}) as any, 'f-1')), null, 'removing a filing recorded in error goes through');
    // The defect wroteRows.ts exists for. The delete policy is
    // `is_owner_of(tenant_id)`, so a delete by anybody else matches zero rows
    // and comes back with no error — and a period would go on reading as
    // answered for by something that never happened.
    ok(await threw(deleteFiling(deleteDb({ count: 0 }) as any, 'f-1')) != null,
      'a delete that matched no row is not a success');
    ok(await threw(deleteFiling(deleteDb({ error: { message: 'refused' } }) as any, 'f-1')) != null,
      'and a refused one is thrown');
  }

  if (errors.length) {
    console.error(`taxFilings.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('taxFilings.test.ts — ok');
})();
