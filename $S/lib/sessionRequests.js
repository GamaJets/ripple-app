"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_COACH_TO_ASK = exports.REQUEST_LIVE_CAP = exports.REQUEST_HORIZON_DAYS = exports.REQUEST_NOTE_MAX = exports.COACH_ACCEPT_RULE = exports.NOT_A_BOOKING = exports.EXPIRY_RULE = exports.OUTCOME_LABEL = exports.isLive = exports.asRequestState = void 0;
exports.shapeRequests = shapeRequests;
exports.outcomeOf = outcomeOf;
exports.coachQueue = coachQueue;
exports.myRequests = myRequests;
exports.countByOutcome = countByOutcome;
exports.outcomeLine = outcomeLine;
exports.askBlocker = askBlocker;
exports.ownDiaryNote = ownDiaryNote;
exports.askRefusalNote = askRefusalNote;
exports.answerRefusalNote = answerRefusalNote;
exports.askedConfirmation = askedConfirmation;
exports.answeredConfirmation = answeredConfirmation;
exports.answerTellLine = answerTellLine;
exports.coachQueueNote = coachQueueNote;
// Asking for an hour the coach never opened — and the five different things
// that can then be true of it.
//
// ── Why this module exists at all ─────────────────────────────────────────
//
// A client sees GENERATED OPEN SLOTS: real `sessions` rows with
// `status = 'available'`, published by their coach, booked through
// `book_session`. They have never been shown a coach's weekly availability and
// they are not going to be — that table is coach-side by design. So until now a
// member whose coach had not published Tuesday at seven had nothing to tap, and
// the product owner's report said exactly that: "not able to book a session or
// send a request for a booking".
//
// `supabase/parts/740-a-time-the-coach-had-not-opened.sql` is the other half of
// this file and carries the reasoning for the schema. This is the part the apps
// need and the part that can be asserted with no database: what a request IS,
// what has become of one, and what a person is told about it.
//
// ── THE RULE THIS WHOLE FILE PROTECTS ─────────────────────────────────────
//
// A request is not a booking. Nobody has agreed to anything, no hour is held,
// no credit has moved, and the member must never be able to read one as though
// somebody had. That is not a copy preference — it is the failure this feature
// can actually cause: a member who reads "Tuesday 7pm" on their own screen and
// arranges their evening around a question nobody has answered.
//
// So there is no shared sentence. `outcomeLine` writes a DIFFERENT sentence for
// every outcome, `askedLine` never uses the word booked, `NOT_A_BOOKING` is
// printed on the screen where the asking happens, and the test asserts the
// words that must not appear in the ones that are not bookings.
//
// ── The outcome is five things, and only four of them are stored ──────────
//
// `state` in the database is asked | accepted | declined | withdrawn. The fifth
// is EXPIRED and it is computed here, from the hour the request asks for.
//
// The rule, stated once: A REQUEST EXPIRES WHEN THE HOUR IT ASKS FOR ARRIVES,
// and not before. A question about a specific hour is answered by that hour
// passing. A fixed timer — 48 hours, a week — would kill a request made three
// weeks out while it was still perfectly live, and would leave one made for
// tomorrow morning standing after the morning had gone.
//
// Computing it rather than storing it is the deliberate half. A stored expiry
// needs a job, and a job that quietly stops running is precisely how the defect
// beside this one happened: `run_open_slot_extension` skipped every coach with
// no timezone, reported a count nobody read, and produced a client app with
// nothing in it and no error anywhere (supabase/parts/731). Derived, the rule is
// true at every instant with nothing scheduled and reads the same to the
// member's screen, the coach's screen and the RPC that refuses to accept a
// lapsed one.
//
// `EXPIRY_RULE` is that sentence for a member, and the screen prints it where
// they ask rather than where they find out.
//
// ── Money is not in this file, and that is the design ─────────────────────
//
// There is no price here, no credit, no fee and no currency. A question costs
// nothing. An ACCEPTED request becomes a `sessions` row and is paid for by the
// route that already exists: part 740 leaves `booking_drew_credit_at` null, so
// part 370's delivery draw treats it exactly as it treats a session a coach
// books into their own diary. There is no second path and this module would be
// the wrong place to build one.
//
// Pure — no React, no Supabase, no clock of its own. Every function that needs
// "now" is given it, so the whole of it is assertable under `npm test`.
const booking_1 = require("./booking");
// The one wording this product has for a push whose recipient list was only
// partly read. Imported rather than reworded — see PUSH_PARTIAL_NOTE.
const notifyCopy_1 = require("./notifyCopy");
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
/**
 * A stored state this build recognises, or null.
 *
 * Null rather than a default, and the callers below turn null into 'asked'
 * ONLY where a row exists at all. The value that must never be invented is
 * 'accepted': reading a state this build has never heard of as an acceptance
 * would tell a member their coach had said yes on the strength of a string.
 */
const asRequestState = (v) => v === 'asked' || v === 'accepted' || v === 'declined' || v === 'withdrawn' ? v : null;
exports.asRequestState = asRequestState;
/**
 * Rows in, requests out. Anything without an id and an hour is dropped: there
 * is no sentence to write about a request that cannot say when it is for.
 */
function shapeRequests(rows) {
    if (!rows)
        return [];
    const out = [];
    for (const r of rows) {
        const id = str(r.id);
        const startsAt = str(r.starts_at);
        if (!id || !startsAt || !Number.isFinite(Date.parse(startsAt)))
            continue;
        const dur = typeof r.duration_min === 'number' && r.duration_min > 0 ? r.duration_min : 60;
        out.push({
            id,
            clientId: str(r.client_id) ?? '',
            trainerId: str(r.trainer_id) ?? '',
            startsAt,
            durationMin: dur,
            note: str(r.note),
            // An unrecognised state falls back to 'asked' — the state that claims
            // nothing. It never falls back to 'accepted'.
            state: (0, exports.asRequestState)(r.state) ?? 'asked',
            sessionId: str(r.session_id),
            declineNote: str(r.decline_note),
            answeredAt: str(r.answered_at),
            createdAt: str(r.created_at) ?? startsAt,
        });
    }
    return out;
}
/* ── what has become of it ─────────────────────────────────────────────── */
/**
 * The outcome, which is the stored state unless the clock has overtaken it.
 *
 * Only an unanswered request can lapse. An accepted one that has been and gone
 * is a session that happened; a declined one stays declined for ever. Reading
 * either as 'expired' would erase an answer the coach actually gave.
 */
function outcomeOf(r, now = Date.now()) {
    if (r.state !== 'asked')
        return r.state;
    const t = Date.parse(r.startsAt);
    // An unparseable hour is not a lapsed one. Treating it as expired would
    // retire somebody's live question on the strength of a string this file
    // failed to read.
    return Number.isFinite(t) && t <= now ? 'expired' : 'asked';
}
/** Still a live question: the coach can still answer it and the member can
 *  still take it back. */
const isLive = (r, now = Date.now()) => outcomeOf(r, now) === 'asked';
exports.isLive = isLive;
/**
 * The coach's queue: what they have actually been asked, soonest first.
 *
 * Generic over the row rather than typed to `SessionRequest`, so the coach
 * screen's own shape — which carries the client's NAME alongside — survives the
 * filter. A signature that flattened it here would have made the screen cast
 * the name back on afterwards, which is where a name belonging to the wrong row
 * gets introduced.
 */
function coachQueue(list, now = Date.now()) {
    return list.filter((r) => (0, exports.isLive)(r, now)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
/** The member's own list: everything, newest question first, whatever came of
 *  it. Deliberately NOT filtered — a member needs to see the declines. */
function myRequests(list) {
    return [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
/** How many of each outcome, for a screen that has to say what it is holding.
 *  Only ever computed by a caller that knows it has the whole set — see
 *  `isWhole` in src/ui/loadStatus.ts. */
function countByOutcome(list, now = Date.now()) {
    const out = { asked: 0, accepted: 0, declined: 0, withdrawn: 0, expired: 0 };
    for (const r of list)
        out[outcomeOf(r, now)] += 1;
    return out;
}
/* ── the five sentences ────────────────────────────────────────────────── */
/**
 * The short label beside a request. Title Case, like every other label in this
 * app — and NONE of them is the word "Booked", including the accepted one,
 * which says what it became rather than what it was.
 */
exports.OUTCOME_LABEL = {
    asked: 'Waiting on Your Coach',
    accepted: 'In Your Calendar',
    declined: 'Your Coach Said No',
    withdrawn: 'You Took It Back',
    expired: 'The Time Passed',
};
/**
 * What a member is told, per outcome. Five sentences, deliberately not one.
 *
 * `when` is a preformatted time label — this file does not format dates,
 * because a locale is the reader's and `appLocale()` is where that is settled.
 * It is passed in already written so no sentence here can be assembled around a
 * dash: a caller with no readable time has no business drawing this row at all.
 *
 * The 'asked' sentence is the one that has to be exactly right. It carries the
 * expiry rule with it, because the member is reading it at the moment they are
 * deciding whether to rely on the hour.
 */
function outcomeLine(r, when, now = Date.now()) {
    switch (outcomeOf(r, now)) {
        case 'asked':
            return `You asked for ${when}. Nothing is booked and the time is not held for you — your coach has not answered yet, and this stops standing once ${when} arrives.`;
        case 'accepted':
            return `Your coach said yes to ${when}, so it is a real session now and it is on your calendar.`;
        case 'declined':
            return r.declineNote
                ? `Your coach couldn’t do ${when}, and said: “${r.declineNote}” Ask for another time, or message them.`
                : `Your coach couldn’t do ${when}. They didn’t say why — ask for another time, or message them.`;
        case 'withdrawn':
            return `You took back your request for ${when}, so your coach is no longer being asked about it.`;
        case 'expired':
            return `${when} came and went without an answer, so nothing was arranged and nobody is expecting you. Ask for a time further ahead if you still want one.`;
    }
}
/**
 * The rule about an unanswered request, said BEFORE the member relies on it.
 *
 * This belongs on the asking screen and not on a screen somebody reaches after
 * being disappointed. It is the whole of the policy in one sentence, and the
 * SQL header, the test and this string all state the same rule.
 */
exports.EXPIRY_RULE = 'A request stands until the time you asked for arrives. If your coach hasn’t answered by then it lapses on its own, nothing is arranged, and nobody is expecting you.';
/** Said on the asking screen, above the button. The one sentence that has to
 *  survive being read quickly. */
exports.NOT_A_BOOKING = 'This asks your coach for a time. It is not a booking: no session is held, nothing comes off your sessions, and nothing is arranged until your coach says yes.';
/** What the coach is told, once, about what accepting does. */
exports.COACH_ACCEPT_RULE = 'Saying yes puts a real session in your calendar at that time and tells your client it is on. Saying no tells them too, so they can ask for something else.';
/* ── asking: what the screen refuses before the server has to ──────────── */
/** The longest note either side may attach. Matches the CHECK in part 740 —
 *  a field that lets somebody type past the constraint is a write that fails
 *  after they have written. */
exports.REQUEST_NOTE_MAX = 400;
/**
 * How far ahead a request may be made.
 *
 * There is a horizon because a request has to be a question somebody can
 * usefully answer, and "are you free on a Tuesday in March next year" is not
 * one — a coach cannot say yes to it honestly, and a member holding a
 * seven-month-old unanswered request has been misled by their own screen.
 * Ninety days is a quarter, which is as far as any coach in this app publishes.
 */
exports.REQUEST_HORIZON_DAYS = 90;
/**
 * How many unanswered requests one member may have with one coach at once.
 *
 * The same number as `session_request_live_cap()` in part 740, restated here so
 * the screen can refuse before the write rather than after it. If the two ever
 * disagree the server wins and `askRefusalNote('too-many')` is what the member
 * reads, which is why that sentence does not name a figure.
 */
exports.REQUEST_LIVE_CAP = 10;
/**
 * Why this request cannot be sent, or null when it can.
 *
 * Every one of these is also enforced by the server — none of it is trusted to
 * the phone. This exists so the member is told at the moment they tap, in a
 * sentence about what they did, instead of being handed a refusal code.
 *
 * `myBusy` is the member's OWN commitments, which their app can see: their
 * booked sessions. Asking for an hour they are already in a session for is a
 * mistake worth catching here, and one the server does not check — part 740
 * refuses a clash on the COACH's diary, and the member's own diary is theirs.
 */
function askBlocker(startsAt, durationMin, now, opts = {}) {
    const t = Date.parse(startsAt);
    if (!Number.isFinite(t))
        return 'Pick a day and a time first.';
    if (t <= now)
        return 'That time has already passed. Pick a time that is still ahead.';
    if (t > now + exports.REQUEST_HORIZON_DAYS * 86400000) {
        return `That is more than ${exports.REQUEST_HORIZON_DAYS} days away. Ask nearer the time — your coach can’t answer for a date that far out.`;
    }
    if (!Number.isFinite(durationMin) || durationMin <= 0)
        return 'Pick how long you want.';
    const live = (opts.live ?? []).filter((r) => (0, exports.isLive)(r, now));
    if (live.some((r) => Date.parse(r.startsAt) === t)) {
        return 'You have already asked for that time and your coach hasn’t answered yet.';
    }
    if (live.length >= exports.REQUEST_LIVE_CAP) {
        return 'You have as many unanswered requests as you can have at once. Wait for your coach to answer one, or take one back.';
    }
    if (opts.myBusy && opts.myBusy.length && (0, booking_1.overlaps)(startsAt, durationMin, opts.myBusy)) {
        return 'You already have a session booked then.';
    }
    return null;
}
/**
 * What the screen must say when the member's OWN diary is not a whole read.
 *
 * `askBlocker`'s `myBusy` clash check is not a convenience. It is the ONLY
 * check of the member's own calendar that exists anywhere in this feature:
 * part 740 refuses a clash on the COACH's diary and deliberately says nothing
 * about the client's, on the reasoning that a member's own diary is theirs. So
 * when the sessions read fails, `myBusy` arrives as `[]` — and an empty list of
 * commitments is indistinguishable from a diary that could not be read. The
 * check silently becomes "no clash", the member asks for an hour they are
 * already booked for, their coach says yes, and they now hold two sessions at
 * one time and are drawn for two credits at delivery.
 *
 * The screen cannot invent the answer, so it says which question it could not
 * ask. Null under 'ready' — that is the one state in which the absence of a
 * clash is a fact rather than a silence.
 *
 * Three statuses, three different sentences, because they are three different
 * situations: one is still happening, one has finished and failed, and one has
 * finished and is short. A single "we couldn't check" over all three would tell
 * somebody mid-read that something had gone wrong.
 */
function ownDiaryNote(status) {
    switch (status) {
        case 'ready':
            return null;
        case 'loading':
            return 'We are still reading your own sessions, so we have not yet checked this time against what you already have booked.';
        case 'partial':
            return 'There are more sessions on your record than we can read in one go, so we may not have checked this time against all of them. Look at your calendar before you ask.';
        case 'error':
            return 'We couldn’t read your own sessions, so we have not checked whether you are already booked at this time. Your coach’s diary is checked when they answer — yours is not, so check your calendar before you ask.';
    }
}
/**
 * The sentence for a member who has no coach to ask.
 *
 * `request_session` already refuses this and `askRefusalNote('no-coach')` is
 * the sentence for the refusal — but that arrives AFTER somebody has picked a
 * day, an hour, a length and typed a note, on a screen headed "With your coach"
 * whose button reads "Ask My Coach". Both of those are claims, and for a member
 * with no coach linked they are false ones the app can prove are false before
 * it makes them: `clients.trainer_id` is already read on launch and surfaced as
 * `coachLinked`.
 *
 * Said only for a KNOWN absence. `coachLinked` is `boolean | null` and null
 * means the read did not land — under which this screen must still offer the
 * ask, because withdrawing the only way to reach a coach on the strength of a
 * failed read is the same mistake in the other direction and costs the member
 * more.
 */
exports.NO_COACH_TO_ASK = 'You don’t have a coach on your account yet, so there is nobody to ask for a time. Find a coach first and this screen is how you ask them for an hour they haven’t opened.';
/* ── the server's refusals, in words ───────────────────────────────────── */
/**
 * What `request_session` said, as a sentence.
 *
 * An unrecognised reason gets a sentence that claims nothing about why — a
 * screen inventing a cause for a refusal it does not understand is how somebody
 * ends up trying the same thing six times.
 */
function askRefusalNote(reason) {
    switch (reason) {
        case 'not-signed-in':
            return 'You are not signed in any more, so nothing was sent. Sign in and ask again.';
        case 'no-coach':
            return 'You don’t have a coach on your account yet, so there is nobody to ask. Join your coach first and this will work.';
        case 'in-the-past':
            return 'That time has already passed, so nothing was sent. Pick a time that is still ahead.';
        case 'bad-time':
        case 'bad-duration':
            return 'That time couldn’t be read, so nothing was sent. Pick the day and the time again.';
        case 'already-asked':
            return 'You have already asked for that time and your coach hasn’t answered yet, so nothing new was sent. Your original request still stands.';
        case 'too-many':
            return 'You have as many unanswered requests as you can have at once, so this one was not sent. Wait for your coach to answer one, or take one back.';
        default:
            return 'That request was not sent, so your coach has not been asked. Nothing has changed — try again in a moment.';
    }
}
/**
 * What `answer_session_request` said, as a sentence for the COACH.
 *
 * The three clash reasons name the obstacle, which is the whole point of
 * checking for them separately in part 740: "you are teaching then" is
 * something a coach can act on and "that didn't work" is not. `className` is
 * the class the server named, where it named one — and the sentence is written
 * so it still reads without one, because a sentence built around a missing
 * value is the defect `check:prose` exists for.
 */
function answerRefusalNote(reason, className) {
    switch (reason) {
        case 'not-signed-in':
            return 'You are not signed in any more, so nothing was answered, nothing was created and your client has not been told anything.';
        case 'not-yours':
            return 'That request isn’t on your list any more. Pull down to refresh.';
        case 'already-answered':
            return 'That one has already been answered — by you on another device, or a moment ago. Nothing was changed and no second session was made.';
        case 'expired':
            return 'The time this asked for has passed, so there is nothing left to say yes to. Your client can ask for another time.';
        case 'clash-booked':
            return 'You already have a session booked then, so nothing was created and your client has not been told it is on. Decline this one, or move the session you have.';
        case 'clash-blocked':
            return 'You have marked that time as unavailable, so nothing was created. Clear the block on your calendar first, or decline this one.';
        case 'clash-class':
            return className
                ? `You are down to teach ${className} then, so nothing was created. Decline this one, or ask the gym to move the class.`
                : 'You are down to teach a class then, so nothing was created. Decline this one, or ask the gym to move the class.';
        case 'clash':
            return 'Something else went into your calendar at that time while this was being answered, so nothing was created. Refresh and look at what is there before you answer again.';
        default:
            return 'That was not answered, so your client has not been told anything and nothing was created. Try again in a moment.';
    }
}
/**
 * What a member is told the instant their request lands.
 *
 * Written to be true of a request and of nothing else: it names what was sent,
 * says plainly that nothing is held, and carries the lapse rule — because this
 * is the alert somebody reads once and then acts on for a week.
 */
function askedConfirmation(when, coachName) {
    const who = coachName ? `${coachName} has` : 'Your coach has';
    return `${who} been asked about ${when}. Nothing is booked yet and the time is not held for you — you will see the answer here. ${exports.EXPIRY_RULE}`;
}
/** What the coach's own answer says back to them. Two sentences, because the
 *  two answers do genuinely different things. */
function answeredConfirmation(accepted, when) {
    return accepted
        ? `${when} is in your calendar now as a booked session, and your client can see it.`
        : `You have said no to ${when}. Your client can see the answer and can ask for another time.`;
}
/**
 * The line under the answer saying whether the client actually heard about it,
 * or null when there is nothing to add.
 *
 * ── The two silences this ends ────────────────────────────────────────────
 *
 * app/(trainer)/sessions.tsx warned on `!ok` and on nothing else, so two
 * outcomes it could see went unsaid — and both of them look, on screen,
 * exactly like the one where everything worked:
 *
 *   · `ok` with `partial`. send-push accepted the call and could not read all
 *     of `push_tokens`, so this client's handset may not be among the ones it
 *     resolved. The coach reads "in your calendar now" and stops thinking
 *     about it;
 *   · `ok` with `recorded: 0`. The push was accepted and the ROW was not
 *     written, so a client who misses the banner has nothing waiting for them
 *     in the app. `notify_users` skips a recipient the caller may not reach —
 *     an ex-client, a hand-added person with no account — and returns 0
 *     without failing, which is precisely the case where the coach needs to
 *     say it out loud rather than the case where nothing is wrong.
 *
 * A refused answer never reaches here: the screen returns on `!res.ok` from
 * `answerRequest` before it sends anything.
 */
function answerTellLine(told) {
    if (!told.ok) {
        return 'We couldn’t send them a notification, so they may not see this until they open the app.';
    }
    if (told.partial) {
        // The one wording this product has for a partly-read recipient list, in
        // its one-person form. See src/lib/notifyCopy.ts.
        return `${(0, notifyCopy_1.pushPartialNote)(1)} Message them if the time matters.`;
    }
    if (told.inboxKept !== false && told.recorded === 0) {
        return 'Their phone was sent a notification, but nothing was written to their notifications — so if they miss the banner there is nothing in the app telling them. Message them if the time matters.';
    }
    return null;
}
/* ── the coach's queue, in one line ────────────────────────────────────── */
/**
 * The heading figure on the coach's screen.
 *
 * Null for nothing waiting, so a caller can render it unconditionally without
 * drawing a banner about zero — the same shape `outboxNote` uses. It is only
 * ever called with a whole read; a count over a truncated one is a figure about
 * an unknown fraction of the set, which src/ui/loadStatus.ts refuses.
 */
function coachQueueNote(n) {
    if (n <= 0)
        return null;
    return n === 1
        ? '1 client is asking for a time you have not opened.'
        : `${n} clients are asking for times you have not opened.`;
}
