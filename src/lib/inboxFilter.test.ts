// Tests for inboxFilter — narrowing the notification inbox without lying about
// what the narrowing took away.
//
// There are three defects these exist to hold shut, and only the first is the
// feature:
//
//  1. THE KINDS ARE NOT THE ICONS. `ICON_BY_ROUTE` in src/lib/notifyInbox.ts
//     maps fifty routes onto eleven icons and several of those icons are
//     deliberate collisions — 'trophy' is an achievement AND a declined card,
//     'info' is a gym invoice AND a noticeboard. Promoting any of them to a
//     named category files a failed payment under a word that sounds like a
//     prize. Only 'calendar' and 'message' survive that promotion, and the
//     assertions below walk every icon in `InboxIcon` so that adding a twelfth
//     one cannot quietly join a category it does not belong to.
//
//  2. A FILTER MUST NOT HIDE SOMETHING SILENTLY. The inbox subscribes to
//     realtime INSERTs, so a cancellation can arrive while somebody is standing
//     in a chip that excludes it. `hiddenUnread` is what stops that being
//     invisible, and the sentence it produces is asserted here under all four
//     statuses, because the case that matters most is the one where the read
//     also failed.
//
//  3. A COUNT BESIDE A CHIP IS A CLAIM. Under 'partial' the rows in hand are a
//     prefix of the newest (src/lib/rowCap.ts) and under 'error' they are a
//     cache of unknown age. Neither may print a figure as though it were a
//     total. Every chip label is checked for digits under those statuses.
//
// Compile with tsc then run with node, like threadFilter.test.ts.
import {
  NO_INBOX_FILTER, bulkOffWhileFiltered, filterInbox, hiddenUnread, inboxChips,
  inboxFilterActive, inboxFilterLine, inboxKind, keptBy,
  type FilterableRow, type InboxMode,
} from './inboxFilter';
import type { InboxIcon } from './notifyInbox';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ALL: LoadStatus[] = ['loading', 'ready', 'partial', 'error'];
const MODES: InboxMode[] = ['all', 'unread', 'session', 'message'];

/* ── 1 · the kinds, and every icon that is not one ───────────────────────── */

// The whole of `InboxIcon`, written out. A new icon added to that union without
// a line here fails to compile, which is the point: the decision about which
// bucket it falls into is made once, in the open, rather than by whichever
// branch of `inboxKind` happens to catch it.
const EVERY_ICON: Record<InboxIcon, true> = {
  bell: true, calendar: true, message: true, sparkle: true, heart: true,
  dumbbell: true, trophy: true, info: true, pencil: true, people: true, grid: true,
};
const ICONS = Object.keys(EVERY_ICON) as InboxIcon[];

eq(inboxKind('calendar'), 'session', 'a calendar row is a session — the seven routes that map to it are all an hour in a diary');
eq(inboxKind('message'), 'message', 'a message row is somebody writing to you');
for (const icon of ICONS) {
  if (icon === 'calendar' || icon === 'message') continue;
  eq(inboxKind(icon), 'other', `'${icon}' is deliberately uncategorised — no true sentence names what it is`);
}
// Named individually as well as swept, because these three are the ones a
// future reader will be tempted by and the comments in notifyInbox.ts are the
// reason not to.
eq(inboxKind('trophy'), 'other', "'trophy' is an achievement AND a declined card — /(client)/packages is where a failed payment sends a member");
eq(inboxKind('info'), 'other', "'info' is a gym invoice AND a noticeboard, which notifyInbox.ts admits is a real cost");
eq(inboxKind('heart'), 'other', "'heart' is an injury AND a progress photo");

/* ── the rows the rest of this file is about ─────────────────────────────── */

const row = (o: Partial<FilterableRow> & { id: string }): FilterableRow & { id: string } =>
  ({ read: false, kind: 'other', ...o });

const newSession = row({ id: 'moved', kind: 'session', read: false });
const oldSession = row({ id: 'booked', kind: 'session', read: true });
const newMessage = row({ id: 'chat', kind: 'message', read: false });
const oldOther = row({ id: 'review', kind: 'other', read: true });
const INBOX = [newSession, oldSession, newMessage, oldOther];

/* ── 2 · nothing is a filter until somebody presses it ───────────────────── */

ok(!inboxFilterActive(NO_INBOX_FILTER), 'the screen opens narrowing nothing');
eq(NO_INBOX_FILTER, 'all', 'and All is what the escape hatch returns to');
for (const m of MODES) {
  eq(inboxFilterActive(m), m !== 'all', `'${m}' narrows exactly when it is not All`);
}
eq(filterInbox(INBOX, 'all').length, INBOX.length, 'All keeps everything');
eq(inboxFilterLine({ status: 'error', mode: 'all', matched: 0, searched: 0, hidden: 0 }), null,
  'and an untouched list owes no explanation, even when the read failed — the screen’s own Notice says that');
eq(hiddenUnread(INBOX, 'all'), 0, 'and nothing can be hidden by a filter that is off');
eq(bulkOffWhileFiltered('all', true), null, 'and the bulk controls stay where they are');

/* ── 3 · what each chip actually keeps ───────────────────────────────────── */

eq(filterInbox(INBOX, 'unread').map((r) => (r as any).id).join(','), 'moved,chat',
  'Unread keeps the two nobody has opened, whatever they are about');
eq(filterInbox(INBOX, 'session').map((r) => (r as any).id).join(','), 'moved,booked',
  'Sessions keeps both session rows, read or not — a chip is a subject, not a state');
eq(filterInbox(INBOX, 'message').map((r) => (r as any).id).join(','), 'chat',
  'Messages keeps the message');
ok(keptBy('unread', newSession) && !keptBy('unread', oldSession),
  'and the single decision the rest is built on says the same thing on its own');

// The order is the caller's. The read is newest-first and a filter that also
// sorted would move a row under somebody's thumb between renders.
{
  const shown = filterInbox([oldSession, newSession], 'session').map((r) => (r as any).id);
  eq(shown.join(','), 'booked,moved', 'the filter never re-ranks — the order in is the order out');
}

/* ── 4 · the sentence that is the whole safety property ──────────────────── */

eq(hiddenUnread(INBOX, 'session'), 1, 'the unread message is hidden by the Sessions chip, and is counted');
eq(hiddenUnread(INBOX, 'message'), 1, 'and the unread session is hidden by the Messages chip');
eq(hiddenUnread(INBOX, 'unread'), 0, 'Unread cannot hide an unread row, by construction');

{
  // The case this feature could have shipped broken: a chip left on from
  // yesterday, a cancellation arriving over realtime that it excludes.
  const line = inboxFilterLine({ status: 'ready', mode: 'message', matched: 1, searched: 4, hidden: 1 }) ?? '';
  ok(/One unread notification is hidden by this filter\./.test(line),
    'a narrowed list says out loud that it is holding an unread row back');
}
{
  const line = inboxFilterLine({ status: 'ready', mode: 'session', matched: 2, searched: 9, hidden: 3 }) ?? '';
  ok(/3 unread notifications are hidden by this filter\./.test(line), 'and says how many when there is more than one');
  ok(!/At least/.test(line), 'exactly, under a whole read');
}
for (const status of ALL) {
  const line = inboxFilterLine({ status, mode: 'session', matched: 1, searched: 4, hidden: 2 }) ?? '';
  ok(/unread notifications are hidden by this filter/.test(line),
    `the hidden-unread sentence survives '${status}' — under 'error' most of all, since those rows are real rows from a cache`);
  if (status !== 'ready') {
    ok(/At least 2 unread/.test(line),
      `and hedges the figure under '${status}', where the rows in hand are not the whole set`);
  }
}

/* ── 5 · an absence may be stated under 'ready' and under nothing else ───── */

{
  const line = inboxFilterLine({ status: 'ready', mode: 'unread', matched: 0, searched: 6, hidden: 0 }) ?? '';
  ok(/Nothing is unread/.test(line), 'an empty unread list is good news, said as good news');
  ok(!/could not/.test(line), 'and is never the read having failed');
}
eq(inboxFilterLine({ status: 'ready', mode: 'session', matched: 0, searched: 6, hidden: 0 }),
  'Nothing in your inbox is about a session or a class.',
  'each chip gets its own absence, because a reader acts on them differently');
eq(inboxFilterLine({ status: 'ready', mode: 'message', matched: 0, searched: 6, hidden: 0 }),
  'Nothing in your inbox is somebody writing to you.',
  'and the message one does not say "no messages", which a member would read as their chat being empty');

for (const status of ALL) {
  if (status === 'ready') continue;
  const line = inboxFilterLine({ status, mode: 'session', matched: 0, searched: 3, hidden: 0 }) ?? '';
  ok(!/Nothing in your inbox/.test(line),
    `'${status}' never states an absence — "nothing matches" over a read that did not land is the sentence loadStatus.ts exists to stop`);
}
{
  const line = inboxFilterLine({ status: 'error', mode: 'session', matched: 0, searched: 3, hidden: 0 }) ?? '';
  ok(/could not be confirmed/.test(line), 'under error it says the list is the last copy on this phone');
  ok(!/could not be read/.test(line),
    'and deliberately not the screen’s own sentence for an unreadable inbox — a filtered empty state must not do that one’s job');
  const partial = inboxFilterLine({ status: 'partial', mode: 'session', matched: 1, searched: 1, hidden: 0 }) ?? '';
  ok(/the one notification that arrived/.test(partial), 'a truncated read says what it actually looked at, singular and all');
}

/* ── 6 · chips: which exist, and which may carry a figure ────────────────── */

{
  const chips = inboxChips(INBOX, 'all', 'ready');
  eq(chips.map((c) => c.mode).join(','), 'all,unread,session,message', 'a mixed inbox offers all four, in a fixed order');
  eq(chips[1].label, 'Unread · 2', 'and a whole read may put the figure on the chip');
  eq(chips[2].label, 'Sessions · 2', 'for every kind');
}
{
  // The owner inbox, which the owner route file itself calls the quiet one.
  const chips = inboxChips([oldOther], 'all', 'ready');
  eq(chips.length, 0, 'an inbox with nothing filterable in it offers no chips at all, rather than three dead controls');
  eq(inboxChips([], 'all', 'ready').length, 0, 'and neither does an empty one');
}
{
  // A coach with bookings and no enquiries: Sessions, no Messages.
  const chips = inboxChips([newSession, oldSession], 'all', 'ready');
  eq(chips.map((c) => c.mode).join(','), 'all,unread,session',
    'a chip is only offered for a kind the rows in hand actually contain');
}
{
  // Marking the last unread row read while standing in Unread must not take the
  // lit chip out from under the reader.
  const chips = inboxChips([oldSession, oldOther], 'unread', 'ready');
  ok(chips.some((c) => c.mode === 'unread'), 'the selected chip is always drawn, even once nothing matches it');
  eq(chips.find((c) => c.mode === 'unread')?.label, 'Unread',
    'and it never reads "Unread · 0" — a confident zero at the moment the screen has least right to one');
}
for (const status of ALL) {
  if (status === 'ready') continue;
  for (const c of inboxChips(INBOX, 'all', status)) {
    ok(!/\d/.test(c.label), `no chip carries a figure under '${status}' — a prefix or a cache is a floor, not a total`);
    ok(c.mode === 'all' || /not your whole inbox/.test(c.a11y),
      `and '${status}' says in the spoken label why the number is missing, rather than leaving it unexplained`);
  }
}
for (const c of inboxChips(INBOX, 'all', 'ready')) {
  ok(c.a11y.trim().length > 0, 'every chip has a spoken name — the accessibility gate is at zero offences');
  ok(c.a11y !== c.label, 'and it is a sentence, not the label read back');
}

/* ── 7 · the bulk controls, which are scoped by predicate and not by sight ─ */

for (const m of MODES) {
  const note = bulkOffWhileFiltered(m, true);
  if (m === 'all') { eq(note, null, 'nothing is withheld while nothing is filtered'); continue; }
  ok(note !== null && /whole inbox/.test(note),
    `'${m}' withholds them, because mark_notifications_read() takes everything unread and not what is on screen`);
  ok(note !== null && /Press All/.test(note),
    'and says the way back — a control that silently disappears reads as a bug');
}
eq(bulkOffWhileFiltered('unread', false), null,
  'and there is nothing to explain when there was no control to withhold');

if (errors.length) {
  console.error(`inboxFilter.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('inboxFilter.test: all good');
