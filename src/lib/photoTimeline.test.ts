// Ordering the photographs a client sent, and the several pairs this refuses
// to make.
//
// Compile with tsc, then run under plain node.
import {
  photoDayKey, daysApart, takenOldestFirst, timeline, undatedCount, spanNote, pairOf, pairNote,
  type TimelinePhoto,
} from './photoTimeline';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/** A row as `fetchSharedInbox` hands it over: taken is an instant, sent is an
 *  instant, and they are routinely nothing like each other. */
const p = (id: string, takenAt: string, sharedAt: string): TimelinePhoto => ({ id, takenAt, sharedAt });

// The case the whole module exists for: three photographs months apart, all
// found on a camera roll and sent within a minute of each other this morning.
const DUMP = [
  p('c', '2026-07-02T08:30:00.000Z', '2026-09-13T09:00:00.000Z'),
  p('a', '2026-01-14T08:30:00.000Z', '2026-09-13T09:00:20.000Z'),
  p('b', '2026-04-09T08:30:00.000Z', '2026-09-13T09:00:40.000Z'),
];

/* ── 1. the day a photograph belongs to ───────────────────────────────────── */

eq(photoDayKey('2026-01-14'), '2026-01-14', 'a bare date is its own day');
eq(photoDayKey(null), null, 'and an absent one is no day at all');
eq(photoDayKey('not-a-date'), null, 'and neither is a string that will not read');
// The UTC-slice trap. An instant is the LOCAL day it happened on, which is what
// "the day I took this" means to the person holding the phone — src/lib/
// photoCompare.ts documents the same bug at length.
{
  const local = photoDayKey('2026-01-14T21:30:00.000Z');
  ok(local != null, 'an instant resolves to a calendar day');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(local ?? ''), 'shaped as one');
}

eq(daysApart('2026-01-14', '2026-01-15'), 1, 'consecutive days are one apart');
eq(daysApart('2026-02-27', '2026-03-02'), 3, 'and a month boundary costs what it costs');
eq(daysApart('2026-01-14', null), null, 'a missing side answers nothing');
eq(daysApart('2026-01-14', '2026-01-14'), 0, 'and the same day really is zero');

/* ── 2. taken order, which is not send order ──────────────────────────────── */

{
  const ids = takenOldestFirst(DUMP).map((x) => x.id);
  eq(ids.join(','), 'a,b,c', 'the timeline is ordered by the day the picture is OF');
  // The inbox orders these the other way round, by send, and it is right to:
  // the send is the act addressed to the coach. Two views of one set.
  ok(ids.join(',') !== 'c,a,b', 'and not by the minute they happened to be sent in');
}

// Stable under reshuffling, so the order cannot wobble between two reads.
{
  const shuffled = [DUMP[1], DUMP[2], DUMP[0]];
  eq(takenOldestFirst(shuffled).map((x) => x.id).join(','), 'a,b,c',
    'the answer does not depend on the order they arrive in');
}

// Two photographs of the same day break on id rather than on chance.
{
  const same = [p('z', '2026-05-01', '2026-05-01'), p('y', '2026-05-01', '2026-05-02')];
  eq(takenOldestFirst(same).map((x) => x.id).join(','), 'y,z', 'a tie breaks on id, and stays broken');
}

// A row whose date will not read is KEPT — dropping it would tell a coach they
// had been sent fewer photographs than they had — and sorts to the end, because
// an unplaceable row at the head would look like the beginning of the story.
{
  const withBad = [...DUMP, p('x', 'not-a-date', '2026-09-13T09:01:00.000Z')];
  const ids = takenOldestFirst(withBad).map((v) => v.id);
  eq(ids.length, 4, 'an undated photograph is not discarded');
  eq(ids[3], 'x', 'and does not open the timeline');
  eq(undatedCount(withBad), 1, 'and is counted so the screen can say so');
  eq(undatedCount(DUMP), 0, 'a clean set reports none');
}

/* ── 3. the intervals that make it a timeline and not a grid ──────────────── */

{
  const rows = timeline(DUMP);
  eq(rows.length, 3, 'every photograph gets a row');
  eq(rows[0].sincePrevDays, null, 'the first has nothing before it — and that is null, not zero');
  eq(rows[1].sincePrevDays, 85, 'January to April');
  eq(rows[2].sincePrevDays, 84, 'April to July');
}

// An unreadable date breaks the chain at that row only, and never by pretending
// the interval was zero.
{
  const rows = timeline([p('a', '2026-01-14', 's'), p('x', 'not-a-date', 's'), p('c', '2026-02-14', 's')]);
  const byId = new Map(rows.map((r) => [r.photo.id, r]));
  eq(byId.get('x')?.dayKey, null, 'an undated row has no day');
  eq(byId.get('x')?.sincePrevDays, null, 'and no interval');
  eq(byId.get('c')?.sincePrevDays, 31, 'and the row after it measures from the last DATED one');
}

/* ── 4. the span sentence ─────────────────────────────────────────────────── */

eq(spanNote([]), null, 'nothing spans nothing');
eq(spanNote([DUMP[0]]), null, 'and one photograph is not a span');
eq(spanNote([p('a', '2026-05-01', 's'), p('b', '2026-05-01', 's')]), null,
  'two on one day span no time and say nothing rather than "0 weeks"');
{
  const note = spanNote(DUMP) ?? '';
  ok(note.includes('3 photographs'), 'the span counts them');
  ok(note.includes('24 weeks'), 'and says how long they cover');
  // No rate, no verdict. How often somebody photographs themselves is not this
  // app's to grade.
  ok(!/good|poor|regular|should/i.test(note), 'and grades nobody');
}

/* ── 5. the pair, and everything it refuses ───────────────────────────────── */

{
  const pair = pairOf(DUMP, 'c', 'a');
  eq(pair?.earlier.id, 'a', 'the earlier photograph is the one taken first');
  eq(pair?.later.id, 'c', 'whichever order the coach tapped them in');
  eq(pair?.apartDays, 169, 'with the days between them');
}

// The one way a side-by-side can lie without saying anything: a client who
// sends January after March. Order comes from the day taken, never the send.
{
  const backwards = [
    p('march', '2026-03-01', '2026-09-01T10:00:00.000Z'),
    p('jan', '2026-01-01', '2026-09-01T11:00:00.000Z'),
  ];
  eq(pairOf(backwards, 'march', 'jan')?.earlier.id, 'jan',
    'the send order does not decide which body came first');
}

eq(pairOf(DUMP, 'a', 'a'), null, 'a photograph is not compared against itself');
eq(pairOf(DUMP, 'a', 'nope'), null, 'a photograph that is not in the set makes no pair');
eq(pairOf(DUMP, '', 'a'), null, 'and neither does an empty selection');
// A date that will not read is refused rather than guessed at. This function
// will not decide which of two bodies came first on a timestamp it could not
// parse.
eq(pairOf([...DUMP, p('x', 'not-a-date', 's')], 'a', 'x'), null,
  'an undated photograph cannot be placed against a dated one');

// Same day IS a pair — two photographs taken one morning are a real pair — and
// the tie falls to id so the caption makes no claim either way.
{
  const same = [p('y', '2026-05-01', 's'), p('z', '2026-05-01', 's')];
  const pair = pairOf(same, 'z', 'y');
  eq(pair?.earlier.id, 'y', 'a same-day pair is ordered stably');
  eq(pair?.apartDays, 0, 'and is genuinely zero days apart');
}

/* ── 6. the caption, which is the whole of what this app will say ─────────── */

eq(pairNote(null), null, 'no pair, no caption');
eq(pairNote(pairOf([p('y', '2026-05-01', 's'), p('z', '2026-05-01', 's')], 'y', 'z')),
  'Both taken on the same day.', 'same day is said in words, not as "0 days apart"');
eq(pairNote(pairOf([p('y', '2026-05-01', 's'), p('z', '2026-05-02', 's')], 'y', 'z')),
  'One day apart.', 'one day too');
eq(pairNote(pairOf([p('y', '2026-05-01', 's'), p('z', '2026-05-06', 's')], 'y', 'z')),
  '5 days apart.', 'a few days is said in days');
eq(pairNote(pairOf([p('y', '2026-05-01', 's'), p('z', '2026-07-01', 's')], 'y', 'z')),
  '9 weeks apart.', 'a couple of months is said in weeks');
eq(pairNote(pairOf(DUMP, 'a', 'c')), '6 months apart.', 'and half a year in months');
eq(pairNote(pairOf([p('y', '2025-01-01', 's'), p('z', '2026-05-06', 's')], 'y', 'z')),
  '16 months apart.', 'and a long stretch in months');

// The caption is arithmetic on two dates. Nothing in it is about the body.
{
  const note = pairNote(pairOf(DUMP, 'a', 'c')) ?? '';
  ok(!/progress|leaner|change|better|worse|lost|gained/i.test(note),
    'and says nothing whatever about what is in the pictures');
}

if (errors.length) {
  console.error(`photoTimeline: ${errors.length} failed`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('photoTimeline: ok');
