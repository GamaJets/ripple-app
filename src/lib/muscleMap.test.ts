// The mapping between what the catalogue trains and what the artwork draws.
//
// The assertion that matters most is the last one: every muscle this file
// claims to draw must actually be a file in the shipped manifest. A typo in
// that table is invisible — the overlay simply never lights — and a heatmap
// that quietly omits the lats is worse than one that fails.
import { readFileSync } from 'node:fs';
import {
  mapMuscle, unmapped, approximations, isUndrawn, drawnIntensity,
} from './muscleMap';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the three mismatches the header names ──────────────────────────────── */

// One catalogue name, several layers: a thigh is not drawn in stripes.
eq(mapMuscle('quadriceps')?.drawn.length, 3, 'quadriceps reaches all three quad layers');
eq(mapMuscle('hamstrings')?.drawn.length, 3, 'and hamstrings all three of theirs');

// Several catalogue names, one layer.
eq(mapMuscle('anterior deltoid')?.drawn[0], 'deltoids', 'the front of the shoulder is the shoulder');
eq(mapMuscle('posterior deltoid')?.drawn[0], 'deltoids', 'and so is the back of it');

// Named and not drawn.
eq(mapMuscle('rhomboids')?.tier, 'approximate', 'the rhomboids are stood in for, not drawn');
ok((mapMuscle('rhomboids')?.note ?? '').includes('trapezius'),
  'and the note says which muscle is carrying them');
ok(isUndrawn('quadratus lumborum'), 'the quadratus lumborum is not drawn at all');
eq(mapMuscle('quadratus lumborum')?.drawn.length, 0, 'so it lights nothing');

// A name this table has never heard of lights nothing and is reported, rather
// than throwing or being silently dropped.
eq(mapMuscle('sternocleidomastoid')?.drawn.length, 0, 'an unknown trained name lights nothing');
eq(unmapped(['quadriceps', 'quadratus lumborum', 'rhomboids']).join(','), 'quadratus lumborum',
  'and only the genuinely undrawn are reported as missing from the picture');

/* ── the two combination rules ──────────────────────────────────────────── */

// Spread: each layer gets the whole value, not a share.
{
  const d = drawnIntensity({ quadriceps: 0.9 });
  eq(d.vastus_lateralis, 0.9, 'a spread muscle gives each layer its whole value');
  eq(d.rectus_femoris, 0.9, 'all three of them');
}

// Collapse: the LARGEST, never the sum. Three half-trained deltoid heads is a
// shoulder trained half as hard, and 1.5 would say the opposite.
{
  const d = drawnIntensity({ 'anterior deltoid': 0.5, 'lateral deltoid': 0.5, 'posterior deltoid': 0.5 });
  eq(d.deltoids, 0.5, 'three names on one layer take the largest, not the sum');
  const e = drawnIntensity({ 'anterior deltoid': 0.2, 'lateral deltoid': 0.8 });
  eq(e.deltoids, 0.8, 'and the largest is the largest');
}

// Nothing untrained is lit, and a nonsense figure cannot light anything.
{
  const d = drawnIntensity({ quadriceps: 0, hamstrings: NaN, 'gluteus maximus': -1 });
  eq(Object.keys(d).length, 0, 'zero, NaN and negative all light nothing');
}

eq(approximations(['quadriceps', 'gluteus maximus']).length, 0,
  'a week of exactly-drawn work needs no caveat');
eq(approximations(['rhomboids', 'rhomboids']).length, 1,
  'and one that needs one says it once, not once per movement');

/* ── the assertion this file exists for ─────────────────────────────────── */
//
// Every name in the mapping table must be a real overlay in the built
// manifest. Checked against the shipped file rather than a hand-written list,
// so regenerating the assets with a renamed layer fails here instead of
// silently drawing nothing.
{
  const manifest = JSON.parse(readFileSync('assets/muscle-heatmap/manifest.json', 'utf8'));
  const drawnNames = new Set<string>();
  for (const side of Object.values(manifest.sides) as any[]) {
    for (const m of side.muscles) drawnNames.add(m.name);
  }
  ok(drawnNames.size >= 30, `the manifest carries the full muscle set — got ${drawnNames.size}`);

  const TRAINED = [
    'gluteus maximus', 'quadriceps', 'pectoralis major', 'latissimus dorsi', 'anterior deltoid',
    'hamstrings', 'rectus abdominis', 'triceps brachii', 'erector spinae', 'lateral deltoid',
    'trapezius', 'biceps brachii', 'obliques', 'rhomboids', 'hip flexors', 'gluteus medius',
    'gastrocnemius', 'posterior deltoid', 'adductors', 'forearm flexors', 'transverse abdominis',
    'brachialis', 'soleus', 'forearm extensors', 'abductors', 'brachioradialis', 'quadratus lumborum',
  ];
  for (const t of TRAINED) {
    const m = mapMuscle(t);
    for (const d of m?.drawn ?? []) {
      ok(drawnNames.has(d), `"${t}" claims to light "${d}", which is not a layer in the manifest`);
    }
  }
  // And the catalogue's whole vocabulary is accounted for: every name either
  // draws something or is a declared gap. A name that silently drew nothing
  // and was not declared is the failure this catches.
  const silent = TRAINED.filter((t) => (mapMuscle(t)?.drawn.length ?? 0) === 0 && !isUndrawn(t));
  eq(silent.join(','), '', 'every trained muscle either draws or is a declared gap');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`muscleMap: ok — 27 trained names over 32 drawn layers, ${unmapped(['quadratus lumborum']).length} declared gap`);
