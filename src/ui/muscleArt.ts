// The 76 `require` calls Metro needs, and the per-side index built from them.
//
// GENERATED SHAPE, WRITTEN BY HAND ONCE. Metro resolves `require` at build time
// from a STRING LITERAL and nothing else: `require(`../../assets/muscle-heatmap/${file}`)
// resolves to nothing and throws on a device, which is why this table exists
// rather than a loop over the manifest. The manifest is still the source of
// truth for which layers a side HAS — this file only carries the module handles,
// and src/lib/bodyHeat.test.ts reads the manifest off disk and asserts the two
// agree, in both directions.
//
// Regenerate with scripts/build-muscle-heatmap.mjs and re-run that test: a file
// added to the manifest and missed here is a muscle that silently never lights,
// which is the failure mode src/lib/muscleMap.ts already warns about for names.
//
// The manifest itself is NOT imported. It is 6 KB of JSON whose only two runtime
// facts are the aspect ratios below, and bundling it to read two numbers would
// put a copy of the layer list in the app that nothing consults.

export type BodySide = 'front' | 'back';

/** One drawn overlay: a layer name, which half of the body, and its image. */
export interface ArtLayer {
  name: string;
  /** The FIGURE'S own left and right, not the viewer's. See MuscleBody's header. */
  side: 'L' | 'R';
  source: number;
}

/* eslint-disable global-require */
const FRONT_BASE = require('../../assets/muscle-heatmap/front_base.webp');
const BACK_BASE = require('../../assets/muscle-heatmap/back_base.webp');

const FRONT_LAYERS: ArtLayer[] = [
  { name: 'palmaris_longus', side: 'L', source: require('../../assets/muscle-heatmap/front_palmaris_longus_L.webp') },
  { name: 'palmaris_longus', side: 'R', source: require('../../assets/muscle-heatmap/front_palmaris_longus_R.webp') },
  { name: 'brachioradialis', side: 'L', source: require('../../assets/muscle-heatmap/front_brachioradialis_L.webp') },
  { name: 'brachioradialis', side: 'R', source: require('../../assets/muscle-heatmap/front_brachioradialis_R.webp') },
  { name: 'pectineus_sartorius', side: 'L', source: require('../../assets/muscle-heatmap/front_pectineus_sartorius_L.webp') },
  { name: 'pectineus_sartorius', side: 'R', source: require('../../assets/muscle-heatmap/front_pectineus_sartorius_R.webp') },
  { name: 'adductor_longus', side: 'L', source: require('../../assets/muscle-heatmap/front_adductor_longus_L.webp') },
  { name: 'adductor_longus', side: 'R', source: require('../../assets/muscle-heatmap/front_adductor_longus_R.webp') },
  { name: 'vastus_medialis', side: 'L', source: require('../../assets/muscle-heatmap/front_vastus_medialis_L.webp') },
  { name: 'vastus_medialis', side: 'R', source: require('../../assets/muscle-heatmap/front_vastus_medialis_R.webp') },
  { name: 'vastus_lateralis', side: 'L', source: require('../../assets/muscle-heatmap/front_vastus_lateralis_L.webp') },
  { name: 'vastus_lateralis', side: 'R', source: require('../../assets/muscle-heatmap/front_vastus_lateralis_R.webp') },
  { name: 'rectus_femoris', side: 'L', source: require('../../assets/muscle-heatmap/front_rectus_femoris_L.webp') },
  { name: 'rectus_femoris', side: 'R', source: require('../../assets/muscle-heatmap/front_rectus_femoris_R.webp') },
  { name: 'gracilis', side: 'L', source: require('../../assets/muscle-heatmap/front_gracilis_L.webp') },
  { name: 'gracilis', side: 'R', source: require('../../assets/muscle-heatmap/front_gracilis_R.webp') },
  { name: 'gracilis_gastrocnemius', side: 'L', source: require('../../assets/muscle-heatmap/front_gracilis_gastrocnemius_L.webp') },
  { name: 'gracilis_gastrocnemius', side: 'R', source: require('../../assets/muscle-heatmap/front_gracilis_gastrocnemius_R.webp') },
  { name: 'tibialis_anterior', side: 'L', source: require('../../assets/muscle-heatmap/front_tibialis_anterior_L.webp') },
  { name: 'tibialis_anterior', side: 'R', source: require('../../assets/muscle-heatmap/front_tibialis_anterior_R.webp') },
  { name: 'obliques', side: 'L', source: require('../../assets/muscle-heatmap/front_obliques_L.webp') },
  { name: 'obliques', side: 'R', source: require('../../assets/muscle-heatmap/front_obliques_R.webp') },
  { name: 'triceps', side: 'L', source: require('../../assets/muscle-heatmap/front_triceps_L.webp') },
  { name: 'triceps', side: 'R', source: require('../../assets/muscle-heatmap/front_triceps_R.webp') },
  { name: 'biceps_brachii', side: 'L', source: require('../../assets/muscle-heatmap/front_biceps_brachii_L.webp') },
  { name: 'biceps_brachii', side: 'R', source: require('../../assets/muscle-heatmap/front_biceps_brachii_R.webp') },
  { name: 'abdominals', side: 'L', source: require('../../assets/muscle-heatmap/front_abdominals_L.webp') },
  { name: 'abdominals', side: 'R', source: require('../../assets/muscle-heatmap/front_abdominals_R.webp') },
  { name: 'deltoids', side: 'L', source: require('../../assets/muscle-heatmap/front_deltoids_L.webp') },
  { name: 'deltoids', side: 'R', source: require('../../assets/muscle-heatmap/front_deltoids_R.webp') },
  { name: 'pectoralis_major', side: 'L', source: require('../../assets/muscle-heatmap/front_pectoralis_major_L.webp') },
  { name: 'pectoralis_major', side: 'R', source: require('../../assets/muscle-heatmap/front_pectoralis_major_R.webp') },
  { name: 'trapezius', side: 'L', source: require('../../assets/muscle-heatmap/front_trapezius_L.webp') },
  { name: 'trapezius', side: 'R', source: require('../../assets/muscle-heatmap/front_trapezius_R.webp') },
  { name: 'sternocleidomastoid', side: 'L', source: require('../../assets/muscle-heatmap/front_sternocleidomastoid_L.webp') },
  { name: 'sternocleidomastoid', side: 'R', source: require('../../assets/muscle-heatmap/front_sternocleidomastoid_R.webp') },
];

const BACK_LAYERS: ArtLayer[] = [
  { name: 'gluteus_maximus', side: 'R', source: require('../../assets/muscle-heatmap/back_gluteus_maximus_R.webp') },
  { name: 'gluteus_maximus', side: 'L', source: require('../../assets/muscle-heatmap/back_gluteus_maximus_L.webp') },
  { name: 'latissimus_dorsi', side: 'R', source: require('../../assets/muscle-heatmap/back_latissimus_dorsi_R.webp') },
  { name: 'latissimus_dorsi', side: 'L', source: require('../../assets/muscle-heatmap/back_latissimus_dorsi_L.webp') },
  { name: 'gluteus_medius', side: 'R', source: require('../../assets/muscle-heatmap/back_gluteus_medius_R.webp') },
  { name: 'gluteus_medius', side: 'L', source: require('../../assets/muscle-heatmap/back_gluteus_medius_L.webp') },
  { name: 'erector_spinae', side: 'R', source: require('../../assets/muscle-heatmap/back_erector_spinae_R.webp') },
  { name: 'erector_spinae', side: 'L', source: require('../../assets/muscle-heatmap/back_erector_spinae_L.webp') },
  { name: 'trapezius', side: 'R', source: require('../../assets/muscle-heatmap/back_trapezius_R.webp') },
  { name: 'trapezius', side: 'L', source: require('../../assets/muscle-heatmap/back_trapezius_L.webp') },
  { name: 'infraspinatus_teres_minor', side: 'R', source: require('../../assets/muscle-heatmap/back_infraspinatus_teres_minor_R.webp') },
  { name: 'infraspinatus_teres_minor', side: 'L', source: require('../../assets/muscle-heatmap/back_infraspinatus_teres_minor_L.webp') },
  { name: 'deltoids', side: 'R', source: require('../../assets/muscle-heatmap/back_deltoids_R.webp') },
  { name: 'deltoids', side: 'L', source: require('../../assets/muscle-heatmap/back_deltoids_L.webp') },
  { name: 'triceps', side: 'R', source: require('../../assets/muscle-heatmap/back_triceps_R.webp') },
  { name: 'triceps', side: 'L', source: require('../../assets/muscle-heatmap/back_triceps_L.webp') },
  { name: 'brachioradialis', side: 'R', source: require('../../assets/muscle-heatmap/back_brachioradialis_R.webp') },
  { name: 'brachioradialis', side: 'L', source: require('../../assets/muscle-heatmap/back_brachioradialis_L.webp') },
  { name: 'extensor_carpi', side: 'R', source: require('../../assets/muscle-heatmap/back_extensor_carpi_R.webp') },
  { name: 'extensor_carpi', side: 'L', source: require('../../assets/muscle-heatmap/back_extensor_carpi_L.webp') },
  { name: 'anconeus', side: 'R', source: require('../../assets/muscle-heatmap/back_anconeus_R.webp') },
  { name: 'anconeus', side: 'L', source: require('../../assets/muscle-heatmap/back_anconeus_L.webp') },
  { name: 'biceps_femoris', side: 'R', source: require('../../assets/muscle-heatmap/back_biceps_femoris_R.webp') },
  { name: 'biceps_femoris', side: 'L', source: require('../../assets/muscle-heatmap/back_biceps_femoris_L.webp') },
  { name: 'semitendinosus', side: 'R', source: require('../../assets/muscle-heatmap/back_semitendinosus_R.webp') },
  { name: 'semitendinosus', side: 'L', source: require('../../assets/muscle-heatmap/back_semitendinosus_L.webp') },
  { name: 'gracilis', side: 'R', source: require('../../assets/muscle-heatmap/back_gracilis_R.webp') },
  { name: 'gracilis', side: 'L', source: require('../../assets/muscle-heatmap/back_gracilis_L.webp') },
  { name: 'semimembranosus', side: 'R', source: require('../../assets/muscle-heatmap/back_semimembranosus_R.webp') },
  { name: 'semimembranosus', side: 'L', source: require('../../assets/muscle-heatmap/back_semimembranosus_L.webp') },
  { name: 'gastrocnemius', side: 'R', source: require('../../assets/muscle-heatmap/back_gastrocnemius_R.webp') },
  { name: 'gastrocnemius', side: 'L', source: require('../../assets/muscle-heatmap/back_gastrocnemius_L.webp') },
  { name: 'soleus', side: 'R', source: require('../../assets/muscle-heatmap/back_soleus_R.webp') },
  { name: 'soleus', side: 'L', source: require('../../assets/muscle-heatmap/back_soleus_L.webp') },
  { name: 'adductor_magnus', side: 'R', source: require('../../assets/muscle-heatmap/back_adductor_magnus_R.webp') },
  { name: 'adductor_magnus', side: 'L', source: require('../../assets/muscle-heatmap/back_adductor_magnus_L.webp') },
  { name: 'iliotibial_band', side: 'R', source: require('../../assets/muscle-heatmap/back_iliotibial_band_R.webp') },
  { name: 'iliotibial_band', side: 'L', source: require('../../assets/muscle-heatmap/back_iliotibial_band_L.webp') },
];

/* eslint-enable global-require */

interface SideArt {
  base: number;
  /**
   * width ÷ height, copied from the manifest and asserted against it in the test.
   *
   * The two sides genuinely differ — the source art is 1510×4064 at the front
   * and 1562×4027 at the back — so a single ratio for "a body" would squash one
   * of them. Nothing else in this component may assume the two are alike.
   *
   * These are the ratios of the SOURCE art, not of the shipped files: the build
   * resamples to 900px tall with `sips -Z`, which lands on 334×900 (0.371111)
   * and 349×900 (0.387882), so the front is out by 0.12%. That difference is
   * why every layer is drawn with `resizeMode: 'contain'` into ONE box rather
   * than being stretched to fill it — contain letterboxes all 37 files of a side
   * identically because they share a pixel size, so the stack stays registered
   * whatever ratio the box is given.
   */
  aspect: number;
  layers: ArtLayer[];
}

export const ART: Record<BodySide, SideArt> = {
  front: { base: FRONT_BASE, aspect: 0.371555, layers: FRONT_LAYERS },
  back: { base: BACK_BASE, aspect: 0.387882, layers: BACK_LAYERS },
};

/** Every layer name this side can draw. Order is the manifest's — back to front. */
export function layerNames(side: BodySide): string[] {
  const out: string[] = [];
  for (const l of ART[side].layers) if (!out.includes(l.name)) out.push(l.name);
  return out;
}
