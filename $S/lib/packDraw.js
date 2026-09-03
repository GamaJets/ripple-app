"use strict";
// Session packs: what a client is holding, and what the database just said
// about spending one.
//
// The sibling of coachMoney.ts, from the client's side of the same sale. Pure
// arithmetic and pure interpretation — no supabase, no react-native — so it can
// be run under `npm test`. The reads and the RPC calls stay in connect.ts.
//
// ── The three things that go wrong with a pack, and are defended here ──────
//
// 1. A BALANCE THAT WAS NEVER READ IS NOT A BALANCE OF ZERO.
//
//    `client_purchases` is the table where "the read failed" and "you have
//    nothing" look identical at the type level: both arrive as an absence.
//    They are opposite sentences to say to somebody who has paid. So
//    `packBalance` returns `left: null` for an unread history and `left: 0`
//    only for one that was read and came back with nothing on it, and every
//    screen above it renders the two differently. This has been fixed by hand
//    in `fetchMyPurchases`, in `sessionsRemaining` and in `redeemSession`
//    already, one function at a time, each time after a wrong sentence reached
//    a screen. Doing the arithmetic in one place is what stops the fourth.
//
// 2. A WRITE THAT CHANGED NOTHING IS NOT A WRITE THAT SUCCEEDED.
//
//    PostgREST answers an UPDATE matching zero rows with `error: null` — proven
//    against the live database — so "no error" is not evidence that a credit
//    came off. `redeem_pack_session` (part 123) therefore answers with a ROW
//    saying what happened, and `readDraw` below refuses to call anything a
//    success that did not come back as exactly one row naming a known outcome.
//    An empty response, two responses, or an outcome word this build has never
//    heard of are all 'unknown' — which the caller reports as "we could not
//    tell", never as "drawn" and never as "you have none left".
//
// 3. A PACK THAT RAN OUT OF TIME IS NOT A PACK SOMEBODY USED UP.
//
//    Packs can carry a validity from supabase/parts/612, and the nightly pass
//    that closes one reduces `sessions_total` to `sessions_used` — which is how
//    every draw site in the database stops at an expired pack without any of
//    them being rewritten, and which means an expired pack and a fully used one
//    arrive here as the same two numbers. They are opposite sentences: one is
//    somebody who got what they paid for and one is somebody who did not. So
//    `expired_at` and `sessions_expired` are carried on the row, `exhausted` is
//    false for an expired pack however little is left, and `stranded` states
//    what was paid for and can no longer be booked rather than quietly
//    dropping it. src/lib/packExpiry.ts holds the words.
Object.defineProperty(exports, "__esModule", { value: true });
exports.packLabel = packLabel;
exports.packBalance = packBalance;
exports.readDraw = readDraw;
exports.drew = drew;
exports.drawReason = drawReason;
/**
 * The label for a pack whose package may or may not be readable.
 *
 * `pkg_read` is `active or trainer_id = auth.uid()`, so a client can only read
 * packages that are still ON SALE. A coach who withdraws a package makes it
 * invisible to the very people who bought it — which is also why an amount from
 * one of those rows has no currency (see `packageLabels` in connect.ts).
 *
 * A pack with no readable name is described by its size rather than given one:
 * "10-session pack" is a fact about the row, where "Coaching pack" would be a
 * name this code made up for a thing the coach named something else.
 */
function packLabel(total, name) {
    const n = (name || '').trim();
    if (n)
        return { label: n, named: true };
    if (total == null || !Number.isFinite(total))
        return { label: 'Membership', named: false };
    return { label: `${total}-session pack`, named: false };
}
/** Is this row a session pack the client has paid for? A membership is not
 *  (no credits), and neither is a checkout that never completed. */
const isLivePack = (r) => r.status === 'paid' && r.sessions_total != null && Number.isFinite(r.sessions_total);
/**
 * The client's pack balance.
 *
 * `rows === null` is a history that could not be read, and comes back with
 * `left: null` — no lines, no zero, nothing a screen can print as a figure.
 * `rows === []` is somebody who has bought nothing, and comes back with
 * `left: 0`, which a screen may state.
 *
 * `names` maps package id → package name, for the packages that are readable.
 * An id missing from it is a package we could not read, not a package with no
 * name; `packLabel` describes those rather than naming them.
 */
function packBalance(rows, names) {
    if (rows == null)
        return { lines: [], left: null, live: 0, exhausted: 0, expired: 0, stranded: null, onClosedPacks: null };
    const lines = [];
    for (const r of rows) {
        if (!isLivePack(r))
            continue;
        const total = r.sessions_total;
        const used = Number.isFinite(r.sessions_used) ? r.sessions_used : 0;
        // Clamped, because part 123's constraint is newer than the rows that may
        // already be in this table on somebody's project. A negative balance is not
        // a sentence to show a person about their own money.
        const left = Math.max(0, Math.min(total, total - used));
        // A closed window, and what it took. `expired_at` is the fact — the pass in
        // part 612 writes it and nothing else does — rather than a date comparison
        // run here, because until that pass has run the credits are genuinely still
        // spendable and this app must not say otherwise.
        const expired = !!r.expired_at;
        const lostRaw = Number(r.sessions_expired ?? 0);
        const sessionsExpired = Number.isFinite(lostRaw) && lostRaw > 0 ? Math.trunc(lostRaw) : 0;
        // What they BOUGHT, which is what the pack is called. `sessions_total` has
        // already had the stranded credits taken off it by the time an expired pack
        // is read back, and labelling a ten-pack "7-session pack" would rename a
        // thing on the screen of the person who bought it.
        const sold = total + sessionsExpired;
        const { label, named } = packLabel(sold, r.package_id ? names?.get(r.package_id) : null);
        lines.push({
            id: r.id, label, named, left, sessions_total: sold,
            exhausted: left === 0 && !expired,
            expired, sessionsExpired,
            expiredAt: r.expired_at ?? null,
            expiresOn: r.expires_on ?? null,
            created_at: r.created_at,
        });
    }
    // Oldest first. A row with an unparseable date sorts last rather than being
    // dropped: it is a pack somebody paid for, and its credits count.
    lines.sort((a, b) => {
        const ta = Date.parse(a.created_at);
        const tb = Date.parse(b.created_at);
        const va = Number.isFinite(ta);
        const vb = Number.isFinite(tb);
        if (va && vb)
            return ta - tb;
        if (va)
            return -1;
        if (vb)
            return 1;
        return 0;
    });
    return {
        lines,
        // EXPIRED PACKS ARE NOT IN THIS FIGURE, and the line below is why the two
        // used to disagree. `live` has always excluded a closed pack — "nothing can
        // be booked against it" — and `left` summed every line including those, so
        // one number said a pack was dead and the next one spent its credits.
        //
        // Usually the sum is the same either way: `run_pack_expiry()` reduces
        // `sessions_total` to `sessions_used`, so a pack it has closed has a `left`
        // of nought and contributes nothing. The case where it is not the same is
        // the one that matters: `refund_pack_session` (part 123) decrements
        // `sessions_used` on the newest pack with usage, and it does not care
        // whether that pack's window has closed. A client whose session is refunded
        // onto an expired pack gets a credit back that nothing in the database will
        // ever let them draw — and their balance went up by one, on their own
        // screen, on a pack that is over.
        //
        // Not dropped, either. `onClosedPacks` below counts exactly what came out
        // of this figure, because a credit somebody paid for that quietly stopped
        // being counted is the silent subtraction this file exists to refuse.
        left: lines.reduce((a, l) => a + (l.expired ? 0 : l.left), 0),
        // A pack whose window has closed is not live, whatever `left` says about
        // it — nothing can be booked against it, which is the only thing "live"
        // means to somebody looking at their own packs.
        live: lines.filter((l) => !l.exhausted && !l.expired && l.left > 0).length,
        exhausted: lines.filter((l) => l.exhausted).length,
        expired: lines.filter((l) => l.expired).length,
        stranded: lines.reduce((a, l) => a + l.sessionsExpired, 0),
        onClosedPacks: lines.reduce((a, l) => a + (l.expired ? l.left : 0), 0),
    };
}
const KNOWN = new Set(['drawn', 'returned', 'exhausted', 'nothing_to_return', 'no_pack', 'expired']);
const intOrNull = (v) => typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
/**
 * Read the RPC's response, counting rows.
 *
 * This is the row-count check the old client-side UPDATE could not do. supabase
 * hands back `data` for an RPC as an array (a set-returning function), and the
 * three shapes that are NOT a success look nothing alike in the database and
 * exactly alike to a caller that only checks `error`:
 *
 *   []                 the function returned no row. Nothing happened, and
 *                      nothing said so.
 *   [row, row]         more than one, which this contract does not produce and
 *                      which no caller should pick a winner from.
 *   [{outcome: '…'}]   a word this build does not know.
 *
 * All three are 'unknown'. Only a single row naming a known outcome is believed,
 * and `drew` below is the only thing any screen may treat as a credit moving.
 */
function readDraw(data) {
    const rows = Array.isArray(data) ? data : data == null ? [] : [data];
    if (rows.length !== 1)
        return { outcome: 'unknown', remaining: null, purchaseId: null, total: null };
    const r = rows[0];
    const word = r && typeof r.outcome === 'string' ? r.outcome : '';
    if (!KNOWN.has(word))
        return { outcome: 'unknown', remaining: null, purchaseId: null, total: null };
    return {
        outcome: word,
        remaining: intOrNull(r?.sessions_left),
        purchaseId: typeof r?.purchase_id === 'string' ? r.purchase_id : null,
        total: intOrNull(r?.pack_total),
    };
}
/** Did a credit actually move? The only outcomes that mean the balance changed.
 *  Everything else — including 'unknown' — did not move one, and a screen that
 *  says otherwise is telling somebody their pack went down when it did not. */
function drew(d) {
    return d.outcome === 'drawn' || d.outcome === 'returned';
}
/**
 * WHY a credit did not move, as a fragment the booking screen drops into
 * parentheses: app/(client)/calendar.tsx renders
 *
 *     This wasn't taken off your session pack (…) — check your package…
 *
 * so these are lower-case clauses, not sentences.
 *
 * `undefined` for the two outcomes that are not a problem to explain:
 *
 *   'drawn'/'returned'  nothing to explain, a credit moved.
 *   'no_pack'           they pay per session and never had a pack. Naming a
 *                       reason would put an explanation about session packs in
 *                       front of somebody who has never bought one — and the
 *                       booking screen already stays silent when it knows the
 *                       balance is zero.
 *
 * 'unknown' is the one that must always speak. It is the outcome that used to
 * be indistinguishable from success.
 */
function drawReason(d) {
    switch (d.outcome) {
        case 'drawn': return undefined;
        case 'returned': return undefined;
        case 'no_pack': return undefined;
        case 'exhausted': return 'every session on your pack is already used';
        case 'nothing_to_return': return 'nothing had been drawn off it to give back';
        // Never reachable from the two client-side functions, which do not return
        // this word. It is here so that a screen calling `adjust_pack_credit` has a
        // sentence rather than a silence, and so that the switch is exhaustive over
        // the union rather than falling through to `undefined`, which reads as
        // "nothing to explain" and would leave a coach's tap doing nothing quietly.
        case 'expired': return 'that pack’s window has closed, so a credit put back on it could never be booked';
        case 'unknown': return 'we could not confirm the change with the server';
        default: return undefined;
    }
}
