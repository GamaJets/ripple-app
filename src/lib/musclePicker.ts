// The muscle picker's menu: which chips, in which order, and what the body
// figure beside them lights. Shared by the member's Build a Workout screen and
// the coach's program builder, so both ask the same question the same way.
//
// ── Why the old list showed Chest twice ──────────────────────────────────
//
// The screen drew each of the catalogue's 11 `muscle_group` values and then,
// beside it, every `MUSCLE_TARGETS` entry filed under it. Six labels are BOTH:
// Shoulders, Chest, Hamstrings, Glutes, Calves and Lower Back are a
// `muscle_group` value and also a member's name for a set of
// `primary_muscles`. So each drew twice, and the group side kept the
// catalogue's sentence case, which is how "Lower back" sat beside "Lower Back".
//
// Here every label is written once, in Title Case. Where a word is both, the
// GROUP target is kept: it is the region's own name and the catalogue files
// whole movements under it. Matching in src/lib/targetedWorkout.ts ignores
// case, so "Lower Back" as a group target still finds `muscle_group`
// 'Lower back'.
//
// ── Order ────────────────────────────────────────────────────────────────
//
// Head to toe, the way a coach reads a body: Full Body, then Upper Body
// (Chest, Back, Shoulders, Arms), Core, then Lower Body (Glutes, Legs). One row
// per region, its group chip first and its muscles after it in anatomical
// order. Only targets the generator understands are offered: every muscle chip
// is a `MUSCLE_TARGETS` label, every group chip one of the 11 groups.
import { MUSCLE_TARGETS, type Target } from './targetedWorkout';
import { mapMuscle } from './muscleMap';

export type RegionKey = 'fullBody' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'glutes' | 'legs';
export type Area = 'Full Body' | 'Upper Body' | 'Core' | 'Lower Body';
export type RegionState = 'none' | 'partial' | 'full';
export type BodySide = 'front' | 'back';

export interface PickerOption {
  label: string;
  target: Target;
  /** The region's own group chip, first in its row. */
  lead: boolean;
}

export interface PickerRegion {
  key: RegionKey;
  label: string;
  area: Area;
  options: PickerOption[];
}

const g = (name: string): Target => ({ kind: 'group', name });
const m = (name: string): Target => ({ kind: 'muscle', name });

const region = (key: RegionKey, area: Area, lead: string, rest: Target[] = []): PickerRegion => ({
  key, label: lead, area,
  options: [{ label: lead, target: g(lead), lead: true }, ...rest.map((t) => ({ label: t.name, target: t, lead: false }))],
});

export const PICKER_REGIONS: readonly PickerRegion[] = [
  region('fullBody', 'Full Body', 'Full Body'),
  region('chest', 'Upper Body', 'Chest'),
  region('back', 'Upper Body', 'Back', [m('Lats'), m('Upper Back'), g('Lower Back')]),
  region('shoulders', 'Upper Body', 'Shoulders', [m('Front Delts'), m('Side Delts'), m('Rear Delts')]),
  region('arms', 'Upper Body', 'Arms', [m('Biceps'), m('Triceps'), m('Forearms')]),
  region('core', 'Core', 'Core', [m('Abs'), m('Obliques')]),
  region('glutes', 'Lower Body', 'Glutes', [m('Outer Hips')]),
  region('legs', 'Lower Body', 'Legs',
    [m('Quads'), g('Hamstrings'), m('Inner Thighs'), m('Hip Flexors'), g('Calves')]),
];

/** The same key the screens keep their chosen list in. */
export const optionKey = (t: Target): string => `${t.kind}:${t.name}`;

/** Full when its group chip is picked, or every muscle in it is. */
export function regionState(r: PickerRegion, chosen: readonly string[]): RegionState {
  const on = r.options.filter((o) => chosen.includes(optionKey(o.target)));
  if (!on.length) return 'none';
  if (on.some((o) => o.lead)) return 'full';
  return on.length === r.options.length - 1 ? 'full' : 'partial';
}

/** A tap on the body: a full region empties, anything else picks its group. */
export function toggleRegion(r: PickerRegion, chosen: readonly string[]): string[] {
  const keys = r.options.map((o) => optionKey(o.target));
  if (regionState(r, chosen) === 'full') return chosen.filter((k) => !keys.includes(k));
  const lead = optionKey(r.options[0].target);
  return chosen.includes(lead) ? [...chosen] : [...chosen, lead];
}

export function toggleOption(t: Target, chosen: readonly string[]): string[] {
  const k = optionKey(t);
  return chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k];
}

export const regionSpoken = (r: PickerRegion, s: RegionState): string =>
  s === 'full' ? `${r.label}, selected` : s === 'partial' ? `${r.label}, partly selected` : r.label;

/** Drawn layers for one option, through the same map the heatmap uses. */
const layersOf = (label: string): string[] => {
  const def = MUSCLE_TARGETS.find((x) => x.label === label);
  return def ? [...new Set(def.muscles.flatMap((n) => mapMuscle(n)?.drawn ?? []))] : [];
};

/** Every layer a region covers: the union of its muscles'. */
export function regionLayers(r: PickerRegion): string[] {
  const own = layersOf(r.label);
  return [...new Set([...own, ...r.options.flatMap((o) => layersOf(o.label))])];
}

/**
 * Every layer the artwork can draw, which is what FULL BODY lights.
 *
 * Not the union of the regions below, which is what it used to be and what
 * left a body with grey patches on it: six of the 32 drawn layers belong to no
 * target, because the catalogue files no movement under them —
 * `tibialis_anterior` (the front of the shin), `infraspinatus_teres_minor`
 * (the upper back between the shoulder blades), `anconeus`, `iliotibial_band`,
 * `gracilis_gastrocnemius` and `sternocleidomastoid`. A member picking Full
 * Body is picking the whole body and is entitled to see the whole body lit;
 * the gaps read as "these bits are not included", which was not true of the
 * workout and is not true of the picture.
 *
 * Written out rather than read from `assets/muscle-heatmap/manifest.json` for
 * the reason src/ui/muscleArt.ts gives for its own hand-written table: this is
 * a lib file, the manifest is 6 KB of JSON whose only other runtime fact is an
 * aspect ratio, and bundling it to read a list of names would put a second
 * copy of that list in the app. The test compares the two in BOTH directions,
 * so a layer added to the artwork and missed here fails rather than going
 * quietly dark.
 */
export const ALL_DRAWN_LAYERS: readonly string[] = [
  'abdominals', 'adductor_longus', 'adductor_magnus', 'anconeus',
  'biceps_brachii', 'biceps_femoris', 'brachioradialis', 'deltoids',
  'erector_spinae', 'extensor_carpi', 'gastrocnemius', 'gluteus_maximus',
  'gluteus_medius', 'gracilis', 'gracilis_gastrocnemius', 'iliotibial_band',
  'infraspinatus_teres_minor', 'latissimus_dorsi', 'obliques',
  'palmaris_longus', 'pectineus_sartorius', 'pectoralis_major',
  'rectus_femoris', 'semimembranosus', 'semitendinosus', 'soleus',
  'sternocleidomastoid', 'tibialis_anterior', 'trapezius', 'triceps',
  'vastus_lateralis', 'vastus_medialis',
];

/**
 * The region a drawn layer belongs to, for colouring it in that region's own
 * colour. First match wins and the order of `PICKER_REGIONS` decides it, which
 * matters for the layers two regions share — `brachioradialis` is in Arms
 * twice over, `gluteus_medius` is in Glutes, `trapezius` in Back.
 */
export function layerRegion(layer: string): PickerRegion | null {
  return PICKER_REGIONS.find((r) => regionLayers(r).includes(layer)) ?? null;
}

/**
 * What the body lights, as an intensity per drawn layer for MuscleBody: 1 for
 * a whole region (drawn green), 0.5 for the muscles picked inside a region
 * that is only partly picked (drawn amber). Full wins where two overlap.
 */
export function pickedLayers(chosen: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  // Full Body is the whole drawing, not the union of the regions — see
  // `ALL_DRAWN_LAYERS` for the six layers that difference used to leave grey.
  const all = chosen.includes(optionKey(PICKER_REGIONS[0].options[0].target));
  if (all) for (const l of ALL_DRAWN_LAYERS) out[l] = 1;
  for (const r of PICKER_REGIONS) {
    if (regionState(r, chosen) === 'full') for (const l of regionLayers(r)) out[l] = 1;
  }
  for (const r of PICKER_REGIONS) {
    if (regionState(r, chosen) !== 'partial') continue;
    for (const o of r.options) {
      if (!chosen.includes(optionKey(o.target))) continue;
      for (const l of layersOf(o.label)) out[l] = Math.max(out[l] ?? 0, 0.5);
    }
  }
  return out;
}

/* ── where a tap on the figure lands ─────────────────────────────────────
 *
 * The artwork is raster (assets/muscle-heatmap/), so there is no path to hit.
 * These grids were sampled off the overlays' own alpha: one character per
 * 10×10 source pixel, the region whose layers cover most of that cell, '.'
 * for none. Regenerate if the artwork changes (decode each WebP with `dwebp
 * -pam`, sum alpha > 96 per cell per region, keep cells of 20+ pixels).
 * c chest, b back, s shoulders, a arms, o core, g glutes, l legs. */
const CODE: Record<string, RegionKey> = {
  c: 'chest', b: 'back', s: 'shoulders', a: 'arms', o: 'core', g: 'glutes', l: 'legs',
};
const FRONT_HITS: readonly string[] = [
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '............bb......b.............',
  '...........bbb......bbb...........',
  '.........bbbb.......bbbb..........',
  '.....ssss.cccc.....cccccssss......',
  '....sssssccccccc.cccccccsssss.....',
  '...ssssscccccccccccccccccsssss....',
  '...sssssccccccccccccccccccssss....',
  '...sssscccccccccccccccccccsssss...',
  '...sssscccccccccccccccccccsssss...',
  '...ssssccccccccccccccccccccssss...',
  '...ssaaaccccccccccccccccccaasss...',
  '...aaaaacccccccc.ccccccccaaaa.a...',
  '..aaaaaaocccccoo.oocccccoaaaaaa...',
  '..aaaaaaoooooooooooooooooaaaaaa...',
  '..aaaaaaoooooooooooooooooaaaaaa...',
  '..aaaaaaooooooooooooooooooaaaaa...',
  '..aaaaaaooooooooooooooooo.aaaaa...',
  '..aaaaaaooooooooooooooooo.aaaaa...',
  '..aaaaa..oooooooooooooooo.aaaaa...',
  '..aaaaa..ooooooooooooooo...aaaaa..',
  '.aaaaaa..ooooooooooooooo...aaaaa..',
  '.aaa.aa..ooooooooooooooo..aaaaaaa.',
  '.aaaaaa..oooooooooooo.ooo.aaaaaaa.',
  'aaaaaaa..oooooooooooooooo..aaaaaa.',
  'aaaaaaa..ooooooooooooooo...aaaaaa.',
  'aaaaaa....ooooooooooooo....aaaaaa.',
  'aaaaaa.....ooooooooooo.....aaaaaa.',
  'aaaaaa......................aaaaa.',
  '.aaaa.......................aaaaa.',
  '.aaaa........................aaaa.',
  '.aaa.........................aaa..',
  '.aaa.........................aaa..',
  '...a..........................a...',
  '........lll...........lll.........',
  '.......llllll.......llllll........',
  '.......llllllll...llllllll........',
  '.......lllllllll.llllllllll.......',
  '......llllllllll..lllllllll.......',
  '......llllllllll.llllllllll.......',
  '......llllllllll.llllllllll.......',
  '......llllllllll.llllllllll.......',
  '......llllllllll.llllllllll.......',
  '......llllllllll..llllllllll......',
  '......lllllllll...lllllllll.......',
  '......lllllllll...lllllllll.......',
  '......lllllllll....llllllll.......',
  '......llllllll......lllllll.......',
  '.......lllllll.....llllllll.......',
  '..........llll.....lllll..........',
  '..........llll......lll...........',
  '...........ll.......ll............',
  '...........ll.......ll............',
  '...........ll........l............',
  '......ll...l.........ll..ll.......',
  '......ll..lll........ll..ll.......',
  '......lll.lll........lll.lll......',
  '......lllllll.......llll.lll......',
  '.....llllllll.......llll.lll......',
  '......lllllll.......llll.lll......',
  '......lllllll........lll.lll......',
  '......llllll.........lll.lll......',
  '......llllll.........llllll.......',
  '......llllll..........lllll.......',
  '......lllll...........lllll.......',
  '.......llll...........lllll.......',
  '.......llll............llll.......',
  '.......llll............l.l........',
  '.......llll............l.l........',
  '.......l.l.............l.l........',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
  '..................................',
];
const BACK_HITS: readonly string[] = [
  '...................................',
  '...................................',
  '...................................',
  '...................................',
  '...................................',
  '...................................',
  '...................................',
  '...................................',
  '...............b...b...............',
  '...............bb.bb...............',
  '...............bb.bb...............',
  '..............bbb.bbb..............',
  '.............bbbb.bbbb.............',
  '...........bbbbbb.bbbbbb...........',
  '.........bbbbbbb..bbbbbbb..........',
  '......ss.bbbbbbb...bbbbbbbsss......',
  '....ssssssbbbbbbb.bbbbbbbssssss....',
  '....sssssbbbbbbbb.bbbbbbbbsssss....',
  '...ssssssbbbbbbbb.bbbbbbbbssssss...',
  '...sssssbbbbbbbbb.bbbbbbbbbsssss...',
  '...ssssbbbbbbbbbb.bbbbbbbbbbssss...',
  '...ssaabbbbbbbbbb.bbbbbbbbbbaass...',
  '...saaaabbbbb.bbb.bbbbbbbbbaaaas...',
  '...aaaaabbbbbbbbb.bbbbbbbbbaaaaa...',
  '..aaaaaabbbbbbbbb.bbbbbbbbbaaaaa...',
  '..aaaaaabbbbbbbbb.bbbbbbbbbaaaaaa..',
  '..aaaaaabbbbbbbbb.bbbbbbbbbaaaaaa..',
  '..aaaaaabbbbbbbb..bbbbbbbbbaaaaaa..',
  '..aaaaaabbbbbbbbb.bbbbbbbbbaaaaaa..',
  '..aaaaaa.bbbbbbbb.bbbbbbbb.aaaaaa..',
  '..aaaaa..bbbbbbbb.bbbbbbbb..aaaaa..',
  '..aaaa....bbbbbbbbbbbbbbb....aaaa..',
  '.aaaaa....gbbbbbbbbbbbbbg....aaaaa.',
  '.aaaaaa...ggbbbbbbbbbbbgg...aaaaaa.',
  '.aaaaaa...ggbbbbbbbbbbggg...aaaaaa.',
  'aaaaaaa..ggggbbbbbbbbbggg...aaaaaa.',
  'aaaaaaa...ggg.bbbbbbb.ggg...aaaaaaa',
  'aaaaaaa.......bbbbbbb.......aaaaaaa',
  'aaaaaa.......................aaaaa.',
  'aaaaaa......gg.......gg......aaaaa.',
  '.aaaa......ggggg...ggggg.....aaaaa.',
  '.aaaa.....ggggggg.ggggggg.....aaaa.',
  '.aaaa.....ggggggg.ggggggg.....aaaa.',
  '.aaa.....ggggggggggggggggg.....aaa.',
  '.aaa.....ggggggggggggggggg.....aaa.',
  '..a.....lgggggggggggggggggl.....a..',
  '........lgggggggggggggggggl........',
  '.......llgggggggg.ggggggggl........',
  '.......ll.ggggggg.ggggggg.ll.......',
  '.......llllllgglllllggllllll.......',
  '.......lllllll.lllll.lllllll.......',
  '.......lllllllllllllllllllll.......',
  '.......llllllllll.llllllllll.......',
  '.......llllllllll.llllllllll.......',
  '.......llllllllll.llllllllll.......',
  '.......llllllllll.llllllllll.......',
  '.......lllllllll...lllllllll.......',
  '.......lllllllll...lllllllll.......',
  '.......lllllllll...lllllllll.......',
  '........lllllll.....lllllll........',
  '........lllllll.....lllllll........',
  '........lllllll.....lllllll........',
  '........lllllll.....lllllll........',
  '........llllll......lllllll........',
  '........llllll.......llllll........',
  '........llllll.......llllll........',
  '.......llllll.........lllll........',
  '.......lllllll.......lllllll.......',
  '.......lllllll.......lllllll.......',
  '.......lllllll.......lllllll.......',
  '......llllllll.......lllllll.......',
  '......llllllll.......lllllll.......',
  '.......lllllll.......lllllll.......',
  '.......lllllll.......lllllll.......',
  '.......llllll.........llllll.......',
  '........lllll.........lllll........',
  '........llll...........llll........',
  '........llll...........llll........',
  '........llll...........llll........',
  '.........lll...........lll.........',
  '.........ll............lll.........',
  '.........ll.............ll.........',
  '.........ll.............ll.........',
  '.........ll.............l..........',
  '.........ll.............l..........',
  '.........ll.............ll.........',
  '.........lll...........lll.........',
  '.........lll...........lll.........',
  '...................................',
  '...................................',
];

const HITS: Record<BodySide, readonly string[]> = { front: FRONT_HITS, back: BACK_HITS };

/**
 * The region under a tap, from its position as a fraction (0..1) of the drawn
 * figure's width and height. A near miss one cell off a muscle still counts,
 * because a fingertip is wider than the forearm it is aiming at.
 */
export function regionAt(side: BodySide, fx: number, fy: number): PickerRegion | null {
  const grid = HITS[side];
  const rows = grid.length, cols = grid[0].length;
  const r0 = Math.floor(fy * rows), c0 = Math.floor(fx * cols);
  const at = (r: number, c: number) => CODE[grid[r]?.[c] ?? '.'];
  let key = at(r0, c0);
  for (let d = 0; !key && d < 9; d++) key = at(r0 + Math.floor(d / 3) - 1, c0 + (d % 3) - 1);
  return key ? PICKER_REGIONS.find((r) => r.key === key) ?? null : null;
}

/** The regions a side of the figure shows, for its accessibility actions. */
export function regionsOn(side: BodySide): PickerRegion[] {
  const codes = new Set(HITS[side].join(''));
  return PICKER_REGIONS.filter((r) => [...codes].some((c) => CODE[c] === r.key));
}
