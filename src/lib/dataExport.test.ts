// The last copy somebody takes of their own record, and what they are told
// about the files when they delete the account.
// Compile with tsc, run with node.
//
// The assertions that matter are all one shape: a number or a claim standing on
// a read that did not answer. This is the file people export before deleting
// everything, so a confident sentence over a short read is not a cosmetic bug.
import {
  fileSizeLabel, filesRowNote, saveFileFailure, incompleteExportLine,
  DELETION_FILES_NOTE, EXPORT_ROW_NOTE,
} from './dataExport';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── sizes ─────────────────────────────────────────────────────────────── */

eq(fileSizeLabel(400), '400 B', 'bytes read as bytes');
eq(fileSizeLabel(2048), '2.0 KB', 'kilobytes to one decimal while they are small');
eq(fileSizeLabel(1024 * 1024 * 3.5), '3.5 MB', 'and megabytes the same');
eq(fileSizeLabel(1024 * 1024 * 40), '40 MB', 'a large one loses the decimal it does not need');

// The one that matters. Storage does not always report a size, and "0 B" beside
// a photograph reads as an empty file not worth saving.
eq(fileSizeLabel(null), 'size unknown', 'a size storage did not report is not zero');
eq(fileSizeLabel(undefined), 'size unknown', 'and neither is a missing one');
eq(fileSizeLabel(Number.NaN), 'size unknown', 'nor an unparseable one');
eq(fileSizeLabel(0), '0 B', 'though a real zero is stated, because that is a fact about the file');

/* ── the files row ─────────────────────────────────────────────────────── */

eq(filesRowNote(0, true), 'You have no photos, videos or documents stored.',
  'a completed read may say there are none');
ok(/^1 file\./.test(filesRowNote(1, true)), 'one file is singular');
ok(/^4 files\./.test(filesRowNote(4, true)), 'and four are not');

// A count over an incomplete read is the same defect as `"workouts": []` over a
// refused one, and this is the screen where that defect was found.
const short = filesRowNote(3, false);
ok(!/^3 files/.test(short), 'a count is not asserted over a read that came back short');
ok(/may be short/.test(short), 'and the shortness is said out loud');
ok(/Export again/.test(short), 'with something to do about it');

/* ── a save that did not happen ────────────────────────────────────────── */

const generic = saveFileFailure(null);
ok(/still stored on your account/.test(generic), 'a failed save says nothing was lost');
ok(/nothing has been lost/.test(generic), 'in as many words');
eq(saveFileFailure('This version of the app can’t attach files.'), 'This version of the app can’t attach files.',
  'a build that cannot attach a file at all says THAT, rather than sending somebody to try the next file');

/* ── what the export claims to contain ─────────────────────────────────── */

ok(/money/.test(EXPORT_ROW_NOTE), 'the row names the money, which is what it used to omit');
ok(/bookings/.test(EXPORT_ROW_NOTE), 'and the bookings');
ok(/files/.test(EXPORT_ROW_NOTE), 'and the files');
// It promises a LIST of files, not the files. The bytes are saved separately
// and the row must not imply otherwise.
ok(/list of your files/.test(EXPORT_ROW_NOTE), 'and it promises a list of files, not the files themselves');

/* ── the incomplete warning ────────────────────────────────────────────── */

const warn = incompleteExportLine(['gym_payments', 'charges'], 'support@example.com');
ok(/2 parts/.test(warn), 'the count is stated');
ok(/gym_payments, charges/.test(warn), 'and the parts are NAMED — "3 parts" tells nobody whether their payments are in it');
ok(/do not delete your account/.test(warn), 'and it says not to delete the account on the strength of it');
ok(/support@example\.com/.test(warn), 'and where to write, from the brand rather than hardcoded');
ok(/1 part /.test(incompleteExportLine(['charges'], 'a@b.c')), 'one part is singular');
const many = incompleteExportLine(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'a@b.c');
ok(/and 2 more/.test(many), 'a long list is trimmed rather than filling the alert');
ok(/8 parts/.test(many), 'though the true count is still stated');

/* ── the deletion screen, which said nothing at all about the files ────── */

ok(/progress photographs/.test(DELETION_FILES_NOTE), 'the photographs are named');
ok(/messages/.test(DELETION_FILES_NOTE), 'and the message attachments');
ok(/injury documents/.test(DELETION_FILES_NOTE), 'and the injury documents, which are the ones only they can see');

// The awkward half, stated rather than smoothed over. Saying nothing is what
// leaves somebody believing their physiotherapy report went with their account.
ok(/not all of that is automatic/.test(DELETION_FILES_NOTE),
  'it does not claim an automatic purge this product does not have for two of the three stores');
ok(/on request/.test(DELETION_FILES_NOTE), 'and says how those two are actually cleared');
ok(/Export and save your files first/.test(DELETION_FILES_NOTE),
  'and tells them the one thing they can do before it is too late');
ok(!/immediately deleted|permanently erased at once/.test(DELETION_FILES_NOTE),
  'and promises no erasure it cannot perform');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('dataExport.test.ts — ok');
