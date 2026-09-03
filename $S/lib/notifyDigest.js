"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BODY_MAX = void 0;
exports.digestNote = digestNote;
exports.digestBody = digestBody;
exports.digestKey = digestKey;
exports.digestPushes = digestPushes;
exports.digestSaving = digestSaving;
// How many times one morning's work is allowed to make a phone buzz.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// Five nightly passes write a coach's notifications: a client past their usual
// gap (part 202, 07:12 UTC), a credential running out (202, 07:19), a training
// block that ended (471, 07:26), a session pack out of time (612, 07:33), an
// invoice crossing an ageing band (613, 07:40). Every one of them is a
// `for r in select … loop … insert into public.notifications … end loop`, one
// INSERT statement per row, and `notifications_dispatch_push` (part 900) is an
// AFTER INSERT trigger `for each statement`.
//
// So the grouping that trigger performs — "forty members of a cancelled class
// are one post with forty ids rather than forty posts" — cannot see across two
// statements, and a pass that writes nine rows for one coach fires nine posts
// to send-push and nine banners at that coach's phone inside a minute. It is
// worst exactly where it matters most: a coach who bills twenty clients on the
// first of the month has twenty invoices falling due on the same day and
// therefore twenty crossing into the '1-7' band on the same night.
//
// This is the failure `bookAlert` in src/lib/coachNotify.ts was written to
// avoid on the handset, in its own words:
//
//   "ONE banner and not four … A phone that fires four notifications in a row
//   about the same business on the same morning is a phone whose notifications
//   get turned off, and turning them off is what took the money channel down
//   with the chat channel in the first place."
//
// The handset half has held to that since it was written. The server half —
// which is the half that reaches somebody who is not looking, and therefore the
// half that can actually cost a coach their notifications — has never had it.
//
// ── What this does NOT do ─────────────────────────────────────────────────
//
// It does not drop a notification. Every row is written to `notifications` by
// the pass, before this is consulted at all, and every one of them is in the
// coach's list and counted by the bell. What is coalesced is the PUSH, which is
// the same distinction `CHANNEL_STILL_RECORDED` in src/lib/coachNotify.ts draws
// for muting and supabase/functions/send-push draws for quiet hours: "muting is
// 'do not buzz me about this', not 'do not tell me'".
//
// It also does not reach across passes. Each pass is its own statement, so a
// coach with something waiting in four of the five still gets four banners
// between 07:12 and 07:40 — four different subjects, which is defensible in a
// way that nine invoices is not. Narrowing that further would mean holding a
// push back in the hope of a later one, and nothing in this system can hold a
// push: `src/lib/quietHours.ts` sets out at length why the coach's quiet hours
// suppress rather than defer.
//
// ── Why a shared route is a condition and not a detail ────────────────────
//
// A digest replaces N banners with one, and that one has a single tap. If the
// rows it stands for do not agree about where they open, there is no honest
// answer for that tap — and a notification whose tap lands on the wrong screen
// is the defect `BookAlert.route` in src/lib/coachNotify.ts exists for: "the
// coach concludes the app does not have the thing it just told them about."
//
// So rows are grouped by channel AND route, and a group is what may be
// digested. In practice a pass writes one route, so this is one group; the
// condition is stated anyway, because the day it is not one group is the day
// picking a route would be a coin toss.
//
// Pure. The SQL mirror is `public.notification_digest(...)` in
// supabase/parts/1870, which is where it actually runs.
const format_1 = require("./format");
/**
 * The ceiling `notifications.body` is stored under.
 *
 * `notify_users()` and every trigger in the numbered parts write
 * `left(<body>, 500)`. A digest is composed FROM one of those bodies and must
 * still fit, so the trailing clause is subtracted rather than appended and
 * hoped for — a body silently cut at 500 would take the count off the end,
 * which is the one part of a digest that is not in the row it was built from.
 */
exports.BODY_MAX = 500;
/** Where a body is cut when the clause will not fit after it. Three characters
 *  rather than a single ellipsis glyph, because this string is also built in
 *  plpgsql and the two must be the same bytes. */
const CUT = '...';
/**
 * What a digest says after the one body it shows.
 *
 * ── Why one row's own words, and not a summary of all of them ────────────
 *
 * The alternative is a composed heading — "9 invoices have gone past their
 * date" — and it cannot be written honestly. The rows in a group do not share a
 * title (part 613 emits 'An invoice has gone past its date' below eight days
 * and 'An invoice is still unpaid' above it), pluralising an arbitrary English
 * title is not a thing plpgsql can do, and this product ships in more than one
 * language. So the digest shows one row exactly as it was written and counts
 * the rest, which is `bookAlert`'s `rest()` clause in a different shape.
 *
 * It does NOT claim the row it shows is the important one. Within one pass all
 * the rows are the same kind and nothing on the row ranks them, so a sentence
 * implying "here is the worst of them" would be inventing an order. "One of
 * them" is what is true.
 */
function digestNote(more) {
    const n = Math.max(0, Math.floor(Number.isFinite(more) ? more : 0));
    if (n <= 0)
        return '';
    return n === 1
        ? ' There is one more like this. Both are in your notifications list.'
        : ` There are ${(0, format_1.num)(n)} more like this. All ${(0, format_1.num)(n + 1)} are in your notifications list.`;
}
/**
 * One body plus the count of the rest, inside `BODY_MAX`.
 *
 * The clause is never the thing that gets cut. A digest whose count fell off
 * the end is a notification that has quietly become a single one again, and the
 * coach has no way to tell — which is worse than a body with three dots in it.
 */
function digestBody(body, more) {
    const note = digestNote(more);
    const b = (body ?? '').trim();
    if (!note)
        return b.slice(0, exports.BODY_MAX);
    const room = exports.BODY_MAX - note.length;
    // A clause longer than the whole allowance can only happen if somebody makes
    // `digestNote` enormous; the count still survives and the body does not.
    if (room <= CUT.length)
        return note.trim().slice(0, exports.BODY_MAX);
    return (b.length <= room ? b : b.slice(0, room - CUT.length).trimEnd() + CUT) + note;
}
/**
 * The key two rows must share to be digested together.
 *
 * Channel and route, and nothing else. Title and body are deliberately NOT part
 * of it — grouping by those is what the dispatcher does today, and it is why a
 * pass whose bodies name nine different invoices produces nine posts.
 */
function digestKey(r) {
    return `${r.channel} ${(r.route ?? '').trim()}`;
}
/**
 * One recipient's claimed rows → the posts to make.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 *   one row in a group   that row, unchanged, byte for byte. This is the
 *                        overwhelmingly common case — a booking, a payment, a
 *                        review — and it must be indistinguishable from what
 *                        the dispatcher does today, or this module is a change
 *                        to every notification in the product rather than to
 *                        the mornings that pile up.
 *   more than one        one post: the first row's own words, and a clause
 *                        counting the rest.
 *
 * Order is the caller's. The dispatcher hands rows over in the order the pass
 * wrote them, which is the order of its own `select` — deterministic, and not
 * claimed to be a ranking. Groups come back in first-seen order for the same
 * reason: an arbitrary order that changes between runs is a set of banners that
 * arrive in a different sequence every morning.
 *
 * Rows with an empty body are dropped, which is the condition the dispatcher
 * already applies (`where c.body is not null and btrim(c.body) <> ''`) and is
 * stated here so a caller cannot pass one in and get a digest counting a row
 * that would never have been sent.
 */
function digestPushes(rows) {
    const groups = new Map();
    for (const r of rows ?? []) {
        if (!r)
            continue;
        const body = (r.body ?? '').trim();
        const channel = (r.channel ?? '').trim();
        // A channelless row is never dispatched at all — see notifyDispatch.ts on
        // why null is the safe direction there — so it must not be able to inflate
        // somebody else's count either.
        if (!body || !channel)
            continue;
        const key = digestKey({ ...r, channel, body });
        const g = groups.get(key);
        if (g)
            g.push({ ...r, channel, body });
        else
            groups.set(key, [{ ...r, channel, body }]);
    }
    const out = [];
    for (const g of groups.values()) {
        const first = g[0];
        const title = (first.title ?? '').trim() || 'Repple';
        const route = (first.route ?? '').trim();
        out.push(g.length === 1
            ? { channel: first.channel, title, body: first.body, route, stands_for: 1 }
            : {
                channel: first.channel,
                title,
                body: digestBody(first.body, g.length - 1),
                route,
                stands_for: g.length,
            });
    }
    return out;
}
/**
 * How many banners one statement will cost one person, before and after.
 *
 * Not used by the dispatcher — it exists so the saving can be stated as a
 * number in a test and in a report rather than asserted in prose, and so that
 * a change which quietly stops coalescing shows up as a figure moving.
 */
function digestSaving(rows) {
    const sendable = (rows ?? []).filter((r) => r && (r.body ?? '').trim() && (r.channel ?? '').trim());
    return { before: sendable.length, after: digestPushes(rows).length };
}
