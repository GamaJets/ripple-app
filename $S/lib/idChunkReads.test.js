"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The `.in()` reads that used to send the whole id list in one request line.
//
// ── What this is protecting ────────────────────────────────────────────────
//
// src/lib/idLookup.ts already tests the chunking HELPER. This tests the reads
// that were not using it: the ones whose id list comes off a `capLimit()` read
// above them and was then handed to a single `.in()`.
//
// The failure is not the one people expect. A uuid costs about 39 bytes inside
// a PostgREST `in.("…","…")` list, so a thousand of them is a 39KB request
// line, and nginx and most CDNs refuse past 8KB — roughly two hundred. That
// refusal is a 414, supabase-js does not reject on it, and it arrives as
// `data: null`. Which is the same shape as an empty result. So every one of
// these reads had a paragraph above it reasoning carefully about what an
// unreadable name means, and every one of those paragraphs was written about
// ONE row RLS declined to hand over — never about all of them at once, because
// the request was refused before the database saw it:
//
//   · `fetchGymTrainers` — a roster of anonymous coaches whose `since` says the
//     record does not know when any of them joined, zero clients each, and
//     `delivered30: 0` for every one of them, which prices payroll at nothing
//     owed. `assertWhole` does not catch it: an empty set is not a truncated
//     one, so nothing throws.
//   · `fetchMySessions` — a coach's whole marking queue rendered as a column of
//     "Client", on the screen they use to say what happened in each session.
//
// The assertions below are therefore about the REQUESTS, not only the answers:
// how many `.in()` calls went out, how big each was, and that between them every
// id was asked about exactly once. A version that sent one giant `.in()` would
// pass every assertion about the returned data against a fake that answers
// everything — which is exactly why the real thing passed review.
//
// A fake rather than a database, for the reason idLookup.test.ts gives: the
// subject is the shape of the requests, and a fake is the only way to see them.
//
// Compile with tsc, run with node.
const gymTrainers_1 = require("./gymTrainers");
const trainerSessions_1 = require("./trainerSessions");
const gymClose_1 = require("./gymClose");
const gymDocs_1 = require("./gymDocs");
const gymReconcile_1 = require("./gymReconcile");
const idLookup_1 = require("./idLookup");
const rowCap_1 = require("./rowCap");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** A Supabase-shaped chain that records what each query asked for. */
function fakeSb(answer) {
    const asked = [];
    const from = (table) => {
        const q = { table, in: null, limit: null };
        asked.push(q);
        const chain = {
            select: () => chain,
            eq: () => chain,
            gte: () => chain,
            lte: () => chain,
            order: () => chain,
            limit: (n) => { q.limit = n; return chain; },
            in: (_col, ids) => { q.in = ids; return chain; },
            range: () => chain,
            then: (res) => res(answer(q)),
        };
        return chain;
    };
    return { sb: { from }, asked };
}
/** `n` distinct uuid-shaped ids, as the real rows carry. */
const ids = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}-0000-4000-8000-${String(i).padStart(12, '0')}`);
/** Every `.in()` this table was asked, flattened, so the assertions can talk
 *  about coverage and about chunk size separately. */
const inCalls = (asked, table) => asked.filter((q) => q.table === table && q.in !== null).map((q) => q.in);
function chunkedProperly(asked, table, all, what) {
    const calls = inCalls(asked, table);
    eq(calls.length, Math.ceil(all.length / idLookup_1.ID_CHUNK), `${what} is asked in chunks — one \`.in()\` of ${all.length} uuids is past the 8KB request line and comes back as a 414 dressed as an empty result`);
    ok(calls.every((c) => c.length <= idLookup_1.ID_CHUNK), `and no ${what} chunk carries more than ${idLookup_1.ID_CHUNK} ids`);
    const seen = calls.flat();
    eq(seen.length, all.length, `${what} sends each id exactly once — no chunk overlaps the next`);
    eq(new Set(seen).size, all.length, `and between them the chunks cover every id`);
}
async function main() {
    /* ── 1 · fetchGymTrainers: three reads keyed on one id list ──────────────── */
    {
        // Deliberately more than a chunk and not a multiple of one, so the last
        // chunk is short and an off-by-one at the boundary shows up as a missing id
        // rather than as a rounder number that happens to work.
        const N = idLookup_1.ID_CHUNK * 2 + 7;
        const trainerIds = ids(N, 'c0ac4');
        const { sb, asked } = fakeSb((q) => {
            if (q.table === 'trainers')
                return { data: trainerIds.map((id) => ({ id })), error: null };
            if (q.table === 'profiles') {
                return {
                    data: (q.in ?? []).map((id) => ({ id, full_name: `Coach ${id.slice(-3)}`, created_at: '2026-01-04T09:00:00Z' })),
                    error: null,
                };
            }
            if (q.table === 'clients') {
                // Two clients each, so a chunk that never went out shows up as a zero
                // rather than as a slightly smaller total nobody would query.
                return { data: (q.in ?? []).flatMap((id) => [{ trainer_id: id }, { trainer_id: id }]), error: null };
            }
            // sessions: one delivered and one unmarked per trainer.
            return {
                data: (q.in ?? []).flatMap((id) => [
                    { trainer_id: id, outcome: 'completed' },
                    { trainer_id: id, outcome: null },
                ]),
                error: null,
            };
        });
        const roster = await (0, gymTrainers_1.fetchGymTrainers)(sb, 'gym');
        eq(roster.length, N, 'every trainer on the roster comes back');
        chunkedProperly(asked, 'profiles', trainerIds, 'the name and joined-on lookup');
        chunkedProperly(asked, 'clients', trainerIds, 'the client count');
        chunkedProperly(asked, 'sessions', trainerIds, 'the delivered count');
        ok(roster.every((t) => t.name !== 'Trainer'), 'every coach is named — a 414 on one giant `.in()` would name none of them, and "Trainer" is the fallback that would hide it');
        ok(roster.every((t) => t.since !== null), 'and every one has a joined-on date — `since: null` is documented as "the record does not say", which a refused request must not be able to claim of the whole roster');
        ok(roster.every((t) => t.clients === 2), 'every coach carries their real client count, including the ones in the last short chunk');
        ok(roster.every((t) => t.delivered30 === 1 && t.unmarked30 === 1 && t.sessions30 === 2), 'and their real session counts — this is the read payroll is priced from, so a chunk that never went out is money not paid');
        // The three id-keyed reads keep their own cap. Chunking must not have
        // traded the truncation guard away for the request-line one.
        ok(inCalls(asked, 'clients').length > 0
            && asked.filter((q) => q.table === 'clients').every((q) => q.limit === rowCap_1.ROW_CAP + 1), 'each client chunk still asks for cap + 1, so a chunk that truncates is still detectable');
        ok(asked.filter((q) => q.table === 'sessions').every((q) => q.limit === rowCap_1.ROW_CAP + 1), 'and so does each session chunk');
    }
    /* ── 2 · fetchGymTrainers still throws when a chunk is refused ───────────── */
    {
        const N = idLookup_1.ID_CHUNK + 4;
        const trainerIds = ids(N, 'c0ac4');
        let profileCalls = 0;
        const { sb } = fakeSb((q) => {
            if (q.table === 'trainers')
                return { data: trainerIds.map((id) => ({ id })), error: null };
            if (q.table === 'profiles') {
                profileCalls++;
                // The SECOND chunk fails. A loop that swallowed it would hand back a
                // roster where the first 150 are named and the rest are not, which is
                // the truncation this whole change is about, reintroduced by the fix.
                if (profileCalls === 2)
                    return { data: null, error: { message: 'refused' } };
                return { data: (q.in ?? []).map((id) => ({ id, full_name: 'Ana', created_at: null })), error: null };
            }
            return { data: [], error: null };
        });
        let threw = false;
        try {
            await (0, gymTrainers_1.fetchGymTrainers)(sb, 'gym');
        }
        catch {
            threw = true;
        }
        ok(threw, 'a chunk that is refused fails the read — a partly-named roster must never be handed back as a whole one');
    }
    /* ── 3 · fetchMySessions names every person, over both id columns ────────── */
    {
        // Every session names TWO people, which is the reason this list outruns the
        // request line at half the row count anybody expects.
        const N = idLookup_1.ID_CHUNK; // 150 sessions → 300 distinct ids → three chunks.
        const trainerId = 'c0ac4-0000-4000-8000-000000000000';
        const clientIds = ids(N, 'c11e7');
        const rows = clientIds.map((cid, i) => ({
            id: `s-${i}`, trainer_id: trainerId, client_id: cid,
            starts_at: '2026-08-10T09:00:00Z', duration_min: 60, status: 'booked',
            outcome: null, outcome_at: null, rate_cents: null, rate_currency: null,
            settlement_id: null, pack_drawn_kind: null, pack_drawn_at: null,
            pack_draw_shortfall_at: null,
        }));
        const { sb, asked } = fakeSb((q) => {
            if (q.table === 'sessions')
                return { data: rows, error: null };
            return { data: (q.in ?? []).map((id) => ({ id, full_name: `Name ${id.slice(-3)}` })), error: null };
        });
        const out = await (0, trainerSessions_1.fetchMySessions)(sb, trainerId, '2026-08-01T00:00:00Z');
        eq(out.length, N, 'every session comes back');
        const all = [trainerId, ...clientIds];
        chunkedProperly(asked, 'profiles', all, 'the session name lookup');
        ok(out.every((s) => s.clientName !== null), 'and every session is labelled with its client — a single `.in()` of 151 ids is a request line the proxy answers 414 to, and the swallow in `fetchNames` would turn that into a queue of "Client"');
        ok(out.every((s) => s.trainerName !== null), 'including the coach, whose id rides in the same list');
    }
    /* ── 3 · fetchCloses: TWO ids off every row ─────────────────────────────
     *
     * The worst arithmetic of the three, because the id list is twice the row
     * count: `capLimit()` rows, `closed_by` and `reopened_by` off each, so up to
     * two thousand uuids in one `.in()` — a ~78KB request line against 8KB.
     *
     * What a 414 costs here is a month-end history with nobody's name on it.
     * That is the record an auditor is handed to see who signed a month off and
     * who reopened it; a page of dated dashes does not answer that question, and
     * it does not LOOK like a failure either. */
    {
        const N = idLookup_1.ID_CHUNK * 2 + 7;
        const staff = ids(N, 'c105e');
        const rows = staff.map((id, i) => ({
            id: `close-${i}`, month_key: `2026-${String((i % 12) + 1).padStart(2, '0')}`,
            closed_at: '2026-02-01T00:00:00Z', closed_by: id,
            note: null, taken_cents: 0, invoiced_cents: 0, outstanding_cents: 0,
            payroll_cents: 0, currency: 'gbp', unmarked_sessions: 0, blockers_at_close: null,
            reopened_at: null, reopened_by: null, reopen_reason: null,
        }));
        const { sb, asked } = fakeSb((q) => {
            if (q.table === 'gym_month_closes')
                return { data: rows, error: null };
            return { data: (q.in ?? []).map((id) => ({ id, full_name: `Owner ${id.slice(-3)}` })), error: null };
        });
        const closes = await (0, gymClose_1.fetchCloses)(sb, 'gym');
        eq(closes.length, N, 'every month close comes back');
        chunkedProperly(asked, 'profiles', staff, 'the close/reopen name lookup');
        ok(closes.every((c) => c.closedByName !== null), 'and every close names who made it — one giant `.in()` is a 414 that names none of them, on the record an auditor reads');
    }
    /* ── 4 · fetchDocuments: an id list with no thousand-row roof at all ─────
     *
     * The other three sections are about a list a `capLimit()` read holds at a
     * thousand. This one is not: `fetchDocuments` moved to `readAll`, which pages
     * to PAGE_CEILING, so the id list is bounded at FIFTY thousand. A gym's
     * document register grows for as long as the gym exists and nothing deletes
     * from it, so this crosses the request line early and stays across it. */
    {
        const N = idLookup_1.ID_CHUNK * 3 + 11;
        const uploaders = ids(N, 'd0c5');
        const docs = uploaders.map((id, i) => ({
            id: `doc-${i}`, member_id: null, member_attached: false, equipment_id: null,
            kind: 'other', title: `Doc ${i}`, storage_path: `p/${i}`, mime: null,
            size_bytes: null, expires_on: null, note: null, uploaded_by: id,
            uploaded_at: '2026-02-01T00:00:00Z',
        }));
        // `readAll` pages until a SHORT page, so the documents read answers once
        // with everything and then once with nothing.
        let served = false;
        const { sb, asked } = fakeSb((q) => {
            if (q.table === 'gym_documents') {
                if (served)
                    return { data: [], error: null };
                served = true;
                return { data: docs, error: null };
            }
            return { data: (q.in ?? []).map((id) => ({ id, full_name: `Staff ${id.slice(-3)}` })), error: null };
        });
        const out = await (0, gymDocs_1.fetchDocuments)(sb, 'gym');
        eq(out.length, N, 'every document comes back');
        chunkedProperly(asked, 'profiles', uploaders, 'the uploader name lookup');
        ok(out.every((d) => d.uploadedByName !== null), 'and every document says who filed it — the paragraph above that read argues about ONE unreadable name, never about all of them');
    }
    /* ── 5 · fetchMarks: the answers an owner has already given ──────────────── */
    {
        const N = idLookup_1.ID_CHUNK + 3;
        const markers = ids(N, 'ac4e');
        const rows = markers.map((id, i) => ({
            id: `mark-${i}`, subject_kind: 'payment', subject_id: `pay-${i}`,
            state: 'accepted', note: null, marked_by: id, marked_at: '2026-02-01T00:00:00Z',
        }));
        const { sb, asked } = fakeSb((q) => {
            if (q.table === 'gym_reconcile_marks')
                return { data: rows, error: null };
            return { data: (q.in ?? []).map((id) => ({ id, full_name: `Owner ${id.slice(-3)}` })), error: null };
        });
        const marks = await (0, gymReconcile_1.fetchMarks)(sb, 'gym');
        eq(marks.size, N, 'every answer already given comes back');
        chunkedProperly(asked, 'profiles', markers, 'the marked-by name lookup');
        ok([...marks.values()].every((m) => m.markedByName !== null), 'and every answer says who gave it — otherwise the screen that exists to stop an owner re-asking cannot say who to ask');
    }
    if (errors.length) {
        console.error(`idChunkReads: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
        for (const e of errors)
            console.error(`  · ${e}`);
        process.exit(1);
    }
    console.log('idChunkReads: ok');
}
// Awaited rather than floated: an unhandled rejection in here would print a
// warning and exit 0, which is a test file that cannot fail.
main().catch((e) => { console.error('idChunkReads — threw:', e); process.exit(1); });
