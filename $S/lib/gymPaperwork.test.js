"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const gymDocs_1 = require("./gymDocs");
const gymExport_1 = require("./gymExport");
const memberView_1 = require("./memberView");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── publishing something to sign ──────────────────────────────────────────── */
const LONG = 'The member accepts that training carries risk, and that the gym is not liable for injury arising from their own choices.';
eq((0, gymDocs_1.agreementBlocker)('Liability waiver', LONG), null, 'a titled document with real words in it can be published');
ok((0, gymDocs_1.agreementBlocker)('', LONG) != null, 'an untitled one cannot be found on a list');
ok((0, gymDocs_1.agreementBlocker)('Waiver', '') != null, 'and an empty one is not something anybody can agree to');
ok((0, gymDocs_1.agreementBlocker)('Waiver', 'By signing you agree.') != null, 'a one-line summary is refused: this is the document produced when it is disputed, and a summary of it is worth nothing');
ok(gymDocs_1.AGREEMENT_KINDS.every((k) => gymDocs_1.AGREEMENT_LABEL[k]), 'every kind has words an owner reads');
ok(gymDocs_1.DOCUMENT_KINDS.every((k) => gymDocs_1.DOCUMENT_LABEL[k]), 'and so does every document kind');
const agree = (o = {}) => ({
    id: 'a1', kind: 'waiver', title: 'Liability waiver', body: LONG,
    version: 1, active: true, required: true, createdAt: '2026-01-01T00:00:00Z', ...o,
});
eq((0, gymDocs_1.nextVersion)([], 'waiver'), 1, 'the first publication of a kind is version 1');
eq((0, gymDocs_1.nextVersion)([agree()], 'waiver'), 2, 'the next is 2');
eq((0, gymDocs_1.nextVersion)([agree({ version: 1 }), agree({ id: 'a2', version: 7, active: false })], 'waiver'), 8, 'and it is one past the HIGHEST, not one past the live one — a retired version 7 still owns that number');
eq((0, gymDocs_1.nextVersion)([agree()], 'terms'), 1, 'a different kind numbers from 1 of its own');
/* ── who has signed what ───────────────────────────────────────────────────── */
const sig = (agreementId, memberId, version = 1) => ({
    id: `s-${agreementId}-${memberId}`, agreementId, memberId, memberName: null,
    signedName: 'Sara Ahmed', signedAt: '2026-02-01T10:00:00Z', versionSigned: version,
    guardianName: null, guardianRelationship: null, note: null, attribution: 'staff',
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
    const out = (0, gymDocs_1.outstandingFor)(members, [waiverV1, waiverV2, photo], [sig('w1', 'm1')]);
    eq(out.length, 2, 'both members are outstanding on the live waiver');
    ok(out.every((o) => o.missing.some((a) => a.id === 'w2')), 'signing version 1 does not cover version 2 — which is the entire reason versions exist');
    ok(out.every((o) => !o.missing.some((a) => a.id === 'w1')), 'and a RETIRED version is not outstanding: nobody is asked to sign something withdrawn');
    ok(out.every((o) => !o.missing.some((a) => a.id === 'p1')), 'an optional agreement is never outstanding — photo consent is not a condition of training');
    eq((0, gymDocs_1.outstandingFor)(members, [waiverV2, photo], [sig('w2', 'm1'), sig('w2', 'm2')]).length, 0, 'everybody signed the live version, so nobody is outstanding');
    eq((0, gymDocs_1.outstandingFor)(members, [], []).length, 0, 'a gym that requires nothing has nobody outstanding — which is not a clean bill of health, and the screen says so');
}
eq((0, gymDocs_1.signatureBlocker)('m1', 'Sara Ahmed', 'waiver', ''), null, 'a name and a member is a signature');
ok((0, gymDocs_1.signatureBlocker)('', 'Sara Ahmed', 'waiver', '') != null, 'a signature has to be by somebody');
ok((0, gymDocs_1.signatureBlocker)('m1', '', 'waiver', '') != null, 'the name they signed with IS the signature, and it is kept apart from their account name on purpose');
ok((0, gymDocs_1.signatureBlocker)('m1', 'Sara Ahmed', 'guardian_consent', '') != null, 'a guardian consent with no adult named records only that somebody typed something');
eq((0, gymDocs_1.signatureBlocker)('m1', 'Sara Ahmed', 'guardian_consent', 'Dana Ahmed'), null, 'named, and it stands');
/* ── the filing cabinet ────────────────────────────────────────────────────── */
const file = (o = {}) => ({ name: 'schedule.pdf', size: 400000, type: 'application/pdf', ...o });
eq((0, gymDocs_1.documentBlocker)('Insurance 2026', file()), null, 'a titled PDF under the limit is filed');
ok((0, gymDocs_1.documentBlocker)('', file()) != null, 'a bucket full of IMG_4471.jpg is a folder, not a record');
ok((0, gymDocs_1.documentBlocker)('Insurance', null) != null, 'and a title with no file is not a document');
ok((0, gymDocs_1.documentBlocker)('Insurance', file({ size: 0 })) != null, 'an empty file is not evidence of anything');
ok((0, gymDocs_1.documentBlocker)('Insurance', file({ size: gymDocs_1.MAX_DOCUMENT_BYTES + 1 })) != null, 'past the bucket’s own limit it would be refused after the upload, which is a slower way to find out');
ok((0, gymDocs_1.documentBlocker)('Insurance', file({ type: 'application/zip' })) != null, 'the bucket takes PDFs and images');
eq((0, gymDocs_1.documentBlocker)('Insurance', file({ type: '' })), null, 'a browser that states no type is not refused — the bucket will decide, and refusing here would block a real file over a missing header');
{
    const a = (0, gymDocs_1.documentPath)('T1', 'insurance schedule.pdf');
    const b = (0, gymDocs_1.documentPath)('T1', 'insurance schedule.pdf');
    ok(a.startsWith('T1/'), 'the first path segment is the TENANT — the storage policy reads exactly that');
    ok(a !== b, 'two files of the same name do not collide: an owner is not told their certificate already exists');
    ok(!a.includes(' '), 'spaces are not left in an object key');
    ok((0, gymDocs_1.documentPath)('T1', '../../etc/passwd').startsWith('T1/'), 'a path somebody typed cannot climb out of its own tenant folder');
}
{
    const doc = (o) => ({
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
    const soon = (0, gymDocs_1.expiring)(rows, '2026-08-26');
    eq(soon.map((d) => d.id).join(','), 'lapsed,soon', 'expired and expiring-within-30-days, oldest first — a lapsed insurance schedule is a gym trading uninsured, not a filing problem');
    ok(!soon.some((d) => d.id === 'never'), 'a document with no expiry is not expiring: null means it does not expire, or nobody has said');
}
/* ── one member's own file ─────────────────────────────────────────────────── */
{
    const base = {
        gymName: 'Iron House', tenantId: 'T1', generatedAt: '2026-08-26T08:00:00.000Z',
        plans: (0, memberView_1.sliceReady)([{ id: 'pl1', name: 'Monthly', priceCents: 6000, currency: 'GBP', interval: 'month', active: true }]),
        memberships: (0, memberView_1.sliceReady)([
            { id: 'ms1', memberId: 'm1', memberName: 'Sara', planId: 'pl1', planName: 'Monthly', startedOn: '2025-01-01', endsOn: null, status: 'active' },
            { id: 'ms2', memberId: 'm2', memberName: 'Bo', planId: null, planName: null, startedOn: '2025-06-01', endsOn: null, status: 'active' },
        ]),
        payments: (0, memberView_1.sliceReady)([
            { id: 'p1', memberId: 'm1', memberName: 'Sara', amountCents: 6000, currency: 'GBP', method: 'card', takenAt: '2026-08-01T00:00:00Z', note: null, kind: 'payment', reversesPaymentId: null, invoiceId: null, membershipId: 'ms1' },
            { id: 'p2', memberId: 'm2', memberName: 'Bo', amountCents: 6000, currency: 'GBP', method: 'card', takenAt: '2026-08-01T00:00:00Z', note: null, kind: 'payment', reversesPaymentId: null, invoiceId: null, membershipId: 'ms2' },
        ]),
        classes: (0, memberView_1.sliceReady)([]),
        attendance: (0, memberView_1.sliceReady)([
            { bookingId: 'b1', memberId: 'm1', classId: 'c1', classTitle: 'Spin', startsAt: '2026-08-02T06:00:00Z', status: 'booked', attendedAt: null },
        ]),
        // A one-to-one names the CLIENT. Filtering on `trainerId` here would hand a
        // member every session the gym ran; filtering on a member field that does
        // not exist would hand them none.
        sessions: (0, memberView_1.sliceReady)([
            { id: 's1', trainerId: 't1', trainerName: 'Ana', clientId: 'm1', clientName: 'Sara', startsAt: '2026-08-03T09:00:00Z', durationMin: 60, status: 'booked', outcome: 'completed', outcomeAt: null, rateCents: 4500, rateCurrency: null, settlementId: null, packDrawnKind: null, packDrawnAt: null, packDrawShortfallAt: null, },
            { id: 's2', trainerId: 't1', trainerName: 'Ana', clientId: 'm2', clientName: 'Bo', startsAt: '2026-08-03T10:00:00Z', durationMin: 60, status: 'booked', outcome: 'completed', outcomeAt: null, rateCents: 4500, rateCurrency: null, settlementId: null, packDrawnKind: null, packDrawnAt: null, packDrawShortfallAt: null, },
        ]),
        passTypes: (0, memberView_1.sliceReady)([]),
        passes: (0, memberView_1.sliceReady)([
            { id: 'pa1', passTypeId: null, passTypeName: null, kind: null, holderId: 'm1', holderName: 'Sara', hostMemberId: null, issuedOn: '2026-05-01', expiresOn: null, usesTotal: 10, usesSpent: 2, paidCents: null, currency: null, note: null },
            // A guest pass BOUGHT BY m1 for somebody else. It is part of their record
            // even though they are not its holder.
            { id: 'pa2', passTypeId: null, passTypeName: null, kind: null, holderId: 'guest', holderName: null, hostMemberId: 'm1', issuedOn: '2026-06-01', expiresOn: null, usesTotal: 1, usesSpent: 0, paidCents: null, currency: null, note: null },
        ]),
        visits: (0, memberView_1.sliceReady)([
            { id: 'v1', memberId: 'm1', memberName: 'Sara', passId: null, classId: null, enteredAt: '2026-08-04T06:00:00Z', exitedAt: null, source: 'door', note: null },
            { id: 'v2', memberId: null, memberName: null, passId: null, classId: null, enteredAt: '2026-08-04T07:00:00Z', source: 'door', exitedAt: null, note: null },
        ]),
        invites: (0, memberView_1.sliceReady)([
            { id: 'iv1', tenantId: 'T1', email: 'sara@example.com', fullName: 'Sara', planId: null, planName: null, invitedBy: null, token: null, status: 'accepted', createdAt: '2024-12-01T00:00:00Z', expiresAt: null, acceptedAt: '2025-01-01T00:00:00Z', acceptedBy: 'm1' },
        ]),
        invoices: (0, memberView_1.sliceReady)([
            { id: 'i1', number: 1, memberId: 'm1', memberName: 'Sara', membershipId: 'ms1', amountCents: 6000, currency: 'GBP', issuedOn: '2026-08-01', dueOn: '2026-08-31', status: 'paid', note: null },
            { id: 'i2', number: 2, memberId: 'm2', memberName: 'Bo', membershipId: 'ms2', amountCents: 6000, currency: 'GBP', issuedOn: '2026-08-01', dueOn: '2026-08-31', status: 'open', note: null },
        ]),
        settlements: (0, memberView_1.sliceReady)([
            { id: 'st1', trainerId: 't1', trainerName: 'Ana', periodFrom: '2026-08-01', periodTo: '2026-08-31', amountCents: 9000, currency: 'GBP', sessionsCount: 2, method: 'transfer', settledAt: '2026-09-01T00:00:00Z', reversedAt: null, reverseReason: null },
        ]),
        equipment: (0, memberView_1.sliceReady)([
            { id: 'e1', name: 'Rower', category: 'rower', identifier: null, quantity: 2, status: 'in_service', purchasedOn: null, serviceIntervalDays: null, lastServicedOn: null, note: null },
        ]),
        shifts: (0, memberView_1.sliceReady)([
            { id: 'sh1', trainerId: 't1', trainerName: 'Ana', startsAt: '2026-08-04T06:00:00Z', endsAt: '2026-08-04T14:00:00Z', role: 'floor', status: 'scheduled', note: null },
        ]),
        interventions: (0, memberView_1.sliceReady)([
            { id: 'in1', memberId: 'm1', memberName: 'Sara', channel: 'call', outcome: 'reached', byId: null, byName: 'Ana', note: 'checked in', at: '2026-07-01T00:00:00Z' },
        ]),
        promos: (0, memberView_1.sliceReady)([{ id: 'pr1', code: 'SUMMER', discount: 20, active: true, redemptions: 4, createdAt: null }]),
        events: (0, memberView_1.sliceReady)([
            { id: 'ev1', kind: 'member-joined', summary: 'Sara joined the gym', subjectId: 'm1', actorId: null, at: '2025-01-01T00:00:00Z' },
            { id: 'ev2', kind: 'member-joined', summary: 'Bo joined the gym', subjectId: 'm2', actorId: null, at: '2025-06-01T00:00:00Z' },
        ]),
        purchases: (0, memberView_1.sliceReady)([
            { id: 'cp1', trainerId: 't1', trainerName: 'Ana', clientId: 'm1', amountCents: 60000, currency: 'gbp', sessionsTotal: 10, sessionsUsed: 3, status: 'paid', createdAt: '2026-04-01T00:00:00Z' },
        ]),
        // The gym's own file on each member, and the paperwork. Sara has a record,
        // a waiver she signed and a contract on file; Bo has the same three, so
        // every one of them is a scoping assertion rather than a fixture that
        // would pass with the filter deleted.
        memberRecords: (0, memberView_1.sliceReady)([
            { memberId: 'm1', memberName: 'Sara', phone: '+971500000001', email: 'sara@example.com', emergencyName: 'Nadia', emergencyPhone: '+971500000009', medicalNote: 'asthma inhaler in her bag', note: 'prefers mornings', tags: ['founder'], updatedAt: '2026-02-01T00:00:00Z' },
            { memberId: 'm2', memberName: 'Bo', phone: null, email: null, emergencyName: null, emergencyPhone: null, medicalNote: null, note: null, tags: [], updatedAt: null },
        ]),
        agreements: (0, memberView_1.sliceReady)([
            { id: 'w1', kind: 'waiver', title: 'Liability waiver', body: LONG, version: 1, active: true, required: true, createdAt: '2025-01-01T00:00:00Z' },
            { id: 't1a', kind: 'terms', title: 'Membership terms', body: LONG, version: 1, active: true, required: true, createdAt: '2025-01-01T00:00:00Z' },
        ]),
        signatures: (0, memberView_1.sliceReady)([
            { id: 'g1', agreementId: 'w1', agreementKind: 'waiver', agreementTitle: 'Liability waiver', memberId: 'm1', memberName: 'Sara', signedName: 'Sara Ahmed', signedAt: '2025-01-02T00:00:00Z', versionSigned: 1, attribution: 'staff', signedById: null, signedByName: null, witnessedById: 'o1', witnessedByName: 'Ana', guardianName: null, guardianRelationship: null, note: null },
            { id: 'g2', agreementId: 'w1', agreementKind: 'waiver', agreementTitle: 'Liability waiver', memberId: 'm2', memberName: 'Bo', signedName: 'Bo Tan', signedAt: '2025-06-02T00:00:00Z', versionSigned: 1, attribution: 'member', signedById: 'm2', signedByName: 'Bo', witnessedById: null, witnessedByName: null, guardianName: null, guardianRelationship: null, note: null },
        ]),
        documents: (0, memberView_1.sliceReady)([
            { id: 'd1', memberId: 'm1', memberAttached: true, equipmentId: null, kind: 'contract', title: 'Signed membership agreement', storagePath: 'T1/2025-01-02-abc-sara.pdf', mime: 'application/pdf', sizeBytes: 91234, expiresOn: null, note: null, uploadedById: 'o1', uploadedByName: 'Ana', uploadedAt: '2025-01-02T00:00:00Z' },
            { id: 'd2', memberId: 'm2', memberAttached: true, equipmentId: null, kind: 'contract', title: 'Signed membership agreement', storagePath: 'T1/2025-06-02-def-bo.pdf', mime: 'application/pdf', sizeBytes: 88112, expiresOn: null, note: null, uploadedById: 'o1', uploadedByName: 'Ana', uploadedAt: '2025-06-02T00:00:00Z' },
            { id: 'd3', memberId: null, memberAttached: false, equipmentId: 'e1', kind: 'insurance', title: 'Public liability schedule', storagePath: 'T1/2026-01-01-ghi-insurance.pdf', mime: 'application/pdf', sizeBytes: 4001, expiresOn: '2027-01-01', note: null, uploadedById: 'o1', uploadedByName: 'Ana', uploadedAt: '2026-01-01T00:00:00Z' },
        ]),
        // Sara bought online and Bo did too, so 'their orders and not everybody's'
        // is an assertion rather than a fixture that would pass with the filter
        // removed.
        orders: (0, memberView_1.sliceReady)([
            { id: 'o1o', memberId: 'm1', memberName: 'Sara', kind: 'membership', intent: 'renew', status: 'paid', amountCents: 6000, currency: 'GBP', planId: 'pl1', passTypeId: null, termStartsOn: '2026-08-01', termEndsOn: '2026-09-01', usesTotal: null, expiresOn: null, membershipId: 'ms1', passId: null, stripeAccountId: 'acct_1', stripeSessionId: 'cs_a', stripePaymentIntent: 'pi_a', failureNote: null, createdAt: '2026-08-01T00:00:00Z', paidAt: '2026-08-01T00:00:09Z' },
            { id: 'o2o', memberId: 'm2', memberName: 'Bo', kind: 'pass', intent: 'new', status: 'failed', amountCents: 2000, currency: 'GBP', planId: null, passTypeId: 'pt1', termStartsOn: null, termEndsOn: null, usesTotal: 1, expiresOn: null, membershipId: null, passId: null, stripeAccountId: 'acct_1', stripeSessionId: 'cs_b', stripePaymentIntent: 'pi_b', failureNote: 'pass insert refused', createdAt: '2026-08-02T00:00:00Z', paidAt: '2026-08-02T00:00:09Z' },
        ]),
        // The gym's own books and its own building. None of the three is anybody's
        // personal record and all three must come out EMPTY in a member bundle.
        closes: (0, memberView_1.sliceReady)([
            { id: 'cl1', monthKey: '2026-07', closedAt: '2026-08-03T00:00:00Z', closedById: 'o1', closedByName: 'Owner', takenCents: 100000, invoicedCents: 100000, outstandingCents: 0, payrollCents: 30000, currency: 'GBP', unmarkedSessions: 0, blockersAtClose: null, note: null, reopenedAt: null, reopenedById: null, reopenedByName: null, reopenReason: null },
        ]),
        adjustments: (0, memberView_1.sliceReady)([
            { id: 'ad1', trainerId: 't1', trainerName: 'Ana', kind: 'bonus', amountCents: 5000, currency: 'GBP', note: 'covered a class', appliesOn: '2026-08-31', settlementId: 'st1', createdAt: '2026-09-01T00:00:00Z', createdById: 'o1', createdByName: 'Owner' },
        ]),
        equipmentLog: (0, memberView_1.sliceReady)([
            { id: 'el1', equipmentId: 'e1', equipmentLabel: 'Rower', kind: 'service', happenedOn: '2026-06-01', performedBy: 'Precor UK', findings: 'belt tensioned', costCents: 12000, currency: 'GBP', documentId: null, reportedTo: null, recordedById: 'o1', recordedByName: 'Ana', createdAt: '2026-06-01T00:00:00Z' },
        ]),
        // One mark against Sara's payment, one against Bo's invoice. Neither names
        // a member, so both are placed only through the register they point at.
        reconciles: (0, memberView_1.sliceReady)([
            { id: 'rm1', subjectKind: 'payment', subjectId: 'p1', state: 'accepted', note: 'matches the bank line', markedById: 'o1', markedByName: 'Owner', markedAt: '2026-08-05T00:00:00Z' },
            { id: 'rm2', subjectKind: 'invoice', subjectId: 'i2', state: 'flagged', note: 'Bo disputes it', markedById: 'o1', markedByName: 'Owner', markedAt: '2026-08-06T00:00:00Z' },
        ]),
    };
    const mine = (0, gymExport_1.memberSlices)(base, 'm1');
    const rows = (k) => {
        const s = mine[k];
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
    // The three F3 was about. A subject-access bundle that omitted the member's
    // own file — contact, next of kin, medical note, desk note — and every waiver
    // they signed was missing the two things the request is usually FOR.
    eq(rows('memberRecords'), 1, 'their own file: contact, next of kin, the medical note and the desk note');
    eq(rows('signatures'), 1, 'the waivers they signed, and not the other member’s');
    eq(rows('documents'), 1, 'the documents about them');
    eq(rows('agreements'), 1, 'the wording they signed travels with the signature — a row naming version 1 of the waiver is a citation to a document, and the document has to be enclosed');
    ok(mine.agreements.rows[0].id === 'w1', 'and only that one: the membership terms they never signed are not their record');
    ok(!mine.documents.rows.some((d) => d.id === 'd3'), 'the gym’s insurance schedule is the building’s paperwork, not this member’s');
    eq(rows('orders'), 1, 'the orders they placed online, and not the other member’s');
    // Placed through the register the mark points at, because the mark itself
    // names an invoice or a payment and never a person. Sara's payment p1 carries
    // one; Bo's disputed invoice i2 carries the other, and it must not be here.
    eq(rows('reconciles'), 1, 'the reconciliation mark against their own payment');
    ok(mine.reconciles.rows[0].id === 'rm1', 'and not the one against the other member’s invoice');
    // The gym's own books and its own building, which belong to nobody.
    eq(rows('closes'), 0, 'a month close is the whole gym’s four totals and is not anybody’s record');
    eq(rows('adjustments'), 0, 'and a coach’s pay is not a member’s record either');
    eq(rows('equipmentLog'), 0, 'nor the maintenance and accident book, which carries no member at all');
    // 1 own file + 1 membership + 1 payment + 1 invoice + 1 booking + 1 session
    // + 2 passes + 1 visit + 1 invite + 1 contact + 1 pack + 1 event
    // + 1 agreement + 1 signature + 1 document + 1 order + 1 mark.
    eq((0, gymExport_1.memberRowCount)(base, 'm1'), 18, 'eighteen rows across the record');
    /* ── the part whose SCOPE depends on two other reads ───────────────────── */
    // The sharpest rule in this file. A reconciliation mark names an invoice id
    // or a payment id, so with the invoice register refused there is no way to
    // know which marks are this member's — and filtering on the ids that DID load
    // would produce a shorter list with nothing anywhere saying it was short.
    // That is the exact failure a subject-access response cannot make, so an
    // unnarrowable part is UNREADABLE rather than empty.
    {
        const noInvoices = (0, gymExport_1.memberSlices)({ ...base, invoices: (0, memberView_1.sliceFailed)('permission denied') }, 'm1');
        eq(noInvoices.reconciles.state, 'failed', 'with the invoice register refused, the marks cannot be narrowed and are refused rather than shortened');
        ok(/invoice register/.test(noInvoices.reconciles.reason), 'and the reason names the read that did not answer');
        ok(/could not be matched/.test(noInvoices.reconciles.reason), 'and says they were not matched — not that there were none');
        eq((0, gymExport_1.memberRowCount)({ ...base, invoices: (0, memberView_1.sliceFailed)('permission denied') }, 'm1'), null, 'so the count offered before the download is unknown rather than smaller');
        const noPayments = (0, gymExport_1.memberSlices)({ ...base, payments: (0, memberView_1.sliceFailed)('timeout') }, 'm1');
        ok(/the payments/.test(noPayments.reconciles.reason), 'the payments failing alone names the payments');
        const neither = (0, gymExport_1.memberSlices)({ ...base, payments: (0, memberView_1.sliceFailed)('timeout'), invoices: (0, memberView_1.sliceFailed)('timeout') }, 'm1');
        ok(/the invoice register and the payments/.test(neither.reconciles.reason), 'and both failing names both');
    }
    eq((0, gymExport_1.memberRowCount)(base, 'm9'), 0, 'a person this gym holds nothing about is a real zero, and the screen says so');
    // One unreadable part makes the COUNT unknown rather than smaller. A smaller
    // number reads as "this member has little on file", which is the sentence an
    // owner would put in a covering letter.
    const broken = { ...base, payments: (0, memberView_1.sliceFailed)('timeout') };
    eq((0, gymExport_1.memberRowCount)(broken, 'm1'), null, 'one failed read makes the total unknown, never smaller');
    const pending = { ...base, invoices: (0, memberView_1.sliceLoading)() };
    eq((0, gymExport_1.memberRowCount)(pending, 'm1'), null, 'and so does one that has not returned');
    // A failed read stays failed after scoping: "we could not read the invoices"
    // is still true of this member's invoices.
    eq((0, gymExport_1.memberSlices)(broken, 'm1').payments.state, 'failed', 'a refused read is still refused when narrowed to one person — it does not become an empty file');
    ok(gymExport_1.MEMBER_PARTS.every((p) => p !== 'plans' && p !== 'equipment' && p !== 'shifts' && p !== 'promos'), 'the member parts list and the scoping agree about what belongs to a person');
    ok(gymExport_1.MEMBER_PARTS.includes('memberRecords') && gymExport_1.MEMBER_PARTS.includes('signatures'), 'and a subject-access bundle carries the member’s own file and their signatures');
    // With the signatures read refused there is no way to know WHICH versions
    // they signed, so the wording travels whole rather than narrowed by a guess.
    const noSigs = { ...base, signatures: (0, memberView_1.sliceFailed)('permission denied') };
    const blind = (0, gymExport_1.memberSlices)(noSigs, 'm1');
    eq(blind.agreements.state, 'ready', 'the agreements still read');
    eq(blind.agreements.rows.length, 2, 'and go out whole when nothing can say which of them this member signed — over-inclusive beats a guess about what somebody agreed to');
    eq(blind.signatures.state, 'failed', 'while the signatures stay failed: a refused read does not become an empty waiver file');
}
if (errors.length) {
    console.error(`gymPaperwork: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
    process.exit(1);
}
console.log('gymPaperwork ok');
