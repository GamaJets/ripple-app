// Every assertion here is about a movement a coach would have been shown, or
// not shown, wrongly.
//
// The shape under test is the one a third of the live catalogue is in: 190 of
// 615 rows name no equipment. A rule that treats those as bodyweight puts a
// cable fly in a hotel-room program; a rule that drops them without saying so
// tells a coach the catalogue holds 425 movements. Both are here.
import {
  ALL_KIT, UNRECORDED_KIT, equipmentChips, matchesEquipment, unplacedByEquipment, equipmentGapNote,
} from './equipmentFacet';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// ── the chips are the catalogue's own vocabulary ───────────────────────────
{
  eq(equipmentChips(['barbell', 'cable', 'barbell']), [ALL_KIT, 'Barbell', 'Cable'],
    'one chip per kit, capitalised for display, in alphabetical order');

  // `equipment` is free text. 'Barbell' and 'barbell' are one kit and two chips
  // for it would split the catalogue in half down an invisible seam.
  eq(equipmentChips(['Barbell', 'barbell', 'BARBELL']), [ALL_KIT, 'Barbell'],
    'case is not a second kind of kit');

  // The live table spells its machines with spaces and the RepDB bundle with
  // underscores. catalogueValue() turns both into words, so a chip never reads
  // as a column name.
  eq(equipmentChips(['smith machine', 'ez_bar']), [ALL_KIT, 'Ez Bar', 'Smith Machine'],
    'underscores become words and every chip is a phrase a coach would say');

  // Alphabetical, not by tally: a coach reading this row already knows which
  // kit their floor is missing and is looking for its name.
  eq(equipmentChips(['dumbbell', 'dumbbell', 'dumbbell', 'cable']), [ALL_KIT, 'Cable', 'Dumbbell'],
    'the commonest kit does not jump the queue');
}

// ── the missing column earns a chip, and only when something is missing ────
{
  eq(equipmentChips(['barbell', null, 'cable']), [ALL_KIT, 'Barbell', 'Cable', UNRECORDED_KIT],
    'rows with no equipment get a chip of their own, last');
  eq(equipmentChips(['barbell', '   ', 'cable']), [ALL_KIT, 'Barbell', 'Cable', UNRECORDED_KIT],
    'whitespace is not a kit — it is the same gap as null');
  eq(equipmentChips(['barbell', 'cable']), [ALL_KIT, 'Barbell', 'Cable'],
    'no gap, no chip: one that selects nothing is a control that does nothing');
  eq(equipmentChips([]), [ALL_KIT],
    'an unread catalogue offers no kit chips rather than inventing them');
  eq(equipmentChips([null, null]), [ALL_KIT, UNRECORDED_KIT],
    'a catalogue that records no equipment at all still reaches its rows');
}

// ── a null never joins a kit, and never joins all of them ─────────────────
{
  ok(matchesEquipment('barbell', 'Barbell'), 'a kit matches its own chip whatever the casing');
  ok(matchesEquipment('  Barbell ', 'barbell'), 'surrounding space is not part of the name');
  ok(!matchesEquipment('barbell', 'Cable'), 'and matches nothing else');

  // The whole point of the module. 190 live rows are in this state.
  ok(!matchesEquipment(null, 'Barbell'), 'an unrecorded row is NOT a barbell movement');
  ok(!matchesEquipment(null, 'Body Only'),
    'nor a bodyweight one — that is the reading that puts a cable fly in a hotel-room program');
  ok(matchesEquipment(null, UNRECORDED_KIT), 'it is reachable through the chip that names its state');
  ok(matchesEquipment('', UNRECORDED_KIT), 'and so is a blank string, which is the same gap');
  ok(!matchesEquipment('barbell', UNRECORDED_KIT), 'a labelled row is not unrecorded');

  ok(matchesEquipment(null, ALL_KIT) && matchesEquipment('barbell', ALL_KIT),
    'with no kit chosen every row is in, labelled or not');
}

// ── what the filter could not place, counted where it is applied ──────────
{
  const scoped = ['barbell', null, null, 'cable'];
  eq(unplacedByEquipment(scoped, 'Barbell'), 2, 'two rows were never tested against Barbell');
  eq(unplacedByEquipment(scoped, ALL_KIT), 0, 'nothing is hidden when nothing is filtered');
  eq(unplacedByEquipment(scoped, UNRECORDED_KIT), 0,
    'the unrecorded chip SHOWS those rows, so it hides none of them');
  eq(unplacedByEquipment(['barbell', 'cable'], 'Barbell'), 0, 'a fully labelled set leaves nobody out');
}

// ── and it is admitted on the screen ──────────────────────────────────────
{
  const said = equipmentGapNote(2, 'Barbell', true);
  ok(said != null && said.includes('2') && said.includes(UNRECORDED_KIT),
    'the count is given and the chip that recovers those rows is named');
  ok(equipmentGapNote(1, 'Barbell', true)?.startsWith('1 more movement is') === true,
    'one row is singular — "1 more movements" is how a reader stops trusting a screen');

  eq(equipmentGapNote(0, 'Barbell', true), null, 'nothing hidden, nothing said');
  eq(equipmentGapNote(5, ALL_KIT, true), null, 'and nothing said when no kit is chosen');
  eq(equipmentGapNote(5, UNRECORDED_KIT, true), null, 'nor under the chip that shows them');

  // 'partial' and 'error' both arrive here as whole:false. Rows ARE being
  // hidden, so silence is wrong; the count is a subtotal, so a figure is wrong.
  const short = equipmentGapNote(2, 'Barbell', false);
  ok(short != null && !short.includes('2'),
    'a truncated read admits the omission without printing a count of it');
  ok(short != null && short.includes('not known'), 'and says why the number is absent');
  // A caller that has read nothing still gets the admission, because the chip
  // is still lit and rows are still missing from under it.
  ok(equipmentGapNote(0, 'Barbell', false) != null,
    'the admission does not depend on a count we do not have');
}

if (errors.length) {
  console.error(`equipmentFacet.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('equipmentFacet.test.ts — ok');
