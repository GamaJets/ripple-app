"use strict";
// Reading a gym's trainers, with their client load and delivered sessions.
//
// This is the query behind the owner's roster, and it is wanted in two places:
// the phone app's PlatformTrainersProvider, and the web console. It takes the
// Supabase client as an argument rather than importing one, so it belongs to
// neither front end and can be tested without either.
//
// Nothing here invents a figure. A trainer with no sessions gets 0 because the
// query returned no rows for them — and the caller is responsible for knowing
// that a 0 across the whole gym may mean the sessions_owner_r policy is missing
// rather than that nobody trained.
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGymTrainers = fetchGymTrainers;
exports.payroll30For = payroll30For;
exports.payrollBlocker = payrollBlocker;
// The only import here, and deliberately a pure one — no Supabase, no front
// end — so this module stays testable from either app.
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const DAY = 24 * 60 * 60 * 1000;
async function fetchGymTrainers(sb, tenantId) {
    // Trainers in this tenant. RLS (trainers_owner_r) already scopes this to the
    // caller's tenant; the filter makes the intent explicit.
    //
    // Bounded at cap + 1 like every other read below it. This one was the last
    // unbounded read in the file, and it is the one that decides the SHAPE of all
    // three reads under it: `ids` comes off this list, and every figure on the
    // roster is keyed by it. Truncated here, a gym does not get understated
    // figures — it gets a roster that silently stops, with the trainers past the
    // ceiling absent from the screen, absent from `payroll30For`'s total, and
    // absent from `payrollBlocker`'s count of what is still unmarked. Payroll
    // then prices out cleanly, and is short by however many coaches fell off the
    // end. A refused read is the honest answer; the screen already renders one.
    const { data: trs, error } = await sb.from('trainers').select('id')
        .eq('tenant_id', tenantId).limit((0, rowCap_1.capLimit)());
    if (error)
        throw error;
    const ids = (0, rowCap_1.assertWhole)(trs, "this gym's trainers").map((r) => r.id);
    if (!ids.length)
        return [];
    // Names come from profiles, which the owner may read for their own tenant
    // (profiles_owner_tenant_r).
    //
    // This read used to discard `error` under a `no-error-ok:` saying "an
    // unreadable name falls back to 'Trainer'; every figure beside it is still
    // real". Half of that was true. `full_name` does fall back, and a name is
    // cosmetic beside the numbers. But this read also carries `since`, and `since`
    // ALREADY MEANS something specific: `GymTrainer.since` is documented as "null
    // if the profile has no created_at". A refusal silenced here borrows that
    // meaning and reports, of every coach on the roster at once, that the record
    // does not say when they joined — which is a claim about people, made by code
    // that never managed to ask. Thrown now, on the same reasoning as the three
    // reads around it, and the screen already renders a thrown read as the error
    // it is rather than as a roster of anonymous coaches who joined on no date.
    //
    // Chunked, along with the two reads under it, and all three for one reason:
    // `ids` is bounded only by `capLimit()`, so it can be a thousand uuids, and a
    // thousand uuids inside `in.("…","…")` is a 39KB request line. nginx and most
    // CDNs stop at 8KB — about two hundred — and answer 414. supabase-js does not
    // reject on that: it resolves with `data: null` and an error whose shape says
    // nothing about ids, so the honest-looking `throw` below fires on a query
    // that was never run, and on the only gyms big enough to reach it. 150 at a
    // time (src/lib/idLookup.ts) cannot get near the limit.
    const meta = new Map();
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(ids))) {
        const { data: profs, error: profErr } = await sb.from('profiles')
            .select('id, full_name, created_at').in('id', chunk);
        if (profErr)
            throw profErr;
        for (const p of (profs ?? [])) {
            meta.set(p.id, { name: (p.full_name || '').trim(), since: p.created_at ?? null });
        }
    }
    // Client counts: one query for the whole tenant rather than N queries.
    //
    // Thrown, not defaulted, for the same reason the `trainers` read above throws:
    // a missing count becomes 0, and 0 clients is a statement about a trainer that
    // an owner acts on. The screen renders a thrown read as an error.
    //
    // Bounded at cap + 1 so a truncated read is detectable. A gym with more than
    // a thousand clients is ordinary, and PostgREST would have handed back the
    // first thousand with no indication there were more — every trainer's book
    // understated, silently, by however many rows fell off the end.
    //
    // Each chunk keeps its own `capLimit()` and its own `assertWhole`, so the
    // refusal this paragraph describes still happens — it just now happens per
    // 150 trainers rather than per thousand clients across all of them, which is
    // strictly more room, not less.
    const clientCount = new Map();
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(ids))) {
        const { data: cls, error: clsErr } = await sb.from('clients').select('trainer_id')
            .in('trainer_id', chunk).limit((0, rowCap_1.capLimit)());
        if (clsErr)
            throw clsErr;
        (0, rowCap_1.assertWhole)(cls, "this gym's clients").forEach((c) => {
            if (c.trainer_id)
                clientCount.set(c.trainer_id, (clientCount.get(c.trainer_id) ?? 0) + 1);
        });
    }
    // Sessions delivered: booked and already started.
    const since = new Date(Date.now() - 30 * DAY).toISOString();
    // This one pays people. `delivered30` feeds `payroll30For`, so a swallowed
    // failure here does not merely understate a dashboard figure — every trainer
    // shows 0 delivered, nothing is left unmarked, and payroll prices out at
    // exactly zero owed. A refused read must never be able to say that.
    const sessionCount = new Map();
    const deliveredCount = new Map();
    const unmarkedCount = new Map();
    // Chunked like the two above it. This is the one where the 414 would be
    // silent AND expensive: `data: null` on a refused request line reaches
    // `assertWhole` as an empty set, which is not truncated, so nothing throws —
    // every trainer shows 0 delivered and payroll prices out at exactly zero
    // owed, which is the sentence the paragraph over the read says must never be
    // sayable by a read that failed.
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(ids))) {
        const { data: sess, error: sessErr } = await sb
            .from('sessions')
            .select('trainer_id, outcome')
            .in('trainer_id', chunk)
            .eq('status', 'booked')
            .gte('starts_at', since)
            .lte('starts_at', new Date().toISOString())
            .limit((0, rowCap_1.capLimit)());
        if (sessErr)
            throw sessErr;
        // The paragraph above worries about a read that FAILS. A read that is merely
        // truncated is worse: it succeeds, so nothing throws, and payroll prices out
        // at whatever fraction of the month happened to fit under the limit.
        (0, rowCap_1.assertWhole)(sess, 'sessions in the last 30 days').forEach((s) => {
            if (!s.trainer_id)
                return;
            sessionCount.set(s.trainer_id, (sessionCount.get(s.trainer_id) ?? 0) + 1);
            if (s.outcome === 'completed') {
                deliveredCount.set(s.trainer_id, (deliveredCount.get(s.trainer_id) ?? 0) + 1);
            }
            else if (s.outcome == null) {
                // Null is "nobody has said yet", which is neither delivered nor cancelled.
                unmarkedCount.set(s.trainer_id, (unmarkedCount.get(s.trainer_id) ?? 0) + 1);
            }
        });
    }
    return ids
        .map((id) => ({
        id,
        name: meta.get(id)?.name || 'Trainer',
        clients: clientCount.get(id) ?? 0,
        sessions30: sessionCount.get(id) ?? 0,
        delivered30: deliveredCount.get(id) ?? 0,
        unmarked30: unmarkedCount.get(id) ?? 0,
        since: meta.get(id)?.since ?? null,
    }))
        .sort((a, b) => b.clients - a.clients || a.name.localeCompare(b.name));
}
/**
 * What 30 days of *confirmed* sessions are worth.
 *
 * Null in two cases, both of which render as a dash rather than a figure:
 *   - the gym has not set a session fee. An unset fee is not a free gym.
 *   - sessions are still awaiting an outcome. Pricing those would mean paying
 *     for no-shows and un-cancelled slots, which is what this used to do: it
 *     counted every booking whose start time had passed.
 *
 * `payrollBlocker` says which, in words an owner can act on.
 */
/**
 * Returns MAJOR units — whole currency, not cents.
 *
 * `tenants.session_fee` is a numeric in whole currency (default 75 = AED 75),
 * so `delivered * sessionFee` is 6,300, not 630,000. Do NOT pass this to
 * `money()` from gymRecord, which divides by 100: the console did exactly that
 * behind a variable named `cents`, and the payroll screen showed AED 63.00
 * where the gym owed AED 6,300.
 *
 * If you need it formatted like every other figure, multiply by 100 first.
 */
function payroll30For(trainers, sessionFee) {
    if (sessionFee == null)
        return null;
    if (trainers.some((t) => t.unmarked30 > 0))
        return null;
    const delivered = trainers.reduce((a, t) => a + t.delivered30, 0);
    return Math.round(delivered * sessionFee);
}
/** Why payroll cannot be priced yet, or null when it can. */
function payrollBlocker(trainers, sessionFee) {
    const unmarked = trainers.reduce((a, t) => a + t.unmarked30, 0);
    if (unmarked > 0) {
        return `${unmarked} session${unmarked === 1 ? '' : 's'} still need an outcome recorded.`;
    }
    if (sessionFee == null)
        return 'No session fee set.';
    return null;
}
