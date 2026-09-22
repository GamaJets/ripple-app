// How much of it you ate, what you eat every morning, and the allergen the
// planner quietly gave up on.
// Compile with tsc, run with node.
//
//   THE PORTION     nobody was asked, so half a packet was logged as one
//   THE GAP         a macro nobody measured is blank, and blocks the log
//   THE MEMORY      recents come from the log; favourites are chosen
//   THE ALLERGEN    an exclusion that cannot be honoured is SAID
import {
  QUANTITIES, MAX_QUANTITY, readQuantity, scaleFood, missingMacros,
  missingMacroNote, portionName, basisLabel, type FoodFacts,
} from './foodPortion';
import {
  foodKey, recentFoods, frequentFoods, favouritesKey, readFavourites,
  writeFavourites, toggleFavourite, isFavourite, MAX_FAVOURITES,
  type LoggedFoodLike, type RememberedFood,
} from './foodMemory';
import { poolGaps, emptySlots, mealAllergens, allergenGapNote, allergenLabel, mealAt, slotsFor } from './meals';
import {
  MAX_BACKDATE_DAYS, BACKDATE_HOUR, backdateDays, dayLabel, dayLongLabel, readLogDay,
  isBackdated, backdateNote, backdatedStoredNote, backdatedUnsentNote,
  MEAL_SLOTS, readMealSlot, mealSlotLabel, groupMeals, LOG_VIA, isLogVia,
  type MealSlot,
} from './foodLogging';
import { dayOf, todayKey } from './offlineQueue';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const YOGURT: FoodFacts = { name: 'Greek Yogurt', kcal: 133, protein: 10, carbs: 6, fat: 7, basis: '100 g' };

/* ── THE PORTION ──────────────────────────────────────────────────────────
 *
 * A search row logged straight through and the barcode sheet logged whatever
 * basis Open Food Facts returned, so a member who ate a whole 500 g pot
 * recorded 100 g of it — and the day's remaining calories, which is the one
 * figure this tab exists to show, were wrong by the amount nobody asked about.
 */
{
  const whole = scaleFood(YOGURT, 5)!;
  eq(whole.kcal, 665, 'five times the basis is five times the figures');
  eq(whole.protein, 50, 'macros scale with it');
  ok(whole.name.includes('5 × 100 g'), 'and the multiple goes in the name, because a row shows a name and a number and nothing else');

  const half = scaleFood(YOGURT, 0.5)!;
  eq(half.kcal, 67, 'half of 133 rounds once, at the end — 67, not 66 off a rounded 66.5');

  eq(scaleFood(YOGURT, 1)!.name, 'Greek Yogurt',
    'one portion is left alone: "1 ×" in front of every food is noise on the ordinary case');
  eq(portionName('Snack', 2, null), 'Snack · 2 portions', 'with no basis the multiple is still said, in portions');
  eq(portionName('Greek Yogurt', 2, '100 g'), 'Greek Yogurt · 2 × 100 g', 'joined with a middle dot, not the em dash a tester read as a machine');
  eq(basisLabel('100 g'), 'per 100 g', 'the control says what one portion IS where the source said');
  eq(basisLabel(null), null, 'and claims nothing where it did not');
  eq(basisLabel('  '), null, 'including when the source handed back a blank');

  ok(readQuantity('1.5').ok, 'a decimal portion is a real thing to have eaten');
  const comma = readQuantity('1,5');
  ok(comma.ok && comma.qty === 1.5,
    'and a comma is the decimal key on most European keyboards — parseFloat would read 1 and lose a third of the meal');
  ok(!readQuantity('').ok, 'an empty box is refused rather than logged as one portion');
  ok(!readQuantity('0').ok, 'a portion of nothing is not a portion');
  ok(!readQuantity('abc').ok, 'and neither is a word');
  const fumbled = readQuantity(String(MAX_QUANTITY + 5));
  ok(!fumbled.ok && /decimal/.test(fumbled.reason),
    'a fumbled decimal is refused with the reason, rather than logging fifteen servings');
  ok(QUANTITIES.includes(1 as never), 'one portion is on the ladder of taps');
}

/* ── THE GAP ──────────────────────────────────────────────────────────────
 *
 * `foodAI.parseFoodText` and `vision.analyzeMeal` coerced an absent macro to 0,
 * so a model that returned calories and nothing else recorded a zero-protein
 * meal that then fed the day's remaining-macro figures.
 */
{
  const read: FoodFacts = { name: 'Chicken salad', kcal: 420, protein: null, carbs: 12, fat: null, basis: null };
  eq(scaleFood(read, 1), null, 'a food with a macro nobody measured cannot be logged at all');
  eq(missingMacros(read).length, 2, 'and the missing ones are named');
  ok(missingMacros(read).includes('protein') && missingMacros(read).includes('fat'), 'by name, both of them');
  const note = missingMacroNote(read)!;
  ok(/protein and fat/.test(note), 'the sentence names them rather than saying "some macros"');
  ok(/nought/.test(note) || /zero/.test(note), 'and says what the app refused to do, which is invent a zero');
  eq(missingMacroNote(YOGURT), null, 'a whole food has no such sentence');

  const filled: FoodFacts = { ...read, protein: 35, fat: 22 };
  ok(scaleFood(filled, 1) != null, 'once a person has typed the figures, it logs');
  eq(scaleFood(filled, 0), null, 'a portion of nothing still logs nothing');
}

/* ── THE MEMORY ───────────────────────────────────────────────────────────── */
{
  const log: LoggedFoodLike[] = [
    { name: 'Greek Yogurt', kcal: 130, protein: 12, carbs: 6, fat: 5, at: '2026-08-30T08:00:00.000Z' },
    { name: 'greek yogurt', kcal: 133, protein: 12, carbs: 6, fat: 6, at: '2026-08-31T08:00:00.000Z' },
    { name: 'Chicken Breast', kcal: 280, protein: 52, carbs: 0, fat: 6, at: '2026-08-31T13:00:00.000Z' },
    { name: 'Flat White', kcal: 120, protein: 7, carbs: 10, fat: 6, at: '2026-08-29T09:00:00.000Z' },
  ];
  const recent = recentFoods(log, 8);
  eq(recent.length, 3, 'two spellings of one food are one food');
  eq(recent[0].name, 'Chicken Breast', 'newest first, because "the same again" is what this list is for');
  const yog = recent.find((f) => f.key === foodKey('Greek Yogurt'))!;
  eq(yog.count, 2, 'the count is how many times it was logged');
  eq(yog.kcal, 133, 'and the NEWEST logging wins the figures — a correction is not argued with');
  eq(yog.name, 'greek yogurt', 'along with the spelling it was last logged under');

  const often = frequentFoods(log, 8);
  eq(often.length, 1, 'a food logged once is not "frequent" — it is already in recents, and two lists of the same thing is one list twice');
  eq(often[0].count, 2, 'the one logged twice is');

  // The pinned list.
  ok(favouritesKey('u1') !== favouritesKey('u2'), 'per account, so a shared gym phone cannot show one member another member\'s food');
  const pinned = toggleFavourite([], yog);
  eq(pinned.length, 1, 'pinning adds it');
  ok(isFavourite(pinned, 'GREEK YOGURT'), 'and the match is by food, not by spelling');
  eq(toggleFavourite(pinned, yog).length, 0, 'pinning again unpins it, because it is one control');
  const back = readFavourites(writeFavourites(pinned));
  ok(back.read, 'what was written can be read');
  eq(back.foods[0].kcal, 133, 'with the figures it was pinned with, because a favourite is a copy and not a pointer');

  ok(!readFavourites('{oops').read, 'bytes nobody can parse are not an empty list');
  ok(readFavourites(null).read, 'and nothing pinned yet IS a real answer');
  eq(readFavourites(null).foods.length, 0, 'of nothing');
  const junk = readFavourites(JSON.stringify([{ name: 'Half a food' }, { name: 'Real', kcal: 1, protein: 1, carbs: 1, fat: 1 }]));
  eq(junk.foods.length, 1, 'a row missing its figures is dropped and the good one beside it is kept');

  let many: RememberedFood[] = [];
  for (let i = 0; i < MAX_FAVOURITES + 5; i++) many = toggleFavourite(many, { ...yog, key: `k${i}`, name: `Food ${i}` });
  eq(many.length, MAX_FAVOURITES, 'the list is capped, because its value is being short enough to read');
}

/* ── THE ALLERGEN ─────────────────────────────────────────────────────────
 *
 * `poolFilter` returned the UNFILTERED pool whenever an exclusion emptied a
 * required component list, and nothing on screen said so — on the one screen
 * where a quiet failure is least acceptable.
 */
{
  // Soy on a vegan breakfast WAS the live one: every vegan breakfast base is
  // tofu or soy milk. Since 21 Sep 2026 a soy-free fallback base fills it, so
  // no diet and exclusion leaves a slot empty. The empty-slot path is still
  // the safety net should one ever reappear, so its sentence is still pinned.
  eq(poolGaps('vegan', 'Breakfast', ['soy']).length, 0, 'a vegan avoiding soy now has breakfasts');
  const note = allergenGapNote([{ slot: 'Breakfast', allergens: ['soy'] }])!;
  ok(/no breakfast in your plan/i.test(note) && /soy/.test(note), 'an empty slot, if one ever appears, is named with its allergen');
  ok(!/still contains/.test(note), 'and never says the plan contains it');

  eq(allergenGapNote([]), null, 'a filter that was honoured says nothing at all');
  eq(poolGaps('meat', 'Lunch', []).length, 0, 'excluding nothing cannot fail');
  eq(poolGaps('meat', 'Lunch', ['shellfish']).length, 0,
    'and an exclusion the pools can absorb is not reported — there is plenty of meat that is not a prawn');
  eq(emptySlots('vegan', slotsFor(3), ['soy']).length, 0, 'and the day has no empty slot');

  // The per-meal half: no breakfast is generated with soy in it, at any index,
  // and every one is a real, filled meal.
  let flagged = 0, filled = 0;
  for (let i = 0; i < 40; i++) {
    const m = mealAt('vegan', 'Breakfast', i, ['soy']);
    if (mealAllergens(m, ['soy']).length) flagged++;
    if (!m.unfillable?.length && m.ing.length) filled++;
  }
  eq(flagged, 0, 'no generated breakfast contains the excluded allergen');
  eq(filled, 40, 'every one of them is a real breakfast from the soy-free bases');
  eq(mealAllergens({ n: 'Grilled chicken with rice', ing: [['Chicken breast', 180, 'g', 'Meat & Seafood']] }, ['dairy']).length, 0,
    'a dish without it is not marked');
  eq(allergenLabel('dairy'), 'dairy', 'and the label reads as prose mid-sentence');
}

/* ── THE DAY IT WENT TO ───────────────────────────────────────────────────
 *
 * `logFood` stamped `new Date()` and had no other option, so a member who
 * forgot to log dinner could not add it in the morning. Everything below is
 * about the two ways that goes wrong: a row landing in a day nobody chose, and
 * a row that is never offered to the server at all.
 *
 * Run under TZ=Pacific/Kiritimati (UTC+14), TZ=UTC and TZ=Pacific/Midway
 * (UTC-11). Every assertion here must hold in all three, because every one of
 * them is about a day boundary and a boundary is where the offsets differ.
 */
{
  // A fixed instant, read in whatever zone the run is in. Built from local
  // parts rather than from an ISO literal precisely so the test moves with the
  // zone the way a member's phone does.
  const now = new Date(2026, 8, 13, 21, 40, 0, 0); // 13 Sep 2026, 21:40 local
  const today = todayKey(now);
  eq(today, '2026-09-13', 'todayKey reads the LOCAL day — 21:40 on the 13th is the 13th in every zone, and toISOString would say the 14th east of Greenwich');

  const week = backdateDays(today, MAX_BACKDATE_DAYS);
  eq(week.length, MAX_BACKDATE_DAYS, 'the picker offers a fortnight');
  eq(week[0], '2026-09-13', 'today first — it is the default and the overwhelmingly common case');
  eq(week[1], '2026-09-12', 'yesterday next');
  eq(week[13], '2026-08-31', 'and it rolls back over the end of a month by calendar arithmetic, not by subtracting 24 hours fourteen times');
  eq(new Set(week).size, MAX_BACKDATE_DAYS, 'no day repeats — which subtracting 86,400,000ms across a DST change would do');

  // The ends of a year, where every off-by-one in date arithmetic shows.
  eq(backdateDays('2027-01-01', 3)[2], '2026-12-30', 'and back over a new year');
  eq(backdateDays('2028-03-01', 2)[1], '2028-02-29', 'and onto a leap day that exists');
  eq(backdateDays('2027-03-01', 2)[1], '2027-02-28', 'and not onto one that does not');
  eq(backdateDays('not-a-day').length, 0, 'an unreadable day yields no choices rather than fourteen guesses');

  eq(dayLabel('2026-09-13', today), 'Today', 'a person calls today "Today"');
  eq(dayLabel('2026-09-12', today), 'Yesterday', 'and yesterday "Yesterday"');
  ok(/Sep/.test(dayLabel('2026-09-09', today)), 'anything else gets a weekday and a date, so somebody knows which day they are writing to');
  eq(dayLongLabel('2026-09-13', today), 'today', 'and the same two in the middle of a sentence');
  eq(dayLongLabel('2026-09-12', today), 'yesterday', 'and the same two in the middle of a sentence, lower case');

  /* Today means NOW. The ordinary path must not change because a rarely used
   * control was added beside it. */
  const t = readLogDay(today, now);
  ok(t.ok && !t.backdated, 'picking today is not a back-date');
  ok(t.ok && t.at === now.toISOString(), 'and is stamped with the actual instant, exactly as before');

  /* A back-dated row is stamped at LOCAL NOON. Twelve hours from either
   * boundary, so no offset, DST shift or clock skew can move it into the
   * neighbouring day on the device that reads it back. */
  const y = readLogDay('2026-09-12', now);
  ok(y.ok && y.backdated, 'yesterday is a back-date');
  if (y.ok) {
    eq(new Date(Date.parse(y.at)).getHours(), BACKDATE_HOUR, 'stamped at noon local — not midnight, which is nought minutes from the boundary, and not 23:59, which is one');
    eq(dayOf(y.at, now), '2026-09-12', 'and it reads back as the day the member picked');
    ok(dayOf(y.at, now) !== today, 'and never as today, which is the whole point: it must not eat today’s remaining calories');
  }

  /* The four refusals. Every one of them is refused rather than corrected,
   * because every correction available invents a day nobody chose. */
  const soon = readLogDay('2026-09-14', now);
  ok(!soon.ok, 'a day that has not happened yet is refused — you cannot have eaten tomorrow’s dinner');
  ok(!soon.ok && /hasn’t happened/.test(soon.reason), 'and the reason says why, rather than silently logging it to today');
  ok(!readLogDay('2026-08-20', now).ok, 'further back than the screen can show is refused, rather than putting a row where nobody can check it');
  ok(!readLogDay('13/09/2026', now).ok, 'an unreadable date is refused rather than guessed at');
  ok(!readLogDay('', now).ok, 'and so is an empty one');
  const unreal = readLogDay('2026-02-31', now);
  ok(!unreal.ok, 'the 31st of February is refused — new Date(2026, 1, 31) is the 3rd of March and reports no error at all, so the parts have to be round-tripped');

  /* The frozen-clock case this codebase keeps being bitten by: a screen opened
   * before midnight and tapped after it. `now` is a parameter for this reason. */
  const late = new Date(2026, 8, 13, 23, 58, 0, 0);
  const past = new Date(2026, 8, 14, 0, 1, 0, 0);
  ok(readLogDay('2026-09-13', late).ok, 'at 23:58 the 13th is today');
  const after = readLogDay('2026-09-13', past);
  ok(after.ok && after.backdated, 'three minutes later the same choice is a BACK-DATE, and is stamped at noon on the 13th rather than at the instant of the tap');

  /* The property that actually matters, over a year of days and a day of
   * clock times: whatever the member picks, that is the day it lands in. */
  let wrong = 0;
  for (let i = 1; i <= 13; i++) {
    for (const hour of [0, 1, 2, 3, 11, 12, 13, 22, 23]) {
      const at = new Date(2026, 2, 1 + i, hour, 30, 0, 0); // March: a DST change in most zones
      const key = todayKey(at);
      const pick = backdateDays(key, 14)[i];
      const r = readLogDay(pick, at);
      if (!r.ok || dayOf(r.at, at) !== pick) wrong++;
    }
  }
  eq(wrong, 0, 'across a fortnight of back-dates taken at nine clock times a day through a daylight-saving change, every row landed in the day that was picked');

  eq(isBackdated(now.toISOString(), now), false, 'a row stamped now is today’s');
  ok(isBackdated(new Date(2026, 8, 12, 12, 0, 0, 0).toISOString(), now), 'and noon yesterday is not');

  eq(backdateNote(today, today), null, 'the ordinary case draws no warning at all');
  const bn = backdateNote('2026-09-12', today)!;
  ok(/yesterday/.test(bn), 'a back-date names the day it is going to');
  ok(/today’s totals/.test(bn), 'and warns that today’s figures will not move — otherwise a successful log looks like a button that did nothing');

  /* The two outcomes a back-dated row can have, and the gap between the
   * sentences. This is the queue decision, stated where it is read. */
  ok(/unchanged/.test(backdatedStoredNote('2026-09-12', today)), 'stored: it went somewhere else, and here is where to look');
  const un = backdatedUnsentNote('2026-09-12', today);
  ok(/goes up on its own/.test(un), 'unsent: it is going, and nobody has to do anything');
  ok(/keeps its own day/.test(un), 'and it keeps its own day when it does — the promise that makes a late send safe');
  ok(!/not sent|do it again|too long/.test(un),
    'and it does NOT say what lapsedNote says about a day plan. A day plan is an intent about a day nobody can live any more, so it is dropped and the member is told to do it again. A back-dated meal is a RECORD: it was true on Tuesday and is exactly as true a fortnight later, so it is queued for as long as it takes. Giving it an expiry would drop 100% of back-dated rows, because a back-dated row is in the past by construction — that is a deletion, not a policy.');
}

/* ── WHICH MEAL IT WAS ────────────────────────────────────────────────────
 *
 * A flat "Logged Today" list against five competitors that all group the day.
 * The column is nullable and NULL means nobody told us — never "breakfast",
 * and never a slot worked out from the clock.
 */
{
  eq(MEAL_SLOTS.length, 4, 'four slots');
  eq(MEAL_SLOTS.join(','), 'breakfast,lunch,dinner,snack',
    'spelled exactly as the CHECK constraint in the part file spells them — a value here that is not there is a 23514 at insert time');

  eq(readMealSlot(undefined), null, 'a row read back from a database without the column has no slot');
  eq(readMealSlot(null), null, 'nor has a row nobody answered for');
  eq(readMealSlot('brunch'), null, 'nor has a value this build does not know — it goes to "Not sorted" rather than being coerced into breakfast by a default');
  eq(readMealSlot(''), null, 'nor a blank');
  eq(readMealSlot(3), null, 'nor a number');
  eq(readMealSlot('dinner'), 'dinner', 'and a real one reads as itself');

  eq(mealSlotLabel(null), 'Not sorted', 'NULL is named for what it is — an absence of an answer, not a fifth meal called "Other"');
  eq(mealSlotLabel('snack'), 'Snacks', 'and snacks are plural, because there are usually several and one heading covers them');

  const e = (kcal: number, meal?: MealSlot | null) => ({ kcal, protein: 1, carbs: 2, fat: 3, meal });

  /* Every existing row in the table is NULL, and stays NULL. Four headings
   * over an empty breakfast and the whole day under "Not sorted" is worse than
   * the flat list it replaced, so the caller is told not to group. */
  const old = groupMeals([e(100), e(200), e(300)]);
  eq(old.grouped, false, 'not one row carries a slot, so the screen keeps the flat list it already had');
  eq(old.groups.length, 1, 'they are still one group');
  eq(old.groups[0].slot, null, 'and it is the unsorted one');
  eq(old.groups[0].kcal, 600, 'which subtotals in full — an unsorted meal is not a half-counted one');

  const day = groupMeals([
    e(300, 'dinner'), e(150, 'snack'), e(400, 'breakfast'), e(90), e(500, 'dinner'),
  ]);
  eq(day.grouped, true, 'one slotted row is enough to group');
  eq(day.groups.map((g) => g.label).join(' · '), 'Breakfast · Dinner · Snacks · Not sorted',
    'in the order a day is eaten in, whatever order the rows arrived in — and "Not sorted" last, because it is the group missing an answer rather than the day’s late meal');
  eq(day.groups.length, 4, 'Lunch is ABSENT rather than present with a zero: a 0 kcal subtotal under Lunch reads as "you ate nothing at lunch", and the true statement is that nothing was logged under it');
  eq(day.groups[1].kcal, 800, 'a slot with two meals in it subtotals both');
  eq(day.groups[1].protein, 2, 'macros too');
  eq(day.groups[3].kcal, 90, 'and the row nobody answered for is still counted, in its own group');
  eq(day.groups.reduce((a, g) => a + g.kcal, 0), 1440, 'the groups add up to the day — grouping moves rows, it never drops one');

  eq(groupMeals([]).groups.length, 0, 'an empty day is no groups, not four empty ones');
  eq(groupMeals([]).grouped, false, 'and nothing to group');

  // No clock anywhere in it. Two identical rows differ only by their slot.
  const a = groupMeals([e(100, 'dinner')]);
  const b = groupMeals([e(100, 'breakfast')]);
  ok(a.groups[0].slot === 'dinner' && b.groups[0].slot === 'breakfast',
    'the slot comes from the row and only from the row. Deriving it from logged_at would be the app inventing a fact about a night-shift nurse eating her main meal at four in the morning.');
}

/* ── THE COLUMN THIS FILE HAS BEEN BITTEN BY TWICE ────────────────────── */
{
  eq(LOG_VIA.join(','), 'search,barcode,photo,manual', 'the four the CHECK on food_logs.via accepts, and no others');
  ok(!isLogVia('ai'), '"ai" is the value that was actually sent twice — every described meal was refused by the database and shown to the member as logged');
  ok(!isLogVia(''), 'and a blank is not a way in');
  ok(!isLogVia(undefined), 'nor is nothing at all');
  for (const v of LOG_VIA) ok(isLogVia(v), `${v} is accepted`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('foodLogging.test.ts ok');
