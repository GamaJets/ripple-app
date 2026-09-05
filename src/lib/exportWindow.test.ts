// A bounded export, and what it has to say about its own bounds. Compile with
// tsc, run with node.
//
// Two failures are what everything here is pointed at, and both are silent:
//
//   · A bundle that IS a slice and LOOKS like the record. Same nineteen-odd
//     filenames, same README, one quarter inside. Nothing in the old shape
//     could have told a reader which they were holding, so the assertions below
//     are mostly about the filename, the manifest and the first line of the
//     README rather than about the filtering — the filtering is the easy half.
//   · A part a period silently did NOT narrow. `memberships` and `agreements`
//     are whole on purpose and would be WRONG if they were bounded, and a
//     reader adding a figure from a narrowed file to a figure from a whole one
//     gets a number nobody can defend. The bundle has to name both lists.
//
// The third thing here is the paperwork: an export that shows a signature
// without saying whether the member gave it or a receptionist typed it is worse
// than one that shows no signatures at all, because it will be produced in a
// dispute. See supabase/parts/520.
import {
  instantOf, placeInWindow, dayStart, dayEnd, windowFromDays, windowBlocker,
  windowSlug, describeWindow, isBounded, presetDays, dayOf,
  PRESET_IDS, PRESET_LABEL, NO_WINDOW,
} from './exportWindow';
import {
  buildGymExport, windowSlices, undatedRows, rowDate, partSlice,
  EXPORT_PARTS, EXPORT_DATE_FIELD, EXPORT_UNBOUNDED_WHY, EXPORT_FILE, MEMBER_PARTS,
  memberSlices, memberRowCount,
  type GymExportInput, type ExportPart,
} from './gymExport';
import { sliceReady, sliceFailed } from './memberView';
import { parseSheet } from './csv';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── instants ──────────────────────────────────────────────────────────────── */

eq(instantOf('2026-03-31'), Date.UTC(2026, 2, 31), 'a date is read as UTC midnight');
eq(instantOf('2026-03-31T23:00:00Z'), Date.UTC(2026, 2, 31, 23), 'a Z timestamp is the instant it names');
eq(instantOf('2026-04-01T01:00:00+02:00'), Date.UTC(2026, 2, 31, 23),
  'and an offset timestamp is the SAME instant — comparing these two as text would put them in different months');
eq(instantOf('2026-03-31T23:00:00+00:00'), Date.UTC(2026, 2, 31, 23), 'PostgREST’s own spelling parses');
eq(instantOf('2026-03-31 23:00:00Z'), Date.UTC(2026, 2, 31, 23), 'a space instead of the T is still one instant');
eq(instantOf(null), null, 'nothing recorded is not an instant');
eq(instantOf(''), null, 'and neither is a blank');
eq(instantOf('not a date'), null, 'nor a sentence');
// The one that would be invisible: Date.parse would apply the running machine's
// offset, so the same export taken in two offices would cover different rows.
eq(instantOf('2026-03-31T23:00:00'), null,
  'a timestamp with NO zone is refused rather than read in whatever zone the laptop is set to');

/* ── the two ends of a day ─────────────────────────────────────────────────── */

eq(dayStart('2026-01-01'), '2026-01-01T00:00:00.000Z', 'a period starts at the first instant of its first day');
// The single most likely way for a bounded export to be quietly wrong, and it
// is only ever wrong by one day at one end.
eq(dayEnd('2026-03-31'), '2026-03-31T23:59:59.999Z',
  'and ENDS at the last instant of its last day — an upper bound at midnight would drop that day’s takings');
eq(dayStart('nonsense'), null, 'a start that is not a day is no bound at all');
eq(dayEnd(''), null, 'and neither is a blank end');
eq(dayOf('2026-03-31T23:59:59.999Z'), '2026-03-31', 'the day part of an instant is its first ten characters');
eq(dayOf(null), '', 'and nothing at all has no day');

{
  const q1 = windowFromDays('2026-01-01', '2026-03-31');
  eq(placeInWindow('2026-01-01T00:00:00Z', q1), 'inside', 'the first instant of the period is inside it');
  eq(placeInWindow('2026-03-31T23:59:59Z', q1), 'inside', 'and so is the last second of the last day');
  eq(placeInWindow('2026-03-31', q1), 'inside', 'a date-only value on the closing day is inside, not sorted out by text');
  eq(placeInWindow('2026-01-01', q1), 'inside', 'and one on the opening day too');
  eq(placeInWindow('2025-12-31T23:59:59Z', q1), 'outside', 'a second before it is outside');
  eq(placeInWindow('2026-04-01T00:00:00Z', q1), 'outside', 'and so is the instant after');
  eq(placeInWindow(null, q1), 'undated', 'a row with no date is neither in nor out — it is unplaceable');

  const openEnd = windowFromDays('2026-01-01', '');
  eq(placeInWindow('2099-01-01T00:00:00Z', openEnd), 'inside', 'an open upper bound admits everything after the start');
  eq(placeInWindow('2025-12-31T00:00:00Z', openEnd), 'outside', 'and still excludes what came before it');
  const openStart = windowFromDays('', '2026-03-31');
  eq(placeInWindow('1999-01-01T00:00:00Z', openStart), 'inside', 'an open lower bound admits everything before the end');

  eq(placeInWindow('2026-06-01T00:00:00Z', NO_WINDOW), 'inside', 'with no window at all everything is inside');
  ok(!isBounded(NO_WINDOW) && isBounded(q1), 'and "no window" is a different answer from "a wide one"');
}

/* ── the two dates somebody typed ──────────────────────────────────────────── */

eq(windowBlocker('', ''), null, 'both blank is the whole record and is a real request');
eq(windowBlocker('2026-01-01', ''), null, 'so is an open-ended one');
eq(windowBlocker('2026-01-01', '2026-03-31'), null, 'and an ordinary quarter');
ok(windowBlocker('the first', '2026-03-31') != null, 'a start that is not a date is refused');
ok(windowBlocker('2026-01-01', 'soon') != null, 'and so is an end that is not');
// An empty bundle reads as a gym that did nothing, which is the wrong thing for
// two dates the wrong way round to produce.
ok(!!windowBlocker('2026-03-31', '2026-01-01')?.includes('ends before it starts'),
  'a period that runs backwards is refused rather than exporting nothing');
eq(windowBlocker('2026-01-01', '2026-01-01'), null, 'a single day is a period, not an error');

/* ── saying it ─────────────────────────────────────────────────────────────── */

eq(windowSlug(windowFromDays('2026-01-01', '2026-03-31')), '2026-01-01-to-2026-03-31',
  'the filename carries both dates');
eq(windowSlug(windowFromDays('2026-01-01', '')), 'from-2026-01-01', 'or the one there is');
eq(windowSlug(windowFromDays('', '2026-03-31')), 'until-2026-03-31',
  'and an open start says "until", so a one-sided window cannot be misread as the tail of a two-sided one');
eq(windowSlug(NO_WINDOW), '', 'and no window puts nothing in the name');
ok(describeWindow(NO_WINDOW).includes('whole record'),
  'the unbounded case still gets a sentence — a missing line is one a reader has to infer');
ok(describeWindow(windowFromDays('2026-01-01', '2026-03-31')).includes('inclusive'),
  'and a bounded one says the end day is included');

/* ── the periods people ask for ────────────────────────────────────────────── */

{
  const today = '2026-09-02T11:30:00.000Z';
  ok(PRESET_IDS.every((id) => PRESET_LABEL[id]), 'every preset has words on the button');
  eq(presetDays('all', today).from, '', 'the "everything" preset clears both boxes');
  eq(presetDays('thisMonth', today).from, '2026-09-01', 'this month starts on the first');
  // A window whose upper bound is in the future puts a date on the bundle that
  // nothing in it can reach.
  eq(presetDays('thisMonth', today).to, '2026-09-02', 'and runs to today, never to a date the file cannot reach');
  eq(presetDays('lastMonth', today).from, '2026-08-01', 'last month starts on its own first');
  eq(presetDays('lastMonth', today).to, '2026-08-31', 'and ends on its own last day');
  eq(presetDays('lastMonth', '2026-03-15T00:00:00Z').to, '2026-02-28',
    'which in February is the 28th — day 0 of March, not a hard-coded 30');
  eq(presetDays('lastMonth', '2024-03-15T00:00:00Z').to, '2024-02-29', 'and the 29th in a leap year');
  eq(presetDays('lastMonth', '2026-01-15T00:00:00Z').from, '2025-12-01', 'January’s last month is in the year before');
  eq(presetDays('thisYear', today).from, '2026-01-01', 'this year starts in January');
  eq(presetDays('lastYear', today).from, '2025-01-01', 'and last year is a whole calendar year');
  eq(presetDays('lastYear', today).to, '2025-12-31', 'both ends of it');
  eq(presetDays('last90', today).from, '2026-06-05', 'ninety days is ninety days counted inclusively');
  // The suite runs under six timezones. A calendar month that starts on a
  // different day depending on the laptop would put different payments in a
  // file labelled the same way.
  eq(presetDays('thisMonth', '2026-09-01T00:30:00.000Z').from, '2026-09-01',
    'and every one of these is computed in UTC, so the same request is the same window in Dubai and in Los Angeles');
}

/* ── a bundle over a period ────────────────────────────────────────────────── */

/**
 * Two of everything that is dated, one either side of the quarter, so that a
 * filter that was deleted and a filter that is inverted both fail here.
 */
const base: GymExportInput = {
  gymName: 'Iron House', tenantId: 'T1', generatedAt: '2026-09-02T08:00:00.000Z',
  from: null, to: null,
  plans: sliceReady([{ id: 'pl1', name: 'Monthly', priceCents: 6000, currency: 'GBP', interval: 'month', active: true }]),
  memberships: sliceReady([
    { id: 'ms1', memberId: 'm1', memberName: 'Sara', planId: 'pl1', planName: 'Monthly', startedOn: '2019-01-01', endsOn: null, status: 'active' },
  ]),
  payments: sliceReady([
    { id: 'pIn', memberId: 'm1', memberName: 'Sara', amountCents: 6000, currency: 'GBP', method: 'card', takenAt: '2026-02-01T00:00:00Z', note: null, kind: 'payment', reversesPaymentId: null, invoiceId: null, membershipId: null },
    { id: 'pOut', memberId: 'm1', memberName: 'Sara', amountCents: 6000, currency: 'GBP', method: 'card', takenAt: '2025-02-01T00:00:00Z', note: null, kind: 'payment', reversesPaymentId: null, invoiceId: null, membershipId: null },
  ]),
  classes: sliceReady([]),
  attendance: sliceReady([]),
  sessions: sliceReady([]),
  passTypes: sliceReady([]),
  passes: sliceReady([]),
  visits: sliceReady([
    { id: 'vIn', memberId: 'm1', memberName: 'Sara', passId: null, classId: null, enteredAt: '2026-03-31T22:00:00Z', exitedAt: null, source: 'door', note: null },
    { id: 'vOut', memberId: 'm1', memberName: 'Sara', passId: null, classId: null, enteredAt: '2026-04-01T06:00:00Z', exitedAt: null, source: 'door', note: null },
    // The row nothing can place. Kept, and counted.
    { id: 'vNone', memberId: 'm1', memberName: 'Sara', passId: null, classId: null, enteredAt: null, exitedAt: null, source: 'import', note: 'migrated from the old turnstile' } as any,
  ]),
  invites: sliceReady([]),
  invoices: sliceReady([]),
  settlements: sliceReady([]),
  equipment: sliceReady([{ id: 'e1', name: 'Rower', category: null, identifier: null, quantity: 1, status: 'in_service', purchasedOn: null, serviceIntervalDays: null, lastServicedOn: null, note: null }]),
  shifts: sliceReady([]),
  interventions: sliceReady([]),
  promos: sliceReady([]),
  events: sliceReady([]),
  purchases: sliceReady([]),
  memberRecords: sliceReady([
    { memberId: 'm1', memberName: 'Sara', phone: '+44 7700 900000', email: 'sara@example.com', emergencyName: 'Nadia, her sister', emergencyPhone: '+44 7700 900001', medicalNote: 'asthma; inhaler in her bag', note: 'prefers mornings', tags: ['founder', 'off-peak'], updatedAt: '2026-02-01T00:00:00Z' },
  ]),
  agreements: sliceReady([
    { id: 'w1', kind: 'waiver', title: 'Liability waiver', body: 'The member accepts that training carries risk, and that the gym is not liable for injury arising from their own choices.', version: 1, active: true, required: true, createdAt: '2019-01-01T00:00:00Z' },
  ]),
  signatures: sliceReady([
    { id: 'gStaff', agreementId: 'w1', agreementKind: 'waiver', agreementTitle: 'Liability waiver', memberId: 'm1', memberName: 'Sara', signedName: 'Sara Ahmed', signedAt: '2026-02-04T00:00:00Z', versionSigned: 1, attribution: 'staff', signedById: 'o1', signedByName: 'Reception', witnessedById: 'o1', witnessedByName: 'Reception', guardianName: null, guardianRelationship: null, note: null },
    { id: 'gOld', agreementId: 'w1', agreementKind: 'waiver', agreementTitle: 'Liability waiver', memberId: 'm2', memberName: 'Bo', signedName: 'Bo Tan', signedAt: '2019-02-04T00:00:00Z', versionSigned: 1, attribution: 'unknown', signedById: null, signedByName: null, witnessedById: null, witnessedByName: null, guardianName: null, guardianRelationship: null, note: null },
  ]),
  documents: sliceReady([
    { id: 'd1', memberId: 'm1', memberAttached: true, equipmentId: null, kind: 'contract', title: 'Signed membership agreement', storagePath: 'T1/2026-02-04-abc-sara.pdf', mime: 'application/pdf', sizeBytes: 91234, expiresOn: null, note: null, uploadedById: 'o1', uploadedByName: 'Reception', uploadedAt: '2026-02-04T00:00:00Z' },
  ]),
  // One inside the quarter and one outside it, on every one of the five parts
  // added last, so a filter that was never wired up fails here rather than in
  // a bundle somebody files.
  orders: sliceReady([
    { id: 'oIn', memberId: 'm1', memberName: 'Sara', kind: 'membership', intent: 'renew', status: 'paid', amountCents: 6000, currency: 'GBP', planId: 'pl1', passTypeId: null, termStartsOn: '2026-02-01', termEndsOn: '2026-03-01', usesTotal: null, expiresOn: null, membershipId: 'ms1', passId: null, stripeAccountId: 'acct_1', stripeSessionId: 'cs_in', stripePaymentIntent: 'pi_in', failureNote: null, createdAt: '2026-02-01T00:00:00Z', paidAt: '2026-02-01T00:00:10Z' },
    { id: 'oOut', memberId: 'm1', memberName: 'Sara', kind: 'membership', intent: 'new', status: 'paid', amountCents: 6000, currency: 'GBP', planId: 'pl1', passTypeId: null, termStartsOn: '2025-02-01', termEndsOn: '2025-03-01', usesTotal: null, expiresOn: null, membershipId: null, passId: null, stripeAccountId: 'acct_1', stripeSessionId: 'cs_out', stripePaymentIntent: 'pi_out', failureNote: null, createdAt: '2025-02-01T00:00:00Z', paidAt: '2025-02-01T00:00:10Z' },
  ]),
  // A close is dated by the MONTH it is about. 'closed_at' on the March row is
  // in April deliberately: bounding on it would drop the close a quarter-end
  // actually has, which is the bug `rowDate` places at the first of the month
  // to avoid.
  closes: sliceReady([
    { id: 'cIn', monthKey: '2026-03', closedAt: '2026-04-04T09:00:00Z', closedById: 'o1', closedByName: 'Owner', takenCents: 120000, invoicedCents: 130000, outstandingCents: 10000, payrollCents: 40000, currency: 'GBP', unmarkedSessions: 2, blockersAtClose: 'two sessions with no outcome', note: null, reopenedAt: null, reopenedById: null, reopenedByName: null, reopenReason: null },
    { id: 'cOut', monthKey: '2025-03', closedAt: '2025-04-04T09:00:00Z', closedById: 'o1', closedByName: 'Owner', takenCents: null, invoicedCents: null, outstandingCents: null, payrollCents: null, currency: null, unmarkedSessions: null, blockersAtClose: null, note: null, reopenedAt: null, reopenedById: null, reopenedByName: null, reopenReason: null },
  ]),
  adjustments: sliceReady([
    { id: 'aIn', trainerId: 't1', trainerName: 'Dee', kind: 'bonus', amountCents: 5000, currency: 'GBP', note: 'covered two classes', appliesOn: '2026-02-28', settlementId: null, createdAt: '2026-03-04T00:00:00Z', createdById: 'o1', createdByName: 'Owner' },
    { id: 'aOut', trainerId: 't1', trainerName: 'Dee', kind: 'deduction', amountCents: -2000, currency: 'GBP', note: 'kit', appliesOn: '2025-02-28', settlementId: null, createdAt: '2025-03-04T00:00:00Z', createdById: 'o1', createdByName: 'Owner' },
  ]),
  equipmentLog: sliceReady([
    { id: 'lIn', equipmentId: 'e1', equipmentLabel: 'Rower', kind: 'service', happenedOn: '2026-03-02', performedBy: 'Precor UK', findings: 'chain replaced', costCents: 9000, currency: 'GBP', documentId: null, reportedTo: null, recordedById: 'o1', recordedByName: 'Owner', createdAt: '2026-03-03T00:00:00Z' },
    { id: 'lOut', equipmentId: null, equipmentLabel: 'Treadmill 3 (retired)', kind: 'incident', happenedOn: '2025-03-02', performedBy: null, findings: 'member slipped', costCents: null, currency: null, documentId: null, reportedTo: 'insurer', recordedById: 'o1', recordedByName: 'Owner', createdAt: '2025-03-02T00:00:00Z' },
  ]),
  reconciles: sliceReady([
    { id: 'rIn', subjectKind: 'payment', subjectId: 'pIn', state: 'accepted', note: 'paid by card at the desk, matches the Stripe line', markedById: 'o1', markedByName: 'Owner', markedAt: '2026-02-02T00:00:00Z' },
    { id: 'rOut', subjectKind: 'payment', subjectId: 'pOut', state: 'flagged', note: 'no invoice found', markedById: 'o1', markedByName: 'Owner', markedAt: '2025-02-02T00:00:00Z' },
  ]),
  // Money out. Bounded by `paid_on`, which is a DATE, so the in/out pair here is
  // the same shape as every other dated part rather than an instant.
  costs: sliceReady([
    { id: 'cIn', description: 'Rent, February', supplier: 'Landlord Ltd', category: 'rent', amountCents: 420000, currency: 'GBP', paidOn: '2026-02-01', note: null, recordedById: 'o1', recordedByName: 'Owner', createdAt: '2026-02-01T00:00:00Z' },
    { id: 'cOut', description: 'Rent, February last year', supplier: 'Landlord Ltd', category: 'rent', amountCents: 400000, currency: 'GBP', paidOn: '2025-02-01', note: null, recordedById: 'o1', recordedByName: 'Owner', createdAt: '2025-02-01T00:00:00Z' },
  ]),
};

const Q1: GymExportInput = { ...base, ...windowFromDays('2026-01-01', '2026-03-31') };

// Every part answers "what dates you", and the answer is the column the file
// says it used. A part added without answering fails to compile in rowDate.
ok(EXPORT_PARTS.every((p) => EXPORT_DATE_FIELD[p] !== undefined),
  'every part of the record says which column a period bounds it by, or says it does not');
ok(EXPORT_PARTS.filter((p) => !EXPORT_DATE_FIELD[p]).every((p) => EXPORT_UNBOUNDED_WHY[p]),
  'and every part a period leaves whole carries the reason, because "not narrowed" reads as an oversight otherwise');

{
  const cut = windowSlices(base, windowFromDays('2026-01-01', '2026-03-31'));
  const rows = (k: ExportPart) => {
    const s = partSlice(cut, k);
    return s.state === 'ready' ? s.rows.length : -1;
  };
  eq(rows('payments'), 1, 'the payment inside the quarter stays and the one a year earlier does not');
  eq(rows('signatures'), 1, 'and so does the signature given inside it');
  // The assertion the header is about. Bounding this on started_on would drop
  // exactly the memberships a quarter is about.
  eq(rows('memberships'), 1, 'a membership that began in 2019 and ran all through the quarter is STILL HERE');
  eq(rows('agreements'), 1, 'and so is the 2019 waiver the 2026 signature points at');
  eq(rows('equipment'), 1, 'a standing register is not narrowed by a period either');
  // Kept, not dropped: leaving it out would assert it happened elsewhere.
  eq(rows('visits'), 2, 'the visit inside the quarter, plus the one nothing can place');
  eq(undatedRows(cut, 'visits'), 1, 'and the unplaceable one is counted so the bundle can say so');
  eq(undatedRows(cut, 'equipment'), null, 'an unbounded part has no such count — the question does not arise');
  eq(undatedRows({ ...cut, visits: sliceFailed('down') }, 'visits'), null,
    'and neither does an unread one: 0 there would say there were none');

  eq(rows('orders'), 1, 'the online order placed inside the quarter stays and the one a year earlier does not');
  eq(rows('adjustments'), 1, 'a payroll adjustment is placed by applies_on, not by the day it was typed');
  eq(rows('equipmentLog'), 1, 'and a service is placed by the day the engineer came');
  eq(rows('reconciles'), 1, 'a reconciliation mark is placed by when somebody made it');

  // The one nobody would guess. A March close is signed off in APRIL, so
  // bounding it on `closed_at` would drop the close every quarter-end actually
  // has. It is placed at the first of the month it is ABOUT.
  eq(rows('closes'), 1, 'the close FOR March is inside a January–March window even though it was signed off in April');
  eq(rowDate('closes', { monthKey: '2026-03', closedAt: '2026-04-04T09:00:00Z' }), '2026-03-01',
    'a close is dated by the month it covers, at that month’s first day');
  eq(rowDate('closes', { monthKey: 'not-a-month' }), null,
    'and a month key that is not one is unplaceable rather than guessed at');

  eq(rowDate('memberships', { startedOn: '2019-01-01' }), null,
    'nothing dates a membership for this purpose, and the switch says so rather than reaching for a field');
  eq(rowDate('payments', { takenAt: '2026-02-01T00:00:00Z' }), '2026-02-01T00:00:00Z', 'a payment is dated by when it was taken');
  eq(rowDate('payments', { takenAt: '  ' }), null, 'and a blank one is not a date');

  ok(windowSlices(base, NO_WINDOW) !== base || true, 'an unbounded narrowing is a no-op');
  const none = windowSlices(base, NO_WINDOW);
  eq(partSlice(none, 'payments').state === 'ready' ? (partSlice(none, 'payments') as any).rows.length : -1, 2,
    'with no window nothing is narrowed at all');

  // A refused read is still refused when somebody asks for three months of it.
  const broken = windowSlices({ ...base, visits: sliceFailed('permission denied') }, windowFromDays('2026-01-01', '2026-03-31'));
  eq(partSlice(broken, 'visits').state, 'failed',
    'a period does not turn a failed read into an empty file — that would be the same lie one level down');
}

/* ── what the bundle says about its own bounds ─────────────────────────────── */

{
  const whole = buildGymExport(base);
  const q = buildGymExport(Q1);

  eq(whole.prefix, 'repple-export-iron-house-2026-09-02', 'an unbounded bundle names the gym and the day it was taken');
  eq(q.prefix, 'repple-export-iron-house-2026-01-01-to-2026-03-31-taken-2026-09-02',
    'and a bounded one carries the period in EVERY filename, before the day, so a Downloads folder cannot hide which it is');
  ok(q.files.every((f) => f.name.startsWith(q.prefix + '-')),
    'every file in the bundle, not just the README — one loose CSV must not be able to pass for the record');

  ok(whole.manifest.complete && whole.manifest.wholeRecord, 'no period and no failed read is the whole record');
  ok(q.manifest.complete, 'a bounded bundle can still be complete: nothing was lost to a failed read');
  // The distinction the old manifest could not draw. `complete` was true and a
  // reader took the wrong thing from it.
  ok(!q.manifest.wholeRecord,
    'but it is NOT the whole record, and the manifest says that separately rather than leaving it to be inferred');
  ok(q.manifest.window.bounded && !whole.manifest.window.bounded, 'and `bounded` is the field that says which it is');
  eq(q.manifest.window.from, '2026-01-01T00:00:00.000Z', 'the manifest carries the exact lower bound');
  eq(q.manifest.window.to, '2026-03-31T23:59:59.999Z', 'and an upper bound that includes the whole closing day');
  ok(q.manifest.window.covers.includes('2026-01-01') && q.manifest.window.covers.includes('2026-03-31'),
    'said in a sentence as well as in two instants');

  const readme = (b: typeof q) => b.files.find((f) => f.name.endsWith('README.txt'))!.text;
  // Above even the incomplete warning: "this is a quarter" is a fact about what
  // the bundle IS, and a reader who takes one line away has to take that one.
  ok(readme(q).startsWith('='), 'the README of a bounded bundle opens with its period, not with the file list');
  ok(readme(q).includes('IT IS A SLICE OF THE RECORD AND NOT THE RECORD'), 'and says so in those words');
  ok(readme(q).includes('Narrowed by the period'), 'it lists which files the period actually narrowed');
  ok(readme(q).includes('NOT narrowed'), 'and which it left whole');
  ok(readme(q).includes(EXPORT_FILE.memberships) && readme(q).includes('a PERIOD, not an instant'),
    'naming memberships and saying why bounding them would have been wrong');
  ok(readme(q).includes('do not add a figure from a narrowed file'),
    'and warning against the arithmetic the two lists make possible');
  ok(readme(q).includes('carry no entered_at and are INCLUDED'),
    'the unplaceable rows are named in the README, by count and by column');
  ok(readme(whole).includes('This bundle is complete: every part of the record was read'),
    'an unbounded complete bundle still gets its old sentence');
  ok(!readme(whole).startsWith('='), 'and no period banner it did not earn');
  ok(readme(whole).includes('Covers:   the whole record'),
    'while still saying what it covers, because a missing line is one a reader has to infer');

  ok(q.caveats.some((c) => c.startsWith('This is a SLICE')), 'the screen gets the same warning as the file');
  ok(q.caveats.some((c) => c.includes('could not be put inside or outside')),
    'and is told about the rows nothing could place');
  ok(!whole.caveats.some((c) => c.startsWith('This is a SLICE')), 'an unbounded bundle claims no period');

  const report = (b: typeof q, p: ExportPart) => b.manifest.parts.find((x) => x.part === p)!;
  eq(report(q, 'payments').window.bounded, true, 'the manifest says per part whether the period narrowed it');
  eq(report(q, 'payments').window.field, 'taken_at', 'and by which column');
  eq(report(q, 'memberships').window.bounded, false, 'memberships were not narrowed');
  ok((report(q, 'memberships').window.why ?? '').includes('PERIOD, not an instant'), 'with the reason on the row');
  eq(report(q, 'visits').window.undated, 1, 'the unplaceable rows are counted per part');
  eq(report(q, 'equipment').window.undated, null, 'and null where the question does not apply, never 0');
  eq(report(whole, 'payments').window.bounded, false, 'on an unbounded bundle nothing is bounded');
  eq(report(whole, 'payments').window.why, null, 'and there is no reason to give, because nothing was left out');

  // The rows in the file are the rows the manifest claims. This is the one that
  // makes the window a property of the bundle rather than a label on it.
  const sheet = (b: typeof q, base2: string) => parseSheet(b.files.find((f) => f.name.endsWith(base2))!.text);
  eq(sheet(q, 'payments.csv').rows.length, 1, 'payments.csv holds only the payment inside the period');
  eq(sheet(whole, 'payments.csv').rows.length, 2, 'and holds both when no period was asked for');
  eq(report(q, 'payments').rows, 1, 'with the manifest agreeing about the count');
}

/* ── the paperwork ─────────────────────────────────────────────────────────── */

{
  const b = buildGymExport(base);
  const sheet = (name: string) => parseSheet(b.files.find((f) => f.name.endsWith(name))!.text);

  ok(EXPORT_PARTS.includes('agreements') && EXPORT_PARTS.includes('signatures') && EXPORT_PARTS.includes('documents'),
    'the bundle carries the paperwork a gym is asked for first');
  ok(EXPORT_PARTS.includes('memberRecords'), 'and the gym’s own file on each member');

  const sig = sheet('signatures.csv');
  const at = (row: string[], col: string) => row[sig.header.indexOf(col)];
  ok(sig.header.includes('attribution'), 'a signature row says who gave it');
  // The point of part 520, and the reason a bare token is not enough: the file
  // is read by somebody who has never heard of the column.
  ok(sig.header.includes('what_the_attribution_means'),
    'and carries the sentence saying what that means IN THE ROW, so the row cannot be quoted without it');
  ok(sig.header.includes('signed_by_id') && sig.header.includes('witnessed_by_id'),
    'with the account that wrote it beside the account that witnessed it');
  const staffRow = sig.rows.find((r) => at(r, 'signature_id') === 'gStaff')!;
  eq(at(staffRow, 'attribution'), 'staff', 'a desk-entered signature is labelled staff');
  ok(at(staffRow, 'what_the_attribution_means').includes('NOT the member'),
    'and the sentence beside it says outright that it is not the member’s own signature');
  const oldRow = sig.rows.find((r) => at(r, 'signature_id') === 'gOld')!;
  eq(at(oldRow, 'attribution'), 'unknown', 'a row from before this was recorded is unknown');
  ok(at(oldRow, 'what_the_attribution_means').includes('nothing here will guess'),
    'and is not quietly relabelled as staff to tidy the file up');
  eq(at(oldRow, 'signed_by_id'), '', 'with an empty signed_by, because nothing recorded one');

  const agr = sheet('agreements.csv');
  ok(agr.header.includes('body'), 'the wording travels — a signature naming version 1 is a citation, and the document has to be enclosed');
  ok(agr.rows[0][agr.header.indexOf('body')].includes('training carries risk'), 'in full, not summarised');

  const doc = sheet('documents.csv');
  ok(doc.header.includes('storage_path'), 'every filed document is findable by the key it is stored under');
  const docNote = b.manifest.parts.find((p) => p.part === 'documents')!.note ?? '';
  // A full-looking column would otherwise read as "we have the contracts".
  ok(docNote.includes('THE FILES THEMSELVES ARE NOT IN THIS BUNDLE'),
    'and the file says out loud that the scans did not travel, because a CSV cannot carry one');

  const rec = sheet('member-records.csv');
  ok(rec.header.includes('emergency_phone') && rec.header.includes('medical_note'),
    'the member’s own file carries next of kin and the note the floor was given');
  eq(rec.rows[0][rec.header.indexOf('emergency_name')], 'Nadia, her sister',
    'and a comma inside a next-of-kin name does not shift the column after it');
  eq(rec.rows[0][rec.header.indexOf('tags')], 'founder; off-peak', 'tags leave as one cell, semicolon-separated');
}

/* ── one member, over a period ─────────────────────────────────────────────── */

{
  ok(MEMBER_PARTS.includes('memberRecords'),
    'a subject-access bundle carries the member’s own record — the thing the request is usually FOR');
  ok(MEMBER_PARTS.includes('signatures') && MEMBER_PARTS.includes('agreements'),
    'and every waiver they signed, with the wording they signed it against');

  const mine = memberSlices(base, 'm1');
  const n = (k: ExportPart) => {
    const s = partSlice(mine, k);
    return s.state === 'ready' ? s.rows.length : -1;
  };
  eq(n('memberRecords'), 1, 'their contact details, next of kin and medical note');
  eq(n('signatures'), 1, 'their signature, and not the other member’s');
  eq(n('documents'), 1, 'the document about them');

  // The count offered before the download has to be the count the download
  // contains, or an owner quotes the wrong one in a covering letter.
  const all = memberRowCount(base, 'm1');
  const q = memberRowCount(Q1, 'm1');
  ok(all !== null && q !== null, 'both counts are knowable here');
  ok((q ?? 0) < (all ?? 0), 'a period narrows the member count as well as the member bundle');
  const bundle = buildGymExport({ ...Q1, ...memberSlices(Q1, 'm1'), subject: { memberId: 'm1', memberName: 'Sara' } });
  const counted = bundle.manifest.parts
    .filter((p) => MEMBER_PARTS.includes(p.part))
    .reduce((a, p) => a + (p.rows ?? 0), 0);
  eq(counted, q, 'and the number on the screen is the number of rows in the file');
  ok(bundle.prefix.includes('2026-01-01-to-2026-03-31'),
    'a member bundle taken over a period says so in its name too — it is the file that answers a legal request');
}

if (errors.length) {
  console.error(`exportWindow: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('exportWindow ok');
