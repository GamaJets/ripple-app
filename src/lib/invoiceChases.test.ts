// Chasing an overdue invoice from the console, as a record of an act.
// Compile with tsc, run with node.
//
// Five rules, and the first of them is the one the whole feature turns on:
//
//   · NOTHING HERE SENDS ANYTHING. No sentence this module can produce says
//     Repple contacted anybody, and the six labels are the six things a screen
//     renders — so they are the cheapest place for "Email sent" to appear by
//     accident, and the place this file watches hardest.
//   · a read that did not come back whole is not "nobody chased this". Absence
//     is the answer this feature is built out of, which makes it exactly the
//     shape src/ui/loadStatus.ts exists to stop a screen getting wrong: the
//     false sentence gets a member rung twice, or a debt written off as
//     unpursued when it was pursued four times.
//   · 'partial' is refused with the failures, not admitted with the successes.
//     A truncated chase log drops the OLDEST rows, so the count beside an
//     invoice would be short by an unknown number of real chases.
//   · a chase cannot be dated into the future or before the invoice existed,
//     and NEITHER rule can live in the database — `current_date` is not
//     IMMUTABLE and `issued_on` is on another table. This file is what holds
//     supabase/parts/2820 to the half it can enforce.
//   · dates are bare days compared as strings. A parse moves the boundary a day
//     for most of the world's readers, on the two comparisons above.
import {
  CHASE_VIA, CHASE_VIA_LABEL, CHASE_IS_A_RECORD_NOT_A_SEND, MAX_CHASE_NOTE_CHARS,
  isChaseVia, chaseBlocker, byInvoice, chaseState, lastChaseLine, daysSince,
  unchased, stalestChase, recordChase, deleteChase,
  type InvoiceChase, type ChaseDraft,
} from './invoiceChases';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** The sentence out of a state, or an empty string where there is none. The
 *  'never' arm has no line by construction, which is the point of the union. */
const line = (s: ReturnType<typeof chaseState>): string => ('line' in s ? s.line : '');

const chase = (over: Partial<InvoiceChase> = {}): InvoiceChase => ({
  id: 'c1', invoiceId: 'inv-1', chasedOn: '2026-09-01', via: 'email',
  note: null, createdAt: null, createdBy: null, createdByName: null, ...over,
});

const draft = (over: Partial<ChaseDraft> = {}): ChaseDraft => ({
  invoiceId: 'inv-1', chasedOn: '2026-09-10', via: 'email', ...over,
});

/* ── a record, never a send ────────────────────────────────────────────────── */

eq(CHASE_VIA.length, 6, 'exactly the six the CHECK in supabase/parts/2820 permits');
for (const v of CHASE_VIA) {
  ok(!!CHASE_VIA_LABEL[v], `${v} needs the words it is shown under, or it renders as its own raw code beside a debt`);
  ok(isChaseVia(v), `${v} is a way of asking`);
}
ok(!isChaseVia('carrier_pigeon') && !isChaseVia(null) && !isChaseVia('') && !isChaseVia('EMAIL'),
  'and nothing else is — a stored value this build does not know is reported as unrecorded, never relabelled');

// The one thing this feature must not claim. Every label is an act the GYM
// performed; none of them is a delivery this product made. "Email sent" and
// "Repple emailed" are the two spellings of the failure.
for (const v of CHASE_VIA) {
  const label = CHASE_VIA_LABEL[v];
  ok(!/repple/i.test(label), `${v}'s label must not name this product — it did not send anything`);
  ok(!/\bsent\b|\bdelivered\b|\breceived\b/i.test(label),
    `${v}'s label must not assert delivery: "${label}" would be claiming something arrived`);
}
ok(/sends nothing/i.test(CHASE_IS_A_RECORD_NOT_A_SEND),
  'the note above the form says outright that recording a chase sends nothing');
ok(/does not email/i.test(CHASE_IS_A_RECORD_NOT_A_SEND),
  'and names the thing an owner would otherwise assume happened');
ok(/not shown it|member is not/i.test(CHASE_IS_A_RECORD_NOT_A_SEND),
  'and says the member does not see it — they can already read the invoice, which is why this needs saying');

/* ── what will not be recorded ─────────────────────────────────────────────── */

eq(chaseBlocker(draft(), '2026-09-13', '2026-09-01'), null, 'the ordinary case is allowed through');
eq(chaseBlocker(draft({ chasedOn: '2026-09-13' }), '2026-09-13', '2026-09-01'), null,
  'a chase made today is not in the future');
eq(chaseBlocker(draft({ chasedOn: '2026-09-01' }), '2026-09-13', '2026-09-01'), null,
  'and one made the day the invoice was issued is not before it');

ok((chaseBlocker(draft({ chasedOn: '2026-09-14' }), '2026-09-13', '2026-09-01') ?? '').includes('has not happened yet'),
  'a chase dated tomorrow is refused — `current_date` is not IMMUTABLE, so the database cannot refuse it');
ok((chaseBlocker(draft({ chasedOn: '2026-08-30' }), '2026-09-13', '2026-09-01') ?? '').includes('2026-09-01'),
  'a chase dated before the invoice existed is refused, NAMING the issue date — a CHECK cannot reach another table');
ok((chaseBlocker(draft({ via: 'shouted' as any }), '2026-09-13', '2026-09-01') ?? '').includes('Some other way'),
  'an unknown means is refused and the escape hatch is named, so nobody invents a seventh value');
ok(chaseBlocker(draft({ chasedOn: '2026-02-31' }), '2026-09-13', '2026-09-01') != null,
  '2026-02-31 passes a regex, is not a date, and `new Date` rolls it into March without saying so');
ok(chaseBlocker(draft({ chasedOn: '10/09/2026' }), '2026-09-13', '2026-09-01') != null,
  'and a day typed the way half the world writes it is refused rather than guessed at');
ok(chaseBlocker(draft({ invoiceId: '' }), '2026-09-13', '2026-09-01') != null,
  'a chase against no invoice is a note with nowhere to live');
ok(chaseBlocker(draft({ note: 'x'.repeat(MAX_CHASE_NOTE_CHARS + 1) }), '2026-09-13', '2026-09-01') != null,
  'past the CHECK ceiling is refused beside the box rather than as a 23514 after the form closed');
eq(chaseBlocker(draft({ note: '' }), '2026-09-13', '2026-09-01'), null,
  'and an empty note is fine: "rang, no answer" is a complete chase, and a box that must be filled gets "n/a"');

// The invoice's issue date is not always readable. A chase must still be
// recordable then — refusing every chase because one column did not come back
// would take the feature away over a fact nobody needs to record an act.
eq(chaseBlocker(draft({ chasedOn: '2026-01-01' }), '2026-09-13', null), null,
  'with no issue date to compare against, the only rule left is the one about the future');
ok(chaseBlocker(draft({ chasedOn: '2027-01-01' }), '2026-09-13', null) != null,
  'and that one still holds');

/* ── grouping, newest first ────────────────────────────────────────────────── */

{
  const rows = [
    chase({ id: 'a', invoiceId: 'inv-1', chasedOn: '2026-09-01' }),
    chase({ id: 'b', invoiceId: 'inv-2', chasedOn: '2026-08-02' }),
    chase({ id: 'c', invoiceId: 'inv-1', chasedOn: '2026-09-11' }),
    chase({ id: 'd', invoiceId: 'inv-1', chasedOn: '2026-09-11', via: 'phone' }),
  ];
  const by = byInvoice(rows);
  eq(by.get('inv-1')?.length, 3, 'three acts against one invoice');
  eq(by.get('inv-1')?.[0].chasedOn, '2026-09-11', 'newest first — that is the one a screen puts beside the row');
  eq(by.get('inv-2')?.length, 1, 'and the other invoice keeps its own');
  eq(by.get('inv-3'), undefined, 'an invoice nobody chased has no entry, and the caller must not read that as a fact on its own');
  // Two chases on one day is ordinary — emailed, then rang. The tie must not
  // flap between renders.
  const first = byInvoice(rows).get('inv-1')!.map((c) => c.id).join(',');
  const again = byInvoice(rows.slice().reverse()).get('inv-1')!.map((c) => c.id).join(',');
  eq(first, again, 'the order of a tied day does not depend on the order the rows arrived in');
}

/* ── absence is unknown until a whole read says otherwise ──────────────────── */

eq(chaseState([], 'ready').state, 'never', 'a whole read with no rows is genuinely nobody having chased it');
eq(chaseState(undefined, 'ready').state, 'never', 'and so is no entry at all under a whole read');

for (const st of ['loading', 'error', 'partial'] as const) {
  const s = chaseState([], st);
  eq(s.state, 'unread', `under '${st}' an empty log is UNKNOWN, not "nobody has chased this"`);
  ok(!/never|nobody has chased/i.test(line(s)), `and the sentence under '${st}' does not say nobody chased it`);
}
ok(/not all of it/i.test(line(chaseState([], 'partial'))),
  "'partial' says the set is a prefix — the oldest chases are the ones a truncated read drops");
ok(/not the same as nobody having chased it/i.test(line(chaseState([], 'error'))),
  'and a failed read says so in as many words, because that is the sentence that gets somebody rung twice');
// Even with rows in hand, a partial read may not be counted. The rows are real;
// the SET is a prefix, and the count is what a screen puts beside a write-off.
eq(chaseState([chase()], 'partial').state, 'unread',
  'a partial read is refused even when it carried rows — the figure over it would be short by an unknown number');

{
  const s = chaseState([chase({ chasedOn: '2026-09-11', via: 'phone' }), chase({ id: 'c2', chasedOn: '2026-09-01' })], 'ready', '2026-09-13');
  eq(s.state, 'chased', 'a whole read with rows is a history');
  if (s.state === 'chased') {
    eq(s.count, 2, 'counted only under a whole read');
    eq(s.last.chasedOn, '2026-09-11', 'and the last one is the one the caller handed over first');
  }
  ok(/the gym’s own record/.test(line(s)), 'the sentence attributes the act to the gym and not to this product');
  ok(/2 days ago/.test(line(s)), 'and says how long it has been, which is the thing the ageing table could not say');
}

/* ── the sentence itself ───────────────────────────────────────────────────── */

ok(/Chased once/.test(lastChaseLine(chase(), 1, '2026-09-01')), 'one chase is "once" rather than "1 times"');
ok(/today \(2026-09-01\)/.test(lastChaseLine(chase(), 1, '2026-09-01')), 'a chase made today says today');
ok(/1 day ago/.test(lastChaseLine(chase({ chasedOn: '2026-09-01' }), 1, '2026-09-02')), 'and one day is singular');
ok(!/ago/.test(lastChaseLine(chase(), 1, null)),
  'with no gym day to compare against there is no "days ago" — a wrong one is an owner deciding not to ring somebody');
ok(/on 2026-09-01/.test(lastChaseLine(chase(), 1, null)), 'the day it happened is still stated: it is a bare day and has no zone to get wrong');
ok(/by telephone/.test(lastChaseLine(chase({ via: 'phone' }), 1, null)), 'the means is named');
ok(/not recorded/.test(lastChaseLine(chase({ via: null }), 1, null)),
  'and an unrecognised means says so rather than being relabelled as something the gym never said');
for (const n of [1, 2, 9]) {
  const s = lastChaseLine(chase(), n, '2026-09-13');
  ok(!/repple/i.test(s) && !/\bwe sent\b|\bwas sent\b|\bdelivered\b/i.test(s),
    `the sentence for ${n} chases must not assert delivery: "${s}"`);
}

/* ── days between two bare days ────────────────────────────────────────────── */

eq(daysSince('2026-09-01', '2026-09-13'), 12, 'whole days, exactly');
eq(daysSince('2026-09-13', '2026-09-13'), 0, 'the same day is zero and not one');
eq(daysSince('2026-03-28', '2026-03-30'), 2,
  'and a clock change inside the span does not round it away — both ends are anchored at UTC midnight');
eq(daysSince('2026-09-01', null), null, 'no today, no answer');
eq(daysSince('not-a-day', '2026-09-13'), null, 'and nothing is computed off a string that is not a day');

/* ── the working list ──────────────────────────────────────────────────────── */

{
  const overdue = [{ id: 'inv-1' }, { id: 'inv-2' }, { id: 'inv-3' }];
  const by = byInvoice([chase({ id: 'a', invoiceId: 'inv-2' })]);
  eq(unchased(overdue, by, 'ready')?.map((i) => i.id).join(','), 'inv-1,inv-3',
    'the two nobody has recorded chasing, NAMED rather than counted');
  // An empty array here is the claim "every overdue invoice has been chased".
  // A failed read is not entitled to make it, and null is how that is said.
  for (const st of ['loading', 'error', 'partial'] as const) {
    eq(unchased(overdue, by, st), null, `under '${st}' there is no working list, because "all chased" would be a claim`);
  }
  eq(unchased(overdue, null, 'ready'), null, 'and no index is no answer either');
  eq(unchased([], by, 'ready')?.length, 0, 'nothing overdue is an empty list rather than a refusal');
}

eq(stalestChase([chase({ chasedOn: '2026-09-01' }), chase({ id: 'c2', chasedOn: '2026-06-01' })], '2026-09-13'), 104,
  'the longest any of them has gone');
eq(stalestChase([], '2026-09-13'), null,
  'an invoice with no chase at all is not "chased a very long time ago" — it belongs on the unchased list instead');
eq(stalestChase([chase()], null), null, 'and with no gym day there is no answer');

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
                  id: 'c-new', invoice_id: payload.invoice_id, chased_on: payload.chased_on,
                  via: payload.via, note: payload.note, created_at: '2026-09-13T10:00:00Z',
                  created_by: payload.created_by,
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
        eq: () => Promise.resolve({
          error: opts.error ?? null,
          count: opts.count === undefined ? 1 : opts.count,
          data: null,
        }),
      }),
    }),
  };
}

void (async () => {
  {
    const captured: any[] = [];
    const row = await recordChase(insertDb({ captured }) as any, 't-1', {
      invoiceId: 'inv-1', chasedOn: '2026-09-11', via: 'phone', note: '  no answer  ', createdBy: 'owner-1',
    });
    eq(captured.length, 1, 'one insert into one table');
    eq(captured[0].chased_on, '2026-09-11', 'the day the chase happened, as stated');
    eq(captured[0].note, 'no answer', 'the note, trimmed');
    eq(captured[0].created_by, 'owner-1', 'and who recorded it');
    eq(row.chasedOn, '2026-09-11', 'and the row comes back');
    // The invoice is NOT touched. Recording a chase changes nothing about what
    // is owed or when it fell due, and an invoice must not be able to leave a
    // band it genuinely sits in because somebody rang about it.
    ok(!('status' in captured[0]) && !('due_on' in captured[0]),
      'nothing about the invoice itself is written — overdue is computed from the due date and is not up for negotiation');
    // And the table it writes to is the one with no trigger on it. gym_invoices
    // carries gym_invoice_notify(), which mails the member.
    ok(!('member_id' in captured[0]) && !('user_id' in captured[0]),
      'and nothing addressed to a person is written anywhere: this is a record, not a send');
  }
  {
    const captured: any[] = [];
    await recordChase(insertDb({ captured }) as any, 't-1', { invoiceId: 'inv-1', chasedOn: '2026-09-11', via: 'email' });
    eq(captured[0].note, null, 'an absent note is null and never an empty string — the CHECK refuses a blank');
  }
  {
    // The row came back as something else. Rare, and the one it catches is the
    // one that would show a chase dated somewhere nobody put it.
    const why = await threw(recordChase(
      insertDb({ data: { id: 'c-new', invoice_id: 'inv-1', chased_on: '2026-09-12', via: 'email' } }) as any,
      't-1', { invoiceId: 'inv-1', chasedOn: '2026-09-11', via: 'email' },
    ));
    ok(why != null && /did not come back matching/.test(why),
      'a row that landed with a different day is reported rather than reported as done');
    ok(why != null && /nothing was sent to anybody/.test(why),
      'and the failure message says so too, because that is what an owner will be wondering');
  }
  {
    const why = await threw(recordChase(insertDb({ data: null }) as any, 't-1', { invoiceId: 'inv-1', chasedOn: '2026-09-11', via: 'email' }));
    ok(why != null, 'an insert that returned no row is not a success');
  }
  {
    const why = await threw(recordChase(insertDb({ error: { message: 'refused' } }) as any, 't-1', { invoiceId: 'inv-1', chasedOn: '2026-09-11', via: 'email' }));
    ok(why != null, 'a database error is thrown rather than swallowed — supabase-js RESOLVES on one');
  }
  {
    eq(await threw(deleteChase(deleteDb({}) as any, 'c-1')), null, 'removing a chase recorded in error goes through');
    // The defect wroteRows.ts exists for. The delete policy is
    // `is_owner_of(tenant_id)`, so a delete by anybody else matches zero rows
    // and comes back with no error at all.
    ok(await threw(deleteChase(deleteDb({ count: 0 }) as any, 'c-1')) != null,
      'a delete that matched no row is not a success');
    ok(await threw(deleteChase(deleteDb({ error: { message: 'refused' } }) as any, 'c-1')) != null,
      'and a refused one is thrown');
  }

  if (errors.length) {
    console.error(`invoiceChases.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('invoiceChases.test.ts — ok');
})();
