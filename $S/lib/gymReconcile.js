"use strict";
// An answer to a reconciliation exception, so the same question stops being
// asked every month forever.
//
// /accounting renders three exception tables and its own header calls each row
// "a question with a name on it". Until this file that was the whole of it:
// there was no match, no accept, no note and nothing persisted, so every
// exception an owner walked through in August was on the screen again in
// September, identical, and would be in September of next year too.
//
// The failure that causes is not irritation. It is that a list which never
// shrinks stops being read — and the month it contains something real is the
// month nobody looks. That is the same argument this codebase makes everywhere
// else about a default that renders cleanly: the thing that looks fine is what
// stops anybody fixing it.
//
// ── Three things an owner can truthfully say, and only two live here ──────
//
//   1. "This payment settles that invoice." A FACT, and it belongs in the
//      ledger: `gym_payments.invoice_id`, written by `matchPayment` in
//      src/lib/gymRecord.ts. A matched row stops being an exception because it
//      stops being unmatched. No state in this file is involved.
//
//   2. "I know why this is here and it is fine." Cash banked in a lump, a
//      partner paying under their own name, a part payment. Nothing is wrong
//      and nothing can be linked. `accepted`, and the reason is REQUIRED —
//      supabase/parts/181 enforces that at the database, because an exception
//      quietly removed from a reconciliation with no reason recorded is exactly
//      the row an auditor asks about.
//
//   3. "This is wrong and I am dealing with it." `flagged`, and it deliberately
//      stays on the list. It is a bookmark, not an answer, and a state that
//      hid a row somebody had called wrong would be the worst thing this table
//      could do.
//
// There is no `dismissed`. It and `accepted` would be two words for one action
// with different implications about whether anybody actually looked, and a
// month later nothing on screen could tell them apart.
Object.defineProperty(exports, "__esModule", { value: true });
exports.markKey = exports.MARK_STATE_LABEL = void 0;
exports.markBlocker = markBlocker;
exports.fetchMarks = fetchMarks;
exports.markException = markException;
exports.clearMark = clearMark;
exports.partitionByMark = partitionByMark;
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const wroteRows_1 = require("./wroteRows");
exports.MARK_STATE_LABEL = {
    accepted: 'Explained',
    flagged: 'Flagged as wrong',
};
const markKey = (kind, id) => `${kind}:${id}`;
exports.markKey = markKey;
/**
 * Why this mark cannot be saved, or null when it can.
 *
 * `accepted` requires words and `flagged` does not. That asymmetry is the whole
 * point: accepting REMOVES a row from the questions an accountant is looking
 * at, and the reason is what makes that removal auditable. Flagging removes
 * nothing, so a bare "this is wrong, I will come back to it" is a complete
 * thought and refusing it would only teach people to type a full stop.
 */
function markBlocker(state, note) {
    if (state === 'accepted' && !note.trim()) {
        return 'Say why this is expected. An exception taken off a reconciliation with no reason recorded is exactly the row somebody asks about later, and "it was fine" is not an answer anybody can check.';
    }
    if (note.trim().length > 500) {
        return 'That is longer than a note on one line of a reconciliation — 500 characters at most.';
    }
    return null;
}
/**
 * Every answer this gym has recorded.
 *
 * Read whole rather than per-row: the exception tables ask about a few hundred
 * rows at once, and a lookup per row is a few hundred round trips on a screen
 * that already makes three.
 *
 * Capped and refusing. A truncated read here does not produce a wrong figure —
 * it produces a screen that re-asks questions the owner has already answered,
 * which is the exact behaviour this table exists to end, arriving silently.
 */
async function fetchMarks(sb, tenantId) {
    const { data, error } = await sb
        .from('gym_reconcile_marks')
        .select('id, subject_kind, subject_id, state, note, marked_by, marked_at')
        .eq('tenant_id', tenantId)
        .order('marked_at', { ascending: false })
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    const rows = (0, rowCap_1.assertWhole)(data, 'the answers already given on this reconciliation');
    const names = await namesFor(sb, rows.map((r) => r.marked_by));
    const out = new Map();
    for (const r of rows) {
        const kind = r.subject_kind === 'payment' ? 'payment' : 'invoice';
        out.set((0, exports.markKey)(kind, r.subject_id), {
            id: r.id,
            subjectKind: kind,
            subjectId: r.subject_id,
            // A value the CHECK does not permit reads back as 'flagged', never as
            // 'accepted'. Accepting is the state that hides a row, so an unreadable
            // one must fail towards being seen.
            state: r.state === 'accepted' ? 'accepted' : 'flagged',
            note: r.note ?? null,
            markedBy: r.marked_by ?? null,
            markedByName: r.marked_by ? names.get(r.marked_by) ?? null : null,
            markedAt: r.marked_at,
        });
    }
    return out;
}
/**
 * Record — or change — the answer to one exception.
 *
 * An upsert on the unique index, so changing your mind replaces the answer
 * rather than stacking a second contradictory one that a screen would then have
 * to choose between. The conflict target is named explicitly because PostgREST
 * will otherwise pick the primary key, which never collides, and every change
 * of mind would silently become a new row.
 */
async function markException(sb, tenantId, m) {
    const { error } = await sb
        .from('gym_reconcile_marks')
        .upsert({
        tenant_id: tenantId,
        subject_kind: m.subjectKind,
        subject_id: m.subjectId,
        state: m.state,
        note: m.note.trim() || null,
        marked_by: m.markedBy,
        marked_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,subject_kind,subject_id' });
    if (error)
        throw error;
}
/**
 * Take an answer back.
 *
 * The COUNT is checked. `gym_reconcile_marks_owner` is the only policy granting
 * DELETE, so a delete run by anybody else matches zero rows and returns no
 * error — and the screen would say the row is back on the reconciliation while
 * it is still hidden.
 */
async function clearMark(sb, tenantId, kind, subjectId) {
    const r = await sb.from('gym_reconcile_marks')
        .delete({ count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('subject_kind', kind)
        .eq('subject_id', subjectId);
    if (r.error)
        throw r.error;
    (0, wroteRows_1.assertWrote)('Reopening that question', r);
}
/**
 * Split a set of exceptions into the ones still being asked and the ones
 * somebody has explained.
 *
 * Explained rows are RETURNED, not dropped. A reconciliation that silently
 * shrank would be a reconciliation nobody could check, and the screen shows the
 * explained ones under their own heading with the reason and who gave it.
 */
function partitionByMark(rows, kind, marks) {
    const open = [];
    const explained = [];
    const flagged = [];
    for (const row of rows) {
        const mark = marks.get((0, exports.markKey)(kind, row.id));
        if (!mark) {
            open.push(row);
            continue;
        }
        if (mark.state === 'accepted')
            explained.push({ row, mark });
        // A flagged row is in BOTH lists on purpose: it is still an open question
        // — that is what flagging it said — and it is also something somebody has
        // already looked at, which the person reading the list next needs to know.
        else {
            open.push(row);
            flagged.push({ row, mark });
        }
    }
    return { open, explained, flagged };
}
/**
 * Who marked each answer, by id.
 *
 * CHUNKED, about the REQUEST LINE rather than the row ceiling. `fetchMarks`
 * reads up to `capLimit()` marks, so up to a thousand `marked_by` ids reach
 * here; at about 39 bytes per uuid inside `in.("…","…")` that is a ~39KB query
 * string against the 8KB request line nginx and most CDNs enforce by default.
 * Refused at roughly two hundred ids with a **414** that supabase-js does not
 * reject on and that arrives as `data: null`.
 *
 * no-error-ok (about the ROW ceiling — one row per id, 150 ids a chunk): an
 * unreadable name renders as a dash beside the answer; the answer itself is
 * still there. The 414 is the case that argument does not cover: every marker
 * unnamed at once, on the screen an owner uses to see which questions somebody
 * has already dealt with and who to ask about them.
 */
async function namesFor(sb, ids) {
    let rows = [];
    try {
        rows = await (0, idLookup_1.readByIds)(ids, (chunk, from, to) => sb.from('profiles').select('id, full_name')
            .in('id', chunk).order('id', { ascending: true }).range(from, to), 'the names of the people who answered these');
    }
    catch {
        return new Map();
    }
    return new Map(rows
        .map((p) => [p.id, (p.full_name || '').trim()])
        .filter(([, n]) => !!n));
}
