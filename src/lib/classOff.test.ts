// src/lib/classOff.ts and src/lib/classOffAudience.ts — who is told a class was
// called off, once a cancellation stops erasing itself.
//
// The defect this file is written against is named in supabase/parts/3180 §8:
//
//     src/lib/classOff.ts … selects `id, user_id, class_id` with no status
//     filter and messages everybody who has a row when a class is called off.
//
// So the assertions below are mostly about people who must NOT be messaged, and
// about a number the coach reads and acts on. A test that only checked the
// happy path would have passed on the broken version.
//
// Run under several zones like every other suite here. Nothing in either module
// reads a clock, and asserting that rather than assuming it is the point:
//
//   for z in Pacific/Kiritimati UTC Pacific/Midway; do TZ=$z node .tmp/lib/classOff.test.js; done
import { tellTheCancelledRoom, type ClassOffSend } from './classOff';
import {
  classOffAudience, classOffWaitingNotification, type ClassOffRow,
} from './classOffAudience';
import { holdsPlace, seatStanding } from './classSeat';
import { CLASS_OFF_TITLE, CLASS_OFF_TITLE_MANY } from './notifyCopy';

let failures = 0;
function eq<T>(got: T, want: T, what: string): void {
  const ok = got === want;
  if (!ok) { failures++; console.error(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${what}`);
}
function truthy(got: unknown, what: string): void {
  if (got) console.log(`ok   ${what}`);
  else { failures++; console.error(`FAIL ${what}\n  got ${JSON.stringify(got)}`); }
}
function same(got: readonly string[], want: readonly string[], what: string): void {
  eq([...got].sort().join(','), [...want].sort().join(','), what);
}

const row = (userId: string, classId: string, status: unknown): ClassOffRow =>
  ({ userId, classId, status });

/* ═══ 1 · the audience split, every word the column can hold ═══════════════ */

{
  const a = classOffAudience([
    row('seat', 'c1', 'booked'),
    row('queue', 'c1', 'waitlist'),
    row('gone', 'c1', 'cancelled'),
    row('goneLate', 'c1', 'late_cancelled'),
  ]);
  same(a.seated.map((r) => r.userId), ['seat'], 'a booked row is told as a seat holder');
  same(a.queued.map((r) => r.userId), ['queue'], 'a waitlist row is told as a waitlister');
  same(a.dropped.map((r) => r.userId), ['gone', 'goneLate'],
    'THE DEFECT: both cancellation words are dropped — a member who withdrew is not told the gym withdrew too');
  eq(a.unreadable, 0, 'and four known words leave nothing unreadable');
}

// Stated as the assertion that would have caught the live behaviour, in the
// direction it actually fails: the cancelled member must be in NEITHER list
// that gets a send.
{
  const a = classOffAudience([row('gone', 'c1', 'cancelled')]);
  eq(a.seated.length + a.queued.length, 0,
    'a cancellation is in no send list at all, not merely worded differently');
}

/* ═══ 2 · 'unknown', and the two decisions that are allowed to disagree ════ */

// Decision one — the SEAT-HOLDING predicate. Unchanged, and pinned here as well
// as in classSeat.test.ts because this file is where the second decision lives
// and a reader has to see both answers side by side.
eq(holdsPlace('unknown'), false,
  'a word this build cannot read NEVER holds a place — it joins no count and arms no button');
eq(seatStanding('no_show'), 'unknown', 'and a fifth status word is exactly that word');

// Decision two — WHO IS TOLD. The opposite answer, deliberately. See the header
// of src/lib/classOffAudience.ts: silence risks a member at a locked door and a
// roster the coach undercounts; a send risks one superfluous banner.
{
  const a = classOffAudience([row('mystery', 'c1', 'no_show')]);
  eq(a.seated.length + a.queued.length, 1,
    'THE DECISION: an unreadable standing IS told — this fails if it were dropped like a cancellation');
  same(a.seated.map((r) => r.userId), ['mystery'],
    'and it is told in the seat holder’s words, whose every clause is true whatever the word means');
  eq(a.queued.length, 0,
    'never in the waitlist’s words — "you were on the waiting list" is a claim we cannot make');
  eq(a.unreadable, 1,
    'and it is counted apart, so the guess is visible rather than buried in the seat count');
  eq(a.dropped.length, 0, 'an unreadable standing is not a cancellation');
}

// The other direction of the same mutation: if 'unknown' were treated as a held
// place, `unreadable` would stop counting it and the guess would vanish.
{
  const a = classOffAudience([row('mystery', 'c1', 'no_show'), row('seat', 'c1', 'booked')]);
  eq(a.seated.length, 2, 'both are in the envelope');
  eq(a.unreadable, 1,
    'but only one of them is a guess — this fails if ‘unknown’ were folded into holding a seat');
}

// A status the read could not produce at all. The column is `not null default
// 'booked'`, so null is not a standing — it is a read this module cannot
// interpret, which is the same fact as an unknown word.
{
  const a = classOffAudience([row('nullish', 'c1', null), row('blank', 'c1', '   ')]);
  eq(a.seated.length, 2, 'a null and a blank status are told, not silently dropped');
  eq(a.unreadable, 2, 'and both are counted as guesses, never as seats');
}

// Rows that cannot be messaged at all.
{
  const a = classOffAudience([row('', 'c1', 'booked'), row('u', '', 'booked'), row('u2', 'c2', 'booked')]);
  same(a.seated.map((r) => r.userId), ['u2'], 'a blank user id or class id is discarded before anything else');
  eq(a.unreadable, 0, 'a discarded row is not an unreadable standing');
}

eq(classOffAudience(null).seated.length, 0, 'a null roster splits into nothing and throws nothing');
eq(classOffAudience([]).unreadable, 0, 'and so does an empty one');

/* ═══ 3 · the waitlister's sentence ═══════════════════════════════════════ */

{
  const n = classOffWaitingNotification('Reformer', 1, 'Instructor off sick');
  truthy(n.title !== CLASS_OFF_TITLE,
    'a waitlister is not told "a class you booked" — they did not book one');
  truthy(n.body.includes('waiting list'), 'the body says what they actually had');
  truthy(n.body.includes('nothing to cancel'),
    'and it matches class_cancelled_notify word for word, so the banner and the inbox row agree');
  truthy(!n.body.includes('booking is kept'),
    'THE POINT: it never claims a booking is kept, because they had no booking');
  truthy(n.body.includes('Instructor off sick'), 'the reason is passed on');
  truthy(n.body.includes('Reformer'), 'and the class is named');
  eq(n.route, '/(client)/classes', 'and it lands on the timetable');
}

{
  const n = classOffWaitingNotification('Reformer', 3, null);
  truthy(n.title !== CLASS_OFF_TITLE_MANY, 'the plural title is the waitlister’s own too');
  truthy(n.body.includes('3'), 'a member waiting on three of them is told three');
  truthy(!n.body.includes(':'), 'and with no reason given there is no dangling colon');
  // The PLURAL body, asserted in its own right and not left to the singular's
  // coverage. A mutation run found this: the plural sentence could be rewritten
  // to "Your bookings are kept on the record" — the seat holder's claim, in the
  // plural — and every assertion above still passed, because the title and the
  // count are all they look at. It is the body a member waiting on several
  // weeks of a series actually reads.
  truthy(n.body.includes('waiting list'), 'the plural body says what they actually had, as the singular does');
  truthy(n.body.includes('nothing to cancel'),
    'and matches class_cancelled_notify in the plural too, so banner and inbox row agree');
  truthy(!/\bbookings?\b/i.test(n.body),
    'THE POINT, in the plural: three queue places are still no booking, so the word never appears');
}

// The same word, checked on the singular body. `!includes('booking is kept')`
// above is a test of one phrasing; this is a test of the claim, and it is the
// claim — not the phrasing — that is wrong about a waitlister.
{
  const n = classOffWaitingNotification('Reformer', 1, null);
  truthy(!/\bbookings?\b/i.test(n.body),
    'a waitlister is never told anything about a booking, because they have none');
}

{
  // No clock time and no date, the rule the rest of this copy keeps: gym_classes
  // carries no zone, so a rendered hour is right for one reader and wrong for
  // everybody else.
  const n = classOffWaitingNotification('Reformer', 1, 'Room flooded');
  truthy(!/\d{1,2}:\d{2}/.test(n.body), 'no clock time in the body');
  const empty = classOffWaitingNotification('   ', 1, '   ');
  truthy(empty.body.startsWith('“A class”'),
    'an unreadable class title becomes "A class" rather than a pair of empty quotes');
}

/* ═══ 4 · tellTheCancelledRoom, end to end ════════════════════════════════ */

type DbRow = { id: string; user_id: string; class_id: string; status: unknown };

interface Db {
  calls: { select: string; from: number; to: number }[];
  from: (table: string) => any;
}

function stubDb(rows: DbRow[], fail = false): Db {
  const calls: { select: string; from: number; to: number }[] = [];
  return {
    calls,
    from() {
      let sel = '';
      let chunk: string[] = [];
      const q: any = {
        select(s: string) { sel = s; return q; },
        in(_col: string, ids: string[]) { chunk = ids; return q; },
        order() { return q; },
        range(from: number, to: number) {
          calls.push({ select: sel, from, to });
          if (fail) return Promise.resolve({ data: null, error: new Error('refused') });
          const want = rows.filter((r) => chunk.includes(r.class_id));
          return Promise.resolve({ data: want.slice(from, to + 1), error: null });
        },
      };
      return q;
    },
  };
}

interface Sent { ids: string[]; title: string; body: string; route: string; channel: string }
function recorder(result: { ok: boolean; partial?: boolean } = { ok: true }) {
  const sent: Sent[] = [];
  const send: ClassOffSend = async (ids, title, body, data, channel) => {
    sent.push({ ids: [...ids], title, body, route: data.route, channel });
    return result;
  };
  return { sent, send };
}

const db = (rows: DbRow[]) => rows;

async function run(): Promise<void> {
  /* ── the regression itself ─────────────────────────────────────────────── */
  {
    const r = recorder();
    const told = await tellTheCancelledRoom(
      stubDb(db([
        { id: '1', user_id: 'seat', class_id: 'c1', status: 'booked' },
        { id: '2', user_id: 'queue', class_id: 'c1', status: 'waitlist' },
        { id: '3', user_id: 'gone', class_id: 'c1', status: 'cancelled' },
        { id: '4', user_id: 'goneLate', class_id: 'c1', status: 'late_cancelled' },
      ])),
      ['c1'], 'Reformer', 'Instructor off sick', null, r.send,
    );
    eq(told.people, 2,
      'THE REGRESSION: four rows, two people told — the two who cancelled are not a room to tell');
    eq(told.pushed, 2, 'and both of those sends were accepted');
    eq(told.unreadable, 0, 'nothing here was a guess');
    const everyone = r.sent.flatMap((s) => s.ids);
    truthy(!everyone.includes('gone'), 'the cancelled member is in no recipient list');
    truthy(!everyone.includes('goneLate'), 'and neither is the late-cancelled one');
    same(everyone, ['seat', 'queue'], 'exactly the two who still hold something');
  }

  /* ── the status column is actually read ────────────────────────────────── */
  {
    const d = stubDb(db([{ id: '1', user_id: 'seat', class_id: 'c1', status: 'booked' }]));
    await tellTheCancelledRoom(d, ['c1'], 'Reformer', 'x', null, recorder().send);
    truthy(d.calls.length > 0, 'the roster was read');
    truthy(d.calls.every((c) => c.select.includes('status')),
      'and `status` is in the select — without it there is nothing to filter on and §8 is unfixed');
  }

  /* ── two relationships, two sentences ──────────────────────────────────── */
  {
    const r = recorder();
    await tellTheCancelledRoom(
      stubDb(db([
        { id: '1', user_id: 'seat', class_id: 'c1', status: 'booked' },
        { id: '2', user_id: 'queue', class_id: 'c1', status: 'waitlist' },
      ])),
      ['c1'], 'Reformer', 'Instructor off sick', null, r.send,
    );
    eq(r.sent.length, 2, 'a seat holder and a waitlister are two sends, not one');
    const toSeat = r.sent.find((s) => s.ids.includes('seat'));
    const toQueue = r.sent.find((s) => s.ids.includes('queue'));
    truthy(toSeat && toSeat.body.includes('booking is kept'),
      'the seat holder keeps the sentence they have always had');
    truthy(toQueue && toQueue.body.includes('nothing to cancel'),
      'and the waitlister is told there is nothing of theirs to give up');
    truthy(toQueue && !toQueue.body.includes('booking is kept'),
      'never the seat holder’s sentence — they had no booking to keep');
    truthy(r.sent.every((s) => s.route === '/(client)/classes'), 'both land on the timetable');
    truthy(r.sent.every((s) => !!s.channel), 'and both carry the channel, so muting bookings works');
  }

  /* ── one person, two standings, still one person ───────────────────────── */
  {
    const r = recorder();
    const told = await tellTheCancelledRoom(
      stubDb(db([
        { id: '1', user_id: 'both', class_id: 'c1', status: 'booked' },
        { id: '2', user_id: 'both', class_id: 'c2', status: 'waitlist' },
      ])),
      ['c1', 'c2'], 'Reformer', 'x', null, r.send,
    );
    eq(told.people, 1,
      'somebody holding a seat on one week and a queue place on another is ONE person, not two');
    eq(told.pushed, 1, 'and one person reached, however many envelopes it took');
    eq(r.sent.length, 2, 'though they do get both sentences, because both are true of them');
    truthy(r.sent.every((s) => s.body.includes('“Reformer”')),
      'and each names the class rather than a count of somebody else’s diary');
  }

  /* ── a member's own count, never the size of the cancellation ──────────── */
  {
    const r = recorder();
    await tellTheCancelledRoom(
      stubDb(db([
        { id: '1', user_id: 'two', class_id: 'c1', status: 'booked' },
        { id: '2', user_id: 'two', class_id: 'c2', status: 'booked' },
        { id: '3', user_id: 'one', class_id: 'c1', status: 'booked' },
        { id: '4', user_id: 'gone', class_id: 'c2', status: 'cancelled' },
      ])),
      ['c1', 'c2'], 'Reformer', 'x', null, r.send,
    );
    const toTwo = r.sent.find((s) => s.ids.includes('two'));
    const toOne = r.sent.find((s) => s.ids.includes('one'));
    truthy(toTwo && toTwo.body.includes('2 of your'), 'somebody booked on two is told two');
    truthy(toOne && toOne.title === CLASS_OFF_TITLE, 'and somebody booked on one gets the singular');
    truthy(toTwo !== toOne, 'which is two buckets and two sends');
  }

  /* ── the canceller is dropped, and a cancelled row of theirs changes nothing ── */
  {
    const r = recorder();
    const told = await tellTheCancelledRoom(
      stubDb(db([
        { id: '1', user_id: 'me', class_id: 'c1', status: 'booked' },
        { id: '2', user_id: 'seat', class_id: 'c1', status: 'booked' },
      ])),
      ['c1'], 'Reformer', 'x', 'me', r.send,
    );
    eq(told.people, 1, 'the coach booked into their own class is watching it happen and is not told');
    truthy(!r.sent.flatMap((s) => s.ids).includes('me'), 'and is in no recipient list');
  }

  /* ── an unreadable standing, end to end ────────────────────────────────── */
  {
    const r = recorder();
    const told = await tellTheCancelledRoom(
      stubDb(db([
        { id: '1', user_id: 'mystery', class_id: 'c1', status: 'promoted_pending' },
        { id: '2', user_id: 'gone', class_id: 'c1', status: 'cancelled' },
      ])),
      ['c1'], 'Reformer', 'x', null, r.send,
    );
    eq(told.people, 1, 'a fifth status word is told — silence would leave them at a locked door');
    eq(told.unreadable, 1, 'and the coach’s number says one of them is a guess');
    truthy(!r.sent.flatMap((s) => s.ids).includes('gone'),
      'while the cancellation beside it is still dropped — the two are not the same nothing');
  }

  /* ── a roster that could not be read is not an empty room ──────────────── */
  {
    const r = recorder();
    const told = await tellTheCancelledRoom(
      stubDb([], true), ['c1'], 'Reformer', 'x', null, r.send,
    );
    eq(told.people, null, 'null is a roster that could not be READ, which is not nobody');
    eq(told.pushed, 0, 'nothing was sent');
    eq(told.unreadable, 0, 'and nothing was guessed at either');
    eq(r.sent.length, 0, 'no send was even attempted');
  }

  /* ── nothing to call off ───────────────────────────────────────────────── */
  {
    const r = recorder();
    const told = await tellTheCancelledRoom(stubDb([]), [], 'Reformer', 'x', null, r.send);
    eq(told.people, 0, 'no classes is a real zero, not an unread roster');
    eq(told.unreadable, 0, 'with nothing guessed');
    eq(r.sent.length, 0, 'and nobody sent to');
  }

  /* ── a class nobody is on ──────────────────────────────────────────────── */
  {
    const r = recorder();
    const told = await tellTheCancelledRoom(
      stubDb(db([{ id: '1', user_id: 'gone', class_id: 'c1', status: 'cancelled' }])),
      ['c1'], 'Reformer', 'x', null, r.send,
    );
    eq(told.people, 0,
      'a class whose only rows are cancellations has nobody to tell — and the coach is told so');
    eq(r.sent.length, 0, 'so no push goes out at all');
  }

  /* ── a refused send is not a delivered one ─────────────────────────────── */
  {
    const r = recorder({ ok: false });
    const told = await tellTheCancelledRoom(
      stubDb(db([{ id: '1', user_id: 'seat', class_id: 'c1', status: 'booked' }])),
      ['c1'], 'Reformer', 'x', null, r.send,
    );
    eq(told.people, 1, 'somebody was there to tell');
    eq(told.pushed, 0, 'and nothing reached them — never claim success from the absence of an error');
  }

  /* ── `partial` is a floor on the whole sentence ────────────────────────── */
  {
    const r = recorder({ ok: true, partial: true });
    const told = await tellTheCancelledRoom(
      stubDb(db([
        { id: '1', user_id: 'a', class_id: 'c1', status: 'booked' },
        { id: '2', user_id: 'b', class_id: 'c1', status: 'waitlist' },
      ])),
      ['c1'], 'Reformer', 'x', null, r.send,
    );
    eq(told.partial, true, 'one short token read makes the whole claim a floor');
    eq(told.people, 2, 'and the figure itself still stands');
  }

  console.log(failures === 0 ? '\nall ok' : `\n${failures} FAILED`);
  if (failures) process.exit(1);
}

void run();
