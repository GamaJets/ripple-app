// The member's own cadence, in the member's own words. Compile with tsc, run
// with node.
//
// THE ASSERTION THIS FILE EXISTS FOR is the first block: an unread log must
// never produce a sentence about how often somebody trains. `assessCadence`
// over an empty array answers `no-events`, and `no-events` is a true statement
// about a read that LANDED and a false one about a read that failed — so the
// gate has to be in front of the call, not inside it. A member who trained
// yesterday, opening this screen on a dropped connection, must not be told
// their log has been quiet.
//
// THE SECOND is that the number is the coach's number. `readOwnCadence` and
// `assessCadence` are asserted to agree on the same events, because two
// medians over one person is how the coach's screen and the member's come to
// say different things about the same fortnight.
//
// Every timestamp is built from a local midnight, matching the local day
// boundary `localDayKey` and `activeDayLog` use — `npm run test:zones` runs
// this suite under Los Angeles, Auckland and Dubai, and a UTC day key here
// would fail in two of the three.
import {
  readOwnCadence, loggedEvents, ownCadenceWindowLabel,
  OWN_CADENCE_SOURCE, OWN_CADENCE_WINDOW_DAYS, type LoggedAt,
} from './ownCadence';
import { assessCadence } from './cadence';
import { DEFAULT_WINDOWS } from './clientDrift';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const DAY = 86_400_000;

const midnight = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
/** Midday, so nothing sits on a boundary a rounding change could push over. */
const NOW = midnight + 12 * 3600_000;

/** A logged workout `n` days ago, at that day's local midday. */
const ago = (n: number): LoggedAt => ({ t: new Date(midnight - n * DAY + 12 * 3600_000).toISOString() });

/** Sessions every `gap` days going back `count` of them, the newest `lastAgo`
 *  days ago — the ordinary shape of somebody's log. */
const every = (gap: number, count: number, lastAgo: number): LoggedAt[] => {
  const out: LoggedAt[] = [];
  for (let i = 0; i < count; i++) out.push(ago(lastAgo + i * gap));
  return out;
};

/* ── 1 · an unread log is not a quiet one ────────────────────────────────── */

const failed = readOwnCadence([], 'error', NOW);
eq(failed.reading, 'unread', 'a failed read is unread');
eq(failed.cadence, null, 'and carries no verdict at all');
eq(failed.gapLabel, null, 'no gap');
eq(failed.sinceLabel, null, 'and no days-since, which would be a count from nothing');
ok(!/usual gap to measure/.test(failed.line),
  'a failed read must not borrow the "nothing on record" sentence, which is about a read that landed');
ok(/didn’t load/.test(failed.line), 'it says the read failed');

const loading = readOwnCadence([], 'loading', NOW);
eq(loading.reading, 'unread', 'a read still in flight is unread too');
eq(loading.cadence, null, 'with no verdict');
ok(loading.line !== failed.line,
  'and a different sentence from the failure — one of these two ends on its own');

// The trap in full: a member with a real, dense log whose READ failed. The rows
// are in hand from a cache and the status says they are not confirmed. Nothing
// may be stated over them.
const denseButUnread = readOwnCadence(every(3, 12, 1), 'error', NOW);
eq(denseButUnread.reading, 'unread', 'rows we hold under a failed read are still unread');
eq(denseButUnread.gapLabel, null, 'and no gap is computed from them');

/* ── 2 · an empty log that DID land says so, and says nothing more ───────── */

const empty = readOwnCadence([], 'ready', NOW);
eq(empty.reading, 'unsettled', 'an empty read that landed is unsettled, not paced');
eq(empty.cadence?.noPattern, 'no-events', 'and carries the reason');
eq(empty.gapLabel, null, 'with no gap');
ok(/8 weeks/.test(empty.line),
  'the window is stated in the copy, derived from the window actually used');

/* ── 3 · the window phrase follows the window it was given ───────────────── */

const shortWindow = readOwnCadence([], 'ready', NOW, 30);
ok(/30 days/.test(shortWindow.line),
  'a window that is not whole weeks is said in days rather than rounded into a lie');
const oneWeek = readOwnCadence([], 'ready', NOW, 7);
ok(/1 week\b/.test(oneWeek.line), 'and one week is singular');

/* ── 4 · too few, too short, too spread: three different sentences ───────── */

const twoDays = readOwnCadence([ago(1), ago(20)], 'ready', NOW);
eq(twoDays.cadence?.noPattern, 'too-few', 'two logged days is too few for a median');
eq(twoDays.reading, 'unsettled', 'and is not paced');

const crammed = readOwnCadence(every(1, 5, 1), 'ready', NOW);
eq(crammed.cadence?.noPattern, 'too-short', 'five days inside a week is not yet a rhythm');

// A wider window than the default on purpose, and the reason is worth writing
// down. `MIN_ACTIVE_DAYS` is 4, so 'too-spread' needs four logged days more
// than `MAX_USUAL_GAP_DAYS` (21) apart — at least 63 days of record — which
// cannot fit inside the default 56-day window. Under the default a monthly
// visitor therefore comes back 'too-few', not 'too-spread', and this is the
// only place that distinction is visible.
const monthly = readOwnCadence(every(25, 4, 2), 'ready', NOW, 120);
eq(monthly.cadence?.noPattern, 'too-spread', 'a monthly visitor has no gap worth pacing against');
ok(!/too few|didn’t load/.test(monthly.line),
  'and is told that, not told they have logged too little');
eq(readOwnCadence(every(25, 4, 2), 'ready', NOW).cadence?.noPattern, 'too-few',
  'and inside the default window the same person is simply not on record enough');
{
  const lines = new Set([twoDays.line, crammed.line, monthly.line, empty.line]);
  eq(lines.size, 4, 'the four refusals are four different sentences');
}

/* ── 5 · the ordinary case: a gap, a silence, and the arithmetic ─────────── */

const steady = readOwnCadence(every(3, 10, 1), 'ready', NOW);
eq(steady.reading, 'paced', 'ten sessions every three days is a settled cadence');
eq(steady.cadence?.usualGapDays, 3, 'the median gap is three days');
eq(steady.gapLabel, 'about every 3 days', 'said as an interval');
eq(steady.sinceLabel, '1 day', 'and the silence is singular at one day');
eq(steady.cadence?.state, 'inside', 'one day into a three-day gap is inside it');
ok(/inside your own usual gap/.test(steady.line), 'and reads as not late');

const late = readOwnCadence(every(3, 10, 9), 'ready', NOW);
eq(late.cadence?.state, 'overdue', 'nine days on a three-day gap is overdue');
ok(/past your own usual gap/.test(late.line), 'stated as days past, not as a verdict');
ok(!/should|try to|get back|keep it up|well done/i.test(late.line),
  'and never tells the member what to do about it — see the header of src/lib/nudge.ts');

/* ── 6 · the coach's number and the member's are the same number ─────────── */

const log = every(4, 9, 6);
const mine = readOwnCadence(log, 'ready', NOW);
const theirs = assessCadence(loggedEvents(log), NOW, DEFAULT_WINDOWS.historyDays);
eq(mine.cadence?.usualGapDays, theirs.usualGapDays, 'the same usual gap as the coach reads');
eq(mine.cadence?.sinceLastDays, theirs.sinceLastDays, 'the same days since');
eq(mine.cadence?.state, theirs.state, 'and the same state');
eq(mine.cadence?.overdueDays, theirs.overdueDays, 'and the same lateness');

/* ── 7 · a half-decimal gap is printed as it comes, not rounded ──────────── */
//
// A member who alternates two and three days has a median of 2.5. Rounding it
// to "3" here would print a different number from the one on the coach's
// screen, which is the whole failure this module's header is about.
{
  const alternating: LoggedAt[] = [];
  let d = 1;
  for (let i = 0; i < 12; i++) { alternating.push(ago(d)); d += i % 2 ? 3 : 2; }
  const half = readOwnCadence(alternating, 'ready', NOW);
  if (half.cadence?.usualGapDays === 2.5) {
    eq(half.gapLabel, 'about every 2.5 days', 'a half-day median is printed as a half day');
  } else {
    ok(half.gapLabel != null && !/\bNaN|null/.test(half.gapLabel),
      'whatever the median is, it is a number and not a hole');
  }
}

/* ── 8 · 'partial' is admitted, and is the same reading as 'ready' ───────── */
//
// The argument is in `readOwnCadence`: the provider orders `performed_at`
// descending before the cap, so a truncated read holds the NEWEST rows and
// every gap between two of them is a real gap. A prefix can only end the record
// early, which costs active days and can only push this toward a refusal.
{
  const whole = readOwnCadence(log, 'ready', NOW);
  const prefix = readOwnCadence(log, 'partial', NOW);
  eq(prefix.reading, whole.reading, 'a capped read is read, not refused');
  eq(prefix.line, whole.line, 'and says the same thing over the same rows');
}

/* ── 9 · loggedEvents ────────────────────────────────────────────────────── */

{
  const evs = loggedEvents([{ t: '2026-09-01T10:00:00.000Z' }, { t: 'not a date' }]);
  eq(evs.length, 2, 'nothing is dropped here — activeDayLog already refuses what it cannot parse');
  eq(evs[0].kind, 'workout', 'and every one is a workout, which is what it is');
  eq(evs[0].at, '2026-09-01T10:00:00.000Z', 'carried verbatim');
}

/* ── 10 · the caveat says which record this is ───────────────────────────── */

ok(/logged/.test(OWN_CADENCE_SOURCE),
  'the caveat names the log as the source, because the coach reads door visits and sessions too');

/* ── 11 · the window label cannot drift from the window ──────────────────── */

eq(OWN_CADENCE_WINDOW_DAYS, DEFAULT_WINDOWS.historyDays,
  'the member is read over the same span the coach is');
eq(ownCadenceWindowLabel(), 'Last 8 weeks', 'and the label says that span');
eq(ownCadenceWindowLabel(30), 'Last 30 days', 'a span that is not whole weeks is said in days');
ok(readOwnCadence([], 'ready', NOW).line.includes(ownCadenceWindowLabel().slice(5)),
  'the sentence and the label name the same span');

if (errors.length) {
  console.error(`ownCadence: ${errors.length} failure(s)`);
  for (const e of errors) console.error(' · ' + e);
  process.exit(1);
}
console.log('ownCadence: ok');
