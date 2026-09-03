"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Which pushes earn an inbox row, and where a stored row may send you.
// Compile with tsc, run with node.
//
// The two defects these assertions are aimed at:
//
//   1. Every chat message appearing TWICE in the inbox. The `messages` insert
//      trigger from part 26 already writes a notifications row through the
//      notify-message edge function, and it has been the table's only writer
//      since 2025. Recording at the push choke point without excluding chat
//      would double every conversation in both apps, and it would look correct
//      in code review because each write is individually right.
//
//   2. A notification navigating somewhere nobody chose. `notifications.route`
//      is a string a caller supplied — a client can call notify_users() with
//      the publishable key and address their own coach — so the value is
//      untrusted on the way out of the database, exactly as a route param is in
//      src/lib/backTo.ts.
const notifyInbox_1 = require("./notifyInbox");
const wroteRows_1 = require("./wroteRows");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── every push this repository sends today ────────────────────────────────
 *
 * Stated one at a time rather than derived, so that changing the intent of one
 * of them is an edit somebody has to make here and can be asked about.
 */
const byTitle = (title) => notifyInbox_1.KNOWN_PUSHES.filter((p) => p.title === title);
// Recorded: the kinds a person who missed the banner has no other way to learn
// about. The waitlist promotion is in this list because it reports a booking
// the recipient did not make themselves — the one notification here that
// changes somebody's diary without them touching it.
for (const p of notifyInbox_1.KNOWN_PUSHES.filter((x) => [
    'Session booked', 'Session cancelled', 'A new offer', 'New booking',
    'Your coach asked about an injury', 'Your coach asked for your intake',
    'The slot you were waiting for is yours', 'A client set a personal best',
    // The two halves of an answered coaching request. Nothing else in the
    // product ever tells a client their request was answered — `coach_requests`
    // is not rendered on the client side once the row leaves 'pending' — and a
    // declined one has no surface at all.
    'Your coaching request was accepted', 'Your coaching request was declined',
].includes(x.title))) {
    ok((0, notifyInbox_1.inboxDecision)(p.title, p.body, p.route).record, `“${p.title}” from ${p.where} is worth an inbox row`);
}
// Dropped: chat, because part 26 already wrote the row.
for (const p of notifyInbox_1.KNOWN_PUSHES.filter((x) => /message/i.test(x.title))) {
    ok(!(0, notifyInbox_1.inboxDecision)(p.title, p.body, p.route).record, `“${p.title}” from ${p.where} must NOT be recorded — notify-message already inserted a row for it`);
}
// Dropped: a race that is over, and a receipt for something already on screen.
for (const p of notifyInbox_1.KNOWN_PUSHES.filter((x) => /just opened|has read your/i.test(x.title))) {
    ok(!(0, notifyInbox_1.inboxDecision)(p.title, p.body, p.route).record, `“${p.title}” from ${p.where} is noise in an inbox`);
}
// Dropped: the three whose row a trigger writes inside the same transaction.
// Not a judgement about whether the news is worth keeping — it is worth
// keeping, and it IS kept; it is written by supabase/parts/158 and 493 rather
// than by recordInbox, and a second copy would read as a second event.
for (const p of notifyInbox_1.KNOWN_PUSHES.filter((x) => [
    'New coaching request', 'A class you booked is not running', 'Classes you booked are not running',
].includes(x.title))) {
    ok(!(0, notifyInbox_1.inboxDecision)(p.title, p.body, p.route).record, `“${p.title}” from ${p.where} must NOT be recorded — a trigger already wrote that row`);
}
// The catalogue is the thing the two rules above are read against, so it has to
// still contain them. An empty filter passes a `for` loop silently.
ok(notifyInbox_1.KNOWN_PUSHES.length >= 20, 'the catalogue still lists every push in the repo');
ok(byTitle('Session cancelled').length === 2, 'both cancellation pushes are listed — the coach one and the client one');
ok(byTitle('The slot you were waiting for is yours').length === 2, 'both waitlist promotions are listed — the coach cancelling and the client cancelling send the same news');
// Ten of the twenty-five: four that route to a chat thread (two from
// messaging.ts, one from the coach's broadcast, one from the coach's nudge, all
// four already written by part 26), two slot races, one read receipt, and three
// whose row a database trigger writes inside the same transaction (a coaching
// request by part 158, a called-off class by part 493, singular and plural).
// Stated as a total so that a rule which starts dropping something it did not
// drop before fails here rather than quietly emptying somebody's inbox.
//
// The three added when the notice fan-out and the invoice notification were
// built are all on the recorded side, which is the whole point of them: they
// are the kinds nothing else in the product tells anybody about. So is the
// personal best: a coach who missed the banner learns about a record only by
// opening that client's training screen and reading the sets. So are the two
// halves of an answered coaching request, for the sharper version of the same
// reason: a declined client has no screen anywhere that would ever show them
// the answer.
// The four added when the catalogue was read against the tree — 'A session
// request', its two answers, and a session that MOVED — are all recorded, by
// the default and correctly: nothing else tells either party any of them
// happened, and a moved appointment is the one a missed banner costs most.
eq(notifyInbox_1.KNOWN_PUSHES.filter((p) => !(0, notifyInbox_1.inboxDecision)(p.title, p.body, p.route).record).length, 10, 'ten of the twenty-nine pushes are deliberately not recorded');
eq(notifyInbox_1.KNOWN_PUSHES.filter((p) => (0, notifyInbox_1.inboxDecision)(p.title, p.body, p.route).record).length, 19, 'the other nineteen are');
/* ── the rule that actually matters: chat is decided by route ──────────── */
// Reworded titles, same route. The duplicate exists because a `messages` row
// was written, and that is what the route says — so the rule must not depend on
// the word "message" appearing in the heading.
eq((0, notifyInbox_1.inboxDecision)('Anna Fitzgerald', 'See you Tuesday.', '/(client)/messages').record, false, 'a coach message titled with the coach’s own name is still a chat message');
eq((0, notifyInbox_1.inboxDecision)('Tam W.', 'Can we move to 7?', '/(trainer)/chat?clientId=abc').record, false, 'the coach’s thread carries a query string and is still a chat message');
// notify-message itself titles the push with a person's name (it reads
// profiles.full_name), so this is not hypothetical.
eq((0, notifyInbox_1.inboxDecision)('Your coach', 'New plan is up.', '/(client)/messages').record, false, 'the notify-message fallback title is still a chat message');
// The coach's check-in nudge carries no "message" in its heading and is still
// a chat message: it writes a `messages` row, part 26's trigger records that
// row, and a second one written here is the duplicate this rule exists to stop.
eq((0, notifyInbox_1.inboxDecision)('A nudge from your coach', 'How is your week going?', '/(client)/messages').record, false, 'the nudge is a chat message however it is titled');
// And the converse: the word "message" somewhere else is not a chat message.
eq((0, notifyInbox_1.inboxDecision)('Message from your coach', 'Session times move next week.', '/(client)/calendar').record, true, 'a push about the calendar is recorded whatever its heading says');
/* ── a row with nothing to show is not written ─────────────────────────── */
// notifications.body is `not null`; a heading on its own is a row that tells
// the reader nothing when they open the list.
eq((0, notifyInbox_1.inboxDecision)('Session booked', '', '/(client)/calendar').record, false, 'an empty body is not an inbox row');
eq((0, notifyInbox_1.inboxDecision)('Session booked', '   ', '/(client)/calendar').record, false, 'a whitespace body is not an inbox row');
eq((0, notifyInbox_1.inboxDecision)('Session booked', null, '/(client)/calendar').record, false, 'a null body is not an inbox row');
/* ── the default is to record ──────────────────────────────────────────── */
// A push nobody has classified is one somebody thought worth waking a phone up
// for. Dropping the unknown case would make every future notification vanish
// from the inbox until this file was edited, silently.
eq((0, notifyInbox_1.inboxDecision)('Something new', 'that nobody wrote a rule for', null).record, true, 'an unclassified push is kept, not dropped');
eq((0, notifyInbox_1.inboxDecision)('Something new', 'with no route at all', undefined).record, true, 'a push with no route is kept');
/* ── icons ─────────────────────────────────────────────────────────────── */
eq((0, notifyInbox_1.inboxIcon)('/(client)/calendar'), 'calendar', 'a calendar push is drawn with the calendar');
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/chat?clientId=abc'), 'message', 'the coach thread is drawn as a message');
eq((0, notifyInbox_1.inboxIcon)('/(client)/explore'), 'sparkle', 'an offer is drawn as a sparkle');
eq((0, notifyInbox_1.inboxIcon)('/(client)/injuries'), 'heart', 'an injury ask is drawn as a heart');
// Both of these drew the generic bell until the routes were mapped. The bell is
// the fallback for "nothing here recognises this route", so a real kind wearing
// it is a row that looks unclassified in a list where every neighbour is.
eq((0, notifyInbox_1.inboxIcon)('/(client)/intake'), 'pencil', 'an intake ask is drawn as something to fill in');
eq((0, notifyInbox_1.inboxIcon)('/(client)/notices'), 'info', 'a notice from a gym or a coach is drawn as a notice');
eq((0, notifyInbox_1.inboxIcon)('/(client)/request-session'), 'calendar', 'a yes or no about an hour is drawn with the calendar');
eq((0, notifyInbox_1.inboxIcon)('/(client)/my-coach'), 'people', 'an accepted coaching request is drawn as people');
eq((0, notifyInbox_1.inboxIcon)('/(client)/trainers'), 'people', 'and so is a declined one');
eq((0, notifyInbox_1.inboxIcon)('/(owner)/dashboard'), 'bell', 'an unmapped route falls back to the bell');
eq((0, notifyInbox_1.inboxIcon)(null), 'bell', 'no route falls back to the bell');
eq((0, notifyInbox_1.inboxIcon)(''), 'bell', 'an empty route falls back to the bell');
// A prefix match must not fire on a longer screen name that merely starts the
// same way — '/(client)/calendarium' is not the calendar.
eq((0, notifyInbox_1.inboxIcon)('/(client)/calendar-archive'), 'bell', 'the icon map matches whole screen names, not prefixes of them');
// Every icon the map can yield has to be one the inbox is able to draw. This is
// a type-level fact made runtime-checkable, because the map is data.
// 'people' and 'grid' joined the list when a push started using them. They were
// always in `InboxIcon` and always drawn by src/ui/Icon.tsx — the routes that
// yield them ('/(trainer)/dashboard', '/(trainer)/payments') had only ever been
// reached by SERVER_WRITTEN rows, which this assertion does not cover. An
// answered coaching request is the first PUSH to open one.
const DRAWABLE = ['bell', 'calendar', 'message', 'sparkle', 'heart', 'dumbbell', 'trophy', 'info', 'pencil', 'people', 'grid'];
for (const p of notifyInbox_1.KNOWN_PUSHES) {
    ok(DRAWABLE.includes((0, notifyInbox_1.inboxIcon)(p.route)), `${p.where} yields a drawable icon`);
}
// ── and the bell is not a drawable icon, it is the absence of one ────────
//
// The loop above passed on 'A session request' for a year. The bell IS
// drawable, so "yields a drawable icon" is true of a route nobody has ever put
// in the table — and this file says in four separate comments that the bell
// means "we have no idea what this is". So the assertion that catches a missing
// entry has to be about the bell specifically, and it has to be an EQUALITY:
// `every belled row is deliberate` is unfalsifiable if the list is derived from
// the same table it is checking.
//
// Routeless rows are excluded rather than listed. A row with nowhere to go is
// what the bell is for, and three server-written kinds are routeless for
// reasons their own parts argue at length (parts 146 and 159).
//
// One ROUTED kind is left, and it is the only one: '/(trainer)/nudges' is
// 'bell' in TRAINER_NAV and 'bell' in the table above, deliberately and with
// its own note. Anything else appearing here is a route somebody added and
// nobody gave a shape to.
const BELLED_ROUTES = [...new Set([
        ...notifyInbox_1.KNOWN_PUSHES.filter((p) => p.route && (0, notifyInbox_1.inboxDecision)(p.title, p.body, p.route).record && (0, notifyInbox_1.inboxIcon)(p.route) === 'bell').map((p) => p.route),
        ...notifyInbox_1.SERVER_WRITTEN.filter((s) => s.route && (0, notifyInbox_1.inboxIcon)(s.route) === 'bell').map((s) => s.route),
    ])].sort();
eq(BELLED_ROUTES.join(' | '), '/(trainer)/nudges', 'the only routed notification drawn with the generic bell is the one the icon table names on purpose');
/* ── where a stored row may send you ───────────────────────────────────── */
eq((0, notifyInbox_1.safeRoute)('/(client)/calendar', 'client'), '/(client)/calendar', 'a client row opens a client screen');
eq((0, notifyInbox_1.safeRoute)('/(trainer)/chat?clientId=abc', 'trainer'), '/(trainer)/chat?clientId=abc', 'a query string is allowed through');
eq((0, notifyInbox_1.safeRoute)('/(owner)/promotions', 'owner'), '/(owner)/promotions', 'an owner row opens an owner screen');
eq((0, notifyInbox_1.safeRoute)('/(client)/pt-sessions', 'client'), '/(client)/pt-sessions', 'a hyphenated screen name is a screen name');
// Cross-group. These three apps are three binaries and each contains only its
// own group; pushing another group's route navigates to a screen that is not in
// this bundle.
eq((0, notifyInbox_1.safeRoute)('/(trainer)/calendar', 'client'), null, 'the client app does not open a trainer screen');
eq((0, notifyInbox_1.safeRoute)('/(client)/calendar', 'trainer'), null, 'the coach app does not open a client screen');
eq((0, notifyInbox_1.safeRoute)('/(client)/calendar', 'owner'), null, 'the owner app does not open a client screen');
// Attacker-supplied. notify_users() caps the length of this string and checks
// nothing else about it, on purpose — the database is not where this app's list
// of screens belongs — so everything below arrives here for real.
eq((0, notifyInbox_1.safeRoute)('https://example.com', 'client'), null, 'a URL is not a route');
eq((0, notifyInbox_1.safeRoute)('//example.com', 'client'), null, 'a protocol-relative URL is not a route');
eq((0, notifyInbox_1.safeRoute)('javascript:alert(1)', 'client'), null, 'a javascript: URL is not a route');
eq((0, notifyInbox_1.safeRoute)('/(client)/../../elsewhere', 'client'), null, 'a traversal is not a route');
eq((0, notifyInbox_1.safeRoute)('/(client)/calendar/../settings', 'client'), null, 'a route with a second segment is refused');
eq((0, notifyInbox_1.safeRoute)('/(client)/calendar#frag', 'client'), null, 'a fragment is not part of a route we send');
eq((0, notifyInbox_1.safeRoute)('  /(client)/calendar  ', 'client'), '/(client)/calendar', 'surrounding whitespace is trimmed, not fatal');
eq((0, notifyInbox_1.safeRoute)('/(admin)/everything', 'client'), null, 'there is no fourth group');
eq((0, notifyInbox_1.safeRoute)('(client)/calendar', 'client'), null, 'a route must be absolute');
eq((0, notifyInbox_1.safeRoute)('', 'client'), null, 'an empty route opens nothing');
eq((0, notifyInbox_1.safeRoute)(null, 'client'), null, 'a null route opens nothing');
eq((0, notifyInbox_1.safeRoute)(undefined, 'client'), null, 'a missing route opens nothing');
// Every route the repo actually sends resolves for the group it is addressed
// to. A validator that refused them all would pass every test above.
for (const p of notifyInbox_1.KNOWN_PUSHES) {
    if (!p.route)
        continue;
    const group = p.route.startsWith('/(client)') ? 'client' : p.route.startsWith('/(owner)') ? 'owner' : 'trainer';
    eq((0, notifyInbox_1.safeRoute)(p.route, group), p.route, `${p.route} from ${p.where} is a route this app will open`);
}
/* ── how old a row is ──────────────────────────────────────────────────── */
const T = Date.parse('2026-08-31T12:00:00.000Z');
const at = (ms) => new Date(T - ms).toISOString();
eq((0, notifyInbox_1.inboxAge)(at(0), T), 'Just now', 'a row written this instant is Just now');
eq((0, notifyInbox_1.inboxAge)(at(59000), T), 'Just now', 'under a minute is Just now');
eq((0, notifyInbox_1.inboxAge)(at(60000), T), '1m', 'a minute is 1m');
eq((0, notifyInbox_1.inboxAge)(at(59 * 60000), T), '59m', 'fifty-nine minutes is still minutes');
eq((0, notifyInbox_1.inboxAge)(at(60 * 60000), T), '1h', 'an hour is 1h');
eq((0, notifyInbox_1.inboxAge)(at(23 * 3600000), T), '23h', 'just under a day is still hours');
eq((0, notifyInbox_1.inboxAge)(at(24 * 3600000), T), '1d', 'a day is 1d');
eq((0, notifyInbox_1.inboxAge)(at(6 * 86400000), T), '6d', 'six days is still days');
eq((0, notifyInbox_1.inboxAge)(at(7 * 86400000), T), '1w', 'a week is 1w');
// Exactly a year. Pinned because the boundary is a `<` that reads equally well
// as a `<=`, and with `<=` this row would say "52w" — a real notification aged
// into a unit nobody counts in.
eq((0, notifyInbox_1.inboxAge)(at(365 * 86400000), T), '1y', 'a year to the day is 1y, not 52w');
eq((0, notifyInbox_1.inboxAge)(at(400 * 86400000), T), '1y', 'over a year is years');
// A row a few seconds in the future — the phone's clock against the server's —
// must not read "in 4 seconds".
eq((0, notifyInbox_1.inboxAge)(at(-4000), T), 'Just now', 'clock skew reads as Just now, not as the future');
eq((0, notifyInbox_1.inboxAge)('not a date', T), '', 'an unparseable timestamp shows nothing rather than "NaN"');
eq((0, notifyInbox_1.inboxAge)(null, T), '', 'a missing timestamp shows nothing');
// The whole suite runs under three timezones (`npm run test:zones`). Nothing
// above may depend on which one: these are durations, not calendar dates, and
// this assertion is what stops somebody "improving" them into "Yesterday".
const sameEverywhere = ['Just now', '1m', '59m', '1h', '23h', '1d', '6d', '1w', '1y'];
for (const label of sameEverywhere) {
    ok(!/\d{4}|Jan|Yesterday|\//.test(label), `“${label}” carries no calendar in it`);
}
/* ── the mark on the bell ──────────────────────────────────────────────────
 *
 * The defect this is aimed at is a bell that says "nothing here" because the
 * read failed. It is the LoadStatus rule applied to the smallest piece of UI in
 * the app: an empty list under 'error' means "could not be read", and rendering
 * it as an unmarked bell states the opposite in the one place a person looks
 * before deciding not to open the inbox at all.
 */
// 'ready' is the only status that may print a figure, and it is exact.
eq((0, notifyInbox_1.unreadBadge)(0, 'ready').kind, 'none', 'nothing unread and the server answered — no mark');
eq((0, notifyInbox_1.unreadBadge)(3, 'ready').kind, 'count', 'three unread over a whole read is a figure');
// One. The boundary between "draw nothing" and "draw a number", and the only
// count in the range where an off-by-one is invisible in every other assertion
// here — a bell that stays bare over a single unread notification is the whole
// defect this function was written for.
eq((0, notifyInbox_1.unreadBadge)(1, 'ready').label, '1', 'a single unread is a badge, not a bare bell');
eq((0, notifyInbox_1.unreadBadge)(3, 'ready').label, '3', 'the figure is the count');
eq((0, notifyInbox_1.unreadBadge)(11, 'ready').a11y, 'Notifications. 11 unread.', 'a screen reader is told the number, not just that there is a badge');
// A count of rows in a table with no ceiling. `1204` unseparated is the defect
// scripts/check-numbers.mjs exists for, and the bell is a place a sweep would
// miss because the value never appears in the JSX as a number.
eq((0, notifyInbox_1.unreadBadge)(1204, 'ready').label, '1,204', 'four digits carry a separator');
eq((0, notifyInbox_1.unreadBadge)(12045, 'ready').label, '12,045', 'five digits too');
// 'error': the only case where the answer is the same whatever is in hand. An
// empty cache and a cache with nine unread rows are both "we do not know".
eq((0, notifyInbox_1.unreadBadge)(0, 'error').kind, 'unknown', 'a failed read is NOT "no unread"');
eq((0, notifyInbox_1.unreadBadge)(9, 'error').kind, 'unknown', 'a stale cache is not a count either');
eq((0, notifyInbox_1.unreadBadge)(0, 'error').a11y, 'Notifications. Unread count could not be read.', 'the failure is spoken, not left to a silent bell');
// 'partial': the rows past the cap are the OLDEST, so zero unread among the
// newest is not zero unread. Neither branch prints a figure — a count over an
// unknown fraction of the set is what src/ui/loadStatus.ts forbids.
eq((0, notifyInbox_1.unreadBadge)(3, 'partial').kind, 'some', 'a truncated read shows a mark, not a number');
eq((0, notifyInbox_1.unreadBadge)(1, 'partial').kind, 'some', 'and one unread in the newest rows is still a mark');
eq((0, notifyInbox_1.unreadBadge)(0, 'partial').kind, 'unknown', 'no unread in the newest rows is not no unread');
ok(!Object.prototype.hasOwnProperty.call((0, notifyInbox_1.unreadBadge)(3, 'partial'), 'label'), 'nothing under partial carries a figure to render');
// 'loading': the first read is in flight and a cached copy may already be on
// screen. Drawing a figure from it means printing a number and changing it a
// moment later.
eq((0, notifyInbox_1.unreadBadge)(5, 'loading').kind, 'none', 'nothing is claimed before the first read lands');
eq((0, notifyInbox_1.unreadBadge)(0, 'loading').kind, 'none', 'including when the cache is empty');
// The count arrives from `items.filter(…).length` today, but this is a public
// function and a wrong number must not reach a badge as "NaN" or "-1".
eq((0, notifyInbox_1.unreadBadge)(-1, 'ready').kind, 'none', 'a negative count is not a badge');
eq((0, notifyInbox_1.unreadBadge)(Number.NaN, 'ready').kind, 'none', 'NaN is not a badge');
eq((0, notifyInbox_1.unreadBadge)(3.7, 'ready').label, '3', 'a fractional count is floored, not rounded up');
// Whatever the status, a mark that is drawn is a mark that can be spoken, and
// no mark ever renders a raw unseparated four-digit number.
const STATUSES = ['loading', 'ready', 'partial', 'error'];
for (const st of STATUSES) {
    for (const n of [0, 1, 11, 999, 1000, 1204, 99999]) {
        const b = (0, notifyInbox_1.unreadBadge)(n, st);
        if (b.kind === 'none')
            continue;
        ok(typeof b.a11y === 'string' && b.a11y.length > 0, `${st}/${n}: a drawn mark says what it means`);
        if (b.kind === 'count')
            ok(!/^\d{4,}$/.test(b.label), `${st}/${n}: “${b.label}” carries its separator`);
    }
}
/* ── the heading a row is drawn with ────────────────────────────────────────
 *
 * The defect: `notifications.title` is nullable and the inbox drew
 * `item.title ?? f.title`, where `f.title` is the SCREEN's own name. Two rows
 * in production render right now as a heading reading "Notifications" over a
 * body reading "third rep", on a screen called Notifications. It does not look
 * like a missing heading — it looks like a real one that says nothing.
 */
eq((0, notifyInbox_1.inboxHeading)('Session cancelled', 'calendar'), 'Session cancelled', 'a row with a heading keeps it');
eq((0, notifyInbox_1.inboxHeading)('  Session cancelled  ', 'calendar'), 'Session cancelled', 'a heading is trimmed, not rejected');
// The one untitled kind that is actually known. Every title-less row in this
// table was written by notify-message after a chat message, which is what its
// icon records, so this is a true sentence about it and not a guess.
eq((0, notifyInbox_1.inboxHeading)(null, 'message'), 'New message', 'an untitled chat row says what it is');
eq((0, notifyInbox_1.inboxHeading)('', 'message'), 'New message', 'an empty title is no title');
eq((0, notifyInbox_1.inboxHeading)('   ', 'message'), 'New message', 'a whitespace title is no title');
eq((0, notifyInbox_1.inboxHeading)(undefined, 'message'), 'New message', 'a missing title is no title');
// Everything else draws no heading rather than an invented one. "Session
// update" over a cancellation is a worse lie than silence, because it is
// plausible enough to be believed.
eq((0, notifyInbox_1.inboxHeading)(null, 'calendar'), null, 'an untitled calendar row is not given a guessed heading');
eq((0, notifyInbox_1.inboxHeading)(null, 'bell'), null, 'an untitled unclassified row draws no heading');
eq((0, notifyInbox_1.inboxHeading)(null, 'sparkle'), null, 'an untitled offer draws no heading');
eq((0, notifyInbox_1.inboxHeading)(null, 'pencil'), null, 'an untitled intake ask draws no heading');
// The actual regression guard: whatever this returns, it is never the name of
// the screen it is drawn on. All three apps call that screen "Notifications".
const EVERY_ICON = ['bell', 'calendar', 'message', 'sparkle', 'heart', 'dumbbell', 'trophy', 'info', 'pencil'];
for (const ic of EVERY_ICON) {
    const h = (0, notifyInbox_1.inboxHeading)(null, ic);
    ok(h !== 'Notifications', `an untitled ${ic} row does not borrow the screen's name`);
    ok(h === null || h.length > 0, `an untitled ${ic} row draws a real heading or none at all`);
}
// And a row that genuinely IS titled "Notifications" keeps it — the rule is
// about the fallback, not about censoring a word.
eq((0, notifyInbox_1.inboxHeading)('Notifications', 'bell'), 'Notifications', 'a real heading is never second-guessed');
/* ── what the inbox may destroy ─────────────────────────────────────────────
 *
 * A DELETE is a write whose failure looks exactly like its success — proved
 * live: a stranger deleting another account's notification comes back 0 rows,
 * no error, and so does a signed-out caller deleting the entire table. These
 * assertions are about the half that can be decided without a server: whether
 * the control is offered at all, which depends on how much of the list is
 * actually known.
 */
// 'ready' — the whole set from the server. Everything is offered, and this is
// the only status under which a figure over the list is the truth.
eq((0, notifyInbox_1.inboxControls)('ready').rowDelete, true, 'a confirmed list can have a row removed');
eq((0, notifyInbox_1.inboxControls)('ready').markUnread, true, 'a confirmed list can have a row put back to unread');
eq((0, notifyInbox_1.inboxControls)('ready').clearRead, true, 'a confirmed list can be cleared of read rows');
eq((0, notifyInbox_1.inboxControls)('ready').withheld, null, 'nothing is withheld over a confirmed list, so nothing is explained');
// 'error' — the list is a cached copy of unknown age and an empty one means
// "could not be read". A row vanishing from a screen that already says it is
// unconfirmed would be the app inventing a fact.
eq((0, notifyInbox_1.inboxControls)('error').rowDelete, false, 'nothing is deleted over a list the server did not confirm');
eq((0, notifyInbox_1.inboxControls)('error').markUnread, false, 'nor is read state changed over one');
eq((0, notifyInbox_1.inboxControls)('error').clearRead, false, 'and certainly not in bulk');
ok(((0, notifyInbox_1.inboxControls)('error').withheld ?? '').length > 0, 'the reason the controls are gone is said, not left to be noticed');
// 'partial' — the rows are real but they are a prefix. Per-row removal is fine:
// each row named came back from the server in THIS read. Clear Read is not:
// the statement would sweep rows past the cap while the confirmation could only
// count the ones on screen.
eq((0, notifyInbox_1.inboxControls)('partial').rowDelete, true, 'a row that came back in a truncated read is still a row we read');
eq((0, notifyInbox_1.inboxControls)('partial').markUnread, true, 'so its read state can be changed too');
eq((0, notifyInbox_1.inboxControls)('partial').clearRead, false, 'a bulk delete over a prefix would remove what it could not count');
ok(((0, notifyInbox_1.inboxControls)('partial').withheld ?? '').length > 0, 'and the screen says why the bulk control is missing');
// 'loading' — nothing has come back. Anything on screen is a cache and there is
// nothing established to destroy.
eq((0, notifyInbox_1.inboxControls)('loading').rowDelete, false, 'nothing is destroyed before the first read lands');
eq((0, notifyInbox_1.inboxControls)('loading').clearRead, false, 'including in bulk');
eq((0, notifyInbox_1.inboxControls)('loading').withheld, null, 'and no explanation is owed for a control that is about to appear');
// The rule that matters most, stated over the whole type rather than status by
// status: 'ready' is the ONLY status that may clear in bulk. Written this way
// so that a fifth LoadStatus, or a reordered branch that falls through to the
// permissive default, fails here rather than shipping a bulk delete over a set
// nobody has all of.
for (const st of STATUSES) {
    eq((0, notifyInbox_1.inboxControls)(st).clearRead, st === 'ready', `${st}: bulk clearing is offered only over a whole, confirmed list`);
    if (!(0, notifyInbox_1.inboxControls)(st).rowDelete) {
        eq((0, notifyInbox_1.inboxControls)(st).markUnread, false, `${st}: a list too uncertain to delete from is too uncertain to re-mark`);
    }
}
/* ── the confirmation for Clear Read ────────────────────────────────────── */
// The button and its confirmation come from one function, so they cannot come
// apart: no prompt means no button.
eq((0, notifyInbox_1.clearReadPrompt)(4, 'partial'), null, 'no bulk prompt over a truncated read');
eq((0, notifyInbox_1.clearReadPrompt)(4, 'error'), null, 'no bulk prompt over a failed read');
eq((0, notifyInbox_1.clearReadPrompt)(4, 'loading'), null, 'no bulk prompt before the first read lands');
eq((0, notifyInbox_1.clearReadPrompt)(0, 'ready'), null, 'nothing marked read means nothing to offer');
eq((0, notifyInbox_1.clearReadPrompt)(-3, 'ready'), null, 'a negative count offers nothing');
eq((0, notifyInbox_1.clearReadPrompt)(Number.NaN, 'ready'), null, 'NaN offers nothing');
const p4 = (0, notifyInbox_1.clearReadPrompt)(4, 'ready');
ok(p4 != null, 'four read notifications over a confirmed list can be cleared');
eq(p4.title, 'Delete 4 read notifications?', 'the confirmation names the figure');
ok(/unread stays/i.test(p4.message), 'and says what it does NOT touch, which is the fear the control raises');
ok(/for good/i.test(p4.message), 'and that it is irreversible, because it is');
const p1 = (0, notifyInbox_1.clearReadPrompt)(1, 'ready');
eq(p1.title, 'Delete the read notification?', 'one row is not "1 read notifications"');
eq(p1.confirm, 'Delete', 'and its button is singular too');
// A count of rows in a table with no ceiling. `1204 read notifications` is the
// defect scripts/check-numbers.mjs exists for, and a confirmation dialog is
// exactly the place an unseparated figure gets approved without being read.
ok((0, notifyInbox_1.clearReadPrompt)(1204, 'ready').title.includes('1,204'), 'four digits in a confirmation carry a separator');
ok((0, notifyInbox_1.clearReadPrompt)(12045, 'ready').title.includes('12,045'), 'five digits too');
ok(!/\d{4,}/.test((0, notifyInbox_1.clearReadPrompt)(1204, 'ready').title), 'and no unseparated run of digits survives anywhere in it');
// House style: Title Case for a button, sentence case for the sentence.
for (const n of [1, 2, 40, 1204]) {
    const p = (0, notifyInbox_1.clearReadPrompt)(n, 'ready');
    ok(/^[A-Z]/.test(p.title) && p.title.endsWith('?'), `${n}: the confirmation asks a question`);
    ok(/^[A-Z][^.]*\./.test(p.message), `${n}: the note under it is a sentence`);
    eq(p.label, 'Clear Read', `${n}: the button is Title Case`);
}
/* ── what is said afterwards ────────────────────────────────────────────────
 *
 * Never report success the server did not give. `writeFailure` is what turns a
 * row count into the sentence; these check that a success is silent and a
 * failure is not.
 */
eq((0, notifyInbox_1.deletedNote)('Session cancelled', null), null, 'a delete that worked needs no announcement — the row is gone');
// The three ways a single delete fails, through the real writeFailure so the
// wording cannot drift from src/lib/wroteRows.ts.
const refused = (0, notifyInbox_1.deletedNote)('Session cancelled', (0, wroteRows_1.writeFailure)('This notification', { error: new Error('nope') }));
ok(refused.startsWith('Session cancelled is still in your inbox.'), 'a refused delete names the row and says it is still there');
const uncounted = (0, notifyInbox_1.deletedNote)('Session cancelled', (0, wroteRows_1.writeFailure)('This notification', { error: null, count: null }));
ok(/did not say whether/.test(uncounted), 'a delete nobody counted is reported as uncounted, not as done');
const nomatch = (0, notifyInbox_1.deletedNote)('Session cancelled', (0, wroteRows_1.writeFailure)('This notification', { error: null, count: 0 }));
ok(/matched no rows/.test(nomatch), 'zero rows is reported as zero rows');
ok(/still in your inbox/.test(nomatch), 'and the reader is told the row did not go anywhere');
// The one that must never happen: a count of 1 is a real deletion and produces
// no failure sentence at all.
eq((0, wroteRows_1.writeFailure)('This notification', { error: null, count: 1 }), null, 'one row deleted is a delete that happened');
/* ── and after Clear Read ───────────────────────────────────────────────── */
// Three outcomes, three sentences. The middle one is the one that gets written
// as "Done" everywhere else and is the reason the count is asked for.
ok(/did not answer/.test((0, notifyInbox_1.clearedNote)(false, 0)), 'a failed clear says the server did not answer');
ok(/unchanged/.test((0, notifyInbox_1.clearedNote)(false, 0)), 'and that the inbox is unchanged');
// A failure that somehow carries a count is still a failure. Ordering the `ok`
// check first is what makes that true, and this is the assertion that pins it.
ok(/did not answer/.test((0, notifyInbox_1.clearedNote)(false, 9)), 'a count on a failed call does not turn it into a success');
ok(/Nothing was deleted/.test((0, notifyInbox_1.clearedNote)(true, 0)), 'a clear that matched nothing says so');
ok(/nothing marked read/.test((0, notifyInbox_1.clearedNote)(true, 0)), 'and says why, rather than reading as a failure');
eq((0, notifyInbox_1.clearedNote)(true, 1), 'One read notification deleted.', 'one row is not "1 read notifications deleted"');
eq((0, notifyInbox_1.clearedNote)(true, 4), '4 read notifications deleted.', 'four rows are counted');
eq((0, notifyInbox_1.clearedNote)(true, 1204), '1,204 read notifications deleted.', 'and a four-digit count carries its separator');
// A count that is not a count. `changed` is a number the CALLER parsed off a
// Content-Range header, so the junk cases are real: the guard in clearedNote
// exists so a failed parse reads as "nothing was deleted" rather than as
// "-3 read notifications deleted", which is a sentence about a deletion that
// went backwards. Asserted because the guard is two conditions and dropping
// either of them leaves the other looking sufficient.
eq((0, notifyInbox_1.clearedNote)(true, -3), 'Nothing was deleted. There was nothing marked read to remove.', 'a negative count is not a deletion');
eq((0, notifyInbox_1.clearedNote)(true, Number.NaN), 'Nothing was deleted. There was nothing marked read to remove.', 'a count that is not a number is not a deletion');
eq((0, notifyInbox_1.clearedNote)(true, 2.7), '2 read notifications deleted.', 'a fractional count is floored, not rounded up past what was matched');
for (const n of [0, 1, 4, 999, 1204, 99999]) {
    ok(!/\d{4,}/.test((0, notifyInbox_1.clearedNote)(true, n)), `${n}: no unseparated run of digits reaches the reader`);
}
/* ── the badge and a delete cannot disagree ─────────────────────────────────
 *
 * The bell's mark is `unreadBadge(items.filter(i => !i.read).length, status)`,
 * derived on every render and never stored. That is the whole defence against
 * the bell and the list disagreeing after a delete, so it is worth stating what
 * it buys: removing an unread row lowers the figure by exactly one, and putting
 * a row back to unread raises it by exactly one.
 */
{
    const rows = [{ read: false }, { read: false }, { read: true }, { read: false }];
    const mark = (rs) => (0, notifyInbox_1.unreadBadge)(rs.filter((r) => !r.read).length, 'ready');
    eq(mark(rows).label, '3', 'three unread to begin with');
    // Delete one unread row.
    eq(mark(rows.slice(1)).label, '2', 'deleting an unread row lowers the bell by one');
    // Delete the read one: the figure does not move.
    eq(mark(rows.filter((_, i) => i !== 2)).label, '3', 'deleting a read row does not move the bell');
    // Put the read one back to unread.
    eq(mark(rows.map((r, i) => (i === 2 ? { read: false } : r))).label, '4', 'marking a row unread raises the bell by one');
    // Clear Read removes every read row and touches no unread one.
    eq(mark(rows.filter((r) => !r.read)).label, '3', 'clearing read rows leaves the unread count alone');
    // And the empty inbox after everything is deleted draws no mark — under
    // 'ready', where that is a true statement.
    eq(mark([]).kind, 'none', 'an inbox emptied by hand shows no mark');
    // But the same empty list under 'error' still does not say "none".
    eq((0, notifyInbox_1.unreadBadge)(0, 'error').kind, 'unknown', 'an empty inbox under a failed read is still not "you have none"');
}
/* ── rows written by a trigger or an edge function ─────────────────────────
 *
 * These never pass through inboxDecision() — nothing in TypeScript decides
 * whether they exist — so the only thing that can be asserted about them is
 * what the READER will do with them. Both halves of that have already been
 * wrong in production once each:
 *
 *   · notify-message wrote coach rows routed at '/(trainer)/messages', which
 *     is a real screen in the coach's own group, so nothing refused it. It is
 *     the thread LIST. Every message notification a coach ever tapped opened
 *     the wrong screen, and the client side was masked by a fallback that
 *     cannot exist for a coach.
 *   · '/(client)/intake' had been pushed since intake.ts was written and drew
 *     the generic bell, because ICON_BY_ROUTE had no entry for it — the same
 *     silence a new trigger gets for free.
 */
{
    ok(notifyInbox_1.SERVER_WRITTEN.length > 0, 'the server-written catalogue is not empty');
    for (const e of notifyInbox_1.SERVER_WRITTEN) {
        // 1 · the recipient's build will actually follow it.
        if (e.route === null) {
            ok(e.icon === 'bell', `${e.where} writes no route, so its row can only be drawn with the bell`);
        }
        else {
            eq((0, notifyInbox_1.safeRoute)(e.route, e.to), e.route, `${e.where} (${e.when}) is addressed to the ${e.to} build, so its route must survive safeRoute there`);
        }
        // 2 · the icon the reader computes is the one this catalogue names. The
        //     `icon` column the writer set is not consulted for a row that has a
        //     route — src/ui/notifications.tsx recomputes it — so a trigger cannot
        //     choose its own icon and this is where the two are tied together.
        eq((0, notifyInbox_1.inboxIcon)(e.route), e.icon, `${e.where} (${e.when}) draws the icon this catalogue claims`);
        // 3 · a routeless row whose icon is 'message' is read as a PRE-part-122
        //     chat row and silently given '/(client)/messages'. Nothing new may
        //     look like one.
        ok(!(e.route === null && e.icon === 'message'), `${e.where} must not write a routeless 'message' row — the reader treats those as legacy chat`);
    }
    // The coach's rows, named one at a time rather than counted, so that
    // deleting one is an edit somebody has to make here.
    for (const title of [
        'A coaching request', 'Paperwork accepted', 'A subscription has ended',
        // part 159
        'A client has ended their coaching', 'A package was bought', 'An intake has come back',
        'A client has signed the release', 'A client has left you a review',
        // part 163
        'A session pack is nearly used up', 'A session pack has run out',
    ]) {
        const e = notifyInbox_1.SERVER_WRITTEN.find((x) => x.title === title);
        ok(!!e, `“${title}” is still written to a coach somewhere`);
        eq(e?.to, 'trainer', `“${title}” goes to the coach's build`);
    }
    // And the client-directed rows, which are the ones most likely to be given a
    // coach route by somebody editing the block above them.
    for (const title of [
        // part 159
        'Your coaching has ended', 'A place has opened in a class',
        // part 160
        'Your payment did not go through',
    ]) {
        const e = notifyInbox_1.SERVER_WRITTEN.find((x) => x.title === title);
        ok(!!e, `“${title}” is still written to a client somewhere`);
        eq(e?.to, 'client', `“${title}” goes to the client's build`);
    }
    // A pack running out is TWO rows about one balance, and the pair only works
    // if it stays a pair. The warning at one session left is what makes the
    // conversation cheap — a coach raises it in the session they are already
    // delivering — and the row at zero is the fact that the NEXT session is
    // covered by nothing. Collapsing them back to one leaves the coach learning
    // it at the moment it is too late to have said anything, which is where
    // `packRunOut()` already was: computed, correct, and rendered only on a
    // screen nobody opens weekly.
    const packRows = notifyInbox_1.SERVER_WRITTEN.filter((x) => x.where.includes('pack_balance_notify'));
    eq(packRows.length, 2, 'a pack running out is told twice: nearly, and then actually');
    eq(new Set(packRows.map((x) => x.title)).size, 2, 'with two different headings');
    // And a pack running out of TIME is a THIRD row, from a different writer.
    // The filter above is keyed on part 163's function rather than on the words
    // "session pack" for exactly this reason: part 612's expiry pass is about a
    // pack somebody did NOT use, which is the opposite fact, and folding it in
    // with the two above would let a future edit delete one of the pair and still
    // count three.
    const expiryRows = notifyInbox_1.SERVER_WRITTEN.filter((x) => x.where.includes('run_pack_expiry'));
    eq(expiryRows.length, 1, 'a pack running out of time is told once, on the day the window closes');
    for (const r of [...packRows, ...expiryRows]) {
        eq(r.to, 'trainer', `“${r.title}” is the coach's to act on`);
    }
    ok(!expiryRows.some((x) => packRows.some((p) => p.title === x.title)), 'and it does not borrow either of the used-up headings — "used up" and "ran out of time" are opposite facts about somebody paying');
    for (const p of packRows) {
        eq(p.to, 'trainer', `“${p.title}” goes to the coach — the client just booked the session that spent it`);
        eq(p.route, '/(trainer)/payments', `“${p.title}” opens the screen that knows how to price a pack`);
        // No figure and no currency, anywhere in the catalogue entry.
        // `client_purchases.amount_cents` is nullable, its currency is a separate
        // and often-null column, and part 150 left this product with no default
        // currency at all. The count is the message; the money is on the screen.
        ok(!/[$£€]|\b(?:AED|GBP|USD|EUR|SAR|AUD|CAD|ZAR)\b/.test(p.title), `“${p.title}” states no currency — there is no default one to state`);
    }
    // A declined card is TWO rows about one status transition, and they are the
    // pair this catalogue is most likely to be edited into one of. Part 158 tells
    // the coach, who can do nothing about somebody else's card; part 160 tells the
    // client, who is the only person who can fix it. Losing either half is a
    // regression with a name: before 160 the coach was told and the client found
    // out when their coaching stopped.
    const declined = notifyInbox_1.SERVER_WRITTEN.filter((x) => /payment (failed|did not go through)/.test(x.title));
    eq(declined.length, 2, 'a declined card is told to both parties, in two different rows');
    eq(new Set(declined.map((x) => x.to)).size, 2, 'and the two rows go to two different builds');
    eq(new Set(declined.map((x) => x.title)).size, 2, 'with two different headings — "a client of yours" is not "your card"');
    // Neither half may be followable from the other's build, which is the whole
    // reason they are two rows and not one reused route.
    for (const d of declined) {
        for (const other of ['client', 'trainer']) {
            if (other === d.to)
                continue;
            eq((0, notifyInbox_1.safeRoute)(d.route, other), null, `${d.where} is addressed to the ${d.to} build, so the ${other} build must not follow it`);
        }
    }
    // The two sides of an ending are DIFFERENT rows. One trigger function writes
    // both (coaching_end_notify), branching on `ended_by`, and the cheapest way to
    // get that wrong is to send one message to both people.
    const ends = notifyInbox_1.SERVER_WRITTEN.filter((x) => x.where.includes('coaching_end_notify'));
    eq(ends.length, 2, 'an ending is told to both parties, in two different rows');
    eq(new Set(ends.map((x) => x.to)).size, 2, 'and the two rows go to two different builds');
    eq(new Set(ends.map((x) => x.title)).size, 2, 'with two different headings — a client leaving is not a coach letting go');
    // A coach's row routed into the client group is the exact failure mode this
    // block exists for, and it has to be shown to FAIL rather than assumed to.
    eq((0, notifyInbox_1.safeRoute)('/(client)/calendar', 'trainer'), null, 'a route naming another group is refused, which is why entry 1 above is worth asserting');
    // And the coach's three routes are refused for a client build, so a
    // mis-addressed row cannot navigate a client into a coach screen.
    for (const r of ['/(trainer)/dashboard', '/(trainer)/documents', '/(trainer)/payments',
        '/(trainer)/credentials', '/(trainer)/client-intake?clientId=abc']) {
        eq((0, notifyInbox_1.safeRoute)(r, 'client'), null, `${r} is not followable from the client app`);
    }
    // The mirror of that, for part 159's two client-directed rows: a coach build
    // must not be navigated into the client app by a mis-addressed ending or
    // promotion.
    eq((0, notifyInbox_1.safeRoute)('/(client)/classes', 'trainer'), null, 'a class seat is not followable from the coach app');
}
/* ── the coach's icons ─────────────────────────────────────────────────────
 *
 * Stated separately from the catalogue because the catalogue would still pass
 * if all three fell back to the bell together with their entries changed to
 * match. These pin the actual shapes, which are TRAINER_NAV's.
 */
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/dashboard'), 'people', 'a coaching request draws the Clients icon');
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/documents'), 'pencil', 'an acceptance draws the Your Documents icon');
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/payments'), 'grid', 'a subscription draws the Payments & Packages icon');
// Whole-route matching, as the note over ICON_BY_ROUTE insists: a screen whose
// name merely begins with one of those gets the bell, not the neighbour's icon.
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/payments-archive'), 'bell', 'a longer screen name is not a prefix match');
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/documents?clientId=abc'), 'pencil', 'a query string does not lose the icon');
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/credentials'), 'trophy', 'a review draws the Credentials & Reviews icon');
// The ask and the answer are the same document from two sides, so they are the
// same shape in two different inboxes. A reader who has seen one recognises the
// other, which is the whole reason ICON_BY_ROUTE is a table and not a guess.
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/client-intake?clientId=abc'), (0, notifyInbox_1.inboxIcon)('/(client)/intake'), 'an intake coming back wears the same icon as the ask that went out');
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/client-intake?clientId=abc'), 'pencil', 'and that icon is the pencil');
// Without its clientId the coach's intake screen says no client was named, so
// the query string is load-bearing and must not cost the row its icon.
eq((0, notifyInbox_1.inboxIcon)('/(trainer)/client-intake'), 'pencil', 'the bare route keeps it too');
// Part 160's route. Asserted here as well as through the catalogue because the
// catalogue would still pass with both sides changed to 'bell' together — and
// 'bell' is what a route with no ICON_BY_ROUTE entry silently becomes, which is
// exactly how '/(client)/intake' shipped unrecognised for a year.
eq((0, notifyInbox_1.inboxIcon)('/(client)/packages'), 'trophy', 'a declined card draws the Memberships & Packs icon');
eq((0, notifyInbox_1.inboxIcon)('/(client)/packages?from=inbox'), 'trophy', 'a query string does not lose it either');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log(`notifyInbox: ok (${notifyInbox_1.KNOWN_PUSHES.length} pushes classified, ${notifyInbox_1.KNOWN_PUSHES.filter((p) => (0, notifyInbox_1.inboxDecision)(p.title, p.body, p.route).record).length} recorded, ${notifyInbox_1.SERVER_WRITTEN.length} written server-side)`);
