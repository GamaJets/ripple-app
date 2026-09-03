"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COACH_REFERRAL_PRIVACY_NOTE = exports.COACH_REWARD_NOTE = exports.REFERRAL_PRIVACY_NOTE = exports.CONVERSION_RULE = void 0;
exports.shapeReferrals = shapeReferrals;
exports.joinedLabel = joinedLabel;
exports.friendLine = friendLine;
exports.invitesCutLine = invitesCutLine;
exports.summaryLine = summaryLine;
exports.rewardNote = rewardNote;
exports.shapeCoachReferrers = shapeCoachReferrers;
exports.referrerLine = referrerLine;
exports.coachSummaryLine = coachSummaryLine;
// What a referral is worth saying about, once there is something to say.
//
// Both sides of it live here: the referrer's own view of the friends they
// brought in, and — at the bottom of the file — the coach's view of which of
// their clients have been doing the bringing. The rules are the same rules and
// that is why they share a file rather than a name: joined is not converted,
// nothing is stated under a read that did not land, and no figure in either
// half is money.
//
// ── Why this is a separate file from src/lib/referrals.ts ──────────────────
//
// referrals.ts is the network side: it imports `./supabase`, which imports
// AsyncStorage, which is a React Native module and cannot be `require`d by
// plain node. Every tested module under src/lib is pure for exactly that
// reason — the suite is `tsc && node .tmp/lib/*.test.js`, so a test that pulls
// in the Supabase client does not run at all. The rules below are the ones
// worth asserting on, so they live where a test can reach them, and
// referrals.ts calls in here rather than the other way round.
//
// ── The sentence this file exists to keep honest ───────────────────────────
//
// The Invite screen used to say a referral "can be credited once reward
// attribution is wired on the backend", which is a promise with no date on it,
// and it showed a count that came from `referral_count(code)` — a function that
// counted rows carrying a STRING, for anybody who typed one. There was no
// referrer, so nothing could ever be credited to a person.
//
// There is now attribution (supabase/parts/128), and there is still no reward,
// and those are two different facts that a screen must not blur together.
// Nobody — not the gym, not the coach — has agreed what a referral is worth, so
// this promises nothing and says so out loud. See REWARD_NOTE.
//
// ── Joined is not converted ────────────────────────────────────────────────
//
// A signup, a first session and a first payment are three different promises.
// The database makes the middle one and this module renders it: a referral has
// converted when the person who used the code logged their first workout. That
// distinction is the entire value of the screen — a referrer who is shown "4
// friends joined" learns nothing about whether any of them stayed — so the two
// counts are always rendered together and neither is ever inferred from the
// other.
const format_1 = require("./format");
const locale_1 = require("./locale");
/**
 * Raw rows → rows worth rendering, newest first.
 *
 * A row with no join date is dropped. It is the only thing on the row a reader
 * can orient by — "Sam · joined" with no date is a line that could be from
 * today or from March — and a placeholder date would be a made-up one.
 */
function shapeReferrals(rows) {
    const out = [];
    for (const r of rows || []) {
        const joinedAt = (r?.joined_at || '').trim();
        if (!joinedAt || !Number.isFinite(Date.parse(joinedAt)))
            continue;
        const startedAt = (r.started_at || '').trim();
        const started = startedAt && Number.isFinite(Date.parse(startedAt)) ? startedAt : null;
        out.push({
            // The server already coalesces a blank name to 'A friend'; this repeats
            // it rather than trusting it, because an empty string under an avatar
            // circle is a row that looks broken.
            name: (r.friend_name || '').trim() || 'A friend',
            joinedAt,
            startedAt: started,
            converted: started != null,
        });
    }
    return out.sort((a, b) => Date.parse(b.joinedAt) - Date.parse(a.joinedAt));
}
/**
 * The date a friend joined, as a person reads it.
 *
 * Deliberately no year: every referral on this screen is recent enough that the
 * year adds nothing, and a date that reads as a filing reference reads as
 * something official. Local time, like every other date in the app — the
 * referrer is looking at their own calendar, not the server's.
 */
function joinedLabel(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t))
        return '';
    return new Date(t).toLocaleDateString((0, locale_1.appLocale)(), { day: 'numeric', month: 'short' });
}
/**
 * The line under one friend's name.
 *
 * Says what happened, in the order it happened, and never guesses at the half
 * that has not. "Joined 12 Aug" on its own is the true and complete statement
 * about somebody who has not trained yet; adding "— not converted" would be
 * scoring a person the referrer knows.
 */
function friendLine(r) {
    const joined = `Joined ${joinedLabel(r.joinedAt)}`.trim();
    if (!r.converted)
        return `${joined} · not training yet`;
    return `${joined} · started training ${joinedLabel(r.startedAt)}`;
}
/**
 * The sentence under a list of invites that stopped at the server's own ceiling.
 *
 * `my_referrals()` ends `limit 200` (supabase/parts/128-a-cohort-and-a-credit
 * .sql), and that limit is inside the function body, so nothing on this side
 * can see it: src/lib/rowCap.ts detects truncation by asking for one row more
 * than it will accept, and the server cannot answer with 201 however the client
 * phrases the request. A referrer with two hundred and fifty friends on the
 * code was therefore handed two hundred of them under 'ready', with no sentence
 * anywhere saying the list ended before their friends did.
 *
 * A line under the LIST rather than a 'partial' over the whole screen, and the
 * distinction is the whole point. `my_referral_summary()` counts every row
 * server-side — part 128 says so in as many words — so "250 joined · 90 have
 * started training" is exact and stays exact. Turning the screen 'partial'
 * would withdraw two true figures in order to report one cut list, which is the
 * opposite trade to the one worth making.
 *
 * Null when there is nothing to say, so the caller draws nothing rather than an
 * empty line where a sentence would be.
 */
function invitesCutLine(shown, cap) {
    if (!Number.isFinite(shown) || !Number.isFinite(cap) || cap <= 0)
        return null;
    if (shown < cap)
        return null;
    // The order is `created_at desc`, so what is missing is the oldest — said
    // out loud, because "some are missing" leaves a referrer wondering whether
    // it is the friend they invited this morning.
    return `Only your ${(0, format_1.num)(cap)} most recent invites are listed here. The counts above cover everyone who has used your code.`;
}
/**
 * The two counts, or an honest refusal to state them.
 *
 * Under anything but 'ready' this states no figure and, critically, does not
 * say "nobody". A referrer shown "nobody has used your code" because a read
 * failed concludes their invitations went nowhere and stops sending them —
 * the same failure src/lib/joinCodes.ts documents for a coach's join codes,
 * arriving through the same door.
 *
 * The counts come from `my_referral_summary()`, which is computed over ALL of
 * the caller's referrals rather than over the page `my_referrals()` returns,
 * so they are safe to state under 'ready' even when the list below them is cut.
 */
function summaryLine(status, joined, converted) {
    if (status === 'loading')
        return 'Checking who has joined…';
    if (status === 'error')
        return 'We couldn’t check who has joined with your code.';
    if (status === 'partial')
        return 'Not all of your invites could be read.';
    // Null under 'ready' should not happen — but a count that is not a count is
    // not a zero, and this is the one place that could turn it into one.
    if (joined == null || converted == null)
        return 'We couldn’t check who has joined with your code.';
    if (joined <= 0)
        return 'Nobody has used your code yet.';
    const j = `${(0, format_1.num)(joined)} joined`;
    if (converted <= 0)
        return `${j} · none training yet`;
    const c = converted === 1 ? '1 has started training' : `${(0, format_1.num)(converted)} have started training`;
    return `${j} · ${c}`;
}
/**
 * What "converts" means, said on the screen rather than left to be inferred.
 *
 * A signup, a first session and a first payment are three different promises
 * and this is the one the database can keep. A first payment would be the
 * strongest claim and it is not available: coaches are not live on Stripe
 * Connect, and most members train under a gym membership that never produces a
 * per-client charge at all. Promising money and reporting workouts would be
 * worse than promising less.
 */
exports.CONVERSION_RULE = 'A referral counts once the friend you invited logs their first workout. '
    + 'Signing up on its own does not count.';
/**
 * The thing this screen must not do, written down so it is not undone.
 *
 * No discount, no free session, no credit balance, no points. Repple is
 * white-label: what a referral is worth is a commercial decision belonging to
 * each gym and each coach, in their own currency and against their own margins.
 * A screen that promised "a free session" would be committing somebody else's
 * business to a cost they never agreed, to a member who would hold them to it.
 */
/**
 * `brand` rather than the literal "Repple", and this is the Invite Friends
 * screen — the one built for showing to other people. A chain's member holding
 * their phone out to a friend was showing their gym's supplier's name.
 *
 * A function rather than a constant for that reason alone; the sentence is
 * otherwise unchanged, and the rule it states is unchanged too.
 */
function rewardNote(brand) {
    return `${brand} records who you brought in and whether they started training. What `
        + 'that is worth is up to your gym or coach — nothing here is a discount or '
        + 'a credit, and no reward has been promised on their behalf.';
}
/** What the referrer sees about a friend, and what the friend sees about them.
 *  Held against my_referrals()'s select list by the test beside this file. */
exports.REFERRAL_PRIVACY_NOTE = 'You see a friend’s first name and whether they have started training — '
    + 'nothing else about them. They are never shown anything about your training.';
/**
 * Raw rows → rows worth rendering, most brought in first.
 *
 * A row with no referrer id is dropped: it names nobody, so a coach cannot
 * thank them and cannot check it. A row whose counts are not finite numbers is
 * dropped for the harder reason — a count that is not a count must not become a
 * zero on the way through, and there is no honest row to draw without one.
 *
 * `converted` is clamped to `joined` rather than trusted. The server computes
 * both over the same set and cannot exceed it; the clamp is here so that a
 * future caller of this shape cannot render "3 of 2 started training", which is
 * the sort of line that makes a reader stop believing the other figure too.
 */
function shapeCoachReferrers(rows) {
    const out = [];
    for (const r of rows || []) {
        const id = (r?.referrer_id || '').trim();
        if (!id)
            continue;
        const joined = Number(r.joined);
        const converted = Number(r.converted);
        if (!Number.isFinite(joined) || !Number.isFinite(converted))
            continue;
        if (joined <= 0)
            continue;
        out.push({
            id,
            name: (r.referrer_name || '').trim() || 'A client',
            joined: Math.trunc(joined),
            converted: Math.max(0, Math.min(Math.trunc(joined), Math.trunc(converted))),
        });
    }
    return out.sort((a, b) => b.joined - a.joined || b.converted - a.converted || a.name.localeCompare(b.name));
}
/**
 * The line under one client's name on the coach's screen.
 *
 * Two counts, always both, in the order they happen. "4 joined" on its own
 * would let a coach thank somebody for four people who never came back, and
 * "1 started training" on its own hides the three who tried. Neither number is
 * a score and neither is money.
 */
function referrerLine(r) {
    const j = `${(0, format_1.num)(r.joined)} ${r.joined === 1 ? 'person' : 'people'} joined with their code`;
    if (r.converted <= 0)
        return `${j} · none training yet`;
    const c = r.converted === 1 ? '1 has started training' : `${(0, format_1.num)(r.converted)} have started training`;
    return `${j} · ${c}`;
}
/**
 * The counts across everyone, or an honest refusal to state them.
 *
 * `rows` is null for a read that did not land. Under anything but 'ready' this
 * states no figure, and it never says nobody — the sentence a coach acts on by
 * giving up on the one channel that costs them nothing.
 *
 * Computed over the rows because `coach_referrals()` returns one row per
 * referring client rather than a page of referrals, and a coach with more than
 * two hundred referring clients is not a case this product has. The caller
 * still passes 'partial' if the read came back at its cap, and this refuses to
 * total under it — src/lib/rowCap.ts.
 */
function coachSummaryLine(status, rows) {
    if (status === 'loading')
        return 'Checking who has been bringing people in…';
    if (status === 'error')
        return 'We couldn’t check who has been bringing people in.';
    if (status === 'partial')
        return 'Not all of your clients could be read, so these are not totals.';
    if (rows == null)
        return 'We couldn’t check who has been bringing people in.';
    if (rows.length === 0) {
        return 'None of your clients has brought anybody in with their code yet.';
    }
    const joined = rows.reduce((a, r) => a + r.joined, 0);
    const converted = rows.reduce((a, r) => a + r.converted, 0);
    const who = `${(0, format_1.num)(rows.length)} of your clients`;
    const j = `${(0, format_1.num)(joined)} ${joined === 1 ? 'person' : 'people'}`;
    const c = converted <= 0
        ? 'none of whom are training yet'
        : `${(0, format_1.num)(converted)} of whom ${converted === 1 ? 'has' : 'have'} started training`;
    return `${who} brought in ${j} · ${c}`;
}
/**
 * What the coach may and may not do with this, said on the screen.
 *
 * The same rule as `rewardNote`, aimed at the other party. A coach reading a
 * list of people who have grown their business will reach for a thank-you, and
 * that is the point of the screen — but the app must not be the thing that
 * decides what the thank-you is, because it does not know what the coach
 * charges, in what currency, or against what margin.
 */
exports.COACH_REWARD_NOTE = 'Nothing has been credited to anybody. There is no discount, no free session and no balance '
    + 'here — what a referral is worth is yours to decide, in your own money, and this app has '
    + 'never been told what that is.';
/** What a coach sees about the people their client brought in, which is nothing.
 *  Held against coach_referrals()'s select list by the test beside this file. */
exports.COACH_REFERRAL_PRIVACY_NOTE = 'You see which of your own clients brought people in and how many. You are not shown who those '
    + 'people are — they used your client’s code, not yours, and most of them never agreed to be '
    + 'listed to you.';
