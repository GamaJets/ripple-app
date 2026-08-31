// Vendor sleep parsing (TF-01, gap 1). Compile with tsc then run with node,
// under each of TZ=America/Los_Angeles, TZ=Pacific/Auckland and TZ=Asia/Dubai.
//
// Two classes of assertion earn their place here, because they are the two
// mistakes this file exists to prevent.
//
// The first is a fabricated figure. Every parser reads a shape that has never
// been observed in a live response — only in the vendor's published spec — so
// the interesting inputs are the malformed ones: a null duration, a zero, a
// string, a stage summary that is not there because WHOOP has not scored the
// night. Every one of those must yield NO reading, never a reading of zero, and
// never a plausible-looking number derived from something else.
//
// The second is the calendar. Oura hands us an instant with an offset on it,
// Fitbit a bare date and a wall-clock string with no offset, WHOOP nothing but
// instants. Under TZ=Pacific/Auckland an Oura night read with `.slice(0, 10)`
// lands on the wrong day, which is the bug src/lib/localDate.ts was written
// for, so the night keys are asserted per timezone rather than hard-coded.
import {
  parseOuraSleep, parseWhoopSleep, parseFitbitSleep, parseVendorSleep,
  vendorReadsSleep, MAX_RECORD_SECONDS,
} from './vendorSleep';
import { nightKey, mergeSleepNight } from './sleepMerge';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const TZ = process.env.TZ || '(system)';

// ── Oura ────────────────────────────────────────────────────────────────────

// A night that ended at 07:12 on the 29th, +03:00, and a nap the same evening.
const OURA_WAKE = '2026-08-29T07:12:00+03:00';
const ouraNight = nightKey(OURA_WAKE) as string;

const ouraOne = parseOuraSleep([
  {
    id: 'a', type: 'long_sleep', day: '2026-08-29',
    bedtime_start: '2026-08-28T23:00:00+03:00', bedtime_end: OURA_WAKE,
    total_sleep_duration: 25920, time_in_bed: 29520, awake_time: 3600,
  },
]);
ok(ouraOne.length === 1, `one Oura period is one reading, got ${ouraOne.length}`);
ok(ouraOne[0]?.minutesAsleep === 432, `25920 seconds is 432 minutes, got ${ouraOne[0]?.minutesAsleep}`);
ok(ouraOne[0]?.basis === 'asleep', 'total_sleep_duration is staged sleep, not time in bed');
ok(ouraOne[0]?.night === ouraNight, `the night is the local day of bedtime_end, got ${ouraOne[0]?.night}`);
ok(ouraOne[0]?.family === 'oura' && ouraOne[0]?.provider === 'oura', 'an Oura reading is attributed to Oura');
ok(ouraOne[0]?.sourceName === 'Oura Ring', 'the default display name is used when none is passed');

// time_in_bed is the fallback and must be labelled as such, never presented as
// sleep — it runs twenty to forty minutes longer than the night actually was.
const ouraInBed = parseOuraSleep([
  { type: 'long_sleep', bedtime_end: OURA_WAKE, total_sleep_duration: null, time_in_bed: 29520 },
]);
ok(ouraInBed.length === 1 && ouraInBed[0].basis === 'in-bed', 'a period with no staged total falls back to time in bed');
ok(ouraInBed[0]?.minutesAsleep === 492, `29520 seconds is 492 minutes, got ${ouraInBed[0]?.minutesAsleep}`);

// A period the user deleted, and one Oura itself calls falsely detected.
const ouraRejected = parseOuraSleep([
  { type: 'deleted', bedtime_end: OURA_WAKE, total_sleep_duration: 25920 },
  { type: 'rest', bedtime_end: OURA_WAKE, total_sleep_duration: 25920 },
]);
ok(ouraRejected.length === 0, 'deleted and falsely-detected periods are not sleep the person had');

// The `day` field is Oura's scoring day: a late nap ending Tuesday evening
// carries day = Wednesday. Attributing by bedtime_end keeps it on Tuesday.
const napEnd = '2026-08-25T19:30:00+03:00';
const ouraLateNap = parseOuraSleep([
  { type: 'late_nap', day: '2026-08-26', bedtime_end: napEnd, total_sleep_duration: 3600 },
]);
ok(ouraLateNap[0]?.night === nightKey(napEnd),
  `a late nap is filed on the evening it ended, not Oura's scoring day (got ${ouraLateNap[0]?.night})`);

// Two periods on one night are one total, summed in seconds and rounded once.
const ouraTwo = parseOuraSleep([
  { type: 'long_sleep', bedtime_end: OURA_WAKE, total_sleep_duration: 25921 },
  { type: 'sleep', bedtime_end: '2026-08-29T14:00:00+03:00', total_sleep_duration: 1801 },
]);
const ouraSameDay = nightKey('2026-08-29T14:00:00+03:00') === ouraNight;
if (ouraSameDay) {
  ok(ouraTwo.length === 1 && ouraTwo[0].minutesAsleep === Math.round(27722 / 60),
    `a nap adds to the night it ended on, got ${ouraTwo[0]?.minutesAsleep}`);
}

// Malformed durations contribute nothing at all.
for (const bad of [null, undefined, 0, -900, NaN, Infinity, '', '  ', 'seven hours', true, {}]) {
  const r = parseOuraSleep([{ type: 'long_sleep', bedtime_end: OURA_WAKE, total_sleep_duration: bad, time_in_bed: bad }]);
  ok(r.length === 0, `total_sleep_duration ${JSON.stringify(bad)} yields no reading rather than a zero`);
}
ok(parseOuraSleep([{ type: 'long_sleep', bedtime_end: OURA_WAKE, total_sleep_duration: MAX_RECORD_SECONDS + 1 }]).length === 0,
  'a record claiming more than a day of sleep is refused rather than clamped');
ok(parseOuraSleep([{ type: 'long_sleep', bedtime_end: 'not a date', total_sleep_duration: 25920 }]).length === 0,
  'a period whose end cannot be read belongs to no night');
ok(parseOuraSleep(null).length === 0 && parseOuraSleep({} as any).length === 0 && parseOuraSleep([null, 3]).length === 0,
  'a response that is not a list of records reads as nothing');

// A numeric string is still a duration — none of these APIs is under our control.
ok(parseOuraSleep([{ bedtime_end: OURA_WAKE, total_sleep_duration: '25920' }])[0]?.minutesAsleep === 432,
  'a numeric string is accepted as a duration');
// An unrecognised type is kept: refusing it would discard a real night.
ok(parseOuraSleep([{ type: 'something_new', bedtime_end: OURA_WAKE, total_sleep_duration: 25920 }]).length === 1,
  'an unknown sleep type is still read, because discarding it would lose a real night');

// ── WHOOP ───────────────────────────────────────────────────────────────────

const WHOOP_END = '2026-08-29T13:25:44.774Z';
const whoopNight = nightKey(WHOOP_END) as string;
const stageSummary = {
  total_in_bed_time_milli: 30272735,
  total_awake_time_milli: 1403507,
  total_no_data_time_milli: 0,
  total_light_sleep_time_milli: 14905851,
  total_slow_wave_sleep_time_milli: 6630370,
  total_rem_sleep_time_milli: 5879573,
};
const whoopOne = parseWhoopSleep([
  { id: 'w', start: '2026-08-29T05:25:44.774Z', end: WHOOP_END, nap: false, score_state: 'SCORED', score: { stage_summary: stageSummary } },
]);
const expectWhoop = Math.round((14905851 + 6630370 + 5879573) / 60000);
ok(whoopOne.length === 1 && whoopOne[0].minutesAsleep === expectWhoop,
  `WHOOP asleep is light + slow wave + REM = ${expectWhoop} min, got ${whoopOne[0]?.minutesAsleep}`);
ok(whoopOne[0]?.basis === 'asleep', 'a summed stage total is staged sleep');
ok(whoopOne[0]?.night === whoopNight, `the night is the local day the sleep ended, got ${whoopOne[0]?.night}`);
// The guard that matters: in-bed is 30272735 ms = 505 min against a staged
// total of 457, so reporting in-bed as sleep would add 48 minutes to this
// night. (This said 23 — the fixture's `total_awake_time_milli`. The two are
// not the same number: WHOOP's in-bed total also exceeds the sum of its own
// stage fields here, so the awake figure understates the error by half.)
ok(whoopOne[0]?.minutesAsleep !== Math.round(30272735 / 60000),
  'time in bed is never reported as time asleep');

// An unscored session carries start and end but no measurement. Subtracting one
// from the other would be a bedtime window relabelled as sleep.
for (const state of ['PENDING_SCORE', 'UNSCORABLE']) {
  const r = parseWhoopSleep([{ start: '2026-08-29T05:00:00Z', end: WHOOP_END, score_state: state }]);
  ok(r.length === 0, `${state} has no measurement, so it yields no reading (got ${r.length})`);
}

// A partial stage summary is an understatement, not a fabrication, so it counts.
const whoopPartial = parseWhoopSleep([
  { end: WHOOP_END, score_state: 'SCORED', score: { stage_summary: { total_light_sleep_time_milli: 14905851, total_slow_wave_sleep_time_milli: null, total_rem_sleep_time_milli: 5879573, total_in_bed_time_milli: 30272735 } } },
]);
ok(whoopPartial[0]?.minutesAsleep === Math.round((14905851 + 5879573) / 60000),
  `two readable stages still measure sleep, got ${whoopPartial[0]?.minutesAsleep}`);

// Scored, but no stage survived validation: in bed is then all WHOOP has said.
const whoopOnlyBed = parseWhoopSleep([
  { end: WHOOP_END, score_state: 'SCORED', score: { stage_summary: { total_light_sleep_time_milli: 0, total_slow_wave_sleep_time_milli: 0, total_rem_sleep_time_milli: 0, total_in_bed_time_milli: 30272735 } } },
]);
ok(whoopOnlyBed.length === 1 && whoopOnlyBed[0].basis === 'in-bed',
  'with no usable stage, the in-bed figure is reported and labelled in-bed');
ok(parseWhoopSleep([{ end: WHOOP_END, score_state: 'SCORED', score: { stage_summary: { total_light_sleep_time_milli: 0, total_slow_wave_sleep_time_milli: 0, total_rem_sleep_time_milli: 0, total_in_bed_time_milli: 0 } } }]).length === 0,
  'an all-zero stage summary is no measurement at all');
ok(parseWhoopSleep([{ end: 'nonsense', score_state: 'SCORED', score: { stage_summary: stageSummary } }]).length === 0,
  'a WHOOP sleep with an unreadable end belongs to no night');

// ── Fitbit ──────────────────────────────────────────────────────────────────

const fitbitOne = parseFitbitSleep([
  {
    logId: 1, dateOfSleep: '2026-08-29', type: 'stages', isMainSleep: true,
    startTime: '2026-08-28T23:02:30.000', endTime: '2026-08-29T07:03:00.000',
    minutesAsleep: 432, timeInBed: 481,
  },
]);
ok(fitbitOne.length === 1 && fitbitOne[0].minutesAsleep === 432,
  `Fitbit reports minutes directly, got ${fitbitOne[0]?.minutesAsleep}`);
ok(fitbitOne[0]?.basis === 'asleep', 'minutesAsleep is time asleep, not time in bed');
// dateOfSleep is a bare YYYY-MM-DD. Read through Date.parse it would be UTC
// midnight and would come back as the 28th everywhere west of Greenwich.
ok(fitbitOne[0]?.night === '2026-08-29',
  `a bare dateOfSleep is the calendar day it says, in every zone (got ${fitbitOne[0]?.night})`);

const fitbitClassic = parseFitbitSleep([
  { dateOfSleep: '2026-08-29', type: 'classic', minutesAsleep: 400, timeInBed: 460 },
]);
ok(fitbitClassic[0]?.basis === 'asleep', 'a classic log still measures time asleep');

const fitbitFallback = parseFitbitSleep([
  { dateOfSleep: '2026-08-29', type: 'stages', minutesAsleep: null, timeInBed: 481 },
]);
ok(fitbitFallback.length === 1 && fitbitFallback[0].basis === 'in-bed' && fitbitFallback[0].minutesAsleep === 481,
  'a log with no minutesAsleep falls back to timeInBed and says so');

// A main sleep and a nap on the same date are one night's total.
const fitbitNap = parseFitbitSleep([
  { dateOfSleep: '2026-08-29', isMainSleep: true, minutesAsleep: 432 },
  { dateOfSleep: '2026-08-29', isMainSleep: false, minutesAsleep: 31 },
]);
ok(fitbitNap.length === 1 && fitbitNap[0].minutesAsleep === 463,
  `a nap adds to the same night, got ${fitbitNap[0]?.minutesAsleep}`);

ok(parseFitbitSleep([{ endTime: '2026-08-29T07:03:00.000', minutesAsleep: 432 }])[0]?.night === '2026-08-29',
  'endTime is Fitbit local wall-clock time and is read as the day it names');
ok(parseFitbitSleep([{ dateOfSleep: '2026-08-29', minutesAsleep: 0, timeInBed: 0 }]).length === 0,
  'a Fitbit log of zero minutes is no reading, not a night of no sleep');

// ── Dispatch, and the contract with the merge ───────────────────────────────

ok(vendorReadsSleep('oura') && vendorReadsSleep('whoop') && vendorReadsSleep('fitbit'), 'the three cloud sleep vendors are recognised');
ok(!vendorReadsSleep('garmin') && !vendorReadsSleep('apple') && !vendorReadsSleep(''), 'a vendor with no sleep reader is not claimed to have one');
ok(parseVendorSleep('garmin', [{ dateOfSleep: '2026-08-29', minutesAsleep: 432 }]).length === 0,
  'an unknown vendor reads nothing rather than guessing a parser');
ok(parseVendorSleep('fitbit', [{ dateOfSleep: '2026-08-29', minutesAsleep: 432 }], 'Tim’s Charge')[0]?.sourceName === 'Tim’s Charge',
  'the display name passed in is what the screen will show');

// The reason every cloud reading is tagged with its vendor family: the Oura app
// writes its nights into Apple Health too, so the same measurement can arrive
// twice. Two rows from one family must not be allowed to corroborate each
// other, or the screen would claim two devices agreed when only one measured.
const viaApi = parseOuraSleep([{ bedtime_end: OURA_WAKE, total_sleep_duration: 25920 }])[0];
const viaHealth = {
  provider: 'apple' as const, sourceId: 'com.ouraring.oura', sourceName: 'Oura',
  family: 'oura' as const, basis: 'asleep' as const, night: viaApi.night, minutesAsleep: 432,
};
const merged = mergeSleepNight(viaApi.night, [viaApi, viaHealth]);
ok(merged.agreement === 'single', 'one Oura night arriving twice is one measurement, not agreement');
ok(merged.minutesAsleep === 432, 'the figure shown is still the one Oura reported');

if (errors.length) {
  console.error(`vendorSleep.test [TZ=${TZ}] — ${errors.length} failure(s):`);
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`vendorSleep.test [TZ=${TZ}] — all assertions passed`);
