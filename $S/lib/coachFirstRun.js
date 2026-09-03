"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_YOUR_SETUP = exports.COACH_SETUP = void 0;
exports.stepApplies = stepApplies;
exports.coachSetupRows = coachSetupRows;
exports.coachSetupDone = coachSetupDone;
exports.coachSetupLeft = coachSetupLeft;
exports.coachSetupNa = coachSetupNa;
exports.coachSetupUnknown = coachSetupUnknown;
exports.coachSetupNext = coachSetupNext;
exports.showCoachSetup = showCoachSetup;
exports.coachSetupHeading = coachSetupHeading;
exports.coachSetupCardLine = coachSetupCardLine;
exports.coachSetupNote = coachSetupNote;
/**
 * In the order they are worth doing, which is not the order they are easiest.
 *
 * Currency is first and is not negotiable: it is the one setting whose absence
 * blanks six other screens, and a coach who does it last spends their first
 * fortnight believing the app cannot count. Rate second because it is a number
 * they already know and it is the input to every session figure. A client
 * third, because everything after it has somebody to be for.
 *
 * Stripe sits AFTER creating a package deliberately. A coach sent through an
 * identity check before they have decided what they sell has been asked to do
 * the hardest thing on the list for no visible return; with a package already
 * written, connecting is the step that makes it purchasable.
 */
exports.COACH_SETUP = [
    {
        // Asked FIRST, and before the currency, because it is the only item on the
        // list that changes what the rest of the list is. An online coach who
        // answers here never sees "Set When You Work" as an outstanding task, and
        // an in-person coach's app is unchanged by answering. Everything is shown
        // until it is answered, so skipping costs nothing.
        id: 'mode',
        title: 'Say How You Coach',
        note: 'in person, online, or both',
        breaks: 'the app cannot set itself up around your coaching, so you are shown every in-person tool whether you use one or not',
        route: '/(trainer)/profile',
    },
    {
        id: 'currency',
        title: 'Set Your Currency',
        note: 'the code every price and total in the app is printed in',
        // Measured: 35 of 54 live tenants have `tenants.currency` NULL. Part 150
        // states there is no default currency anywhere and that is right — Repple
        // is white-labelled and a guess here is a guess about somebody's money.
        breaks: 'every money figure in the app is withheld and shown as a dash, on six separate screens',
        route: '/(trainer)/settings',
    },
    {
        id: 'rate',
        title: 'Set Your Session Rate',
        note: 'what one hour with you costs',
        breaks: 'sessions are recorded with no value on them, so nothing you deliver adds up to a figure',
        route: '/(trainer)/profile',
    },
    {
        id: 'client',
        title: 'Add Your First Client',
        note: 'invite somebody, or write them down by hand',
        breaks: 'every screen in the app is empty, and an empty screen looks the same as a broken one',
        // Opens the Invite sheet rather than merely the Clients tab. It carries
        // the coach's own code, a link to send, and an email invitation; the "Add
        // Client" button that writes somebody down by hand is directly behind it.
        route: '/(trainer)/dashboard?start=invite',
    },
    {
        id: 'availability',
        title: 'Set When You Work',
        note: 'the hours clients may book, week by week',
        breaks: 'nobody can book you, because there is nothing on offer for them to take',
        route: '/(trainer)/calendar',
    },
    {
        id: 'package',
        title: 'Create Something To Sell',
        note: 'a session pack or a monthly package, at your price',
        breaks: 'there is nothing for a client to buy, so no payment can ever start',
        route: '/(trainer)/payments',
    },
    {
        id: 'stripe',
        title: 'Connect Stripe',
        note: 'so a client can pay you from inside the app',
        // The honest framing: Repple never holds the money. The coach's Stripe
        // account does, and until it exists a package is a price list.
        breaks: 'a client can see what you sell and cannot pay for it — the money has nowhere to land',
        route: '/(trainer)/payments',
    },
    {
        id: 'code',
        title: 'Name a Join Code',
        note: 'one code per flyer, post or referral card',
        breaks: 'every client arrives from an unnamed source, so nothing can tell you which of your channels works',
        // "Codes You Have Named" is a section of the same sheet, and the only
        // place in the app a named code can be made.
        route: '/(trainer)/dashboard?start=invite',
    },
    {
        id: 'document',
        title: 'Upload Your Paperwork',
        note: 'your waiver, your par-q, your house rules',
        breaks: 'a client starts training with you having signed nothing of yours',
        route: '/(trainer)/documents',
    },
];
const stateOf = (v) => (v == null ? 'unknown' : v ? 'done' : 'todo');
/**
 * Whether a step applies to a coach who works this way.
 *
 * `shape` is `DeliveryShape` from src/lib/coachDelivery.ts, and null means we
 * do not know — which resolves the same way everything else about this fact
 * resolves, to the WIDEST answer: every step applies. A coach whose roster read
 * failed, or who has not answered, gets the whole list.
 *
 * All nine, decided one at a time rather than by rule, because "it sounds
 * in-person" is not an argument:
 *
 *   mode          applies. It is the question itself.
 *   currency      applies. It blanks six screens either way, and a remote
 *                 coach's takings need it more than anybody's.
 *   rate          applies. It is not only what prices a delivered session: it
 *                 is on the coach's directory listing and their public page,
 *                 and it is the base a late-cancellation fee is set against.
 *                 A remote coach selling a package still quotes an hour.
 *   client        applies. Everything else on the list has somebody to be for.
 *   availability  DOES NOT APPLY to a remote coach. The whole argument is
 *                 above. This is the only one.
 *   package       applies, and matters MORE remotely: a package is how a
 *                 remote coach is paid at all.
 *   stripe        applies, and for the same reason.
 *   code          applies. Attribution is about where clients came from, which
 *                 has nothing to do with where they train.
 *   document      applies. A waiver and a par-q are not a room.
 */
function stepApplies(id, shape) {
    if (shape !== 'remote')
        return true;
    return id !== 'availability';
}
/** Why a row is greyed rather than ticked. Sentence case: it is prose on a
 *  row, and it says what to do to make the row come back. */
exports.NOT_YOUR_SETUP = {
    availability: 'You coach online, so there are no slots for anybody to book and this is not counted against you. It comes back the moment you take on a client in person.',
};
/**
 * The rows, each with where it stands.
 *
 * `shape` defaults to null, which means every step applies. Callers that have
 * not worked out how the coach coaches therefore get exactly the list this
 * function has always returned, and no caller can narrow the list by
 * forgetting to pass something.
 */
function coachSetupRows(f, shape = null) {
    return exports.COACH_SETUP.map((it) => ({
        item: it,
        state: stepApplies(it.id, shape) ? stateOf(f[it.id]) : 'na',
    }));
}
/** How many are done. Never counts an unread one. */
function coachSetupDone(rows) {
    return rows.filter((r) => r.state === 'done').length;
}
/** How many are KNOWN to be outstanding. Never counts an unread one either —
 *  "3 left" over a failed read is a number made out of our own failure — and
 *  never counts one that does not apply, which would be a task this coach
 *  cannot complete held permanently against them. */
function coachSetupLeft(rows) {
    return rows.filter((r) => r.state === 'todo').length;
}
/** How many do not apply to this coach. Out of the denominator, and named so a
 *  screen can say WHY a row is greyed rather than leaving it to be guessed. */
function coachSetupNa(rows) {
    return rows.filter((r) => r.state === 'na').length;
}
/** How many could not be established. `done + left + unknown + na` is the list. */
function coachSetupUnknown(rows) {
    return rows.filter((r) => r.state === 'unknown').length;
}
/** The next thing worth doing, or null when there is nothing KNOWN to do.
 *  Order is the array's order, which is the order argued for above. */
function coachSetupNext(rows) {
    return rows.find((r) => r.state === 'todo')?.item ?? null;
}
/**
 * Whether the dashboard still carries the row.
 *
 * True while anything is outstanding AND true while anything is merely UNKNOWN.
 * That second clause is the LoadStatus rule applied to a checklist: a list that
 * takes itself off the screen because three of its reads failed has hidden the
 * currency step from the coach whose currency is not set — which is the exact
 * coach it exists for.
 */
function showCoachSetup(rows) {
    return rows.some((r) => r.state !== 'done' && r.state !== 'na');
}
/**
 * The heading, which has to be true in all three states.
 *
 * "4 of 8 done" states a denominator, and a denominator over a partly-unread
 * list is a claim about the four we could not see. So the fraction is printed
 * only when everything answered; otherwise the count stands alone.
 */
function coachSetupHeading(rows) {
    const done = coachSetupDone(rows);
    // The denominator is the steps that apply to THIS coach. Counting a step
    // that cannot be completed into the total means the fraction never reaches
    // the end, which is the arithmetic equivalent of nagging.
    const applicable = rows.length - coachSetupNa(rows);
    return coachSetupUnknown(rows) > 0 ? `${done} done` : `${done} of ${applicable} done`;
}
/**
 * The one line on the Clients-tab card, above the "Next: …" sentence.
 *
 * ── The number that was quietly made of two things ────────────────────────
 *
 * The card printed `Setting up · ${coachSetupLeft(rows)} left`, and
 * `coachSetupLeft` counts only rows KNOWN to be outstanding — which is right,
 * and is the rule that stops a failed read becoming a nag. But it means the
 * figure UNDERSTATES whenever anything is unread, and the card said nothing
 * about that: a coach whose Stripe and paperwork reads were refused was told
 * "3 left" for a list with five rows they had not done.
 *
 * `coachSetupHeading` already refuses to print a denominator over a partly
 * unread list, for exactly this reason — the card was the one surface that
 * had not learnt it. Two counts, never folded: "5 left" and "5 left, 2 not
 * checked" are different statements about somebody's setup, and the second is
 * the one that survives the coach going to look.
 *
 * Called only where `showCoachSetup` is true, so at least one of the two is
 * non-zero; the both-zero case returns the bare kicker rather than throwing,
 * because a card that renders "Setting up · 0 left" is a smaller failure than
 * one that crashes the coach's home screen.
 */
function coachSetupCardLine(rows) {
    const left = coachSetupLeft(rows);
    const unknown = coachSetupUnknown(rows);
    if (left === 0 && unknown === 0)
        return 'Setting up';
    if (left === 0) {
        return unknown === 1
            ? 'Setting up · 1 could not be checked'
            : `Setting up · ${unknown} could not be checked`;
    }
    if (unknown === 0)
        return `Setting up · ${left} left`;
    return `Setting up · ${left} left, ${unknown} not checked`;
}
/**
 * The line under the heading.
 *
 * Four outcomes and they are not interchangeable. The one that matters is the
 * third: a coach who has finished everything READABLE but whose Stripe read
 * failed must not be told they are set up, because the next thing they do is
 * stop looking.
 */
function coachSetupNote(rows, status) {
    if (status === 'loading')
        return 'Checking what is already set up…';
    const left = coachSetupLeft(rows);
    const unknown = coachSetupUnknown(rows);
    if (unknown > 0 && left === 0) {
        return 'Everything that could be checked is done. Some of it could not be read just now, so those rows show a dash rather than a tick — that is this screen not knowing, not you not having done it.';
    }
    if (unknown > 0) {
        return 'Work through these in any order. A dash means that row could not be read, so it is not counted either way.';
    }
    if (left === 0)
        return 'That is everything. This screen stays here if you want to look again.';
    return 'Work through these in any order. Each one opens the screen that does it.';
}
