// One search over three food sources. Compile with tsc, run with node.
//
// The bug this guards: "Search Foods" asked a BRANDED database and a twelve-row
// table hardcoded in the screen, so a person logging a chicken breast searched
// a packaged-goods index for a piece of meat, and the 41 restaurant dishes on
// the "Eating Out" screen were unreachable from search entirely. Three sources
// now feed one list, and these assertions pin the three things that list has to
// get right: rank so the generic table leads a generic question and a real
// label leads a named product, say on every row which source the numbers came
// from, and keep the local answers when the remote one fails — because a
// throttled server is not a statement about what somebody ate.
import { mergeFoodResults, type BrandedItem, type FoodResult } from './foodSearch';
import { searchCommonFoods, type CommonFood } from './foods';
import { searchDishes, DISHES, type Dish } from './restaurant';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const common = (n: string, k = 100): CommonFood => ({ n, k, p: 1, c: 1, f: 1 });
const dish = (id: string, name: string, cuisine: string): Dish =>
  ({ id, name, cuisine, kcal: 500, protein: 20, carbs: 50, fat: 20 });
const branded = (name: string, serving = '100 g'): BrandedItem =>
  ({ name, kcal: 200, protein: 10, carbs: 20, fat: 5, serving });

const names = (rows: FoodResult[]) => rows.map((r) => r.name);
const labels = (rows: FoodResult[]) => rows.map((r) => r.label);
const empty = { common: [], restaurant: [], branded: [] };

/* ── every row says where its numbers came from ────────────────────────── */

// The failure this prevents: a typical value for a named portion rendered
// beside a brand's declared label with nothing to tell them apart, so a generic
// average reads as though it were somebody's own packet.
const labelled = mergeFoodResults('chicken', {
  common: [common('Chicken Breast, Grilled (150g)')],
  restaurant: [dish('caesar-chx', 'Chicken Caesar salad', 'American')],
  branded: [branded('Tesco Chicken Breast')],
});
eq(labelled.length, 3, 'all three sources reach the list');
eq(labelled.find((r) => r.source === 'common')?.label, 'Common', 'a common food is labelled Common');
eq(labelled.find((r) => r.source === 'restaurant')?.label, 'Restaurant · American',
  'a restaurant dish carries its cuisine in the label');
eq(labelled.find((r) => r.source === 'branded')?.label, 'Branded', 'a branded product is labelled Branded');
ok(labelled.every((r) => r.label.length > 0), 'no row reaches the list unlabelled');
// Keys are what React lists by; two rows sharing one silently drops a food.
eq(new Set(labelled.map((r) => r.key)).size, labelled.length, 'every key in a merged list is unique');

/* ── a plain-food query is led by the generic table ────────────────────── */

// "chicken" names a kind of food, not a product. The generic table is the
// right first answer; the branded index cannot hold a plain chicken breast.
eq(mergeFoodResults('chicken', {
  common: [common('Chicken Breast, Grilled (150g)')],
  restaurant: [dish('caesar-chx', 'Chicken Caesar salad', 'American')],
  branded: [branded('Chicken Flavour Crisps')],
})[0].source, 'common', 'a one-word food query leads with the common table');

// Same tier, one word typed: Common, then Restaurant, then Branded.
eq(mergeFoodResults('latte', {
  common: [common('Latte, Regular (350ml)')],
  restaurant: [dish('latte', 'Latte deluxe', 'Cafe')],
  branded: [branded('Latte Macchiato')],
}).map((r) => r.source).join(','), 'common,restaurant,branded',
  'inside one tier a one-word query orders common, restaurant, branded');

/* ── a named product is led by its own label ───────────────────────────── */

// "tesco greek yogurt" names something with a label on it. The branded row is
// the only one of the three that is a measurement rather than an average, and
// the common row does not even match every word typed.
const tesco = mergeFoodResults('tesco greek yogurt', {
  common: [common('Greek Yogurt, 0% (200g)')],
  restaurant: [],
  branded: [branded('Tesco Greek Style Yogurt', '150 g')],
});
eq(tesco[0].source, 'branded', 'a query naming a brand leads with the brand');
eq(tesco[0].name, 'Tesco Greek Style Yogurt (150 g)', 'a branded row states the basis its macros are for');

// Two or more words typed flips the tie-break inside a tier, so a product named
// exactly what was typed is not pushed under a generic average of the same name.
eq(mergeFoodResults('protein bar', {
  common: [common('Protein Bar')],
  restaurant: [],
  branded: [branded('Protein Bar Chocolate', '60 g')],
}).map((r) => r.source).join(','), 'branded,common',
  'a multi-word query orders branded ahead of common inside a tier');

// The tier still outranks the source flip: a row that matches every word typed
// beats one that matches only some, whichever source it came from.
eq(mergeFoodResults('greek yogurt', {
  common: [common('Greek Yogurt, 0% (200g)')],
  restaurant: [],
  branded: [branded('Yogurt Drink')],
})[0].source, 'common', 'matching every word typed outranks the source order');

/* ── the same food from two sources appears once ───────────────────────── */

const dupe = mergeFoodResults('banana', {
  common: [common('Banana, Medium')],
  restaurant: [],
  branded: [branded('Banana, Medium', '')],
});
eq(dupe.length, 1, 'the same name from two sources is one row, not two');
eq(dupe[0].source, 'common', 'the better-ranked source is the one that survives de-duplication');
// A portion in brackets is not what makes two rows different foods: the same
// product reached by search and by barcode differs only in the appended basis.
eq(mergeFoodResults('croissant', {
  common: [common('Croissant')],
  restaurant: [],
  branded: [branded('Croissant', '60 g')],
}).length, 1, 'a bracketed serving does not make a duplicate a separate food');
// But a qualifier does. Merging these would hide a whole food behind another.
eq(mergeFoodResults('yogurt', {
  common: [common('Greek Yogurt, 0% (200g)'), common('Greek Yogurt, Full Fat (200g)')],
  restaurant: [],
  branded: [],
}).length, 2, 'two genuinely different foods are not merged by de-duplication');

/* ── a failed remote search removes nothing ────────────────────────────── */

// searchProducts answers { ok: false } when Open Food Facts is throttling us,
// and the screen passes an empty branded set for that. If that emptied the
// list, a busy server would tell somebody their food does not exist.
const withRemote = mergeFoodResults('chicken', {
  common: searchCommonFoods('chicken'),
  restaurant: searchDishes('chicken'),
  branded: [branded('Tesco Chicken Breast')],
});
const withoutRemote = mergeFoodResults('chicken', {
  common: searchCommonFoods('chicken'),
  restaurant: searchDishes('chicken'),
  branded: [],
});
ok(withoutRemote.length > 0, 'a failed branded search still leaves local results');
eq(withoutRemote.length, withRemote.length - 1, 'a failed branded search drops only the branded rows');
eq(JSON.stringify(names(withoutRemote)),
  JSON.stringify(names(withRemote).filter((n) => n !== 'Tesco Chicken Breast (100 g)')),
  'the local rows keep their order when the branded search fails');
ok(!labels(withoutRemote).includes('Branded'), 'nothing is labelled Branded when the branded search failed');

// The reverse too: no local match is not a reason to drop a branded answer.
eq(mergeFoodResults('oreo', { ...empty, branded: [branded('Oreo Original', '3 biscuits')] }).length, 1,
  'a branded row stands on its own when nothing local matched');
eq(mergeFoodResults('anything', empty).length, 0, 'three empty sources merge to an empty list');

/* ── a dish logged from search is the standard serving ─────────────────── */

const ramen = DISHES.find((d) => d.id === 'ramen')!;
const fromSearch = mergeFoodResults('ramen', { ...empty, restaurant: [ramen] })[0];
eq(fromSearch.name, ramen.name, 'a dish keeps its plain name — no portion multiplier in the label');
eq(fromSearch.kcal, ramen.kcal, 'a dish logged from search is the standard 1× serving');
eq(fromSearch.protein, ramen.protein, 'the standard serving carries the dish protein unchanged');

/* ── the rule is deterministic ─────────────────────────────────────────── */

// Same inputs, same list — every time, and regardless of the order the sources
// were listed in. A ranking that depends on which fetch resolved first would
// reorder the list under somebody's finger.
const runA = mergeFoodResults('chicken', {
  common: searchCommonFoods('chicken'),
  restaurant: searchDishes('chicken'),
  branded: [branded('Tesco Chicken Breast'), branded('Chicken Soup')],
});
const runB = mergeFoodResults('chicken', {
  common: searchCommonFoods('chicken'),
  restaurant: searchDishes('chicken'),
  branded: [branded('Tesco Chicken Breast'), branded('Chicken Soup')],
});
eq(JSON.stringify(runA), JSON.stringify(runB), 'the same three inputs always merge to the same list');
ok(runA.length > 0 && runA[0].source === 'common', 'the real tables agree with the rule, not just the fixtures');
// The limit is a cap on the list, not on any one source.
eq(mergeFoodResults('chicken', {
  common: searchCommonFoods('chicken'),
  restaurant: searchDishes('chicken'),
  branded: [branded('Tesco Chicken Breast')],
}, 2).length, 2, 'the limit caps the merged list');

/* ── the common table answers the queries people type ──────────────────── */

// The phrase queries that used to match nothing at all, because no word in any
// name can begin with "chicken breast".
ok(searchCommonFoods('chicken breast').length > 0, '"chicken breast" matches the common table');
ok(searchCommonFoods('greek yogurt').length > 0, '"greek yogurt" matches the common table');
eq(searchCommonFoods('chicken breast')[0].n, 'Chicken Breast, Grilled (150g)',
  'a phrase query leads with the food it named');
// A word typed that lands nowhere still means no.
eq(searchCommonFoods('chicken zzz').length, 0, 'every word typed has to land somewhere');
// And the single-word behaviour it had before is unchanged.
eq(searchCommonFoods('rice')[0].n, 'Brown Rice, Cooked (1 cup, 160g)', 'a one-word query still ranks as it did');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`foodSearch: ok (${DISHES.length} dishes merged with the common table)`);
