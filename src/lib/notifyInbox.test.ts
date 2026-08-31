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
  KNOWN_PUSHES, inboxAge, inboxDecision, inboxIcon, inboxHeading, safeRoute, unreadBadge,
  inboxControls, clearReadPrompt, deletedNote, clearedNote, type InboxIcon,
} from './notifyInbox';
import { writeFailure } from './wroteRows';
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
ok(KNOWN_PUSHES.length >= 19, 'the catalogue still lists every push in the repo');
ok(byTitle('Session cancelled').length === 2, 'both cancellation pushes are listed — the coach one and the client one');
ok(byTitle('The slot you were waiting for is yours').length === 2,
  'both waitlist promotions are listed — the coach cancelling and the client cancelling send the same news');
// Seven of the nineteen: four that route to a chat thread (two from
// messaging.ts, one from the coach's broadcast, one from the coach's nudge, all
// four already written by part 26), two slot races, and one read receipt.
// Stated as a total so that a rule which starts dropping something it did not
// drop before fails here rather than quietly emptying somebody's inbox.
//
// The three added when the notice fan-out and the invoice notification were
// built are all on the recorded side, which is the whole point of them: they
// are the kinds nothing else in the product tells anybody about.
eq(KNOWN_PUSHES.filter((p) => !inboxDecision(p.title, p.body, p.route).record).length, 7,
  'seven of the nineteen pushes are deliberately not recorded');
eq(KNOWN_PUSHES.filter((p) => inboxDecision(p.title, p.body, p.route).record).length, 12,
  'the other twelve are');

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
// Both of these drew the generic bell until the routes were mapped. The bell is
// the fallback for "nothing here recognises this route", so a real kind wearing
// it is a row that looks unclassified in a list where every neighbour is.
eq(inboxIcon('/(client)/intake'), 'pencil', 'an intake ask is drawn as something to fill in');
eq(inboxIcon('/(client)/notices'), 'info', 'a notice from a gym or a coach is drawn as a notice');
eq(inboxIcon('/(owner)/dashboard'), 'bell', 'an unmapped route falls back to the bell');
eq(inboxIcon(null), 'bell', 'no route falls back to the bell');
eq(inboxIcon(''), 'bell', 'an empty route falls back to the bell');
// A prefix match must not fire on a longer screen name that merely starts the
// same way — '/(client)/calendarium' is not the calendar.
eq(inboxIcon('/(client)/calendar-archive'), 'bell', 'the icon map matches whole screen names, not prefixes of them');

// Every icon the map can yield has to be one the inbox is able to draw. This is
// a type-level fact made runtime-checkable, because the map is data.
const DRAWABLE: InboxIcon[] = ['bell', 'calendar', 'message', 'sparkle', 'heart', 'dumbbell', 'trophy', 'info', 'pencil'];
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

/* ── the heading a row is drawn with ────────────────────────────────────────
 *
 * The defect: `notifications.title` is nullable and the inbox drew
 * `item.title ?? f.title`, where `f.title` is the SCREEN's own name. Two rows
 * in production render right now as a heading reading "Notifications" over a
 * body reading "third rep", on a screen called Notifications. It does not look
 * like a missing heading — it looks like a real one that says nothing.
 */

eq(inboxHeading('Session cancelled', 'calendar'), 'Session cancelled', 'a row with a heading keeps it');
eq(inboxHeading('  Session cancelled  ', 'calendar'), 'Session cancelled', 'a heading is trimmed, not rejected');

// The one untitled kind that is actually known. Every title-less row in this
// table was written by notify-message after a chat message, which is what its
// icon records, so this is a true sentence about it and not a guess.
eq(inboxHeading(null, 'message'), 'New message', 'an untitled chat row says what it is');
eq(inboxHeading('', 'message'), 'New message', 'an empty title is no title');
eq(inboxHeading('   ', 'message'), 'New message', 'a whitespace title is no title');
eq(inboxHeading(undefined, 'message'), 'New message', 'a missing title is no title');

// Everything else draws no heading rather than an invented one. "Session
// update" over a cancellation is a worse lie than silence, because it is
// plausible enough to be believed.
eq(inboxHeading(null, 'calendar'), null, 'an untitled calendar row is not given a guessed heading');
eq(inboxHeading(null, 'bell'), null, 'an untitled unclassified row draws no heading');
eq(inboxHeading(null, 'sparkle'), null, 'an untitled offer draws no heading');
eq(inboxHeading(null, 'pencil'), null, 'an untitled intake ask draws no heading');

// The actual regression guard: whatever this returns, it is never the name of
// the screen it is drawn on. All three apps call that screen "Notifications".
const EVERY_ICON: InboxIcon[] = ['bell', 'calendar', 'message', 'sparkle', 'heart', 'dumbbell', 'trophy', 'info', 'pencil'];
for (const ic of EVERY_ICON) {
  const h = inboxHeading(null, ic);
  ok(h !== 'Notifications', `an untitled ${ic} row does not borrow the screen's name`);
  ok(h === null || h.length > 0, `an untitled ${ic} row draws a real heading or none at all`);
}
// And a row that genuinely IS titled "Notifications" keeps it — the rule is
// about the fallback, not about censoring a word.
eq(inboxHeading('Notifications', 'bell'), 'Notifications', 'a real heading is never second-guessed');

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
eq(inboxControls('ready').rowDelete, true, 'a confirmed list can have a row removed');
eq(inboxControls('ready').markUnread, true, 'a confirmed list can have a row put back to unread');
eq(inboxControls('ready').clearRead, true, 'a confirmed list can be cleared of read rows');
eq(inboxControls('ready').withheld, null, 'nothing is withheld over a confirmed list, so nothing is explained');

// 'error' — the list is a cached copy of unknown age and an empty one means
// "could not be read". A row vanishing from a screen that already says it is
// unconfirmed would be the app inventing a fact.
eq(inboxControls('error').rowDelete, false, 'nothing is deleted over a list the server did not confirm');
eq(inboxControls('error').markUnread, false, 'nor is read state changed over one');
eq(inboxControls('error').clearRead, false, 'and certainly not in bulk');
ok((inboxControls('error').withheld ?? '').length > 0, 'the reason the controls are gone is said, not left to be noticed');

// 'partial' — the rows are real but they are a prefix. Per-row removal is fine:
// each row named came back from the server in THIS read. Clear Read is not:
// the statement would sweep rows past the cap while the confirmation could only
// count the ones on screen.
eq(inboxControls('partial').rowDelete, true, 'a row that came back in a truncated read is still a row we read');
eq(inboxControls('partial').markUnread, true, 'so its read state can be changed too');
eq(inboxControls('partial').clearRead, false, 'a bulk delete over a prefix would remove what it could not count');
ok((inboxControls('partial').withheld ?? '').length > 0, 'and the screen says why the bulk control is missing');

// 'loading' — nothing has come back. Anything on screen is a cache and there is
// nothing established to destroy.
eq(inboxControls('loading').rowDelete, false, 'nothing is destroyed before the first read lands');
eq(inboxControls('loading').clearRead, false, 'including in bulk');
eq(inboxControls('loading').withheld, null, 'and no explanation is owed for a control that is about to appear');

// The rule that matters most, stated over the whole type rather than status by
// status: 'ready' is the ONLY status that may clear in bulk. Written this way
// so that a fifth LoadStatus, or a reordered branch that falls through to the
// permissive default, fails here rather than shipping a bulk delete over a set
// nobody has all of.
for (const st of STATUSES) {
  eq(inboxControls(st).clearRead, st === 'ready', `${st}: bulk clearing is offered only over a whole, confirmed list`);
  if (!inboxControls(st).rowDelete) {
    eq(inboxControls(st).markUnread, false, `${st}: a list too uncertain to delete from is too uncertain to re-mark`);
  }
}

/* ── the confirmation for Clear Read ────────────────────────────────────── */

// The button and its confirmation come from one function, so they cannot come
// apart: no prompt means no button.
eq(clearReadPrompt(4, 'partial'), null, 'no bulk prompt over a truncated read');
eq(clearReadPrompt(4, 'error'), null, 'no bulk prompt over a failed read');
eq(clearReadPrompt(4, 'loading'), null, 'no bulk prompt before the first read lands');
eq(clearReadPrompt(0, 'ready'), null, 'nothing marked read means nothing to offer');
eq(clearReadPrompt(-3, 'ready'), null, 'a negative count offers nothing');
eq(clearReadPrompt(Number.NaN, 'ready'), null, 'NaN offers nothing');

const p4 = clearReadPrompt(4, 'ready')!;
ok(p4 != null, 'four read notifications over a confirmed list can be cleared');
eq(p4.title, 'Delete 4 read notifications?', 'the confirmation names the figure');
ok(/unread stays/i.test(p4.message), 'and says what it does NOT touch, which is the fear the control raises');
ok(/for good/i.test(p4.message), 'and that it is irreversible, because it is');

const p1 = clearReadPrompt(1, 'ready')!;
eq(p1.title, 'Delete the read notification?', 'one row is not "1 read notifications"');
eq(p1.confirm, 'Delete', 'and its button is singular too');

// A count of rows in a table with no ceiling. `1204 read notifications` is the
// defect scripts/check-numbers.mjs exists for, and a confirmation dialog is
// exactly the place an unseparated figure gets approved without being read.
ok(clearReadPrompt(1204, 'ready')!.title.includes('1,204'), 'four digits in a confirmation carry a separator');
ok(clearReadPrompt(12045, 'ready')!.title.includes('12,045'), 'five digits too');
ok(!/\d{4,}/.test(clearReadPrompt(1204, 'ready')!.title), 'and no unseparated run of digits survives anywhere in it');

// House style: Title Case for a button, sentence case for the sentence.
for (const n of [1, 2, 40, 1204]) {
  const p = clearReadPrompt(n, 'ready')!;
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

eq(deletedNote('Session cancelled', null), null, 'a delete that worked needs no announcement — the row is gone');

// The three ways a single delete fails, through the real writeFailure so the
// wording cannot drift from src/lib/wroteRows.ts.
const refused = deletedNote('Session cancelled', writeFailure('This notification', { error: new Error('nope') }))!;
ok(refused.startsWith('Session cancelled is still in your inbox.'), 'a refused delete names the row and says it is still there');

const uncounted = deletedNote('Session cancelled', writeFailure('This notification', { error: null, count: null }))!;
ok(/did not say whether/.test(uncounted), 'a delete nobody counted is reported as uncounted, not as done');

const nomatch = deletedNote('Session cancelled', writeFailure('This notification', { error: null, count: 0 }))!;
ok(/matched no rows/.test(nomatch), 'zero rows is reported as zero rows');
ok(/still in your inbox/.test(nomatch), 'and the reader is told the row did not go anywhere');

// The one that must never happen: a count of 1 is a real deletion and produces
// no failure sentence at all.
eq(writeFailure('This notification', { error: null, count: 1 }), null, 'one row deleted is a delete that happened');

/* ── and after Clear Read ───────────────────────────────────────────────── */

// Three outcomes, three sentences. The middle one is the one that gets written
// as "Done" everywhere else and is the reason the count is asked for.
ok(/did not answer/.test(clearedNote(false, 0)), 'a failed clear says the server did not answer');
ok(/unchanged/.test(clearedNote(false, 0)), 'and that the inbox is unchanged');
// A failure that somehow carries a count is still a failure. Ordering the `ok`
// check first is what makes that true, and this is the assertion that pins it.
ok(/did not answer/.test(clearedNote(false, 9)), 'a count on a failed call does not turn it into a success');

ok(/Nothing was deleted/.test(clearedNote(true, 0)), 'a clear that matched nothing says so');
ok(/nothing marked read/.test(clearedNote(true, 0)), 'and says why, rather than reading as a failure');
eq(clearedNote(true, 1), 'One read notification deleted.', 'one row is not "1 read notifications deleted"');
eq(clearedNote(true, 4), '4 read notifications deleted.', 'four rows are counted');
eq(clearedNote(true, 1204), '1,204 read notifications deleted.', 'and a four-digit count carries its separator');
for (const n of [0, 1, 4, 999, 1204, 99999]) {
  ok(!/\d{4,}/.test(clearedNote(true, n)), `${n}: no unseparated run of digits reaches the reader`);
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
  type Row = { read: boolean };
  const rows: Row[] = [{ read: false }, { read: false }, { read: true }, { read: false }];
  const mark = (rs: Row[]) => unreadBadge(rs.filter((r) => !r.read).length, 'ready');
  eq((mark(rows) as { label: string }).label, '3', 'three unread to begin with');
  // Delete one unread row.
  eq((mark(rows.slice(1)) as { label: string }).label, '2', 'deleting an unread row lowers the bell by one');
  // Delete the read one: the figure does not move.
  eq((mark(rows.filter((_, i) => i !== 2)) as { label: string }).label, '3', 'deleting a read row does not move the bell');
  // Put the read one back to unread.
  eq((mark(rows.map((r, i) => (i === 2 ? { read: false } : r))) as { label: string }).label, '4',
    'marking a row unread raises the bell by one');
  // Clear Read removes every read row and touches no unread one.
  eq((mark(rows.filter((r) => !r.read)) as { label: string }).label, '3', 'clearing read rows leaves the unread count alone');
  // And the empty inbox after everything is deleted draws no mark — under
  // 'ready', where that is a true statement.
  eq(mark([]).kind, 'none', 'an inbox emptied by hand shows no mark');
  // But the same empty list under 'error' still does not say "none".
  eq(unreadBadge(0, 'error').kind, 'unknown', 'an empty inbox under a failed read is still not "you have none"');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`notifyInbox: ok (${KNOWN_PUSHES.length} pushes classified, ${KNOWN_PUSHES.filter((p) => inboxDecision(p.title, p.body, p.route).record).length} recorded)`);
