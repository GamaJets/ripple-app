// Money the gym decided not to collect, and the reason it decided that.
// Compile with tsc, run with node.
//
// Four rules, and each of them is a silence rather than a crash:
//
//   · an invoice cannot leave the receivables without a reason on the row. It
//     was leaving them with nothing at all — `owedOf` folds 'void' and
//     'written_off' into a bucket it calls `dropped`, and the only column that
//     could have carried the reason is `note`, which says what was BILLED.
//   · "x" is not a reason. The database CHECK refuses only whitespace, which
//     is exactly what somebody getting past a form types.
//   · void and written off are different facts about a business and only one
//     of them is a bad debt. They are never collapsed.
//   · reopening an invoice keeps the record that it was once written off.
//     supabase/parts/2642 allows the status and the decision to disagree for
//     this reason, and a screen that printed only one of the two would be
//     erasing the other.
import {
  DROP_STATUSES, DROP_MEANS, WRITE_OFF_PROMPT, MIN_REASON_CHARS, MAX_REASON_CHARS,
  isDropStatus, writeOffBlocker, writeOffHistory, unexplainedDrops, dropInvoice,
  type DropRecord,
} from './invoiceWriteOff';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** The sentence out of a history, or an empty string where there is none.
 *  The 'live' arm has no line by construction, which is the point of the union
 *  and is why this is a function rather than a cast. */
const line = (h: ReturnType<typeof writeOffHistory>): string => ('line' in h ? h.line : '');

const rec = (over: Partial<DropRecord> = {}): DropRecord => ({
  droppedAt: null, dropReason: null, droppedBy: null, droppedByName: null, ...over,
});

/* ── the two are not synonyms ──────────────────────────────────────────────── */

eq(DROP_STATUSES.length, 2, 'exactly the pair owedOf counts as dropped');
ok(DROP_STATUSES.includes('void') && DROP_STATUSES.includes('written_off'),
  'and they are those two, so this file and monthEnd.ts cannot drift about what "not collected" means');
for (const s of DROP_STATUSES) {
  ok(!!DROP_MEANS[s], `${s} needs the sentence that makes the choice, not just the word on the register`);
  ok(!!WRITE_OFF_PROMPT[s], `${s} needs its own question — one generic "Reason" box gets "n/a" typed into it`);
}
ok(DROP_MEANS.void !== DROP_MEANS.written_off, 'and the two sentences say different things');
ok(/never have existed/.test(DROP_MEANS.void), 'void is "nothing was owed"');
ok(/taking the loss/.test(DROP_MEANS.written_off), 'written off is "something was owed and is gone"');
ok(WRITE_OFF_PROMPT.void !== WRITE_OFF_PROMPT.written_off, 'the two questions differ too');

ok(isDropStatus('void') && isDropStatus('written_off'), 'both are drops');
ok(!isDropStatus('paid') && !isDropStatus('open') && !isDropStatus(null) && !isDropStatus('draft'),
  'and nothing else is — a draft is an invoice nobody sent, not one the gym gave up on');

/* ── what will not be recorded ─────────────────────────────────────────────── */

eq(writeOffBlocker('written_off', 'member emigrated in June'), null, 'the ordinary case is allowed through');
ok((writeOffBlocker('written_off', '') ?? '').includes('bad debt'),
  'an empty reason on a write-off is refused in the words of what a write-off is');
ok((writeOffBlocker('void', '') ?? '').includes('should not have existed'),
  'and an empty one on a void is refused in the words of what a void is');
ok(writeOffBlocker('void', '') !== writeOffBlocker('written_off', ''),
  'the two refusals are not one sentence with the word swapped');

// The gap between what the database refuses and what is actually a reason.
ok(writeOffBlocker('written_off', 'x') != null,
  '"x" clears the CHECK in part 2642 and is not a reason — this is the half that has to catch it');
ok((writeOffBlocker('written_off', 'x') ?? '').includes('“x”'),
  'and the refusal quotes it back, because reading it is the argument');
eq(writeOffBlocker('written_off', 'a'.repeat(MIN_REASON_CHARS)), null, 'the floor is inclusive');
ok(writeOffBlocker('written_off', 'a'.repeat(MIN_REASON_CHARS - 1)) != null, 'and one under it is not');
ok(writeOffBlocker('written_off', 'a'.repeat(MAX_REASON_CHARS + 1)) != null,
  'and a pasted email thread is refused rather than truncated');
ok(writeOffBlocker('written_off', `   ${'a'.repeat(MIN_REASON_CHARS)}   `) === null,
  'whitespace around a real reason is trimmed rather than counted');
ok(writeOffBlocker('paid' as any, 'member emigrated in June') != null,
  'a status that is not a drop is refused, and the answer names the two that are');

/* ── what the row says afterwards ──────────────────────────────────────────── */

{
  const h = writeOffHistory('written_off', rec({
    droppedAt: '2026-09-12T10:00:00.000Z', dropReason: 'member emigrated', droppedByName: 'Ana',
  }), '12 Sep 2026');
  eq(h.state, 'dropped', 'a written-off invoice with a reason reads as one');
  ok(/Written off on 12 Sep 2026 by Ana: member emigrated/.test(line(h)),
    'and the line carries when, who and why');
}
{
  const h = writeOffHistory('void', rec({
    droppedAt: '2026-09-12T10:00:00.000Z', dropReason: 'billed twice',
  }), '12 Sep 2026');
  eq(h.state, 'dropped', 'a void reads as one too');
  ok(/^Voided/.test(line(h)), 'in its own word, not as "written off"');
  ok(!/ by /.test(line(h)), 'and an unknown actor is simply absent rather than named as somebody');
}
{
  // Every invoice a gym dropped before part 2642 existed. Reported, never
  // filled in: this app does not know why and must not appear to.
  const h = writeOffHistory('written_off', rec(), null);
  eq(h.state, 'dropped_unexplained', 'a dropped invoice with no decision on the row is its own state');
  ok(/no reason recorded/.test(line(h)), 'and says so');
  ok(/nothing will invent it/.test(line(h)), 'and says it will stay that way');
}
{
  // The reason without the stamp cannot happen — part 2642 has a CHECK both
  // ways — but a row from a database that has not had it applied reads as
  // unexplained rather than as explained.
  const h = writeOffHistory('written_off', rec({ dropReason: 'member emigrated' }), null);
  eq(h.state, 'dropped_unexplained', 'a reason with no decision behind it is not a decision');
}
{
  // The case supabase/parts/2642 deliberately allows: the status moved back
  // and the decision stayed. Both facts, in order.
  const h = writeOffHistory('paid', rec({
    droppedAt: '2026-09-12T10:00:00.000Z', dropReason: 'member emigrated',
  }), '12 Sep 2026');
  eq(h.state, 'reopened', 'an invoice written off and then paid is two facts, not a contradiction');
  ok(/taken off what the gym is owed/.test(line(h)) && /put back/.test(line(h)),
    'and the line holds both, in the order they happened');
  ok(/member emigrated/.test(line(h)), 'including the reason that was given at the time');
}
// The arm that keeps the module honest about itself. An unread `dropped_at` is
// null, and a null one on a written-off invoice would otherwise read as "no
// reason recorded" — telling an owner that a debt they explained in March has
// nothing behind it, out of a query that failed or a migration nobody has run.
for (const read of ['loading', 'error', 'partial'] as const) {
  const h = writeOffHistory('written_off', rec(), null, read);
  eq(h.state, 'unread', `a ${read} read of the decision columns must not report a reason as absent`);
  ok(line(h).length > 0, `and ${read} says which silence it is`);
  // Silent about invoices nobody dropped: "not known" against every live row on
  // the register is a line the reader stops seeing, and then the ones that
  // matter are invisible too.
  eq(writeOffHistory('open', rec(), null, read).state, 'live',
    `a ${read} read says nothing about an invoice that was never dropped`);
}
ok(!/no reason recorded/.test(line(writeOffHistory('written_off', rec(), null, 'error'))),
  'and an unread row is never described in the words of an unexplained one');

eq(writeOffHistory('open', rec(), null).state, 'live', 'an ordinary open invoice has no history to tell');
eq(writeOffHistory(null, rec(), null).state, 'live', 'and neither does one with no status recorded');

/* ── the rows an accountant will ask about ─────────────────────────────────── */

const rows = [
  { id: 'a', status: 'written_off', ...rec({ droppedAt: 't', dropReason: 'member emigrated' }) },
  { id: 'b', status: 'written_off', ...rec() },
  { id: 'c', status: 'void', ...rec() },
  { id: 'd', status: 'open', ...rec() },
  { id: 'e', status: 'paid', ...rec({ droppedAt: 't', dropReason: 'was written off, then paid' }) },
];
eq(unexplainedDrops(rows).map((r) => r.id).join(','), 'b,c',
  'only the dropped rows with nothing on them — an open invoice has made no decision and a reopened one explained itself');

/* ── the write ─────────────────────────────────────────────────────────────── */

const threw = async (p: Promise<unknown>): Promise<string | null> => {
  try { await p; return null; } catch (e: any) { return String(e?.message ?? e); }
};

function db(opts: { error?: unknown; count?: number | null; data?: unknown; captured?: any[] }) {
  return {
    from: (_t: string) => ({
      update: (payload: any, _o?: unknown) => {
        opts.captured?.push(payload);
        return {
          eq: () => ({
            select: () => Promise.resolve({
              error: opts.error ?? null,
              count: opts.count === undefined ? 1 : opts.count,
              data: opts.data ?? [{ id: 'inv-1', status: payload.status, drop_reason: payload.drop_reason }],
            }),
          }),
        };
      },
    }),
  };
}

void (async () => {
  {
    const captured: any[] = [];
    const why = await threw(dropInvoice(db({ captured }) as any, 'inv-1', 'written_off', '  member emigrated  ', 'owner-1'));
    eq(why, null, 'the ordinary case goes through');
    // ONE update. A status written first and a reason written second leaves a
    // window in which the invoice is off the receivables with nothing saying
    // why — which is the state this whole part exists to remove.
    eq(captured.length, 1, 'the status and the reason move in one write');
    eq(captured[0].status, 'written_off', 'the status');
    eq(captured[0].drop_reason, 'member emigrated', 'the reason, trimmed');
    eq(captured[0].dropped_by, 'owner-1', 'and who decided it');
    ok(typeof captured[0].dropped_at === 'string' && captured[0].dropped_at.includes('T'),
      'stamped as an instant, not as a calendar day — the month this belongs to is issued_on and is untouched');
  }
  {
    const why = await threw(dropInvoice(db({}) as any, 'inv-1', 'written_off', 'x', 'owner-1'));
    ok(why != null, 'the blocker is enforced at the writer too, because a form is not the only caller');
  }
  {
    // The defect wroteRows.ts exists for. `gym_invoices_owner` is
    // `is_owner_of(tenant_id)`, so an update by anybody else matches zero rows
    // and comes back with no error — and the screen would report a four-figure
    // debt as written off while it is still being chased.
    const why = await threw(dropInvoice(db({ count: 0, data: [] }) as any, 'inv-1', 'written_off', 'member emigrated', null));
    ok(why != null, 'an update that matched no row is not a success');
  }
  {
    // A row came back without the decision on it. Rare, and the one it catches
    // is the expensive one.
    const why = await threw(dropInvoice(
      db({ data: [{ id: 'inv-1', status: 'written_off', drop_reason: null }] }) as any,
      'inv-1', 'written_off', 'member emigrated', null,
    ));
    ok(why != null && /no reason recorded is the row this exists to/.test(why),
      'a status that moved without its reason is reported rather than reported as done');
  }
  {
    const why = await threw(dropInvoice(db({ error: { message: 'refused' } }) as any, 'inv-1', 'void', 'billed twice again', null));
    ok(why != null, 'a database error is thrown rather than swallowed');
  }

  if (errors.length) {
    console.error(`invoiceWriteOff.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('invoiceWriteOff.test.ts — ok');
})();
