// Tests for sessionCancellations — the record of a booking that stopped being
// somebody's, and the four things it is not allowed to say.
//
// The assertions are grouped by the sentence that would be false on somebody's
// screen if the rule underneath them broke:
//
//   · NOTICE is an interval between two stored instants and must be the same
//     number in every timezone on earth. `npm run test:zones` runs this file in
//     Kiritimati (UTC+14) and Midway (UTC-11); every fixture below is built
//     from explicit UTC instants and every expected value is an exact minute
//     count, so a rule that reached for the device clock fails here in four of
//     the six zones rather than in none of them.
//   · WHO CANCELLED is a uuid that may be either person, and the fourth answer
//     — nobody recorded it — must never collapse into one of the other three.
//     A coach reading "3 cancellations" about a client they themselves stood up
//     twice is the defect this half exists to prevent.
//   · ONE ACTION, SEVERAL HOURS. A fortnight's pause is four rows written in
//     one transaction, and Postgres stamps every row in a transaction with the
//     same `now()`. Counting those as four cancellations tells a coach somebody
//     bailed on them four times for one holiday booked in advance.
//   · AN EMPTY LIST means four different things and only one of them may be
//     stated as a fact about a person's record.
//   · NO RATE. There is no division in the module and the constants say why.
//
// Compile with tsc then run with node, like sessionHistory.test.ts.
import {
  noticeMinutes, noticeBand, noticeLine, durationWords, noticeWords,
  actorOf, actorLine, groupActions, actionLine, tallyCancellations,
  emptyCancellationsLine,
  NO_RATE_NOTE, BEST_EFFORT_NOTE, RECORD_START_NOTE, ENDED_SERIES_NOTE,
  COACH_SCOPE_NOTE, NOT_A_VERDICT_NOTE,
  type Cancellation, type Actor,
} from './sessionCancellations';
import { num } from './format';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ALL_STATUSES: LoadStatus[] = ['loading', 'ready', 'partial', 'error'];

const CLIENT = 'client-uuid';
const COACH = 'coach-uuid';
const DESK = 'front-desk-uuid';

/** An instant written as UTC, so no fixture in this file moves with TZ. */
const utc = (iso: string) => `${iso}Z`;

let seq = 0;
const row = (over: Partial<Cancellation> = {}): Cancellation => ({
  id: `c${++seq}`,
  sessionId: `s${seq}`,
  clientId: CLIENT,
  trainerId: COACH,
  startsAt: utc('2026-09-10T09:00:00.000'),
  durationMin: 60,
  cancelledAt: utc('2026-09-09T09:00:00.000'),
  cancelledBy: CLIENT,
  wasSeries: false,
  ...over,
});

/* ── 1. notice is an interval, and it is the same everywhere ───────────────── */
//
// The single figure this feature exists to produce. Every assertion is an exact
// minute count against instants written in UTC, so the arithmetic cannot be
// right only in London.
{
  eq(noticeMinutes(row()), 24 * 60, 'a day of notice is 1440 minutes');

  eq(noticeMinutes(row({
    startsAt: utc('2026-09-10T09:00:00.000'),
    cancelledAt: utc('2026-09-10T08:20:00.000'),
  })), 40, 'forty minutes before is forty minutes of notice');

  // A cancellation that lands ON the hour is zero, not "a bit of notice".
  eq(noticeMinutes(row({
    startsAt: utc('2026-09-10T09:00:00.000'),
    cancelledAt: utc('2026-09-10T09:00:00.000'),
  })), 0, 'cancelling at the start is exactly no notice');

  // NEGATIVE IS REAL AND IS NOT CLAMPED. A floor at zero would render an hour
  // cancelled after it began as "no notice", which is a gentler and different
  // claim than what happened.
  eq(noticeMinutes(row({
    startsAt: utc('2026-09-10T09:00:00.000'),
    cancelledAt: utc('2026-09-10T09:35:00.000'),
  })), -35, 'cancelling after the start is negative notice, not zero');

  // Across a DST boundary in the reader's zone the answer must not move: these
  // are instants, and an instant difference has no opinion about clocks.
  eq(noticeMinutes(row({
    startsAt: utc('2026-03-29T10:00:00.000'),
    cancelledAt: utc('2026-03-28T10:00:00.000'),
  })), 1440, 'a day across a European clock change is still 1440 minutes');

  // Null, never zero. A duration that could not be computed averaged in as
  // none is a fabricated figure, and the tally counts it apart for that reason.
  eq(noticeMinutes(row({ cancelledAt: 'not a date' })), null, 'an unreadable cancellation time gives no notice figure');
  eq(noticeMinutes(row({ startsAt: '' })), null, 'an unreadable start gives no notice figure');
}

/* ── 2. the bands are intervals and never the coach's policy ───────────────── */
{
  eq(noticeBand(row({ cancelledAt: utc('2026-09-10T09:30:00.000') })), 'after', 'after the start');
  eq(noticeBand(row({ cancelledAt: utc('2026-09-10T09:00:00.000') })), 'after', 'at the start counts as after, not as notice');
  eq(noticeBand(row({ cancelledAt: utc('2026-09-10T08:59:00.000') })), 'under24h', 'a minute before is under a day');
  eq(noticeBand(row({ cancelledAt: utc('2026-09-09T09:01:00.000') })), 'under24h', 'one minute short of a day is under a day');
  eq(noticeBand(row({ cancelledAt: utc('2026-09-09T09:00:00.000') })), 'over24h', 'exactly a day is a day or more');
  eq(noticeBand(row({ cancelledAt: utc('2026-09-01T09:00:00.000') })), 'over24h', 'nine days is a day or more');
  eq(noticeBand(row({ cancelledAt: 'nonsense' })), 'unknown', 'an unreadable time is its own band');

  // There is no band named for a policy, and no label in this module says
  // "late". `insideNoticeWindow` in src/lib/booking.ts is the only thing
  // entitled to say that, and it reads a policy that may have changed since.
  for (const c of [
    row({ cancelledAt: utc('2026-09-10T08:59:00.000') }),
    row({ cancelledAt: utc('2026-09-10T09:30:00.000') }),
  ]) {
    ok(!/\blate\b/i.test(noticeLine(c)), `the notice line never calls a cancellation late — got ${JSON.stringify(noticeLine(c))}`);
  }
}

/* ── 3. durations round DOWN, and pick the unit that does not mislead ──────── */
//
// Compared against `num()` rather than against a literal so the assertion is
// about the arithmetic and not about which digits the runner's locale prints.
{
  eq(durationWords(0), `${num(0)} minutes`, 'zero minutes');
  eq(durationWords(1), `${num(1)} minute`, 'one minute is singular');
  eq(durationWords(59), `${num(59)} minutes`, 'fifty-nine minutes stays in minutes');
  eq(durationWords(60), `${num(1)} hour`, 'an hour is singular hours');
  eq(durationWords(119), `${num(1)} hour`, 'an hour and fifty-nine minutes rounds DOWN to one hour');
  eq(durationWords(2 * 24 * 60 - 1), `${num(47)} hours`, 'just under two days is still counted in hours');
  eq(durationWords(2 * 24 * 60), `${num(2)} days`, 'two days is where days begin');
  // The direction of the rounding is the point: rounding up would overstate the
  // notice, which flatters whoever cancelled on a screen the other person reads.
  eq(durationWords(3 * 24 * 60 + 20 * 60), `${num(3)} days`, 'three days and twenty hours is three days, not four');
}

/* ── 4. the notice sentence says which side of the hour it fell ────────────── */
{
  const before = noticeLine(row({ cancelledAt: utc('2026-09-10T08:20:00.000') }));
  ok(/before it was due to start/.test(before), `notice before the hour says so — got ${JSON.stringify(before)}`);

  const after = noticeLine(row({ cancelledAt: utc('2026-09-10T09:35:00.000') }));
  ok(/after it was due to start/.test(after), `a cancellation after the hour says so — got ${JSON.stringify(after)}`);
  ok(after.includes(num(35)), `and names how long after — got ${JSON.stringify(after)}`);

  const at = noticeLine(row({ cancelledAt: utc('2026-09-10T09:00:00.000') }));
  ok(/at the hour it was due to start/.test(at), `landing on the hour has its own sentence — got ${JSON.stringify(at)}`);

  // An unreadable pair produces a sentence about the RECORD, never a figure and
  // never a hole where one should be.
  const unknown = noticeLine(row({ cancelledAt: 'nonsense' }));
  ok(/not known/.test(unknown), `an unreadable notice says it is not known — got ${JSON.stringify(unknown)}`);
  ok(!unknown.includes('undefined') && !unknown.includes('NaN') && !unknown.includes('null'),
    'and it is a sentence rather than one with a hole in it');
}

/* ── 4b. the short form that goes in a figure slot ─────────────────────────── */
//
// `durationWords` floors at zero, so the only way a negative reaches a tile
// honestly is if something turns it round first. That is this function, and
// the assertion below is the one that catches it being removed: a median notice
// of minus an hour must not print as "0 minutes before".
{
  eq(noticeWords(0), 'on the hour', 'landing on the hour has its own two words');
  eq(noticeWords(120), `${num(2)} hours before`, 'notice ahead of the hour reads as before');
  eq(noticeWords(-90), `${num(1)} hour after`, 'a negative reads as after, with its size intact');
  ok(!noticeWords(-90).includes(`${num(0)} `), 'and never as a floored zero');
}

/* ── 5. who cancelled: four answers, and the fourth never collapses ────────── */
{
  eq(actorOf(row({ cancelledBy: CLIENT })), 'client', 'the member');
  eq(actorOf(row({ cancelledBy: COACH })), 'coach', 'the coach');
  eq(actorOf(row({ cancelledBy: DESK })), 'other', 'a third account is named as a third account');
  eq(actorOf(row({ cancelledBy: null })), 'unattributed', 'null is its own answer');

  // A row with no coach on it cannot resolve to 'coach' by accident — the guard
  // matters because `trainer_id` is nullable and `null === null` is true.
  eq(actorOf(row({ trainerId: null, cancelledBy: null })), 'unattributed',
    'a row with neither a coach nor an actor is unattributed, not coach');
  eq(actorOf(row({ trainerId: null, cancelledBy: DESK })), 'other',
    'with no coach on the row, a stranger is still a stranger');

  // THE ASSERTION THIS WHOLE HALF EXISTS FOR. Every sentence about an
  // unattributed cancellation must say it is not known, and must not read as an
  // accusation of the person the screen is about.
  for (const audience of ['coach', 'member'] as const) {
    const line = actorLine('unattributed', audience, 'Ben');
    ok(/not recorded/.test(line), `${audience}: an unattributed row says the actor was not recorded`);
    ok(/not known/.test(line), `${audience}: and says outright that it is not known who it was`);
  }

  // "You" is a different person on each screen and the strings know it.
  ok(/^You cancelled/.test(actorLine('client', 'member', 'Ben')), 'the member reads their own cancellation as theirs');
  ok(/^Ben cancelled/.test(actorLine('client', 'coach', 'Ben')), 'the coach reads it as the client’s, by name');
  ok(/^You cancelled/.test(actorLine('coach', 'coach', 'Ben')), 'the coach reads their own release as theirs');
  ok(/^Your coach cancelled/.test(actorLine('coach', 'member', 'Ben')), 'the member reads a release as the coach’s');

  // No sentence anywhere may come back empty or carry a hole — this is the
  // scripts/check-prose.mjs rule, asserted rather than hoped for.
  const ALL_ACTORS: Actor[] = ['client', 'coach', 'other', 'unattributed'];
  for (const a of ALL_ACTORS) {
    for (const audience of ['coach', 'member'] as const) {
      const line = actorLine(a, audience, 'Ben');
      ok(line.length > 10, `${a}/${audience} has a sentence`);
      // A hole, not an em dash: this app writes em dashes as punctuation all
      // over, and the thing scripts/check-prose.mjs is about is a MISSING VALUE
      // rendered into running prose — a dash where a name should be, or the
      // word `undefined` where a figure should be.
      ok(!/undefined|NaN|\bnull\b/.test(line) && !line.trim().startsWith('\u2014'),
        `${a}/${audience} has no hole in it — got ${JSON.stringify(line)}`);
    }
  }
}

/* ── 6. one action, several hours ──────────────────────────────────────────── */
//
// The rule: rows written by one transaction carry an IDENTICAL `cancelled_at`,
// because `now()` in PostgreSQL is the transaction timestamp. Grouping is by
// that exact string plus the actor, so a paused fortnight is one cancellation
// and four hours.
{
  const stamp = utc('2026-09-01T12:00:00.123456');
  const paused = [
    row({ id: 'p1', startsAt: utc('2026-09-08T09:00:00.000'), cancelledAt: stamp, wasSeries: true }),
    row({ id: 'p2', startsAt: utc('2026-09-15T09:00:00.000'), cancelledAt: stamp, wasSeries: true }),
    row({ id: 'p3', startsAt: utc('2026-09-22T09:00:00.000'), cancelledAt: stamp, wasSeries: true }),
  ];
  const grouped = groupActions(paused);
  eq(grouped.length, 1, 'three hours removed in one transaction are ONE action');
  eq(grouped[0].rows.length, 3, 'and all three hours are kept inside it');
  eq(grouped[0].actor, 'client', 'the action carries who performed it');

  // A microsecond apart is a different transaction and a different decision.
  // The grouping is on the raw string precisely so this cannot be rounded away:
  // Date.parse throws the microseconds off the end.
  const twoTaps = groupActions([
    row({ cancelledAt: utc('2026-09-01T12:00:00.123456') }),
    row({ cancelledAt: utc('2026-09-01T12:00:00.123457') }),
  ]);
  eq(twoTaps.length, 2, 'two cancellations a microsecond apart are two actions');

  // Same instant, different person: two actions. A coach releasing an hour at
  // the same moment the member cancelled another is not one decision.
  const twoPeople = groupActions([
    row({ cancelledAt: stamp, cancelledBy: CLIENT }),
    row({ cancelledAt: stamp, cancelledBy: COACH }),
  ]);
  eq(twoPeople.length, 2, 'the same instant by two different people is two actions');

  // An unattributed batch still groups — null is a value here, not a wildcard.
  eq(groupActions([
    row({ cancelledAt: stamp, cancelledBy: null }),
    row({ cancelledAt: stamp, cancelledBy: null }),
  ]).length, 1, 'two unattributed rows from one transaction are one action');
  eq(groupActions([
    row({ cancelledAt: stamp, cancelledBy: null }),
    row({ cancelledAt: stamp, cancelledBy: CLIENT }),
  ]).length, 2, 'an unattributed row does not merge with an attributed one');

  // `was_series` on its own proves nothing about how many went at once, which
  // is refusal 3 in the module header. One occurrence of a standing appointment
  // cancelled by itself is one action of one hour.
  eq(groupActions([row({ wasSeries: true })]).length, 1, 'a lone series occurrence is one action');

  // And the same flag would be wrong in the OTHER direction. Two occurrences of
  // one standing appointment cancelled a week apart are two decisions; folding
  // them together because both hours belonged to a series would tell a coach
  // about one absence where there were two.
  eq(groupActions([
    row({ wasSeries: true, cancelledAt: utc('2026-09-01T12:00:00.000000') }),
    row({ wasSeries: true, cancelledAt: utc('2026-09-08T12:00:00.000000') }),
  ]).length, 2, 'two occurrences of one series cancelled a week apart are two actions');
  eq(actionLine(groupActions([row({ wasSeries: true })])[0]), null,
    'and it gets no "these went together" line, because none did');

  const multi = actionLine(grouped[0])!;
  ok(/counted here as one/.test(multi), `a real batch says it is counted once — got ${JSON.stringify(multi)}`);
  ok(multi.includes(num(3)), 'and names how many hours went with it');
}

/* ── 7. the tally counts hours and actions apart, and splits by who ────────── */
{
  const stamp = utc('2026-09-01T12:00:00.100000');
  const rows = [
    // one holiday: three hours, one decision, by the member
    row({ cancelledAt: stamp, cancelledBy: CLIENT, wasSeries: true, startsAt: utc('2026-09-08T09:00:00.000') }),
    row({ cancelledAt: stamp, cancelledBy: CLIENT, wasSeries: true, startsAt: utc('2026-09-15T09:00:00.000') }),
    row({ cancelledAt: stamp, cancelledBy: CLIENT, wasSeries: true, startsAt: utc('2026-09-22T09:00:00.000') }),
    // the coach standing somebody up an hour before
    row({ cancelledBy: COACH, startsAt: utc('2026-08-04T09:00:00.000'), cancelledAt: utc('2026-08-04T08:00:00.000') }),
    // the front desk
    row({ cancelledBy: DESK, startsAt: utc('2026-08-05T09:00:00.000'), cancelledAt: utc('2026-08-01T09:00:00.000') }),
    // nobody signed in
    row({ cancelledBy: null, startsAt: utc('2026-08-06T09:00:00.000'), cancelledAt: utc('2026-08-06T10:00:00.000') }),
    // a time that will not parse
    row({ cancelledBy: CLIENT, cancelledAt: 'nonsense' }),
  ];
  const t = tallyCancellations(rows);

  eq(t.sessions, 7, 'seven hours');
  eq(t.actions, 5, 'five decisions — the three-hour holiday counts once');
  eq(t.byClient, 4, 'four hours cancelled by the member');
  eq(t.byCoach, 1, 'one by the coach');
  eq(t.byOther, 1, 'one by somebody else');
  eq(t.unattributed, 1, 'one nobody was recorded for');
  eq(t.byClient + t.byCoach + t.byOther + t.unattributed, t.sessions,
    'and the four splits account for every hour, so none is silently attributed');

  eq(t.fromSeries, 3, 'three of the hours belonged to a standing appointment');
  eq(t.after, 1, 'one was cancelled after the hour had begun');
  eq(t.under24h, 1, 'one inside a day');
  eq(t.over24h, 4, 'four with a day or more');
  eq(t.noticeUnknown, 1, 'one whose notice could not be read');
  eq(t.after + t.under24h + t.over24h + t.noticeUnknown, t.sessions,
    'and the bands account for every hour too');

  // The median is over the SIX readable notices — 9900, 19980, 30060, 60, 5760
  // and -60 — sorted: -60, 60, 5760, 9900, 19980, 30060. The middle pair is
  // 5760 and 9900, and an even-sized set floors the mean of the two so it can
  // never report more notice than either row it sits between.
  eq(t.medianNoticeMin, Math.floor((5760 + 9900) / 2), 'the median notice is the middle of the readable ones');
  eq(t.medianNoticeMin, 7830, 'stated as a number too, so the fixture and the rule cannot drift together');

  // An odd-sized set takes the middle value outright.
  eq(tallyCancellations([
    row({ startsAt: utc('2026-09-10T09:00:00.000'), cancelledAt: utc('2026-09-10T08:00:00.000') }),
    row({ startsAt: utc('2026-09-10T09:00:00.000'), cancelledAt: utc('2026-09-10T07:00:00.000') }),
    row({ startsAt: utc('2026-09-10T09:00:00.000'), cancelledAt: utc('2026-09-10T06:00:00.000') }),
  ]).medianNoticeMin, 120, 'the middle of three notices');

  // NULL, NEVER ZERO. A set with no readable notice has no middle, and zero
  // would read as "they all cancelled on the hour".
  eq(tallyCancellations([row({ cancelledAt: 'nonsense' })]).medianNoticeMin, null,
    'no readable notice means no median rather than a zero');
  eq(tallyCancellations([]).medianNoticeMin, null, 'and an empty set has none either');

  const empty = tallyCancellations([]);
  eq(empty.sessions, 0, 'an empty set counts nothing');
  eq(empty.actions, 0, 'and no actions');
}

/* ── 8. a median is not a mean, and one outlier must not move it ───────────── */
//
// The reason the field is a median: a cancellation made three months ahead
// drags an average past every value in the set, and the coach then reads a
// typical notice that has never once happened.
{
  const near = [10, 20, 30, 40].map((m) => row({
    startsAt: utc('2026-09-10T09:00:00.000'),
    cancelledAt: new Date(Date.parse(utc('2026-09-10T09:00:00.000')) - m * 60_000).toISOString(),
  }));
  const withOutlier = [...near, row({
    startsAt: utc('2026-09-10T09:00:00.000'),
    cancelledAt: utc('2026-06-10T09:00:00.000'),
  })];
  const median = tallyCancellations(withOutlier).medianNoticeMin!;
  ok(median <= 40, `a three-month outlier does not drag the middle past the real values — got ${median}`);
  eq(median, 30, 'the middle of five is the third');
}

/* ── 9. an empty list is four different sentences ──────────────────────────── */
//
// Only 'ready' may state that nothing was cancelled. This is the assertion the
// whole feature is graded on, and it is the one src/lib/sessionHistory.ts makes
// about the same shape one table over.
{
  for (const audience of ['coach', 'member'] as const) {
    const ready = emptyCancellationsLine('ready', audience);
    ok(/Nothing on record/.test(ready), `${audience}: 'ready' may state the record is empty`);

    const failed = emptyCancellationsLine('error', audience);
    ok(/could not read/.test(failed), `${audience}: 'error' says the read failed`);
    ok(/not a record of nothing/.test(failed), `${audience}: and refuses to be read as an empty record`);

    const loading = emptyCancellationsLine('loading', audience);
    ok(/Still reading/.test(loading), `${audience}: 'loading' says it is still reading`);

    const partial = emptyCancellationsLine('partial', audience);
    ok(/Only part/.test(partial), `${audience}: 'partial' says only part came back`);

    // The four must all be DIFFERENT. "No cancellations" and "we could not read
    // them" looking alike is the house rule this gate exists for.
    const said = new Set(ALL_STATUSES.map((s) => emptyCancellationsLine(s, audience)));
    eq(said.size, 4, `${audience}: loading, ready, partial and failed are four different sentences`);

    // Only 'ready' is allowed to be a claim about the person's record.
    for (const s of ALL_STATUSES) {
      if (s === 'ready') continue;
      ok(!/Nothing on record/.test(emptyCancellationsLine(s, audience)),
        `${audience}: '${s}' never states that nothing is on record`);
    }
  }

  // Whose record it is changes with the reader.
  ok(/your/.test(emptyCancellationsLine('loading', 'member')), 'the member is told about their own record');
  ok(/their/.test(emptyCancellationsLine('loading', 'coach')), 'the coach is told about the client’s');
}

/* ── 10. the refusals, and the figure that is not here ─────────────────────── */
{
  ok(/no cancellation rate/i.test(NO_RATE_NOTE), 'the rate is refused by name');
  ok(/cannot be one/i.test(NO_RATE_NOTE), 'and refused as impossible rather than as unimplemented');
  ok(/denominator|no set left to count them against/i.test(NO_RATE_NOTE),
    'and the reason given is the missing denominator');

  // No sentence this module hands a screen may carry a percentage. A count and
  // a duration are what the record supports; a percentage is the shape of the
  // number that would be wrong.
  const EVERY_SENTENCE = [
    NO_RATE_NOTE, BEST_EFFORT_NOTE, RECORD_START_NOTE, ENDED_SERIES_NOTE,
    COACH_SCOPE_NOTE, NOT_A_VERDICT_NOTE,
    ...ALL_STATUSES.map((s) => emptyCancellationsLine(s, 'coach')),
    ...ALL_STATUSES.map((s) => emptyCancellationsLine(s, 'member')),
    noticeLine(row()), noticeLine(row({ cancelledAt: utc('2026-09-10T09:35:00.000') })),
    noticeWords(120), noticeWords(-90), noticeWords(0),
    ...(['client', 'coach', 'other', 'unattributed'] as Actor[]).map((a) => actorLine(a, 'coach', 'Ben')),
  ];
  for (const s of EVERY_SENTENCE) {
    ok(!s.includes('%'), `no sentence carries a percentage — got ${JSON.stringify(s)}`);
    ok(s.trim().length > 0, 'and none of them is empty');
  }

  ok(/never refused/.test(BEST_EFFORT_NOTE), 'the write is best effort and says so');
  ok(/what was recorded/.test(BEST_EFFORT_NOTE), 'and the list is described as what was recorded');
  ok(/not evidence/.test(RECORD_START_NOTE), 'an absence before the record began is not evidence');
  ok(/not a cancellation/.test(ENDED_SERIES_NOTE), 'ending a standing appointment is not one of these');
  ok(/booked with you/.test(COACH_SCOPE_NOTE), 'the coach is told what their scope is');
  ok(/no coach was recorded/.test(COACH_SCOPE_NOTE), 'including the rows no coach can see at all');
  ok(/fact about an hour/.test(NOT_A_VERDICT_NOTE), 'and a cancellation is a fact about an hour');
  ok(/Nothing here is a score/.test(NOT_A_VERDICT_NOTE), 'rather than a score about a person');
}

if (errors.length) {
  console.error(`sessionCancellations.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 20)) console.error('  · ' + e);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  process.exit(1);
}
console.log('sessionCancellations.test.ts — ok');
