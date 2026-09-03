"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHANNEL_ACCOUNT_WIDE = exports.BOOK_FLOOR = exports.CHANNEL_LOCAL_NOTE = exports.CHANNEL_QUIET_COST = exports.CHANNEL_STILL_RECORDED = exports.CHANNEL_MASTER_NOTE = exports.CHANNEL_UNKNOWN_LABEL = exports.COACH_CHANNELS = exports.CHANNEL_QUIET_COST_BOOK = exports.CHANNEL_QUIET_COST_MONEY = void 0;
exports.channelDef = channelDef;
exports.mutedFromRows = mutedFromRows;
exports.channelState = channelState;
exports.channelAllows = channelAllows;
exports.channelsNote = channelsNote;
exports.bookAlert = bookAlert;
const coachReminders_1 = require("./coachReminders");
/**
 * What muting the money channel costs, shown under that switch alone.
 *
 * Specific rather than reassuring, in the same way `WITHHELD_NOTE` is: the
 * consequence that matters is a client who has silently stopped paying, and a
 * coach needs that in front of them before they choose.
 */
exports.CHANNEL_QUIET_COST_MONEY = 'A failed subscription payment is a client who has quietly stopped paying you. With this off you find out when you next open Payments, which for most coaches is the end of the month.';
/**
 * What muting the coach's own book costs.
 *
 * The unmarked queue is the sharp end of it. Until a session carries an
 * outcome it is counted as neither delivered nor missed, `settlementBlocker` in
 * src/lib/gymSessions.ts refuses to settle a period containing one, and the
 * statement, the payroll figure and the revenue line are all short by exactly
 * those sessions — so this is not a reminder about tidiness, it is the only
 * thing that tells a coach their own money is sitting still.
 */
exports.CHANNEL_QUIET_COST_BOOK = 'The sessions waiting on an outcome are counted as neither delivered nor missed, so your statement and your revenue figure stay short until you mark them — and nothing else in the app will tell you. With this off you find out when you next open Mark What Happened.';
exports.COACH_CHANNELS = [
    {
        key: 'chat', title: 'Client Messages', quietCost: null, local: false,
        note: 'A message from a client. This is the one that arrives at 11pm.',
    },
    {
        key: 'bookings', title: 'Bookings And Cancellations', quietCost: null, local: false,
        note: 'A client booking a session, cancelling one, or a slot re-opening.',
    },
    {
        key: 'money', title: 'Money', quietCost: exports.CHANNEL_QUIET_COST_MONEY, local: false,
        note: 'A package bought, a subscription starting or ending, and a subscription payment failing.',
    },
    {
        // ── the label that named two of six ─────────────────────────────────
        //
        // This read 'Joining And Leaving' / 'Somebody asking to be coached by you,
        // and somebody ending their coaching.' — which was exactly right for the
        // two things part 158 and part 159 send to '/(trainer)/dashboard', and
        // wrong about everything else that had since been pointed at this switch.
        //
        // By the time the server-side dispatch was written (part 900) the key
        // `clients` governed six kinds: a coaching request and a coaching ending
        // (parts 158, 159), an enquiry from somebody with no account yet (part
        // 470), a goal a client reached (part 202), a progress photo a client sent
        // (part 614), and the personal best src/lib/prNotifyStore.ts sends on it.
        // A coach muting Joining And Leaving lost four things the label did not
        // mention, and the last of those is the single most encouraging thing in
        // the product.
        //
        // The KEY is what is right here and the label is what was narrow. The
        // grouping principle is "what would the coach do about it", and the answer
        // for all six is the same: think about that person. A message is a
        // conversation, a booking is a diary entry, a payment is the books — and
        // this is the switch for a client doing something worth knowing about.
        // Splitting the four off into a seventh switch would have been a seventh
        // control on a screen whose whole problem was that one control was too
        // blunt, and it would have left `clients` naming two rare events.
        key: 'clients', title: 'Your Clients', quietCost: null, local: false,
        note: 'Somebody asking to be coached by you, somebody ending their coaching, and what a client does in between — a goal reached, a personal best, a progress photo sent.',
    },
    {
        // 'a credential running out' was added to the note when part 900 gave this
        // switch a sender. Part 202 writes it to '/(trainer)/credentials', which is
        // the same screen the review notification opens, and a route cannot tell
        // the two apart. It does not need to: an insurance certificate with an
        // expiry date on it is paperwork by any reading of this label, and the
        // consequence of muting it — working uninsured without being reminded — is
        // named rather than left to be discovered.
        key: 'admin', title: 'Paperwork', quietCost: null, local: false,
        note: 'An intake coming back, a document accepted, a release signed, a review left, and one of your own credentials running out.',
    },
    {
        // The second channel to carry a quiet cost, and the reason `quietCost`
        // became a sentence rather than a flag. An unmarked session is a statement,
        // a payroll figure and a revenue line all short by exactly that session,
        // and `settlementBlocker` refuses to settle a period containing one — so
        // muting this is muting the only thing that tells a coach their own money
        // is being held up.
        key: 'book', title: 'Your Own Book', quietCost: exports.CHANNEL_QUIET_COST_BOOK, local: true,
        note: 'A session waiting on an outcome, an invoice past its due date, and a client who has stopped training.',
    },
];
/** The definition, or null for a channel this build does not know. */
function channelDef(key) {
    return exports.COACH_CHANNELS.find((c) => c.key === key) ?? null;
}
/**
 * The rows as the table stores them → the muted set.
 *
 * Only an explicit `false` counts as off. A row holding a string, a null or
 * anything else is not an answer about somebody's notifications and reading it
 * as one would silence a channel they never touched. A channel name this build
 * does not recognise is dropped rather than kept, so a newer build's channel
 * cannot mute anything here by accident.
 */
function mutedFromRows(rows) {
    const out = new Set();
    for (const r of rows ?? []) {
        if (r?.enabled !== false)
            continue;
        const def = channelDef(String(r.channel ?? ''));
        if (def)
            out.add(def.key);
    }
    return out;
}
/**
 * What the switch should read.
 *
 * `status` first, and it is not a formality: under 'loading' and 'error' the
 * muted set is empty, and an empty muted set means "everything on". Returning
 * 'on' there would render five switches in the on position over a read that has
 * not happened — the app stating five facts about somebody's settings that it
 * has not looked up, on the screen they went to in order to control them.
 *
 * 'partial' is 'unknown' too. A page of preferences is not a set of them, and
 * the one that did not arrive is the one being misreported.
 */
function channelState(key, muted, status) {
    if (status !== 'ready')
        return 'unknown';
    return muted.has(key) ? 'off' : 'on';
}
/**
 * Whether a push on this channel may be sent, given what is known.
 *
 * The DEVICE never decides this — the server does, where the recipients are
 * resolved — and this function exists for the screen's own preview and for the
 * test. It defaults an unanswered channel to ON, which is the product default
 * and is what the server does too; the two must agree, because a screen showing
 * a switch on while the server suppressed the push would be the master switch's
 * original bug pointing the other way.
 */
function channelAllows(key, muted) {
    return !muted.has(key);
}
/**
 * What to say under the list when the preferences are not known.
 *
 * Null when they are, because a permanent explanatory paragraph under five
 * working switches is furniture.
 */
function channelsNote(status) {
    if (status === 'loading')
        return 'Reading which of these you have turned off…';
    if (status === 'partial')
        return 'Only part of your notification settings came back, so none of these switches is showing a confirmed position. Turning one now would save over whatever is actually stored.';
    if (status === 'error') {
        return 'Your notification settings could not be read, so these switches are not showing your answers — they are showing nothing. That is a read that failed rather than everything being on. Turning one now would save over what is stored, so open this again once you have signal.';
    }
    return null;
}
/** What a switch in the unknown position says instead of on or off. */
exports.CHANNEL_UNKNOWN_LABEL = 'Not read';
/**
 * That the master switch outranks all of these.
 *
 * Said on the screen because the relationship is not guessable: this handset's
 * row leaving `push_tokens` stops everything, whatever these five say, and a
 * coach who has the master switch off and then turns a channel on here would
 * otherwise expect a push that cannot arrive.
 */
exports.CHANNEL_MASTER_NOTE = 'These only matter while Push Notifications above is on. That switch takes this phone off the list entirely, so with it off nothing arrives whatever is set here.';
/**
 * That muting stops the buzz and not the record.
 *
 * The distinction that makes muting safe to offer at all, and the one a coach
 * would otherwise have to discover.
 */
exports.CHANNEL_STILL_RECORDED = 'Muting a category stops your phone buzzing about it. Every one of them is still written into your notifications list, so nothing is lost — you find out when you open the app rather than as it happens.';
/**
 * The money channel's cost, kept under its old name.
 *
 * It was the only one, so the screen imported one constant and printed it under
 * whichever switch carried the flag. A second channel earned a quiet cost of
 * its own and the sentence moved onto the channel — `CoachChannelDef.quietCost`
 * — because one shared warning under two switches would have said the wrong
 * thing under one of them. This stays so the assertions about the WORDING keep
 * naming what they are about.
 */
exports.CHANNEL_QUIET_COST = exports.CHANNEL_QUIET_COST_MONEY;
/**
 * What is different about a LOCAL channel, shown under the switches that are
 * one.
 *
 * Said out loud because the difference is discoverable only by accident and it
 * matters twice. It arrives without a network, so a coach on a plane still gets
 * it. And it is the coach's own phone doing the arithmetic, so it can only be
 * as current as the last time they opened the app — which is exactly the sort
 * of promise this codebase refuses to leave implied.
 */
exports.CHANNEL_LOCAL_NOTE = 'This one is worked out by this phone rather than sent to it, so it arrives with no signal and it is only ever as up to date as the last time you opened the app. Your answer is still saved on your account, so it follows you to a new phone.';
/**
 * How few of something is not worth a banner.
 *
 * One overdue invoice out of forty is a Tuesday; one is also exactly the case a
 * coach with three clients wants to hear about. So the floor is ONE and there
 * is no threshold — the problem with this channel was never that it said too
 * much, it was that it did not exist.
 *
 * Unmarked sessions are the exception and they keep the bar they were already
 * given: `BACKLOG_FLOOR` in src/lib/coachReminders.ts, imported rather than
 * restated, because "below this the queue is a normal week's work" is one
 * decision and two copies of it would drift. A coach told about two unmarked
 * sessions every Monday stops reading the message that will one day say forty.
 */
exports.BOOK_FLOOR = 1;
const n = (x) => (x === 1 ? '' : 's');
/**
 * The one thing worth telling a coach about their own book, or null.
 *
 * ONE banner and not four, and the order is the argument. A phone that fires
 * four notifications in a row about the same business on the same morning is a
 * phone whose notifications get turned off, and turning them off is what took
 * the money channel down with the chat channel in the first place. So the
 * highest-cost item speaks and the rest are counted after it.
 *
 * The order is by what it costs to leave alone:
 *
 *   1. unmarked sessions — somebody's pay is held up. `settlementBlocker` in
 *      src/lib/gymSessions.ts refuses to settle a period containing one, and
 *      the statement, the payroll figure and the revenue line are all short by
 *      exactly those sessions until the coach clears them.
 *   2. overdue invoices — money already earned and not collected, ageing.
 *   3. packs running out — a client about to arrive with nothing left to draw
 *      on, which is a conversation to have BEFORE they turn up.
 *   4. drifting clients — the slowest of the four, and the one the Quiet
 *      Clients screen already exists for.
 *
 * Null when every figure is nought or unknown. Never a cheerful all-clear: an
 * empty book is not news, and a notification saying nothing is wrong is
 * indistinguishable from one composed out of four failed reads.
 */
function bookAlert(s) {
    const at = (v, floor = exports.BOOK_FLOOR) => (v != null && Number.isFinite(v) && v >= floor ? Math.floor(v) : 0);
    const unmarked = at(s.unmarkedSessions, coachReminders_1.BACKLOG_FLOOR);
    const overdue = at(s.invoicesOverdue);
    const packs = at(s.packsRunningOut);
    const drifting = at(s.clientsDrifting);
    /** The others, as a trailing clause, or ''. Counted rather than listed: the
     *  banner has one line and the screen behind it has the detail. */
    const rest = (parts) => parts.length ? ` Also waiting: ${parts.join(', ')}.` : '';
    if (unmarked) {
        return {
            title: `${unmarked} session${n(unmarked)} waiting on an outcome`,
            route: '/(trainer)/sessions',
            // `backlogBody` and not a sentence written here. That wording — the
            // CONSEQUENCE rather than the chore, "counted nowhere until you mark
            // them" — is already argued at length in src/lib/coachReminders.ts and
            // was the whole of this channel before it had a name. Two wordings for
            // one fact is how the banner and the screen come to disagree.
            body: (0, coachReminders_1.backlogBody)(unmarked)
                + rest([
                    overdue ? `${overdue} overdue invoice${n(overdue)}` : '',
                    packs ? `${packs} pack${n(packs)} running out` : '',
                    drifting ? `${drifting} client${n(drifting)} gone quiet` : '',
                ].filter(Boolean)),
        };
    }
    if (overdue) {
        return {
            title: `${overdue} invoice${n(overdue)} past ${overdue === 1 ? 'its' : 'their'} due date`,
            // The coach's own book, aged. Not Mark Sessions, which is where every one
            // of these used to land.
            route: '/(trainer)/invoices',
            body: 'Money you have already earned and not been paid.'
                + rest([
                    packs ? `${packs} pack${n(packs)} running out` : '',
                    drifting ? `${drifting} client${n(drifting)} gone quiet` : '',
                ].filter(Boolean)),
        };
    }
    if (packs) {
        return {
            title: `${packs} pack${n(packs)} about to run out`,
            // Where the server's own 'A session pack is nearly used up' already sends
            // a coach — src/lib/notifyInbox.ts. Two notices about one fact must not
            // land on two screens.
            route: '/(trainer)/payments',
            body: `Worth a word before ${packs === 1 ? 'they turn' : 'anybody turns'} up with nothing left to draw on.`
                + rest([drifting ? `${drifting} client${n(drifting)} gone quiet` : ''].filter(Boolean)),
        };
    }
    if (drifting) {
        return {
            title: `${drifting} client${n(drifting)} ${drifting === 1 ? 'has' : 'have'} gone quiet`,
            body: 'Nothing on their record for a while. Quiet Clients has who, and a draft you send yourself.',
            // The screen the body names. It said "Quiet Clients has who" and then
            // opened Mark Sessions.
            route: '/(trainer)/nudges',
        };
    }
    return null;
}
/** Applies to every device on the account, and says so — the master switch is
 *  per handset and this is not, which is exactly the sort of difference that
 *  gets discovered by accident. */
exports.CHANNEL_ACCOUNT_WIDE = 'This is set on your account rather than on this phone, so it applies wherever you are signed in. The Push Notifications switch above is the opposite: it is about this handset alone.';
