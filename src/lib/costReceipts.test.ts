// The paper behind a cost: who may read it, what its absence means, and what
// attaching it does NOT claim. Compile with tsc, run with node.
//
// Three rules here and all three fail silently:
//
//   · A receipt may only be filed under a kind the floor cannot read. Get this
//     wrong and the gym's rent, its cleaner's pay and its accountant's fee are
//     readable by every trainer through the filing cabinet, while `gym_costs`
//     is still correctly locked — a leak with no screen showing it.
//   · A refused read of the documents table must not print "nothing attached".
//     That sentence, on an accountant's page, is the one an owner acts on by
//     going to look for a receipt they have already filed.
//   · A write is confirmed by the row coming back, not by the absence of an
//     error. A policy that refuses an insert is the case this codebase has
//     already shipped twice (src/lib/wroteRows.ts).
import {
  RECEIPT_KINDS, RECEIPT_KIND_LABEL, receiptKindsAreOwnerOnly, receiptBlocker,
  receiptTitle, byCost, costEvidence, evidenceNote, recordCostReceipt,
  fetchCostReceipts, RECEIPT_IS_NOT_A_CHECK_NOTE,
  type CostReceipt,
} from './costReceipts';
import { documentAudience, DOCUMENT_KINDS, MAX_DOCUMENT_BYTES } from './gymDocs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const pdf = { name: 'rent-september.pdf', size: 240_000, type: 'application/pdf' };

const receipt = (over: Partial<CostReceipt> = {}): CostReceipt => ({
  id: 'doc-1',
  costId: 'cost-1',
  kind: 'other',
  title: 'Rent — 2026-09-01',
  storagePath: 'tenant-1/2026-09-01-abc123-rent.pdf',
  mime: 'application/pdf',
  sizeBytes: 240_000,
  uploadedBy: 'owner-1',
  uploadedAt: '2026-09-02T09:00:00.000Z',
  ...over,
});

/* ── the kind is a security rule ───────────────────────────────────────────── */

// Asked of `documentAudience` rather than restated, so the day part 390 widens
// a kind this fails instead of agreeing with itself.
ok(receiptKindsAreOwnerOnly(), 'every kind a receipt may be filed under must be one the floor cannot read');
for (const kind of RECEIPT_KINDS) {
  eq(documentAudience({ memberAttached: false, kind }), 'owner',
    `a receipt filed as ${kind} must not be readable by a trainer — gym_costs is the owner's alone`);
  ok(!!RECEIPT_KIND_LABEL[kind], `${kind} needs words an owner is actually choosing between`);
}

// The four a trainer CAN read are the ones this list must never grow into. The
// tempting one is 'insurance': the premium has a receipt and the certificate is
// the building's paperwork, and they cannot be the same kind.
for (const kind of DOCUMENT_KINDS) {
  if (documentAudience({ memberAttached: false, kind }) === 'staff') {
    ok(!RECEIPT_KINDS.includes(kind), `${kind} is readable by the floor and must not be offered for a receipt`);
  }
}

/* ── what will not be filed ────────────────────────────────────────────────── */

eq(receiptBlocker('', 'other', pdf, 'Rent'),
  'Pick the cost this belongs to. A file attached to nothing is a document, and those are filed on Compliance.',
  'a receipt with no cost on it is refused, and the answer names the screen that does take one');
ok(receiptBlocker('cost-1', 'photo' as any, pdf, 'Rent')?.includes('front of every trainer') === true,
  'filing a receipt as a photograph is refused with the reason, not with "invalid kind"');
eq(receiptBlocker('cost-1', 'other', pdf, 'Rent'), null, 'the ordinary case is allowed through');
eq(receiptBlocker('cost-1', 'other', null, 'Rent'), 'Choose the file.', 'no file, no receipt');
ok(receiptBlocker('cost-1', 'other', { ...pdf, size: MAX_DOCUMENT_BYTES + 1 }, 'Rent') != null,
  'the bucket’s own size limit is enforced before the upload rather than after it');
ok(receiptBlocker('cost-1', 'other', { ...pdf, type: 'application/zip' }, 'Rent') != null,
  'a mime the bucket would refuse is refused here, which is a faster way to find out');
ok(receiptBlocker('cost-1', 'other', pdf, '   ') != null, 'an untitled file makes the cabinet a folder again');

/* ── the default title ─────────────────────────────────────────────────────── */

eq(receiptTitle({ description: 'Rent', paidOn: '2026-09-01' }), 'Rent — 2026-09-01',
  'the title is what somebody hunting a year later has in their head');
eq(receiptTitle({ description: '  ', paidOn: '2026-09-01' }), 'Cost paid 2026-09-01',
  'a cost with no description still gets a title rather than an empty one');
// The day is carried through as the string it was stored as. Parsing it would
// move it for every reader who is not on UTC, and this is the one place a date
// crosses from a `date` column into a label.
ok(receiptTitle({ description: 'Rent', paidOn: '2026-01-01' }).endsWith('2026-01-01'),
  'the paid day is concatenated, never parsed — a New Year cost must not be titled 2025-12-31');

/* ── attached, absent, and unknown ─────────────────────────────────────────── */

const index = byCost([receipt(), receipt({ id: 'doc-2' }), receipt({ id: 'doc-3', costId: 'cost-2' })]);
eq(index.get('cost-1')?.length, 2, 'two receipts on one cost are both kept');
eq(index.has('cost-9'), false, 'a cost with nothing filed is ABSENT from the map, not present and empty');

{
  const e = costEvidence('cost-1', index, 'ready');
  eq(e.state, 'attached', 'a cost with documents on it reads as attached');
  eq(e.state === 'attached' ? e.count : null, 2, 'and says how many');
  eq(evidenceNote(e), null, 'nothing is said about a cost whose documents the screen is about to draw');
}
{
  const e = costEvidence('cost-9', index, 'ready');
  eq(e.state, 'none', 'a whole read that found nothing is genuinely nothing');
  ok((evidenceNote(e) ?? '').length > 0, 'and it says so');
}

// The three that must never read as 'none'. This is the defect the whole
// module is arranged around: an empty map from a query that failed looks
// exactly like an empty map from a gym that files everything.
for (const status of ['loading', 'error', 'partial'] as const) {
  const e = costEvidence('cost-9', status === 'error' ? null : index, status);
  eq(e.state, 'unknown', `a ${status} read must not report a cost as having nothing behind it`);
  ok((e.state === 'unknown' ? e.why : '').length > 0, `and ${status} must say which silence it is`);
}
// 'partial' with rows in hand is still unknown. The rows are real; the SET is a
// prefix, and the costs whose receipts fell off the end are exactly the ones a
// screen would print as bare.
eq(costEvidence('cost-1', index, 'partial').state, 'unknown',
  'a truncated read is not whole even about the costs it did answer for');

ok(/never compared/.test(RECEIPT_IS_NOT_A_CHECK_NOTE),
  'the note beside any count of receipts has to say the paper is not read');
ok(!/verif/i.test(RECEIPT_IS_NOT_A_CHECK_NOTE),
  'and it must not use the word this product cannot stand behind');

/* ── the write is confirmed by the row, not by the silence ─────────────────── */

function fakeDb(opts: { error?: unknown; row?: unknown; captured?: any[] }) {
  return {
    from: (_t: string) => ({
      insert: (payload: any) => {
        opts.captured?.push(payload);
        return {
          select: (_c: string) => ({
            single: () => Promise.resolve({ data: opts.row ?? null, error: opts.error ?? null }),
          }),
        };
      },
    }),
  };
}

const threw = async (p: Promise<unknown>): Promise<string | null> => {
  try { await p; return null; } catch (e: any) { return String(e?.message ?? e); }
};

const good = {
  id: 'doc-7', cost_id: 'cost-1', kind: 'other', title: 'Rent — 2026-09-01',
  storage_path: 'tenant-1/x.pdf', mime: 'application/pdf', size_bytes: 10,
  uploaded_by: 'owner-1', uploaded_at: '2026-09-02T09:00:00.000Z',
};

void (async () => {
  {
    const captured: any[] = [];
    const sb = fakeDb({ row: good, captured });
    const r = await recordCostReceipt(sb as any, 'tenant-1', {
      costId: 'cost-1', kind: 'other', title: '  Rent — 2026-09-01  ',
      storagePath: 'tenant-1/x.pdf', mime: 'application/pdf', sizeBytes: 10, uploadedBy: 'owner-1',
    });
    eq(r.costId, 'cost-1', 'the ordinary case comes back pointing at the cost it was filed against');
    eq(captured[0].cost_id, 'cost-1', 'and the insert carried the cost id');
    eq(captured[0].title, 'Rent — 2026-09-01', 'the title is trimmed, because the CHECK in part 185 refuses a blank one');
    eq(captured[0].tenant_id, 'tenant-1', 'and the gym, which is what the policy matches on');
  }

  {
    // The defect, restated: no error and no row. A policy that filters an
    // insert to nothing is not an exception, and the file is already in the
    // bucket by the time this runs.
    const why = await threw(recordCostReceipt(fakeDb({ row: null }) as any, 'tenant-1', {
      costId: 'cost-1', kind: 'other', title: 'Rent',
      storagePath: 'tenant-1/x.pdf', mime: null, sizeBytes: null, uploadedBy: 'owner-1',
    }));
    ok(why != null && /nothing on this gym’s books is pointing at it/.test(why),
      'a write with no row behind it is reported as not recorded, not as saved');
    ok(why != null && /would put the same document in the bucket twice/.test(why),
      'and it says what a second attempt would cost, because the object is already up there');
  }

  {
    // A row came back for a DIFFERENT cost. Vanishingly unlikely and checked
    // anyway: the alternative is a receipt filed against the wrong line, which
    // is worse than no receipt because it reads as evidence.
    const why = await threw(recordCostReceipt(fakeDb({ row: { ...good, cost_id: 'cost-2' } }) as any, 'tenant-1', {
      costId: 'cost-1', kind: 'other', title: 'Rent',
      storagePath: 'tenant-1/x.pdf', mime: null, sizeBytes: null, uploadedBy: 'owner-1',
    }));
    ok(why != null, 'a row that came back pointing at another cost is not a successful write');
  }

  {
    const why = await threw(recordCostReceipt(fakeDb({ error: { message: 'refused' } }) as any, 'tenant-1', {
      costId: 'cost-1', kind: 'other', title: 'Rent',
      storagePath: 'tenant-1/x.pdf', mime: null, sizeBytes: null, uploadedBy: 'owner-1',
    }));
    ok(why != null, 'a database error is thrown rather than swallowed');
  }

  {
    const why = await threw(recordCostReceipt(fakeDb({ row: good }) as any, 'tenant-1', {
      costId: 'cost-1', kind: 'photo' as any, title: 'Rent',
      storagePath: 'tenant-1/x.pdf', mime: null, sizeBytes: null, uploadedBy: 'owner-1',
    }));
    ok(why != null && /the floor cannot read/.test(why),
      'the kind is refused at the writer too, because a form is not the only caller');
  }

  /* ── the read ────────────────────────────────────────────────────────────── */

  const reads = (rows: any[] | null, error: unknown = null) => ({
    from: (_t: string) => {
      const q: any = {
        select: () => q, eq: () => q, in: () => q, order: () => q,
        limit: () => Promise.resolve({ data: rows, error }),
      };
      return q;
    },
  });

  {
    const r = await fetchCostReceipts(reads([good]) as any, 'tenant-1', ['cost-1']);
    eq(r.receipts.length, 1, 'a row with a cost on it comes back');
    eq(r.whole, true, 'and a short page is the whole set');
  }
  {
    const r = await fetchCostReceipts(reads([]) as any, 'tenant-1', []);
    eq(r.receipts.length, 0, 'no costs asked about, nothing read');
    eq(r.whole, true, 'and nothing to be missing');
  }
  {
    const why = await threw(fetchCostReceipts(reads(null, { message: 'refused' }) as any, 'tenant-1', ['cost-1']));
    ok(why != null, 'a refused read THROWS rather than returning an empty set — an empty set here reads as a gym that files nothing');
  }
  {
    // A full page means there are more. `capLimit()` asks for one past the
    // ceiling for exactly this.
    const full = Array.from({ length: 1001 }, (_v, i) => ({ ...good, id: `doc-${i}` }));
    const r = await fetchCostReceipts(reads(full) as any, 'tenant-1', ['cost-1']);
    eq(r.whole, false, 'a page that came back at the ceiling is a prefix, and the caller has to know');
  }

  if (errors.length) {
    console.error(`costReceipts.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('costReceipts.test.ts — ok');
})();
