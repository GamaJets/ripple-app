"use strict";
// Running the same spreadsheet twice, and getting the same ledger.
//
// The import screen writes the gym's payment record in bulk, and until now it
// did so with no dedupe, no record of which run wrote which row, no receipt and
// no undo. Its own copy told the operator to fix the failed lines and paste
// ONLY those back in, "or the rest will be imported twice" — a correctness
// requirement discharged by asking a person to transcribe line numbers by hand,
// once, into a box that permanently writes money.
//
// Everything here exists to move that requirement off the person.
//
// ── The rule, in one paragraph ─────────────────────────────────────────────
//
// Every imported payment carries an `import_key`: a fingerprint of the LINE it
// came from — its date, its amount, its method, who it names, its note — plus
// an occurrence number. `(tenant_id, import_key)` is unique in the database, so
// a line already in the ledger is refused by Postgres rather than by this
// module's memory of what it did last time. That distinction is the whole
// design: client-side dedupe is defeated by a page reload, and a page reload is
// exactly what an operator does when a run appears to have gone wrong.
//
// ── Why an occurrence number ───────────────────────────────────────────────
//
// A gym genuinely can take two identical payments: two members on the same
// day-pass price, paid in cash, on the same date, with no note and no name in
// the sheet. Those two lines are indistinguishable by content, and a
// content-only key would silently drop the second one — losing money the gym
// actually took, which is the failure mode this file exists to prevent, arrived
// at from the other direction.
//
// So the key is `<content>#<n>`, where n counts how many EARLIER lines in the
// same file share that content. Two identical lines are #0 and #1 and both
// land. The same file pasted again produces #0 and #1 again, matches both, and
// writes nothing. The property holds for any prefix of the file too, which is
// what makes the "paste only the failed lines back in" instruction unnecessary
// rather than merely risky — re-running the WHOLE file is now the safe move,
// and it is the one an operator will actually take.
//
// ── What is deliberately not here ──────────────────────────────────────────
//
// No hashing. The key is readable text, and that is worth more than the bytes
// it costs: when somebody eventually asks why a line did not import, the answer
// has to be legible in a SQL console at three in the afternoon.
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentKeyContent = paymentKeyContent;
exports.paymentImportKey = paymentImportKey;
exports.keyPaymentRows = keyPaymentRows;
exports.startImportRun = startImportRun;
exports.finishImportRun = finishImportRun;
exports.fetchImportRuns = fetchImportRuns;
exports.importPayments = importPayments;
exports.undoImportRun = undoImportRun;
exports.importedRowCount = importedRowCount;
const wroteRows_1 = require("./wroteRows");
const rowCap_1 = require("./rowCap");
/**
 * How much of a note goes into the key.
 *
 * A fingerprint the length of a paragraph is unreadable in a console and
 * pointless as an index entry. Truncating risks two different lines colliding
 * on their first 64 characters — and the occurrence number absorbs exactly
 * that: they collide on the prefix, so they are numbered #0 and #1 and both
 * land, which is the same rescue as for two genuinely identical lines.
 */
const NOTE_IN_KEY = 64;
/** Whitespace collapsed and case dropped, so a re-export of the same sheet with
 *  different padding is still the same line. */
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
/**
 * The content half of a line's key — everything except the occurrence number.
 *
 * Exported for the test, and because the two halves are easier to reason about
 * apart. The separator is a character that cannot appear in a normalised field
 * having survived `norm`… except that it can, in a note. That is fine and worth
 * stating: a note containing a pipe shifts the field boundaries consistently
 * for that line and for every re-import of it, so the key stays stable, which
 * is the only property required. It is a fingerprint, not a parse.
 */
function paymentKeyContent(p) {
    return [
        'p1', // a version marker; see the note below
        norm(p.takenOn),
        String(Math.round(p.amountCents)),
        norm(p.method),
        norm(p.memberName),
        norm(p.note).slice(0, NOTE_IN_KEY),
    ].join('|');
}
/**
 * The full key for one line: content plus its occurrence within the file.
 *
 * `nth` is zero-based and is the caller's job to compute over the whole file —
 * `keyPaymentRows` below does it, and nothing should compute it any other way.
 *
 * The leading 'p1' in the content is a version marker, and it is here so that
 * changing this rule later is possible at all. A key format changed in place
 * would make every previously imported line un-matchable, and the next re-run
 * of an old sheet would duplicate the lot in silence. Bumping the marker makes
 * that visible instead: the old keys stay, the new ones do not collide with
 * them, and whoever bumps it has to decide what to do about the overlap on
 * purpose.
 */
function paymentImportKey(p, nth) {
    return `${paymentKeyContent(p)}#${nth}`;
}
/**
 * Assign every row its key, numbering repeats in file order.
 *
 * File order is load-bearing. The numbering must be a function of the file
 * alone — not of what is already in the database, not of the order rows happen
 * to come back in — or the same file would produce different keys on different
 * days and the dedupe would evaporate.
 */
function keyPaymentRows(rows) {
    const seen = new Map();
    return rows.map(({ line, payment }) => {
        const content = paymentKeyContent(payment);
        const nth = seen.get(content) ?? 0;
        seen.set(content, nth + 1);
        return { line, payment, key: `${content}#${nth}` };
    });
}
/**
 * Open a run BEFORE writing anything.
 *
 * Before, not after, and that is the point of it. A run row written at the end
 * only ever describes imports that finished; the ones worth finding are the
 * ones that did not, and a row with `finished_at` null and rows attached is the
 * only evidence that a browser was closed halfway through two hundred
 * payments.
 */
async function startImportRun(sb, tenantId, kind, rowsOffered, by) {
    const { data, error } = await sb.from('gym_import_runs').insert({
        tenant_id: tenantId,
        kind,
        rows_offered: rowsOffered,
        created_by: by,
    }).select('id').single();
    if (error)
        throw error;
    const id = data?.id;
    if (!id)
        throw new Error('The import run could not be opened, so nothing was written.');
    return id;
}
/** Close a run with what actually happened. */
async function finishImportRun(sb, runId, counts) {
    const r = await sb.from('gym_import_runs').update({
        finished_at: new Date().toISOString(),
        rows_written: counts.written,
        rows_skipped: counts.skipped,
        rows_failed: counts.failed,
        note: counts.note ?? null,
    }, { count: 'exact' }).eq('id', runId);
    (0, wroteRows_1.assertWrote)('That import receipt', r);
}
async function fetchImportRuns(sb, tenantId, limit = 20) {
    const { data, error } = await sb
        .from('gym_import_runs')
        .select('id, kind, started_at, finished_at, rows_offered, rows_written, rows_skipped, rows_failed, undone_at, note')
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false })
        .limit(limit);
    if (error)
        throw error;
    return (data ?? []).map((r) => ({
        id: r.id,
        kind: r.kind,
        startedAt: r.started_at,
        finishedAt: r.finished_at ?? null,
        rowsOffered: r.rows_offered ?? 0,
        rowsWritten: r.rows_written ?? 0,
        rowsSkipped: r.rows_skipped ?? 0,
        rowsFailed: r.rows_failed ?? 0,
        undoneAt: r.undone_at ?? null,
        note: r.note ?? null,
    }));
}
/* ── the write ─────────────────────────────────────────────────────────────── */
/**
 * How many rows go into one statement.
 *
 * The old loop made one HTTP round trip per line: two hundred payments was two
 * hundred requests, several seconds of them, during which closing the tab left
 * an unknown fraction written. Batching is not only speed — it shortens the
 * window in which a run can be half-done, and each batch is one transaction, so
 * a batch either lands or does not.
 *
 * Not one statement for the whole file: PostgREST takes the rows in the body,
 * and a five-thousand-line sheet in a single request is a payload the gateway
 * in front of it may refuse outright, which would be a failure of the whole
 * import rather than of one batch.
 */
const BATCH = 100;
/**
 * Write the payments, skipping anything already imported.
 *
 * `ignoreDuplicates` makes this `ON CONFLICT (tenant_id, import_key) DO
 * NOTHING`, and the returned rows are the ones that actually landed — so the
 * skipped count is a fact from the database rather than an inference. That is
 * the difference between "we think 12 were already there" and "12 were".
 *
 * A batch the database refuses outright is retried ROW BY ROW, and only that
 * batch. One bad line in a hundred would otherwise cost the ninety-nine beside
 * it, and the operator would be told a hundred lines failed with one reason
 * that is true of one of them. The retry is what keeps the failure report
 * accurate to the line number printed down the side of their sheet — which is
 * the thing the old code got wrong in a different way and which its own comment
 * describes at length.
 */
async function importPayments(sb, tenantId, runId, rows, opts) {
    const out = { written: 0, skipped: 0, failed: [] };
    const asRow = (k) => ({
        tenant_id: tenantId,
        member_id: opts.memberIdFor(k.payment),
        amount_cents: k.payment.amountCents,
        method: k.payment.method,
        // Midday UTC, as the old loop did: a date with no time in it must not land
        // on either side of a midnight when it is read back in the gym's timezone.
        taken_at: new Date(k.payment.takenOn + 'T12:00:00Z').toISOString(),
        note: k.payment.note,
        currency: opts.currency,
        recorded_by: opts.recordedBy ?? null,
        import_run_id: runId,
        import_key: k.key,
    });
    for (let i = 0; i < rows.length; i += BATCH) {
        const slice = rows.slice(i, i + BATCH);
        const { data, error } = await sb
            .from('gym_payments')
            .upsert(slice.map(asRow), { onConflict: 'tenant_id,import_key', ignoreDuplicates: true })
            .select('import_key');
        if (!error) {
            const landed = new Set((data ?? []).map((r) => r.import_key));
            out.written += landed.size;
            out.skipped += slice.length - landed.size;
            continue;
        }
        // One line at a time, so the reason is attached to the line it belongs to.
        for (const k of slice) {
            const { data: one, error: oneErr } = await sb
                .from('gym_payments')
                .upsert([asRow(k)], { onConflict: 'tenant_id,import_key', ignoreDuplicates: true })
                .select('import_key');
            if (oneErr)
                out.failed.push({ line: k.line, why: oneErr?.message ?? 'write failed' });
            else if ((one ?? []).length)
                out.written += 1;
            else
                out.skipped += 1;
        }
    }
    return out;
}
/**
 * Put the ledger back to what it was before a run.
 *
 * A hard DELETE of the rows that run wrote, not a soft void. A voided payment
 * still in the table is a row every future SUM has to remember to exclude, and
 * the one that forgets restates the mistake in a figure somebody files. The
 * receipt keeps the record that the import happened and that it was undone; the
 * ledger goes back to what it was.
 *
 * The count is checked. `gym_payments_owner` is `is_owner_of(tenant_id)` and is
 * the only policy on this table for a delete, so anybody else's undo matches
 * zero rows and returns no error — the screen would say "removed" over a ledger
 * that still holds every one of them.
 *
 * Returns how many rows went, which the caller reports: "no rows to remove" is
 * a real and calm answer for a run that wrote nothing, and it must not read the
 * same as a refusal.
 */
async function undoImportRun(sb, tenantId, runId) {
    const { data, error } = await sb
        .from('gym_payments')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('import_run_id', runId)
        .select('id');
    if (error)
        throw error;
    const removed = (data ?? []).length;
    // Marked undone AFTER the rows are gone. The other order would leave a
    // receipt claiming an undo that a refused delete never performed.
    const r = await sb.from('gym_import_runs')
        .update({ undone_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', runId);
    (0, wroteRows_1.assertWrote)('That import', r);
    return removed;
}
/**
 * How many payments a run still has in the ledger.
 *
 * Read before offering an undo, so a run whose rows have already been removed
 * — by an earlier undo, or by hand — offers nothing rather than a button that
 * deletes nothing and says it worked.
 */
async function importedRowCount(sb, tenantId, runId) {
    const { data, error } = await sb
        .from('gym_payments')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('import_run_id', runId)
        .limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    return (0, rowCap_1.assertWhole)(data, "this import run's payments").length;
}
