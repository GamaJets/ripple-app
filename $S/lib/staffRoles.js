"use strict";
// Who works at a gym, what each of them can reach, and who is on record as
// having let them in.
//
// ── The gap this is the console half of ───────────────────────────────────
//
// Two things were true before supabase/parts/711 and they are the same thing:
//
//   · Nobody could be added to or removed from a gym's staff. The only route in
//     was the coach accepting a join code, and there was no route out at all.
//     `guard_profile_identity` (part 38) refuses a profile changing its own
//     role and says "Ask the gym owner to change it for you"; there was no
//     function by which the gym owner could.
//   · A receptionist had no role of their own. `profiles.role` held owner,
//     trainer and client, and everything the front desk does is policed by
//     `my_role() in ('trainer','owner')` — so the person on the desk was either
//     made a coach, with a roster row and a place in payroll and a book they do
//     not have, or worked the door from somebody else's login.
//
// ── What is in here and what is deliberately not ──────────────────────────
//
// The database is the authority and this module never duplicates it. The two
// RPCs do every check themselves — who the caller is, whose gym it is, whether
// the subject belongs somewhere else, whether removing a coach would leave
// their access to a book behind — and they raise rather than returning a flag.
//
// What is here is the two things a console needs and the database cannot give
// it: the sentence to put in front of an owner BEFORE they press the button,
// and the per-role reach table, which is the thing that makes the button an
// informed decision rather than a shrug. `STAFF_ROLE_REACH` is a copy of the
// table in part 711's footer and says so, in both places, because it is the
// text an owner reads while granting somebody access to every member's medical
// note and it must not quietly drift from what the policies actually do.
//
// Framework-agnostic like the rest of src/lib: the Supabase client arrives as
// an argument.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSOLE_LAG_NOTE = exports.STAFF_ROLE_REACH = exports.STAFF_ROLE_NOTE = exports.ROLE_LABEL = exports.STAFF_ROLES = void 0;
exports.grantBlocker = grantBlocker;
exports.revokeBlocker = revokeBlocker;
exports.revokeConsequence = revokeConsequence;
exports.grantStaffRole = grantStaffRole;
exports.revokeStaffRole = revokeStaffRole;
exports.grantFromRow = grantFromRow;
exports.isLiveGrant = isLiveGrant;
exports.grantNote = grantNote;
exports.STAFF_ROLES = ['trainer', 'receptionist'];
/** What each role is called on screen. Title case, as a label. */
exports.ROLE_LABEL = {
    owner: 'Owner',
    trainer: 'Coach',
    receptionist: 'Reception',
    client: 'Member',
};
/** One line saying what the role IS, in the words an owner choosing between
 *  them needs. Sentence case: these are read as statements. */
exports.STAFF_ROLE_NOTE = {
    trainer: 'A coach. Gets a roster row, a place in the rota and in payroll, and a book of their own — and, through that book, the training and health record of every client assigned to them.',
    receptionist: 'The front desk. The door and every member’s record; no book, no roster row, no place in payroll, and nothing about what anybody is paid.',
};
/**
 * What each role can reach. A copy of the table in supabase/parts/711's footer,
 * and the SQL file is the one to change first — a table on a screen that
 * disagrees with the policies is worse than no table, because it is read as an
 * assurance.
 *
 * Only the rows an owner making this decision would ask about. The full list is
 * in the part file.
 */
exports.STAFF_ROLE_REACH = [
    {
        what: 'The door log',
        owner: 'Everything', trainer: 'Read and write', receptionist: 'Read and write',
        note: 'Taking somebody in, marking them out, and the head count. This is what the desk is for.',
    },
    {
        what: 'Member records',
        owner: 'Read and write', trainer: 'Read', receptionist: 'Read',
        note: 'Contact details, next of kin and the gym’s operational medical note about every member. This is the grant worth recording, and it is why granting a role is written down.',
    },
    {
        what: 'A member’s training and health record',
        owner: 'No', trainer: 'Their own book only', receptionist: 'No',
        note: 'Workouts, measurements, check-ins, scans, food logs and the private conversation with their coach. It follows the book, not the gym — which is why removing a coach who still has clients is refused rather than done by halves.',
    },
    {
        what: 'Passes and drop-ins',
        owner: 'Everything', trainer: 'Read and write', receptionist: 'No',
        note: 'Not yet widened. Selling a day pass at the desk is a plausible next line in this table and it is a decision somebody has to make in a part file.',
    },
    {
        what: 'What anybody is paid',
        owner: 'Everything', trainer: 'Their own', receptionist: 'No',
        note: 'Shift rates, payroll, settlements and per-coach earnings. The gym’s own headline session fee is a different thing and is readable by everybody inside the gym, including members — it always has been.',
    },
    {
        what: 'Plans, payments and the ledger',
        owner: 'Everything', trainer: 'No', receptionist: 'No',
    },
    {
        what: 'Gym settings',
        owner: 'Read and write', trainer: 'Read', receptionist: 'Read',
        note: 'The gym’s name, brand, currency and timezone. Read by everybody inside the gym; changed by the owner alone.',
    },
];
/**
 * The sentence that goes above the table, because the table alone would be
 * read as a description of the product and it is a description of the database.
 */
exports.CONSOLE_LAG_NOTE = 'This is what the database allows. The console has not caught up: every screen here still refuses anybody who is not an owner or a coach, so a receptionist added today is recorded and enforced and has no screen to sign in to yet.';
/* ── before the button is pressed ──────────────────────────────────────────── */
/**
 * Why this grant cannot be made, or null.
 *
 * Every rule below is one the RPC ALSO enforces and raises on. This is not the
 * guarantee and must never be read as one — the guarantee is `grant_staff_role`,
 * which runs as the database and checks the caller rather than trusting a form.
 * This exists so the refusal arrives beside the field the owner is looking at
 * instead of after a round trip, which is the arrangement part 166 describes
 * for the currency and the reason both halves are kept.
 */
function grantBlocker(input) {
    const id = String(input.subjectId ?? '').trim();
    if (!id)
        return 'Pick an account to put on the roster.';
    if (!input.role)
        return 'Say what they are being taken on as.';
    if (id === input.actorId) {
        return 'You already own this gym. Granting yourself a staff role would take your own access away.';
    }
    if (input.subjectRoleUnread) {
        return 'That account could not be read, so this console does not know what changing it would do. That is a failed query rather than a person who does not exist — reload before granting anything.';
    }
    if (input.subjectRole === 'owner') {
        return 'That account owns a gym. Ownership is not changed from the staff roster.';
    }
    if (input.subjectTenantId && input.subjectTenantId !== input.tenantId) {
        return 'That account already belongs to another gym. They have to leave it before they can join this one.';
    }
    return null;
}
/**
 * Why this person cannot simply be removed, or null.
 *
 * `clientsOnBook` is the one that matters and the one an owner will not expect,
 * so it is a sentence rather than a "cannot": removing a coach does NOT remove
 * their access to the clients pointed at them, because that access reads
 * `clients.trainer_id` and has no gym in it. The RPC refuses the same case with
 * the same reasoning; this is what puts it in front of somebody first.
 *
 * `null` for `clientsOnBook` is "we could not count them", which is not zero.
 * An unread book must not produce a confident Remove button.
 */
function revokeBlocker(input) {
    if (input.subjectId === input.actorId || input.subjectRole === 'owner') {
        return 'An owner is not removed from the staff roster — a gym with nobody who can administer it cannot be repaired from inside the product.';
    }
    if (input.subjectRole !== 'trainer' && input.subjectRole !== 'receptionist') {
        return 'That account is a member of this gym rather than staff, so there is no staff access to take away.';
    }
    if (input.clientsOnBook == null) {
        return 'Their book could not be read, so this console cannot tell whether removing them would leave their access to somebody’s health record behind. That is unknown, not empty.';
    }
    if (input.clientsOnBook > 0) {
        return `They still have ${input.clientsOnBook} client${input.clientsOnBook === 1 ? '' : 's'} on their book. Taking them off the staff would NOT take away their access to those clients’ training and health record — that access follows the book rather than the gym. Reassign or end those relationships first.`;
    }
    return null;
}
/** What actually happens when the button is pressed, said before it is. Two
 *  sentences, because the second one is the one nobody expects. */
function revokeConsequence(role) {
    const who = role === 'receptionist' ? 'They' : 'They';
    return `${who} stop belonging to this gym: the door, the member records and everything else scoped to it close immediately. `
        + (role === 'trainer'
            ? 'Their roster row is kept — a coach who left is not a coach who never existed, and every figure already filed against them still resolves to a name. Nothing they delivered is deleted.'
            : 'Nothing they recorded is deleted; the door log keeps their entries and who made them.');
}
/**
 * Put somebody on this gym's staff.
 *
 * Rejects with the database's own message rather than a rewritten one. Every
 * refusal `grant_staff_role` raises is a sentence written for the person
 * reading it — "That account already belongs to another gym", not a code — and
 * a wrapper that replaced them with a house string would throw away the only
 * message that knows which rule was broken.
 *
 * Note what is NOT checked here: the row count. Unlike an `update`, an RPC that
 * did nothing raises; there is no equivalent of the silent zero-row write
 * `assertWrote` exists for, because the function refuses in the database rather
 * than being filtered out by a policy.
 */
async function grantStaffRole(sb, subjectId, role, note) {
    const { data, error } = await sb.rpc('grant_staff_role', {
        p_subject: subjectId, p_role: role, p_note: note ?? null,
    });
    if (error)
        throw new Error(error.message || 'That grant was refused, so nothing changed.');
    const r = (data ?? {});
    return {
        grantId: r.grant_id ?? null,
        role,
        rosterRow: r.roster_row === true,
        was: r.was ?? null,
    };
}
/** Take somebody off this gym's staff. Raises — with the count in the message —
 *  when they are a coach who still has clients on their book. */
async function revokeStaffRole(sb, subjectId, note) {
    const { data, error } = await sb.rpc('revoke_staff_role', {
        p_subject: subjectId, p_note: note ?? null,
    });
    if (error)
        throw new Error(error.message || 'That removal was refused, so nothing changed.');
    const r = (data ?? {});
    const n = Number(r.clients_on_book);
    return {
        was: r.was ?? null,
        clientsOnBook: Number.isFinite(n) ? n : null,
    };
}
/**
 * One `staff_grants` row → the shape a screen renders.
 *
 * Null for a row that is not a record of anything: no id, no date, or a role
 * the two functions cannot write. A half-written audit row is not evidence and
 * showing one under "how they got here" would be worse than the honest blank
 * everybody who joined by join code gets.
 *
 * What is deliberately NOT required is an id for either person. `subject_id`
 * and `actor_id` are `on delete set null` — part 711 takes part 184's shape so
 * an account erasure cannot be blocked by an access log — and the snapshotted
 * name is what keeps the row legible afterwards. Requiring the id here would
 * throw away exactly the rows the snapshot was added to preserve.
 */
function grantFromRow(row) {
    if (!row)
        return null;
    const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
    const id = str(row.id), at = str(row.granted_at);
    const role = row.role === 'trainer' || row.role === 'receptionist' ? row.role : null;
    if (!id || !at || !role)
        return null;
    return {
        id,
        subjectId: str(row.subject_id),
        subjectName: str(row.subject_name),
        actorId: str(row.actor_id),
        actorName: str(row.actor_name),
        role,
        grantedAt: at,
        revokedAt: str(row.revoked_at),
        revokedBy: str(row.revoked_by),
        revokedByName: str(row.revoked_by_name),
        note: str(row.note),
    };
}
/** Whether a grant is the one currently in force. */
function isLiveGrant(g) {
    return g.revokedAt == null;
}
/**
 * The sentence under a person's name saying who put them there.
 *
 * `null` for the grant is a real and common answer — everybody on a roster
 * today joined by accepting a join code, before `staff_grants` existed — and it
 * says so rather than leaving a blank, because a blank beside "who granted
 * this" reads as nobody having granted it.
 *
 * `actorName` is what the caller could look up NOW; `g.actorName` is what the
 * row itself recorded at the time. The stored one wins, because it is the
 * evidence: the person may have changed their name, and they may have been
 * erased, and in the second case the caller has nothing to look up at all. That
 * is the whole reason the column exists.
 *
 * The date is deliberately NOT formatted here. This module is pure and runs
 * under six timezones in `npm run test:zones`; the day a grant was made is a
 * calendar fact and a calendar needs the gym's own zone, which the caller has
 * and this does not. The caller formats it with `timeZone` from
 * `tenants.timezone` — see src/lib/gymZone.ts.
 */
function grantNote(g, actorName) {
    if (!g) {
        return 'No recorded grant — they joined with the gym’s join code, before there was anywhere to write down who let them in.';
    }
    const by = g.actorName
        ?? actorName
        // Two ways to get here and they are different, so the sentence covers both
        // rather than picking one and being wrong half the time.
        ?? (g.actorId ? 'somebody whose name this console could not read' : 'an owner whose account has since been erased');
    return g.revokedAt
        ? `Access ended. Granted by ${by}.`
        : `Granted by ${by}.`;
}
