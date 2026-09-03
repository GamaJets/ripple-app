"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The last copy somebody takes of their own record, and what they are told
// about the files when they delete the account.
// Compile with tsc, run with node.
//
// The assertions that matter are all one shape: a number or a claim standing on
// a read that did not answer. This is the file people export before deleting
// everything, so a confident sentence over a short read is not a cosmetic bug.
const dataExport_1 = require("./dataExport");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── sizes ─────────────────────────────────────────────────────────────── */
eq((0, dataExport_1.fileSizeLabel)(400), '400 B', 'bytes read as bytes');
eq((0, dataExport_1.fileSizeLabel)(2048), '2.0 KB', 'kilobytes to one decimal while they are small');
eq((0, dataExport_1.fileSizeLabel)(1024 * 1024 * 3.5), '3.5 MB', 'and megabytes the same');
eq((0, dataExport_1.fileSizeLabel)(1024 * 1024 * 40), '40 MB', 'a large one loses the decimal it does not need');
// The one that matters. Storage does not always report a size, and "0 B" beside
// a photograph reads as an empty file not worth saving.
eq((0, dataExport_1.fileSizeLabel)(null), 'size unknown', 'a size storage did not report is not zero');
eq((0, dataExport_1.fileSizeLabel)(undefined), 'size unknown', 'and neither is a missing one');
eq((0, dataExport_1.fileSizeLabel)(Number.NaN), 'size unknown', 'nor an unparseable one');
eq((0, dataExport_1.fileSizeLabel)(0), '0 B', 'though a real zero is stated, because that is a fact about the file');
/* ── what the file is called ───────────────────────────────────────────── */
// The coach's half of the account had a literal, 'repple-coach-my-data.json',
// so a coach at a white-labelled chain saved a file named after a company they
// do not deal with — and the name is what they will search their downloads for
// in two years. Same argument MY_DATA_FILENAME makes for the member's half.
eq((0, dataExport_1.coachDataFilename)('repple'), 'repple-coach-my-data.json', 'the brand names the file');
eq((0, dataExport_1.coachDataFilename)('atlas-fitness'), 'atlas-fitness-coach-my-data.json', 'and a white-labelled build gets its own name rather than somebody else\'s');
// A registry key is lowercase and hyphenated and is therefore already safe on
// every platform, so nothing here sanitises. What it does refuse is an EMPTY
// prefix: '-coach-my-data.json' looks broken and sorts to the top of a
// downloads folder under no name at all.
eq((0, dataExport_1.coachDataFilename)(''), 'my-coach-my-data.json', 'a missing brand still produces a usable name');
eq((0, dataExport_1.coachDataFilename)('   '), 'my-coach-my-data.json', 'and so does a blank one');
ok((0, dataExport_1.coachDataFilename)('repple') !== 'repple-my-data.json', 'and it is distinct from the member export, which is a different file with different tables in it');
/* ── the files row ─────────────────────────────────────────────────────── */
eq((0, dataExport_1.filesRowNote)(0, true), 'You have no photos, videos or documents stored.', 'a completed read may say there are none');
ok(/^1 file\./.test((0, dataExport_1.filesRowNote)(1, true)), 'one file is singular');
ok(/^4 files\./.test((0, dataExport_1.filesRowNote)(4, true)), 'and four are not');
// A count over an incomplete read is the same defect as `"workouts": []` over a
// refused one, and this is the screen where that defect was found.
const short = (0, dataExport_1.filesRowNote)(3, false);
ok(!/^3 files/.test(short), 'a count is not asserted over a read that came back short');
ok(/may be short/.test(short), 'and the shortness is said out loud');
ok(/Export again/.test(short), 'with something to do about it');
/* ── a save that did not happen ────────────────────────────────────────── */
const generic = (0, dataExport_1.saveFileFailure)(null);
ok(/still stored on your account/.test(generic), 'a failed save says nothing was lost');
ok(/nothing has been lost/.test(generic), 'in as many words');
eq((0, dataExport_1.saveFileFailure)('This version of the app can’t attach files.'), 'This version of the app can’t attach files.', 'a build that cannot attach a file at all says THAT, rather than sending somebody to try the next file');
/* ── what the export claims to contain ─────────────────────────────────── */
ok(/money/.test(dataExport_1.EXPORT_ROW_NOTE), 'the row names the money, which is what it used to omit');
ok(/bookings/.test(dataExport_1.EXPORT_ROW_NOTE), 'and the bookings');
ok(/files/.test(dataExport_1.EXPORT_ROW_NOTE), 'and the files');
// It promises a LIST of files, not the files. The bytes are saved separately
// and the row must not imply otherwise.
ok(/list of your files/.test(dataExport_1.EXPORT_ROW_NOTE), 'and it promises a list of files, not the files themselves');
/* ── the incomplete warning ────────────────────────────────────────────── */
const warn = (0, dataExport_1.incompleteExportLine)(['gym_payments', 'charges'], 'support@example.com');
ok(/2 parts/.test(warn), 'the count is stated');
ok(/gym_payments, charges/.test(warn), 'and the parts are NAMED — "3 parts" tells nobody whether their payments are in it');
ok(/do not delete your account/.test(warn), 'and it says not to delete the account on the strength of it');
ok(/support@example\.com/.test(warn), 'and where to write, from the brand rather than hardcoded');
ok(/1 part /.test((0, dataExport_1.incompleteExportLine)(['charges'], 'a@b.c')), 'one part is singular');
const many = (0, dataExport_1.incompleteExportLine)(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'a@b.c');
ok(/and 2 more/.test(many), 'a long list is trimmed rather than filling the alert');
ok(/8 parts/.test(many), 'though the true count is still stated');
/* ── the deletion screen, which said nothing at all about the files ────── */
ok(/progress photographs/.test(dataExport_1.DELETION_FILES_NOTE), 'the photographs are named');
ok(/messages/.test(dataExport_1.DELETION_FILES_NOTE), 'and the message attachments');
ok(/injury documents/.test(dataExport_1.DELETION_FILES_NOTE), 'and the injury documents, which are the ones only they can see');
// The one this sentence used to leave out. Since parts 1120 and 1152 were
// applied it is in the same position as the message attachments and the injury
// documents — on the queue — but naming two of the three would still read as a
// claim about the third, so all four stay named.
ok(/profile photo/.test(dataExport_1.DELETION_FILES_NOTE), 'and the profile photo, which used to have no mechanism at all');
// Parts 1120 and 1152 are applied. `object_purge`'s check constraint, read live
// on 3 Sep 2026, names six buckets — injury-docs, message-media, avatars,
// coach-logos, coach-docs, exercise-videos — and `purge-account-files` drains
// it at `2-59/5 * * * *`. So "queued" is now the true word where "on request"
// used to be.
ok(/on a queue/.test(dataExport_1.DELETION_FILES_NOTE), 'and says what actually happens to them now — a queue, not an email');
ok(/queued for deletion the moment the account goes/.test(dataExport_1.DELETION_FILES_NOTE), 'and when they join it, which is before the profile row is gone rather than whenever somebody gets round to it');
// The whole point of the rewrite. A queued row is a request that has been SENT.
// `purged_at` is stamped only from a Storage reply that says the object is
// absent, so the note may claim the confirmation and must not claim the deletion.
ok(/until the file store confirms/.test(dataExport_1.DELETION_FILES_NOTE), 'the queue is described by what it actually confirms');
ok(/asked to be deleted and deleted are not the same claim/.test(dataExport_1.DELETION_FILES_NOTE), 'and the difference between sending a delete and having one is said out loud, not implied');
// The alarm (part 1153, `4 9 * * *`) RAISES, which makes a stalled queue a red
// run in cron.job_run_details. It emails nobody. "We are alerted" would be the
// overclaim; "somewhere we look" is what is true.
ok(/more than a day/.test(dataExport_1.DELETION_FILES_NOTE), 'a stalled queue is said to be checked, with the threshold named');
ok(/somewhere we look/.test(dataExport_1.DELETION_FILES_NOTE), 'and the check is described as a log we read, not as an alert that reaches a person');
ok(!/we are alerted|we are notified|alerts us|notifies us|paged/i.test(dataExport_1.DELETION_FILES_NOTE), 'because nobody is paged and the note must not suggest otherwise');
// `gym-docs` is NOT in object_purge's check constraint and is not going to be
// until somebody makes a per-country retention decision (part 1152 § 6;
// gym_documents.member_id is `on delete set null`, so the erasure severs the
// only link to the member). Omitting it would make the sentence above read as
// "every file of yours goes", which is the overclaim this whole note exists to
// avoid.
ok(/stays with the gym/.test(dataExport_1.DELETION_FILES_NOTE), 'the one store that is NOT purged is named rather than left out of a sentence about your files');
ok(/differs by country/.test(dataExport_1.DELETION_FILES_NOTE), 'and it is named as an undecided retention question rather than as a policy');
ok(/Export and save your files first/.test(dataExport_1.DELETION_FILES_NOTE), 'and tells them the one thing they can do before it is too late');
ok(!/immediately deleted|permanently erased at once/.test(dataExport_1.DELETION_FILES_NOTE), 'and promises no erasure it cannot perform');
/* ── and the coach's version, which has one fact that is not a file ────── */
// A coach holds four file stores a member does not. Part 1152 is applied and
// all four are now on the queue — three by name in object_purge's check
// constraint, and their half of message-media because
// queue_account_object_purges() matches the second path segment too. They stay
// named one by one: a coach reading this wants to see their own clips in it.
for (const thing of ['logo', 'document you published', 'exercise clip', 'profile photo']) {
    ok(dataExport_1.COACH_DELETION_FILES_NOTE.includes(thing), `the coach note names their ${thing}`);
}
ok(/on a queue/.test(dataExport_1.COACH_DELETION_FILES_NOTE), 'and says those go on the same queue rather than by email');
ok(/until the file store confirms/.test(dataExport_1.COACH_DELETION_FILES_NOTE), 'and holds the same line about what is confirmed as the member note');
// The consequential one. Verified against the live catalogue on 3 Sep 2026:
// coach_document_acceptances.document_id and coach_document_recipients
// .document_id are STILL ON DELETE RESTRICT onto coach_documents — part 1151
// deliberately did not touch them. What it added is
// trg_profiles_release_coach_documents, a BEFORE DELETE trigger on profiles,
// which is now the only thing that can release an acceptance.
ok(/accepted/.test(dataExport_1.COACH_DELETION_FILES_NOTE), 'and it says what an accepted document does to the deletion');
ok(/completes on its own/.test(dataExport_1.COACH_DELETION_FILES_NOTE), 'in the words of what actually happens now — it runs, rather than raising 23503 and rolling back');
ok(/the only thing that can release those acceptances/.test(dataExport_1.COACH_DELETION_FILES_NOTE), 'and says it is the ONE route, because the RESTRICT keys still refuse every other caller');
ok(/takes the record that your clients accepted your document with it/.test(dataExport_1.COACH_DELETION_FILES_NOTE), 'and states the cost of that route rather than only its convenience');
// Neither note may turn a queued send into a completed deletion. `purged_at` is
// stamped only from a Storage reply that confirms the object is absent (parts
// 1120 § 4 and 1152 § 4), so an unqualified "your files are automatically
// deleted" is a claim about the reply, not about the request.
for (const note of [dataExport_1.DELETION_FILES_NOTE, dataExport_1.COACH_DELETION_FILES_NOTE]) {
    ok(!/(are|is) (automatically|immediately) (removed|deleted|erased)|(removed|deleted|erased) (automatically|immediately)/i.test(note), `no note turns a sent delete into a finished one — ${note.slice(0, 60)}`);
    ok(/not the same claim/.test(note), `and both say which of the two they are making — ${note.slice(0, 60)}`);
}
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('dataExport.test.ts — ok');
