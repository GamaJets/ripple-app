"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.homeMoney = homeMoney;
exports.homeMoneyDrawn = homeMoneyDrawn;
exports.homeMoneyTitle = homeMoneyTitle;
exports.homeMoneyNote = homeMoneyNote;
// What the coach's first screen of the day may say about the money they are
// owed — which, until now, was nothing at all.
//
// ── The gap this closes ────────────────────────────────────────────────────
//
// app/(trainer)/dashboard.tsx already reads the whole book. `fetchMyInvoices`
// selects twenty-two columns, `ageingBook` (src/lib/coachInvoice.ts) ages every
// row into overdue / upcoming / undated and sums what is outstanding per
// currency, and all of that is recomputed on every render of the tab a coach
// opens first every morning.
//
// One number leaves that memo: `invoiceAgeing.overdue.length`, into `bookState`
// — and `bookState` is not drawn either. It feeds `promptBookAlerts`, a LOCAL
// NOTIFICATION fired at most once a week, which `bookAlert` then ranks BELOW
// unmarked sessions: a coach with three sessions waiting on an outcome never
// gets the invoice line at all. So the whole ageing book is computed, ranked
// behind something else, and thrown away, on a screen that has no route to
// /(trainer)/invoices anywhere in it.
//
// The question "who owes me money" is described in src/lib/coachInvoice.ts as
// "the most common unanswered question in this app". The answer is in memory on
// the home screen and is not on it.
//
// ── The figure has to match the sentence ──────────────────────────────────
//
// `AgeingBook.outstanding` sums OVERDUE AND UPCOMING together — every live
// requested invoice with a date on it — which is the right total for the
// Invoices screen and the wrong one here. A card reading "3 past their due date
// · £2,400" would put a figure that includes next month's invoices next to a
// count that does not, and the coach would read the £2,400 as the late money.
// So this sums the overdue rows and nothing else, and the count and the amount
// are about the same invoices.
//
// ── Two kinds of late, and only one of them goes in a demand ─────────────
//
// `AgeingBook.overdue` holds both. `invoiceAge` marks a row `fromChaseDate`
// when the lateness was measured against `chaseFrom` — the coach's OWN working
// note, which appears on nothing the client was ever sent — rather than against
// a due date on the document. src/lib/coachInvoice.ts is explicit that the two
// "must never be summed into one 'overdue' figure without the difference being
// sayable", and app/(trainer)/invoices.tsx already keeps them apart on the
// chase list: "3 past a date you stated" is a separate sentence from what is
// merely outstanding.
//
// So the card counts both — a coach chasing on their own note is still chasing
// — and names the split whenever there is one. A coach who reads "4 past their
// due date" and finds that three of the four were never given a date is a coach
// who has just written a wrong sentence to a client under their own name.
//
// ── What may be stated, and when ──────────────────────────────────────────
//
// The rows themselves are real under every status — they came back — but a
// COUNT or a SUM over a book that arrived short is the confident subtotal
// src/ui/loadStatus.ts exists to refuse, and it is precisely the number a coach
// would act on. So `isWhole` gates both, `withheld` says why, and a failed read
// draws the card SAYING it failed rather than drawing nothing: an absent card
// and "nobody owes you anything" look identical on a dashboard, and
// `UnmarkedSessions` on the same screen already makes that distinction in as
// many words — "This is not the same as none outstanding."
//
// ── Currency, and the two holes in any total ──────────────────────────────
//
// One line per currency, never a sum across them: a coach who invoices in two
// currencies is not owed the arithmetic sum of them, and there is no default
// currency anywhere in this product. `sumTaken` also separates the two ways a
// row can fall out of a total — an amount with no currency on it, and no amount
// at all — and both are counted here and said, because a short total that looks
// whole is worse than no total.
//
// Pure and framework-free: no clock, no network, no React. `today` was already
// applied upstream by `ageingBook`.
const coachMoney_1 = require("./coachMoney");
const loadStatus_1 = require("../ui/loadStatus");
/** What the home screen may say about the book it has already read. */
function homeMoney(book, status) {
    const whole = (0, loadStatus_1.isWhole)(status);
    const rows = book.overdue;
    // Summed here rather than taken from `book.outstanding`, which includes what
    // is not yet due. See the header: the figure has to be about the same
    // invoices as the count beside it.
    const taken = whole
        ? (0, coachMoney_1.sumTaken)(rows.map(({ invoice }) => ({
            amount_cents: invoice.amountCents,
            currency: invoice.currency,
            created_at: invoice.issuedOn,
        })))
        : null;
    const worst = rows[0]?.age.daysOverdue;
    return {
        overdue: whole ? rows.length : null,
        pastStated: whole ? rows.filter((r) => !r.age.fromChaseDate).length : null,
        worstDays: whole && Number.isFinite(worst) ? worst : null,
        pots: taken ? taken.pots : null,
        unlabelled: taken ? taken.unlabelled : 0,
        unpriced: taken ? taken.unpriced : 0,
        undated: whole ? book.undated.length : null,
        hasOverdue: rows.length > 0,
        // `ageingBook` has already written the sentence for every status, in the
        // words the Invoices screen uses. A second wording here is how two screens
        // come to describe one failure differently.
        withheld: book.withheld,
        failed: status === 'error',
    };
}
/**
 * Whether the card is drawn at all.
 *
 * Three things draw it and one of them is a failure:
 *
 *   · something is overdue. The card's whole subject.
 *   · the read FAILED. An absent card and "nobody owes you anything" are the
 *     same pixels, and this is a screen a coach glances at.
 *   · the read came back SHORT and there is something overdue in what arrived.
 *
 * What deliberately does NOT draw it is an undated invoice on its own. It is a
 * hole in the figure rather than an alarm, and a coach who never types due
 * dates would otherwise carry a permanent card about it on their home screen —
 * which is how a card stops being read before the day it matters. It gets a
 * clause on a card that is already drawn, so no figure here reads as complete
 * when it is not.
 *
 * Nothing overdue and a whole read draws nothing at all: a coach who is owed
 * nothing late should not be shown a panel telling them so every morning.
 */
function homeMoneyDrawn(m) {
    if (m.failed)
        return true;
    return m.hasOverdue;
}
/**
 * The heading on the card.
 *
 * Under a failed read it names the failure and not a figure. Under a whole one
 * it counts, and singulars read as singulars — this sits above a number a coach
 * is deciding whether to chase on.
 */
function homeMoneyTitle(m) {
    if (m.failed)
        return 'Could not check what you are owed';
    // No figure over a book that came back short. "Some" rather than a number is
    // the whole discipline of src/ui/loadStatus.ts arriving in a heading: the
    // rows below are real and the count over them is not the coach's book.
    if (m.overdue === null)
        return 'Some invoices are overdue';
    // "Overdue" and not "past their due date": some of these are past a chase
    // date the coach set and the client never saw, and the note below says how
    // many. See the header.
    return m.overdue === 1 ? '1 invoice is overdue' : `${m.overdue} invoices are overdue`;
}
/**
 * The line under it.
 *
 * Says what is missing from the figure above before it says anything else,
 * because a total that quietly leaves rows out is the one mistake on this card
 * that a coach cannot see. "Past a date the client was shown" and not "late" —
 * `ageingBook` counts only invoices past a date that was actually on the
 * document, and the distinction is `fromChaseDate`'s in src/lib/coachInvoice.ts.
 */
function homeMoneyNote(m) {
    if (m.failed) {
        // Borrowed in shape from `UnmarkedSessions` on the same screen, and for the
        // same reason: the dangerous reading of an empty card is that the book is
        // clear.
        return 'This is not the same as nobody owing you anything. Open your invoices to try again.';
    }
    const bits = [];
    // Said first, because it changes what the number above MEANS. A coach who
    // reads the count as "past a date they were given" and writes to somebody on
    // that basis has made a claim about a date nobody ever showed them.
    if (m.overdue != null && m.pastStated != null && m.pastStated < m.overdue) {
        const own = m.overdue - m.pastStated;
        bits.push(m.pastStated === 0
            ? (own === 1
                ? 'It is past a chase date you set for yourself, not a date the client was ever shown.'
                : 'These are past chase dates you set for yourself, not dates the clients were ever shown.')
            : (own === 1
                ? '1 of these is past a chase date you set for yourself rather than a date the client was shown.'
                : `${own} of these are past chase dates you set for yourself rather than dates the clients were shown.`));
    }
    // The lead, and it is always one of these two. How old the worst one is is
    // the fact a coach acts on; where the age cannot be stated — a read that came
    // back short leaves `worstDays` null — the sentence says what the card is
    // about instead, rather than leaving a heading with no line under it.
    bits.push(m.worstDays != null && m.worstDays > 0
        ? (m.worstDays === 1 ? 'The oldest is a day past.' : `The oldest is ${m.worstDays} days past.`)
        : 'Money you have already earned and not been paid.');
    if (m.unlabelled > 0) {
        bits.push(m.unlabelled === 1
            ? 'One has an amount with no currency on it and is in no figure here.'
            : `${m.unlabelled} have amounts with no currency on them and are in no figure here.`);
    }
    if (m.unpriced > 0) {
        bits.push(m.unpriced === 1
            ? 'One has no amount recorded against it at all.'
            : `${m.unpriced} have no amount recorded against them at all.`);
    }
    if (m.undated != null && m.undated > 0) {
        bits.push(m.undated === 1
            ? 'One more you are still asking for has no due date, so it is on no list of what is late.'
            : `${m.undated} more you are still asking for have no due date, so they are on no list of what is late.`);
    }
    if (m.withheld)
        bits.push(m.withheld);
    return bits.join(' ');
}
