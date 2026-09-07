// A member types the only name they have ever heard, and finds the movement.
//
// ── the report this exists for ─────────────────────────────────────────────
//
// The exercise library searched `exercises.name` and the translated name and
// nothing else. RepDB files the movement as Heel Flicks; roughly everybody who
// has been in a warm-up calls it butt kicks, and `exercises.synonyms` on that
// row says so in as many words: ['butt kicks', 'butt kick', 'heel flick',
// 'heel kicks']. Typing "butt kicks" into the library returned no rows and the
// screen then said, correctly for what it held and falsely about the catalogue,
// that no movement matches.
//
// ── the two halves, and why the second one is not optional ────────────────
//
// FINDING the row is half of it. The other half is that the row a synonym found
// still has to be ITSELF. `CatalogueRow.display` is the translated name a screen
// prints; `name` is the identity — it is what `exerciseSlug` turns into the id,
// what a programme stores, and what the detail screen is opened with. A search
// that resolved "butt kicks" to a row called "butt kicks" would put a movement
// into a client's week that resolves to nothing. So every assertion below that
// finds a row also checks what the row IS.
//
// And a result the member cannot explain is barely better than no result. They
// typed "butt kicks"; the list comes back holding one row titled Heel Flicks,
// with not a word of what they typed anywhere on it. That reads as a broken
// search. `matchedSynonym` is what the screens print beside such a row, so its
// answer is asserted here too — including the case where it must stay SILENT,
// which is every row whose own name matched.
import { matchesSearch, matchedSynonym, type DisplayString } from './catalogueLocale';
import { exerciseSlug } from './exerciseId';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

/**
 * The search-relevant half of `CatalogueRow`.
 *
 * Not imported from src/ui/exerciseDetail.ts: that module pulls in the Supabase
 * client and React, neither of which belongs in a file `node` runs directly.
 * The four fields here are the four the filter reads, and if the real row ever
 * loses one of them the screens stop compiling, which is the correspondence
 * that keeps this fixture honest.
 */
interface Row {
  id: string;
  name: string;
  display: DisplayString;
  synonyms: string[];
}

const en = (text: string): DisplayString => ({ text, locale: 'en', isFallback: false });

/**
 * Four rows from the real catalogue, with their real synonym arrays.
 *
 * Taken verbatim from the RepDB v1.41 bundle, checked against the live
 * `public.exercises` on 7 September 2026. Two of them carry synonyms and two
 * carry none — the empty array is the ORDINARY case across the catalogue
 * (`synonyms` is `not null default '{}'`), so a fixture of nothing but
 * synonym-bearing rows would be testing a catalogue we do not have.
 */
const ROWS: Row[] = [
  { id: 'heel-flicks', name: 'Heel Flicks', display: en('Heel Flicks'), synonyms: ['butt kicks', 'butt kick', 'heel flick', 'heel kicks'] },
  { id: 'skierg', name: 'SkiErg', display: en('SkiErg'), synonyms: ['ski erg', 'ski ergometer', 'ski machine', 'Nordic ski trainer'] },
  { id: 'back-squat', name: 'Back Squat', display: en('Back Squat'), synonyms: [] },
  { id: 'bench-press', name: 'Bench Press', display: en('Bench Press'), synonyms: [] },
];

/** The library screens' filter, in one line, so this file tests the rule the
 *  app runs rather than a second copy of it. */
const found = (term: string, rows: Row[] = ROWS): Row[] =>
  rows.filter((r) => matchesSearch(term, r.name, r.display, r.synonyms));

// ── a synonym finds the row, and the row is still the row ─────────────────
{
  const hits = found('butt kicks');
  eq(hits.length, 1, 'searching "butt kicks" returns exactly one movement, where it used to return none');
  const hit = hits[0];
  if (!hit) {
    errors.push('searching "butt kicks" found nothing at all, which is the defect this file is about');
  } else {
    // The identity assertions. Deliberately spelled out rather than compared to
    // the fixture object, because "the row we got back is the row we put in" is
    // a tautology and this has to fail if the search ever starts answering with
    // the synonym rather than with the movement.
    eq(hit.name, 'Heel Flicks', 'the row found by "butt kicks" is the one named Heel Flicks — the synonym is how it was found, never what it is called');
    eq(hit.id, 'heel-flicks', 'and it carries the real id, which is what a programme and the detail screen resolve');
    eq(exerciseSlug(hit.name), hit.id, 'the id is still the slug of the identity name, which is the whole basis of resolving a movement');
    eq(hit.display.text, 'Heel Flicks', 'the name on screen is the catalogue name, not the thing that was typed');
    // The reason the "matched" line has to exist at all: nothing the member
    // typed appears anywhere in what the row shows them.
    ok(!hit.display.text.toLowerCase().includes('butt kicks'),
      'the title of the found row contains none of what was typed — which is exactly why the screen has to say which name it matched');
    eq(matchedSynonym('butt kicks', hit.name, hit.display, hit.synonyms), 'butt kicks',
      'and the screen is told which synonym matched, so it can print "Matched “butt kicks”" instead of an unexplained row');
  }
}

// ── the search is still a search ──────────────────────────────────────────
//
// Every assertion above is satisfied by a `matchesSearch` that returns true for
// everything. These are the ones that are not.
{
  eq(found('butt kicks').map((r) => r.id), ['heel-flicks'],
    'a synonym search returns the one movement that carries it and not the other three');
  eq(found('deadlift').length, 0, 'a term in no name and no synonym still finds nothing');
  eq(found('ski erg').map((r) => r.id), ['skierg'],
    'a synonym that differs from the name only by a space is a real miss without this, and a real hit with it');
  eq(found('squat').map((r) => r.id), ['back-squat'], 'and an ordinary name search is unchanged');
  eq(found('').length, ROWS.length, 'an empty term matches everything, as every list in this app does');
  eq(found('   ').length, ROWS.length, 'and so does a term of nothing but spaces');
  eq(found('BUTT KICKS').map((r) => r.id), ['heel-flicks'], 'case is not a filter here either');
  eq(found('  butt kicks  ').map((r) => r.id), ['heel-flicks'], 'nor is the whitespace around what somebody typed');
}

// ── a row with no synonyms behaves exactly as it did before ───────────────
//
// Most of the catalogue is this row. `synonyms` is `not null default '{}'`, so
// an empty array is a movement with one well-known name and never a read that
// failed — and a search must not start or stop matching because of it.
{
  ok(matchesSearch('bench', 'Bench Press', en('Bench Press'), []), 'a row with no synonyms is still found by its name');
  ok(!matchesSearch('butt kicks', 'Bench Press', en('Bench Press'), []), 'and is not found by somebody else’s');
  eq(matchedSynonym('bench', 'Bench Press', en('Bench Press'), []), null, 'a row with no synonyms has nothing to explain');
  // The callers that have not been given the column yet, and the ones where the
  // read has not landed. Neither may throw and neither may match on nothing.
  ok(matchesSearch('bench', 'Bench Press', en('Bench Press')), 'the argument is optional and its absence is not a match on everything');
  ok(matchesSearch('bench', 'Bench Press', en('Bench Press'), null), 'and neither is a null column');
  eq(matchedSynonym('bench', 'Bench Press', en('Bench Press'), undefined), null, 'nor is a missing one an explanation');
  // A blank entry inside the array would otherwise match every term ever typed,
  // because ''.includes(anything) is false but anything.includes('') is true —
  // this is the direction that bites. The hook strips blanks; the rule below is
  // what makes that stripping observable.
  eq(matchedSynonym('deadlift', 'Bench Press', en('Bench Press'), ['']), null,
    'an empty string in the array is not a synonym that matches everything');
  eq(found('deadlift', [{ id: 'x', name: 'Bench Press', display: en('Bench Press'), synonyms: [''] }]).length, 0,
    'and it does not put a movement into a result list it has nothing to do with');
}

// ── when the screen must stay silent ──────────────────────────────────────
//
// `matchedSynonym` is printed as a sentence on the row. A sentence under every
// row is not an explanation, it is noise, so it has to be null in the three
// cases where the reader can already see the answer.
{
  eq(matchedSynonym('heel', 'Heel Flicks', en('Heel Flicks'), ROWS[0]!.synonyms), null,
    'a term that matches the NAME needs no explanation, even though it also matches "heel flick" and "heel kicks"');
  eq(matchedSynonym('', 'Heel Flicks', en('Heel Flicks'), ROWS[0]!.synonyms), null,
    'an unfiltered list explains nothing — every row is in it because nothing was typed');
  eq(matchedSynonym('deadlift', 'Heel Flicks', en('Heel Flicks'), ROWS[0]!.synonyms), null,
    'and a row that did not match at all has nothing to say about why it did');
  // First in the catalogue's order, not last and not "the shortest". Two
  // members typing the same thing must be told the same thing.
  eq(matchedSynonym('kick', 'Heel Flicks', en('Heel Flicks'), ROWS[0]!.synonyms), 'butt kicks',
    'where several synonyms match, the first the catalogue stores is the one named');
}

// ── the translated name still counts, and still wins ──────────────────────
//
// A German member reads "Kniebeuge". The synonym list is English — RepDB stores
// one set of alternative names, in the catalogue's own language — so a German
// reader searching a synonym is searching English, which is exactly the case
// `matchedSynonym` exists to caption.
{
  const de: DisplayString = { text: 'Kniebeuge', locale: 'de', isFallback: false };
  ok(matchesSearch('knie', 'Back Squat', de, ['barbell back squat']), 'the German name is still searched');
  eq(matchedSynonym('knie', 'Back Squat', de, ['barbell back squat']), null, 'and matching it needs no caption');
  ok(matchesSearch('barbell back', 'Back Squat', de, ['barbell back squat']), 'an English synonym reaches a German reader');
  eq(matchedSynonym('barbell back', 'Back Squat', de, ['barbell back squat']), 'barbell back squat',
    'and it is captioned, because a row titled "Kniebeuge" holds not one word of what was typed');
}

if (errors.length) {
  console.error(`synonymSearch.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('synonymSearch.test.ts — ok');
