// The meal set a glucose pairing is drawn against. Compile with tsc, run with
// node.
//
// The assertions that matter are the two that no screen and no type can make:
// that a meal this device is still holding is IN the set, and that a meal the
// server has just accepted is still in it after the device dropped it. Either
// one missing produces a pairing that looks entirely normal and attributes one
// meal's rise to the meal before it.
import { heldMeals, mealsForPairing, mealReadRevision, type HeldMeal, type MealSetFacts } from './glucoseMeals';
import { pairMeals, type GlucoseReading, type MealRef } from './glucose';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ms = (iso: string) => Date.parse(iso);
/** The start of the fortnight the server read asked for, in every case below. */
const SINCE = ms('2026-09-01T00:00:00.000Z');

const held = (id: string, at: string, name: string, carbs: number | null = 40): HeldMeal =>
  ({ id, at, name, carbs });
const server = (id: string, loggedAt: string, name: string): MealRef =>
  ({ id, name, loggedAt, carbs: 30 });

const facts = (over: Partial<MealSetFacts> = {}): MealSetFacts => ({
  readOnly: false, windowSince: SINCE, owed: [], entries: [], serverMeals: [], ...over,
});

// ── the back-date that is only in the queue ─────────────────────────────────
//
// `pastRevision` re-reads the server. This meal has never been to the server,
// so the re-read cannot return it however many times it runs. Only the merge
// can, and this is the assertion that says so.
{
  const OWED = held('local:a1', '2026-09-10T19:00:00.000Z', 'Back-dated dinner');
  const set = mealsForPairing(facts({ owed: [OWED], serverMeals: [server('s1', '2026-09-10T12:30:00.000Z', 'Lunch')] }));
  eq(set.length, 2, 'the owed meal and the server meal are both in the set');
  ok(set.some((m) => m.id === 'local:a1'), 'a back-date sitting in the owed queue is paired');
  ok(set.some((m) => m.id === 's1'), 'and the server meal is not displaced by it');
  const dinner = set.find((m) => m.id === 'local:a1');
  eq(dinner?.loggedAt, '2026-09-10T19:00:00.000Z', 'the owed meal keeps its own back-dated stamp');
  eq(dinner?.carbs, 40, 'and its carbs, which are what the pairing is read against');
}

// ── today's meal, logged with no signal ─────────────────────────────────────
{
  const set = mealsForPairing(facts({
    entries: [held('local:b2', '2026-09-12T08:00:00.000Z', 'Breakfast'), held('srv-7', '2026-09-12T13:00:00.000Z', 'Lunch')],
  }));
  eq(set.length, 1, 'only the pending entry is merged');
  eq(set[0].id, 'local:b2', 'a `local:` id has never been stored, so merging it cannot double-count');
}

// ── and the moment the flush lands ──────────────────────────────────────────
//
// The provider drops the row from `owed` and the meal exists only on the
// server. If the set were the queue alone, the member would be told the meal
// was saved and watch it leave the chart in the same second.
{
  const after = mealsForPairing(facts({ owed: [], serverMeals: [server('s9', '2026-09-10T19:00:00.000Z', 'Dinner')] }));
  eq(after.length, 1, 'a flushed meal is still in the set');
  eq(after[0].id, 's9', 'it is the server row now, and it is the same meal');
}

// ── the set is a union, in both directions at once ──────────────────────────
{
  const both = mealsForPairing(facts({
    owed: [held('local:c3', '2026-09-09T19:00:00.000Z', 'Owed dinner')],
    entries: [held('local:c4', '2026-09-12T08:00:00.000Z', 'Pending breakfast')],
    serverMeals: [server('s2', '2026-09-08T12:00:00.000Z', 'Lunch'), server('s3', '2026-09-11T12:00:00.000Z', 'Lunch')],
  }));
  eq(both.length, 4, 'owed, pending and both server rows are all present');
}

// ── the window the READ asked for, not a fortnight counted again ────────────
{
  const old = mealsForPairing(facts({ owed: [held('local:d5', '2026-07-01T19:00:00.000Z', 'A month ago')] }));
  eq(old.length, 0, 'a meal owed from before the window is not dragged into the pairing');
}
{
  const edge = heldMeals(facts({ owed: [held('local:d6', '2026-09-01T00:00:00.000Z', 'On the boundary')] }));
  eq(edge.length, 1, 'a meal exactly at the window start is inside it');
}
{
  const unasked = mealsForPairing(facts({ windowSince: null, owed: [held('local:d7', '2026-09-10T19:00:00.000Z', 'Dinner')] }));
  eq(unasked.length, 0, 'with no window read there is nothing to hold the device meals to, so none are merged');
}
// Null is not zero: an unasked window must not behave like the epoch, which
// would let every row the device has ever held through.
{
  const epoch = heldMeals(facts({ windowSince: 0, owed: [held('local:d8', '2026-07-01T19:00:00.000Z', 'A month ago')] }));
  eq(epoch.length, 1, 'a window of zero really is the epoch, which is why null is not written as one');
}
{
  const junk = heldMeals(facts({ owed: [held('local:d9', 'not a date', 'Dinner')] }));
  eq(junk.length, 0, 'an unparseable stamp is dropped, not placed at the epoch beside the oldest reading');
}

// ── a coach contributes nothing from their own phone ────────────────────────
{
  const coach = mealsForPairing(facts({
    readOnly: true,
    owed: [held('local:e1', '2026-09-10T08:00:00.000Z', "The coach's own breakfast")],
    entries: [held('local:e2', '2026-09-10T12:00:00.000Z', "The coach's own lunch")],
    serverMeals: [server('s4', '2026-09-10T12:30:00.000Z', "The client's lunch")],
  }));
  eq(coach.length, 1, "a coach's own meals are never merged into a client's pairing");
  eq(coach[0].id, 's4', "the client's own server rows are all a coach sees");
}
eq(mealReadRevision(true, 17), 0, "a coach's own back-date does not re-read a client's meals");
eq(mealReadRevision(false, 17), 17, 'a member\'s own back-date does re-read their own');
eq(mealReadRevision(false, 0), 0, 'and nothing back-dated yet is nothing to re-read');

// ── a failed read is not an empty list ──────────────────────────────────────
//
// This function is handed only what the read returned; an error state keeps
// the rows it already had and is carried in `pairedStatus`. What is asserted
// here is that an empty server list does not suppress the device's own meals,
// which is the shape a failed read arrives in.
{
  const none = mealsForPairing(facts({ owed: [held('local:f1', '2026-09-10T19:00:00.000Z', 'Dinner')], serverMeals: [] }));
  eq(none.length, 1, 'the device keeps its own meals when the server list is empty');
}

// ── why a missing meal is not just a missing row ────────────────────────────
//
// The consequence, spelled out against `pairMeals` itself: the dinner is what
// closes lunch's window. Drop it and lunch is credited with the evening rise.
{
  const readings: GlucoseReading[] = [
    { id: 'r1', at: '2026-09-10T12:45:00.000Z', mmol: 5.4, externalId: null, sourceName: null },
    { id: 'r2', at: '2026-09-10T13:30:00.000Z', mmol: 6.1, externalId: null, sourceName: null },
    { id: 'r3', at: '2026-09-10T19:45:00.000Z', mmol: 11.2, externalId: null, sourceName: null },
  ];
  const lunch = server('s5', '2026-09-10T12:30:00.000Z', 'Lunch');
  const dinner = held('local:g1', '2026-09-10T19:30:00.000Z', 'Back-dated dinner');

  const withDinner = pairMeals(mealsForPairing(facts({ owed: [dinner], serverMeals: [lunch] })), readings);
  const withoutDinner = pairMeals(facts({ serverMeals: [lunch] }).serverMeals, readings);

  const lunchWith = withDinner.find((p) => p.meal.id === 's5');
  const lunchWithout = withoutDinner.find((p) => p.meal.id === 's5');
  eq(lunchWith?.peak?.id, 'r2', "with the dinner merged, lunch's peak is lunch's own");
  eq(lunchWithout?.peak?.id, 'r2', 'and the two-hour window alone would also stop before the evening');
  ok(withDinner.some((p) => p.meal.id === 'local:g1'), 'the dinner itself has a row to hold the evening rise');
  const dinnerPair = withDinner.find((p) => p.meal.id === 'local:g1');
  eq(dinnerPair?.peak?.id, 'r3', "and the evening rise is attributed to the meal that caused it");
  eq(withoutDinner.some((p) => p.peak?.id === 'r3'), false,
    'without the merge the 11.2 is attributed to nothing at all and the meal that caused it is invisible');
}

// ── the common case is handed back unchanged ────────────────────────────────
{
  const rows = [server('s6', '2026-09-10T12:00:00.000Z', 'Lunch')];
  ok(mealsForPairing(facts({ serverMeals: rows })) === rows,
    'with nothing held on the device the server list is returned as it is');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('glucoseMeals: ok');
