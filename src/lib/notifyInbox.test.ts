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
  KNOWN_PUSHES, inboxAge, inboxDecision, inboxIcon, safeRoute, type InboxIcon,
} from './notifyInbox';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── every push this repository sends today ────────────────────────────────
 *
 * Stated one at a time rather than derived, so that changing the intent of one
 * of them is an edit somebody has to make here and can be asked about.
 */

const byTitle = (title: string) => KNOWN_PUSHES.filter((p) => p.title === title);

// Recorded: the five kinds a person who missed the banner has no other way to
// learn about.
for (const p of KNOWN_PUSHES.filter((x) => ['Session booked', 'Session cancelled', 'A new offer', 'New booking', 'Your coach asked about an injury'].includes(x.title))) {
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
ok(KNOWN_PUSHES.length >= 12, 'the catalogue still lists every push in the repo');
ok(byTitle('Session cancelled').length === 2, 'both cancellation pushes are listed — the coach one and the client one');
// Six of the twelve: three that route to a chat thread (two from messaging.ts,
// one from the coach's broadcast, all three already written by part 26), two
// slot races, and one read receipt. Stated as a total so that a rule which
// starts dropping something it did not drop before fails here rather than
// quietly emptying somebody's inbox.
eq(KNOWN_PUSHES.filter((p) => !inboxDecision(p.title, p.body, p.route).record).length, 6,
  'six of the twelve pushes are deliberately not recorded');
eq(KNOWN_PUSHES.filter((p) => inboxDecision(p.title, p.body, p.route).record).length, 6,
  'the other six are');

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

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`notifyInbox: ok (${KNOWN_PUSHES.length} pushes classified, ${KNOWN_PUSHES.filter((p) => inboxDecision(p.title, p.body, p.route).record).length} recorded)`);
