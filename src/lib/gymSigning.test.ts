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
  signingBlocker, signAsMember, fetchGymAgreements, fetchMySignatures,
  ATTRIBUTION_LABEL, ATTRIBUTION_NOTE, GUARDIAN_REFUSAL, SIGNING_RULE,
  type MemberAgreement, type SignatureAttribution,
} from './gymSigning';
import type { Agreement } from './gymDocs';

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
  required: true, signedAt: null, signedName: null, attribution: null, refusal: null, ...o,
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

if (errors.length) {
  console.error(`gymSigning: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymSigning ok');
})();
