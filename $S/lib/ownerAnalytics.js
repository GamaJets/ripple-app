"use strict";
// Gym analytics — pure functions over the gym's own roster.
//
// `profiles.role = 'owner'` means a gym owner, so these describe a gym, not
// Repple's SaaS business. The previous version scored trainers on `plan`, `mrr`
// and `status: suspended` — what a trainer pays Repple, which is not a figure a
// gym owner has any business seeing on their own dashboard, and which nothing
// in the database was writing anyway.
//
// What a gym owner actually knows about a coach: how many clients they carry
// and how many sessions they actually delivered. Both come from rows.
// No UI, no state → unit-testable.
Object.defineProperty(exports, "__esModule", { value: true });
exports.trainerHealth = trainerHealth;
exports.gymRollup = gymRollup;
exports.cohorts = cohorts;
exports.clientAnalytics = clientAnalytics;
const localDate_1 = require("./localDate");
/**
 * Health from the two things a gym can observe: client load and delivered
 * sessions. A coach with clients who is running no sessions is the signal an
 * owner wants — it is invisible on a headcount.
 *
 * ── Booked is not delivered ────────────────────────────────────────────────
 *
 * `sessions30` counts bookings whose clock has passed, marked or not. Scoring
 * on it meant a trainer with six clients and twenty sessions that NOBODY MARKED
 * came back "ok — carrying clients and delivering sessions", green, sorted in
 * among the people actually working. The truthful statement is that there is no
 * evidence any of the twenty happened, and that same trainer is the one whose
 * pay cannot be computed. staffView.ts was written to hold that gate on the
 * staff screen, but the owner's dashboard, the trainers screen and the console's
 * Trainers table all call this function directly with no gate in front of it —
 * so the inversion was live on three screens.
 *
 * `fetchGymTrainers` has always returned `delivered30` and `unmarked30`. This
 * function simply threw them away. It now judges on evidence where the caller
 * supplies it, and falls back to `sessions30` only for callers that do not
 * track delivery — those get their old answer rather than being told, wrongly,
 * that they delivered nothing.
 */
function trainerHealth(tr) {
    const clients = tr.clients || 0;
    const booked = tr.sessions30 || 0;
    const tracksDelivery = tr.delivered30 != null;
    const delivered = tr.delivered30 ?? 0;
    const unmarked = tr.unmarked30 ?? 0;
    /** What the record can actually stand behind. */
    const evidenced = tracksDelivery ? delivered : booked;
    // Still `booked`: somebody with twenty unmarked sessions has not been idle,
    // whatever else is unknown about them.
    if (clients === 0 && booked === 0) {
        return { score: 0, tone: 'low', risk: 'idle', reason: 'No clients and no sessions in the last 30 days.' };
    }
    // Client load and delivery weigh roughly equally; 12 clients and 20 sessions
    // in a month is a full book, not a ceiling on quality.
    const clientPts = Math.min(clients, 12) / 12 * 50;
    const sessionPts = Math.min(evidenced, 20) / 20 * 50;
    const score = Math.max(0, Math.min(100, Math.round(clientPts + sessionPts)));
    const plural = (n) => `${n} session${n === 1 ? '' : 's'}`;
    let risk, reason;
    if (clients > 0 && evidenced === 0 && unmarked > 0) {
        // The trap named above. Not "no sessions delivered" — that would assert
        // they delivered nothing, which is a different claim from not knowing.
        risk = 'high';
        reason = `${plural(unmarked)} finished but unmarked — no evidence any were delivered, and no pay can be computed.`;
    }
    else if (clients > 0 && evidenced === 0) {
        risk = 'high';
        reason = `${clients} client${clients === 1 ? '' : 's'} but no sessions delivered in 30 days.`;
    }
    else if (clients === 0) {
        risk = 'watch';
        reason = 'Delivering sessions but has no clients on the roster.';
    }
    else if (evidenced < 4) {
        risk = 'watch';
        reason = 'Few sessions delivered this month.';
    }
    else if (unmarked > 0) {
        // Delivering, but part of the month cannot be valued. Not healthy-green.
        risk = 'watch';
        reason = `Delivering, but ${plural(unmarked)} still unmarked — that part cannot be valued.`;
    }
    else {
        risk = 'ok';
        reason = 'Carrying clients and delivering sessions.';
    }
    const tone = score >= 70 ? 'good' : score >= 40 ? 'moderate' : 'low';
    return { score, tone, risk, reason };
}
function gymRollup(trainers, sessionFee) {
    const clients = trainers.reduce((a, t) => a + (t.clients || 0), 0);
    const sessions30 = trainers.reduce((a, t) => a + (t.sessions30 || 0), 0);
    const delivered30 = trainers.reduce((a, t) => a + (t.delivered30 ?? 0), 0);
    const unmarked30 = trainers.reduce((a, t) => a + (t.unmarked30 ?? 0), 0);
    let atRiskCount = 0, atRiskClients = 0;
    for (const t of trainers) {
        const h = trainerHealth(t);
        if (h.risk !== 'ok') {
            atRiskCount++;
            atRiskClients += t.clients || 0;
        }
    }
    const n = trainers.length;
    return {
        trainers: n,
        clients,
        sessions30,
        delivered30,
        unmarked30,
        payroll30: sessionFee == null || unmarked30 > 0 ? null : Math.round(delivered30 * sessionFee),
        atRiskCount,
        atRiskClients,
        avgClientsPerTrainer: n ? Math.round((clients / n) * 10) / 10 : null,
        avgSessionsPerTrainer: n ? Math.round((sessions30 / n) * 10) / 10 : null,
    };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-08-19T…" → "Aug 2026". Null/unparseable → null, never a guess. */
/**
 * The calendar month a date belongs to, as [year, monthIndex].
 *
 * Delegates to src/lib/localDate.ts, which explains why a bare YYYY-MM-DD must
 * never go through Date.parse: it resolves to UTC midnight and every local
 * getter then reads back the previous day west of Greenwich, which put anyone
 * joining on the 1st into the wrong retention cohort.
 */
function monthParts(iso) {
    const p = (0, localDate_1.dateParts)(iso);
    return p ? [p[0], p[1]] : null;
}
function monthLabel(iso) {
    const p = monthParts(iso);
    return p ? `${MONTHS[p[1]]} ${p[0]}` : null;
}
/**
 * Trainers grouped by the month they joined, with the share still delivering.
 * Trainers whose join date is unknown are left out rather than bucketed into a
 * fabricated "Unknown" cohort that would drag every percentage.
 */
function cohorts(trainers) {
    const map = new Map();
    for (const t of trainers) {
        const parts = monthParts(t.since);
        if (!parts)
            continue;
        const label = `${MONTHS[parts[1]]} ${parts[0]}`;
        const key = parts[0] * 12 + parts[1];
        const cur = map.get(label) || { total: 0, active: 0, key };
        cur.total++;
        if ((t.sessions30 || 0) > 0)
            cur.active++;
        map.set(label, cur);
    }
    return [...map.entries()]
        .map(([label, v]) => ({ label, total: v.total, active: v.active, pct: Math.round((v.active / v.total) * 100), key: v.key }))
        .sort((a, b) => a.key - b.key)
        .map(({ key, ...rest }) => rest);
}
function clientAnalytics(trainers) {
    const total = trainers.reduce((a, t) => a + (t.clients || 0), 0);
    let engaged = 0, atRisk = 0;
    for (const tr of trainers) {
        const c = tr.clients || 0;
        if (trainerHealth(tr).risk === 'ok')
            engaged += c;
        else
            atRisk += c;
    }
    const byTrainer = trainers
        .map((t) => ({ id: t.id, name: t.name, clients: t.clients || 0, pct: total ? Math.round(((t.clients || 0) / total) * 100) : 0 }))
        .sort((a, b) => b.clients - a.clients);
    return {
        total, engaged, atRisk,
        engagementPct: total ? Math.round((engaged / total) * 100) : null,
        avgPerTrainer: trainers.length ? Math.round((total / trainers.length) * 10) / 10 : null,
        byTrainer,
    };
}
