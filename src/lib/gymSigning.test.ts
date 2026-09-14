// The member's end of the gym's paperwork. Compile with tsc, run with node.
//
// Three rules here are worth assertions, because all three are silent when they
// go wrong and all three are the defect this module exists to close:
//
//   · An unrecognised `attribution` becomes 'unknown', never 'staff' and never
//     'member'. Every signature in this product predates the column; if the
//     narrowing ever guessed, a database missing supabase/parts/520 would read
//     as a filing cabinet full of confidently-labelled records.
//   · `signAsMember` sends the id it read from the SESSION and nothing a caller
//     handed it, and sends neither `attribution` nor `witnessed_by`. A caller
//     able to set any of those three is the original bug wearing a new hat.
//   · `forMember` matches on the AGREEMENT ROW. Matching on the kind would tell
//     somebody they had signed a waiver whose current wording they had never
//     seen, which is the exact thing versions exist to prevent.
import {
  attributionOf, tallyAttribution, forMember, waitingOn, waitingCount,
  outstanding, blockedOn, agreementStanding, agreementSummary,
  signingBlocker, signAsMember, fetchGymAgreements, fetchMySignatures,
  ATTRIBUTION_LABEL, ATTRIBUTION_NOTE, GUARDIAN_REFUSAL, SIGNING_RULE,
  REVOCABLE_KINDS, MEMBER_REVOCABLE_KINDS, memberMayRevoke, revokedAtFor, inForce,
  mayWithdraw, withdrawBlocker, fetchMyRevocations, withdrawConsent, NO_REVOCATION_TABLE,
  withdrawnLine, isMissingRevocationTable,
  WITHDRAW_WHAT_IT_DOES, WITHDRAW_WHAT_IT_DOES_NOT, WITHDRAW_CANNOT_BE_UNDONE,
  WITHDRAW_UNAVAILABLE_NOTE,
  type MemberAgreement, type SignatureAttribution, type RevocationRead,
} from './gymSigning';
import type { Agreement, AgreementKind } from './gymDocs';

const { readFileSync, readdirSync } = require('node:fs') as {
  readFileSync: (p: string, enc: string) => string;
  readdirSync: (p: string) => string[];
};
const { join } = require('node:path') as { join: (...p: string[]) => string };

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── who a signature came from ─────────────────────────────────────────────── */

eq(attributionOf('member'), 'member', 'the member signing for themselves is carried through');
eq(attributionOf('staff'), 'staff', 'and so is a desk entry');
eq(attributionOf('unknown'), 'unknown', 'and so is a row from before this was recorded');

// The narrowing is the whole safety property. Anything it does not recognise —
// a NULL from a database this part has not been applied to, a typo, a value
// added later — is the state that MEANS "nothing recorded who typed this".
for (const junk of [null, undefined, '', 'MEMBER', 'gym', 0, {}, ['member']]) {
  eq(attributionOf(junk), 'unknown',
    `an unrecognised attribution (${JSON.stringify(junk)}) is unknown, never a claim about who signed`);
}

ok((['member', 'staff', 'unknown'] as SignatureAttribution[]).every((k) => ATTRIBUTION_LABEL[k] && ATTRIBUTION_NOTE[k]),
  'every attribution has words an owner reads, and a note saying what it is worth');
ok(ATTRIBUTION_NOTE.unknown.includes('not known'),
  'the unknown note says outright that it is not known, rather than implying a desk entry');

{
  const t = tallyAttribution([
    { attribution: 'staff' }, { attribution: 'staff' },
    { attribution: 'member' }, { attribution: 'unknown' },
  ]);
  eq(t.total, 4, 'the tally counts everything it was handed');
  eq(t.staff, 2, 'two of them were taken at the desk');
  eq(t.member, 1, 'one was given by the member');
  eq(t.unknown, 1, 'and one is unattributed');
  eq(t.member + t.staff + t.unknown, t.total, 'and the three parts are the whole');
  const empty = tallyAttribution([]);
  eq(empty.total, 0, 'a gym with no signatures tallies to nothing');
  eq(empty.member, 0, 'and nothing is not one member-signed');
}

/* ── what the gym is asking this member for ────────────────────────────────── */

const LONG = 'The member accepts that training carries risk, and that the gym is not liable for injury arising from their own choices.';

const agree = (o: Partial<Agreement> = {}): Agreement => ({
  id: 'a1', kind: 'waiver', title: 'Liability waiver', body: LONG,
  version: 1, active: true, required: true, createdAt: '2026-01-01T00:00:00Z', ...o,
});

const gave = (agreementId: string, attribution: SignatureAttribution = 'member') => ({
  agreementId, signedAt: '2026-02-01T10:00:00Z', signedName: 'Sara Ahmed', attribution,
});

{
  // The assertion this file exists for. Sara signed the OLD waiver; the gym has
  // since published a new one. Matching on the KIND would show it as signed and
  // she would train on wording she has never read.
  const v1 = agree({ id: 'w1', version: 1, active: false });
  const v2 = agree({ id: 'w2', version: 2, active: true });
  const rows = forMember([v1, v2], [gave('w1')]);

  eq(rows.length, 1, 'a retired version is not shown: the database will not accept a signature against it');
  eq(rows[0].id, 'w2', 'and the one shown is the version in force');
  eq(rows[0].signedAt, null, 'signing version 1 does not cover version 2');
  ok(waitingOn(rows[0]), 'so the new wording is still waiting on her');
  eq(waitingCount(rows), 1, 'and it counts as one thing outstanding');
}

{
  const w = agree({ id: 'w1' });
  const rows = forMember([w], [gave('w1', 'staff')]);
  eq(rows[0].signedAt, '2026-02-01T10:00:00Z', 'a desk entry is on file and the screen says so');
  eq(rows[0].attribution, 'staff', 'and it is carried through as a desk entry, not flattened to signed');
  eq(waitingOn(rows[0]), false, 'it is not asked for a second time — the gym does hold something');
  eq(rows[0].signedName, 'Sara Ahmed', 'and the name on it is the name that was given');
}

{
  // A guardian consent is an ADULT agreeing on behalf of a minor, and the minor
  // is the one holding the account. A member-side path that accepted it would
  // collect the wrong person's signature and file it as the right one.
  const g = agree({ id: 'g1', kind: 'guardian_consent', title: 'Guardian consent' });
  const rows = forMember([g], []);
  eq(rows[0].refusal, GUARDIAN_REFUSAL, 'a guardian consent cannot be given from the minor’s own account');
  eq(waitingOn(rows[0]), false,
    'and it is not counted as waiting on them: there is no button, so counting it sends somebody hunting for one');
  eq(waitingCount(rows), 0, 'nothing here is waiting on this member');

  // …and the line at the top of the screen must not say so. This is the one
  // that mattered: a sixteen-year-old read "Nothing is waiting on you" while
  // the consent supabase/parts/185 says the gym may not train them without was
  // unsigned, and turned up expecting to train.
  eq(outstanding(rows[0]), true, 'IT IS STILL AN UNSIGNED DOCUMENT THE GYM IS MISSING');
  eq(blockedOn(rows[0]), true, 'and it is unsigned by somebody other than this member');
  eq(JSON.stringify(agreementStanding(rows)), JSON.stringify({ waiting: 0, blocked: 1, outstanding: 1 }),
    'the count and the button are two different questions and now have two answers');
  const line = agreementSummary(rows);
  ok(!/Nothing is waiting on you/.test(line),
    'A MINOR IS NEVER TOLD THEY ARE CLEAR WHILE THE GUARDIAN CONSENT IS UNSIGNED');
  ok(/still unsigned/.test(line), 'the line says the document is unsigned');
  ok(/adult responsible for you/.test(line), 'and says who has to give it');
  ok(/in person at the gym/.test(line), 'and where');

  // Once it has actually been given at the desk, it is not outstanding at all.
  const given = forMember([g], [gave('g1', 'staff')]);
  eq(outstanding(given[0]), false, 'a guardian consent on file is not missing');
  eq(blockedOn(given[0]), false, 'and nobody is being waited on for it');
  eq(agreementSummary(given), 'Nothing is waiting on you.', 'so the screen may say so');
}

{
  // The three other shapes of the summary line.
  const g = agree({ id: 'g1', kind: 'guardian_consent', title: 'Guardian consent' });
  const w = agree({ id: 'w1', title: 'Liability waiver' });

  eq(agreementSummary(forMember([w], [gave('w1')])), 'Nothing is waiting on you.',
    'everything signed, and nobody else owes anything');
  eq(agreementSummary(forMember([w], [])), '1 document waiting on you.',
    'one the member can sign themselves reads as it always did');
  const both = agreementSummary(forMember([w, g], []));
  ok(/1 document waiting on you/.test(both), 'with both kinds outstanding, the member’s own is named first');
  ok(/1 more still unsigned/.test(both), 'and the one they cannot sign is named too');
  eq(JSON.stringify(agreementStanding(forMember([w, g], []))), JSON.stringify({ waiting: 1, blocked: 1, outstanding: 2 }),
    'and the standing is the two of them');

  // Plurals, because this line is read by somebody deciding whether to turn up.
  const g2 = agree({ id: 'g2', kind: 'guardian_consent', title: 'Photo consent (guardian)' });
  ok(/2 documents your gym asks for are still unsigned/.test(agreementSummary(forMember([g, g2], []))),
    'two of them read as two');
  ok(/they can only be given/.test(agreementSummary(forMember([g, g2], []))),
    'and the pronoun follows the count');
}

{
  // Unsigned first, then required before optional. What is waiting on the
  // reader is what the screen is for.
  const rows = forMember(
    [
      agree({ id: 'done', title: 'Membership terms', kind: 'terms' }),
      agree({ id: 'opt', title: 'Photo consent', kind: 'photo_consent', required: false }),
      agree({ id: 'must', title: 'Liability waiver' }),
    ],
    [gave('done')],
  );
  eq(rows.map((r) => r.id).join(','), 'must,opt,done',
    'the required unsigned one is first, the optional unsigned one next, and what is done is last');
}

/* ── what stops a signature being given ────────────────────────────────────── */

const pending = (o: Partial<MemberAgreement> = {}): MemberAgreement => ({
  id: 'w1', kind: 'waiver', title: 'Liability waiver', body: LONG, version: 2,
  required: true, signedAt: null, signedName: null, attribution: null, refusal: null,
  revocable: false, revokedAt: null, ...o,
});

eq(signingBlocker(pending(), 'Sara Ahmed', true, true), null,
  'read it, ticked it, typed a name: that is a signature');

ok(signingBlocker(pending(), 'Sara Ahmed', true, false) != null,
  'agreeing to a document you have not opened is not agreeing to anything');
ok(signingBlocker(pending(), 'Sara Ahmed', false, true) != null,
  'and neither is a name with no agreement beside it');
ok(signingBlocker(pending(), '', true, true) != null,
  'the name is the signature, so there is no signature without one');
ok(signingBlocker(pending(), '   ', true, true) != null, 'and whitespace is not a name');
ok(signingBlocker(pending(), 'S', true, true) != null, 'nor is a single letter');

eq(signingBlocker(pending({ refusal: GUARDIAN_REFUSAL }), 'Sara Ahmed', true, true), GUARDIAN_REFUSAL,
  'a refusal outranks everything else, and says why in the words the member reads');
ok(signingBlocker(pending({ signedAt: '2026-02-01T10:00:00Z' }), 'Sara Ahmed', true, true) != null,
  'and a version already signed is not offered again');

ok(SIGNING_RULE.includes('cannot be edited'),
  'the sentence shown before the tap says the record cannot be edited, because it cannot');

/* ── the write, which is where the original defect lived ───────────────────── */
//
// Wrapped in an async IIFE and not left at the top level: these files are
// compiled as CommonJS and run under plain `node`, where a top-level await does
// not exist. Same shape as gymDocAccess.test.ts, and the reporting moves inside
// with it so a failure in here still exits non-zero.

/** A Supabase stand-in that records what it was asked to insert. */
function fakeClient(uid: string | null) {
  const inserted: any[] = [];
  const selects: any[] = [];
  const client: any = {
    auth: { getUser: async () => ({ data: uid ? { user: { id: uid } } : { user: null }, error: null }) },
    from(table: string) {
      const q: any = {
        insert: async (row: any) => { inserted.push({ table, row }); return { error: null }; },
        select: (cols: string) => { selects.push({ table, cols, filters: [] as string[] }); return q; },
        eq: (col: string) => { selects[selects.length - 1].filters.push(col); return q; },
        order: () => q,
        limit: async () => ({ data: [], error: null }),
      };
      return q;
    },
  };
  return { client, inserted, selects };
}

void (async () => {
{
  const { client, inserted } = fakeClient('uid-sara');
  await signAsMember(client, 'tenant-1', { agreementId: 'w2', version: 2, signedName: '  Sara Ahmed  ' });

  eq(inserted.length, 1, 'one row is written');
  const row = inserted[0].row;
  eq(inserted[0].table, 'gym_agreement_signatures', 'to the signatures table');
  eq(row.member_id, 'uid-sara',
    'attributed to the account the SESSION reports, which is the one fact a caller cannot forge');
  eq(row.signed_name, 'Sara Ahmed', 'the name is trimmed but otherwise exactly what was typed');
  eq(row.version_signed, 2, 'and it is pinned to the version that was on screen');

  // The three columns whose absence is the whole fix. An app that could set any
  // of them could write "the member signed this" about somebody who did not.
  ok(!('attribution' in row),
    'attribution is NOT sent: it is derived in the database from auth.uid(), and an app that could set it is the original defect one level up');
  ok(!('witnessed_by' in row),
    'no witness is sent: the person signing is the person here, and a witness beside a member signature would be staff attesting to something they were not present for');
  ok(!('signed_by' in row),
    'and the writer is not sent either — supabase/parts/520 stamps it, so it cannot be claimed');
}

{
  // Signed out. There is no account to attribute this to, so nothing is written
  // — as opposed to a row landing under whatever id the caller passed.
  const { client, inserted } = fakeClient(null);
  let threw = false;
  try {
    await signAsMember(client, 'tenant-1', { agreementId: 'w2', version: 2, signedName: 'Sara Ahmed' });
  } catch { threw = true; }
  ok(threw, 'signing with no session is refused');
  eq(inserted.length, 0, 'and nothing is written — a signature with nobody behind it is not a signature');
}

{
  // The read of "what have I signed" sends no member id at all. It is the RLS
  // policy that scopes it, so there is no argument through which one member
  // could ask for another's.
  const { client, selects } = fakeClient('uid-sara');
  await fetchMySignatures(client);
  eq(selects.length, 1, 'one read');
  eq(selects[0].filters.length, 0,
    'and it filters on nothing: the session decides whose signatures these are, not a caller-supplied id');
  ok(selects[0].cols.includes('attribution'),
    'and it reads the attribution, because a signature whose origin is not read renders as one whose origin is not recorded');
}

{
  // The agreements read is scoped to the gym and to what is LIVE. A member
  // cannot usefully sign a retired version — supabase/parts/520 narrowed the
  // insert policy to active ones — and showing one would offer a button that
  // the database refuses.
  const { client, selects } = fakeClient('uid-sara');
  await fetchGymAgreements(client, 'tenant-1');
  eq(selects[0].filters.join(','), 'tenant_id,active',
    'the agreements read is scoped to this gym and to the version in force');
  ok(selects[0].cols.includes('body'),
    'and it reads the BODY: a signing screen without the wording on it records agreement to a document nobody was shown');
}

/* ── withdrawing a consent ─────────────────────────────────────────────────── */
//
// `SIGNING_RULE` has promised since part 185 that "withdrawing consent later is
// a new record, not the quiet disappearance of this one", and until
// supabase/parts/3030 there was no such record anywhere in the product — no
// table, no policy, no control. These assertions are on the four things that
// are silent when they go wrong:
//
//   · WHICH kinds may be withdrawn. An unrevocable photo consent is the defect;
//     a revocable waiver would let somebody train in a building whose insurer
//     believes it holds a current one. The lists are cross-checked against the
//     CHECK constraint in the part, because two lists that can drift will.
//   · The ORDERING against the signature. "Has this ever been revoked" would
//     leave a member who withdrew and then changed their mind unable to consent
//     to anything again.
//   · The absent table reads as 'absent' and nothing else reads as 'absent'.
//     The part is applied to this project's database and to no other, so a read
//     that assumed the table existed would take the paperwork screen down for
//     every member of every gym that has not had it — and a read that FAILED
//     must never be mistaken for a member who has withdrawn nothing.
//   · The copy says what withdrawing does NOT do. A control implying a deletion
//     it cannot perform is worse than no control.

eq(REVOCABLE_KINDS.includes('photo_consent'), true,
  'photo consent can be withdrawn — a progress photograph is somebody’s body and last year’s yes is not consent for ever');
eq(REVOCABLE_KINDS.includes('waiver'), false,
  'a liability waiver cannot: it is a condition of entry, and withdrawing it while the membership runs means training in a building with no current one');
eq(REVOCABLE_KINDS.includes('terms'), false,
  'nor the membership terms — withdrawing those is ending the membership, which has a notice period and a final invoice attached');
eq(REVOCABLE_KINDS.includes('contract'), false, 'nor the membership agreement, for the same reason');
eq(REVOCABLE_KINDS.includes('par_q'), false,
  'nor the health questionnaire: it is a declaration of fact at a moment, superseded by a newer one and never un-given');

eq(memberMayRevoke('photo_consent'), true, 'and photo consent is the member’s own to withdraw');
eq(REVOCABLE_KINDS.includes('guardian_consent'), true,
  'a guardian consent CAN be withdrawn — by the adult who gave it');
eq(memberMayRevoke('guardian_consent'), false,
  'but never from the minor’s own account: a decision that was never the account-holder’s to make does not become theirs on the way out');
ok(MEMBER_REVOCABLE_KINDS.every((k) => REVOCABLE_KINDS.includes(k)),
  'and nothing is member-revocable without being revocable at all, which would be a control the database refuses');

{
  // The lists and the CHECK constraint are the same rule written twice, and the
  // failure is asymmetric: a kind in the CHECK and not here is a right nobody
  // is offered, and a kind here and not in the CHECK is a 23514 under a
  // member's thumb. So the part is read rather than trusted.
  // Relative to the repo root, the way gymDocAccess.test.ts reads part 390:
  // these run from there under `node .tmp/...`, where __dirname points into the
  // build output and not at the source tree.
  const PARTS = join('supabase', 'parts');
  const file = readdirSync(PARTS).find((f) => /^3030-/.test(f));
  ok(file != null, 'the revocation part is on disk under the number it was written as');
  if (file) {
    const sql = readFileSync(join(PARTS, file), 'utf8');
    const m = /check \(kind in \(([^)]*)\)\)/.exec(sql);
    ok(m != null, 'and its kind column carries a CHECK naming the revocable kinds');
    if (m) {
      const inSql = (m[1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, '')).sort();
      eq(inSql.join(','), [...REVOCABLE_KINDS].sort().join(','),
        'and the CHECK is exactly REVOCABLE_KINDS — a kind in one and not the other is either a refused write or an unoffered right');
    }
    // The member insert policy is the SHORTER list, and the guardian case is
    // the whole reason the two lists are not one.
    ok(/gym_agreement_revocations_own_i[\s\S]*?kind = 'photo_consent'/.test(sql),
      'the member insert policy admits photo consent alone, so a guardian consent cannot be taken from the minor’s phone');
    // The signature is untouched, and that is the property the whole part
    // exists to preserve. Asserted by absence, which is how it is implemented.
    ok(!/alter table public\.gym_agreement_signatures/.test(sql),
      'the part alters nothing on gym_agreement_signatures: somebody DID agree on that date and erasing it would falsify the record of the period before the withdrawal');
    ok(!/\bdelete from\b/i.test(sql) && !/\bupdate public\./i.test(sql),
      'and it deletes and updates nothing anywhere — a revocation is a second recorded fact, never an erasure');
    ok(/revoke update, delete on public\.gym_agreement_revocations from authenticated/.test(sql),
      'the withdrawal is itself immutable: a record the gym holding the consent could delete is a suggestion, not a withdrawal');
  }
}

{
  // The ordering. A withdrawal only undoes a signature it comes AFTER.
  const read = (rows: Array<{ kind: AgreementKind; revokedAt: string }>): RevocationRead =>
    ({ status: 'read', rows: rows.map((r) => ({ ...r, reason: null })) });

  eq(revokedAtFor('photo_consent', '2026-01-01T10:00:00Z', read([{ kind: 'photo_consent', revokedAt: '2026-03-01T10:00:00Z' }])),
    '2026-03-01T10:00:00Z', 'a withdrawal after the signature withdraws it');
  eq(revokedAtFor('photo_consent', '2026-06-01T10:00:00Z', read([{ kind: 'photo_consent', revokedAt: '2026-03-01T10:00:00Z' }])),
    null,
    'a withdrawal BEFORE the current signature does not: a member who withdrew and then changed their mind has consented, and the later signature is the one that counts');
  eq(revokedAtFor('photo_consent', '2026-01-01T10:00:00Z', read([{ kind: 'waiver', revokedAt: '2026-03-01T10:00:00Z' }])),
    null,
    'and a withdrawal of another kind reaches nothing — withdrawing photo consent is not withdrawing the waiver');
  eq(revokedAtFor('photo_consent', null, read([{ kind: 'photo_consent', revokedAt: '2026-03-01T10:00:00Z' }])),
    '2026-03-01T10:00:00Z', 'a withdrawal against an unsigned consent is still on the record and still shown');

  // Newest governs, whichever order the rows arrive in.
  eq(revokedAtFor('photo_consent', '2026-01-01T10:00:00Z', read([
    { kind: 'photo_consent', revokedAt: '2026-02-01T10:00:00Z' },
    { kind: 'photo_consent', revokedAt: '2026-05-01T10:00:00Z' },
  ])), '2026-05-01T10:00:00Z', 'the newest withdrawal governs, whatever order the rows came back in');

  // Offsets, not string order. '2026-03-01T00:30:00+05:00' is EARLIER than
  // '2026-02-28T23:00:00Z' as an instant and LATER as a string, and a lexical
  // compare would put a withdrawal on the wrong side of a signature.
  // '2026-03-01T00:30:00+05:00' is 2026-02-28T19:30Z — BEFORE the signature as
  // an instant, and AFTER it as a string. A lexical compare would read this as
  // a withdrawal of a consent given four hours later.
  eq(revokedAtFor('photo_consent', '2026-02-28T23:00:00Z', read([{ kind: 'photo_consent', revokedAt: '2026-03-01T00:30:00+05:00' }])),
    null, 'instants are compared as instants and never as strings: an offset on either side lands on the right side of the signature');

  // Both degraded cases resolve towards the withdrawal. The two mistakes are
  // not symmetrical: a consent wrongly shown as withdrawn costs a photograph
  // that is not taken, and a withdrawal wrongly ignored costs a photograph of
  // somebody who asked for it to stop.
  eq(revokedAtFor('photo_consent', '2026-06-01T10:00:00Z', read([{ kind: 'photo_consent', revokedAt: 'not a date' }])),
    'not a date', 'a withdrawal nobody can place in time still counts as a withdrawal');
  eq(revokedAtFor('photo_consent', 'rubbish', read([{ kind: 'photo_consent', revokedAt: '2026-01-01T10:00:00Z' }])),
    '2026-01-01T10:00:00Z', 'and so does one that cannot be ordered against an unreadable signature');

  // A bare YYYY-MM-DD is refused rather than read as midnight UTC, which would
  // invent a time of day and order a real withdrawal by a fiction.
  eq(revokedAtFor('photo_consent', '2026-06-01T10:00:00Z', read([{ kind: 'photo_consent', revokedAt: '2026-01-01' }])),
    '2026-01-01',
    'a bare date is not parsed as midnight UTC: it cannot be placed in time, so it counts rather than being silently ordered by an invented hour');

  // And nothing at all under a table that is not there.
  eq(revokedAtFor('photo_consent', '2026-01-01T10:00:00Z', NO_REVOCATION_TABLE), null,
    'under a database this part has not reached, nothing is withdrawn — which is true, because nothing CAN have been');
}

{
  // forMember folds it in, and the three states are distinguishable.
  const photo: Agreement = {
    id: 'p1', kind: 'photo_consent', title: 'Photo consent', body: LONG, version: 1,
    active: true, required: false, createdAt: '2026-01-01T00:00:00Z',
  };
  const sig = [{ agreementId: 'p1', signedAt: '2026-01-02T10:00:00Z', signedName: 'Sara Ahmed', attribution: 'member' as SignatureAttribution }];

  const standing = forMember([photo], sig, { status: 'read', rows: [] })[0];
  eq(standing.revocable, true, 'a photo consent is marked revocable');
  eq(standing.revokedAt, null, 'nothing withdrawn');
  eq(inForce(standing), true, 'so the consent is in force');
  eq(mayWithdraw(standing, { status: 'read', rows: [] }), true, 'and a control is offered');
  eq(withdrawBlocker(standing, { status: 'read', rows: [] }), null, 'with nothing blocking it');

  const gone = forMember([photo], sig, {
    status: 'read', rows: [{ kind: 'photo_consent', revokedAt: '2026-04-01T10:00:00Z', reason: null }],
  })[0];
  eq(gone.revokedAt, '2026-04-01T10:00:00Z', 'a withdrawal is read back onto the row');
  eq(gone.signedAt, '2026-01-02T10:00:00Z',
    'and the SIGNATURE is still there beside it — both facts stand, which is the whole rule');
  eq(inForce(gone), false, 'the consent is not in force');
  eq(mayWithdraw(gone, { status: 'read', rows: [] }), false, 'and no second Withdraw button is offered on something already withdrawn');
  ok(withdrawBlocker(gone, { status: 'read', rows: [] }) == null
    || withdrawBlocker(gone, { status: 'read', rows: [] })!.includes('already'),
    'and asking again says it has already been done');

  // The default, and the state of every database today: absent. The screen must
  // keep working, and `signedAt` must keep meaning what it meant.
  const undeployed = forMember([photo], sig)[0];
  eq(undeployed.revokedAt, null, 'with no revocations table the consent reads as standing');
  eq(inForce(undeployed), true, 'which is the true answer, not an optimistic one: nothing can have been withdrawn');
  eq(mayWithdraw(undeployed, NO_REVOCATION_TABLE), false, 'but no control is drawn, because tapping it would 42P01 under the thumb');
  eq(withdrawBlocker(undeployed, NO_REVOCATION_TABLE), WITHDRAW_UNAVAILABLE_NOTE,
    'and the member is told the feature is not switched on rather than told they have never asked');

  // A waiver is not offered a withdrawal in any state.
  const waiver: Agreement = { ...photo, id: 'w1', kind: 'waiver', title: 'Liability waiver', required: true };
  const w = forMember([waiver], [{ ...sig[0], agreementId: 'w1' }], { status: 'read', rows: [] })[0];
  eq(w.revocable, false, 'a waiver is not revocable');
  eq(mayWithdraw(w, { status: 'read', rows: [] }), false, 'so no control is drawn beside it');
  ok((withdrawBlocker(w, { status: 'read', rows: [] }) ?? '').includes('membership'),
    'and the refusal sends the member to their gym about their membership rather than offering a switch');

  // A withdrawal of a kind the member cannot withdraw is still SHOWN to them.
  const guardian: Agreement = { ...photo, id: 'g1', kind: 'guardian_consent', title: 'Guardian consent', required: true };
  const g = forMember([guardian], [{ ...sig[0], agreementId: 'g1' }], {
    status: 'read', rows: [{ kind: 'guardian_consent', revokedAt: '2026-05-01T10:00:00Z', reason: null }],
  })[0];
  eq(g.revokedAt, '2026-05-01T10:00:00Z', 'a guardian consent withdrawn at the desk is read back');
  eq(inForce(g), false, 'and is not in force');
  eq(mayWithdraw(g, { status: 'read', rows: [] }), false, 'though the minor was never the one who could withdraw it');
  eq(withdrawBlocker(g, { status: 'read', rows: [] }), GUARDIAN_REFUSAL,
    'and the refusal is the same sentence that refuses the signing, for the same reason');
}

ok(/does not delete/i.test(WITHDRAW_WHAT_IT_DOES_NOT),
  'the copy says outright that withdrawing deletes nothing — a control implying a deletion it cannot perform is worse than no control');
ok(/already taken/i.test(WITHDRAW_WHAT_IT_DOES_NOT),
  'and names the photographs that already exist, which is the thing a member actually wants to know');
ok(/ask your gym/i.test(WITHDRAW_WHAT_IT_DOES_NOT),
  'and points at the separate request that would get pictures taken down, rather than leaving somebody to assume this was it');
ok(/stays|remain/i.test(WITHDRAW_WHAT_IT_DOES_NOT),
  'and says the original agreement stays on the record, so nobody believes this rewrote history');
ok(/from now on/i.test(WITHDRAW_WHAT_IT_DOES),
  'while the other half says plainly what DOES change, and that it is forward-looking');
ok(/give consent again/i.test(WITHDRAW_CANNOT_BE_UNDONE),
  'and changing your mind back is a fresh signature, not an undo of the withdrawal');
ok(!/delete/i.test(WITHDRAW_WHAT_IT_DOES) && !/remove/i.test(WITHDRAW_WHAT_IT_DOES),
  'and the half that says what happens never once says delete or remove');
ok(!/you have not/i.test(WITHDRAW_UNAVAILABLE_NOTE),
  'the unavailable note makes no claim about this member at all — it is a fact about the gym’s database');
ok(/next version|tell your gym/i.test(WITHDRAW_CANNOT_BE_UNDONE),
  'and giving consent again says WHERE: the unique index in part 185 is on (agreement, member), so re-signing the same version is refused and a member sent looking for a button would find a document they have already agreed to');

/* ── whose calendar the withdrawal date is drawn on ────────────────────────── */
//
// `revoked_at` is a `timestamptz`. It is an instant, so the date under it is a
// CHOICE of calendar, and the sentence beside it — "your signature from before
// that date" — is what makes the wrong choice expensive rather than untidy.
// UTC's day is nobody's: it moves a late evening in Auckland onto tomorrow and
// an early morning in Honolulu onto yesterday, and the member reading it is the
// person whose act it was.
//
// `npm test` runs this file under six timezones for exactly this assertion. The
// instant below is half an hour before midnight UTC, which is the next day in
// every zone east of Greenwich and the same day west of it.
{
  const at = '2026-04-01T23:30:00Z';
  const line = withdrawnLine(at);
  const local = new Date(at);
  ok(line.startsWith('Withdrawn on '), 'a withdrawal that can be placed in time says when');
  ok(new RegExp(`(^|\\D)${local.getDate()}(\\D|$)`).test(line),
    `the day is the READER's: this instant is the ${local.getDate()} where this test is running, and the line says ${JSON.stringify(line)}`);
  ok(line.includes(String(local.getFullYear())), 'and the year comes from the same reading');
  ok(!/\d{4}-\d{2}-\d{2}/.test(line),
    'and it is formatted for somebody to read rather than handed over as a column value — which is also what a UTC toISOString().slice would leave behind');
}
{
  // Both halves of "could not be read", and neither invents a date. A bare
  // `YYYY-MM-DD` is refused rather than parsed: `Date.parse` reads one as
  // midnight UTC, which would invent a time of day and then print a day that
  // was never in the column.
  for (const junk of ['not a date', '2026-04-01', '']) {
    const line = withdrawnLine(junk);
    ok(/could not be read/.test(line), `an unreadable revocation date (${JSON.stringify(junk)}) says so`);
    ok(/does not have your consent/.test(line),
      'and still says the consent is withdrawn, because that part is not in doubt');
    ok(!/\d/.test(line), 'and no digit of an invented date appears anywhere in it');
  }
}

/* ── the screen the control is actually on ─────────────────────────────────── */
//
// Read from disk, the way the CHECK constraint above is. Two exports with a
// test and no caller are a feature that does nothing, and the withdrawal spent
// a release in exactly that state; but the sharper reason is the regression
// found by mutating `mayWithdraw` — a screen that decides whether to draw the
// button from the ROW alone draws a live control on every photo consent in the
// product, and every one of those taps is a 42P01 under a member's thumb while
// part 3030 has not reached that gym. The button has to be asked of the READ.
{
  const screen = readFileSync(join('app', '(client)', 'agreements.tsx'), 'utf8');
  ok(/fetchMyRevocations\(/.test(screen),
    'the member’s paperwork screen reads what they have withdrawn');
  ok(/withdrawConsent\(/.test(screen),
    'and can write one, which is the whole of what part 3030 was for');
  ok(/mayWithdraw\(/.test(screen),
    'and the control is drawn from mayWithdraw, which is withdrawBlocker returning null and is therefore false while the table is absent');
  ok(/withdrawnLine\(/.test(screen),
    'and a consent already withdrawn says so on the row rather than reading as live');
  // Interpolated, not merely imported: `/WITHDRAW_WHAT_IT_DOES_NOT/` matched the
  // import line, so it went on passing with the sentence dropped from the
  // dialog — which is the one place it has to be, since after the write the
  // member has already been told the thing they might mistake for a deletion.
  for (const c of ['WITHDRAW_WHAT_IT_DOES', 'WITHDRAW_WHAT_IT_DOES_NOT', 'WITHDRAW_CANNOT_BE_UNDONE']) {
    ok(screen.includes('${' + c + '}'),
      `and ${c} is put in front of the member BEFORE the write rather than imported and left unsaid`);
  }
}

/* ── the revocation read and write ──────────────────────────────────────────── */

/** A Supabase stand-in for the revocations table, with an injectable failure. */
function fakeRevoke(uid: string | null, o: {
  readError?: { code?: string; message?: string } | null;
  rows?: any[];
  insertError?: { code?: string } | null;
  insertReturns?: any[] | null;
} = {}) {
  const inserted: any[] = [];
  const selects: any[] = [];
  const client: any = {
    auth: { getUser: async () => ({ data: uid ? { user: { id: uid } } : { user: null }, error: null }) },
    from(table: string) {
      const q: any = {
        insert: (row: any) => {
          inserted.push({ table, row });
          return {
            select: async () => ({
              data: o.insertError ? null : (o.insertReturns ?? [{ id: 'rev-1' }]),
              error: o.insertError ?? null,
            }),
          };
        },
        select: (cols: string) => { selects.push({ table, cols, filters: [] as string[] }); return q; },
        eq: (col: string) => { selects[selects.length - 1].filters.push(col); return q; },
        order: () => q,
        limit: async () => ({ data: o.readError ? null : (o.rows ?? []), error: o.readError ?? null }),
      };
      return q;
    },
  };
  return { client, inserted, selects };
}

{
  // The read, working.
  const { client, selects } = fakeRevoke('uid-sara', {
    rows: [{ kind: 'photo_consent', revoked_at: '2026-04-01T10:00:00Z', reason: '  ' }],
  });
  const read = await fetchMyRevocations(client);
  eq(read.status, 'read', 'a table that answers gives a read');
  eq(selects[0].table, 'gym_agreement_revocations', 'from the revocations table');
  eq(selects[0].filters.length, 0,
    'and it filters on nothing: the RLS policy is member_id = auth.uid(), so no argument exists through which one member could ask for another’s');
  if (read.status === 'read') {
    eq(read.rows.length, 1, 'one withdrawal');
    eq(read.rows[0].reason, null, 'and a whitespace-only reason is null, not a reason nobody can read');
  }
}

{
  // WHICH CODE A MISSING TABLE ACTUALLY IS, asserted on the narrowing directly
  // so a failure names the rule rather than arriving as a rejected promise.
  //
  // This was wrong, and wrong in the direction that takes the screen down. A
  // table PostgREST does not hold in its schema cache is refused by PostgREST,
  // which never reaches Postgres, so the Postgres code for an undefined
  // relation is never produced. Probed against this project's own API with the
  // anon key on 13 Sep 2026: a table that does not exist answers PGRST205, and
  // a column that does not exist on a table that does answers 42703. The
  // tolerance was written around 42P01 alone — a code that arrives only over a
  // warm cache — so every deployment without part 3030 would have taken the
  // paperwork screen down on the read written to survive exactly that.
  eq(isMissingRevocationTable({ code: 'PGRST205' }), true,
    'PGRST205 is a database without the part: PostgREST answers it from its schema cache and Postgres is never asked');
  eq(isMissingRevocationTable({ code: '42P01' }), true,
    'and 42P01 is the same fact over a warm cache, which is the window during a rollback');
  for (const e of [
    { code: '42501' }, { code: '42703' }, { code: 'PGRST301' }, { code: '57014' },
    { code: undefined }, { message: 'Network request failed' }, null, undefined, new Error('offline'),
  ]) {
    eq(isMissingRevocationTable(e), false,
      `and ${JSON.stringify((e as any)?.code ?? e)} is NOT a missing table: a refusal, a missing column, a dead session or a dead network read as "the feature is off" is a member told their gym has not switched withdrawal on when nobody asked the database anything`);
  }
}

{
  // THE TOLERANCE, through the read. Part 3030 is applied to this project's
  // database now, so this is no longer the path a member here takes; it is the
  // path every deployment without the part takes, and "the feature is not
  // deployed" is a true statement about a database in which no consent CAN have
  // been withdrawn. It must not take the paperwork screen down.
  for (const code of ['PGRST205', '42P01']) {
    const { client } = fakeRevoke('uid-sara', { readError: { code, message: `no such table (${code})` } });
    let threw = false;
    let read: RevocationRead | null = null;
    try { read = await fetchMyRevocations(client); } catch { threw = true; }
    ok(!threw, `a table absent with ${code} does not throw: the screen whose job is to show what a member has not signed must not go down because a later part is unapplied`);
    eq(read?.status, 'absent', `and ${code} is reported as absent rather than as an empty list of withdrawals`);
  }
}

{
  // And ONLY those two. A read that failed on the wire, or was refused, is not
  // a member who has withdrawn nothing — and the difference is whether a gym
  // goes on publishing photographs of somebody who asked it to stop.
  for (const code of ['42501', '42703', '57014', 'PGRST301', undefined]) {
    const { client } = fakeRevoke('uid-sara', { readError: { code, message: 'no' } });
    let threw = false;
    try { await fetchMyRevocations(client); } catch { threw = true; }
    ok(threw, `a read that failed with ${String(code)} throws — a failed read is not an empty list, and here it would read as a live consent`);
  }
}

{
  // The write. Same discipline as signAsMember.
  const { client, inserted } = fakeRevoke('uid-sara');
  await withdrawConsent(client, 'tenant-1', { kind: 'photo_consent', reason: '  I would rather not be filmed.  ' });
  eq(inserted.length, 1, 'one row is written');
  eq(inserted[0].table, 'gym_agreement_revocations', 'to the revocations table');
  const row = inserted[0].row;
  eq(row.member_id, 'uid-sara', 'attributed to the account the SESSION reports, never an argument');
  eq(row.kind, 'photo_consent', 'scoped to the kind of consent');
  eq(row.reason, 'I would rather not be filmed.', 'the reason is trimmed and otherwise kept as written');
  ok(!('revoked_at' in row),
    'the moment is NOT sent: it defaults to now() in the database, so nothing can backdate a withdrawal to before a signature or postdate one that has not happened');
  ok(!('agreement_id' in row),
    'and no agreement id is sent — the withdrawal is scoped to the kind, so publishing a new version of the document cannot silently clear it');
  ok(!('id' in row), 'nor an id it could choose');
}

{
  // A reason nobody gave is null, not an empty string the console renders as a
  // blank quotation.
  const { client, inserted } = fakeRevoke('uid-sara');
  await withdrawConsent(client, 'tenant-1', { kind: 'photo_consent' });
  eq(inserted[0].row.reason, null,
    'no reason is null: a member withdrawing consent to be photographed owes nobody an explanation');
}

{
  // The guardian case is refused in the app, BEFORE the write, because the
  // policy would refuse it silently by narrowing the insert to zero rows.
  const { client, inserted } = fakeRevoke('uid-minor');
  let msg = '';
  try { await withdrawConsent(client, 'tenant-1', { kind: 'guardian_consent' }); } catch (e) { msg = String((e as Error).message); }
  eq(msg, GUARDIAN_REFUSAL, 'a minor withdrawing their own guardian consent is refused in the same words the signing is');
  eq(inserted.length, 0, 'and nothing is attempted — the policy would have refused it silently, which is worse than an error');
}

{
  // An unrevocable kind never reaches the database either.
  const { client, inserted } = fakeRevoke('uid-sara');
  let threw = false;
  try { await withdrawConsent(client, 'tenant-1', { kind: 'waiver' }); } catch { threw = true; }
  ok(threw, 'withdrawing a liability waiver is refused');
  eq(inserted.length, 0, 'and writes nothing: a withdrawn waiver is somebody training in a building with no current one');
}

{
  // Signed out: nothing to attribute it to, so nothing is written.
  const { client, inserted } = fakeRevoke(null);
  let threw = false;
  try { await withdrawConsent(client, 'tenant-1', { kind: 'photo_consent' }); } catch { threw = true; }
  ok(threw, 'withdrawing with no session is refused');
  eq(inserted.length, 0, 'and nothing is written');
}

{
  // The zero-row insert. RLS narrowing a write to nothing SUCCEEDS, and the
  // house rule is that success is never claimed from the absence of an error —
  // here that would be a member told their consent was withdrawn while their
  // gym goes on holding a live one.
  const { client } = fakeRevoke('uid-sara', { insertReturns: [] });
  let threw = false;
  try { await withdrawConsent(client, 'tenant-1', { kind: 'photo_consent' }); } catch { threw = true; }
  ok(threw, 'an insert that stored nothing is reported as not recorded, never as done');
}

if (errors.length) {
  console.error(`gymSigning: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymSigning ok');
})();
