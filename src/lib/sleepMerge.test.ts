// Sleep merge (TF-01). Compile with tsc then run with node, under each of
// TZ=America/Los_Angeles, TZ=Pacific/Auckland and TZ=Asia/Dubai.
//
// The assertions that matter are the ones about disagreement and about absence.
// A test that only merged one cooperative provider would have passed against
// the single hard-coded source this replaces, and the two bugs worth catching
// here are the ones this codebase has shipped before: a night nobody recorded
// rendering as a confident zero, and a failed read being indistinguishable from
// a night of no sleep.
import {
  nightKey, recentNights, foldSleepIntervals, nightsFromIntervals,
  mergeSleepNight, mergeSleepNights, markNightsUnread, formatSleepHours,
  AGREEMENT_TOLERANCE_MIN,
  type SleepReading, type SleepRead,
} from './sleepMerge';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const TZ = process.env.TZ || '(system)';

const pad = (n: number) => String(n).padStart(2, '0');
const localYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** An instant expressed by its LOCAL wall clock, so the test means the same
 *  thing in every zone it runs in. */
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

const reading = (over: Partial<SleepReading> & { sourceId: string; minutesAsleep: number }): SleepReading => ({
  provider: 'apple',
  sourceName: over.sourceId,
  family: 'unknown',
  basis: 'asleep',
  night: '2026-08-03',
  ...over,
});

// ── which night does this sleep belong to ────────────────────────────────────
// Every one of these is a wake-up time on the 3rd of August, written as a local
// wall clock. Taking iso.slice(0, 10) instead would move the 23:55 case forward
// a day in Los Angeles and the 00:05 case back a day in Auckland and Dubai.
for (const [h, m] of [[0, 5], [6, 30], [13, 0], [23, 55]] as const) {
  ok(nightKey(at(2026, 8, 3, h, m)) === '2026-08-03',
    `[${TZ}] a wake-up at ${pad(h)}:${pad(m)} local on 3 Aug belongs to 2026-08-03, got ${nightKey(at(2026, 8, 3, h, m))}`);
}
// A bare date-only string is already a calendar day and must survive untouched;
// this is the localDate.ts trap, where Date.parse would resolve it to UTC
// midnight and hand back the day before west of Greenwich.
ok(nightKey('2026-08-03') === '2026-08-03', `[${TZ}] a date-only night must not shift, got ${nightKey('2026-08-03')}`);
ok(nightKey(null) === null, 'no timestamp is no night, not today');
ok(nightKey('not a date') === null, 'an unparseable timestamp is no night');

// ── the window of nights we ask about ───────────────────────────────────────
const nights = recentNights(7, new Date(2026, 2, 1, 12));
ok(nights.length === 7, `seven nights requested, got ${nights.length}`);
ok(nights[0] === '2026-03-01', `today is first, got ${nights[0]}`);
ok(nights[1] === '2026-02-28', `and the day before crosses the month, got ${nights[1]}`);
ok(new Set(nights).size === 7, `[${TZ}] every night is distinct — a DST day must not repeat or skip one`);
ok(recentNights(3)[0] === localYmd(new Date()), `[${TZ}] the first night defaults to today in local time`);

// ── folding a night that arrives as overlapping samples ─────────────────────
// HealthKit's shape: one INBED sample spanning the whole night, with the asleep
// stages inside it. Summing the durations reports 14h for a 7h night.
const folded = foldSleepIntervals([
  { start: at(2026, 8, 2, 23, 0), end: at(2026, 8, 3, 6, 0) },
  { start: at(2026, 8, 2, 23, 10), end: at(2026, 8, 3, 2, 0) },
  { start: at(2026, 8, 3, 2, 10), end: at(2026, 8, 3, 5, 50) },
]);
ok(folded.length === 1, `overlapping samples fold into one span, got ${folded.length}`);
ok(Date.parse(folded[0].end) - Date.parse(folded[0].start) === 7 * 3600000,
  'the folded span is the seven hours in bed, not the sum of the samples');
ok(foldSleepIntervals([{ start: at(2026, 8, 3, 1, 0), end: at(2026, 8, 3, 1, 0) }]).length === 0,
  'a zero-length sample is a malformed row, not sleep');

// ── a night that straddles midnight is one night ────────────────────────────
const straddle = nightsFromIntervals([
  { start: at(2026, 8, 2, 23, 40), end: at(2026, 8, 2, 23, 52) },
  { start: at(2026, 8, 3, 0, 11), end: at(2026, 8, 3, 6, 30) },
]);
ok(straddle.length === 1, `[${TZ}] waking briefly at midnight is still one night, got ${straddle.length}`);
ok(straddle[0]?.night === '2026-08-03', `[${TZ}] it belongs to the morning it ended, got ${straddle[0]?.night}`);
// 12 minutes + 6h19 asleep; the 19-minute awake gap is not slept through.
ok(straddle[0]?.minutesAsleep === 391, `the awake gap is excluded from the total, got ${straddle[0]?.minutesAsleep}`);

const twoNights = nightsFromIntervals([
  { start: at(2026, 8, 1, 23, 0), end: at(2026, 8, 2, 7, 0) },
  { start: at(2026, 8, 2, 23, 0), end: at(2026, 8, 3, 6, 0) },
]);
ok(twoNights.length === 2, `two nights a day apart stay two nights, got ${twoNights.length}`);
ok(twoNights[0]?.night === '2026-08-03' && twoNights[1]?.night === '2026-08-02', 'newest night first');

// ── both present and differing ──────────────────────────────────────────────
const ring = reading({ provider: 'oura', sourceId: 'oura', sourceName: 'Oura Ring', family: 'oura', minutesAsleep: 424 });
const watch = reading({ provider: 'apple', sourceId: 'com.apple.health.watch', sourceName: 'Apple Watch', family: 'watch', minutesAsleep: 392 });
const disagree = mergeSleepNight('2026-08-03', [watch, ring]);
ok(disagree.outcome === 'measured', 'two devices that disagree still measured the night');
ok(disagree.minutesAsleep === 424, `the ring's own figure is shown, got ${disagree.minutesAsleep}`);
ok(disagree.minutesAsleep !== 408, 'the mean of the two must never be the answer — no device reported 408');
ok(disagree.source?.sourceName === 'Oura Ring', `the figure is attributed to the device that reported it, got ${disagree.source?.sourceName}`);
ok(disagree.agreement === 'conflicting', `32 minutes apart is a conflict, got ${disagree.agreement}`);
ok(disagree.spreadMin === 32, `the screen can say how far apart they were, got ${disagree.spreadMin}`);
ok(disagree.others.length === 1 && disagree.others[0].sourceName === 'Apple Watch',
  'the losing reading stays visible rather than being dropped');

// ── both present and close enough to corroborate ────────────────────────────
const close = mergeSleepNight('2026-08-03', [ring, { ...watch, minutesAsleep: 424 - AGREEMENT_TOLERANCE_MIN }]);
ok(close.agreement === 'corroborated', `within tolerance is agreement, got ${close.agreement}`);
ok(close.minutesAsleep === 424, 'agreement does not licence averaging either');
const justOver = mergeSleepNight('2026-08-03', [ring, { ...watch, minutesAsleep: 424 - AGREEMENT_TOLERANCE_MIN - 1 }]);
ok(justOver.agreement === 'conflicting', 'one minute past the tolerance is a conflict, not agreement');

// ── the same device reaching us twice is not corroboration ──────────────────
// Oura's app writes its nights into Apple Health, so this pair is one
// measurement seen down two pipes. Calling it agreement would invent confidence
// that nothing supports.
const ouraViaHealth = reading({ provider: 'apple', sourceId: 'com.ouraring.oura', sourceName: 'Oura (via Health)', family: 'oura', minutesAsleep: 424 });
const echoed = mergeSleepNight('2026-08-03', [ring, ouraViaHealth]);
ok(echoed.agreement === 'single', `one device down two pipes is not two devices, got ${echoed.agreement}`);
ok(echoed.others.length === 1, 'the duplicate is still listed, just not counted as a second opinion');
ok(echoed.spreadMin === null, 'and there is no spread to report between a reading and itself');

// ── time in bed is not sleep ────────────────────────────────────────────────
// An app that writes only HealthKit's "in bed" samples has recorded something
// real, so it is kept — but it answers a different question and must not be
// shown in preference to a staged reading, nor be allowed to confirm one.
const inBed = reading({ sourceId: 'com.example.bedtime', sourceName: 'Bedtime', family: 'phone', basis: 'in-bed', minutesAsleep: 448 });
const mixed = mergeSleepNight('2026-08-03', [inBed, watch]);
ok(mixed.source?.sourceName === 'Apple Watch', `a staged reading is shown ahead of a time-in-bed one, got ${mixed.source?.sourceName}`);
ok(mixed.minutesAsleep === 392, 'and it is the staged figure, not the longer one');
ok(mixed.agreement === 'single', `time in bed cannot corroborate time asleep, got ${mixed.agreement}`);
ok(mixed.others.length === 1, 'the in-bed reading is still shown beside it rather than dropped');
const onlyInBed = mergeSleepNight('2026-08-03', [inBed]);
ok(onlyInBed.outcome === 'measured' && onlyInBed.source?.basis === 'in-bed',
  'a source that only records time in bed is not reported as a night nobody recorded');

// ── only one has a reading ──────────────────────────────────────────────────
const alone = mergeSleepNight('2026-08-03', [watch]);
ok(alone.outcome === 'measured' && alone.minutesAsleep === 392, 'a single device still gives a real figure');
ok(alone.agreement === 'single', `one reading is never corroborated, got ${alone.agreement}`);
ok(alone.others.length === 0, 'and there is nothing else to show beside it');

// ── neither has a reading ───────────────────────────────────────────────────
const nobody = mergeSleepNight('2026-08-03', []);
ok(nobody.outcome === 'no-record', `a night nobody recorded is no-record, got ${nobody.outcome}`);
ok(nobody.minutesAsleep === null, 'and it is null — never 0, never last night carried forward');
ok(formatSleepHours(nobody.minutesAsleep) === '—', 'which renders as a dash');

// ── a read that FAILED is unknown, not zero ─────────────────────────────────
const brokeAll = mergeSleepNight('2026-08-03', [], ['whoop']);
ok(brokeAll.outcome === 'unknown', `a failed read makes the night unknown, got ${brokeAll.outcome}`);
ok(brokeAll.minutesAsleep === null, 'an unknown night is still not a zero');
ok(brokeAll.failed.join() === 'whoop', 'and the screen is told which device it could not reach');

// ── one failed and one present ──────────────────────────────────────────────
const partial = mergeSleepNight('2026-08-03', [watch], ['whoop']);
ok(partial.outcome === 'measured' && partial.minutesAsleep === 392, 'the device that answered still counts');
ok(partial.agreement === 'single', 'a failed read cannot corroborate anything');
ok(partial.failed.join() === 'whoop', 'but the screen can still say WHOOP was unreachable, so this may be incomplete');

// ── zero is not a reading ───────────────────────────────────────────────────
const zeroed = mergeSleepNight('2026-08-03', [reading({ sourceId: 'buggy', minutesAsleep: 0 })]);
ok(zeroed.outcome === 'no-record' && zeroed.minutesAsleep === null,
  'a zero-minute row is a mapping that had nothing to say, not a sleepless night');

// ── the whole window ────────────────────────────────────────────────────────
const reads: SleepRead[] = [
  { provider: 'oura', status: 'ready', readings: [{ ...ring, night: '2026-08-03' }] },
  { provider: 'apple', status: 'ready', readings: [{ ...watch, night: '2026-08-03' }, { ...watch, night: '2026-08-01', minutesAsleep: 401 }] },
  { provider: 'fitbit', status: 'unsupported', readings: [], reason: 'no server-side reader yet' },
];
const window3 = mergeSleepNights(reads, ['2026-08-03', '2026-08-02', '2026-08-01']);
ok(window3.length === 3, `every requested night gets a row, got ${window3.length}`);
ok(window3[1].outcome === 'no-record', `the night in the middle is a dash, got ${window3[1].outcome}`);
ok(window3[1].failed.length === 0, 'an unsupported provider is not a failed read, so the dash stays honest');
ok(window3[2].source?.sourceName === 'Apple Watch' && window3[2].minutesAsleep === 401, 'older nights are attributed too');
const windowBroken = mergeSleepNights(
  [{ provider: 'whoop', status: 'error', readings: [], reason: 'server did not answer' }],
  ['2026-08-03'],
);
ok(windowBroken[0].outcome === 'unknown', 'an errored provider turns an empty night into an unknown one');

// ── the walk itself failing, which arrives as no failures at all ────────────
//
// The failure `mergeSleepNights` was built for is one provider throwing: it
// arrives as an 'error' row and the nights come back unknown, as asserted just
// above. The other failure has no rows to arrive in. When the read never
// completes, deviceSleep.tsx sets `reads: []`, and an empty `reads` produces an
// empty `failed` — so the merge below sees no readings and no failures and
// declares the whole week 'no-record'. Confident emptiness out of a read that
// never happened, which is the exact bug this file family was written against.
const walkFailed = mergeSleepNights([], ['2026-08-03', '2026-08-02']);
ok(walkFailed.every((n) => n.outcome === 'no-record'),
  'a merge given nothing cannot know a read failed — which is why the caller has to say so');

const unread = markNightsUnread(walkFailed, ['whoop', 'oura']);
ok(unread.length === 2, `every night survives the marking, got ${unread.length}`);
ok(unread.every((n) => n.outcome === 'unknown'),
  `a night from a failed walk is unknown, not empty, got ${unread.map((n) => n.outcome).join()}`);
ok(unread.every((n) => n.minutesAsleep === null), 'and still never a zero');
ok(unread[0].failed.join() === 'whoop,oura', 'the devices that were going to be asked are named');

// The invariant that keeps this from becoming the opposite fabrication: a real
// figure that DID reach us is not erased by a later step falling over. Marking
// only ever adds doubt about the nights nobody answered for; it never discards
// a measurement.
const measured = mergeSleepNights(
  [{ provider: 'apple', status: 'ready', readings: [{ ...watch, night: '2026-08-03' }] }],
  ['2026-08-03', '2026-08-02'],
);
const markedMixed = markNightsUnread(measured, ['apple']);
ok(markedMixed[0].outcome === 'measured' && markedMixed[0].minutesAsleep === 392,
  `a night a device actually measured keeps its figure, got ${markedMixed[0].outcome}/${markedMixed[0].minutesAsleep}`);
ok(markedMixed[0].source?.sourceName === 'Apple Watch', 'and keeps its attribution, so the screen can still name it');
ok(markedMixed[0].failed.join() === 'apple', 'while still recording that the night may be incomplete');
ok(markedMixed[1].outcome === 'unknown', 'and the night nobody answered for is the one that turns unknown');

// Marking with nobody named is still a failure. The nights are unknown because
// the read did not happen, not because of who was in it — an empty `asked` must
// not quietly hand back a confident 'no-record'.
ok(markNightsUnread(walkFailed)[0].outcome === 'unknown',
  'a failed walk with no providers named is still a failed walk');
// Idempotent, because a screen re-rendering must not accumulate duplicates in
// the list of devices it names to the client.
ok(markNightsUnread(unread, ['whoop', 'oura'])[0].failed.join() === 'whoop,oura',
  'marking twice names each device once');

// ── formatting ──────────────────────────────────────────────────────────────
ok(formatSleepHours(432) === '7h 12m', `432 minutes is 7h 12m, got ${formatSleepHours(432)}`);
ok(formatSleepHours(420) === '7h', `a whole number of hours drops the minutes, got ${formatSleepHours(420)}`);
ok(formatSleepHours(null) === '—' && formatSleepHours(0) === '—' && formatSleepHours(NaN) === '—',
  'nothing knowable renders as a dash');

if (errors.length) {
  console.error(`sleepMerge.test [TZ=${TZ}] — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`sleepMerge.test [TZ=${TZ}] — all assertions passed`);
