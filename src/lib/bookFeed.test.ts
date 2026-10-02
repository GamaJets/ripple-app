// A coach's week, across everybody.
//
// The assertions are about the three ways this could lie: ordering by anything
// other than time, counting a week it could not read, and drawing somebody's
// absence as an event.
//
// Compile with tsc, then run under plain node.
import { bookFeed, bookTally, activePeople, bookLine, BOOK_WINDOW_DAYS, type BookEvent } from './bookFeed';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

const NOW = Date.parse('2026-09-28T12:00:00Z');
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ev = (clientId: string, name: string, kind: BookEvent['kind'], at: number): BookEvent =>
  ({ clientId, name, kind, at: new Date(at).toISOString() });

/* ── newest first, and nothing else decides the order ─────────────────────── */

{
  const rows = bookFeed([
    ev('a', 'Ada', 'workout', NOW - 3 * DAY),
    ev('b', 'Ben', 'checkin', NOW - HOUR),
    ev('c', 'Cal', 'pr', NOW - 2 * DAY),
  ], NOW);
  eq(rows.map((r) => r.clientId).join(','), 'b,c,a', 'the week reads newest first and by nothing else');
}

/* ── what is outside the week is outside it ───────────────────────────────── */

{
  const rows = bookFeed([
    ev('a', 'Ada', 'workout', NOW - (BOOK_WINDOW_DAYS + 1) * DAY),
    ev('b', 'Ben', 'workout', NOW - HOUR),
    // Nothing that has not happened belongs in a record of what happened.
    ev('c', 'Cal', 'workout', NOW + 2 * HOUR),
    { clientId: 'd', name: 'Dee', kind: 'workout', at: 'not a date' },
  ], NOW);
  eq(rows.length, 1, 'last week, the future and an unreadable date are all out');
  eq(rows[0].clientId, 'b', 'and what is left is the week itself');
}

/* ── the cap drops the oldest, never a slice of one person ────────────────── */

{
  const many: BookEvent[] = [];
  for (let i = 0; i < 40; i++) many.push(ev(`c${i % 4}`, `C${i % 4}`, 'workout', NOW - i * HOUR));
  const rows = bookFeed(many, NOW, 10);
  eq(rows.length, 10, 'the cap is applied');
  ok(Date.parse(rows[0].at) > Date.parse(rows[9].at), 'and what survives is the newest end');
}

/* ── counting ─────────────────────────────────────────────────────────────── */

{
  const events = [
    ev('a', 'Ada', 'workout', NOW - HOUR),
    ev('a', 'Ada', 'checkin', NOW - 2 * HOUR),
    ev('b', 'Ben', 'pr', NOW - 3 * HOUR),
  ];
  const tally = bookTally(events, NOW);
  eq(tally.total, 3, 'everything in the window is counted once');
  // A PR is a workout as well as a record and `catchUp` counts it in one place
  // only; the line below is what adds them back together.
  eq(tally.workouts, 1, 'a personal record is not also counted as a workout');
  eq(tally.prs, 1, 'it is counted as a record');
  eq(activePeople(events, NOW), 2, 'two people did something, however many things they did');
  // It windows for itself: the caller used to pass the CAPPED feed, which put
  // a people figure and a tally measured over different sets in one sentence.
  eq(activePeople([...events, ev('z', 'Zoe', 'workout', NOW - 30 * DAY)], NOW), 2,
    'somebody active only outside the week is not in it');
}

/* ── the line, and the two things it refuses to say ───────────────────────── */

{
  const tally = bookTally([
    ev('a', 'Ada', 'workout', NOW - HOUR),
    ev('b', 'Ben', 'pr', NOW - 2 * HOUR),
    ev('b', 'Ben', 'checkin', NOW - 3 * HOUR),
  ], NOW);

  const said = bookLine({ tally, people: 2, onBook: 12, whole: true })!;
  ok(/2 workouts/.test(said), 'a personal record is a workout in the sentence, because it was one');
  ok(/1 check-in/.test(said), 'check-ins are named');
  ok(/2 of your 12/.test(said), 'and the denominator is there when it is known');

  // Without a roster count, "2 of your clients" would read as two of everybody.
  const noTotal = bookLine({ tally, people: 2, onBook: null, whole: true })!;
  ok(!/of your/.test(noTotal), 'no denominator, no claim about the whole book');
  ok(/2 people/.test(noTotal), 'but the people are still counted');

  // The one that matters most: a failed read must not be dressed as a quiet week.
  const broken = bookLine({ tally, people: 2, onBook: 12, whole: false })!;
  ok(/could not be read/.test(broken), 'a partial read says so');
  ok(!/\d+ workout/.test(broken), 'and states no figures at all');

  const empty = bookLine({ tally: bookTally([], NOW), people: 0, onBook: 12, whole: true })!;
  ok(/Nothing recorded/.test(empty), 'an empty week is said');
  ok(/not a statement about what they did/.test(empty),
    'and is said about the record rather than about twelve people');
}

if (errors.length) {
  console.error(`bookFeed.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('bookFeed: ok (newest first and nothing else, a failed read states no figures, and nobody’s absence is an event)');
