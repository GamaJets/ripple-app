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
import {
  KNOWN_PUSHES, inboxAge, inboxDecision, inboxIcon, safeRoute, unreadBadge, type InboxIcon,
} from './notifyInbox';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── every push this repository sends today ────────────────────────────────
 *
 * Stated one at a time rather than derived, so that changing the intent of one
 * of them is an edit somebody has to make here and can be asked about.
 */

const byTitle = (title: string) => KNOWN_PUSHES.filter((p) => p.title === title);

// Recorded: the kinds a person who missed the banner has no other way to learn
// about. The waitlist promotion is in this list because it reports a booking
// the recipient did not make themselves — the one notification here that
// changes somebody's diary without them touching it.
for (const p of KNOWN_PUSHES.filter((x) => [
  'Session booked', 'Session cancelled', 'A new offer', 'New booking',
  'Your coach asked about an injury', 'Your coach asked for your intake',
  'The slot you were waiting for is yours',
].includes(x.title))) {
  ok(inboxDecision(p.title, p.body, p.route).record, `“${p.title}” from ${p.where} is worth an inbox row`);
}

// Dropped: chat, because part 26 already wrote the row.
for (const p of KNOWN_PUSHES.filter((x) => /message/i.test(x.title))) {
  ok(!inboxDecision(p.title, p.body, p.route).record,
    `“${p.title}” from ${p.where} must NOT be recorded — notify-message already inserted a row for it`);
}
// Dropped: a race that is over, and a receipt for something already on screen.
for (const p of KNOWN_PUSHES.filter((x) => /just opened|has read your/i.test(x.title))) {
  ok(!inboxDecision(p.title, p.body, p.route).record, `“${p.title}” from ${p.where} is noise in an inbox`);
}

// The catalogue is the thing the two rules above are read against, so it has to
// still contain them. An empty filter passes a `for` loop silently.
ok(KNOWN_PUSHES.length >= 16, 'the catalogue still lists every push in the repo');
ok(byTitle('Session cancelled').length === 2, 'both cancellation pushes are listed — the coach one and the client one');
ok(byTitle('The slot you were waiting for is yours').length === 2,
  'both waitlist promotions are listed — the coach cancelling and the client cancelling send the same news');
// Seven of the sixteen: four that route to a chat thread (two from messaging.ts,
// one from the coach's broadcast, one from the coach's nudge, all four already
// written by part 26), two slot races, and one read receipt. Stated as a total
// so that a rule which starts dropping something it did not drop before fails
// here rather than quietly emptying somebody's inbox.
eq(KNOWN_PUSHES.filter((p) => !inboxDecision(p.title, p.body, p.route).record).length, 7,
  'seven of the sixteen pushes are deliberately not recorded');
eq(KNOWN_PUSHES.filter((p) => inboxDecision(p.title, p.body, p.route).record).length, 9,
  'the other nine are');

/* ── the rule that actually matters: chat is decided by route ──────────── */

// Reworded titles, same route. The duplicate exists because a `messages` row
// was written, and that is what the route says — so the rule must not depend on
// the word "message" appearing in the heading.
eq(inboxDecision('Anna Fitzgerald', 'See you Tuesday.', '/(client)/messages').record, false,
  'a coach message titled with the coach’s own name is still a chat message');
eq(inboxDecision('Tam W.', 'Can we move to 7?', '/(trainer)/chat?clientId=abc').record, false,
  'the coach’s thread carries a query string and is still a chat message');
// notify-message itself titles the push with a person's name (it reads
// profiles.full_name), so this is not hypothetical.
eq(inboxDecision('Your coach', 'New plan is up.', '/(client)/messages').record, false,
  'the notify-message fallback title is still a chat message');

// The coach's check-in nudge carries no "message" in its heading and is still
// a chat message: it writes a `messages` row, part 26's trigger records that
// row, and a second one written here is the duplicate this rule exists to stop.
eq(inboxDecision('A nudge from your coach', 'How is your week going?', '/(client)/messages').record, false,
  'the nudge is a chat message however it is titled');

// And the converse: the word "message" somewhere else is not a chat message.
eq(inboxDecision('Message from your coach', 'Session times move next week.', '/(client)/calendar').record, true,
  'a push about the calendar is recorded whatever its heading says');

/* ── a row with nothing to show is not written ─────────────────────────── */

// notifications.body is `not null`; a heading on its own is a row that tells
// the reader nothing when they open the list.
eq(inboxDecision('Session booked', '', '/(client)/calendar').record, false, 'an empty body is not an inbox row');
eq(inboxDecision('Session booked', '   ', '/(client)/calendar').record, false, 'a whitespace body is not an inbox row');
eq(inboxDecision('Session booked', null, '/(client)/calendar').record, false, 'a null body is not an inbox row');

/* ── the default is to record ──────────────────────────────────────────── */

// A push nobody has classified is one somebody thought worth waking a phone up
// for. Dropping the unknown case would make every future notification vanish
// from the inbox until this file was edited, silently.
eq(inboxDecision('Something new', 'that nobody wrote a rule for', null).record, true,
  'an unclassified push is kept, not dropped');
eq(inboxDecision('Something new', 'with no route at all', undefined).record, true,
  'a push with no route is kept');

/* ── icons ─────────────────────────────────────────────────────────────── */

eq(inboxIcon('/(client)/calendar'), 'calendar', 'a calendar push is drawn with the calendar');
eq(inboxIcon('/(trainer)/chat?clientId=abc'), 'message', 'the coach thread is drawn as a message');
eq(inboxIcon('/(client)/explore'), 'sparkle', 'an offer is drawn as a sparkle');
eq(inboxIcon('/(client)/injuries'), 'heart', 'an injury ask is drawn as a heart');
eq(inboxIcon('/(owner)/dashboard'), 'bell', 'an unmapped route falls back to the bell');
eq(inboxIcon(null), 'bell', 'no route falls back to the bell');
eq(inboxIcon(''), 'bell', 'an empty route falls back to the bell');
// A prefix match must not fire on a longer screen name that merely starts the
// same way — '/(client)/calendarium' is not the calendar.
eq(inboxIcon('/(client)/calendar-archive'), 'bell', 'the icon map matches whole screen names, not prefixes of them');

// Every icon the map can yield has to be one the inbox is able to draw. This is
// a type-level fact made runtime-checkable, because the map is data.
const DRAWABLE: InboxIcon[] = ['bell', 'calendar', 'message', 'sparkle', 'heart', 'dumbbell', 'trophy'];
for (const p of KNOWN_PUSHES) {
  ok(DRAWABLE.includes(inboxIcon(p.route)), `${p.where} yields a drawable icon`);
}

/* ── where a stored row may send you ───────────────────────────────────── */

eq(safeRoute('/(client)/calendar', 'client'), '/(client)/calendar', 'a client row opens a client screen');
eq(safeRoute('/(trainer)/chat?clientId=abc', 'trainer'), '/(trainer)/chat?clientId=abc', 'a query string is allowed through');
eq(safeRoute('/(owner)/promotions', 'owner'), '/(owner)/promotions', 'an owner row opens an owner screen');
eq(safeRoute('/(client)/pt-sessions', 'client'), '/(client)/pt-sessions', 'a hyphenated screen name is a screen name');

// Cross-group. These three apps are three binaries and each contains only its
// own group; pushing another group's route navigates to a screen that is not in
// this bundle.
eq(safeRoute('/(trainer)/calendar', 'client'), null, 'the client app does not open a trainer screen');
eq(safeRoute('/(client)/calendar', 'trainer'), null, 'the coach app does not open a client screen');
eq(safeRoute('/(client)/calendar', 'owner'), null, 'the owner app does not open a client screen');

// Attacker-supplied. notify_users() caps the length of this string and checks
// nothing else about it, on purpose — the database is not where this app's list
// of screens belongs — so everything below arrives here for real.
eq(safeRoute('https://example.com', 'client'), null, 'a URL is not a route');
eq(safeRoute('//example.com', 'client'), null, 'a protocol-relative URL is not a route');
eq(safeRoute('javascript:alert(1)', 'client'), null, 'a javascript: URL is not a route');
eq(safeRoute('/(client)/../../elsewhere', 'client'), null, 'a traversal is not a route');
eq(safeRoute('/(client)/calendar/../settings', 'client'), null, 'a route with a second segment is refused');
eq(safeRoute('/(client)/calendar#frag', 'client'), null, 'a fragment is not part of a route we send');
eq(safeRoute('  /(client)/calendar  ', 'client'), '/(client)/calendar', 'surrounding whitespace is trimmed, not fatal');
eq(safeRoute('/(admin)/everything', 'client'), null, 'there is no fourth group');
eq(safeRoute('(client)/calendar', 'client'), null, 'a route must be absolute');
eq(safeRoute('', 'client'), null, 'an empty route opens nothing');
eq(safeRoute(null, 'client'), null, 'a null route opens nothing');
eq(safeRoute(undefined, 'client'), null, 'a missing route opens nothing');

// Every route the repo actually sends resolves for the group it is addressed
// to. A validator that refused them all would pass every test above.
for (const p of KNOWN_PUSHES) {
  if (!p.route) continue;
  const group = p.route.startsWith('/(client)') ? 'client' : p.route.startsWith('/(owner)') ? 'owner' : 'trainer';
  eq(safeRoute(p.route, group), p.route, `${p.route} from ${p.where} is a route this app will open`);
}

/* ── how old a row is ──────────────────────────────────────────────────── */

const T = Date.parse('2026-08-31T12:00:00.000Z');
const at = (ms: number) => new Date(T - ms).toISOString();

eq(inboxAge(at(0), T), 'Just now', 'a row written this instant is Just now');
eq(inboxAge(at(59_000), T), 'Just now', 'under a minute is Just now');
eq(inboxAge(at(60_000), T), '1m', 'a minute is 1m');
eq(inboxAge(at(59 * 60_000), T), '59m', 'fifty-nine minutes is still minutes');
eq(inboxAge(at(60 * 60_000), T), '1h', 'an hour is 1h');
eq(inboxAge(at(23 * 3_600_000), T), '23h', 'just under a day is still hours');
eq(inboxAge(at(24 * 3_600_000), T), '1d', 'a day is 1d');
eq(inboxAge(at(6 * 86_400_000), T), '6d', 'six days is still days');
eq(inboxAge(at(7 * 86_400_000), T), '1w', 'a week is 1w');
// Exactly a year. Pinned because the boundary is a `<` that reads equally well
// as a `<=`, and with `<=` this row would say "52w" — a real notification aged
// into a unit nobody counts in.
eq(inboxAge(at(365 * 86_400_000), T), '1y', 'a year to the day is 1y, not 52w');
eq(inboxAge(at(400 * 86_400_000), T), '1y', 'over a year is years');

// A row a few seconds in the future — the phone's clock against the server's —
// must not read "in 4 seconds".
eq(inboxAge(at(-4_000), T), 'Just now', 'clock skew reads as Just now, not as the future');
eq(inboxAge('not a date', T), '', 'an unparseable timestamp shows nothing rather than "NaN"');
eq(inboxAge(null, T), '', 'a missing timestamp shows nothing');

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
eq(unreadBadge(0, 'ready').kind, 'none', 'nothing unread and the server answered — no mark');
eq(unreadBadge(3, 'ready').kind, 'count', 'three unread over a whole read is a figure');
eq((unreadBadge(3, 'ready') as { label: string }).label, '3', 'the figure is the count');
eq((unreadBadge(11, 'ready') as { a11y: string }).a11y, 'Notifications. 11 unread.',
  'a screen reader is told the number, not just that there is a badge');

// A count of rows in a table with no ceiling. `1204` unseparated is the defect
// scripts/check-numbers.mjs exists for, and the bell is a place a sweep would
// miss because the value never appears in the JSX as a number.
eq((unreadBadge(1204, 'ready') as { label: string }).label, '1,204', 'four digits carry a separator');
eq((unreadBadge(12045, 'ready') as { label: string }).label, '12,045', 'five digits too');

// 'error': the only case where the answer is the same whatever is in hand. An
// empty cache and a cache with nine unread rows are both "we do not know".
eq(unreadBadge(0, 'error').kind, 'unknown', 'a failed read is NOT "no unread"');
eq(unreadBadge(9, 'error').kind, 'unknown', 'a stale cache is not a count either');
eq((unreadBadge(0, 'error') as { a11y: string }).a11y, 'Notifications. Unread count could not be read.',
  'the failure is spoken, not left to a silent bell');

// 'partial': the rows past the cap are the OLDEST, so zero unread among the
// newest is not zero unread. Neither branch prints a figure — a count over an
// unknown fraction of the set is what src/ui/loadStatus.ts forbids.
eq(unreadBadge(3, 'partial').kind, 'some', 'a truncated read shows a mark, not a number');
eq(unreadBadge(0, 'partial').kind, 'unknown', 'no unread in the newest rows is not no unread');
ok(!Object.prototype.hasOwnProperty.call(unreadBadge(3, 'partial'), 'label'),
  'nothing under partial carries a figure to render');

// 'loading': the first read is in flight and a cached copy may already be on
// screen. Drawing a figure from it means printing a number and changing it a
// moment later.
eq(unreadBadge(5, 'loading').kind, 'none', 'nothing is claimed before the first read lands');
eq(unreadBadge(0, 'loading').kind, 'none', 'including when the cache is empty');

// The count arrives from `items.filter(…).length` today, but this is a public
// function and a wrong number must not reach a badge as "NaN" or "-1".
eq(unreadBadge(-1, 'ready').kind, 'none', 'a negative count is not a badge');
eq(unreadBadge(Number.NaN, 'ready').kind, 'none', 'NaN is not a badge');
eq((unreadBadge(3.7, 'ready') as { label: string }).label, '3', 'a fractional count is floored, not rounded up');

// Whatever the status, a mark that is drawn is a mark that can be spoken, and
// no mark ever renders a raw unseparated four-digit number.
const STATUSES: LoadStatus[] = ['loading', 'ready', 'partial', 'error'];
for (const st of STATUSES) {
  for (const n of [0, 1, 11, 999, 1000, 1204, 99999]) {
    const b = unreadBadge(n, st);
    if (b.kind === 'none') continue;
    ok(typeof (b as { a11y: string }).a11y === 'string' && (b as { a11y: string }).a11y.length > 0,
      `${st}/${n}: a drawn mark says what it means`);
    if (b.kind === 'count') ok(!/^\d{4,}$/.test(b.label), `${st}/${n}: “${b.label}” carries its separator`);
  }
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`notifyInbox: ok (${KNOWN_PUSHES.length} pushes classified, ${KNOWN_PUSHES.filter((p) => inboxDecision(p.title, p.body, p.route).record).length} recorded)`);
