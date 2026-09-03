"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The chunked-but-still-capped `.in()` read.
//
// The assertions here are mostly about the REQUESTS rather than the answers,
// for the reason idChunkReads.test.ts gives: a version that sent one giant
// `.in()` returns exactly the same rows against a fake that answers everything,
// so a test that only looked at `rows` would pass on the bug this exists to
// stop. What is asserted is how many calls went out, how big each one was, and
// that between them every id was asked about exactly once.
//
// Compile with tsc, run with node.
const cappedByIds_1 = require("./cappedByIds");
const idLookup_1 = require("./idLookup");
const rowCap_1 = require("./rowCap");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const idList = (n, prefix = 'id') => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
/* ── the request line ──────────────────────────────────────────────────────
 * The failure this closes is a 414 on a request line built from more ids than
 * a proxy will accept, so the size of each `.in()` is the thing under test. */
(async () => {
    {
        const sent = [];
        const ids = idList(1000);
        const res = await (0, cappedByIds_1.readCappedByIds)(ids, (chunk) => {
            sent.push(chunk);
            return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
        });
        eq(sent.length, Math.ceil(1000 / idLookup_1.ID_CHUNK), 'a thousand ids go out in ceil(1000 / ID_CHUNK) requests, not one');
        ok(sent.every((c) => c.length <= idLookup_1.ID_CHUNK), `no request carries more than ID_CHUNK (${idLookup_1.ID_CHUNK}) ids — that is the whole 414 argument`);
        eq(sent.flat().length, 1000, 'and between them every id was asked about');
        eq(new Set(sent.flat()).size, 1000, 'exactly once — no id sent twice, no id dropped');
        eq(res.rows.length, 1000, 'every row comes back');
        eq(res.truncated, false, 'nothing was at a cap, so nothing claims to be a prefix');
        eq(res.error, null, 'and no error');
    }
    {
        // 39 bytes a uuid inside `in.("…","…")`, and an 8KB request-line limit. The
        // number in idLookup.ts is chosen against that; this asserts the arithmetic
        // rather than trusting the constant to stay sane.
        ok(idLookup_1.ID_CHUNK * 39 < 8 * 1024, `${idLookup_1.ID_CHUNK} uuids is about ${idLookup_1.ID_CHUNK * 39} bytes of query string, which must stay inside the 8KB request line proxies enforce`);
    }
    {
        const sent = [];
        const res = await (0, cappedByIds_1.readCappedByIds)([], (chunk) => {
            sent.push(chunk);
            return Promise.resolve({ data: [], error: null });
        });
        eq(sent.length, 0, 'an empty id list sends NO request — a bare `in.()` matches nothing and is a wasted round trip');
        eq(res.rows.length, 0, 'and answers empty');
        eq(res.error, null, 'with no error, because nothing failed');
    }
    {
        const sent = [];
        await (0, cappedByIds_1.readCappedByIds)(['a', 'b', null, 'a', undefined, 'c', ''], (chunk) => { sent.push(chunk); return Promise.resolve({ data: [], error: null }); });
        eq(JSON.stringify(sent), JSON.stringify([['a', 'b', 'c']]), 'blanks and duplicates are dropped before the request line is built, in first-seen order');
    }
    /* ── the cap, which is deliberately KEPT ────────────────────────────────
     * This is the whole difference from readByIds: the caller has decided a cap
     * is the right answer, and a chunk that overshoots it is a prefix.
     *
     * The caller asks with `.limit(capLimit(cap))`, which is cap + 1 — the probe
     * row whose only job is to make a full page and a cut one stop looking
     * identical. So `cap + 1` rows back means truncated and `cap` exactly does
     * not, and both directions are asserted here because softening either one
     * reintroduces the silent lie rowCap.ts exists for. */
    {
        const res = await (0, cappedByIds_1.readCappedByIds)(idList(300), (chunk) => Promise.resolve({ data: chunk.map((id) => ({ id })), error: null }), { cap: 10 });
        eq(res.truncated, true, 'a chunk that answered past its cap makes the whole read a prefix');
        eq(res.rows.length, 10 * Math.ceil(300 / idLookup_1.ID_CHUNK), 'and every chunk is trimmed to the cap — the probe row is a signal, never a row to draw');
        eq(res.error, null, 'truncated is not an error — the rows that came are real');
    }
    {
        // The flag must survive a LATER chunk being short. A `truncated` computed
        // from the last chunk alone would report the set whole because the tail of
        // it happened to be.
        let call = 0;
        const res = await (0, cappedByIds_1.readCappedByIds)(idList(idLookup_1.ID_CHUNK * 2), () => { call += 1; return Promise.resolve({ data: call === 1 ? idList(6).map((id) => ({ id })) : [], error: null }); }, { cap: 5 });
        eq(call, 2, 'both chunks were asked');
        eq(res.truncated, true, 'the FIRST chunk overshot its cap, and a short second chunk does not clear that');
    }
    {
        const res = await (0, cappedByIds_1.readCappedByIds)(idList(50), (chunk) => Promise.resolve({ data: chunk.map((id) => ({ id })), error: null }), { cap: 50 });
        eq(res.truncated, false, 'exactly AT the cap is a complete set — the probe row is cap + 1, and refusing a set for being exactly its own size is a false refusal');
        eq(res.rows.length, 50, 'and all fifty are kept');
    }
    /* ── a failing chunk ────────────────────────────────────────────────────
     * supabase-js resolves on a database error, so this is the shape that used
     * to arrive as "these clients have no rows". */
    {
        let calls = 0;
        const res = await (0, cappedByIds_1.readCappedByIds)(idList(idLookup_1.ID_CHUNK * 4), (chunk) => {
            calls += 1;
            if (calls === 2)
                return Promise.resolve({ data: null, error: { message: 'refused' } });
            return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
        });
        eq(calls, 2, 'the loop STOPS at the first failing chunk — an answer stitched out of the chunks that happened to work is a set whose gaps are invisible');
        ok(res.error != null, 'and the failure is reported, not swallowed into an empty decoration');
        eq(res.rows.length, idLookup_1.ID_CHUNK, 'the rows that did come back are handed over anyway, for a caller that can use them');
        eq(res.truncated, false, 'a failed read is not a truncated one — those are two different sentences');
    }
    {
        // `data: null` with NO error is what a 414 looked like before the chunking,
        // and it must not read as an error either: it is an empty answer.
        const res = await (0, cappedByIds_1.readCappedByIds)(['a'], () => Promise.resolve({ data: null, error: null }));
        eq(res.error, null, 'a null page with no error is an empty answer, not a failure');
        eq(res.rows.length, 0, 'and contributes no rows');
    }
    /* ── the default cap is the one the rest of the codebase means ──────── */
    {
        let seen = 0;
        await (0, cappedByIds_1.readCappedByIds)(['a'], () => { seen += 1; return Promise.resolve({ data: [], error: null }); });
        eq(seen, 1, 'one chunk for one id');
        ok(rowCap_1.ROW_CAP === 1000, 'the default cap is ROW_CAP, which is PostgREST\'s own ceiling — if that changes, the callers reasoning about a 1000-row page need to know');
    }
    if (errors.length) {
        console.error(`cappedByIds: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
        for (const e of errors)
            console.error('  · ' + e);
        process.exit(1);
    }
    console.log('cappedByIds — ok');
})();
