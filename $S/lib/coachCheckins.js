"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RATING_MAX = void 0;
exports.rating = rating;
exports.ratingLabel = ratingLabel;
exports.adherencePercent = adherencePercent;
exports.weightOf = weightOf;
exports.noteOf = noteOf;
exports.readCoachCheckIns = readCoachCheckIns;
exports.daysAgo = daysAgo;
exports.checkInAge = checkInAge;
exports.checkInGapLine = checkInGapLine;
exports.ratingsLine = ratingsLine;
// ── Why the select list is NOT exported from here ─────────────────────────
//
// The obvious tidy-up is a `COACH_CHECKIN_COLS` constant in this file that
// every screen imports, and it would be a real regression.
// scripts/check-schema.mjs resolves a `.select(NAME)` only against constants
// declared in the SAME FILE — `sourceOf()` builds its map from that file's own
// text and `stringExpr()` returns null for anything else — so a select list
// arriving by import is a list the schema check cannot read, and a read it
// cannot read is a read it cannot verify against the live database. That check
// exists because `workouts.session_mins` was written, committed, generated into
// setup.sql and never run, and no workout saved for two days for anybody.
// app/(trainer)/client.tsx says the same thing about TRAINING_SUMMARY_COLS in
// its own words.
//
// So each screen declares its own literal, and what is shared is the READING of
// the row below. The columns a coach needs are:
//
//     id, at, weight_kg, energy, sleep, mood, adherence, note
//
/** The scale every self-rating on this row is on. Named, because the one time
 *  it was assumed to be a percentage a client was flagged at risk for rating
 *  themselves 4 out of 5. */
exports.RATING_MAX = 5;
/**
 * A rating, or null.
 *
 * Whole numbers from 1 to `RATING_MAX` and nothing else. A 0 is not a rating on
 * a 1-5 scale — it is the shape `Number(null) || 0` produces — and a 7 is not
 * one either. Strings are accepted because PostgREST returns numerics as
 * strings on some column types and refusing them would silently blank a real
 * answer.
 */
function rating(v) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isFinite(n) || !Number.isInteger(n))
        return null;
    return n >= 1 && n <= exports.RATING_MAX ? n : null;
}
/** "4/5", or null when there is no rating to state. A caller that interpolates
 *  this into prose must branch on the null first — see scripts/check-prose.mjs
 *  on what a dash does as the subject of a sentence. */
function ratingLabel(v) {
    const n = rating(v);
    return n == null ? null : `${n}/${exports.RATING_MAX}`;
}
/**
 * A 1-5 self-rating as the percentage every other coach surface renders.
 *
 * The conversion src/ui/roster.tsx already does inline, lifted out so there is
 * one of it. Rounded, because 3/5 is 60 and nobody wants 60.000000000000006.
 */
function adherencePercent(v) {
    const n = rating(v);
    return n == null ? null : Math.round((n / exports.RATING_MAX) * 100);
}
/** A weight off the row, or null. Zero is refused: `check_ins.weight_kg` is
 *  nullable, nobody weighs nothing, and a 0 here is the same coercion artefact
 *  a 0 rating is. */
function weightOf(v) {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
}
/** What the client wrote, or null when it was nothing. Trimmed, because a note
 *  of three spaces is not a note and would render as an empty quote. */
function noteOf(v) {
    if (typeof v !== 'string')
        return null;
    const s = v.trim();
    return s ? s : null;
}
/**
 * The rows, newest first.
 *
 * Rows with no usable timestamp are dropped rather than sorted to one end: `at`
 * is how a coach decides whether this is about last week or about March, and a
 * check-in with no date is not a thing to put in front of them at all.
 *
 * The tie-break on id is the same reason client-goals.tsx gives about
 * `measurements`: two rows sharing an instant with a comparator returning 0
 * leaves their order to whichever sort the runtime happens to use, so the list
 * reorders itself between renders for no visible reason.
 */
function readCoachCheckIns(rows) {
    if (!rows)
        return [];
    const out = [];
    for (const r of rows) {
        const at = typeof r.at === 'string' ? r.at : null;
        if (!at || !Number.isFinite(Date.parse(at)))
            continue;
        out.push({
            id: r.id == null ? '' : String(r.id),
            at,
            weightKg: weightOf(r.weight_kg),
            energy: rating(r.energy),
            sleep: rating(r.sleep),
            mood: rating(r.mood),
            adherence: rating(r.adherence),
            note: noteOf(r.note),
        });
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}
/** Whole days between then and now, or null when the timestamp is unusable.
 *  Calendar-agnostic on purpose: a coach reading "4 days ago" does not need it
 *  to hinge on which side of midnight the row landed. */
function daysAgo(at, now = Date.now()) {
    const t = Date.parse(at);
    if (!Number.isFinite(t))
        return null;
    return Math.max(0, Math.floor((now - t) / 86400000));
}
/** "Today", "Yesterday", "4 days ago" — the age of a check-in as a coach says
 *  it. Null when the timestamp cannot be read, which is the caller's cue to
 *  print nothing rather than a dash inside a sentence. */
function checkInAge(at, now = Date.now()) {
    const d = daysAgo(at, now);
    if (d == null)
        return null;
    if (d === 0)
        return 'Today';
    if (d === 1)
        return 'Yesterday';
    return `${d} days ago`;
}
/**
 * Why there is no check-in to show, in the coach's words — or null when there
 * IS one, which is the caller's cue that there is no sentence to print.
 *
 * The four answers, and only the last of them is about the client. This is the
 * same discipline src/lib/currencyGap.ts holds for a missing currency, and it
 * matters more here: collapsing the four produces "they have not checked in",
 * which is an accusation about a person, delivered to the one person who will
 * act on it. A coach told that about a client who checks in every Monday will
 * open a conversation that starts with them being wrong.
 *
 * `who` is a first name the caller has already established. Passing an unknown
 * name in here is the defect scripts/check-prose.mjs exists to catch.
 */
function checkInGapLine(status, count, who) {
    if (count > 0)
        return null;
    switch (status) {
        case 'loading':
            return 'Reading their check-ins…';
        case 'error':
            return `Their check-ins could not be read, so whether ${who} has sent any is not known. That is a read that failed rather than a client who has not written — try again in a moment.`;
        case 'partial':
            // A truncated read that came back with nothing is a contradiction — the
            // cap cannot bite on an empty set — but 'partial' can also arrive from a
            // caller combining several reads, and answering it as 'ready' would state
            // a fact about the client off an incomplete answer.
            return `Only part of their history came back and none of it was a check-in, so whether ${who} has sent any is not established.`;
        case 'ready':
            return `${who} has not sent a check-in yet. The weekly form is on their app under Check In, and a nudge from you is usually what starts it.`;
    }
}
/**
 * The one-line summary of a check-in, for a row a coach scans rather than
 * reads.
 *
 * Only the ratings that were actually given. Four labels where two were
 * answered would put a dash in front of a coach twice on one line and say
 * nothing; this drops the unanswered ones and returns null when none of the
 * four was given at all, so a caller can withhold the row rather than draw an
 * empty one.
 *
 * All four Title Case, matching app/(client)/report.tsx character for
 * character. That is not a preference: this exact line shipped once as
 * "Energy 4/5 · sleep 3/5 · mood 4/5 · adherence 4/5", one row under four
 * labels that DID match, and it is the second of the two reports that
 * scripts/check-caps.mjs was written from. The client and their coach are now
 * looking at the same four words about the same row, so the two must not drift.
 */
function ratingsLine(c) {
    const parts = [];
    const push = (label, v) => { if (v != null)
        parts.push(`${label} ${v}/${exports.RATING_MAX}`); };
    push('Energy', c.energy);
    push('Sleep', c.sleep);
    push('Mood', c.mood);
    push('Adherence', c.adherence);
    return parts.length ? parts.join(' · ') : null;
}
