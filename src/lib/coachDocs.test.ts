// A coach's own paperwork. Compile with tsc, run with node.
//
// Two things are guarded here and they pull against each other.
//
// The first is that this feature must never blur into part 84. Repple's
// liability release is the client's legal record and the coach cannot read it;
// this is the coach's own studio waiver and the coach very much can. Two
// documents, two owners, two rules — and the sentence the client reads has to
// say which one they are looking at, because a member who thinks Repple wrote
// their coach's waiver will take a dispute to the wrong party.
//
// The second is that an acceptance is evidence, so nothing may promise what the
// database will not keep. There is no un-accept: no UPDATE policy, no DELETE
// policy, no grant behind either. The wording is asserted against that, because
// an app that offers to withdraw an acceptance has misdescribed the thing
// somebody agreed to.
import {
  COACH_DOC_ACCEPT_RULE, COACH_DOC_IMMUTABLE_NOTE, COACH_DOC_NOT_REPPLE,
  COACH_DOC_REACH_NOTE, DOC_MIME_TYPES, MAX_DOC_BYTES, checkUpload, coachDocPath,
  docLine, docState, extForMime, isCoachDocPath, isUuid, ownerOfPath,
  outstanding, outstandingCount, shapeDocs, sizeLabel, slugify, standingLine,
  uploadRefusalLine, type CoachDoc, type RawCoachDoc,
} from './coachDocs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const COACH = 'e5135000-0000-0000-0000-0000000000a1';
const OTHER = 'e5135000-0000-0000-0000-0000000000b1';

/* ── The object key the storage policies read ─────────────────────────────── */

// `can_read_coach_doc((storage.foldername(name))[1])` is the whole of who can
// open a document, so the first segment IS the permission. A key built with the
// wrong one uploads into a folder the coach cannot read back.
{
  const path = coachDocPath({
    coachId: COACH, filename: 'Studio Waiver 2026.PDF', mime: 'application/pdf',
    millis: 1756666000000, token: 'Ab3-9xQ',
  });
  eq(path, `${COACH}/1756666000000-Ab39xQ-studio-waiver-2026.pdf`, 'the key is built to the documented shape');
  ok(isCoachDocPath(path, COACH), 'and validates as this coach’s');
  ok(!isCoachDocPath(path, OTHER), 'and not as another coach’s — that is the 403 this check turns into a sentence');
  eq(ownerOfPath(path), COACH, 'the owner reads back off the key');
}
eq(coachDocPath({ coachId: COACH, filename: 'x.docx', mime: 'application/msword', millis: 1, token: 't' }), null,
  'a type the bucket refuses produces no key at all, rather than one that 400s on upload');
eq(coachDocPath({ coachId: 'not-a-uuid', filename: 'x.pdf', mime: 'application/pdf', millis: 1, token: 't' }), null,
  'and neither does a coach id that is not one');

eq(isCoachDocPath(`${COACH}/a/b.pdf`, COACH), false, 'a key with a third segment is not our shape');
eq(isCoachDocPath(`${COACH}/`, COACH), false, 'and neither is a folder with no file in it');
eq(isCoachDocPath('waiver.pdf', COACH), false, 'nor a bare filename with no folder — which is the 403 case');
eq(isCoachDocPath(null, COACH), false, 'a missing path is not a valid one');
eq(ownerOfPath('nonsense/x.pdf'), null, 'a folder that is not a uuid owns nothing');
// The policy compares text, and Postgres uuid text is lower case. A key built
// from an upper-case id would be refused by storage and by nothing else.
ok(isCoachDocPath(`${COACH.toUpperCase()}/f.pdf`, COACH), 'case does not change whose folder it is');

eq(slugify('Par-Q & You (2026).pdf'), 'par-q-you-2026', 'a filename becomes a safe slug');
eq(slugify('...'), 'document', 'and a name that is entirely punctuation still gets one');
eq(slugify(null), 'document', 'as does no name at all');
ok(slugify('x'.repeat(200)).length <= 48, 'a very long name is cut rather than making an unbounded key');

eq(extForMime('application/pdf'), 'pdf', 'a pdf is a pdf');
eq(extForMime('image/jpeg'), 'jpg', 'a photograph of the page is a jpg');
eq(extForMime('application/msword'), null, 'a Word document is not something a client can sign on a phone');
eq(DOC_MIME_TYPES.length, 3, 'three types, matching the bucket’s allowed_mime_types');

/* ── Refused before any bytes move ────────────────────────────────────────── */

eq(checkUpload({ filename: 'w.pdf', mime: 'application/pdf', bytes: 84211 }).ok, true, 'an ordinary waiver uploads');
{
  const r = checkUpload({ filename: 'w.docx', mime: 'application/msword', bytes: 10 });
  eq(r.ok, false, 'a Word document does not');
  eq(r.ok === false && r.reason, 'type', 'and the reason is its type');
}
{
  const r = checkUpload({ filename: 'w.pdf', mime: 'application/pdf', bytes: MAX_DOC_BYTES + 1 });
  eq(r.ok === false && r.reason, 'size', 'one byte over the bucket limit is refused HERE, not by a 413');
}
eq(checkUpload({ filename: 'w.pdf', mime: 'application/pdf', bytes: MAX_DOC_BYTES }).ok, true,
  'and exactly the limit is fine — the check is the same > the database uses');
eq(checkUpload({ filename: 'w.pdf', mime: 'application/pdf', bytes: 0 }).ok === false
  && (checkUpload({ filename: 'w.pdf', mime: 'application/pdf', bytes: 0 }) as any).reason, 'empty',
  'an empty file is nothing to ask anybody to accept');
eq(checkUpload({ filename: '  ', mime: 'application/pdf', bytes: 10 }).ok === false
  && (checkUpload({ filename: '  ', mime: 'application/pdf', bytes: 10 }) as any).reason, 'name',
  'and a nameless one has nothing to file it under');
eq(MAX_DOC_BYTES, 10485760, 'the limit matches the bucket and coach_documents_bytes_chk');

// Four refusals, four sentences. "That didn't work" is the line this replaces.
{
  const lines = (['type', 'size', 'empty', 'name'] as const).map(uploadRefusalLine);
  eq(new Set(lines).size, 4, 'each refusal says something different');
  ok(lines.every((l) => l.length > 30), 'and each says enough to act on');
  ok(/10\.0 MB/.test(uploadRefusalLine('size')), 'the size refusal names the limit');
}

eq(sizeLabel(84211), '82 KB', 'a waiver reads in kilobytes');
eq(sizeLabel(2202009), '2.1 MB', 'a scan reads in megabytes');
eq(sizeLabel(512), '512 B', 'and a tiny file in bytes');
eq(sizeLabel(0), '—', 'an unknown size is a dash, never a confident 0 B');
eq(sizeLabel(null), '—', 'and so is a missing one');

/* ── Which paperwork is outstanding ───────────────────────────────────────── */

const doc = (over: Partial<CoachDoc> = {}): CoachDoc => ({
  id: 'd1', coachId: COACH, title: 'Studio Waiver', path: `${COACH}/1-a-studio-waiver.pdf`,
  mime: 'application/pdf', bytes: 84211, required: true, retired: false,
  createdAt: '2026-08-31T18:00:00Z', acceptedAt: null, ...over,
});

eq(outstanding(doc()), true, 'a required document nobody has accepted is outstanding');
eq(outstanding(doc({ acceptedAt: '2026-08-31T18:49:59Z' })), false, 'an accepted one is not');
eq(outstanding(doc({ required: false })), false, 'nor is one the coach only asks you to read');
eq(outstanding(doc({ retired: true })), false, 'nor one the coach has withdrawn');
eq(outstandingCount([doc(), doc({ id: 'd2', required: false }), doc({ id: 'd3' })]), 2, 'two of three are outstanding');
eq(outstandingCount([]), 0, 'and none of none');

eq(docState(doc()), 'must-accept', 'required and unsigned');
eq(docState(doc({ acceptedAt: '2026-08-31T18:49:59Z' })), 'accepted', 'signed');
eq(docState(doc({ required: false })), 'optional', 'there to read');
eq(docState(doc({ retired: true })), 'withdrawn', 'withdrawn');
// An accepted document that was later retired still reads as accepted. It is
// the record that matters, and the client keeps the right to read what they
// agreed to — `coach_documents_client_r` shows it to them for that reason.
eq(docState(doc({ retired: true, acceptedAt: '2026-08-31T18:49:59Z' })), 'accepted',
  'retiring does not un-accept anything');

ok(/read and accept/i.test(docLine(doc())), 'an outstanding document asks');
ok(/^Accepted /.test(docLine(doc({ acceptedAt: '2026-08-31T18:49:59Z' }))), 'an accepted one is dated');
ok(/no acceptance needed/i.test(docLine(doc({ required: false }))), 'an optional one says so');
ok(/Withdrawn/.test(docLine(doc({ retired: true }))), 'a withdrawn one says so');

/* ── Reading the list back ────────────────────────────────────────────────── */

const raw = (over: Partial<RawCoachDoc> = {}): RawCoachDoc => ({
  id: 'd1', coach_id: COACH, title: '  Studio Waiver  ', path: `${COACH}/1-a-w.pdf`,
  mime: 'application/pdf', bytes: 84211, required: true, retired: false,
  created_at: '2026-08-31T18:00:00Z', accepted_at: null, ...over,
});

eq(shapeDocs(null).length, 0, 'no rows shape to nothing');
eq(shapeDocs([]).length, 0, 'and an empty read is empty rather than a crash');
eq(shapeDocs([raw()])[0].title, 'Studio Waiver', 'a padded title is trimmed');
eq(shapeDocs([raw({ bytes: '84211' as any })])[0].bytes, 84211, 'a bigint arriving as a string is a number');
{
  const shaped = shapeDocs([
    raw({ id: 'signed', accepted_at: '2026-08-20T00:00:00Z' }),
    raw({ id: 'optional', required: false }),
    raw({ id: 'todo' }),
  ]);
  eq(shaped[0].id, 'todo', 'what is still outstanding sorts to the top — it is the only actionable row');
  eq(shaped.length, 3, 'and nothing is dropped on the way');
}

eq(standingLine(4, 9), '4 of 9 of your clients have accepted this', 'the coach’s summary counts both sides');
eq(standingLine(9, 9), 'All 9 of your clients have accepted this', 'and says so plainly when everyone has');
eq(standingLine(0, 0), null, 'a coach with no clients gets no line, not "0 of 0"');
eq(standingLine(0, Number.NaN), null, 'and an uncountable roster gets none either — that is not a fact about anybody');

/* ── The two things this feature must never misrepresent ──────────────────── */

// Part 84 stays part 84.
ok(/your coach’s own paperwork, not Repple’s/i.test(COACH_DOC_NOT_REPPLE),
  'the client is told whose document this is');
ok(/separate thing that your coach cannot read/i.test(COACH_DOC_NOT_REPPLE),
  'and that the Repple release is separate and remains unreadable to their coach');
ok(!/liability_waivers/.test(COACH_DOC_NOT_REPPLE), 'without naming a table at somebody');

// There is no un-accept, so nothing offers one.
ok(/can’t be edited or withdrawn/i.test(COACH_DOC_ACCEPT_RULE), 'accepting is described as permanent');
ok(/by you or by them/i.test(COACH_DOC_ACCEPT_RULE), 'for both parties, which is what the missing policies mean');
ok(!/undo|un-accept|revoke|cancel your acceptance/i.test(COACH_DOC_ACCEPT_RULE),
  'and nothing in it offers a way back the database does not have');

// Re-issuing is a new document, which is part 84's "add a row" in this shape.
ok(/Upload the new version and retire the old one/i.test(COACH_DOC_IMMUTABLE_NOTE),
  'the coach is told how to re-issue amended paperwork');
ok(/keeps that record/i.test(COACH_DOC_IMMUTABLE_NOTE),
  'and that retiring does not erase anybody’s acceptance');

// Who can open the file, said plainly.
ok(/Nobody else at the gym/i.test(COACH_DOC_REACH_NOTE), 'no owner branch, and the copy says so');
// The regex used to stop at "moves to another coach loses access", under the
// message "that is what the policy actually does" — while the sentence went on
// to say "except what they accepted", which the policy does NOT do. The
// unasserted tail was the false half, so the assertion vouched for a promise it
// never read. `can_read_coach_doc` has no acceptance branch: when
// `clients.trainer_id` moves, every document goes, accepted or not.
ok(/lose access to all of it, including anything they accepted/i.test(COACH_DOC_REACH_NOTE),
  'a leaver loses the accepted documents too — the copy must not promise an exception the policy has no branch for');
ok(!/except what they accepted/i.test(COACH_DOC_REACH_NOTE),
  'and must not carry the old exception, which was borrowed from the RETIRED-document rule inside a live relationship');

eq(isUuid(COACH), true, 'a uuid is a uuid');
eq(isUuid('e5135000-0000-0000-0000'), false, 'and a truncated one is not');
eq(isUuid(null), false, 'nor is nothing');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`coachDocs: ok (${DOC_MIME_TYPES.length} accepted types, limit ${sizeLabel(MAX_DOC_BYTES)})`);
