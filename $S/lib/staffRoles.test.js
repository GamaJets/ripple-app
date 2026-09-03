"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The staff roster, the fourth role, and the removal that refuses to be half a
// removal. Compile with tsc, run with node.
//
// The three things asserted hardest, all of them access decisions rather than
// display ones:
//
//   1. `owner` is not a grantable role and never becomes one by accident.
//      STAFF_ROLES is a list somebody will one day widen; the assertions below
//      are what make widening it a deliberate act.
//   2. A coach who still has clients on their book cannot be quietly removed.
//      `is_my_client()` reads `clients.trainer_id` and has no gym in it, so the
//      removal would leave a complete read of those people's health history
//      behind — and the owner would have been told they were gone.
//   3. An UNREAD book is not an empty one. `clientsOnBook: null` has to block,
//      because a failed count that produced a confident Remove button is
//      exactly the shape of defect this codebase keeps finding.
const staffRoles_1 = require("./staffRoles");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const OWNER = 'owner-uuid';
const GYM = 'gym-uuid';
const THEM = 'them-uuid';
/* ── the vocabulary ────────────────────────────────────────────────────── */
eq(staffRoles_1.STAFF_ROLES.length, 2, 'there are two grantable staff roles');
ok(staffRoles_1.STAFF_ROLES.includes('trainer') && staffRoles_1.STAFF_ROLES.includes('receptionist'), 'and they are coach and reception');
ok(!staffRoles_1.STAFF_ROLES.includes('owner'), 'ownership is NOT grantable from a staff roster — a function that makes a second owner makes a compromised account permanent');
ok(!staffRoles_1.STAFF_ROLES.includes('client'), 'and neither is membership, which is not a grant of anything');
// Every value the column can hold has a word, including the two that are not
// grantable — the roster still has to be able to print what somebody IS.
for (const r of ['owner', 'trainer', 'client', 'receptionist']) {
    ok(!!staffRoles_1.ROLE_LABEL[r], `${r} has a label`);
}
eq(staffRoles_1.ROLE_LABEL.trainer, 'Coach', 'a trainer is called a coach on screen, as everywhere else in this product');
eq(staffRoles_1.ROLE_LABEL.receptionist, 'Reception', 'and the new one is the desk');
// The distinction that makes the role worth having at all.
ok(/roster row/.test(staffRoles_1.STAFF_ROLE_NOTE.trainer) && /payroll/.test(staffRoles_1.STAFF_ROLE_NOTE.trainer), 'the coach note says they get a roster row and a place in payroll');
ok(/no roster row|no book/.test(staffRoles_1.STAFF_ROLE_NOTE.receptionist), 'and the reception note says they do not');
ok(/paid/.test(staffRoles_1.STAFF_ROLE_NOTE.receptionist), 'and that they see nothing about what anybody is paid, which is the case D5 named');
/* ── the reach table ───────────────────────────────────────────────────── */
ok(staffRoles_1.STAFF_ROLE_REACH.length > 0, 'there is a reach table to show an owner');
for (const r of staffRoles_1.STAFF_ROLE_REACH) {
    ok(!!r.what && !!r.owner && !!r.trainer && !!r.receptionist, `"${r.what}" answers for every role — a blank cell would be read as "no" and might be "yes"`);
}
const byWhat = (s) => staffRoles_1.STAFF_ROLE_REACH.find((r) => r.what.toLowerCase().includes(s));
const door = byWhat('door');
ok(!!door && /write/i.test(door.receptionist), 'reception can work the door — the whole point of the role');
const records = byWhat('member records');
ok(!!records && /read/i.test(records.receptionist), 'and read the member record');
ok(!!records && !/write/i.test(records.receptionist), 'but not write it — that stays the owner’s');
const health = byWhat('training and health');
eq(health?.receptionist, 'No', 'reception reaches no member’s training or health record');
eq(health?.owner, 'No', 'and neither does the owner — that follows the coaching book, not the gym');
const pay = byWhat('what anybody is paid');
eq(pay?.receptionist, 'No', 'and nothing about what anybody is paid');
ok(!!pay?.note && /session fee/i.test(pay.note), 'while saying out loud that the gym’s headline session fee is a different thing and is readable by everybody inside the gym — an assurance that overstated itself would be worse than none');
ok(/console has not caught up|no screen/i.test(staffRoles_1.CONSOLE_LAG_NOTE), 'and the table is introduced as what the DATABASE allows, not what the console does');
/* ── who may be granted what ───────────────────────────────────────────── */
const grant = (over = {}) => (0, staffRoles_1.grantBlocker)({
    subjectId: THEM, subjectRole: 'client', subjectTenantId: null,
    actorId: OWNER, tenantId: GYM, role: 'receptionist', ...over,
});
eq(grant(), null, 'an ordinary account with no gym can be taken on');
eq(grant({ subjectTenantId: GYM }), null, 'and so can somebody already in this gym — a member becoming staff is the ordinary case');
ok(!!grant({ subjectId: '' }), 'nobody selected is refused');
ok(!!grant({ subjectId: '   ' }), 'and whitespace is nobody');
ok(!!grant({ role: '' }), 'and a grant with no role is refused rather than defaulted to one');
const self = grant({ subjectId: OWNER });
ok(!!self && /own this gym/.test(self), 'an owner cannot grant themselves a staff role — it would take their own access away');
const owner = grant({ subjectRole: 'owner' });
ok(!!owner && /Ownership is not changed/.test(owner), 'and an owner is never demoted from a staff screen');
const elsewhere = grant({ subjectTenantId: 'another-gym' });
ok(!!elsewhere && /another gym/.test(elsewhere), 'somebody who belongs to another gym is refused rather than quietly moved out of it');
// The three states, again. A failed read of the subject is not a subject with
// no role, and granting over one is granting blind.
const unread = grant({ subjectRole: null, subjectRoleUnread: true });
ok(!!unread && /failed query/.test(unread), 'an account that could not be READ blocks the grant, and says it is a failed query rather than a missing person');
eq(grant({ subjectRole: null }), null, 'while an account read successfully that simply has no role is grantable — the two must not collapse');
/* ── who may be removed, and what removing does not do ─────────────────── */
const revoke = (over = {}) => (0, staffRoles_1.revokeBlocker)({
    subjectId: THEM, subjectRole: 'receptionist', actorId: OWNER, clientsOnBook: 0, ...over,
});
eq(revoke(), null, 'a receptionist with nobody on their book comes off cleanly');
eq(revoke({ subjectRole: 'trainer' }), null, 'and so does a coach whose book is empty');
const me = revoke({ subjectId: OWNER });
ok(!!me && /nobody who can administer/.test(me), 'an owner is not removable — a gym with nobody who can administer it cannot be repaired from inside the product');
ok(!!revoke({ subjectRole: 'owner' }), 'in either spelling of the same case');
const member = revoke({ subjectRole: 'client' });
ok(!!member && /member of this gym rather than staff/.test(member), 'a member has no staff access to take away');
// THE one.
const withBook = revoke({ subjectRole: 'trainer', clientsOnBook: 3 });
ok(!!withBook && /3 clients/.test(withBook), 'a coach with a book is refused, with the count in it');
ok(!!withBook && /would NOT take away/.test(withBook), 'and the refusal says what the removal would fail to do rather than merely that it is not allowed');
ok(!!withBook && /follows the book rather than the gym/.test(withBook), 'and why — the access reads clients.trainer_id and has no gym in it');
const one = revoke({ subjectRole: 'trainer', clientsOnBook: 1 });
ok(!!one && /1 client\b/.test(one), 'and it counts one client as one client');
// Unknown is not zero. This is the assertion that stops a failed count becoming
// a confident Remove.
const unknownBook = revoke({ subjectRole: 'trainer', clientsOnBook: null });
ok(!!unknownBook && /unknown, not empty/.test(unknownBook), 'an unread book blocks the removal and says it is unknown rather than empty');
ok(/roster row is kept/.test((0, staffRoles_1.revokeConsequence)('trainer')), 'removing a coach keeps their roster row — one who left is not one who never existed');
ok(/Nothing they delivered is deleted/.test((0, staffRoles_1.revokeConsequence)('trainer')), 'and deletes nothing they delivered');
ok(/door log keeps their entries/.test((0, staffRoles_1.revokeConsequence)('receptionist')), 'and removing a receptionist keeps the door entries they made');
ok(/stop belonging to this gym/.test((0, staffRoles_1.revokeConsequence)('receptionist')), 'while both say the access closes immediately');
/* ── the two calls ─────────────────────────────────────────────────────── */
const rpc = (data, error = null) => {
    const calls = [];
    return {
        calls,
        sb: {
            rpc: async (fn, args) => {
                calls.push({ fn, args: args ?? {} });
                return { data, error };
            },
        },
    };
};
(async () => {
    {
        const { calls, sb } = rpc({ grant_id: 'g1', roster_row: true, was: 'client' });
        const out = await (0, staffRoles_1.grantStaffRole)(sb, THEM, 'trainer', 'Started Monday');
        eq(calls[0].fn, 'grant_staff_role', 'the grant goes through the database function, not an update');
        eq(calls[0].args.p_subject, THEM, 'with the person');
        eq(calls[0].args.p_role, 'trainer', 'and the role');
        eq(calls[0].args.p_note, 'Started Monday', 'and the note, which is what the record will carry');
        // There is deliberately no tenant argument: the function takes the gym from
        // the caller, so there is no wrong gym to supply.
        ok(!('p_tenant' in calls[0].args), 'and no gym id — the function takes that from the caller, so there is no wrong one to pass');
        eq(out.grantId, 'g1', 'the grant id comes back so the screen can show the record it just wrote');
        eq(out.rosterRow, true, 'a coach gets a roster row');
        eq(out.was, 'client', 'and the screen can say what changed');
    }
    {
        const { sb } = rpc({ grant_id: 'g2', roster_row: false, was: null });
        const out = await (0, staffRoles_1.grantStaffRole)(sb, THEM, 'receptionist');
        eq(out.rosterRow, false, 'a receptionist does NOT get a roster row — the desk is not on the coaching roster');
        eq(out.was, null, 'and an unknown previous role stays unknown rather than becoming "client"');
    }
    {
        const { calls, sb } = rpc(null);
        await (0, staffRoles_1.grantStaffRole)(sb, THEM, 'receptionist');
        eq(calls[0].args.p_note, null, 'an absent note is an explicit null rather than an empty string');
    }
    {
        // The database's own sentence survives. It is the only message that knows
        // which rule was broken.
        const { sb } = rpc(null, { message: 'That account already belongs to another gym. They have to leave it first.' });
        let threw = null;
        try {
            await (0, staffRoles_1.grantStaffRole)(sb, THEM, 'trainer');
        }
        catch (e) {
            threw = e?.message ?? null;
        }
        ok(!!threw && /already belongs to another gym/.test(threw), 'a refusal is thrown with the database’s own words, not replaced by a house string');
    }
    {
        const { calls, sb } = rpc({ was: 'receptionist', clients_on_book: 0 });
        const out = await (0, staffRoles_1.revokeStaffRole)(sb, THEM, 'Left in September');
        eq(calls[0].fn, 'revoke_staff_role', 'the removal goes through the database too');
        eq(calls[0].args.p_note, 'Left in September', 'carrying the reason onto the record');
        eq(out.was, 'receptionist', 'and reporting what they were');
        eq(out.clientsOnBook, 0, 'and that the book was empty');
    }
    {
        const { sb } = rpc({ was: 'trainer', clients_on_book: 'not a number' });
        const out = await (0, staffRoles_1.revokeStaffRole)(sb, THEM);
        eq(out.clientsOnBook, null, 'an unreadable count is null, never 0 — the one substitution that would say "nobody is affected"');
    }
    {
        const { sb } = rpc(null, { message: 'That coach still has 4 client(s) on their book.' });
        let threw = null;
        try {
            await (0, staffRoles_1.revokeStaffRole)(sb, THEM);
        }
        catch (e) {
            threw = e?.message ?? null;
        }
        ok(!!threw && /4 client/.test(threw), 'and the database’s refusal carries its own count');
    }
    /* ── the record ─────────────────────────────────────────────────────── */
    const row = {
        id: 'g1', subject_id: THEM, subject_name: 'Sam', actor_id: OWNER, actor_name: 'Tim',
        role: 'receptionist', granted_at: '2026-09-01T09:00:00Z',
        revoked_at: null, revoked_by: null, revoked_by_name: null, note: 'Front desk',
    };
    const g = (0, staffRoles_1.grantFromRow)(row);
    ok(!!g && g.role === 'receptionist' && g.subjectId === THEM, 'a complete row reads back');
    ok(!!g && (0, staffRoles_1.isLiveGrant)(g), 'and one with no revocation is the grant in force');
    eq((0, staffRoles_1.grantFromRow)(null), null, 'no row is no grant');
    // Half-written audit rows. A row with no date or no role is not evidence of
    // anything and must not be rendered as though it were.
    eq((0, staffRoles_1.grantFromRow)({ ...row, granted_at: null }), null, 'a grant with no date is not a record');
    eq((0, staffRoles_1.grantFromRow)({ ...row, id: null }), null, 'nor one with no identity of its own');
    eq((0, staffRoles_1.grantFromRow)({ ...row, role: 'owner' }), null, 'and a row claiming an owner grant is refused here too — the function cannot write one, so a row holding one is not to be rendered as a grant');
    // The erasure case, which is the reason the names are stored. `on delete set
    // null` takes the ids and leaves the record; a reader that required them
    // would discard exactly the rows the snapshot was added to preserve.
    const erased = (0, staffRoles_1.grantFromRow)({ ...row, subject_id: null, actor_id: null });
    ok(!!erased, 'a grant whose people have since been erased is STILL a record and still reads back');
    eq(erased?.actorName, 'Tim', 'because the name was snapshotted when the grant was made');
    eq(erased?.subjectName, 'Sam', 'at both ends');
    eq(erased?.actorId, null, 'while the account it pointed at is honestly gone');
    const dead = (0, staffRoles_1.grantFromRow)({ ...row, revoked_at: '2026-09-30T17:00:00Z', revoked_by: OWNER, revoked_by_name: 'Tim' });
    ok(!!dead && !(0, staffRoles_1.isLiveGrant)(dead), 'a revoked grant is not in force');
    ok(!!dead && dead.revokedAt === '2026-09-30T17:00:00Z', 'and keeps its end date — "was staff from March to September" is the fact somebody needs');
    ok(/join code/.test((0, staffRoles_1.grantNote)(null, 'Tim')), 'somebody with no recorded grant is said to have joined by join code, not left blank — a blank beside "who granted this" reads as nobody having granted it');
    ok(/Granted by Tim/.test((0, staffRoles_1.grantNote)(g, 'Tim')), 'and a grant names who made it');
    ok(/Granted by Tim/.test((0, staffRoles_1.grantNote)(g, 'Somebody Else')), 'from the row itself rather than from whatever the caller could look up now — the stored name is the evidence');
    ok(/could not read/.test((0, staffRoles_1.grantNote)((0, staffRoles_1.grantFromRow)({ ...row, actor_name: null }), null)), 'a name that could not be read says so rather than printing a dash as the subject of the sentence');
    ok(/has since been erased/.test((0, staffRoles_1.grantNote)((0, staffRoles_1.grantFromRow)({ ...row, actor_name: null, actor_id: null }), null)), 'and an erased owner is a different sentence from an unreadable one');
    ok(/Access ended/.test((0, staffRoles_1.grantNote)(dead, 'Tim')), 'and a revoked one says so first');
    // No date is formatted anywhere in this module: it is pure, it runs under six
    // timezones, and a calendar day needs the gym's zone, which the caller has.
    ok(!/\d{1,2} \w+ 20\d\d/.test((0, staffRoles_1.grantNote)(g, 'Tim')), 'and no calendar date is formatted in here — the caller has the gym’s timezone and this does not');
    if (errors.length) {
        console.error(`staffRoles: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
        for (const e of errors)
            console.error(`  ✗ ${e}`);
        process.exit(1);
    }
    console.log('staffRoles ok');
})();
