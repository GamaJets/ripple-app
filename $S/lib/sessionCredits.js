"use strict";
// What paid for a session — and what is going to pay for the next one.
//
// The reading half of supabase/parts/370. That file decides which entitlement a
// delivered session comes off; this one lets the three apps SAY so, in the same
// order and with the same rule, so a client, a coach and a gym owner cannot be
// shown three different answers about the same hour.
//
// Pure arithmetic and pure wording — no supabase, no react-native — so it runs
// under `npm test`.
//
// ── The two systems, and why the order is decided here ────────────────────
//
// A client may hold both a pack their COACH sold them (`client_purchases`) and
// a pass their GYM sold them (`gym_passes`). Part 370 picks by specificity: the
// entitlement that names both parties to the session wins, so a coach pack
// beats a gym pass, and an EXHAUSTED coach pack still beats a live gym pass
// rather than falling through onto the gym's money.
//
// `chooseRoute` below is that same rule, and it exists as a function rather
// than as an `if` inside a screen because the point of use is exactly where it
// went wrong before: three screens, three guesses, and no way for anybody to
// see which credit had actually been spent.
//
// ── The rule this module will not break ───────────────────────────────────
//
// A balance that was not read is UNKNOWN, and unknown is never 0. `packLeft` in
// coachMoney.ts and `packBalance` in packDraw.ts both already refuse to
// manufacture a zero, and every count here propagates `null` the same way: one
// unreadable input makes the total null, because a client holding ten credits
// must never be shown "0 left", and an empty ledger under a failed read must
// never read as "you have never used a session".
Object.defineProperty(exports, "__esModule", { value: true });
exports.chooseRoute = chooseRoute;
exports.routeReason = routeReason;
exports.creditsLeft = creditsLeft;
exports.payingLines = payingLines;
exports.passLiveOn = passLiveOn;
exports.gymPtLines = gymPtLines;
exports.coachPackLines = coachPackLines;
exports.ledgerStateOf = ledgerStateOf;
exports.buildLedger = buildLedger;
exports.expectedDraws = expectedDraws;
exports.clientLedgerLine = clientLedgerLine;
exports.coachLedgerLine = coachLedgerLine;
exports.shortfallLine = shortfallLine;
exports.bookingCreditNote = bookingCreditNote;
exports.bookableCredits = bookableCredits;
exports.creditsHeroNote = creditsHeroNote;
exports.creditsEmptyLine = creditsEmptyLine;
/* ── which entitlement pays ────────────────────────────────────────────────── */
/**
 * The choice, exactly as the database makes it.
 *
 * Both arguments are three-state on purpose. `true` they hold one, `false` they
 * hold none, `null` we could not read. Anything unread that the answer depends
 * on makes the answer 'unknown' — never 'none', which is a sentence about
 * somebody's money.
 *
 * `holdsCoachPack` is "do they hold a pack from this coach AT ALL", including
 * one with nothing left on it. That is deliberate and it is the load-bearing
 * half: an empty coach pack is still the answer to "who is paying for this
 * hour", and falling through to the gym's pass would move money between two
 * businesses to hide a conversation the coach needs to have.
 */
function chooseRoute(holdsCoachPack, holdsGymPtPass) {
    if (holdsCoachPack == null)
        return 'unknown';
    if (holdsCoachPack)
        return 'coach_pack';
    if (holdsGymPtPass == null)
        return 'unknown';
    return holdsGymPtPass ? 'gym_pass' : 'none';
}
/** Why that route, in one clause a screen can drop into a caption. Null for
 *  'none', which needs no explaining to somebody who holds nothing. */
function routeReason(route) {
    switch (route) {
        case 'coach_pack':
            return 'Sessions with this coach come off the pack you bought from them.';
        case 'gym_pass':
            return 'Sessions come off the PT pass your gym sold you.';
        case 'unknown':
            return 'We could not read what pays for these sessions.';
        default:
            return null;
    }
}
/* ── what is left ──────────────────────────────────────────────────────────── */
/**
 * How many sessions are left on the entitlements that actually pay.
 *
 * `lines` is null for a read that failed, which comes back as null — not 0, and
 * not an empty list. An empty ARRAY is a real answer: they hold nothing.
 */
function creditsLeft(lines) {
    if (lines == null)
        return null;
    let n = 0;
    for (const l of lines)
        n += Math.max(0, l.left);
    return n;
}
/**
 * The lines that pay, given the route. A client holding both is shown only the
 * one that will actually be spent, because a screen listing both invites
 * somebody to add them up and plan a week they have not paid for.
 */
function payingLines(route, coach, gym) {
    if (route === 'coach_pack')
        return coach == null ? null : coach.slice();
    if (route === 'gym_pass')
        return gym == null ? null : gym.slice();
    if (route === 'none')
        return [];
    return null;
}
/**
 * A gym pass is live on a given day, which is not the same as live today.
 *
 * The day matters because a session delivered on Tuesday is paid for by a pass
 * that was valid on Tuesday, and an outcome marked a week late must not turn a
 * covered session into an uncovered one — the same rule part 370 applies in
 * SQL. `onISODate` is a plain YYYY-MM-DD, compared as a string because ISO
 * dates sort correctly as text and parsing them into Date objects is how a
 * timezone gets into a question that has none.
 */
function passLiveOn(expiresOn, onISODate) {
    if (!expiresOn)
        return true;
    return expiresOn >= onISODate;
}
/**
 * The gym passes that can pay for a one-to-one, in the order part 370 spends
 * them: soonest to expire first, then oldest.
 *
 * The ordering is the opposite of the coach-pack rule — that one is oldest
 * first, matching the `order by created_at asc` in `redeem_pack_session` — and
 * the difference is not an inconsistency: a pass has always had a window, so
 * spending the one about to be lost is the only order that does not throw a
 * member's money away.
 *
 * That contrast used to be stated as "a coach pack cannot expire", which part
 * 612 made false: a coach pack can carry an `expires_on` too. What is still
 * true is the ordering, and it is still right, because the database spends
 * coach packs oldest-first whatever this list says and a picker that disagreed
 * with the draw would name a pack the credit did not come off.
 * `coachPackLines` now carries each pack's own date so a screen can SAY what is
 * about to be lost even where it cannot change what is spent first.
 */
function gymPtLines(passes, onISODate) {
    if (passes == null)
        return null;
    const out = [];
    for (const p of passes) {
        if (p.covers !== 'pt')
            continue;
        const total = Number.isFinite(p.usesTotal) ? p.usesTotal : 0;
        const spent = Number.isFinite(p.usesSpent) ? p.usesSpent : 0;
        if (!passLiveOn(p.expiresOn, onISODate))
            continue;
        out.push({
            id: p.id,
            kind: 'gym_pass',
            // The type's own name, or a description of the pass. Never a name this
            // code made up for a thing the gym named something else — the same rule
            // `packLabel` keeps for coach packs.
            label: (p.passTypeName || '').trim() || `${total}-session PT pass`,
            left: Math.max(0, Math.min(total, total - spent)),
            sessions_total: total,
            expiresOn: p.expiresOn,
        });
    }
    out.sort((a, b) => {
        if (a.expiresOn && b.expiresOn && a.expiresOn !== b.expiresOn)
            return a.expiresOn < b.expiresOn ? -1 : 1;
        if (a.expiresOn && !b.expiresOn)
            return -1;
        if (!a.expiresOn && b.expiresOn)
            return 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return out;
}
/**
 * Coach packs as entitlement lines. Takes `PackLine`s from packDraw.ts rather
 * than re-deriving a balance this module has no business computing twice.
 *
 * ── `expiresOn` was a literal null, and part 612 made that false ──────────
 *
 * The comment on `gymPtLines` above says "a coach pack cannot expire and a pass
 * can", and that was true when it was written. Part 612 put a real
 * `expires_on` on a coach pack, `PackLine` has carried it since, and this
 * function threw it away on every line — so a coach pack with three weeks left
 * on it was handed to the picker as a pass that never runs out, sorted BEHIND
 * every dated gym pass, and offered with nothing anywhere saying it was about
 * to be lost. The one order that does not throw a client's money away is
 * soonest-to-expire first, and this fed it a null for every coach pack.
 *
 * A pack whose window has ALREADY closed is not an entitlement at all and is
 * dropped here rather than offered with a date in the past: nothing in the
 * database will let it be drawn — `run_pack_expiry()` has reduced its
 * `sessions_total` — so putting it in a picker is offering somebody something
 * that cannot be spent. `packBalance` counts what is left on those under
 * `onClosedPacks`, which is where that conversation belongs.
 */
function coachPackLines(lines) {
    if (lines == null)
        return null;
    return lines
        .filter((l) => !l.expired)
        .map((l) => ({
        id: l.id,
        kind: 'coach_pack',
        label: l.label,
        left: Math.max(0, l.left),
        sessions_total: l.sessions_total,
        // The pack's own last day, straight off the line. Null is still the
        // answer for a pack with no window, and it still sorts last — but it is
        // now the absence of a window rather than the absence of a field.
        expiresOn: l.expiresOn ?? null,
    }));
}
const isPast = (s, now) => {
    const t = Date.parse(s.startsAt);
    return Number.isFinite(t) ? t <= now : true;
};
/**
 * One session's place in the ledger.
 *
 * `route` is the answer `chooseRoute` gave, and it is what turns "nothing was
 * drawn" into one of three very different sentences: they hold nothing, they
 * hold something and it was empty, or we could not tell.
 */
function ledgerStateOf(s, route, now = Date.now()) {
    if (s.packDrawnAt)
        return 'drawn';
    const past = isPast(s, now);
    if (past) {
        if (s.outcome == null)
            return 'unmarked';
        if (s.outcome !== 'completed') {
            // A no-show or a cancellation that had already spent a credit at booking
            // still spent one, and the client is entitled to see it.
            return s.bookingDrewCreditAt && route === 'coach_pack' ? 'drawn_at_booking' : 'unmarked';
        }
        if (s.shortfallAt)
            return 'shortfall';
        if (s.bookingDrewCreditAt && route === 'coach_pack')
            return 'drawn_at_booking';
        if (route === 'unknown')
            return 'unknown';
        return 'not_covered';
    }
    if (route === 'unknown')
        return 'unknown';
    if (route === 'none')
        return 'expected_none';
    // A one-off the client booked themselves has already paid, out of the coach
    // pack, at booking. Everything else pays at delivery.
    if (route === 'coach_pack' && s.seriesId == null && s.bookingDrewCreditAt)
        return 'reserved';
    return 'expected';
}
/**
 * Split a client's sessions into what a credit has been spent on and what is
 * expected to spend one.
 *
 * `sessions` null is a read that failed, and comes back as null rather than as
 * two empty lists — an empty ledger under a failed read reads as "you have
 * never used a session", which is the wrong sentence to show somebody who has
 * used nine.
 */
function buildLedger(sessions, route, now = Date.now()) {
    if (sessions == null)
        return null;
    const past = [];
    const upcoming = [];
    for (const s of sessions) {
        if (s.status !== 'booked')
            continue;
        const state = ledgerStateOf(s, route, now);
        const row = {
            sessionId: s.id,
            startsAt: s.startsAt,
            state,
            kind: s.packDrawnKind ?? (state === 'drawn_at_booking' ? 'coach_pack' : null),
            drawnAt: s.packDrawnAt ?? (state === 'drawn_at_booking' ? s.bookingDrewCreditAt : null),
            entitlementId: s.packDrawnPurchaseId ?? s.packDrawnPassId ?? null,
        };
        if (isPast(s, now))
            past.push(row);
        else
            upcoming.push(row);
    }
    past.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
    upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    return { past, upcoming };
}
/** How many credits the upcoming bookings are expected to take. Null when any
 *  of it is unknown, because a client planning a month needs the real number or
 *  an honest dash. */
function expectedDraws(ledger) {
    if (ledger == null)
        return null;
    let n = 0;
    for (const r of ledger.upcoming) {
        if (r.state === 'unknown')
            return null;
        if (r.state === 'expected')
            n += 1;
    }
    return n;
}
/* ── wording ───────────────────────────────────────────────────────────────── */
/**
 * The sentence beside one ledger row, from the CLIENT's side.
 *
 * Sentence case, no dash inside a sentence, and no figure that was not read.
 * The two upcoming states are worded as expectations and say so, because part
 * 135's argument holds here: nothing is taken off a pack in advance, and a
 * screen that says a credit is already spent for a session eight weeks away is
 * describing a balance the database does not hold.
 */
function clientLedgerLine(row, entitlementLabel) {
    const off = entitlementLabel ? ` off ${entitlementLabel}` : '';
    switch (row.state) {
        case 'drawn':
            return row.kind === 'gym_pass'
                ? `One PT credit came${off || ' off your gym pass'} when this was marked complete.`
                : `One session came${off || ' off your pack'} when this was marked complete.`;
        case 'drawn_at_booking':
            return `One session came${off || ' off your pack'} when you booked this.`;
        case 'not_covered':
            return 'Nothing came off a pack for this one. You are paying your coach another way.';
        case 'shortfall':
            return 'Nothing was left to cover this session. Speak to your coach about what you owe for it.';
        case 'unmarked':
            return 'Your coach has not said what happened yet, so nothing has been drawn.';
        case 'expected':
            return row.kind === 'gym_pass'
                ? 'One PT credit comes off your gym pass when your coach marks this complete.'
                : 'One session comes off your pack when your coach marks this complete.';
        case 'reserved':
            return 'A session came off your pack when you booked this. Cancelling in time puts it back.';
        case 'expected_none':
            return 'Nothing comes off a pack for this one.';
        default:
            return 'We could not read what pays for this session.';
    }
}
/** The same row from the COACH's or the GYM's side, where the person reading it
 *  is the one who gets paid rather than the one who paid. */
function coachLedgerLine(row) {
    switch (row.state) {
        case 'drawn':
            return row.kind === 'gym_pass' ? 'Covered by a gym PT pass.' : 'Covered by their pack.';
        case 'drawn_at_booking':
            return 'Covered by their pack, drawn when they booked.';
        case 'not_covered':
            return 'Not on a pack. Settled with you directly.';
        case 'shortfall':
            return 'Nothing left to cover this. You delivered it unpaid.';
        case 'unmarked':
            return 'Not marked yet, so nothing has been drawn.';
        case 'expected':
            return row.kind === 'gym_pass' ? 'A gym PT credit comes off when you mark it.' : 'A credit comes off their pack when you mark it.';
        case 'reserved':
            return 'Already drawn. They paid for this when they booked it.';
        case 'expected_none':
            return 'Nothing comes off a pack for this one.';
        default:
            return 'We could not read what pays for this.';
    }
}
/**
 * The one line a coach or an owner has to act on: how many hours were delivered
 * against an entitlement that was empty.
 *
 * Null when there are none, so a screen shows nothing rather than a reassuring
 * zero, and null when the ledger could not be read, because "no shortfalls"
 * and "we could not look" are opposite statements about whether somebody has
 * been paid.
 */
function shortfallLine(ledger) {
    if (ledger == null)
        return null;
    const n = ledger.past.filter((r) => r.state === 'shortfall').length;
    if (n === 0)
        return null;
    return n === 1
        ? 'One delivered session had nothing left to draw from.'
        : `${n} delivered sessions had nothing left to draw from.`;
}
/**
 * What the client is told at the moment of booking, before the tap.
 *
 * Written here rather than in the booking screen so the promise made at the tap
 * and the sentence in the ledger afterwards cannot drift apart — which is
 * exactly how three screens came to describe one credit three ways.
 */
function bookingCreditNote(route, left) {
    switch (route) {
        case 'coach_pack':
            if (left == null)
                return 'We could not read your pack, so we cannot say what this booking will cost you.';
            if (left === 0)
                return 'You have no sessions left on your pack. This booking is not covered by one.';
            return `A session comes off your pack the moment you book. You have ${left} left.`;
        case 'gym_pass':
            if (left == null)
                return 'We could not read your gym pass, so we cannot say what this booking will cost you.';
            if (left === 0)
                return 'You have no PT credits left on your gym pass. This booking is not covered by one.';
            return `One PT credit comes off your gym pass when your coach marks this complete. You have ${left} left.`;
        case 'unknown':
            return 'We could not read what pays for your sessions.';
        default:
            return null;
    }
}
function bookableCredits(packLines, passes, todayISO) {
    const coach = coachPackLines(packLines);
    const gym = gymPtLines(passes, todayISO);
    const route = chooseRoute(coach == null ? null : coach.length > 0, gym == null ? null : gym.length > 0);
    const lines = payingLines(route, coach, gym);
    return { route, lines, left: creditsLeft(lines) };
}
/**
 * The line under the "Sessions Remaining" figure, naming the business whose
 * credit it is.
 *
 * Null when there is no figure for it to sit under — an unread balance or a
 * member who holds nothing — because a note with no number over it is a
 * caption for something that is not there.
 *
 * `expected` is how many booked sessions are still due to draw, from
 * `expectedDraws`. Only the ledger screen reads a diary, so it is optional:
 * `undefined` means nobody asked, which is not the same as `null` (asked, and
 * the diary would not read) and neither may be printed as "nothing booked".
 */
function creditsHeroNote(b, expected) {
    if (b.left == null || b.lines == null || b.lines.length === 0)
        return null;
    const n = b.lines.length;
    const holding = b.route === 'gym_pass'
        ? (n === 1 ? 'On the PT pass your gym sold you' : `Across ${n} PT passes your gym sold you`)
        : (n === 1 ? 'On the pack you bought from your coach' : `Across ${n} packs you bought from your coach`);
    if (expected == null)
        return holding;
    return expected === 0
        ? `${holding} · nothing booked is due to draw one`
        : `${holding} · ${expected} booked session${expected === 1 ? '' : 's'} still to draw`;
}
/**
 * What to say INSTEAD of a figure, and it is four different sentences.
 *
 * This is the function the defect was in. pt-sessions.tsx had two branches
 * where there are four, and it picked between them on `hasPacks` — a fact
 * about `client_purchases` alone — so "you have not bought a session pack" was
 * printed to somebody holding a gym pass and to somebody whose gym-pass read
 * had failed, indiscriminately.
 *
 * Null when there IS a figure, so a caller can render the hero and this and
 * never both.
 */
function creditsEmptyLine(b) {
    if (b.route === 'unknown' || b.left == null) {
        return 'We could not read what pays for your sessions. This is our end, and it is not a statement that you have none — anything you have paid for is still yours.';
    }
    if (b.route === 'none') {
        return 'You are not on a session pack or a gym PT pass. You settle sessions with your coach or your gym directly, which is an ordinary way to pay and not something to fix.';
    }
    if (b.left === 0) {
        return b.route === 'gym_pass'
            ? 'You have no PT credits left on your gym pass. Your next session with your coach is not covered by one — ask your gym about another pass, or arrange it with your coach directly.'
            : 'You have no sessions left on your pack. Your next session with your coach is not covered by one — buy another from them, or arrange it with them directly.';
    }
    return null;
}
