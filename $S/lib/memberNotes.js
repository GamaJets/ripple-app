"use strict";
// What the desk wrote about a member, and when, and who wrote it.
//
// ── What this replaces ─────────────────────────────────────────────────────
//
// One text column. `gym_member_records.note` is a single line with no author,
// no date and no history, and the form on /members writes it in place — so
// "she complained about the 6am class in March" is gone the moment somebody
// types "renewing in June" over the top of it. There is no undo, nothing says
// it changed, and the record an owner reaches for in a dispute is the one that
// keeps the least.
//
// Every gym keeps this as a running list, because that is what it is: a
// sequence of things that were true on a date. A note with no date is not
// evidence of anything, and a note with no author cannot be asked about.
//
// ── Append-only, on purpose ────────────────────────────────────────────────
//
// Nothing here edits or deletes a note. A record whose author can quietly
// rewrite what they wrote last month is worth less in the dispute it exists
// for than one that cannot be rewritten at all — the same argument
// supabase/parts/187 makes about the export log, and part 690 refuses the
// UPDATE and DELETE grants outright rather than leaving it to a screen to
// remember. A note written in error is answered by a note saying so.
//
// ── The line that was already there ────────────────────────────────────────
//
// The old single note is NOT migrated and NOT deleted. It is still on the
// member record, it is still searchable, and `withLegacy` below puts it at the
// bottom of the list labelled for what it is: a line whose author and date
// nobody kept. Moving it would invent an author; deleting it would lose the
// only note most gyms have.
//
// Framework-agnostic, like every other gym* module here: the Supabase client
// comes in as an argument so the console and the phone app can both use it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_NOTE = void 0;
exports.noteBlocker = noteBlocker;
exports.newestFirst = newestFirst;
exports.withLegacy = withLegacy;
exports.noteAttribution = noteAttribution;
exports.fetchMemberNotes = fetchMemberNotes;
exports.addMemberNote = addMemberNote;
const rowCap_1 = require("./rowCap");
/* ── pure rules ─────────────────────────────────────────────────────────────*/
/** The longest a note may be. Long enough for a paragraph about an incident,
 *  short enough that nobody pastes a contract into the roster. The column has
 *  the same limit, so this buys a sentence instead of a constraint violation. */
exports.MAX_NOTE = 2000;
/** Why this note cannot be saved, or null when it can. Null means go, like
 *  every other blocker in this codebase. */
function noteBlocker(body) {
    const b = (body ?? '').trim();
    if (!b)
        return 'Write the note first — an empty note records nothing and cannot be taken back once it is in the list.';
    if (b.length > exports.MAX_NOTE) {
        return `That is ${b.length} characters and the limit is ${exports.MAX_NOTE}. Notes are appended and never edited, so put the rest in a second one rather than cutting this short.`;
    }
    return null;
}
/**
 * Newest first, which is the order the desk reads them in.
 *
 * A note with no date sorts to the BOTTOM rather than the top: the only rows
 * without one are the legacy line and a row whose timestamp did not read, and
 * neither should push this morning's entry off the top of the list.
 */
function newestFirst(notes) {
    return [...notes].sort((a, b) => {
        const ta = a.writtenAt ? Date.parse(a.writtenAt) : Number.NEGATIVE_INFINITY;
        const tb = b.writtenAt ? Date.parse(b.writtenAt) : Number.NEGATIVE_INFINITY;
        if (tb !== ta)
            return tb - ta;
        return (b.id ?? '').localeCompare(a.id ?? '');
    });
}
/**
 * The list, with the old single note on the end where it belongs.
 *
 * `legacyNote` is `gym_member_records.note`, and `legacyAt` is that record's
 * `updated_at` — which is the last time ANY field on it changed, not the day
 * the note was written. So it is not used as the note's date: the row says its
 * date is unknown, because it is.
 */
function withLegacy(notes, memberId, legacyBody) {
    const body = (legacyBody ?? '').trim();
    const list = newestFirst(notes);
    if (!body)
        return list;
    return [...list, {
            id: null,
            memberId,
            body,
            writtenAt: null,
            writtenBy: null,
            writtenByName: null,
            legacy: true,
        }];
}
/** Who and when, in the desk's words. Never a bare dash: this line sits inside
 *  a sentence about a person, and an em dash as the subject of one reads as the
 *  screen having broken. */
function noteAttribution(n) {
    if (n.legacy)
        return 'written before notes were kept — no author or date';
    const who = n.writtenByName ?? 'somebody whose account has since gone';
    return n.writtenAt ? `${who}, ${new Date(n.writtenAt).toLocaleString()}` : who;
}
/* ── reads ─────────────────────────────────────────────────────────────────*/
function rowToNote(r) {
    const author = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
    return {
        id: r.id,
        memberId: r.member_id,
        body: r.body,
        writtenAt: r.written_at ?? null,
        writtenBy: r.written_by ?? null,
        writtenByName: author?.full_name ?? null,
        legacy: false,
    };
}
/**
 * Every note the gym has written about one member, newest first.
 *
 * Capped through src/lib/rowCap.ts and it REFUSES rather than returning a
 * prefix. A truncated read here is not a smaller number, it is a false
 * statement about what a named person's record says — and this is the record an
 * owner opens in a dispute, where the missing note is the one that mattered.
 */
async function fetchMemberNotes(sb, tenantId, memberId) {
    const { data, error } = await sb
        .from('gym_member_notes')
        .select('id, member_id, body, written_at, written_by, profiles!gym_member_notes_written_by_fkey(full_name)')
        .eq('tenant_id', tenantId)
        .eq('member_id', memberId)
        .order('written_at', { ascending: false })
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    return (0, rowCap_1.assertWhole)(data, 'the notes on this member').map(rowToNote);
}
/* ── writes ────────────────────────────────────────────────────────────────*/
/**
 * Add a note. There is no other write in this module.
 *
 * `written_by` is sent rather than derived, because the console knows who is
 * signed in; the table's own default is `auth.uid()`, so a caller that omits it
 * still cannot file a note under somebody else's name.
 *
 * The count is not checked here and `.select()` is what makes the refusal
 * visible: `gmn_owner` is `is_owner_of(tenant_id)` and RLS FILTERS rather than
 * refuses, so a trainer reaching this write would otherwise watch the box clear
 * as though the note had been saved. Asking for the row back turns that silence
 * into an error the screen can print.
 */
async function addMemberNote(sb, tenantId, memberId, body, writtenBy) {
    const blocked = noteBlocker(body);
    if (blocked)
        throw new Error(blocked);
    const { data, error } = await sb
        .from('gym_member_notes')
        .insert({
        tenant_id: tenantId,
        member_id: memberId,
        body: body.trim(),
        written_by: writtenBy ?? null,
    })
        .select('id');
    if (error)
        throw error;
    if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error('That note was not saved — the database accepted nothing back. It is not on the record, so write it again once you know why.');
    }
}
