"use strict";
// What a client says about a coach, and every rule about how much it may be
// made to mean.
//
// `app/(client)/trainers.tsx` used to render five invented coaches with
// invented star ratings; the fictional coaches went and the header has said
// ever since that "Ratings and review counts are gone — there is no review
// system to feed them." `supabase/parts/139` builds the real one. This file is
// the arithmetic and the wording, kept out of the screens because both are easy
// to get subtly, permanently wrong about a named person's livelihood.
//
// ── Three things this file refuses to do ──────────────────────────────────
//
// 1. Average two ratings. A single 5 is not "5.0 stars", it is one person's
//    opinion, and a screen that renders it as a figure invites a comparison
//    against a coach with forty. Below MIN_FOR_AVERAGE the count is shown and
//    no average is computed at all — `ratingDisplay` has no branch that can
//    produce one.
//
// 2. Say "no reviews yet" over a failed read. That sentence is a claim about
//    somebody's reputation, and the read that produces it fails for the same
//    reasons every other read in this app fails — no signal in a basement gym.
//    'unknown' and 'none' are separate outcomes here and must stay separate on
//    the screen.
//
// 3. Say "only clients can review" when we could not find out whether the
//    reader is one. `reviewGate` returns 'unknown' for that, because telling
//    somebody they were never a client is a thing to be sure of first.
//
// ── Withdrawal, editing, and the coach's answer ───────────────────────────
//
// A review can be rewritten and it can be withdrawn, and rewriting CLEARS the
// coach's reply — see the part file. The client is told that before they save,
// in WORDS FROM HERE, so the sentence is asserted on rather than typed into a
// screen and forgotten.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASK_IS_UNFILTERED = exports.WHO_REVIEWED_IS_HIDDEN = exports.GOAL_FRESH_DAYS = exports.SETTLED_DAYS = exports.REPLY_NOTE = exports.WITHDRAW_NOTE = exports.EDIT_NOTE = exports.IDENTITY_NOTE = exports.MAX_REPLY = exports.MAX_BODY = exports.MIN_FOR_AVERAGE = exports.MAX_RATING = exports.MIN_RATING = void 0;
exports.ratingDisplay = ratingDisplay;
exports.formatAverage = formatAverage;
exports.ratingLine = ratingLine;
exports.reviewGate = reviewGate;
exports.reviewGateNote = reviewGateNote;
exports.reviewListState = reviewListState;
exports.gymLine = gymLine;
exports.reviewerLabel = reviewerLabel;
exports.writeOutcome = writeOutcome;
exports.asWriteResult = asWriteResult;
exports.validateReview = validateReview;
exports.draftProblemText = draftProblemText;
exports.validateReply = validateReply;
exports.unansweredCount = unansweredCount;
exports.askMoment = askMoment;
exports.askMomentNote = askMomentNote;
exports.reviewAskDraft = reviewAskDraft;
exports.askListNote = askListNote;
exports.MIN_RATING = 1;
exports.MAX_RATING = 5;
/** Below this many reviews, a count is shown and no average is computed. */
exports.MIN_FOR_AVERAGE = 3;
exports.MAX_BODY = 1500;
exports.MAX_REPLY = 1500;
/**
 * `summary` is null when there is no row for this coach, which under a
 * completed read means genuinely no reviews. Under 'error' it means nothing at
 * all, which is why status is a parameter and not an afterthought.
 *
 * 'partial' is treated as 'error' here on purpose: the load-status vocabulary
 * says a count or an average over a truncated set may not be shown, and both of
 * those are the only things this function produces.
 */
function ratingDisplay(summary, status) {
    if (status === 'loading')
        return { kind: 'loading' };
    if (status !== 'ready')
        return { kind: 'unknown' };
    if (!summary || summary.count <= 0)
        return { kind: 'none' };
    if (summary.count < exports.MIN_FOR_AVERAGE)
        return { kind: 'few', count: summary.count };
    return { kind: 'average', average: summary.sum / summary.count, count: summary.count };
}
/** One decimal, and never rounded up to a number the ratings cannot reach. */
function formatAverage(avg) {
    const clamped = Math.min(exports.MAX_RATING, Math.max(exports.MIN_RATING, avg));
    return (Math.round(clamped * 10) / 10).toFixed(1);
}
/** The short text on a directory row. Null when nothing may honestly be said. */
function ratingLine(d) {
    switch (d.kind) {
        case 'loading':
        case 'unknown':
            return null;
        case 'none':
            return 'No reviews yet';
        case 'few':
            return `${d.count} review${d.count === 1 ? '' : 's'}`;
        case 'average':
            return `${formatAverage(d.average)} from ${d.count} reviews`;
    }
}
/**
 * Whether the reader may write a review, and why not when they may not.
 *
 * `canReview` comes from `can_review_coach()`, which answers "is, or was, this
 * coach's client" — an ACTIVE or ENDED relationship, never a PENDING one. A
 * pending row is what `join_by_code` leaves behind for anybody holding a code a
 * coach handed out, so gating on it would let somebody the coach declined
 * review them.
 */
function reviewGate(input) {
    if (input.isSelf)
        return 'self';
    if (input.status === 'loading')
        return 'loading';
    if (input.status === 'error' || input.canReview === null)
        return 'unknown';
    return input.canReview ? 'allowed' : 'not-a-client';
}
function reviewGateNote(g) {
    switch (g) {
        case 'loading': return null;
        case 'allowed': return null;
        case 'self': return 'This is your own profile.';
        case 'not-a-client': return 'Reviews come from people this coach has actually trained, so only their current and former clients can leave one.';
        case 'unknown': return 'We couldn’t check whether you’ve trained with this coach, so we can’t open the review form. This is our end — try again in a moment.';
    }
}
/**
 * The one place "no reviews yet" is allowed to be decided. Note that 'error'
 * with rows in hand is still 'unreadable': stale rows may be shown as a list,
 * but the SCREEN needs to know they are not the current set.
 */
function reviewListState(status, rows) {
    if (status === 'loading')
        return 'loading';
    if (status === 'error')
        return 'unreadable';
    return rows.length > 0 ? 'some' : 'none';
}
/** "Written at Iron Works" — only ever set when the gym is not the reader's. */
function gymLine(r) {
    const g = (r.otherGym ?? '').trim();
    return g ? `Trained with them at ${g}` : null;
}
/** The reviewer, as the reader sees them. Never invents a name. */
function reviewerLabel(r) {
    const n = (r.reviewerName ?? '').trim();
    return n || 'A client';
}
// ── The sentences a client reads before they write one ─────────────────────
//
// In this file rather than in the screen because each is a promise the product
// has to keep, and the test is where that is written down.
/** Reviews are not anonymous in practice, and saying otherwise would be a lie. */
exports.IDENTITY_NOTE = 'Your first name is shown with your review. Your coach can probably work out it was you, so write it the way you would say it to them.';
/** Rewriting clears the coach's answer. Said before saving, not after. */
exports.EDIT_NOTE = 'If you change a review your coach has already replied to, their reply is removed — it answered what you wrote before.';
/** What withdrawing does and does not do. */
exports.WITHDRAW_NOTE = 'Withdrawing hides your review from everyone. You can write a new one later; it will replace this one rather than sit alongside it.';
/** The coach's side, on the screen where they answer. */
exports.REPLY_NOTE = 'Your reply is public, under the review, with your name on it. It is the only thing you can do about a review you disagree with — there is no way to take one down from inside the app.';
/**
 * The outcome, in words. `saved` is the flag a screen uses to decide whether to
 * change what it is showing, and it is true for exactly one of these — a
 * zero-row write over PostgREST is not an error and never arrives as one, which
 * is why `write_coach_review` returns a word rather than relying on a throw.
 */
function writeOutcome(r, coachName) {
    const who = (coachName ?? '').trim() || 'your coach';
    switch (r) {
        case 'written':
            return { title: 'Review saved', body: `It is on ${who}’s profile now, with your first name. You can change it or withdraw it whenever you like.`, saved: true };
        case 'not_a_client':
            return { title: 'Not saved', body: `Only ${who}’s current and former clients can review them, and we have no record of you training with them.`, saved: false };
        case 'invalid_rating':
            return { title: 'Not saved', body: `Choose a rating between ${exports.MIN_RATING} and ${exports.MAX_RATING} stars.`, saved: false };
        case 'self':
            return { title: 'Not saved', body: 'You cannot review yourself.', saved: false };
        case 'signed_out':
            return { title: 'Not saved', body: 'Sign in to Repple and try again.', saved: false };
        case 'failed':
            return { title: 'Could not save', body: 'We could not reach the server, so nothing was written. Your review is still here — try again in a moment.', saved: false };
    }
}
/** Whatever the RPC returned, narrowed to something with a sentence behind it. */
function asWriteResult(v) {
    return v === 'written' || v === 'not_a_client' || v === 'invalid_rating'
        || v === 'self' || v === 'signed_out'
        ? v
        : 'failed';
}
function validateReview(d) {
    if (d.rating === null)
        return 'no-rating';
    if (!Number.isInteger(d.rating) || d.rating < exports.MIN_RATING || d.rating > exports.MAX_RATING)
        return 'bad-rating';
    if (d.body.trim().length > exports.MAX_BODY)
        return 'body-too-long';
    return 'ok';
}
function draftProblemText(p) {
    switch (p) {
        case 'ok': return '';
        case 'no-rating': return 'Pick a rating first.';
        case 'bad-rating': return `A rating is ${exports.MIN_RATING} to ${exports.MAX_RATING} stars.`;
        case 'body-too-long': return `Keep it under ${exports.MAX_BODY} characters.`;
    }
}
function validateReply(text) {
    return text.trim().length > exports.MAX_REPLY ? 'too-long' : 'ok';
}
/**
 * What a coach's own review inbox needs to know: how many are waiting on an
 * answer. Only ever computed from a complete read — an "unanswered" count off a
 * truncated list would tell a coach they were on top of it.
 */
function unansweredCount(rows, status) {
    if (status !== 'ready')
        return null;
    return rows.filter((r) => !(r.coachReply ?? '').trim()).length;
}
/** How long somebody has to have been on the book before there is anything to
 *  review. Eight weeks is the shortest block most coaches sell, and asking
 *  inside it is asking somebody to review a plan they are still on. */
exports.SETTLED_DAYS = 56;
/** How recently a goal must have been reached for it to be the moment. A
 *  fortnight: past that the coach is referring to something the client has
 *  stopped thinking about, which reads as a prompt rather than as a
 *  conversation. */
exports.GOAL_FRESH_DAYS = 14;
const DAY = 86400000;
/**
 * Said on the screen, once, and not softened.
 *
 * A coach will notice that somebody who has already reviewed them is still on
 * this list, and will report it as a bug. It is not one — it is the reviewer
 * anonymity `coach_reviews` enforces, seen from the coach's side — and telling
 * them so is cheaper than the support conversation and much cheaper than the
 * "fix" somebody would otherwise reach for.
 */
exports.WHO_REVIEWED_IS_HIDDEN = 'Repple cannot tell you who has already written one. Reviews carry a name only where the reviewer put one, and which client wrote which is not something this app will hand a coach — so somebody who has already reviewed you may still appear here. They will say so.';
/**
 * Whether now is a moment, and which.
 *
 * Order matters: a goal reached outranks a settled record, because a client who
 * has done both is being asked about the goal.
 */
function askMoment(c, now = Date.now()) {
    // Already asked, or we could not check. Both stop here — see `asked`.
    if (c.asked !== false)
        return 'none';
    const goal = c.goalReachedAt ? Date.parse(c.goalReachedAt) : NaN;
    if (Number.isFinite(goal) && now - goal >= 0 && now - goal <= exports.GOAL_FRESH_DAYS * DAY) {
        return 'goal-reached';
    }
    const since = c.since ? Date.parse(c.since) : NaN;
    // An unknown join date is not a long one. A client the roster cannot date is
    // as likely to have joined on Tuesday as last year, and the honest answer is
    // no moment rather than a guess in the direction that produces a prompt.
    if (Number.isFinite(since) && now - since >= exports.SETTLED_DAYS * DAY)
        return 'settled';
    return 'none';
}
/** Sentence case. Why this person and not somebody else — printed on the row,
 *  because a coach asked to send something has to be able to see the reason. */
function askMomentNote(m, c, now = Date.now()) {
    if (m === 'goal-reached') {
        const goal = c.goalReachedAt ? Date.parse(c.goalReachedAt) : NaN;
        const days = Number.isFinite(goal) ? Math.max(0, Math.round((now - goal) / DAY)) : null;
        return days == null
            ? 'They have marked a goal of their own as reached.'
            : days === 0
                ? 'They marked a goal of their own as reached today.'
                : `They marked a goal of their own as reached ${days} day${days === 1 ? '' : 's'} ago.`;
    }
    if (m === 'settled') {
        const since = c.since ? Date.parse(c.since) : NaN;
        const weeks = Number.isFinite(since) ? Math.floor((now - since) / (7 * DAY)) : null;
        return weeks == null
            ? 'They have been with you long enough to have something to say.'
            : `They have been with you ${weeks} weeks, so there is something to write about.`;
    }
    return 'Nothing about today makes it a better moment than any other.';
}
/**
 * The draft. A starting point for the coach, and never a message.
 *
 * Written to the same three rules `draftMessage` in src/lib/nudge.ts keeps, and
 * one more of its own: IT DOES NOT ASK FOR A GOOD REVIEW. "If you've got a
 * minute" and "a good word" are two different requests, and the second is the
 * one that turns an average into a number nobody should trust. The coach may
 * edit it to anything they like; what matters is that the version they start
 * from is one they could show the client afterwards.
 */
function reviewAskDraft(m, clientName, coachName) {
    const who = firstWord(clientName);
    const me = firstWord(coachName);
    const hi = who ? `Hi ${who} — ` : '';
    const sign = me ? `\n\n${me}` : '';
    const opener = m === 'goal-reached'
        ? 'congratulations again on hitting that. '
        : '';
    return `${hi}${opener}If you have a couple of minutes, would you write a short review of the coaching in the app? `
        + `It is the main way people decide whether to work with me, and it helps far more than you would think. `
        + `Say whatever you actually think — it goes up as written.${sign}`;
}
/** First word only, and never a fragment of an email address or a bare uuid: a
 *  draft opening "Hi 7f3a9c21" is worse than one opening with no name at all.
 *  The same rule `greetingName` keeps in src/lib/nudge.ts. */
function firstWord(name) {
    const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
    if (!first)
        return null;
    if (first.includes('@'))
        return null;
    if (/^[0-9a-f-]{8,}$/i.test(first))
        return null;
    if (!/[A-Za-zÀ-ÿ]/.test(first))
        return null;
    return first;
}
/**
 * The line above a list of people worth asking, true in every state.
 *
 * Null in means null out — the same rule `boardNote` and `summariseDrift` keep.
 * Before the read lands there is nobody to ask, and "nobody is worth asking
 * right now" printed while it is in flight tells a coach something about their
 * book that nothing has checked.
 */
function askListNote(rows) {
    if (rows == null)
        return 'Working out who is worth asking…';
    const n = rows.filter((r) => r.moment !== 'none').length;
    if (n === 0) {
        return 'Nobody on the part of your book that was read is at a moment worth asking at. That is a real answer — this list is not a monthly sweep, and asking everybody every month is how a good business collects bad reviews.';
    }
    return `${n} ${n === 1 ? 'client is' : 'clients are'} at a moment worth asking at. Nothing is sent from here: you get a draft, you edit it, you send it yourself.`;
}
/**
 * Said on the screen, once, and not softened.
 *
 * The sentence a coach needs before they press anything, and the one that stops
 * this feature turning into review-gating the first time somebody asks for a
 * "only ask the happy ones" filter.
 */
exports.ASK_IS_UNFILTERED = 'Repple does not choose who to ask by how they are likely to rate you, and it never will — asking only the people who look happy is a lie told to everybody who reads the average afterwards. What decides this list is whether there is anything to review yet.';
