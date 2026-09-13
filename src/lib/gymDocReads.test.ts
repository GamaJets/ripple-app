// Who was handed a link to a member's file. Compile with tsc, run with node.
//
// `gym_document_reads` is the gate that lets a member-attached document open at
// all, and until now nothing read it back. The assertions here are all about
// the one sentence a screen over this table must never say by accident:
// "never opened", about a page that simply does not reach far enough back.
import {
  readsFor, readSummary, readerLine,
  type DocumentRead, type DocumentReadLog,
} from './gymDocs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const read = (over: Partial<DocumentRead> = {}): DocumentRead => ({
  id: 'r1', documentId: 'doc-1', storagePath: 't/abc-contract.pdf',
  docKind: 'contract', docTitle: 'Membership contract', readBy: 'owner-1',
  readByName: 'Dana Reyes', linkIssuedAt: '2026-09-01T09:00:00Z', ...over,
});
const log = (rows: DocumentRead[], over: Partial<DocumentReadLog> = {}): DocumentReadLog => ({
  rows, truncated: false, oldest: rows.length ? rows[rows.length - 1].linkIssuedAt : null,
  namesError: null, ...over,
});
const doc = { id: 'doc-1', storagePath: 't/abc-contract.pdf' };

/* ── matching an opening to the document it opened ────────────────────────── */

eq(readsFor(log([read(), read({ id: 'r2', documentId: 'doc-2', storagePath: 't/xyz.pdf' })]), doc).length, 1,
  'only this document’s openings are counted');

// `document_id` is `on delete set null`, so a row whose document was deleted
// falls back to the path it was filed at. Matching on the path FIRST would
// attribute it to whatever was later uploaded there.
eq(readsFor(log([read({ documentId: null })]), doc).length, 1,
  'an opening whose document was deleted still matches by its storage path');
eq(readsFor(log([read({ documentId: 'doc-9', storagePath: doc.storagePath })]), doc).length, 0,
  'and a row that names a different document is not claimed by a matching path');

eq(readsFor(null, doc).length, 0, 'a log that was never read matches nothing');

/* ── the sentence that must not be said by accident ───────────────────────── */

// A failed or absent read is not an empty log. The caller says "unknown" in its
// own words; this refuses to hand it a sentence at all.
eq(readSummary(null, []), null, 'an unread log produces no claim about how often anything was opened');

eq(readSummary(log([]), []), 'Never opened.',
  'a whole log with nothing in it may say never, because it can see everything');

// The page is two hundred rows. A document absent from it was either never
// opened or last opened before the page begins, and those are not the same
// answer to "who has seen this member's medical note".
const cut = readSummary(log([], { truncated: true }), [])!;
ok(!cut.toLowerCase().includes('never'), 'a page that does not reach the beginning never says never');
ok(cut.includes('older ones are not on this screen'), 'and says what it cannot see');

eq(readSummary(log([read()]), [read()]), 'Opened once.', 'one opening is once');
eq(readSummary(log([read(), read({ id: 'r2' })]), [read(), read({ id: 'r2' })]), 'Opened 2 times.',
  'and two are counted');
ok(readSummary(log([read()], { truncated: true }), [read()])!.includes('most recent'),
  'a count over a page says it is a count over a page');

/* ── who opened it: three silences that are not each other ────────────────── */

eq(readerLine(read(), { meId: 'owner-1' }), 'you', 'the reader is named as themselves');
eq(readerLine(read(), { meId: 'owner-2' }), 'Dana Reyes', 'and everybody else by name');
ok(readerLine(read({ readBy: null, readByName: null }), {}).includes('removed'),
  'a deleted account is a deleted account, not an unknown one');
ok(readerLine(read({ readByName: null }), { namesError: 'permission denied' }).includes('could not be read'),
  'a failed lookup says so');
ok(!readerLine(read({ readByName: null }), { namesError: 'permission denied' }).includes('removed'),
  'and is never reported as a removed account');
eq(readerLine(read(), { meId: 'owner-1', namesError: 'permission denied' }), 'you',
  'the reader is still the reader when the lookup failed');
ok(readerLine(read({ readByName: '' }), {}).includes('no name'),
  'an account with a blank name is neither removed nor unreadable');

if (errors.length) {
  console.error(`gymDocReads: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('gymDocReads: all assertions passed');
