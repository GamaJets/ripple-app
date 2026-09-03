"use strict";
// PT sessions as the gym sees them: what was booked, what was actually
// delivered, and what that costs in payroll.
//
// Framework-agnostic on purpose — it takes the Supabase client as an argument,
// so the web console and the phone app can both use it and neither owns it.
// See src/lib/gymRecord.ts for the same shape.
//
// ── The problem this module exists to fix ──────────────────────────────────
//
// "Delivered" has been inferred as "was booked and the clock has since passed"
// (see the query in gymTrainers.fetchGymTrainers). That counts no-shows,
// un-cancelled slots, and sessions the trainer never turned up to. It then
// feeds payroll, so a gym pays for sessions that did not happen.
//
// The fix is not to guess better. It is to admit that an unmarked session has
// an unknown outcome, keep it out of both the delivered count and the payroll
// figure, and tell the gym how many are waiting to be marked. A payroll run
// that says "£6,180 across 84 sessions, with 12 still unmarked" is useful. One
// that says £7,060 because it counted the twelve is a dispute.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAY_DELIVERED_ONLY = exports.SETTLEMENT_METHOD_LABEL = exports.SETTLEMENT_METHODS = void 0;
exports.isDelivered = isDelivered;
exports.isAwaitingOutcome = isAwaitingOutcome;
exports.isPayable = isPayable;
exports.payrollByTrainer = payrollByTrainer;
exports.payrollTotal = payrollTotal;
exports.settlementBlocker = settlementBlocker;
exports.settleableSessions = settleableSessions;
exports.settlementAmount = settlementAmount;
exports.settleBlocker = settleBlocker;
exports.sessionProfileIds = sessionProfileIds;
exports.namesById = namesById;
exports.fetchSessions = fetchSessions;
exports.fetchAwaitingOutcome = fetchAwaitingOutcome;
exports.markOutcome = markOutcome;
exports.recordSettlement = recordSettlement;
exports.fetchSettlements = fetchSettlements;
exports.clearOutcome = clearOutcome;
const rowCap_1 = require("./rowCap");
const idLookup_1 = require("./idLookup");
const wroteRows_1 = require("./wroteRows");
exports.SETTLEMENT_METHODS = ['transfer', 'cash', 'payroll', 'other'];
/** How each reads on screen. 'payroll' is the gym's own payroll run, which is
 *  not the same statement as "we paid them" and should not read as one. */
exports.SETTLEMENT_METHOD_LABEL = {
    transfer: 'bank transfer',
    cash: 'cash',
    payroll: 'through payroll',
    other: 'some other way',
};
/** The conservative default: pay only for sessions that actually took place. */
exports.PAY_DELIVERED_ONLY = { payNoShows: false, payLateCancellations: false };
/* ── pure rules (no database, so they are testable and shared) ─────────────── */
/** A session is delivered only when somebody recorded that it completed. */
function isDelivered(s) {
    return s.outcome === 'completed';
}
/**
 * Whether the outcome is still unknown: the session was booked, its end time
 * has passed, and nobody has said what happened.
 *
 * A slot that is merely `available` or `blocked` is not awaiting anything —
 * nobody was booked into it.
 */
function isAwaitingOutcome(s, now = Date.now()) {
    if (s.status !== 'booked' || s.outcome !== null)
        return false;
    const end = Date.parse(s.startsAt) + s.durationMin * 60000;
    return Number.isFinite(end) && end <= now;
}
/** Whether this session should be paid, under the gym's stated policy. */
function isPayable(s, policy) {
    switch (s.outcome) {
        case 'completed': return true;
        case 'no_show': return policy.payNoShows;
        case 'late_cancelled': return policy.payLateCancellations;
        // A plain cancellation, and an unmarked session, are never payable. The
        // unmarked one is reported separately rather than quietly costing nothing.
        default: return false;
    }
}
/**
 * Payroll per trainer for a set of sessions.
 *
 * `fallbackRateCents` prices sessions that have no snapshotted rate — a gym's
 * standard session fee. Pass null when no fee is set, and the money comes back
 * null rather than zero.
 */
function payrollByTrainer(sessions, policy, fallbackRateCents = null, now = Date.now()) {
    const lines = new Map();
    const line = (s) => {
        let l = lines.get(s.trainerId);
        if (!l) {
            l = {
                trainerId: s.trainerId, trainerName: s.trainerName,
                delivered: 0, noShows: 0, cancelled: 0, unmarked: 0,
                cents: null, priced: 0, payable: 0,
            };
            lines.set(s.trainerId, l);
        }
        return l;
    };
    for (const s of sessions) {
        const l = line(s);
        if (s.outcome === 'completed')
            l.delivered += 1;
        else if (s.outcome === 'no_show')
            l.noShows += 1;
        else if (s.outcome === 'cancelled' || s.outcome === 'late_cancelled')
            l.cancelled += 1;
        else if (isAwaitingOutcome(s, now))
            l.unmarked += 1;
        if (!isPayable(s, policy))
            continue;
        l.payable += 1;
        const rate = s.rateCents ?? fallbackRateCents;
        if (rate == null)
            continue; // priced later, or never — not zero
        l.cents = (l.cents ?? 0) + rate;
        l.priced += 1;
    }
    return [...lines.values()].sort((a, b) => b.delivered - a.delivered || (a.trainerName ?? '').localeCompare(b.trainerName ?? ''));
}
/** The gym-wide payroll position, and whether it is safe to settle on it. */
function payrollTotal(lines) {
    let cents = null;
    let delivered = 0, payable = 0, priced = 0, unmarked = 0;
    for (const l of lines) {
        delivered += l.delivered;
        payable += l.payable;
        priced += l.priced;
        unmarked += l.unmarked;
        if (l.cents != null)
            cents = (cents ?? 0) + l.cents;
    }
    return {
        cents,
        delivered, payable, priced, unmarked,
        // Everything payable must be priced, and nothing may still be unmarked.
        settleable: unmarked === 0 && payable > 0 && priced === payable,
    };
}
/**
 * Why the payroll figure cannot be settled yet, in words a gym owner can act
 * on. Null when it can.
 */
function settlementBlocker(t) {
    if (t.unmarked > 0) {
        return `${t.unmarked} session${t.unmarked === 1 ? '' : 's'} still need an outcome recorded.`;
    }
    if (t.payable === 0)
        return 'No payable sessions in this period.';
    if (t.priced < t.payable) {
        const missing = t.payable - t.priced;
        return `${missing} payable session${missing === 1 ? '' : 's'} have no rate — set a session fee.`;
    }
    return null;
}
/**
 * Which of a trainer's sessions a settlement would actually pay for.
 *
 * Deliberately NOT "everything in the date range". A session already carrying a
 * settlement_id has been paid and must never be paid again; a session marked
 * after its period was settled has no settlement_id and simply joins the next
 * run. Paying by session rather than by period is what makes both of those come
 * out right without anybody having to notice.
 *
 * Unmarked sessions are excluded because nobody has said whether they happened.
 * They are the reason payrollTotal refuses to answer, and settling around them
 * would quietly pay a period that is not finished.
 *
 * ── fallbackRateCents, and why it has to be here ──────────────────────────
 *
 * This used to require `s.rateCents != null`, which meant it silently dropped
 * every session priced by the gym's standard fee — while `payrollByTrainer`,
 * two hundred lines up, was pricing exactly those sessions at exactly that fee
 * and showing the owner the total. The two functions disagreed about what
 * "priced" means, and the money went through the stricter one.
 *
 * `payrollTotal` had already taken a side: it counts a fallback-priced session
 * in `priced`, so `settleable` goes true and `settlementBlocker` returns null.
 * The gym-wide guard said the figure was safe to settle and the per-trainer
 * settlement then paid a different number.
 *
 * What that looked like on a gym with a session fee and no snapshotted rates:
 * the screen said AED 1,500 owed and the button said "nothing outstanding".
 * Worse, on a MIXED month — some sessions carrying a rate, some on the fee —
 * there was no blocker at all: the screen said 1,500, settling handed over 900,
 * and the sessions were stamped with a settlement id so they never came round
 * again. A trainer short AED 600 and a record saying they had been paid.
 *
 * Pass the same fallback the payroll figure was computed with. It defaults to
 * null, which is the old behaviour, so a caller that has no fee set is unchanged.
 */
function settleableSessions(sessions, policy, now = Date.now(), fallbackRateCents = null) {
    return sessions.filter((s) => s.settlementId == null &&
        s.outcome !== null &&
        !isAwaitingOutcome(s, now) &&
        isPayable(s, policy) &&
        (s.rateCents ?? fallbackRateCents) != null);
}
/**
 * What settling those sessions would hand over.
 *
 * Takes the same fallback for the same reason: priced by the gym's fee here, or
 * this hands back less than the rows it was given are worth. The `?? 0` is now
 * genuinely unreachable for anything settleableSessions returned — it survives
 * only so a hand-assembled list cannot produce NaN.
 */
function settlementAmount(sessions, fallbackRateCents = null) {
    return sessions.reduce((a, s) => a + (s.rateCents ?? fallbackRateCents ?? 0), 0);
}
/**
 * Why a settlement cannot be recorded right now, or null when it can.
 *
 * Separate from settlementBlocker, which answers a different question: that one
 * asks whether the *figure on screen* is safe to act on, this one asks whether
 * there is anything to pay. A gym can be perfectly in order and still have
 * nothing owed.
 */
function settleBlocker(payable, unmarked) {
    if (unmarked > 0) {
        return `${unmarked} session${unmarked === 1 ? '' : 's'} still need an outcome — settling now would pay for an unfinished period.`;
    }
    if (payable.length === 0)
        return 'Nothing outstanding for this trainer.';
    return null;
}
/* ── reads ─────────────────────────────────────────────────────────────────── */
/**
 * The distinct profile ids a set of session rows names — trainers and clients
 * alike, since both are keyed on profiles.id.
 *
 * Pure, so the half of the name lookup that can quietly go wrong — dropping an
 * id, and showing a dash where a name belongs — is testable without a database.
 */
function sessionProfileIds(rows) {
    const ids = new Set();
    for (const r of rows) {
        if (r.trainer_id)
            ids.add(r.trainer_id);
        if (r.client_id)
            ids.add(r.client_id);
    }
    return Array.from(ids);
}
/**
 * Profile rows to a name lookup keyed by id.
 *
 * A blank or whitespace-only full_name is left out rather than mapped to '',
 * so the screen falls back to its dash instead of printing an empty cell that
 * reads as a broken table.
 */
function namesById(profiles) {
    const m = new Map();
    for (const p of profiles ?? []) {
        const name = (p?.full_name ?? '').trim();
        if (p?.id && name)
            m.set(p.id, name);
    }
    return m;
}
/**
 * Names for the people these rows name, in one query.
 *
 * Not a PostgREST embed, and that is the whole point: `trainers` and `clients`
 * carry no name of their own, so `trainers(full_name)` asked for a column that
 * does not exist and PostgREST rejected the entire read with 42703 —
 * "column trainers_1.full_name does not exist". Every caller of fetchSessions
 * threw, which is why the sessions screen showed "Could not read the session
 * record." instead of the payroll board. (`clients(full_name)` had a second
 * fault waiting behind the first: sessions reaches clients through two foreign
 * keys — client_id and session_waitlist — so that embed is ambiguous even once
 * the column exists.) The shape below is the one in
 * gymTrainers.fetchGymTrainers: collect the ids, resolve them against profiles,
 * which an owner may read for their own tenant (profiles_owner_r).
 *
 * A failure here is not fatal. Names are labels on a board whose subject is
 * money: leaving them null renders a dash, which is honest, where throwing
 * would black out a payroll figure that is perfectly readable without them.
 * Anyone whose profile this caller may not read — RLS filters rather than
 * errors — lands in the same place.
 */
async function fetchSessionNames(sb, rows) {
    const out = new Map();
    // CHUNKED, because `fetchSessions` below now pages. One `.in()` was safe only
    // while the read above refused past a thousand rows; past that it comes back
    // with the first thousand names and says nothing, and a payroll board two
    // thirds unnamed reads as a gym that never recorded who anybody is.
    for (const chunk of (0, idLookup_1.chunkIds)((0, idLookup_1.uniqueIds)(sessionProfileIds(rows)))) {
        const { data, error } = await sb.from('profiles').select('id, full_name').in('id', chunk);
        if (error)
            return out;
        for (const [id, name] of namesById((data ?? []))) {
            out.set(id, name);
        }
    }
    return out;
}
/**
 * The one-to-ones in a window.
 *
 * ── Why this pages rather than refusing ────────────────────────────────────
 *
 * It was `.limit(capLimit())` plus `assertWhole`, and the reasoning for that
 * was sound as far as it went: this list is summed into what the gym owes its
 * trainers, and a set cut off at the limit would have priced the month at
 * whatever fitted with no error to say so.
 *
 * What it missed is that a thousand sessions is a busy month, not an impossible
 * one — the comment said so itself — and the alternative to a wrong figure is
 * not a refused screen. Refusing took /payroll, /close and /sessions away
 * entirely at exactly the gym size that has a payroll worth running, and
 * /export asks for 1970 to 2100, so the bundle whose stated purpose is that
 * leaving with the record must be possible refused at every gym past its first
 * thousand hours.
 *
 * Every caller already bounds this by a date window, which is the shape
 * `readAll` exists for (see src/lib/rowCap.ts): finite by construction, wanted
 * in full, and now simply finished. `PAGE_CEILING` still refuses past fifty
 * thousand sessions in one window.
 *
 * `starts_at` ties freely — two coaches both teaching at nine on Monday — so
 * `id` closes the total order paging requires.
 */
async function fetchSessions(sb, tenantId, sinceIso, untilIso) {
    const rows = await (0, rowCap_1.readAll)((from, to) => {
        let q = sb
            .from('sessions')
            .select('id, trainer_id, client_id, starts_at, duration_min, status, outcome, outcome_at, rate_cents, rate_currency, settlement_id, pack_drawn_kind, pack_drawn_at, pack_draw_shortfall_at')
            .eq('tenant_id', tenantId)
            .gte('starts_at', sinceIso);
        if (untilIso)
            q = q.lte('starts_at', untilIso);
        return q
            .order('starts_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to);
    }, 'sessions in this period');
    const names = await fetchSessionNames(sb, rows);
    return rows.map((r) => rowToSession(r, names));
}
function rowToSession(r, names) {
    return {
        id: r.id,
        trainerId: r.trainer_id,
        trainerName: names.get(r.trainer_id) ?? null,
        clientId: r.client_id ?? null,
        clientName: r.client_id ? names.get(r.client_id) ?? null : null,
        startsAt: r.starts_at,
        durationMin: r.duration_min ?? 60,
        status: r.status,
        outcome: r.outcome ?? null,
        outcomeAt: r.outcome_at ?? null,
        rateCents: r.rate_cents ?? null,
        rateCurrency: r.rate_currency ?? null,
        settlementId: r.settlement_id ?? null,
        packDrawnKind: (r.pack_drawn_kind ?? null),
        packDrawnAt: r.pack_drawn_at ?? null,
        packDrawShortfallAt: r.pack_draw_shortfall_at ?? null,
    };
}
/** Sessions that finished without anyone saying what happened. */
async function fetchAwaitingOutcome(sb, tenantId, sinceIso) {
    const all = await fetchSessions(sb, tenantId, sinceIso, new Date().toISOString());
    return all.filter((s) => isAwaitingOutcome(s));
}
async function markOutcome(sb, sessionId, outcome, rate) {
    const patch = { outcome };
    if (rate !== undefined) {
        patch.rate_cents = rate.cents;
        // Written together. A currency with no rate beside it is refused by
        // `sessions_rate_currency_needs_rate`, so clearing the rate clears the unit.
        patch.rate_currency = rate.cents == null ? null : rate.currency;
    }
    const r = await sb.from('sessions').update(patch, { count: 'exact' }).eq('id', sessionId);
    (0, wroteRows_1.assertWrote)('That outcome', r);
}
/**
 * Record that a trainer was paid, and stamp the sessions it covered.
 *
 * Two writes, in this order on purpose: the settlement row first, then the
 * sessions pointing at it. If the second write fails the settlement exists with
 * no sessions attached — visible, wrong, and fixable. The other order would
 * leave sessions marked paid against a run that does not exist, which is money
 * that silently vanishes from what the gym owes.
 *
 * `sessionIds` should come from settleableSessions(), which is what guarantees
 * nothing already settled is included.
 */
async function recordSettlement(sb, tenantId, run) {
    // Deduplicated ONCE, at the top, and used for both writes.
    //
    // `sessions_count` on the settlement row and the total the stamp is measured
    // against have to be the same number, and it has to be a count of ROWS rather
    // than a count of mentions. An id listed twice is one session: counted as two
    // it overstates what the run covered on a permanent payment record, and
    // measured as two it reports a complete stamp as a partial one and sends an
    // owner chasing a double payment that has not happened. This is the same
    // reasoning `stampAll` in src/lib/gymPay.ts sets out for the other half of
    // the same run.
    const sessionIds = (0, idLookup_1.uniqueIds)(run.sessionIds);
    const { data, error } = await sb.from('payroll_settlements').insert({
        tenant_id: tenantId,
        trainer_id: run.trainerId,
        period_from: run.periodFrom,
        period_to: run.periodTo,
        amount_cents: run.amountCents,
        reimbursement_cents: run.reimbursementCents ?? null,
        sessions_count: sessionIds.length,
        method: run.method,
        note: run.note ?? null,
        currency: run.currency,
    }).select('id').single();
    if (error)
        throw error;
    const id = data?.id;
    if (sessionIds.length) {
        // The rows changed are counted — see src/lib/wroteRows.ts — and this is the
        // write in the whole console where a silent no-op costs the most money.
        //
        // The two halves of this function were held to different standards: the
        // insert above asks for the row back and checks it, and this asked only
        // `if (e2)`. A PostgREST UPDATE matching zero rows returns 204 with a null
        // error, and `sessions_gym_owner_u` (`tenant_id is not null and
        // is_owner_of(tenant_id)`) filters rather than refuses. The settlement row
        // therefore existed with NOT ONE session stamped: the run appeared under
        // "Already paid" while every session in it stayed in "Owed now", payable
        // again, by an owner who had just been told the trainer was settled.
        //
        // ── Why the ids are chunked ────────────────────────────────────────────
        //
        // This was one `.in('id', run.sessionIds)`, and `settleableSessions()` puts
        // no ceiling on how many ids that is: a first run at a gym that has been
        // recording sessions for a season carries the whole backlog on one coach's
        // row. A uuid costs about 39 bytes inside a PostgREST `in.("…","…")` list,
        // so past roughly two hundred of them the request line is over the 8KB
        // nginx and most CDNs allow, and the answer is a 414 with no relation to
        // the code that caused it.
        //
        // It arrives at the worst possible moment. The settlement row is ALREADY
        // WRITTEN by the time this runs — deliberately, see the note above the
        // function — so the run is recorded and paid while not one session is
        // stamped. Every session in it stays in "Owed now" and is settled again
        // next month, and the only sign is one error toast on a run that looked
        // like it worked. This is the identical shape that was just fixed in
        // `stampRunExtras` for the class-pay lines and the adjustments; the
        // sessions are the third list on the same run and were left behind.
        //
        // Chunked updates are not one transaction, so the counts are SUMMED ACROSS
        // CHUNKS and compared against the deduplicated whole — what the server
        // confirmed, never what was sent — and a chunk that fails part way through
        // is reported as the partial stamp it is rather than as a bare HTTP error.
        let stamped = 0;
        for (const chunk of (0, idLookup_1.chunkIds)(sessionIds)) {
            const w = await sb.from('sessions')
                .update({ settlement_id: id }, { count: 'exact' })
                .in('id', chunk);
            const r2 = w;
            // Thrown with the running total attached rather than raw: a settlement
            // that is recorded and half-stamped is a different thing to tell somebody
            // than a request that was refused, and the half already stamped will not
            // be stamped again by a retry.
            if (r2.error) {
                throw new Error(`The settlement was recorded, but stamping the sessions against it failed after ${stamped} of `
                    + `${sessionIds.length}: ${r2.error.message ?? 'the write was refused'}. `
                    + 'The rest are still shown as unpaid and could be settled twice. Reload before settling this trainer again.');
            }
            if (r2.count == null) {
                // Not "zero rows" — NOBODY COUNTED, which is the distinction
                // src/lib/wroteRows.ts exists to keep. Added in as a zero it would
                // report a stamp that may well have landed as a partial one, and send
                // an owner to settle a trainer who has already been paid.
                throw new Error(`The settlement was recorded, but the server did not say how many sessions it stamped against it, `
                    + `so ${sessionIds.length - stamped} of ${sessionIds.length} cannot be confirmed either way. `
                    + 'Reload before settling this trainer again.');
            }
            stamped += r2.count;
        }
        if (stamped !== sessionIds.length) {
            // A PARTIAL stamp is its own outcome and worse than none, because the
            // unstamped remainder is silently payable a second time. The settlement
            // row is deliberately left standing — it is a payment that was made — so
            // this says exactly what is on the record and what is not.
            throw new Error(`The settlement was recorded, but only ${stamped} of `
                + `${sessionIds.length} sessions were stamped against it. The rest are still shown as unpaid `
                + 'and could be settled twice. Reload before settling this trainer again.');
        }
    }
    return id;
}
/**
 * A NOT NULL money column, read as itself.
 *
 * See the call sites: both of these were `?? 0`, and a zero on a settlement row
 * is a claim that somebody was paid nothing. Throwing is the honest answer to a
 * column the schema says cannot be null coming back null — the screens above
 * all render a thrown read as "this could not be read", which is true, rather
 * than as a payroll history with a free month in it.
 */
function requireAmount(v, what, id) {
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    throw new Error(`A payroll settlement came back with no ${what} recorded (row ${String(id)}). `
        + 'That column cannot be null, so this read cannot be trusted — nothing is shown rather than '
        + 'showing a run as having paid nothing.');
}
/**
 * Every payroll run this gym has settled.
 *
 * ── The fifty that were silently dropped ───────────────────────────────────
 *
 * This read was `.limit(50)` with no probe row and no `assertWhole`, and both
 * callers render what comes back as a COMPLETE history: /sessions labels an
 * empty result "No payroll has been settled yet." A gym with ten coaches paid
 * monthly passes fifty runs in five months, and from then on "already paid for
 * July" reads as nothing having been paid — so the owner pays a coach twice for
 * a period that scrolled off the end of a cap nothing on the screen mentioned.
 * It was the one money read in the console exempt from the rule src/lib/rowCap
 * exists to enforce.
 *
 * Now capped like every other money read: one row past the cap is requested, so
 * a full page and a truncated one do not look identical, and `assertWhole`
 * refuses rather than handing back a partial history that a screen would
 * present as the whole one. A refusal an owner can see is recoverable; a
 * quietly short list is a coach paid twice.
 *
 * `cap` is a parameter so a caller that genuinely wants a window can say so and
 * be refused at ITS OWN size rather than at the default. Nothing passes one
 * today, which is the point: the default is the honest answer.
 */
async function fetchSettlements(sb, tenantId, cap = rowCap_1.ROW_CAP) {
    const { data, error } = await sb
        .from('payroll_settlements')
        .select('id, trainer_id, period_from, period_to, amount_cents, currency, sessions_count, method, note, settled_at')
        .eq('tenant_id', tenantId)
        .order('settled_at', { ascending: false })
        // A total order. `settled_at` alone ties — two runs recorded in the same
        // click are two rows Postgres may return in either order, and the row that
        // falls off the end of a capped read would then be arbitrary.
        .order('id', { ascending: false })
        .limit((0, rowCap_1.capLimit)(cap));
    if (error)
        throw error;
    return (0, rowCap_1.assertWhole)(data, 'this gym’s payroll history', cap).map((r) => ({
        id: r.id,
        trainerId: r.trainer_id,
        periodFrom: r.period_from,
        periodTo: r.period_to,
        // NOT `?? 0`, which is what this was.
        //
        // `payroll_settlements.amount_cents` and `sessions_count` are both NOT NULL
        // (supabase/parts/36), so neither coalesce could fire against a healthy
        // database — and that is exactly what made them dangerous. A zero here is
        // the claim that a coach was handed nothing, on the row /accounting,
        // /close, /sessions and /coach/earnings all read back as a payment that was
        // made; `?? 0` on an amount is the one default this codebase refuses
        // everywhere else, and a silent zero in a payroll total is wrong in the
        // direction nobody checks.
        //
        // A null from a NOT NULL column means the read returned something the
        // schema forbids. That is not a row to render, in any shape.
        amountCents: requireAmount(r.amount_cents, 'amount', r.id),
        // Null through, never coerced. `money()` withholds an amount whose currency
        // nobody chose, which is the whole point of it taking the currency as a
        // required argument; coercing here defeated that before it was ever called.
        currency: r.currency ?? null,
        sessionsCount: requireAmount(r.sessions_count, 'session count', r.id),
        // 'other', not 'transfer'. The column is NOT NULL with a four-way check, so
        // this branch does not fire against a healthy database — but a value this
        // module does not recognise must not be read back as the specific claim
        // "paid by bank transfer" on /accounting. 'other' says the row was settled
        // and does not say how, which is exactly what is known here.
        method: exports.SETTLEMENT_METHODS.includes(r.method) ? r.method : 'other',
        note: r.note ?? null,
        settledAt: r.settled_at,
    }));
}
/** Undo a wrongly recorded outcome, returning the session to "not yet known".
 *
 *  Counted for the same reason `markOutcome` is, and with the sharper edge:
 *  this is the control somebody reaches for having just realised the record is
 *  wrong. Telling them it is undone when nothing changed leaves the wrong
 *  outcome standing with somebody now confident it does not. */
async function clearOutcome(sb, sessionId) {
    const r = await sb.from('sessions').update({ outcome: null }, { count: 'exact' }).eq('id', sessionId);
    (0, wroteRows_1.assertWrote)('Clearing that outcome', r);
}
