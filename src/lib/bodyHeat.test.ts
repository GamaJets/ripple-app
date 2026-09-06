// The ramp, the layer selection and the sentence the diagram says.
//
// Two of these assertions are the ones that matter and neither is about a
// component. The first is the contrast walk: every band of both ramps, against
// the unlit body ground of every one of the ten palettes and every one of that
// palette's four grounds, must clear the 3:1 that WCAG 1.4.11 asks of a
// graphical object. The numbers in src/lib/bodyHeat.ts's header are that walk's
// output, and a colour edited by hand without re-running it is the failure this
// catches — the same failure src/theme/tokens.ts describes when its status
// colours sat at 1.68:1 on white and nothing looked.
//
// The second is the manifest agreement. src/ui/muscleArt.ts is 76 hand-written
// `require` calls because Metro will not resolve a template string, and a file
// added to the artwork and missed there is a muscle that silently never lights.
// So the table and the manifest are asserted against each other in BOTH
// directions.
//
// `require`, not `import`, for the same reason src/lib/muscleMap.test.ts gives:
// this file lives under src/**, which `check:types` compiles with the phone
// app's tsconfig and no node types, so a top-level `import … from 'node:fs'`
// fails that gate while passing the test build.
const { readFileSync } = require('node:fs') as {
  readFileSync: (p: string, enc: string) => string;
};
import { contrastRatio, luminance, AA_MARK } from './a11y';
import { PALETTES } from '../theme/tokens';
import {
  RAMP_DARK, RAMP_LIGHT, GROUND_MIX, bandOf, bandSpoken, bodyGround, bodySpoken,
  litLayers, notOnThisSide, rampFor, sayLayer, type Band,
} from './bodyHeat';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the contrast walk ──────────────────────────────────────────────────── */

{
  let worst = Infinity;
  let worstWhere = '';
  let checked = 0;
  for (const p of PALETTES) {
    const ramp = p.light ? RAMP_LIGHT : RAMP_DARK;
    // The four grounds a diagram can plausibly be drawn on, the same four
    // src/lib/a11y.test.ts walks the inks against.
    for (const card of [p.theme.bg, p.theme.surface, p.theme.surface2, p.theme.surface3]) {
      const ground = bodyGround(p.theme.ink3, card);
      for (const b of ramp) {
        const r = contrastRatio(b.color, ground);
        checked += 1;
        ok(r != null, `${p.key}: band ${b.no} vs ${ground} did not measure`);
        if (r != null && r < worst) { worst = r; worstWhere = `${p.key} band ${b.no} (${b.color}) on ${ground}`; }
      }
      // And the ramp the palette would actually be handed is the one measured.
      eq(rampFor(p.theme.bg), ramp, `${p.key} reaches for the ${p.light ? 'light' : 'dark'} ramp`);
    }
  }
  eq(checked, 160, 'ten palettes × four grounds × four bands were measured');
  ok(worst >= AA_MARK, `every band clears 3:1 on its own ground — worst is ${worst.toFixed(2)}:1 at ${worstWhere}`);
  // Not merely "clears": the header quotes 3.13, and a change that scrapes past
  // 3.001 has moved the design without saying so.
  ok(worst >= 3.05, `and clears it with the margin the header claims — ${worst.toFixed(2)}:1 at ${worstWhere}`);
}

// The unlit body has to be findable on its own card too. 3:1 is NOT the bar
// here and claiming it would be false: a body silhouette is not a graphical
// object carrying information — the LIT muscles are, and they are what the walk
// above measures. This is the weaker promise the design actually makes, and it
// is written down so that lowering GROUND_MIX to make the ramp's life easier
// fails here instead of quietly fading the figure out.
{
  let worst = Infinity;
  let where = '';
  for (const p of PALETTES) {
    for (const card of [p.theme.bg, p.theme.surface, p.theme.surface2, p.theme.surface3]) {
      const r = contrastRatio(bodyGround(p.theme.ink3, card), card);
      if (r != null && r < worst) { worst = r; where = `${p.key} on ${card}`; }
    }
  }
  ok(worst >= 1.4, `the unlit body is visible on every card — worst is ${worst.toFixed(2)}:1 at ${where}`);
}

eq(GROUND_MIX, 0.3, 'the ground mix is the 0.30 the header did the arithmetic for');

// Both ramps are monotone in lightness, in their own direction. This is the
// property that makes them a ramp rather than four colours: a member comparing
// two muscles is reading lightness whether they know it or not.
for (const [name, ramp, rising] of [['dark', RAMP_DARK, true], ['light', RAMP_LIGHT, false]] as const) {
  for (let i = 1; i < ramp.length; i++) {
    const a = luminance(ramp[i - 1].color);
    const b = luminance(ramp[i].color);
    ok(a != null && b != null && (rising ? b > a : b < a),
      `the ${name} ramp moves the same way at every step — band ${i} to ${i + 1}`);
  }
  eq(ramp.length, 4, `the ${name} ramp is four bands`);
  eq(ramp.map((b) => b.no).join(','), '1,2,3,4', `the ${name} ramp is numbered 1 to 4 in order`);
}

// The two ramps must not be the same colours. If a later edit makes them equal
// the header's whole argument — that one fixed ramp cannot clear 3:1 on both a
// dark and a light palette — has been thrown away without being answered.
ok(RAMP_DARK.some((b, i) => b.color !== RAMP_LIGHT[i].color),
  'the two schemes carry different colours, which is the reason there are two');

// A background nothing can parse is treated as dark rather than throwing. A
// white-label tenant's brand reaches the theme from a database column.
eq(rampFor('not-a-colour'), RAMP_DARK, 'an unreadable background falls back to the dark ramp');

/* ── bands ──────────────────────────────────────────────────────────────── */

eq(bandOf(0, RAMP_DARK), null, 'an untrained muscle is not a band, it is nothing');
eq(bandOf(-1, RAMP_DARK), null, 'and neither is a negative one');
eq(bandOf(NaN, RAMP_DARK), null, 'nor a NaN out of an average over no rows');
eq(bandOf(0.001, RAMP_DARK)?.no, 1, 'the faintest real training is band 1, not nothing');
eq(bandOf(0.25, RAMP_DARK)?.no, 1, 'a boundary belongs to the band below it');
eq(bandOf(0.2501, RAMP_DARK)?.no, 2, 'and the next value to the band above');
eq(bandOf(1, RAMP_DARK)?.no, 4, 'the top of the range is band 4');
eq(bandOf(1.0000002, RAMP_DARK)?.no, 4, 'and so is a normalisation that overshot by a rounding error');
eq(bandOf(0.6, RAMP_DARK)?.name, 'Heavy', 'a band knows its own name');

/* ── which layers get drawn ─────────────────────────────────────────────── */

const FRONT = ['pectoralis_major', 'abdominals', 'deltoids', 'rectus_femoris', 'obliques'];

{
  const lit = litLayers({ pectoralis_major: 0.9, abdominals: 0.1, deltoids: 0 }, FRONT, RAMP_DARK);
  eq(lit.length, 2, 'a layer at zero is dropped rather than drawn transparent');
  // Coldest first: an overlap resolves to the hotter muscle because the hotter
  // one is painted last. Reversing this hides a hard-trained muscle under a
  // lightly-trained one, which is the fact the picture exists to show.
  eq(lit[0].layer, 'abdominals', 'the coldest is painted first');
  eq(lit[1].layer, 'pectoralis_major', 'and the hottest last, so it wins the overlap');
  eq(lit[0].band.no, 1, 'the light one is band 1');
  eq(lit[1].band.no, 4, 'and the hard one band 4');
}

{
  // Stable order within a band, so a stack does not reshuffle when the
  // aggregation upstream happens to hand its keys back in a different order.
  const a = litLayers({ obliques: 0.9, abdominals: 0.9 }, FRONT, RAMP_DARK).map((l) => l.layer).join(',');
  const b = litLayers({ abdominals: 0.9, obliques: 0.9 }, FRONT, RAMP_DARK).map((l) => l.layer).join(',');
  eq(a, b, 'two maps with the same contents paint in the same order');
  eq(a, 'abdominals,obliques', 'ties break by name');
}

eq(litLayers({}, FRONT, RAMP_DARK).length, 0, 'an empty map lights nothing');
eq(litLayers({ soleus: 0.9 }, FRONT, RAMP_DARK).length, 0,
  'a muscle this side cannot draw is not drawn on it');
eq(notOnThisSide({ soleus: 0.9, pectoralis_major: 0.5 }, FRONT).join(','), 'soleus',
  'and it is reported instead of swallowed, so the screen can say to turn the body around');
eq(notOnThisSide({ soleus: 0 }, FRONT).length, 0,
  'an untrained muscle that this side cannot draw is not a gap worth mentioning');

/* ── what a screen reader hears ─────────────────────────────────────────── */

eq(sayLayer('biceps_femoris'), 'biceps femoris', 'a layer name is said without its underscores');

{
  // The two empty pictures src/ui/loadStatus.ts exists to keep apart. They must
  // not say the same thing, and neither may claim the other's fact.
  const nothing = bodySpoken({ side: 'front', lit: [], missing: [], graded: true, caution: 'Nothing trained in this period' });
  const broken = bodySpoken({ side: 'front', lit: [], missing: [], graded: false, caution: 'Your training could not be read, so this is not a picture of it' });
  ok(nothing !== broken, 'an empty week and a failed read do not say the same sentence');
  ok(nothing.includes('Nothing trained'), 'the empty week states the fact it is allowed to state');
  ok(!broken.includes('Nothing trained'), 'and the failed read never states it');
  ok(broken.includes('could not be read'), 'the failed read says so instead');
  ok(nothing.startsWith('Front of the body'), 'both say which way the body is facing first');
}

{
  const lit = litLayers({ pectoralis_major: 0.9, abdominals: 0.1 }, FRONT, RAMP_DARK);
  const said = bodySpoken({ side: 'back', lit, missing: ['soleus'], graded: true, caution: null });
  ok(said.includes('2 muscles trained'), 'the count is said, not left to the picture');
  ok(said.includes('band 4 of 4'), 'and every muscle carries its band NUMBER, not just a colour');
  ok(said.includes('Very heavy'), 'and its band name');
  ok(said.indexOf('pectoralis major') < said.indexOf('abdominals'),
    'said hottest first, which is the order a person would ask in');
  ok(said.includes('front of the body'), 'a muscle this side cannot draw is said too, and where it is');
  ok(said.startsWith('Back of the body'), 'the back says it is the back');
}

{
  // Under 'partial' the bands are not claimed, and the sentence must not claim
  // them either. A spoken "band 4 of 4" over a truncated read is the audible
  // version of drawing a subtotal as a total.
  const lit = litLayers({ pectoralis_major: 0.9 }, FRONT, RAMP_DARK);
  const said = bodySpoken({ side: 'front', lit, missing: [], graded: false, caution: 'Only part of your history came back' });
  ok(!said.includes('band'), 'an ungraded picture says no band at all');
  ok(said.includes('pectoralis major'), 'but still names the muscle, which is a list and is allowed');
  ok(said.includes('Only part'), 'and leads with why');
}

eq(bodySpoken({ side: 'front', lit: litLayers({ abdominals: 0.9 }, FRONT, RAMP_DARK), missing: [], graded: true, caution: null }),
  'Front of the body. 1 muscle trained. abdominals, band 4 of 4, Very heavy.',
  'one muscle is said in the singular');

eq(bandSpoken(RAMP_DARK[1]), 'Band 2 of 4, Moderate', 'a legend chip says its number and its name');

/* ── the artwork table and the manifest agree ───────────────────────────── */

{
  const manifest = JSON.parse(readFileSync('assets/muscle-heatmap/manifest.json', 'utf8'));
  // The require table is read as TEXT rather than imported: importing it pulls
  // 76 `require` calls for .webp files through the test compiler, which has no
  // asset transformer and would fail on the first one.
  const art = readFileSync('src/ui/muscleArt.ts', 'utf8');

  let files = 0;
  for (const side of ['front', 'back'] as const) {
    const s = manifest.sides[side];
    ok(art.includes(`'../../assets/muscle-heatmap/${s.base}'`), `the ${side} base is in the require table`);
    files += 1;
    for (const m of s.muscles) {
      ok(art.includes(`'../../assets/muscle-heatmap/${m.file}'`),
        `${m.file} is in the manifest and missing from src/ui/muscleArt.ts, so it would never light`);
      ok(art.includes(`{ name: '${m.name}', side: '${m.side}',`),
        `${m.file} is required but not indexed under its own name and side`);
      files += 1;
    }
    // The aspect ratios are copied into the table rather than imported, so they
    // are checked here. A rebuild that changes the source art's proportions and
    // leaves these behind draws a squashed body and nothing else notices.
    ok(art.includes(`aspect: ${s.aspect}`), `the ${side} aspect ratio ${s.aspect} is the manifest's`);
  }
  eq(files, 76, 'all 76 shipped images are accounted for');

  // And back the other way: nothing is required that the manifest does not ship.
  for (const m of art.matchAll(/assets\/muscle-heatmap\/([A-Za-z0-9_]+\.webp)/g)) {
    const file = m[1];
    const known = (['front', 'back'] as const).some((side) =>
      manifest.sides[side].base === file || manifest.sides[side].muscles.some((x: { file: string }) => x.file === file));
    ok(known, `src/ui/muscleArt.ts requires ${file}, which the manifest does not ship — a red screen on load`);
  }

  // The front and the back are genuinely different shapes. A single ratio for
  // "a body" squashes one of them, and the difference is small enough (0.0163)
  // to look like a rounding artefact to somebody tidying up.
  ok(manifest.sides.front.aspect !== manifest.sides.back.aspect,
    'the two sides have their own aspect ratios and neither may be assumed');
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`bodyHeat: ok — ${RAMP_DARK.length + RAMP_LIGHT.length} bands over 10 palettes, 76 images indexed`);
