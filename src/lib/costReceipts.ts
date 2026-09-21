// The piece of paper behind a cost, and the exact size of the claim that makes.
//
// ── What this is for ───────────────────────────────────────────────────────
//
// `gym_costs` (supabase/parts/700) is the gym's own word about what it spent.
// `gym_documents` (part 185) is the index in front of the `gym-docs` bucket.
// Until supabase/parts/2640 the second could say a file was about a MEMBER or
// about a MACHINE and had no way to say it was about a COST, so the amount and
// the supplier's invoice sat in one database unable to point at each other —
// and the two screens that report the gym's spending both said so out loud:
//
//   · part 700's header: "nothing here has been checked against a bank, a card,
//     a receipt or a supplier's invoice, and Repple holds no document behind
//     any of it";
//   · `TAX_UNKNOWNS` in src/lib/gymTax.ts, printed to an owner at a filing
//     deadline: "Repple holds no supplier invoice, no receipt and no till roll.
//     Every cost on the record is somebody's typed word about a document that
//     lives somewhere else, and that document is what a tax authority asks for."
//
// ── THE CLAIM A RECEIPT MAKES, AND THE THREE IT DOES NOT ──────────────────
//
// It makes one: somebody at this gym attached this file and said it is about
// this cost.
//
// It does NOT say the cost is verified. Nothing here reads the file, so:
//
//   · the AMOUNT on the paper is never compared to `amount_cents`. A receipt
//     for 420 attached to a cost recorded as 4,200 is a cost with a receipt on
//     it, and the only place that discrepancy exists is in somebody's eyes;
//   · the CURRENCY on the paper is never compared to `gym_costs.currency`,
//     which matters more than it looks in a product with no default currency
//     anywhere — see the header of src/lib/sumCurrency.ts;
//   · the DATE on the paper is never compared to `paid_on`.
//
// So `costEvidence` below reports two states and a third for "we could not
// ask", and none of the three is the word "verified". A console that turned
// "84% of September's costs have a document" into reassurance would have
// invented an audit out of a foreign key. What the count is honestly good for
// is the opposite direction: finding the cost that has nothing behind it
// BEFORE somebody asks for it.
//
// ── Why the kinds are restricted, and why it is a security rule ───────────
//
// `gym_documents.kind` decides who may read a document that is not about a
// person. `gym_doc_readable()` (part 390) admits a TRAINER to four kinds —
// 'service_report', 'photo', 'certificate', 'insurance' — and part 700 refuses
// `gym_costs` to every role but the owner, in as many words: a 'staff' cost
// line with a description on it is "a personnel disclosure the gym did not
// make". Filing the invoice for it as a 'photo' would put the gym's rent, its
// cleaner's pay and its accountant's fee in front of whoever is standing at the
// desk, through the filing cabinet, with the cost table still correctly locked.
//
// So a receipt may only be filed under a kind the floor cannot read, the list
// is here, and costReceipts.test.ts asserts every entry on it is owner-only by
// asking `documentAudience` rather than by restating the answer.
//
// Pure apart from the three calls at the bottom, which take the Supabase client
// as an argument the way src/lib/gymInvoices.ts does, so the console and the
// phone can both use this and neither owns it.
import { documentAudience, documentBlocker, DOCUMENT_LABEL, type DocumentKind } from './gymDocs';
import { chunkIds, uniqueIds } from './idLookup';
import { capLimit } from './rowCap';
import type { LoadStatus } from '../ui/loadStatus';

type Queryable = { from: (table: string) => any; storage?: any };

/* ── what a receipt may be filed as ────────────────────────────────────────── */

/**
 * The kinds a cost receipt may be filed under.
 *
 * Both are owner-only under `documentAudience`, and that is the property that
 * matters rather than the labels — see the header. 'other' is the till receipt,
 * the supplier's invoice, the card slip and the bank confirmation; 'contract'
 * is the supply agreement or lease the recurring cost comes out of, which an
 * owner filing a year of rent will reach for once and then never again.
 *
 * Deliberately NOT 'insurance', which is the kind an insurance PREMIUM's
 * receipt invites: the certificate is the building's paperwork and the floor
 * is meant to be able to see it is current, so the same kind cannot also carry
 * what the gym paid for it.
 */
export const RECEIPT_KINDS: readonly DocumentKind[] = ['other', 'contract'] as const;

/** What each reads as beside a cost, which is not what it reads as in the
 *  filing cabinet: "Other" is a fine name for the drawer and a useless one for
 *  the thing an owner is being asked to choose. */
export const RECEIPT_KIND_LABEL: Record<string, string> = {
  other: 'Receipt or invoice',
  contract: 'Supply agreement',
};

/** The label the filing cabinet itself uses, for a screen that shows both. */
export const receiptKindFiledAs = (kind: DocumentKind): string => DOCUMENT_LABEL[kind];

/**
 * The sentence that has to sit beside any count of receipts, wherever one is
 * drawn.
 *
 * One wording in one place, for the reason `MIXED_CURRENCY_NOTE` in
 * src/lib/sumCurrency.ts gives. A proportion on a money screen is read as a
 * score, and this one is not a score: it counts foreign keys, not documents
 * anybody has checked.
 */
export const RECEIPT_IS_NOT_A_CHECK_NOTE =
  'Attaching a file records that somebody says it belongs to this cost. Nothing '
  + 'here reads it: the amount, the currency and the date on the paper are never '
  + 'compared with the ones on the line, so a cost with a document on it is '
  + 'evidenced and is not checked.';

/**
 * Why this file cannot be filed against this cost, or null when it can.
 *
 * The file checks are `documentBlocker`'s — 25 MB, a non-empty file, one of the
 * four mime types the bucket accepts — because they are the bucket's rules and
 * a second copy of them is a second thing to forget. What is added here is the
 * kind, which is the security rule above, and the cost, because a receipt with
 * no cost on it is just a document and belongs on the compliance screen.
 */
export function receiptBlocker(
  costId: string | null | undefined,
  kind: DocumentKind,
  file: { name: string; size: number; type: string } | null,
  title: string,
): string | null {
  if (!costId) return 'Pick the cost this belongs to. A file attached to nothing is a document, and those are filed on Compliance.';
  if (!RECEIPT_KINDS.includes(kind)) {
    // Not "invalid kind". The reason is the whole point and an owner who is
    // told it will not try to work around it.
    return 'A receipt can only be filed as a kind the floor cannot read. What the gym pays in rent, and to whom, is the owner’s record. Filing it as a photograph or a certificate would put it in front of every trainer.';
  }
  return documentBlocker(title, file);
}

/**
 * The title a receipt gets when nobody types one.
 *
 * The cost's own description and the day the money went out, which is what
 * somebody hunting for it a year later actually has in their head. Never the
 * FILE's name: a bucket full of `scan0042.pdf` is the folder part 185 exists to
 * replace, and `documentBlocker` refuses an empty title for the same reason.
 *
 * `paidOn` is a bare `YYYY-MM-DD` off a `date` column and is concatenated, not
 * parsed — this is the day the gym recorded, in the form it recorded it, and
 * turning it into a `Date` here would move it for every reader who is not on
 * UTC. It is a label, not a comparison.
 */
export function receiptTitle(cost: { description: string; paidOn: string }): string {
  const d = (cost.description ?? '').trim();
  return d ? `${d} · ${cost.paidOn}` : `Cost paid ${cost.paidOn}`;
}

/* ── what is attached ─────────────────────────────────────────────────────── */

export interface CostReceipt {
  id: string;
  /** Never null on a row this module returns — the read filters on it. Typed
   *  as a string so a caller cannot index by something absent. */
  costId: string;
  kind: DocumentKind;
  title: string;
  storagePath: string;
  mime: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

/** The receipts on each cost, keyed by cost id. A cost with none is ABSENT from
 *  the map rather than present with an empty array, so a caller cannot read "no
 *  receipts" out of a map that was never populated. */
export function byCost(receipts: readonly CostReceipt[]): Map<string, CostReceipt[]> {
  const out = new Map<string, CostReceipt[]>();
  for (const r of receipts) {
    if (!r.costId) continue;
    const list = out.get(r.costId);
    if (list) list.push(r);
    else out.set(r.costId, [r]);
  }
  return out;
}

/**
 * What is behind one cost: a document, nothing, or no answer.
 *
 * `status` is the state of the RECEIPTS read and nothing else. This is the
 * distinction src/ui/loadStatus.ts exists for, restated where a money screen
 * will reach for it: an empty map from a refused query says "this cost has no
 * receipt" in exactly the same shape as an empty map from a gym that files
 * everything, and only one of those is true.
 *
 * 'partial' is never 'none'. A truncated read of the documents table is a
 * PREFIX, and the costs whose receipts fell off the end are precisely the ones
 * a screen would then print as unevidenced.
 */
export type CostEvidence =
  /** At least one document is attached, and `count` says how many. */
  | { state: 'attached'; count: number }
  /** The read finished and nothing is attached to this cost. */
  | { state: 'none' }
  /** The read is still in flight, was refused, or came back truncated. */
  | { state: 'unknown'; why: string };

export function costEvidence(
  costId: string,
  index: Map<string, CostReceipt[]> | null,
  status: LoadStatus,
): CostEvidence {
  if (status === 'loading') {
    return { state: 'unknown', why: 'still reading what is filed against this cost' };
  }
  if (status === 'error' || index === null) {
    return {
      state: 'unknown',
      why: 'the filing cabinet could not be read, so whether anything is attached to this cost is unknown rather than nothing',
    };
  }
  if (status === 'partial') {
    return {
      state: 'unknown',
      why: 'more documents came back than could be read in one go, so a cost that looks bare here may not be',
    };
  }
  const rows = index.get(costId);
  // `?? 0` would be wrong one line up and is right here: `status` is 'ready' and
  // `index` is a map built from a whole read, so an absent key is a cost with
  // nothing filed against it rather than a cost nobody asked about.
  return rows && rows.length ? { state: 'attached', count: rows.length } : { state: 'none' };
}

/** The words for one of those, for a table cell. Null for 'attached', because
 *  a screen that has the documents renders them rather than a sentence about
 *  them. */
export function evidenceNote(e: CostEvidence): string | null {
  if (e.state === 'attached') return null;
  if (e.state === 'unknown') return e.why;
  return 'Nothing attached. The paper for this one is somewhere else.';
}

/* ── reads ────────────────────────────────────────────────────────────────── */

/**
 * Every document attached to any of these costs.
 *
 * Chunked rather than one `.in()`: a month of a busy gym is a few dozen costs
 * and a year is hundreds, and src/lib/idLookup.ts exists because a bare `.in()`
 * answers a long list with a truncated one and no complaint. Here that would
 * print "nothing attached" against costs whose receipts are on file.
 *
 * The error is READ off the result and thrown. supabase-js resolves on a
 * database error, so a missing check turns a refused query into a gym that
 * files nothing — and on this screen that reads as the accountant's worst case
 * rather than as a broken query. The caller holds the failure and
 * `costEvidence` above turns it into 'unknown'.
 *
 * `capLimit()` per chunk and the truncation is REPORTED rather than thrown,
 * because a prefix of this set is still worth drawing: the receipts that did
 * come back are real and openable. What must not happen is a bare cost being
 * called bare, and `whole: false` is what stops that.
 */
export async function fetchCostReceipts(
  sb: Queryable, tenantId: string, costIds: Iterable<string | null | undefined>,
): Promise<{ receipts: CostReceipt[]; whole: boolean }> {
  const unique = uniqueIds(costIds);
  if (!unique.length) return { receipts: [], whole: true };
  const out: CostReceipt[] = [];
  let whole = true;
  for (const chunk of chunkIds(unique)) {
    const { data, error } = await sb
      .from('gym_documents')
      .select('id, cost_id, kind, title, storage_path, mime, size_bytes, uploaded_by, uploaded_at')
      .eq('tenant_id', tenantId)
      .in('cost_id', chunk)
      .order('uploaded_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(capLimit());
    if (error) throw error;
    const rows = (data as any[] | null) ?? [];
    // `capLimit()` asks for one more row than the ceiling, so a full page is the
    // set being bigger than the page — see src/lib/rowCap.ts.
    if (rows.length >= capLimit()) whole = false;
    for (const r of rows) {
      if (!r.cost_id) continue;
      out.push({
        id: r.id,
        costId: r.cost_id,
        // Not defaulted to 'other'. An unrecognised kind is a row written by
        // something that is not this module, and calling it 'other' would state
        // the audience rule's answer about a kind nobody here knows.
        kind: r.kind,
        title: r.title,
        storagePath: r.storage_path,
        mime: r.mime ?? null,
        sizeBytes: Number.isFinite(r.size_bytes) ? r.size_bytes : null,
        uploadedBy: r.uploaded_by ?? null,
        uploadedAt: r.uploaded_at,
      });
    }
  }
  return { receipts: out, whole };
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/**
 * Record a file that is already in the bucket as the receipt for a cost.
 *
 * Called AFTER the upload and never before, which is `recordDocument`'s
 * ordering in src/lib/gymDocs.ts and its reasoning applies unchanged: a row
 * pointing at an object that does not exist is a document the register says the
 * gym holds and cannot produce, and that is the more expensive of the two
 * orphans.
 *
 * THE ROW IS READ BACK, and this is not belt-and-braces. `gym_documents_owner`
 * is `is_owner_of(tenant_id)` and supabase/parts/2640 narrows the trainer's
 * insert with `cost_id is null`, so an insert made by anybody but the owner is
 * refused by a policy — and a PostgREST insert that a policy refuses can come
 * back with no error on some paths and simply no row. Returning the inserted
 * row and checking that it carries the cost this was filed against is what
 * turns "no error" into "the record changed", which is the rule this codebase
 * has written down in src/lib/wroteRows.ts and broken more than once.
 */
export async function recordCostReceipt(
  sb: Queryable,
  tenantId: string,
  d: {
    costId: string;
    kind: DocumentKind;
    title: string;
    storagePath: string;
    mime: string | null;
    sizeBytes: number | null;
    uploadedBy: string | null;
  },
): Promise<CostReceipt> {
  if (!RECEIPT_KINDS.includes(d.kind)) {
    // Refused here as well as in the blocker, because the blocker is what a
    // form calls and this is what anything else calls. See the header: the kind
    // is who may read the gym's spending.
    throw new Error('A receipt can only be filed as a kind the floor cannot read.');
  }
  const { data, error } = await sb.from('gym_documents').insert({
    tenant_id: tenantId,
    cost_id: d.costId,
    kind: d.kind,
    title: d.title.trim(),
    storage_path: d.storagePath,
    mime: d.mime,
    size_bytes: d.sizeBytes,
    uploaded_by: d.uploadedBy,
  }).select('id, cost_id, kind, title, storage_path, mime, size_bytes, uploaded_by, uploaded_at').single();
  if (error) throw error;
  const row = data as any;
  if (!row?.id || row.cost_id !== d.costId) {
    throw new Error(
      'That file was uploaded and the record of it did not come back, so nothing on this gym’s '
      + 'books is pointing at it. Reload this screen before attaching it again. A second attempt '
      + 'would put the same document in the bucket twice.',
    );
  }
  return {
    id: row.id,
    costId: row.cost_id,
    kind: row.kind,
    title: row.title,
    storagePath: row.storage_path,
    mime: row.mime ?? null,
    sizeBytes: Number.isFinite(row.size_bytes) ? row.size_bytes : null,
    uploadedBy: row.uploaded_by ?? null,
    uploadedAt: row.uploaded_at,
  };
}

/**
 * A link to one receipt.
 *
 * The bucket is private, so signing is the only way in — and the signing call
 * is itself checked against the SELECT policy, which is what makes part 390 the
 * gate rather than this function. No read is logged: `gym_document_reads`
 * exists for documents about a PERSON (part 390's argument is about a member's
 * medical paperwork), and a supplier's invoice is about the building.
 */
export async function openCostReceipt(sb: Queryable, storagePath: string): Promise<string> {
  const b = sb.storage?.from?.('gym-docs');
  if (!b) throw new Error('This client has no storage attached, so the file itself cannot be reached.');
  const { data, error } = await b.createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) {
    throw new Error(
      'That file could not be opened. The record of it is still here; the object may have been '
      + 'removed from storage.',
    );
  }
  return data.signedUrl as string;
}

/** Every kind on `RECEIPT_KINDS` is one a trainer may not read. Exported so the
 *  test asserts the PROPERTY rather than the list, and so a screen can say why
 *  the choice is narrow without restating the rule. */
export function receiptKindsAreOwnerOnly(): boolean {
  return RECEIPT_KINDS.every((kind) => documentAudience({ memberAttached: false, kind }) === 'owner');
}
