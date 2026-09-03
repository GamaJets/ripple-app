// What a bubble may claim, and when the reader's watermark may move.
// Compile with tsc, run with node.
//
// The assertions here are about the four ways this feature could ship a lie:
// a bubble the server refused wearing a read receipt, a watermark that moves
// on a write nobody confirmed, a watermark that moves backwards, and a write
// per scroll event.
import {
  deliveryOf, deliveryLine, isLocalId, atBottom, newestConfirmedAt,
  nextReadMark, receiptWorthPolling, READ_MARK_MIN_GAP_MS, BOTTOM_SLOP,
  type Bubble,
} from './readReceipt';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const T0 = '2026-09-01T09:00:00.000Z';
const T1 = '2026-09-01T09:41:00.000Z';
const T2 = '2026-09-01T10:15:00.000Z';

const bubble = (over: Partial<Bubble> = {}): Bubble => ({
  id: 'row-1', mine: true, sending: false, stage: undefined, createdAt: T1, kind: null, ...over,
});

/* ── the three states the sent half already had ──────────────────────────── */

eq(deliveryOf(bubble({ sending: true, id: 'local-1' }), null), 'sending', 'in flight is in flight');
eq(deliveryOf(bubble({ stage: 'send' }), null), 'failed', 'a refused row is a failure');
eq(deliveryOf(bubble({ stage: 'upload' }), null), 'failed', 'so is a file that did not go');
eq(deliveryOf(bubble({ stage: 'queued' }), null), 'queued', 'waiting is its own fact, not a failure');
eq(deliveryOf(bubble(), null), 'sent', 'a confirmed row with no receipt is sent');

// Nothing is said under the other person's bubble. Telling a client that their
// coach received their coach's own message is not information.
eq(deliveryOf(bubble({ mine: false }), T2), null, 'somebody else’s message carries no delivery state');

/* ── the read half ───────────────────────────────────────────────────────── */

eq(deliveryOf(bubble({ createdAt: T1 }), T2), 'read', 'a watermark after the message is a read message');
eq(deliveryOf(bubble({ createdAt: T2 }), T1), 'sent', 'a watermark before it is not');
// The newest message is stamped with exactly the moment the watermark is set
// to, so `>` would make it the one message that could never show as read.
eq(deliveryOf(bubble({ createdAt: T1 }), T1), 'read', 'the message the watermark was set from is read');
eq(deliveryOf(bubble({ createdAt: T1 }), null), 'sent', 'no watermark is not a read receipt');

/* ── A FAILED WRITE MUST NOT SHOW A READ RECEIPT ─────────────────────────── */
//
// The rule this codebase has broken four times. A peer watermark newer than
// everything must not promote a bubble the server never took.

eq(deliveryOf(bubble({ stage: 'send' }), T2), 'failed', 'a refused message is never read, whatever the peer has seen');
eq(deliveryOf(bubble({ stage: 'upload', kind: 'image' }), T2), 'failed', 'nor is a photo that did not upload');
eq(deliveryOf(bubble({ stage: 'queued' }), T2), 'queued', 'nor is one still on this phone');
eq(deliveryOf(bubble({ sending: true }), T2), 'sending', 'nor is one still in flight');
// The belt to that brace: no server row means no claim, whatever the flags say.
eq(deliveryOf(bubble({ id: 'local-99' }), T2), 'sending',
  'a bubble with no server row cannot be read, even with every flag clear');
ok(isLocalId('local-1700000000000'), 'the optimistic prefix is recognised');
ok(!isLocalId('4a2f-…'), 'a server id is not local');

// Rubbish in a timestamp is not evidence of a read.
eq(deliveryOf(bubble({ createdAt: 'not a date' }), T2), 'sent', 'an unparseable message time is not read');
eq(deliveryOf(bubble(), 'not a date'), 'sent', 'an unparseable watermark is not a read receipt');

/* ── the sentences ───────────────────────────────────────────────────────── */

eq(deliveryLine(bubble(), null, { them: 'your coach', time: '09:41' }), 'Sent 09:41',
  'the confirmed state says so out loud, and keeps the time');
eq(deliveryLine(bubble(), T2, { them: 'your coach', time: '09:41' }), 'Sent 09:41 · Read',
  'read is added to sent, not swapped for it');
eq(deliveryLine(bubble({ sending: true }), T2, { them: 'your coach', time: '09:41' }), 'Sending…',
  'in flight keeps the wording the screens already used');
eq(deliveryLine(bubble({ mine: false }), T2, { them: 'your coach', time: '09:41' }), '09:41',
  'the other person’s bubble is a bare time, as before');
// Delegated, not restated. If `unsentNote` is reworded these move with it.
eq(deliveryLine(bubble({ stage: 'send' }), null, { them: 'your coach', time: '09:41' }),
  'Not sent — your coach cannot see this', 'the failure sentence comes from unsentNote');
eq(deliveryLine(bubble({ stage: 'queued' }), null, { them: 'they', time: '09:41' }),
  'Waiting to send — they cannot see this yet', 'and so does the queued one');
eq(deliveryLine(bubble({ stage: 'upload', kind: 'video' }), null, { them: 'they', time: '09:41' }),
  'Not sent — the video did not upload, so they cannot see it', 'and the one that names the half that failed');

/* ── scrolled to the end ─────────────────────────────────────────────────── */

ok(atBottom({ offsetY: 900, viewport: 600, content: 1500 }), 'exactly at the end is at the end');
ok(atBottom({ offsetY: 890, viewport: 600, content: 1500 }), 'a few points off still is');
ok(!atBottom({ offsetY: 0, viewport: 600, content: 1500 }), 'the top of a long thread is not');
ok(atBottom({ offsetY: 0, viewport: 600, content: 200 }), 'a thread shorter than the screen is all on screen');
ok(!atBottom({ offsetY: 1500 - 600 - BOTTOM_SLOP - 1, viewport: 600, content: 1500 }),
  'one point past the slop is not the end');
ok(!atBottom({ offsetY: NaN, viewport: 600, content: 1500 }), 'a measurement we do not have is not the end');

/* ── what may be marked read up to ───────────────────────────────────────── */

eq(newestConfirmedAt([{ id: 'a', createdAt: T0 }, { id: 'b', createdAt: T2 }, { id: 'c', createdAt: T1 }]), T2,
  'the newest confirmed row, not the last in the array');
eq(newestConfirmedAt([{ id: 'a', createdAt: T0 }, { id: 'local-2', createdAt: T2 }]), T0,
  'a local bubble is not a candidate, however new it looks');
eq(newestConfirmedAt([]), null, 'an empty thread has nothing to mark');
eq(newestConfirmedAt([{ id: 'local-1', createdAt: T2 }]), null, 'nor does one holding only unsent words');
eq(newestConfirmedAt([{ id: 'a', createdAt: 'rubbish' }]), null, 'nor an unparseable row');

/* ── the write decision ──────────────────────────────────────────────────── */

const base = { newestAt: T2, visible: true, confirmedAt: null, inFlight: false, lastWriteMs: null };
const NOW = 1_000_000;

eq(nextReadMark(base, NOW).act, 'write', 'a new message on a visible thread is marked');
eq((nextReadMark(base, NOW) as any).at, T2, 'and marked at the newest confirmed message');

// Every clause of "what counts as read" is the caller's `visible`, and it wins.
eq(nextReadMark({ ...base, visible: false }, NOW).act, 'idle',
  'a thread scrolled to the top, or blurred, or backgrounded, marks nothing');
eq(nextReadMark({ ...base, newestAt: null }, NOW).act, 'idle', 'an empty thread marks nothing');
eq(nextReadMark({ ...base, newestAt: 'rubbish' }, NOW).act, 'idle', 'and rubbish is never sent to the server');

// MONOTONIC. The scroll handler fires continuously on a settled thread.
eq(nextReadMark({ ...base, confirmedAt: T2 }, NOW).act, 'idle', 'nothing newer than what is confirmed is a write');
eq(nextReadMark({ ...base, confirmedAt: '2026-09-02T00:00:00.000Z' }, NOW).act, 'idle',
  'and a watermark already ahead is never dragged back');
eq(nextReadMark({ ...base, confirmedAt: T1 }, NOW).act, 'write', 'something newer than it is');

// CONFIRMED, not attempted. This is the failed-write rule on the reader's side:
// a caller that set `confirmedAt` from a write it merely started would go idle
// forever on a write that failed.
eq(nextReadMark({ ...base, confirmedAt: null, inFlight: true }, NOW).act, 'idle',
  'one write at a time; its completion re-runs this');

// SPACED, with the trailing edge kept.
eq(nextReadMark({ ...base, lastWriteMs: NOW - 100 }, NOW).act, 'wait', 'a burst waits');
eq((nextReadMark({ ...base, lastWriteMs: NOW - 100 }, NOW) as any).inMs, READ_MARK_MIN_GAP_MS - 100,
  'and says how long is left, so the last message of a fast exchange is not dropped');
eq(nextReadMark({ ...base, lastWriteMs: NOW - READ_MARK_MIN_GAP_MS }, NOW).act, 'write',
  'past the gap it goes');
// A clock that stepped backwards between two readings must not produce a
// permanent 'write' loop or a negative wait.
const backwards = nextReadMark({ ...base, lastWriteMs: NOW + 5000 }, NOW);
eq(backwards.act, 'wait', 'a clock that went backwards waits rather than storming');
ok((backwards as any).inMs > 0, 'and never for a negative time');

/* ── when to stop asking ─────────────────────────────────────────────────── */

ok(receiptWorthPolling([bubble({ createdAt: T2 })], T1), 'a message the peer has not seen is worth asking about');
ok(!receiptWorthPolling([bubble({ createdAt: T0 })], T2), 'a thread they have read through is not');
ok(!receiptWorthPolling([bubble({ stage: 'send' })], null),
  'nor is one whose only unconfirmed bubble the server refused — no receipt can ever apply to it');
ok(!receiptWorthPolling([], null), 'nor an empty one');
ok(!receiptWorthPolling([bubble({ mine: false, createdAt: T2 })], null),
  'and never for the other person’s messages');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('readReceipt.test.ts — all assertions passed');
