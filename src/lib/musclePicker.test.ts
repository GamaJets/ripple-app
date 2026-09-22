// The picker's menu: no label twice, every label Title Case, head-to-toe
// order, and the body's green/amber reading of what is picked.
//
// The failure this exists to stop shipped: Chest, Shoulders, Hamstrings,
// Glutes and Calves each drawn twice, and "Lower back" beside "Lower Back",
// because a group and a muscle of the same name were both listed.
import {
  PICKER_REGIONS, optionKey, pickedLayers, regionAt, regionSpoken, regionState, regionsOn,
  toggleOption, toggleRegion,
} from './musclePicker';
import { MUSCLE_TARGETS } from './targetedWorkout';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${msg} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

/** The catalogue's 11 `muscle_group` values, as src/ui/MuscleGroupPicker.tsx lists them. */
const GROUPS = ['Full body', 'Back', 'Shoulders', 'Core', 'Chest', 'Legs',
  'Arms', 'Hamstrings', 'Glutes', 'Lower back', 'Calves'];
const lc = (s: string) => s.toLowerCase();
const options = PICKER_REGIONS.flatMap((r) => r.options);

/* ── no duplicates, Title Case, every chip a real target ─────────────────── */
{
  const labels = options.map((o) => lc(o.label));
  eq(labels.filter((l, i) => labels.indexOf(l) !== i), [], 'no label appears twice, whatever its case');
  for (const o of options) {
    ok(o.label.split(' ').every((w) => /^[A-Z][a-z]*$/.test(w)), `${o.label} is Title Case`);
    if (o.target.kind === 'group') ok(GROUPS.some((g) => lc(g) === lc(o.target.name)), `${o.label} is a catalogue group`);
    else ok(MUSCLE_TARGETS.some((m) => m.label === o.target.name), `${o.label} is a muscle the generator knows`);
  }
  // Nothing the old list offered is lost: every group and every muscle label
  // is still reachable, under its own chip or a same-named group chip.
  for (const g of GROUPS) ok(labels.includes(lc(g)), `${g} is still offered`);
  for (const m of MUSCLE_TARGETS) ok(labels.includes(lc(m.label)), `${m.label} is still offered`);
}

/* ── order and grouping ─────────────────────────────────────────────────── */
{
  eq(PICKER_REGIONS.map((r) => r.label),
    ['Full Body', 'Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Glutes', 'Legs'], 'head to toe');
  eq([...new Set(PICKER_REGIONS.map((r) => r.area))], ['Full Body', 'Upper Body', 'Core', 'Lower Body'],
    'areas in order, each contiguous');
  const back = PICKER_REGIONS.find((r) => r.key === 'back')!;
  eq(back.options.map((o) => o.label), ['Back', 'Lats', 'Upper Back', 'Lower Back'], 'Back row');
  eq(PICKER_REGIONS.find((r) => r.key === 'arms')!.options.map((o) => o.label),
    ['Arms', 'Biceps', 'Triceps', 'Forearms'], 'Arms row');
  for (const r of PICKER_REGIONS) ok(r.options[0].lead && r.options[0].label === r.label, `${r.label} leads its own row`);
}

/* ── selection state ────────────────────────────────────────────────────── */
{
  const back = PICKER_REGIONS.find((r) => r.key === 'back')!;
  const [lead, lats, upper, lower] = back.options.map((o) => optionKey(o.target));
  eq(regionState(back, []), 'none', 'nothing picked');
  eq(regionState(back, [lats]), 'partial', 'only Lats is part of Back');
  eq(regionState(back, [lats, upper, lower]), 'full', 'every muscle in it is all of it');
  eq(regionState(back, [lead]), 'full', 'the group chip is the whole region');
  eq(regionSpoken(back, 'partial'), 'Back, partly selected', 'spoken');

  // Body taps and chips share one list.
  eq(toggleRegion(back, [lats]), [lats, lead], 'a partial region tapped picks its group');
  eq(toggleRegion(back, [lats, lead]), [], 'a full region tapped empties');
  eq(toggleOption(back.options[1].target, [lats]), [], 'the chip toggles the same key');

  const lit = pickedLayers([lats]);
  eq(lit.latissimus_dorsi, 0.5, 'a partly picked region draws its muscle amber');
  ok(lit.trapezius == null, 'and not the rest of the region');
  const full = pickedLayers([lead]);
  eq([full.latissimus_dorsi, full.trapezius, full.erector_spinae], [1, 1, 1], 'a full region draws green');
  ok(Object.keys(pickedLayers([optionKey(PICKER_REGIONS[0].options[0].target)])).length > 20,
    'Full Body lights the whole figure');
}

/* ── the figure's hit map ───────────────────────────────────────────────── */
{
  eq(regionAt('front', 0.4, 0.2)?.key, 'chest', 'the front of the chest');
  eq(regionAt('front', 0.5, 0.33)?.key, 'core', 'the stomach');
  eq(regionAt('front', 0.35, 0.6)?.key, 'legs', 'a thigh');
  eq(regionAt('back', 0.4, 0.25)?.key, 'back', 'the upper back');
  eq(regionAt('back', 0.4, 0.47)?.key, 'glutes', 'the seat');
  eq(regionAt('front', 0.5, 0.02), null, 'the head is nothing');
  eq(regionsOn('front').map((r) => r.key), ['chest', 'back', 'shoulders', 'arms', 'core', 'legs'], 'front regions');
  eq(regionsOn('back').map((r) => r.key), ['back', 'shoulders', 'arms', 'glutes', 'legs'], 'back regions');
}

if (errors.length) {
  console.error(`musclePicker.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error('  · ' + e);
  process.exit(1);
}
console.log('musclePicker.test.ts — ok');
