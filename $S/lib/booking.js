"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SLOT_WARN_DAYS = exports.DEFAULT_NOTICE_HOURS = exports.CANCEL_WINDOW_HOURS = void 0;
exports.hoursUntil = hoursUntil;
exports.isLateCancellation = isLateCancellation;
exports.cancelSession = cancelSession;
exports.nextFromWaitlist = nextFromWaitlist;
exports.noticeHoursOf = noticeHoursOf;
exports.insideNoticeWindow = insideNoticeWindow;
exports.lateCancelFee = lateCancelFee;
exports.feeAmountLine = feeAmountLine;
exports.unstatedCurrency = unstatedCurrency;
exports.unstatedCurrencyCoach = unstatedCurrencyCoach;
exports.noticeLabel = noticeLabel;
exports.cancelWarningLine = cancelWarningLine;
exports.feeRecordedLine = feeRecordedLine;
exports.waitlistOrder = waitlistOrder;
exports.nextWaitlistClaim = nextWaitlistClaim;
exports.waitlistPosition = waitlistPosition;
exports.ordinal = ordinal;
exports.waitlistLine = waitlistLine;
exports.overlaps = overlaps;
exports.openSlotWindow = openSlotWindow;
exports.slotWindowLine = slotWindowLine;
exports.classClashes = classClashes;
exports.classCheckCaveat = classCheckCaveat;
// `wholeMoney`, not `money` from gymRecord.ts. See the note on `feeAmountLine`:
// a coach's fee is typed in whole units, gymRecord's formatter takes minor
// units, and the `* 100` that bridged them was a hundred-times error waiting
// for the first gym that charges in yen.
const coachMoney_1 = require("./coachMoney");
exports.CANCEL_WINDOW_HOURS = 24;
function hoursUntil(startsAt, now = Date.now()) {
    return (Date.parse(startsAt) - now) / 3600000;
}
/** True when cancelling now incurs the late fee (inside the window, still future). */
function isLateCancellation(startsAt, now = Date.now()) {
    const h = hoursUntil(startsAt, now);
    return h > 0 && h < exports.CANCEL_WINDOW_HOURS;
}
/**
 * Compute the effect of a client cancelling `session`.
 * Returns whether to charge, the fee, and who to notify.
 * `trainerClientIds` is every client of the trainer (the canceller is excluded
 * from the re-offer list automatically).
 */
function cancelSession(session, sessionFee, trainerClientIds, now = Date.now()) {
    const late = isLateCancellation(session.startsAt, now);
    const others = trainerClientIds.filter((id) => id !== session.clientId);
    return {
        charged: late,
        feeAmount: late ? sessionFee : 0,
        notifyClientIds: others,
        notifyTrainer: true,
    };
}
/** First waitlisted client (FIFO) to auto-assign an opened slot, or null. */
function nextFromWaitlist(waitlist) {
    return waitlist.length ? waitlist[0] : null;
}
/**
 * The notice period to hold a cancellation to when the policy could not be read.
 *
 * 24 is not a guess: it is what both client screens have warned about since
 * before any of this was configurable, so a coach who has set nothing, and a
 * member whose policy read failed, get the deal the app has always described.
 */
exports.DEFAULT_NOTICE_HOURS = exports.CANCEL_WINDOW_HOURS;
/** The notice period in force, including for a policy that could not be read. */
function noticeHoursOf(policy) {
    const h = policy?.noticeHours;
    return typeof h === 'number' && Number.isFinite(h) && h > 0 ? h : exports.DEFAULT_NOTICE_HOURS;
}
/**
 * Whether cancelling at `now` is inside the notice window.
 *
 * Deliberately NOT `isLateCancellation`, and the difference is the whole reason
 * both exist. This is `starts_at - now < notice`, with no lower bound, so a
 * session that has ALREADY STARTED is inside the window — which is what a coach
 * standing in an empty gym would say, and what both client screens have always
 * done. `isLateCancellation` requires the session to still be in the future, so
 * under it somebody cancelling a session already in progress comes back "not
 * late", pays nothing and is handed their pack credit back.
 *
 * `supabase/parts/126-*.sql` computes the same expression in SQL, because the
 * fee that gets RECORDED must be decided by the same rule as the fee the member
 * was warned about.
 */
function insideNoticeWindow(startsAt, noticeHours = exports.DEFAULT_NOTICE_HOURS, now = Date.now()) {
    const start = Date.parse(startsAt);
    // An unparseable date is not evidence of anything. Refusing to call it late
    // is the side that does not charge somebody on the strength of a bad string.
    if (!Number.isFinite(start))
        return false;
    return start - now < noticeHours * 3600000;
}
function lateCancelFee(policy, inside) {
    if (!inside)
        return { kind: 'in-time' };
    if (!policy)
        return { kind: 'unknown' };
    if (!policy.applies)
        return { kind: 'no-policy' };
    const fee = policy.fee;
    if (fee == null || !Number.isFinite(fee) || fee <= 0)
        return { kind: 'unpriced' };
    return { kind: 'fee', amount: fee, currency: policy.currency ?? null };
}
/**
 * A fee as money, or a bare number when the gym has not said what it charges in.
 *
 * Never AED-by-default. `money()` defaults its currency because the gym
 * operating record is denominated in dirhams and always has been; a coach's
 * late fee is not that record, and a London member reading "AED 25" is looking
 * at a different number, not a formatting slip. Where the currency is unknown
 * the figure is printed alone — it is the coach's own, and they know what it is
 * in — and the caller's sentence says so.
 *
 * That last clause was not true of a single caller. Both sentences below, and
 * the standing-appointment one in src/lib/recurring.ts, interpolated this
 * straight into prose: "your coach's late-cancellation fee of 25 applies". A
 * bare 25 in a sentence is read in whatever money the reader is thinking in,
 * which is the exact failure `money()` withholds an amount to avoid — the
 * figure looks stated, so nobody goes and sets the currency. `unstatedCurrency`
 * below is the missing half, and every prose site now appends it.
 *
 * ── WHY IT NO LONGER GOES THROUGH gymRecord's money() ─────────────────────
 *
 * `fee` is a whole-unit figure a coach typed: 25 means twenty-five of whatever
 * they charge in. `money()` takes MINOR units, so this used to convert with
 * `Math.round(amount * 100)` and let `money()` divide it straight back. That
 * round trip cancels out in a currency with hundredths and is a hundred-times
 * error in one without: a ¥5,000 late fee became 500,000 minor units, and a
 * formatter that knew about zero-decimal currencies would print "JPY 500,000"
 * for a fee of five thousand yen. Even the formatter that does not know printed
 * "JPY 5,000.00", inventing a subdivision the yen has never had.
 *
 * `wholeMoney` in src/lib/coachMoney.ts is the function for exactly this — a
 * whole-unit amount somebody typed, rendered in the currency they typed it in,
 * with the decimal places that currency actually has. No multiply, no divide,
 * and nothing here has to know which currencies are which.
 */
function feeAmountLine(amount, currency) {
    if (!currency)
        return String(amount);
    return (0, coachMoney_1.wholeMoney)(amount, currency) ?? String(amount);
}
/**
 * The clause that has to follow a fee whose currency nobody set.
 *
 * Empty for a stated currency, so it can be appended blindly. It is a separate
 * export rather than folded into `feeAmountLine` because that function also
 * fills value SLOTS — the Amount cell on the two calendars — where a dash and a
 * column heading already carry the doubt and a sentence would not fit. A slot
 * may print the figure alone; a sentence may not.
 */
function unstatedCurrency(currency) {
    return currency ? '' : ' Your coach hasn’t set a currency, so ask them what that amount is in.';
}
/**
 * The same clause, said to the COACH.
 *
 * `unstatedCurrency` above addresses the client and tells them to ask their
 * coach, which is exactly the wrong instruction on the coach's own screen. The
 * three waive and reinstate confirmations in app/(trainer)/calendar.tsx printed
 * the bare figure with no clause at all — so a coach confirmed forgiving "25"
 * with nothing on the screen saying 25 of what, on the one list in the app that
 * says what their clients owe them. It is also the screen a coach with no
 * currency set is most likely to be on, because that is the state in which the
 * figure comes through bare.
 */
function unstatedCurrencyCoach(currency) {
    return currency ? '' : ' You have not set a currency, so that figure has no unit on it — set one in Settings and it will be priced everywhere.';
}
/** How the notice period reads in a sentence: "24 hours", "1 hour", "48 hours". */
function noticeLabel(hours) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
}
/**
 * What the member is told BEFORE they confirm, and it has to be true of what
 * happens after. Repple records the fee and does not take it; every branch that
 * mentions money says so, because a member who thinks the app has charged them
 * will not pay their coach.
 */
function cancelWarningLine(v, noticeHours) {
    const w = noticeLabel(noticeHours);
    switch (v.kind) {
        case 'in-time':
            return `This is more than ${w} away, so your coach's late-cancellation policy doesn't apply.`;
        case 'no-policy':
            return `This is inside ${w}, but your coach doesn't charge for a late cancellation.`;
        case 'unknown':
            return `This is inside ${w}. We couldn't read your coach's cancellation policy, so we can't say whether a fee applies — check with them.`;
        case 'unpriced':
            return `This is inside ${w}, so your coach's late-cancellation policy applies. They haven't set an amount here, so ask them what it is — Repple doesn't charge it.`;
        case 'fee':
            return `This is inside ${w}, so your coach's late-cancellation fee of ${feeAmountLine(v.amount, v.currency)} applies. Repple doesn't take this payment — it's recorded for you and your coach to settle.${unstatedCurrency(v.currency)}`;
    }
}
/**
 * What the member is told AFTERWARDS about a fee that was actually written down.
 * `charged` is the SERVER's answer, not this device's: the row either exists or
 * it does not, and a sentence about a charge is only worth printing when one is
 * really on the record.
 */
function feeRecordedLine(charged, amount, currency) {
    if (!charged)
        return null;
    const sum = amount != null && Number.isFinite(amount) ? feeAmountLine(amount, currency) : null;
    return sum
        ? `A late-cancellation fee of ${sum} has been recorded on your account. Repple doesn't take this payment — settle it with your coach.${unstatedCurrency(currency)}`
        : 'A late-cancellation fee has been recorded on your account. Repple doesn’t take this payment — settle it with your coach.';
}
/** The queue in the order it will actually be served. */
function waitlistOrder(entries) {
    return [...entries].sort((a, b) => {
        const at = Date.parse(a.joinedAt), bt = Date.parse(b.joinedAt);
        if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt)
            return at - bt;
        return a.seq - b.seq;
    });
}
/**
 * Who gets a freed slot. The same rule `_promote_session_waitlist` runs in SQL,
 * stated here so it is testable without a database and so the two cannot drift
 * apart unnoticed.
 *
 * `exclude` is the person who just cancelled: they were holding the slot, so
 * they may not be handed it back off their own waitlist.
 */
function nextWaitlistClaim(entries, exclude = null) {
    const first = waitlistOrder(entries).find((e) => e.clientId !== exclude);
    return first ? first.clientId : null;
}
/** A client's 1-based place in the queue. 0 means they are not on it. */
function waitlistPosition(entries, clientId) {
    const i = waitlistOrder(entries).findIndex((e) => e.clientId === clientId);
    return i < 0 ? 0 : i + 1;
}
/** 1st, 2nd, 3rd, 4th … 11th, 21st. The teens are the ones that catch people. */
function ordinal(n) {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13)
        return `${n}th`;
    switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
    }
}
/**
 * The member's own place, in words.
 *
 * "You're next" is the only claim here that is worth anything, and it is only
 * made for position 1. Everything else says the position and does NOT promise
 * the slot, because a queue of four in front of you is not a booking.
 */
function waitlistLine(position, waiting) {
    if (position <= 0) {
        return waiting > 0
            ? `${waiting} ${waiting === 1 ? 'person is' : 'people are'} waiting for this slot.`
            : 'Nobody is waiting for this slot yet.';
    }
    if (position === 1) {
        return waiting > 1
            ? `You're next in line — if it frees up it's yours, ahead of ${waiting - 1} other${waiting - 1 === 1 ? '' : 's'}.`
            : `You're next in line — if it frees up it's yours.`;
    }
    return `You're ${ordinal(position)} in line of ${waiting}. The slot goes to whoever is in front of you.`;
}
/** Whether a proposed slot overlaps any existing session for the trainer. */
function overlaps(startsAt, durationMin, existing) {
    const s = Date.parse(startsAt);
    const e = s + durationMin * 60000;
    return existing.some((x) => {
        const xs = Date.parse(x.startsAt);
        const xe = xs + x.durationMin * 60000;
        return s < xe && xs < e;
    });
}
/** How few days of bookable diary counts as running out. A week: long enough
 *  that a coach who reads it on Monday has the whole week to act, short enough
 *  that it is not on screen for most of a month and stops being read. */
exports.SLOT_WARN_DAYS = 7;
function openSlotWindow(sessions, opts) {
    const now = opts.now ?? Date.now();
    const warnDays = opts.warnDays ?? exports.SLOT_WARN_DAYS;
    // Order matters. An unread diary is unknown whatever else is true.
    //
    // ── The state this screen used to be silent in ──────────────────────────
    //
    // Until now `!hasWeekly` returned 'idle' and `slotWindowLine` said nothing
    // about it, on the reasoning that a coach who does not take one-to-ones
    // should not be nagged. That reasoning is sound and the outcome was not: a
    // coach who INTENDS to take bookings and has simply never found the step is
    // in exactly the same state, and was told nothing either. Their clients open
    // the booking screen, see an empty week, and are given no reason — which is
    // indistinguishable, from the client's side, from a coach with no free time.
    //
    // The two are separated by whether anybody is waiting. A coach with nobody on
    // their book may genuinely not do this; a coach with clients on their book and
    // no weekly hours has a booking screen that is dead to every one of them, and
    // that is worth one sentence.
    //
    // An unknown client count is NOT treated as zero. It stays 'idle' — silence —
    // because the alternative is telling a coach their book is unbookable on the
    // strength of a number we could not read.
    if (!opts.known)
        return { state: 'unknown', open: 0, lastAt: null, daysLeft: null };
    const future = sessions
        .filter((s) => s.status === 'available')
        .map((s) => Date.parse(s.startsAt))
        .filter((ms) => isFinite(ms) && ms >= now)
        .sort((a, b) => a - b);
    const open = future.length;
    const lastMs = open > 0 ? future[future.length - 1] : null;
    const lastAt = lastMs === null ? null : new Date(lastMs).toISOString();
    const daysLeft = lastMs === null ? null : Math.floor((lastMs - now) / 86400000);
    if (!opts.hasWeekly) {
        const waiting = opts.clientsOnBook != null && opts.clientsOnBook > 0;
        return { state: waiting ? 'never-set' : 'idle', open, lastAt, daysLeft };
    }
    if (open === 0)
        return { state: 'empty', open, lastAt, daysLeft };
    return { state: daysLeft <= warnDays ? 'ending' : 'healthy', open, lastAt, daysLeft };
}
/**
 * What to say about that window, or null when there is nothing worth saying.
 *
 * Null for 'unknown' as well as for the two healthy states, and that is the
 * important one: silence is right where a guess would be wrong. The screen
 * already tells the coach their calendar could not be read; a second sentence
 * about a slot count nobody knows would be inventing one.
 */
function slotWindowLine(w, clientsOnBook) {
    if (w.state === 'never-set') {
        // Deliberately says what the CLIENT sees, not what the coach has not done.
        // "You have not set your availability" is a reprimand about a form; "your
        // clients cannot book you" is the consequence, and it is the consequence
        // that makes anybody open the sheet.
        const n = clientsOnBook ?? 0;
        const who = n === 1 ? 'Your client cannot book you' : `Your ${n} clients cannot book you`;
        return `${who}. You have no weekly hours set, so there is nothing for them to take — `
            + 'their booking screen is empty and nothing on it says why. '
            + 'Set the times you offer, then open the next four weeks.';
    }
    if (w.state === 'empty') {
        return 'You have weekly availability set and no open slots left, so nobody can book you. Clients see an empty booking screen and nothing tells them why.';
    }
    if (w.state === 'ending') {
        const d = w.daysLeft ?? 0;
        const when = d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`;
        return `Your last open slot is ${when}. After that clients see nothing available, and nothing on their screen says why.`;
    }
    return null;
}
/**
 * Which classes stand in the way of a proposed one-to-one.
 *
 * A CANCELLED class is not in the way. The room never opened, nobody is
 * teaching it, and treating it as an obstacle would leave the coach unable to
 * use an hour the gym gave back to them.
 */
function classClashes(startsAt, durationMin, classes, uid) {
    const live = classes.filter((c) => c.status !== 'cancelled');
    const hit = live.filter((c) => overlaps(startsAt, durationMin, [c]));
    return {
        mine: uid ? hit.filter((c) => c.trainerId === uid) : [],
        // Not "everything that is not mine". A colleague's class is their business
        // and their room; it is the ones NOBODY is recorded against that this
        // cannot rule in or out.
        unattributed: hit.filter((c) => !c.trainerId),
    };
}
/**
 * What to say when the class timetable could not be consulted, or when it could
 * and something unattributed was in the way. Null when there is nothing to add.
 *
 * Never claims the hour is clear. That is the whole job: `known` false means the
 * check did not happen, and a screen that said nothing would be reporting a
 * clean diary it never read.
 */
function classCheckCaveat(known, unattributed) {
    if (!known) {
        return 'Your class timetable could not be read, so this was not checked against the classes you teach.';
    }
    if (unattributed > 0) {
        return `${unattributed} class${unattributed === 1 ? '' : 'es'} at that time ${unattributed === 1 ? 'has' : 'have'} no coach recorded against ${unattributed === 1 ? 'it' : 'them'}, so ${unattributed === 1 ? 'it' : 'they'} could not be ruled in or out.`;
    }
    return null;
}
