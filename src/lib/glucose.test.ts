// Blood glucose arithmetic. Compile with tsc, run with node.
//
// The assertions that matter most are the two the feature would be dangerous
// without: that a missing reading never becomes a zero, and that a value typed
// in the wrong unit is refused rather than stored four times too high.
import {
  mmolToMgdl, mgdlToMmol, plausible, formatGlucose, band,
  parseHealthSamples, pairMeals, summarise, unsaved, parseTyped,
  MIN_FOR_PERCENT, TYPICAL_LOW_MMOL, TYPICAL_HIGH_MMOL,
  type GlucoseReading, type MealRef,
} from './glucose';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const near = (a: number, b: number, msg: string) => ok(Math.abs(a - b) < 0.05, `${msg} — got ${a}, wanted ~${b}`);

// ── units ───────────────────────────────────────────────────────────────────
near(mmolToMgdl(5.5), 99.1, '5.5 mmol/L is about 99 mg/dL');
near(mgdlToMmol(99), 5.49, '99 mg/dL is about 5.5 mmol/L');
near(mgdlToMmol(mmolToMgdl(7.3)), 7.3, 'the conversion round-trips');

// ── what counts as a reading at all ─────────────────────────────────────────
eq(plausible(5.5), true, 'an ordinary reading is plausible');
eq(plausible(0.2), false, 'below the floor is a broken import');
eq(plausible(99), false, 'a mg/dL number under mmol/L is not plausible');
eq(plausible(NaN), false, 'NaN is not a reading');
eq(plausible(null), false, 'null is not a reading');
eq(plausible('5.5'), false, 'a string is not a reading');

// ── an absent reading renders as a dash, never as a number ──────────────────
eq(formatGlucose(null, 'mmol/L'), '—', 'no reading is a dash, not 0.0');
eq(formatGlucose(undefined, 'mg/dL'), '—', 'undefined is a dash, not 0');
eq(formatGlucose(NaN, 'mmol/L'), '—', 'NaN is a dash');
eq(formatGlucose(5.5, 'mmol/L'), '5.5', 'mmol/L carries one decimal');
eq(formatGlucose(5.5, 'mg/dL'), '99', 'mg/dL is whole — no invented precision');

// ── bands are descriptive, and "unknown" is a real answer ───────────────────
eq(band(null), 'unknown', 'nothing to band is not "typical"');
eq(band(TYPICAL_LOW_MMOL - 0.1), 'below', 'under the quoted floor');
eq(band(TYPICAL_LOW_MMOL), 'typical', 'the floor itself is inside');
eq(band(TYPICAL_HIGH_MMOL), 'typical', 'the ceiling itself is inside');
eq(band(TYPICAL_HIGH_MMOL + 0.1), 'above', 'over the quoted ceiling');

// ── parsing what Health hands back ──────────────────────────────────────────
const raw = [
  { value: 5.52, id: 'a', startDate: '2026-08-31T08:00:00Z', sourceName: 'Dexcom G7' },
  { value: 5.52, id: 'a', startDate: '2026-08-31T08:00:00Z', sourceName: 'Dexcom G7' }, // same sample, read twice
  { value: 8.1, id: 'b', startDate: '2026-08-31T09:00:00Z', sourceName: 'Dexcom G7' },
  { value: 0, id: 'c', startDate: '2026-08-31T09:05:00Z' },                              // sensor garbage
  { value: 7.0, id: 'd', startDate: 'not a date' },                                      // unusable timestamp
  { value: 7.0, id: 'e' },                                                               // no timestamp at all
  null,
];
const parsed = parseHealthSamples(raw);
eq(parsed.length, 2, 'duplicates, garbage values and unusable timestamps are all dropped');
eq(parsed[0].mmol, 8.1, 'newest first');
eq(parsed[1].mmol, 5.5, 'stored to the column scale');
eq(parsed[1].sourceName, 'Dexcom G7', 'the writing app is kept');
eq(parseHealthSamples(null).length, 0, 'a failed read is an empty list, not a throw');
eq(parseHealthSamples({} as unknown).length, 0, 'a non-array is an empty list');

// A reading with no id is kept — somebody may have typed two identical values.
eq(parseHealthSamples([
  { value: 5.5, startDate: '2026-08-31T08:00:00Z' },
  { value: 5.5, startDate: '2026-08-31T08:00:00Z' },
]).length, 2, 'idless readings are not collapsed into each other');

// ── meals against readings ──────────────────────────────────────────────────
const r = (at: string, mmol: number): GlucoseReading => ({ at, mmol, externalId: at, sourceName: null });
const meals: MealRef[] = [
  { id: 'm1', name: 'Porridge', loggedAt: '2026-08-31T08:00:00Z', carbs: 60 },
  { id: 'm2', name: 'Lunch',    loggedAt: '2026-08-31T09:30:00Z', carbs: 40 },
];
const readings = [
  r('2026-08-31T07:55:00Z', 5.0),  // baseline for m1
  r('2026-08-31T08:45:00Z', 8.2),  // m1's peak
  r('2026-08-31T09:20:00Z', 6.1),
  r('2026-08-31T09:45:00Z', 9.9),  // AFTER lunch — must not be credited to breakfast
];
const paired = pairMeals(meals, readings);
eq(paired[0].peak?.mmol, 8.2, 'the window closes when the next meal starts');
eq(paired[0].before?.mmol, 5.0, 'the baseline is the last reading before the meal');
eq(paired[0].rise, 3.2, 'rise is peak minus baseline');
eq(paired[1].peak?.mmol, 9.9, "lunch keeps its own peak");

// A peak with no baseline is a number, not a rise.
const noBase = pairMeals([meals[0]], [r('2026-08-31T08:45:00Z', 8.2)]);
eq(noBase[0].before, null, 'no baseline is null');
eq(noBase[0].rise, null, 'rise is refused rather than assumed from a default baseline');

// A baseline from two hours earlier is not this meal's baseline.
const stale = pairMeals([meals[0]], [r('2026-08-31T05:30:00Z', 5.0), r('2026-08-31T08:45:00Z', 8.2)]);
eq(stale[0].before, null, 'a stale baseline is not used');

// A meal with no readings at all is still listed, with nothing claimed.
const bare = pairMeals([meals[0]], []);
eq(bare.length, 1, 'a meal with no readings is still a row');
eq(bare[0].peak, null, 'and claims nothing');
eq(bare[0].rise, null, 'and certainly not a rise of 0');

// Meals arriving out of order are still windowed against the right neighbour.
const reversed = pairMeals([meals[1], meals[0]], readings);
eq(reversed[0].meal.id, 'm1', 'meals are ordered before windowing');
eq(reversed[0].peak?.mmol, 8.2, 'and the early close still applies');

// ── summary ─────────────────────────────────────────────────────────────────
const empty = summarise([]);
eq(empty.count, 0, 'no readings is a count of 0');
eq(empty.averageMmol, null, 'and an average of null, not 0');
eq(empty.latest, null, 'and no latest');
eq(empty.inTypicalPct, null, 'and no percentage');

const few = summarise(readings);
eq(few.count, 4, 'four readings counted');
eq(few.highestMmol, 9.9, 'highest');
eq(few.lowestMmol, 5.0, 'lowest');
eq(few.latest?.mmol, 9.9, 'latest is by time, not by list order');
eq(few.inTypicalPct, null, `a percentage off ${4} readings is refused`);

// Enough readings, and the percentage appears.
const many: GlucoseReading[] = [];
for (let i = 0; i < MIN_FOR_PERCENT; i++) {
  many.push(r(`2026-08-31T${String(i).padStart(2, '0')}:00:00Z`, i < 6 ? 5.5 : 9.0));
}
eq(summarise(many).inTypicalPct, 50, 'half in the quoted range');

// A garbage value that reached the list is excluded from the arithmetic.
eq(summarise([r('2026-08-31T08:00:00Z', 5.0), { at: '2026-08-31T09:00:00Z', mmol: 0, externalId: null, sourceName: null }]).count,
  1, 'an implausible value does not drag the average down');

// ── dedupe against what is already stored ───────────────────────────────────
eq(unsaved([r('2026-08-31T08:00:00Z', 5.0)], ['2026-08-31T08:00:00Z']).length, 0, 'an already-stored sample is not sent again');
eq(unsaved([r('2026-08-31T08:00:00Z', 5.0)], []).length, 1, 'a new sample is sent');
eq(unsaved([{ at: '2026-08-31T08:00:00Z', mmol: 5.0, externalId: null, sourceName: null }], []).length, 0,
  'a hand-typed reading is never re-imported from Health');

// ── typed input ─────────────────────────────────────────────────────────────
eq(parseTyped('5.5', 'mmol/L'), 5.5, 'an ordinary mmol/L reading');
eq(parseTyped('99', 'mg/dL'), 5.5, 'mg/dL is converted on the way in');
eq(parseTyped('99', 'mmol/L'), null, 'a mg/dL number typed under mmol/L is refused, not stored');
eq(parseTyped('', 'mmol/L'), null, 'nothing typed is nothing stored');
eq(parseTyped('0', 'mmol/L'), null, 'zero is not a reading');
eq(parseTyped('-5', 'mmol/L'), null, 'negative is not a reading');
eq(parseTyped('abc', 'mmol/L'), null, 'words are not a reading');
eq(parseTyped(' 6.2 ', 'mmol/L'), 6.2, 'surrounding whitespace is tolerated');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`glucose: ok (${parsed.length + paired.length + many.length} cases)`);
