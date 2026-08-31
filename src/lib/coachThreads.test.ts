// The coach's message list — which clients get a row, what the row says, and
// what an empty list is allowed to claim.
// Compile with tsc, run with node.
//
// The defects these assertions are aimed at, in the order they would hurt:
//
//   1. A COUNT THAT DID NOT COME BACK RENDERED AS ZERO. `Number(null)` is 0,
//      and supabase-js hands back nulls for a join that produced nothing. A
//      coach reading "0" on the one screen that exists to say who is waiting
//      stops looking. supabase/parts/88 was written because the roster had this
//      exact bug as a hardcoded literal; it must not come back through a cast.
//
//   2. AN EMPTY LIST UNDER A FAILED READ SAYING "no conversations yet". Same
//      class, worse blast radius: the client who wrote that morning is waiting
//      on a reply their coach has been told does not exist.
//
//   3. A PHOTOGRAPH PREVIEWING AS A BLANK LINE. A message whose only content is
//      an attachment has an empty `body`, so a preview that prints the body
//      renders a thread with something in it as a thread with nothing in it.
//
//   4. THE LIST REORDERING ITSELF ON A FAILURE. Sorting on `unread` would put a
//      nullable value in the ORDER BY; recency is the only key that is known
//      whenever a thread is.
import {
  hasConversation, rowToThread, sortThreads, sortUnstarted, splitThreads,
  threadPreview, threadWhen, threadsEmptyNote, unreadBadgeLabel,
  type CoachThread,
} from './coachThreads';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A thread with everything defaulted to "nothing came back", so each test
 *  states only the field it is about. */
const thread = (over: Partial<CoachThread> = {}): CoachThread => ({
  clientId: 'c1', name: 'Sam Rivera', avatar: null,
  lastBody: null, lastSender: null, lastKind: null, lastAt: null, unread: null,
  ...over,
});

/* ── 1 · parsing a server row ──────────────────────────────────────────────
 *
 * The row arrives from `coach_threads()` through supabase-js, so every field is
 * `any` and the nulls are real.
 */
{
  const r = rowToThread({
    client_id: '759c8d25-4d50-4a5c-bdb5-806bcad18ac1',
    name: '  Sam Rivera  ', avatar: ' https://example.test/a.jpg ',
    last_body: ' Test test ', last_sender: 'client', last_kind: null,
    last_at: '2026-08-31T20:13:44.492371+00:00', unread: 3,
  });
  eq(r.clientId, '759c8d25-4d50-4a5c-bdb5-806bcad18ac1', 'the thread key is the client id');
  eq(r.name, 'Sam Rivera', 'a name is trimmed');
  eq(r.avatar, 'https://example.test/a.jpg', 'an avatar is trimmed');
  eq(r.lastBody, 'Test test', 'a body is trimmed');
  eq(r.lastSender, 'client', 'the sender comes through');
  eq(r.unread, 3, 'a real count comes through');
}

// Both halves of the narrowing, stated positively as well as negatively. A
// narrowing written as `=== 'image' && === 'video'` is never true and would
// null every attachment in the app, which the negative assertions below cannot
// see because they only ever check for null.
eq(rowToThread({ client_id: 'c1', last_kind: 'image' }).lastKind, 'image', 'an image comes through as an image');
eq(rowToThread({ client_id: 'c1', last_kind: 'video' }).lastKind, 'video', 'a video comes through as a video');
eq(rowToThread({ client_id: 'c1', last_sender: 'coach' }).lastSender, 'coach', 'the coach side comes through');
// Values that are not numbers must not be coerced into one. The global
// `isFinite('3')` is true; `Number.isFinite('3')` is not, and a count that
// arrived as a string is a count we did not read.
eq(rowToThread({ client_id: 'c1', unread: '3' }).unread, null, 'a count that arrived as a string is not a count');
eq(rowToThread({ client_id: 'c1', unread: 2.7 }).unread, 2, 'a fractional count is truncated, not rounded up into a message nobody sent');

// THE ONE THAT MATTERS. A null count is not zero.
{
  const r = rowToThread({ client_id: 'c1', unread: null });
  eq(r.unread, null, 'an unread count that did not come back is null, never 0');
  eq(unreadBadgeLabel(r.unread), '—', 'and it draws a dash, which is not a claim that nobody is waiting');
}
{
  const r = rowToThread({ client_id: 'c1', unread: 0 });
  eq(r.unread, 0, 'a count of zero that DID come back is zero');
  eq(unreadBadgeLabel(r.unread), null, 'and draws no badge at all');
}
eq(unreadBadgeLabel(1), '1', 'one unread message');
eq(unreadBadgeLabel(99), '99', 'ninety-nine fit');
eq(unreadBadgeLabel(100), '99+', 'past that the badge caps in text');
eq(unreadBadgeLabel(-2), null, 'a negative count is not a badge');

// A blank name is not a name. Returning '' would draw an empty circle where a
// monogram goes, which reads as a face that failed to load rather than as a
// client whose name we could not read.
{
  const r = rowToThread({ client_id: 'c1', name: '   ', avatar: '' });
  eq(r.name, null, 'a whitespace-only name is null');
  eq(r.avatar, null, 'an empty avatar is null');
}

// A value this build does not know is null, not a cast. `last_kind: 'audio'`
// would otherwise reach KIND_NOUN and preview as `undefined`.
{
  const r = rowToThread({ client_id: 'c1', last_sender: 'system', last_kind: 'audio' });
  eq(r.lastSender, null, 'a sender this build does not know is null');
  eq(r.lastKind, null, 'an attachment kind this build does not know is null');
}

/* ── 2 · which clients have a conversation ─────────────────────────────── */

ok(!hasConversation(thread()), 'a client with no last message has no conversation');
ok(hasConversation(thread({ lastAt: '2026-08-31T20:13:44Z', lastBody: 'hi' })), 'a client with a last message has one');
// The TIMESTAMP is the test, not the body — a photo with no caption is still a
// conversation, and this is the assertion that stops somebody "simplifying"
// this to a body check.
ok(hasConversation(thread({ lastAt: '2026-08-31T20:13:44Z', lastKind: 'image' })),
  'a photo with no caption is still a conversation');
ok(!hasConversation(thread({ lastAt: 'not a date' })), 'an unparseable timestamp is not a conversation');

/* ── 3 · the order ─────────────────────────────────────────────────────── */
{
  const rows = [
    thread({ clientId: 'old', lastAt: '2026-08-28T09:41:33Z', lastBody: 'Hello test', unread: 9 }),
    thread({ clientId: 'new', lastAt: '2026-08-31T20:13:44Z', lastBody: 'Test test', unread: 0 }),
    thread({ clientId: 'mid', lastAt: '2026-08-31T14:41:11Z', lastBody: 'Test test test', unread: null }),
  ];
  eq(sortThreads(rows).map((t) => t.clientId).join(','), 'new,mid,old', 'most recent first');
  // The alternative, refused. `old` has nine unread and still sorts last: the
  // order does not consult a value that can be null, so a failed unread join
  // cannot silently reshuffle the list.
  ok(sortThreads(rows)[0].clientId !== 'old', 'the unread count does not reorder anybody');
  // Total order on ties, so two messages in the same millisecond do not swap
  // places between renders. FOUR of them, reversed: a two-element list can be
  // put in order by a comparator that is wrong in every other case, because
  // there is only one comparison to get right.
  const tied = ['d', 'c', 'b', 'a'].map((id) =>
    thread({ clientId: id, lastAt: '2026-08-31T20:13:44Z', lastBody: 'x' }));
  eq(sortThreads(tied).map((t) => t.clientId).join(','), 'a,b,c,d', 'a tie breaks on the client id, stably');
  // Same list, already in order. A comparator that never returns 0 for equal
  // ids passes the reversed case and fails this one.
  const already = ['a', 'b', 'c', 'd'].map((id) =>
    thread({ clientId: id, lastAt: '2026-08-31T20:13:44Z', lastBody: 'x' }));
  eq(sortThreads(already).map((t) => t.clientId).join(','), 'a,b,c,d', 'and an ordered list is left alone');
  // Not mutated in place: the hook holds this array and React compares it.
  eq(rows[0].clientId, 'old', 'sortThreads does not reorder its input');
}
{
  const rows = [
    thread({ clientId: 'c5', name: null }),
    thread({ clientId: 'c2', name: 'zoe' }),
    thread({ clientId: 'c4', name: null }),
    thread({ clientId: 'c1', name: 'Alice' }),
    thread({ clientId: 'c3', name: 'Mo' }),
  ];
  // TWO unnamed rows, not one: with a single unnamed row at the end, a
  // comparator that reports "equal" instead of "after" for the named/unnamed
  // pair still happens to produce the right list.
  eq(sortUnstarted(rows).map((t) => t.clientId).join(','), 'c1,c3,c2,c4,c5',
    'unstarted threads go by name, case-insensitively, with the unnameable last');
  // Two people with the same name, which happens. They must not swap places
  // between renders, so the id is the second key and not a coin toss.
  const sameName = [
    thread({ clientId: 'z', name: 'Sam Rivera' }),
    thread({ clientId: 'a', name: 'sam rivera' }),
    thread({ clientId: 'm', name: 'Sam Rivera' }),
  ];
  eq(sortUnstarted(sameName).map((t) => t.clientId).join(','), 'a,m,z',
    'two clients with the same name are ordered by id, stably');
  // The two minimal pairs, each already in the WRONG order so that a comparator
  // reporting "equal" instead of "after" leaves them where they are. A longer
  // list can hide both: insertion sort only needs "is a before b" to be right,
  // so a comparator that never says "after" still sorts most inputs correctly.
  eq(sortUnstarted([thread({ clientId: 'x', name: null }), thread({ clientId: 'y', name: 'Ann' })])
    .map((t) => t.clientId).join(','), 'y,x', 'a client with no readable name sorts AFTER one with a name');
  eq(sortUnstarted([thread({ clientId: 'x', name: 'zoe' }), thread({ clientId: 'y', name: 'Ann' })])
    .map((t) => t.clientId).join(','), 'y,x', 'and a later name sorts after an earlier one');
}

/* ── 4 · the split ─────────────────────────────────────────────────────── */
{
  const rows = [
    thread({ clientId: 'a', lastAt: '2026-08-31T20:13:44Z', lastBody: 'hi' }),
    thread({ clientId: 'b', name: 'Bea' }),
    thread({ clientId: 'c', name: 'Cal' }),
  ];
  const s = splitThreads(rows);
  eq(s.conversations.length, 1, 'one conversation');
  eq(s.unstarted.length, 2, 'two clients who could be written to');
  // Nobody is in both, and nobody is lost. A client who fell out of both lists
  // would be a person the coach cannot reach from the only messaging screen.
  eq(s.conversations.length + s.unstarted.length, rows.length, 'every client lands in exactly one list');
}

/* ── 5 · the preview line ──────────────────────────────────────────────── */
{
  const p = threadPreview(thread({ lastAt: '2026-08-31T20:13:44Z', lastBody: 'Can we move to 7?', lastSender: 'client' }));
  eq(p.text, 'Can we move to 7?', "a client's words are shown as they wrote them");
  eq(p.mine, false, 'and are not the coach’s own');
}
{
  const p = threadPreview(thread({ lastAt: '2026-08-31T20:13:44Z', lastBody: 'See you Tuesday.', lastSender: 'coach' }));
  eq(p.text, 'You: See you Tuesday.', 'the coach’s own last word is prefixed, because who said it changes what it means');
  eq(p.mine, true, 'and is marked as theirs so the row can mute it');
}
// Defect 3: a message whose whole content is a photograph.
eq(threadPreview(thread({ lastAt: '2026-08-31T20:13:44Z', lastKind: 'image', lastSender: 'client' })).text,
  'Sent you a photo', 'an uncaptioned photo says so rather than drawing a blank line');
eq(threadPreview(thread({ lastAt: '2026-08-31T20:13:44Z', lastKind: 'video', lastSender: 'coach' })).text,
  'You sent a video', 'and a clip the coach sent back says so from their side');
// A caption beats the envelope: the person chose those words.
eq(threadPreview(thread({ lastAt: '2026-08-31T20:13:44Z', lastKind: 'image', lastBody: 'Is this the one?', lastSender: 'client' })).text,
  'Is this the one?', 'a captioned photo previews the caption, not a description of the attachment');
// A row with a timestamp and nothing this build can render. Never blank.
ok(threadPreview(thread({ lastAt: '2026-08-31T20:13:44Z', lastSender: 'client' })).text.length > 0,
  'a message this build cannot show still says something');
eq(threadPreview(thread()).text, 'No messages yet', 'a client with no thread says so plainly');

/* ── 6 · when ──────────────────────────────────────────────────────────── */
{
  const now = Date.parse('2026-08-31T20:00:00Z');
  eq(threadWhen('2026-08-31T19:59:30Z', now), 'now', 'inside a minute');
  eq(threadWhen('2026-08-31T19:45:00Z', now), '15m', 'minutes');
  eq(threadWhen('2026-08-31T17:00:00Z', now), '3h', 'hours');
  eq(threadWhen('2026-08-29T20:00:00Z', now), '2d', 'days');
  // Each boundary EXACTLY, because every one of these thresholds is one
  // character away from being wrong and none of the cases above would notice.
  // "60m" and "24h" and "7d" are all things this has printed in other screens.
  eq(threadWhen('2026-08-31T19:59:00Z', now), '1m', 'exactly a minute is a minute, not still "now"');
  eq(threadWhen('2026-08-31T19:00:00Z', now), '1h', 'exactly an hour is 1h, never 60m');
  eq(threadWhen('2026-08-30T20:00:00Z', now), '1d', 'exactly a day is 1d, never 24h');
  eq(threadWhen('2026-08-30T20:00:01Z', now), '23h', 'a second under a day is still hours');
  ok(/\//.test(threadWhen('2026-08-24T20:00:00Z', now) ?? ''), 'exactly a week is a date, never 7d');
  eq(threadWhen('2026-08-24T20:00:01Z', now), '6d', 'a second under a week is still days');
  // Past a week it is a date rather than arithmetic — and the date is the
  // READER's, so this is stated against the local calendar rather than against
  // a literal. `npm run test:zones` runs the suite in Los Angeles, Auckland and
  // Dubai, and 2026-08-20T20:00:00Z is the 20th in one of those and the 21st in
  // the other two; a hardcoded '20/8' asserts a timezone, not a format. The
  // `+ 1` on the month is what this is really guarding: getMonth() is 0-based
  // and every date in the app has been off by a month for it at least once.
  {
    const iso = '2026-08-20T20:00:00Z';
    const d = new Date(Date.parse(iso));
    eq(threadWhen(iso, now), `${d.getDate()}/${d.getMonth() + 1}`, 'past a week, the local day and month');
    ok(/^\d{1,2}\/\d{1,2}$/.test(threadWhen(iso, now) ?? ''), 'and it is a date, not a duration');
  }
  // A clock that puts the message in the future must not print "-3m".
  eq(threadWhen('2026-08-31T20:05:00Z', now), 'now', 'a message from the future reads as now, not as a negative');
  eq(threadWhen(null, now), null, 'no timestamp, no label');
  eq(threadWhen('whenever', now), null, 'an unreadable timestamp is not drawn as "now"');
}

/* ── 7 · the empty state, which is four sentences and not one ──────────── */

eq(threadsEmptyNote('loading', 0), null, 'nothing is claimed while the read is in flight');
// Defect 2. The sentence that must never be "no conversations yet".
{
  const note = threadsEmptyNote('error', 0) ?? '';
  ok(/could not/i.test(note), 'a failed read says the read failed');
  ok(!/no conversations yet/i.test(note), 'a failed read NEVER says there are no conversations');
  ok(!/no messages/i.test(note), 'and never says there are no messages');
  // The roster count is unknown under an error too, so it must not change the
  // sentence — being told "you have no clients" by a failed read is the same lie.
  eq(threadsEmptyNote('error', 5), note, 'the error sentence does not depend on a count the error made unknowable');
}
{
  const note = threadsEmptyNote('ready', 0) ?? '';
  ok(/no clients/i.test(note), 'a coach with no roster is told the reason is the roster');
}
{
  const note = threadsEmptyNote('ready', 4) ?? '';
  ok(/no conversations yet/i.test(note), 'a coach with clients and no threads is told to start one');
  ok(!/no clients/i.test(note), 'and is not told they have no clients');
}
// 'partial' is a real answer about the rows that came back, so it reads like
// 'ready' rather than like a failure.
ok((threadsEmptyNote('partial', 4) ?? '').length > 0, 'a partial read still has something to say');

if (errors.length) {
  console.error(`coachThreads: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('coachThreads: ok');
