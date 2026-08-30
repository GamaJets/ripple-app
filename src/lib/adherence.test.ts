// Coach-side adherence. Compile with tsc then run with node.
//
// The assertions that matter here are the ones about ABSENCE. A test suite that
// only checks "three ticks in three days is 3 of 3" would pass against the
// version of this module that reports "2 of 28" for a line added on Thursday,
// which is the specific wrong sentence this feature exists not to print.
import {
  recentWindow, summariseAdherence, setItemLine, dayLabel, WINDOW_DAYS, dayOf,
  type ChecklistRow, type TickRow, type SetItemAdherence,
} from './adherence';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

// A fixed "now" so every window below is the same one. Local midday, because
// these are calendar days in the coach's own zone and a midnight boundary would
// make the suite's answer depend on where it is run.
const NOW = new Date(2026, 7, 30, 12, 0, 0); // 30 Aug 2026
const W = recentWindow(NOW);

// ── the window ─────────────────────────────────────────────────────────────
ok(W.days === WINDOW_DAYS, `the window is ${WINDOW_DAYS} days, got ${W.days}`);
ok(W.end === '2026-08-29', `the window ends YESTERDAY, not today — today is not over yet; got ${W.end}`);
ok(W.start === '2026-08-02', `28 complete days back from the 29th is the 2nd, got ${W.start}`);
// Four whole weeks means each weekday appears exactly four times, which is the
// entire argument for 28 over 30. Written as an assertion so a later "round it
// to a month" cannot pass quietly.
{
  const counts = new Array(7).fill(0);
  for (let i = 0; i < W.days; i++) counts[new Date(2026, 7, 2 + i).getDay()]++;
  ok(counts.every((c) => c === 4), `every weekday must appear the same number of times, got ${counts.join(',')}`);
}
// A window that spans the spring clock change is still 28 days. Stepping a Date
// by day does this; subtracting 28 * 86_400_000 does not.
{
  const dst = recentWindow(new Date(2026, 2, 20, 12, 0, 0));
  ok(dst.start === '2026-02-20' && dst.end === '2026-03-19', `a window over a clock change must still be 28 whole days, got ${dst.start}..${dst.end}`);
}

const item = (over: Partial<ChecklistRow> & { id: string }): ChecklistRow => ({
  label: 'Ten minutes of hip mobility', icon: '📌', active: true,
  created_at: '2026-01-01T09:00:00Z', updated_at: '2026-01-01T09:00:00Z', ...over,
});
const tick = (habit: string, day: string): TickRow => ({ habit, done_on: day });
const find = (s: SetItemAdherence[], id: string) => s.find((x) => x.id === id)!;

// ── an item older than the window is measured over the whole window ────────
{
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'a' })],
    ticks: ['2026-08-03', '2026-08-04', '2026-08-05'].map((d) => tick('coach:a', d)),
  });
  const a = find(s.set, 'a');
  ok(a.eligibleDays === 28, `an item that predates the window is measured over all 28 days, got ${a.eligibleDays}`);
  ok(a.ticked === 3, `three ticks is three, got ${a.ticked}`);
  ok(a.lastTicked === '2026-08-05', `last ticked is the newest tick, got ${a.lastTicked}`);
}

// ── THE ONE: an item added on Thursday is not judged on the days before it ──
{
  const s = summariseAdherence({
    window: W,
    // Added two days before the window's last complete day.
    items: [item({ id: 'new', created_at: new Date(2026, 7, 27, 18, 0, 0).toISOString() })],
    ticks: [tick('coach:new', '2026-08-28')],
  });
  const a = find(s.set, 'new');
  ok(a.eligibleDays === 3, `27th, 28th and 29th is three days on the list, got ${a.eligibleDays}`);
  ok(a.ticked === 1, `one tick, got ${a.ticked}`);
  ok(a.from === '2026-08-27', `the count starts the day it was created, got ${a.from}`);
  ok(!setItemLine(a).includes('28'), `a line added two days ago must never read as anything out of 28: "${setItemLine(a)}"`);
}

// ── a tick dated before the item existed does not make the arithmetic lie ──
{
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'new', created_at: new Date(2026, 7, 28, 9, 0, 0).toISOString() })],
    // Impossible through the app, and the clamp is what keeps `skippedDays`
    // from going negative if it ever happens.
    ticks: [tick('coach:new', '2026-08-10'), tick('coach:new', '2026-08-28')],
  });
  const a = find(s.set, 'new');
  ok(a.ticked === 1, `only ticks from the days it was on the list count, got ${a.ticked}`);
  ok((a.skippedDays ?? -1) >= 0, `skipped days can never be negative, got ${a.skippedDays}`);
}

// ── an item created today has no complete day under it ─────────────────────
{
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'today', created_at: new Date(2026, 7, 30, 8, 0, 0).toISOString() })],
    ticks: [],
  });
  const a = find(s.set, 'today');
  ok(a.eligibleDays === null, 'an item created today has no denominator at all');
  ok(a.noRate === 'too-new', `and says why, got ${a.noRate}`);
  ok(a.silentDays === null && a.skippedDays === null, 'and claims nothing about days it was not on the list');
}

// ── a retired item: a count, never a rate ──────────────────────────────────
{
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'off', active: false, updated_at: '2026-08-20T10:00:00Z' })],
    ticks: ['2026-08-04', '2026-08-06'].map((d) => tick('coach:off', d)),
  });
  const a = find(s.set, 'off');
  ok(a.noRate === 'retired', `an inactive item is reported as off the list, got ${a.noRate}`);
  ok(a.eligibleDays === null, 'and gets no denominator: updated_at dates the last change, not the removal');
  ok(a.ticked === 2, `its real ticks are still counted, got ${a.ticked}`);
  ok(!/\d+ of \d+/.test(setItemLine(a)), `a retired item must not read as a fraction: "${setItemLine(a)}"`);
}

// ── an undated row claims nothing ──────────────────────────────────────────
{
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'u', created_at: '' })],
    ticks: [tick('coach:u', '2026-08-11')],
  });
  const a = find(s.set, 'u');
  ok(a.noRate === 'undated' && a.eligibleDays === null, 'a row with no readable created_at gets no denominator');
  ok(a.ticked === 1, `and its ticks are still a count, got ${a.ticked}`);
}

// ── silence and skipping are separated, and never merged ───────────────────
{
  // Five days of app use in the window: on three of them this item was ticked,
  // on two the client ticked something else. Every other day is silent.
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'a' })],
    ticks: [
      tick('coach:a', '2026-08-10'), tick('coach:a', '2026-08-11'), tick('coach:a', '2026-08-12'),
      tick('water', '2026-08-13'), tick('protein', '2026-08-14'),
    ],
  });
  const a = find(s.set, 'a');
  ok(s.seenDays === 5, `five days carry a tick of something, got ${s.seenDays}`);
  ok(s.silentDays === 23, `the other 23 days of the window are silent, got ${s.silentDays}`);
  ok(a.skippedDays === 2, `only the two days they were in the app and did not tick this are misses, got ${a.skippedDays}`);
  ok(a.silentDays === 23, `and the 23 unknown days are reported as unknown, got ${a.silentDays}`);
  ok((a.skippedDays ?? 0) + (a.silentDays ?? 0) + a.ticked === a.eligibleDays, 'the three buckets must account for every eligible day exactly once');
  const line = setItemLine(a);
  ok(line.includes('3 of the 28'), `the fraction is ticks out of days on the list: "${line}"`);
  ok(line.includes('23'), `and the silent days are named in the same breath: "${line}"`);
}

// ── a client who has not opened the app at all ─────────────────────────────
{
  const s = summariseAdherence({ window: W, items: [item({ id: 'a' })], ticks: [] });
  const a = find(s.set, 'a');
  ok(s.seenDays === 0 && s.silentDays === 28, 'no ticks at all means the whole window is silent');
  ok(a.skippedDays === 0, `nothing can be called a miss when there is no evidence they were ever in the app, got ${a.skippedDays}`);
  ok(a.ticked === 0 && a.silentDays === 28, 'the zero is a count of ticks, and every day it might belong to is flagged unknown');
}

// ── derived items: a count, and never a rate ───────────────────────────────
{
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'a' })],
    ticks: [
      tick('water', '2026-08-10'), tick('water', '2026-08-11'), tick('water', '2026-08-12'),
      tick('train', '2026-08-10'),
      tick('somethingNew', '2026-08-11'),
    ],
  });
  ok(s.derived.length === 3, `every non-coach id ticked in the window is listed, got ${s.derived.length}`);
  ok(s.derived[0].id === 'water' && s.derived[0].ticked === 3, 'most-ticked first');
  ok(!Object.prototype.hasOwnProperty.call(s.derived[0], 'eligibleDays'),
    'a derived item carries no denominator: the coach cannot know which days it was on the list');
  ok(s.derived[0].label === 'Water', `known ids are named, got ${s.derived[0].label}`);
  ok(s.derived.some((d) => d.id === 'somethingNew' && d.label === 'somethingNew'),
    'an id this module has never heard of is shown under its own id rather than dropped');
  ok(s.derived.every((d) => d.id !== 'coach:a'), 'a coach item never leaks into the derived list');
}

// ── a deleted line's ticks are counted, and never labelled ─────────────────
{
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'a' })],
    ticks: [tick('coach:gone', '2026-08-10'), tick('coach:gone', '2026-08-11'), tick('coach:a', '2026-08-10')],
  });
  ok(s.deletedLineTicks === 2, `ticks against a row that no longer exists are counted, got ${s.deletedLineTicks}`);
  ok(s.derived.every((d) => !d.id.startsWith('coach:')), 'and are never presented as one of the client\'s own targets');
}

// ── the read is not trusted to have filtered itself ────────────────────────
{
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'a' })],
    ticks: [
      tick('coach:a', '2026-07-01'),          // before the window
      tick('coach:a', '2026-08-30'),          // today, which is not over
      tick('coach:a', '2026-08-10'),
      tick('coach:a', '2026-08-10'),          // a repeat the unique index forbids
      tick('', '2026-08-10'),                 // no habit
      tick('coach:a', 'not-a-date'),
    ],
  });
  const a = find(s.set, 'a');
  ok(a.ticked === 1, `one day inside the window, counted once, got ${a.ticked}`);
  ok(s.seenDays === 1, `and one day of evidence of app use, got ${s.seenDays}`);
}

// ── the copy never becomes a score ─────────────────────────────────────────
{
  const s = summariseAdherence({
    window: W,
    items: [item({ id: 'a' }), item({ id: 'b', active: false }), item({ id: 'c', created_at: new Date(2026, 7, 30).toISOString() })],
    ticks: [tick('coach:a', '2026-08-10')],
  });
  for (const a of s.set) {
    const line = setItemLine(a);
    ok(!line.includes('%'), `no percentage anywhere: "${line}"`);
    ok(!/\b0 of 0\b/.test(line), `and never a fraction over nothing: "${line}"`);
    ok(!/fail|poor|bad|only/i.test(line), `and never a verdict on the person: "${line}"`);
    ok(line.trim().length > 0 && line.trim().endsWith('.'), 'every line is a finished sentence');
  }
}

// ── dayOf reads a timestamp as a LOCAL calendar day ────────────────────────
ok(dayOf('2026-08-27') === '2026-08-27', 'a bare date is itself');
ok(dayOf(new Date(2026, 7, 27, 23, 30).toISOString()) === '2026-08-27',
  'a late-evening timestamp belongs to the day it was local evening on, not to tomorrow in UTC');
ok(dayOf(null) === null && dayOf('nonsense') === null, 'an unreadable date is null, not today');

// ── the heading date is the day it says, in every zone ─────────────────────
ok(dayLabel('2026-08-29') === '29 Aug', `a window's end reads as its own date, got ${dayLabel('2026-08-29')}`);
ok(dayLabel('2026-08-01') === '1 Aug', `the first of the month must not read as the 31st of July, got ${dayLabel('2026-08-01')}`);
ok(dayLabel('') === '—', 'and an unreadable one is a dash rather than an invented day');

if (errors.length) {
  console.error(`adherence.test: ${errors.length} failure(s)`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('adherence.test: ok');
