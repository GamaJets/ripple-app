"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionsOf = sessionsOf;
exports.attributionOf = attributionOf;
exports.attributionLabel = attributionLabel;
exports.trainingDaysOf = trainingDaysOf;
exports.trainingBoard = trainingBoard;
exports.trainingLine = trainingLine;
exports.unitFor = unitFor;
const entryEdit_1 = require("./entryEdit");
const adherence_1 = require("./adherence");
const bodyweightSets_1 = require("./bodyweightSets");
const timedSets_1 = require("./timedSets");
const num = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null;
/**
 * A log split into sessions, newest first.
 *
 * The order is stated here rather than inherited from the query. The reads that
 * feed this already ask for `performed_at` descending, but a screen headed
 * "newest first" must not depend on an ORDER BY in a file it does not own —
 * `trainingDays` in src/lib/ownTraining.ts makes the same point for the same
 * reason.
 *
 * An entry whose timestamp cannot be parsed keeps its session (the raw string
 * is still a perfectly good grouping key, and the sets in it are real) but gets
 * `day: null` rather than being filed under today. Inventing a training day out
 * of a parsing failure is the bug ownTraining.ts documents; here it would put
 * a session on the coach's screen dated to the moment they opened it.
 */
function sessionsOf(log, 
/**
 * The member's weigh-ins, so a bodyweight set can be priced at what they
 * weighed ON THE DAY. Defaulted to empty rather than made required, because
 * three coach screens call this and an empty history is the honest answer for
 * a caller that has not read one: those sets come back as `bodyweightSets`
 * and the screen says the volume does not cover them.
 */
history = []) {
    const byAt = new Map();
    for (const e of log) {
        if (!e || typeof e.t !== 'string' || !e.t)
            continue;
        const bucket = byAt.get(e.t);
        if (bucket)
            bucket.push(e);
        else
            byAt.set(e.t, [e]);
    }
    const out = [];
    for (const [at, entries] of byAt) {
        let sets = 0, bodyweightSets = 0, timedSets = 0;
        let volume = 0, anyVolume = false;
        let kcal = 0, anyKcal = false;
        let mins = null, minsDisagree = false;
        let cardio = false;
        let amendedAt = null;
        const names = new Set();
        const coachIds = [];
        let clientLogged = false;
        for (const e of entries) {
            names.add(e.exercise);
            if (e.cardio)
                cardio = true;
            const k = num(e.kcal);
            if (k != null) {
                kcal += k;
                anyKcal = true;
            }
            const m = num(e.sessionMins);
            // Zero is not a length. `setSessionMins` refuses a non-positive figure on
            // the way in for exactly this reason: Health would take it as a real
            // event lasting no time at all.
            if (m != null && m > 0) {
                if (mins == null)
                    mins = m;
                else if (mins !== m)
                    minsDisagree = true;
            }
            if (e.loggedBy) {
                if (!coachIds.includes(e.loggedBy))
                    coachIds.push(e.loggedBy);
            }
            else
                clientLogged = true;
            if (e.amendedAt && (amendedAt == null || Date.parse(e.amendedAt) > Date.parse(amendedAt))) {
                amendedAt = e.amendedAt;
            }
            // This loop used to read `set[1]` directly and total `reps × load` over
            // anything above zero. It was the only one of the app's four volume
            // totals still doing the arithmetic by hand, and it has the most serious
            // reader: this figure is the volume line in the document a member exports
            // and hands to a clinician deciding what they may load. Every pull-up,
            // dip and press-up counted as nothing, and a weighted 45-second plank
            // counted as seconds × kilograms — a mass nobody moved.
            const rows = e.sets ?? [];
            for (let i = 0; i < rows.length; i++) {
                const set = rows[i];
                const reps = num(set?.[0]) ?? 0;
                // Only a real rep count is a set. Everything else on this row is
                // conditioned on it, so a blank row contributes nothing anywhere.
                if (!(reps > 0))
                    continue;
                sets++;
                // A hold is counted as a set and priced as neither volume nor unpriced
                // work. Skipped before the load is resolved, so a weighted plank cannot
                // reach the multiplication.
                if ((0, timedSets_1.isTimedSet)(e, i)) {
                    timedSets++;
                    continue;
                }
                // `setLoadKg`, the resolver every other total in the app uses: the
                // member's own weight on that day for a bodyweight set, the plate load
                // for a barbell set, and null when it genuinely cannot say.
                const load = (0, bodyweightSets_1.setLoadKg)(e, i, set, history, e.t);
                if (load != null && load > 0) {
                    volume += reps * load;
                    anyVolume = true;
                }
                else
                    bodyweightSets++;
            }
        }
        out.push({
            at,
            day: (0, entryEdit_1.dayKeyOf)(at),
            // Copied, and deliberately NOT re-sorted. Every entry in a session shares
            // one instant, so there is no order in the record to recover — the rows
            // arrive in the order the query returned them and that is the only order
            // there is. Sorting on `t` here would look like it was doing something
            // and would in fact be shuffling on a value that is equal throughout.
            entries: [...entries],
            exercises: names.size,
            sets,
            bodyweightSets,
            timedSets,
            volumeKg: anyVolume ? Math.round(volume) : null,
            kcal: anyKcal ? Math.round(kcal) : null,
            mins,
            minsDisagree,
            cardio,
            coachIds,
            clientLogged,
            amendedAt,
        });
    }
    // Newest first. Ties — two sessions written in the same millisecond, which
    // the string key makes impossible, but a reversed page upstream does not —
    // fall back to the key so the order is total and reproducible.
    return out.sort((a, b) => {
        const d = Date.parse(b.at) - Date.parse(a.at);
        return Number.isFinite(d) && d !== 0 ? d : b.at.localeCompare(a.at);
    });
}
/**
 * Who logged a session, from the point of view of the coach reading it.
 *
 * `viewerId` null is the coach's auth session still restoring, and it collapses
 * to 'coach' rather than to 'you': "you logged this" is a specific claim about
 * who was in the room, and a screen that makes it off an unknown id will
 * sometimes make it about a coach who has since handed the client on.
 */
function attributionOf(s, viewerId) {
    if (!s.coachIds.length)
        return 'client';
    if (s.clientLogged)
        return 'mixed';
    if (viewerId && s.coachIds.length === 1 && s.coachIds[0] === viewerId)
        return 'you';
    return 'coach';
}
/** How a session's attribution reads on the coach's screen. `who` is the
 *  client's first name — the sentence is about them either way. */
function attributionLabel(a, who) {
    switch (a) {
        case 'client': return `${who} logged this`;
        case 'you': return 'You logged this';
        case 'coach': return 'Logged by a coach';
        case 'mixed': return `Logged by ${who} and a coach`;
    }
}
/**
 * Sessions folded into the days they happened on, newest day first.
 *
 * A session whose timestamp could not be parsed belongs to no day and comes
 * back in `undated` rather than being filed under one. Putting it under today
 * would invent a training day out of a parsing failure, and putting it under
 * the epoch would invent one in 1970.
 *
 * Deliberately no day-level `mins`. Two logging events on one day may each
 * carry the same session length — that is what `setSessionMins` writes, one
 * figure across every row of a session — and where the four rows above are one
 * workout logged four times, summing their lengths would report four hours of
 * training from an hour of squats. A length is a fact about a session and is
 * shown on the session.
 */
function trainingDaysOf(sessions) {
    const byDay = new Map();
    const undated = [];
    for (const sn of sessions) {
        if (!sn.day) {
            undated.push(sn);
            continue;
        }
        const bucket = byDay.get(sn.day);
        if (bucket)
            bucket.push(sn);
        else
            byDay.set(sn.day, [sn]);
    }
    const days = [];
    for (const [day, group] of byDay) {
        const names = new Set();
        let sets = 0, bodyweightSets = 0, timedSets = 0;
        let volume = 0, anyVolume = false;
        let kcal = 0, anyKcal = false;
        let cardio = false;
        for (const sn of group) {
            sets += sn.sets;
            bodyweightSets += sn.bodyweightSets;
            timedSets += sn.timedSets;
            if (sn.volumeKg != null) {
                volume += sn.volumeKg;
                anyVolume = true;
            }
            if (sn.kcal != null) {
                kcal += sn.kcal;
                anyKcal = true;
            }
            if (sn.cardio)
                cardio = true;
            for (const e of sn.entries)
                names.add(e.exercise);
        }
        days.push({
            day,
            // Newest logging event first inside the day, matching the order of the
            // days themselves. `sessionsOf` already sorts, but a day's contents are
            // read top to bottom and the order must not depend on which bucket a Map
            // happened to fill first.
            sessions: [...group].sort((a, b) => b.at.localeCompare(a.at)),
            exercises: names.size,
            sets,
            bodyweightSets,
            timedSets,
            volumeKg: anyVolume ? Math.round(volume) : null,
            kcal: anyKcal ? Math.round(kcal) : null,
            cardio,
        });
    }
    // Day keys are `YYYY-MM-DD`, so a string compare IS a date compare.
    days.sort((a, b) => b.day.localeCompare(a.day));
    return { days, undated };
}
const UNREADABLE = {
    state: 'unreadable', days: [], undated: [], dayCount: null, entryCount: null,
    sets: null, volumeKg: null, newestDay: null,
};
const EMPTY_BOARD = {
    state: 'none', days: [], undated: [], dayCount: 0, entryCount: 0,
    sets: 0, volumeKg: null, newestDay: null,
};
function trainingBoard(sessions, status) {
    if (sessions == null || status === 'error')
        return UNREADABLE;
    if (!sessions.length) {
        // A read still in flight has produced no rows and is not an empty history.
        // 'loading' therefore cannot say 'none' — it says nothing, and the caller's
        // 'loading' branch is what renders.
        return status === 'loading' ? UNREADABLE : EMPTY_BOARD;
    }
    const { days, undated } = trainingDaysOf(sessions);
    const whole = status === 'ready';
    let sets = 0, volume = 0, anyVolume = false, entries = 0;
    for (const d of days) {
        sets += d.sets;
        entries += d.sessions.length;
        if (d.volumeKg != null) {
            volume += d.volumeKg;
            anyVolume = true;
        }
    }
    for (const u of undated) {
        sets += u.sets;
        entries += 1;
        if (u.volumeKg != null) {
            volume += u.volumeKg;
            anyVolume = true;
        }
    }
    return {
        state: 'some',
        days,
        undated,
        dayCount: whole ? days.length : null,
        entryCount: whole ? entries : null,
        sets: whole ? sets : null,
        volumeKg: whole && anyVolume ? volume : null,
        newestDay: days.length ? days[0].day : null,
    };
}
const s = (n) => (n === 1 ? '' : 's');
/**
 * The line under "Their Training" on app/(trainer)/client.tsx — the compressed
 * claim that stands in for a screen the coach has not opened yet.
 *
 * Same discipline as every line in src/lib/clientBrief.ts: a branch per read
 * status, no count over a truncated read, and no empty answer produced by a
 * failure. The sentence a coach must never be shown is "has logged nothing"
 * when the truth is "we could not ask".
 */
function trainingLine(status, board, who) {
    if (status === 'loading')
        return 'Reading the sessions they have logged…';
    if (board.state === 'unreadable') {
        return `Their logged training could not be read. That is not the same as ${who} having logged none.`;
    }
    if (board.state === 'none') {
        return `Nothing logged yet. The read came back empty, so that is about ${who} rather than about the connection.`;
    }
    const when = board.newestDay ? (0, adherence_1.dayLabel)(board.newestDay) : '—';
    const last = when === '—' ? '' : ` Last trained ${when}.`;
    if (board.dayCount == null) {
        // 'partial'. The newest day survives truncation — the read is ordered
        // newest first — so the date is safe to state and the count is not.
        return `Their training came back at the row limit, so how much of it there is cannot be counted from here.${last}`;
    }
    // Days, not logging events. `entryCount` is the larger number and it is the
    // one a double tap inflates; see the note on `TrainingDay`.
    return `${board.dayCount} day${s(board.dayCount)} logged.${last}`;
}
const isWeightUnit = (v) => v === 'kg' || v === 'lb';
function unitFor(clientUnit, coachUnit, status, who) {
    if (status === 'error') {
        return {
            unit: coachUnit, source: 'you',
            note: `${who}'s own unit could not be read, so every load below is in yours (${coachUnit}). `
                + `That is a fact about the read, not about what their app shows them.`,
        };
    }
    if (status === 'loading') {
        // Not yet an answer. The coach's unit stands in, and the note says the
        // screen is still asking rather than implying it has been told.
        return { unit: coachUnit, source: 'you', note: `Reading which unit ${who} uses. Loads are in yours (${coachUnit}) meanwhile.` };
    }
    if (!isWeightUnit(clientUnit)) {
        return {
            unit: coachUnit, source: 'you',
            note: `${who} has not set a unit on their account, so every load below is in yours (${coachUnit}). `
                + `Their phone may still be showing them the other one.`,
        };
    }
    if (clientUnit === coachUnit)
        return { unit: clientUnit, source: 'client', note: null };
    return {
        unit: clientUnit, source: 'client',
        note: `Every load below is in ${clientUnit} — ${who}'s own unit, and what their phone shows `
            + `them. You read in ${coachUnit}.`,
    };
}
