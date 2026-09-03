"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Three reads and one write that could each report a comfortable number over
// part of a set.
//
// ── What this is protecting ────────────────────────────────────────────────
//
// `recordSettlement` sent every session id of a payroll run in ONE
// `.in('id', …)` inside a PATCH. A uuid costs about 39 bytes in a PostgREST
// `in.("…","…")` list, so past roughly two hundred of them the request line is
// over the 8KB nginx and most CDNs allow and the answer is a 414 — which
// arrives AFTER the settlement row has been written. The run is recorded and
// paid, not one session is stamped against it, every session stays in "Owed
// now", and next month's run pays for the same work again. This is the identical
// shape `stampRunExtras` was fixed for in src/lib/gymPay.ts; the sessions were
// the third list on the same run and were left on the old form.
//
// `fetchDemand` in src/lib/gymRota.ts had no bound on either of its two reads
// while `fetchShifts` directly above it was capped with a comment explaining
// why. `coverage()` compares the two, so the truncation ran in the REASSURING
// direction: every demand block that fell off PostgREST's 1000-row ceiling is
// an hour with work booked that the grid never hears about, so uncovered goes
// down, idle goes up, and app/(owner)/rota.tsx prints "Every booked hour this
// week has somebody on the rota" over a week with nobody on it.
//
// `fetchGymTrainers` read `trainers` with no limit and no `assertWhole`, and
// that list is what keys every figure under it. Truncated, the roster silently
// stops: the coaches past the ceiling are absent from the screen, absent from
// `payroll30For`'s total and absent from `payrollBlocker`'s count of what is
// unmarked, so payroll prices out cleanly and short. Its profiles lookup also
// discarded `error`, which does not only cost a name — `GymTrainer.since` comes
// off the same read and already means "the profile has no created_at", so a
// swallowed refusal made a claim about when every coach joined.
//
// The database is a fake, for the reason gymPayReads.test.ts uses one: what is
// under test is the loop and the query it builds, and a fake is the only way to
// assert the exact chunks and limits asked for. Compile with tsc, run with node.
const gymSessions_1 = require("./gymSessions");
const gymRota_1 = require("./gymRota");
const gymTrainers_1 = require("./gymTrainers");
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** A chainable stand-in for the supabase-js builder. Everything is recorded. */
function fakeSb(answer) {
    const asked = [];
    const from = (table) => {
        const q = { table, limit: null, in: null };
        asked.push(q);
        const chain = {
            select: () => chain,
            eq: () => chain,
            gt: () => chain,
            gte: () => chain,
            lt: () => chain,
            lte: () => chain,
            order: () => chain,
            single: () => chain,
            limit: (n) => { q.limit = n; return chain; },
            in: (_col, ids) => { q.in = ids; return chain; },
            insert: (row) => { q.insert = row; return chain; },
            update: (patch, o) => {
                q.update = patch;
                q.counted = o?.count === 'exact';
                return chain;
            },
            // Thenable at every point, because these callers await at different
            // depths — `.single()` on a write, `.limit()` on a read, `.in()` on a
            // lookup with nothing after it.
            then: (res) => res(answer(q)),
        };
        return chain;
    };
    return { sb: { from }, asked };
}
/** `n` distinct uuid-shaped ids, as the real rows carry. */
const ids = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}-0000-4000-8000-${String(i).padStart(12, '0')}`);
const RUN = {
    trainerId: 'trainer-1',
    periodFrom: '2026-08-01',
    periodTo: '2026-08-31',
    amountCents: 480000,
    method: 'transfer',
    currency: 'GBP',
};
const said = async (fn) => {
    try {
        await fn();
        return '';
    }
    catch (e) {
        return String(e?.message ?? e);
    }
};
async function main() {
    /* ── recordSettlement: the stamp is chunked ─────────────────────────────── */
    {
        const N = idLookup_1.ID_CHUNK * 2 + 7;
        const sessionIds = ids(N, 'sess');
        const { sb, asked } = fakeSb((q) => {
            if (q.table === 'payroll_settlements')
                return { data: { id: 'settle-1' }, error: null };
            return { data: null, error: null, count: (q.in ?? []).length };
        });
        const id = await (0, gymSessions_1.recordSettlement)(sb, 'tenant-1', { ...RUN, sessionIds });
        eq(id, 'settle-1', 'the settlement id is handed back');
        const writes = asked.filter((q) => q.table === 'sessions' && q.update);
        eq(writes.length, Math.ceil(N / idLookup_1.ID_CHUNK), 'the sessions are stamped in chunks, the last one short');
        ok(writes.every((q) => (q.in ?? []).length <= idLookup_1.ID_CHUNK), `no chunk carries more than ${idLookup_1.ID_CHUNK} ids — past about two hundred the request line is a 414`);
        ok(writes.every((q) => q.counted), 'every chunk asks PostgREST to count what it changed; RLS filters rather than refuses, so an uncounted PATCH cannot tell a stamp from a no-op');
        eq(writes.reduce((a, q) => a + (q.in ?? []).length, 0), N, 'every id is sent exactly once across the chunks');
        const insert = asked.find((q) => q.table === 'payroll_settlements')?.insert;
        eq(insert?.sessions_count, N, 'the settlement row records how many sessions it covers');
    }
    /* ── the total is the DEDUPLICATED one, on both writes ──────────────────── */
    {
        const unique = ids(5, 'dup');
        // The same five, listed twice. Five rows exist; ten were mentioned.
        const sessionIds = [...unique, ...unique];
        const { sb, asked } = fakeSb((q) => {
            if (q.table === 'payroll_settlements')
                return { data: { id: 'settle-2' }, error: null };
            return { data: null, error: null, count: (q.in ?? []).length };
        });
        const why = await said(() => (0, gymSessions_1.recordSettlement)(sb, 'tenant-1', { ...RUN, sessionIds }));
        eq(why, '', 'a complete stamp over a list with duplicates in it is not reported as partial');
        const write = asked.find((q) => q.table === 'sessions' && q.update);
        eq((write?.in ?? []).length, 5, 'an id listed twice is sent once — it is one row');
        eq(asked.find((q) => q.table === 'payroll_settlements')?.insert?.sessions_count, 5, 'and the permanent payment record counts rows, not mentions');
    }
    /* ── a short count is a partial stamp, named as one ─────────────────────── */
    {
        const N = idLookup_1.ID_CHUNK + 20;
        let seen = 0;
        const { sb } = fakeSb((q) => {
            if (q.table === 'payroll_settlements')
                return { data: { id: 'settle-3' }, error: null };
            seen += 1;
            // The first chunk lands whole; the second matches nothing, which is what
            // RLS filtering looks like from here.
            return { data: null, error: null, count: seen === 1 ? idLookup_1.ID_CHUNK : 0 };
        });
        const why = await said(() => (0, gymSessions_1.recordSettlement)(sb, 'tenant-1', { ...RUN, sessionIds: ids(N, 'part') }));
        ok(why.includes(`only ${idLookup_1.ID_CHUNK} of ${N} sessions were stamped`), `the partial stamp is counted across chunks and named — got ${JSON.stringify(why)}`);
        ok(why.includes('settled twice'), 'and it says what the unstamped remainder costs, which is the reason to reload before trying again');
    }
    /* ── a chunk that is refused says how much had already landed ───────────── */
    {
        const N = idLookup_1.ID_CHUNK + 20;
        let seen = 0;
        const { sb } = fakeSb((q) => {
            if (q.table === 'payroll_settlements')
                return { data: { id: 'settle-4' }, error: null };
            seen += 1;
            if (seen === 1)
                return { data: null, error: null, count: idLookup_1.ID_CHUNK };
            return { data: null, error: { message: 'URI too long' }, count: null };
        });
        const why = await said(() => (0, gymSessions_1.recordSettlement)(sb, 'tenant-1', { ...RUN, sessionIds: ids(N, 'fail') }));
        ok(why.includes(`after ${idLookup_1.ID_CHUNK} of ${N}`), `a refused chunk is reported with the running total attached — got ${JSON.stringify(why)}`);
        ok(why.includes('URI too long'), 'and carries what the server actually said');
    }
    /* ── "nobody counted" is not zero ───────────────────────────────────────── */
    {
        const { sb } = fakeSb((q) => {
            if (q.table === 'payroll_settlements')
                return { data: { id: 'settle-5' }, error: null };
            return { data: null, error: null, count: null };
        });
        const why = await said(() => (0, gymSessions_1.recordSettlement)(sb, 'tenant-1', { ...RUN, sessionIds: ids(3, 'nocount') }));
        ok(why.includes('did not say how many'), `an uncounted write is named as uncounted, not added in as a zero — got ${JSON.stringify(why)}`);
    }
    /* ── fetchDemand: both reads are bounded, and a truncated week refuses ──── */
    {
        const { sb, asked } = fakeSb(() => ({ data: [], error: null }));
        await (0, gymRota_1.fetchDemand)(sb, 'tenant-1', '2026-08-03T00:00:00Z', '2026-08-10T00:00:00Z');
        const classes = asked.find((q) => q.table === 'gym_classes');
        const sessions = asked.find((q) => q.table === 'sessions');
        eq(classes?.limit, (0, rowCap_1.capLimit)(), 'the classes read asks for one row past the cap, so a full page and a cut one differ');
        eq(sessions?.limit, (0, rowCap_1.capLimit)(), 'and so does the one-to-ones read');
    }
    {
        // The probe row came back: the week is bigger than the read.
        const rows = Array.from({ length: rowCap_1.ROW_CAP + 1 }, () => ({
            title: 'Spin', trainer_id: 't1', starts_at: '2026-08-04T18:00:00Z', duration_min: 45,
        }));
        const { sb } = fakeSb((q) => (q.table === 'gym_classes'
            ? { data: rows, error: null }
            : { data: [], error: null }));
        const why = await said(() => (0, gymRota_1.fetchDemand)(sb, 'tenant-1', 'a', 'b'));
        ok(why.includes('the classes booked this week'), `a truncated demand read refuses by name rather than handing back a prefix — got ${JSON.stringify(why)}`);
    }
    {
        const rows = Array.from({ length: rowCap_1.ROW_CAP + 1 }, () => ({
            trainer_id: 't1', starts_at: '2026-08-04T18:00:00Z', duration_min: 60, status: 'booked', outcome: null,
        }));
        const { sb } = fakeSb((q) => (q.table === 'sessions'
            ? { data: rows, error: null }
            : { data: [], error: null }));
        const why = await said(() => (0, gymRota_1.fetchDemand)(sb, 'tenant-1', 'a', 'b'));
        ok(why.includes('the one-to-ones booked this week'), `and the two halves of demand refuse separately, so the owner is told which — got ${JSON.stringify(why)}`);
        ok(why.includes('Refusing to report a figure'), 'with the sentence rowCap.ts writes, which is the one an owner sees');
    }
    /* ── fetchGymTrainers: the roster is bounded and the names are checked ──── */
    {
        const { sb, asked } = fakeSb((q) => {
            if (q.table === 'trainers')
                return { data: [{ id: 't1' }], error: null };
            if (q.table === 'profiles')
                return { data: [{ id: 't1', full_name: 'Ada', created_at: '2026-01-01' }], error: null };
            return { data: [], error: null };
        });
        const out = await (0, gymTrainers_1.fetchGymTrainers)(sb, 'tenant-1');
        eq(asked.find((q) => q.table === 'trainers')?.limit, (0, rowCap_1.capLimit)(), 'the trainers read asks for one row past the cap, like every read under it');
        eq(out.length, 1, 'and a whole read still comes back');
        eq(out[0]?.name, 'Ada', 'with the name off profiles');
    }
    {
        const rows = Array.from({ length: rowCap_1.ROW_CAP + 1 }, (_, i) => ({ id: `t${i}` }));
        const { sb } = fakeSb((q) => (q.table === 'trainers' ? { data: rows, error: null } : { data: [], error: null }));
        const why = await said(() => (0, gymTrainers_1.fetchGymTrainers)(sb, 'tenant-1'));
        ok(why.includes("this gym's trainers"), `a truncated roster refuses rather than paying a short payroll — got ${JSON.stringify(why)}`);
    }
    {
        const { sb } = fakeSb((q) => {
            if (q.table === 'trainers')
                return { data: [{ id: 't1' }], error: null };
            if (q.table === 'profiles')
                return { data: null, error: { message: 'permission denied for table profiles' } };
            return { data: [], error: null };
        });
        const why = await said(() => (0, gymTrainers_1.fetchGymTrainers)(sb, 'tenant-1'));
        ok(why.includes('permission denied'), `a refused profiles read throws instead of reporting every coach as having no join date — got ${JSON.stringify(why)}`);
    }
    if (errors.length) {
        console.error(`${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
        for (const e of errors)
            console.error('  ' + e);
        process.exit(1);
    }
    console.log('settlementStamp ok — the payroll stamp is chunked and counted, and the rota, demand and roster reads all refuse a prefix');
}
main().catch((e) => { console.error(e); process.exit(1); });
