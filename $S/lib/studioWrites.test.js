"use strict";
// The writes the Studio console can now actually make.
//
// Four capabilities existed in src/lib with nothing calling them: issuing a
// member invite, creating a pass type, booking a one-to-one to a named member,
// and saying how a payroll settlement was paid. Wiring them to a screen is only
// half of it — each one had a rule that had to be stated somewhere a test can
// reach, so that the form's sentence and the database's refusal are the same
// answer. These are those rules.
Object.defineProperty(exports, "__esModule", { value: true });
const memberInvites_1 = require("./memberInvites");
const gymPasses_1 = require("./gymPasses");
const gymPtSchedule_1 = require("./gymPtSchedule");
const gymSessions_1 = require("./gymSessions");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
        errors.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
};
/* ── the plan an imported member row joins on ──────────────────────────────── */
const book = [
    { id: 'p1', name: 'Monthly' },
    { id: 'p2', name: 'Off peak' },
];
eq((0, memberInvites_1.planIdFor)('Monthly', book), 'p1', 'a plan named exactly as the gym sells it is matched');
eq((0, memberInvites_1.planIdFor)('  monthly ', book), 'p1', 'and matched past the casing and spacing of an export');
eq((0, memberInvites_1.planIdFor)(null, book), null, 'a row naming no plan carries no plan');
eq((0, memberInvites_1.planIdFor)('', book), null, 'and neither does a blank cell');
// The three nulls that matter, because the alternative to each is a price
// somebody never agreed to.
eq((0, memberInvites_1.planIdFor)('Platinum', book), null, 'a plan this gym does not sell is NOT approximated to the nearest one it does');
eq((0, memberInvites_1.planIdFor)('Monthly', [{ id: 'a', name: 'Monthly' }, { id: 'b', name: 'monthly' }]), null, 'and a name the gym sells twice does not say which, so it says nothing');
eq((0, memberInvites_1.planIdFor)('Monthly', []), null, 'an empty price book matches nothing rather than inventing an id');
/* ── the bulk invite screen ────────────────────────────────────────────────── */
// screenInvites is what stands between a pasted spreadsheet and a batch insert
// that fails halfway. The rows keep their own line numbers through it, which is
// the whole reason the import screen can report "line 14" rather than a
// position in a filtered array.
const rows = [
    { line: 2, email: 'jane@example.com' },
    { line: 3, email: 'not-an-address' },
    { line: 4, email: 'JANE@example.com' },
    { line: 5, email: 'sam@example.com' },
];
const screened = (0, memberInvites_1.screenInvites)(rows, ['sam@example.com']);
eq(screened.send.map((r) => r.line), [2], 'only the row that can be sent is sent');
eq(screened.rejected.map((r) => r.row.line), [3, 4, 5], 'and every other row is named, not dropped');
ok(/more than once/.test(screened.rejected[1].reason), 'the same address twice in one file is caught inside the batch, not by the insert');
ok(/already an invitation waiting/.test(screened.rejected[2].reason), 'and an address this gym already has an invite open for is refused with the reason');
eq(screened.rejected[0].row.line, 3, 'a rejected row still carries the line of the sheet it came from');
// The same rule the single-invite form asks before it writes.
eq((0, memberInvites_1.inviteBlocker)('jane@example.com'), null, 'a plain address is sendable');
ok((0, memberInvites_1.inviteBlocker)('jane@') !== null, 'and something that is not an address is refused before the round trip');
eq((0, memberInvites_1.normaliseEmail)(' Jane@Example.com '), 'jane@example.com', 'addresses compare case-insensitively');
/* ── a pass type ───────────────────────────────────────────────────────────── */
const passDraft = {
    name: 'Day pass', kind: 'drop_in',
    priceCents: 4000, currency: 'GBP', uses: 1, validDays: null,
};
eq((0, gymPasses_1.passTypeBlocker)(passDraft), null, 'a named, priced pass in a stated currency goes on sale');
eq((0, gymPasses_1.passTypeBlocker)({ ...passDraft, validDays: 30 }), null, 'and so does one that expires');
ok((0, gymPasses_1.passTypeBlocker)({ ...passDraft, name: '   ' }) !== null, 'a pass with no name is refused');
ok((0, gymPasses_1.passTypeBlocker)({ ...passDraft, priceCents: null }) !== null, 'a pass with no price is refused rather than sold for nothing');
ok((0, gymPasses_1.passTypeBlocker)({ ...passDraft, priceCents: NaN }) !== null, 'an unreadable price is an unfinished form, not a free pass');
eq((0, gymPasses_1.passTypeBlocker)({ ...passDraft, priceCents: 0 }), null, 'a genuinely free pass is allowed — 0 typed on purpose is a price');
// The currency rule, which is the one that cost this codebase a whole ledger.
ok((0, gymPasses_1.passTypeBlocker)({ ...passDraft, currency: null }) !== null, 'a price with no currency is refused: every pass sold on the type inherits it');
ok((0, gymPasses_1.passTypeBlocker)({ ...passDraft, currency: '  ' }) !== null, 'and blank is not a currency either');
ok((0, gymPasses_1.passTypeBlocker)({ ...passDraft, uses: 0 }) !== null, 'a pass worth no visits is refused');
ok((0, gymPasses_1.passTypeBlocker)({ ...passDraft, uses: 2.5 }) !== null, 'and half a visit is not a pack');
ok((0, gymPasses_1.passTypeBlocker)({ ...passDraft, validDays: 0 }) !== null, '0 days is refused — a pass that does not expire is blank, and the two are different');
ok(/blank/.test((0, gymPasses_1.passTypeBlocker)({ ...passDraft, validDays: 0 }) ?? ''), 'and the sentence says which one they meant');
/* ── booking a one-to-one from the desk ────────────────────────────────────── */
// There is one notion of a booked session in this product. book_session in
// 09-sessions-access.sql writes client_id, status 'booked' and released false;
// cancel_session writes the inverse. Studio writes the same three or it has
// invented a second kind of booking that payroll and the app cannot see.
eq((0, gymPtSchedule_1.bookingFields)('c1'), { client_id: 'c1', status: 'booked', released: false }, 'booking a member to a slot writes exactly what the app’s own booking writes');
eq((0, gymPtSchedule_1.bookingFields)(null), { client_id: null, status: 'available', released: true }, 'and freeing one writes exactly what cancel_session writes');
// `released` is not left alone in either direction: a slot re-booked while it
// still said released would read as free capacity that is not free.
ok((0, gymPtSchedule_1.bookingFields)('c1').released === false, 'a booked slot is not also given back');
ok((0, gymPtSchedule_1.bookingFields)(null).released === true, 'and a freed one says it was given back');
const slot = {
    trainerId: 't1', startsAt: '2026-09-10T17:00:00.000Z', durationMin: 60,
};
eq((0, gymPtSchedule_1.slotBlocker)({ ...slot }), null, 'an open slot needs no member');
eq((0, gymPtSchedule_1.slotBlocker)({ ...slot, clientId: 'c1' }), null, 'and one booked to a member is fine');
eq((0, gymPtSchedule_1.slotBlocker)({ ...slot, blocked: true }), null, 'as is an hour held for nobody');
ok((0, gymPtSchedule_1.slotBlocker)({ ...slot, blocked: true, clientId: 'c1' }) !== null, 'but an hour cannot be both held off sale and booked to somebody');
ok(/hold it/.test((0, gymPtSchedule_1.slotBlocker)({ ...slot, blocked: true, clientId: 'c1' }) ?? ''), 'and the sentence names the two decisions rather than picking one');
// A held slot reports no places at all, which is why the two above cannot be
// combined: the member booked into it would vanish from the board's headcount.
const held = {
    id: 's1', trainerId: 't1', trainerName: 'Dana', clientId: 'c1', clientName: 'Jane',
    startsAt: slot.startsAt, durationMin: 60, room: null, status: 'blocked',
    outcome: null, settlementId: null,
};
eq((0, gymPtSchedule_1.ptEntry)(held).booked, null, 'a blocked slot reports no places held');
eq((0, gymPtSchedule_1.ptEntry)({ ...held, status: 'booked' }).booked, 1, 'and a booked one reports the one it holds');
// The double-booking constraint is the database's, and this only renames it.
ok(((0, gymPtSchedule_1.bookingRefusalNote)({ code: '23P01' }) ?? '').includes('already has a booked session'), 'an exclusion violation is reported as the trainer being taken, in words');
eq((0, gymPtSchedule_1.bookingRefusalNote)({ code: '23505' }), null, 'nothing else is reworded');
eq((0, gymPtSchedule_1.bookingRefusalNote)(null), null, 'and a missing error is not turned into a conflict');
// sessions.client_id references clients(id), not profiles(id), so somebody can
// hold a membership and still not be bookable. That is the schema's answer and
// it must not arrive as a constraint name.
ok(((0, gymPtSchedule_1.bookingRefusalNote)({
    code: '23503',
    message: 'insert or update on table "sessions" violates foreign key constraint "sessions_client_id_fkey"',
}) ?? '').includes('no client record'), 'a member with no client record is told so, in words');
eq((0, gymPtSchedule_1.bookingRefusalNote)({
    code: '23503',
    message: 'insert or update on table "sessions" violates foreign key constraint "sessions_trainer_id_fkey"',
}), null, 'and the trainer’s own foreign key is not reported as the member’s — same code, different fault');
/* ── how a settlement was paid ─────────────────────────────────────────────── */
eq([...gymSessions_1.SETTLEMENT_METHODS], ['transfer', 'cash', 'payroll', 'other'], 'the four methods are the four payroll_settlements.method allows');
ok(gymSessions_1.SETTLEMENT_METHODS.every((m) => !!gymSessions_1.SETTLEMENT_METHOD_LABEL[m]), 'and every one of them has words for the screen, so no row prints a column name');
ok(gymSessions_1.SETTLEMENT_METHOD_LABEL.payroll !== 'payroll', '"through payroll" is a sentence; "payroll" beside a Method heading is not');
if (errors.length) {
    errors.forEach((e) => console.error('FAIL', e));
    process.exit(1);
}
console.log('studioWrites ok — the console’s new writes obey the same rules the database does');
