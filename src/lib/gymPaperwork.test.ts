// The paperwork, the filing cabinet, and one member's own file. Compile with
// tsc, run with node.
//
// Two rules here are the ones worth having assertions for, because both are
// silent when they go wrong:
//
//   · Signing version 1 does not cover version 2. If `outstandingFor` ever
//     matched on the KIND rather than on the agreement row, republishing terms
//     would quietly leave everybody looking signed up, and the gym would be
//     operating on consent nobody had given to the current wording.
//   · A member export is scoped by the right FIELD on every table. A one-to-one
//     names the client and a pass names its holder, and filtering the wrong one
//     hands a subject-access request either everything the gym has ever done or
//     nothing at all.
import {
  agreementBlocker, signatureBlocker, nextVersion, outstandingFor,
  documentBlocker, documentPath, expiring, MAX_DOCUMENT_BYTES,
  AGREEMENT_KINDS, AGREEMENT_LABEL, DOCUMENT_KINDS, DOCUMENT_LABEL,
  type Agreement, type Signature, type GymDocument,
} from './gymDocs';
import { memberSlices, memberRowCount, MEMBER_PARTS, type GymExportInput } from './gymExport';
import { sliceReady, sliceFailed, sliceLoading } from './memberView';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── publishing something to sign ──────────────────────────────────────────── */

const LONG = 'The member accepts that training carries risk, and that the gym is not liable for injury arising from their own choices.';

eq(agreementBlocker('Liability waiver', LONG), null, 'a titled document with real words in it can be published');
ok(agreementBlocker('', LONG) != null, 'an untitled one cannot be found on a list');
ok(agreementBlocker('Waiver', '') != null, 'and an empty one is not something anybody can agree to');
ok(agreementBlocker('Waiver', 'By signing you agree.') != null,
  'a one-line summary is refused: this is the document produced when it is disputed, and a summary of it is worth nothing');

ok(AGREEMENT_KINDS.every((k) => AGREEMENT_LABEL[k]), 'every kind has words an owner reads');
ok(DOCUMENT_KINDS.every((k) => DOCUMENT_LABEL[k]), 'and so does every document kind');

const agree = (o: Partial<Agreement> = {}): Agreement => ({
  id: 'a1', kind: 'waiver', title: 'Liability waiver', body: LONG,
  version: 1, active: true, required: true, createdAt: '2026-01-01T00:00:00Z', ...o,
});

eq(nextVersion([], 'waiver'), 1, 'the first publication of a kind is version 1');
eq(nextVersion([agree()], 'waiver'), 2, 'the next is 2');
eq(nextVersion([agree({ version: 1 }), agree({ id: 'a2', version: 7, active: false })], 'waiver'), 8,
  'and it is one past the HIGHEST, not one past the live one — a retired version 7 still owns that number');
eq(nextVersion([agree()], 'terms'), 1, 'a different kind numbers from 1 of its own');

/* ── who has signed what ───────────────────────────────────────────────────── */

const sig = (agreementId: string, memberId: string, version = 1): Signature => ({
  id: `s-${agreementId}-${memberId}`, agreementId, memberId, memberName: null,
  signedName: 'Sara Ahmed', signedAt: '2026-02-01T10:00:00Z', versionSigned: version,
  guardianName: null, guardianRelationship: null, note: null,
});

{
  const members = [
    { memberId: 'm1', memberName: 'Sara' },
    { memberId: 'm2', memberName: 'Bo' },
  ];
  const waiverV1 = agree({ id: 'w1', version: 1, active: false });
  const waiverV2 = agree({ id: 'w2', version: 2, active: true });
  const photo = agree({ id: 'p1', kind: 'photo_consent', title: 'Photo consent', required: false });

  // The assertion this section exists for. Sara signed the OLD waiver; the gym
  // has since republished it. She is outstanding, and if this ever matched on
  // kind rather than on the agreement row she would silently read as covered.
  const out = outstandingFor(members, [waiverV1, waiverV2, photo], [sig('w1', 'm1')]);
  eq(out.length, 2, 'both members are outstanding on the live waiver');
  ok(out.every((o) => o.missing.some((a) => a.id === 'w2')),
    'signing version 1 does not cover version 2 — which is the entire reason versions exist');
  ok(out.every((o) => !o.missing.some((a) => a.id === 'w1')),
    'and a RETIRED version is not outstanding: nobody is asked to sign something withdrawn');
  ok(out.every((o) => !o.missing.some((a) => a.id === 'p1')),
    'an optional agreement is never outstanding — photo consent is not a condition of training');

  eq(outstandingFor(members, [waiverV2, photo], [sig('w2', 'm1'), sig('w2', 'm2')]).length, 0,
    'everybody signed the live version, so nobody is outstanding');
  eq(outstandingFor(members, [], []).length, 0,
    'a gym that requires nothing has nobody outstanding — which is not a clean bill of health, and the screen says so');
}

eq(signatureBlocker('m1', 'Sara Ahmed', 'waiver', ''), null, 'a name and a member is a signature');
ok(signatureBlocker('', 'Sara Ahmed', 'waiver', '') != null, 'a signature has to be by somebody');
ok(signatureBlocker('m1', '', 'waiver', '') != null,
  'the name they signed with IS the signature, and it is kept apart from their account name on purpose');
ok(signatureBlocker('m1', 'Sara Ahmed', 'guardian_consent', '') != null,
  'a guardian consent with no adult named records only that somebody typed something');
eq(signatureBlocker('m1', 'Sara Ahmed', 'guardian_consent', 'Dana Ahmed'), null, 'named, and it stands');

/* ── the filing cabinet ────────────────────────────────────────────────────── */

const file = (o: Partial<{ name: string; size: number; type: string }> = {}) =>
  ({ name: 'schedule.pdf', size: 400_000, type: 'application/pdf', ...o });

eq(documentBlocker('Insurance 2026', file()), null, 'a titled PDF under the limit is filed');
ok(documentBlocker('', file()) != null, 'a bucket full of IMG_4471.jpg is a folder, not a record');
ok(documentBlocker('Insurance', null) != null, 'and a title with no file is not a document');
ok(documentBlocker('Insurance', file({ size: 0 })) != null, 'an empty file is not evidence of anything');
ok(documentBlocker('Insurance', file({ size: MAX_DOCUMENT_BYTES + 1 })) != null,
  'past the bucket’s own limit it would be refused after the upload, which is a slower way to find out');
ok(documentBlocker('Insurance', file({ type: 'application/zip' })) != null, 'the bucket takes PDFs and images');
eq(documentBlocker('Insurance', file({ type: '' })), null,
  'a browser that states no type is not refused — the bucket will decide, and refusing here would block a real file over a missing header');

{
  const a = documentPath('T1', 'insurance schedule.pdf');
  const b = documentPath('T1', 'insurance schedule.pdf');
  ok(a.startsWith('T1/'), 'the first path segment is the TENANT — the storage policy reads exactly that');
  ok(a !== b, 'two files of the same name do not collide: an owner is not told their certificate already exists');
  ok(!a.includes(' '), 'spaces are not left in an object key');
  ok(documentPath('T1', '../../etc/passwd').startsWith('T1/'),
    'a path somebody typed cannot climb out of its own tenant folder');
}

{
  const doc = (o: Partial<GymDocument>): GymDocument => ({
    id: 'd1', memberId: null, memberAttached: false, equipmentId: null, kind: 'insurance', title: 'Insurance',
    storagePath: 'T1/x', mime: 'application/pdf', sizeBytes: 1, expiresOn: null, note: null,
    uploadedBy: null, uploadedByName: null, uploadedAt: '2026-01-01T00:00:00Z', ...o,
  });
  const rows = [
    doc({ id: 'lapsed', expiresOn: '2026-07-01' }),
    doc({ id: 'soon', expiresOn: '2026-09-10' }),
    doc({ id: 'later', expiresOn: '2027-01-01' }),
    doc({ id: 'never', expiresOn: null }),
  ];
  const soon = expiring(rows, '2026-08-26');
  eq(soon.map((d) => d.id).join(','), 'lapsed,soon',
    'expired and expiring-within-30-days, oldest first — a lapsed insurance schedule is a gym trading uninsured, not a filing problem');
  ok(!soon.some((d) => d.id === 'never'),
    'a document with no expiry is not expiring: null means it does not expire, or nobody has said');
}

/* ── one member's own file ─────────────────────────────────────────────────── */

{
  const base: GymExportInput = {
    gymName: 'Iron House', tenantId: 'T1', generatedAt: '2026-08-26T08:00:00.000Z',
    plans: sliceReady([{ id: 'pl1', name: 'Monthly', priceCents: 6000, currency: 'GBP', interval: 'month', active: true }]),
    memberships: sliceReady([
      { id: 'ms1', memberId: 'm1', memberName: 'Sara', planId: 'pl1', planName: 'Monthly', startedOn: '2025-01-01', endsOn: null, status: 'active' },
      { id: 'ms2', memberId: 'm2', memberName: 'Bo', planId: null, planName: null, startedOn: '2025-06-01', endsOn: null, status: 'active' },
    ]),
    payments: sliceReady([
      { id: 'p1', memberId: 'm1', memberName: 'Sara', amountCents: 6000, currency: 'GBP', method: 'card', takenAt: '2026-08-01T00:00:00Z', note: null, kind: 'payment', reversesPaymentId: null, invoiceId: null, membershipId: 'ms1' },
      { id: 'p2', memberId: 'm2', memberName: 'Bo', amountCents: 6000, currency: 'GBP', method: 'card', takenAt: '2026-08-01T00:00:00Z', note: null, kind: 'payment', reversesPaymentId: null, invoiceId: null, membershipId: 'ms2' },
    ]),
    classes: sliceReady([]),
    attendance: sliceReady([
      { bookingId: 'b1', memberId: 'm1', classId: 'c1', classTitle: 'Spin', startsAt: '2026-08-02T06:00:00Z', status: 'booked', attendedAt: null },
    ]),
    // A one-to-one names the CLIENT. Filtering on `trainerId` here would hand a
    // member every session the gym ran; filtering on a member field that does
    // not exist would hand them none.
    sessions: sliceReady([
      { id: 's1', trainerId: 't1', trainerName: 'Ana', clientId: 'm1', clientName: 'Sara', startsAt: '2026-08-03T09:00:00Z', durationMin: 60, status: 'booked', outcome: 'completed', outcomeAt: null, rateCents: 4500, settlementId: null, packDrawnKind: null, packDrawnAt: null, packDrawShortfallAt: null, },
      { id: 's2', trainerId: 't1', trainerName: 'Ana', clientId: 'm2', clientName: 'Bo', startsAt: '2026-08-03T10:00:00Z', durationMin: 60, status: 'booked', outcome: 'completed', outcomeAt: null, rateCents: 4500, settlementId: null, packDrawnKind: null, packDrawnAt: null, packDrawShortfallAt: null, },
    ]),
    passTypes: sliceReady([]),
    passes: sliceReady([
      { id: 'pa1', passTypeId: null, passTypeName: null, kind: null, holderId: 'm1', holderName: 'Sara', hostMemberId: null, issuedOn: '2026-05-01', expiresOn: null, usesTotal: 10, usesSpent: 2, paidCents: null, currency: null, note: null } as any,
      // A guest pass BOUGHT BY m1 for somebody else. It is part of their record
      // even though they are not its holder.
      { id: 'pa2', passTypeId: null, passTypeName: null, kind: null, holderId: 'guest', holderName: null, hostMemberId: 'm1', issuedOn: '2026-06-01', expiresOn: null, usesTotal: 1, usesSpent: 0, paidCents: null, currency: null, note: null } as any,
    ]),
    visits: sliceReady([
      { id: 'v1', memberId: 'm1', memberName: 'Sara', passId: null, classId: null, enteredAt: '2026-08-04T06:00:00Z', exitedAt: null, source: 'door', note: null },
      { id: 'v2', memberId: null, memberName: null, passId: null, classId: null, enteredAt: '2026-08-04T07:00:00Z', source: 'door', exitedAt: null, note: null },
    ]),
    invites: sliceReady([
      { id: 'iv1', tenantId: 'T1', email: 'sara@example.com', fullName: 'Sara', planId: null, planName: null, invitedBy: null, token: null, status: 'accepted', createdAt: '2024-12-01T00:00:00Z', expiresAt: null, acceptedAt: '2025-01-01T00:00:00Z', acceptedBy: 'm1' } as any,
    ]),
    invoices: sliceReady([
      { id: 'i1', number: 1, memberId: 'm1', memberName: 'Sara', membershipId: 'ms1', amountCents: 6000, currency: 'GBP', issuedOn: '2026-08-01', dueOn: '2026-08-31', status: 'paid', note: null },
      { id: 'i2', number: 2, memberId: 'm2', memberName: 'Bo', membershipId: 'ms2', amountCents: 6000, currency: 'GBP', issuedOn: '2026-08-01', dueOn: '2026-08-31', status: 'open', note: null },
    ]),
    settlements: sliceReady([
      { id: 'st1', trainerId: 't1', trainerName: 'Ana', periodFrom: '2026-08-01', periodTo: '2026-08-31', amountCents: 9000, currency: 'GBP', sessionsCount: 2, method: 'transfer', settledAt: '2026-09-01T00:00:00Z', reversedAt: null, reverseReason: null },
    ]),
    equipment: sliceReady([
      { id: 'e1', name: 'Rower', category: 'rower', identifier: null, quantity: 2, status: 'in_service', purchasedOn: null, serviceIntervalDays: null, lastServicedOn: null, note: null },
    ]),
    shifts: sliceReady([
      { id: 'sh1', trainerId: 't1', trainerName: 'Ana', startsAt: '2026-08-04T06:00:00Z', endsAt: '2026-08-04T14:00:00Z', role: 'floor', status: 'scheduled', note: null },
    ]),
    interventions: sliceReady([
      { id: 'in1', memberId: 'm1', memberName: 'Sara', channel: 'call', outcome: 'reached', byId: null, byName: 'Ana', note: 'checked in', at: '2026-07-01T00:00:00Z' },
    ]),
    promos: sliceReady([{ id: 'pr1', code: 'SUMMER', discount: 20, active: true, redemptions: 4, createdAt: null }]),
    events: sliceReady([
      { id: 'ev1', kind: 'member-joined', summary: 'Sara joined the gym', subjectId: 'm1', actorId: null, at: '2025-01-01T00:00:00Z' },
      { id: 'ev2', kind: 'member-joined', summary: 'Bo joined the gym', subjectId: 'm2', actorId: null, at: '2025-06-01T00:00:00Z' },
    ]),
    purchases: sliceReady([
      { id: 'cp1', trainerId: 't1', trainerName: 'Ana', clientId: 'm1', amountCents: 60000, currency: 'gbp', sessionsTotal: 10, sessionsUsed: 3, status: 'paid', createdAt: '2026-04-01T00:00:00Z' },
    ]),
  };

  const mine = memberSlices(base, 'm1');
  const rows = (k: keyof GymExportInput) => {
    const s = (mine as any)[k];
    return s.state === 'ready' ? s.rows.length : -1;
  };

  eq(rows('memberships'), 1, 'their membership, not everybody’s');
  eq(rows('payments'), 1, 'their payments');
  eq(rows('invoices'), 1, 'their invoices');
  eq(rows('attendance'), 1, 'their bookings');
  eq(rows('sessions'), 1, 'their one-to-ones — matched on the CLIENT, which is who a session names');
  eq(rows('passes'), 2, 'a pass they hold AND a guest pass they bought for somebody else');
  eq(rows('visits'), 1, 'their door entries, and not the anonymous one');
  eq(rows('invites'), 1, 'the invitation they accepted');
  eq(rows('interventions'), 1, 'the record that somebody contacted them');
  eq(rows('purchases'), 1, 'the PT pack they bought');
  eq(rows('events'), 1, 'the log entries about them, matched on the subject');

  // The gym's own record belongs to nobody. Including it would hand a
  // subject-access request the gym's whole commercial position.
  eq(rows('plans'), 0, 'the price book is the gym’s, not this member’s');
  eq(rows('equipment'), 0, 'and so is the equipment register');
  eq(rows('shifts'), 0, 'and the rota');
  eq(rows('promos'), 0, 'and the promo codes');
  eq(rows('settlements'), 0, 'and what the gym paid its staff');

  // 1 membership + 1 payment + 1 invoice + 1 booking + 1 session + 2 passes
  // + 1 visit + 1 invite + 1 contact + 1 pack + 1 event.
  eq(memberRowCount(base, 'm1'), 12, 'twelve rows across the record');
  eq(memberRowCount(base, 'm9'), 0, 'a person this gym holds nothing about is a real zero, and the screen says so');

  // One unreadable part makes the COUNT unknown rather than smaller. A smaller
  // number reads as "this member has little on file", which is the sentence an
  // owner would put in a covering letter.
  const broken: GymExportInput = { ...base, payments: sliceFailed('timeout') };
  eq(memberRowCount(broken, 'm1'), null, 'one failed read makes the total unknown, never smaller');
  const pending: GymExportInput = { ...base, invoices: sliceLoading() };
  eq(memberRowCount(pending, 'm1'), null, 'and so does one that has not returned');

  // A failed read stays failed after scoping: "we could not read the invoices"
  // is still true of this member's invoices.
  eq((memberSlices(broken, 'm1').payments as any).state, 'failed',
    'a refused read is still refused when narrowed to one person — it does not become an empty file');

  ok(MEMBER_PARTS.every((p) => p !== 'plans' && p !== 'equipment' && p !== 'shifts' && p !== 'promos'),
    'the member parts list and the scoping agree about what belongs to a person');
}

if (errors.length) {
  console.error(`gymPaperwork: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('gymPaperwork ok');
