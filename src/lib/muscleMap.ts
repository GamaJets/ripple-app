// Which drawn muscle lights up for a muscle the catalogue names.
//
// ── two vocabularies, and they are not the same one ───────────────────────
//
// `exercises.primary_muscles` and `secondary_muscles` carry RepDB's TRAINING
// vocabulary: 27 names on production, spelled with spaces — 'gluteus maximus',
// 'quadriceps', 'anterior deltoid'. The heatmap artwork carries its ANATOMICAL
// one: 32 names, spelled with underscores, and cut the way a body is actually
// drawn — 'vastus_lateralis', 'biceps_femoris', 'deltoids'.
//
// They overlap and they do not match. Three shapes of mismatch, all real:
//
//   ONE NAME, SEVERAL LAYERS. 'quadriceps' is one word in the catalogue and
//   three overlays on the body (rectus femoris, vastus lateralis, vastus
//   medialis). Lighting one of the three would draw a thigh with a stripe on
//   it, so a training name maps to a LIST.
//
//   SEVERAL NAMES, ONE LAYER. The catalogue splits the deltoid three ways —
//   anterior, lateral, posterior, and 110 movements between them — where the
//   artwork has a single `deltoids`. All three light the same shoulder, and
//   the intensity has to be combined rather than fought over.
//
//   NAMED, AND NOT DRAWN. The rhomboids are 29 movements in this catalogue and
//   have no layer at all: they sit UNDER the trapezius and the artwork draws
//   what you can see. Same for brachialis (under biceps) and quadratus
//   lumborum (deep). These are the interesting ones, and the reason this file
//   has two tiers rather than one table.
//
// ── exact vs approximate, and why a screen must be able to tell ───────────
//
// A member who rowed all week and sees a dark mid-back will not conclude "the
// artwork has no rhomboid layer" — they will conclude the app lost their
// session. So `approximate` maps the rhomboids onto the trapezius, which is
// the muscle drawn over them and does move when they are worked.
//
// But that is a DRAWING decision, not a fact about their training, and this
// codebase does not let a screen state something it cannot prove. So the
// mapping says which tier it used, `approximations()` names them, and a screen
// that lights an approximate muscle is expected to say so. The alternative —
// one flat table — would have made the compromise invisible at exactly the
// moment somebody asks "why is my back lit when I trained rhomboids".
export type DrawnMuscle = string;

/** How a training name reached the body: drawn as itself, or stood in for. */
export type MapTier = 'exact' | 'approximate';

export interface MuscleMapping {
  /** The catalogue's own name, as it appears in `primary_muscles`. */
  trained: string;
  /** The overlays to light. Empty when the artwork cannot show it at all. */
  drawn: DrawnMuscle[];
  tier: MapTier;
  /** Why, when it is not exact. Shown to a person, so it is a sentence. */
  note?: string;
}

const EXACT: Record<string, DrawnMuscle[]> = {
  'gluteus maximus': ['gluteus_maximus'],
  'gluteus medius': ['gluteus_medius'],
  'pectoralis major': ['pectoralis_major'],
  'latissimus dorsi': ['latissimus_dorsi'],
  'erector spinae': ['erector_spinae'],
  'trapezius': ['trapezius'],
  'biceps brachii': ['biceps_brachii'],
  'triceps brachii': ['triceps'],
  'obliques': ['obliques'],
  'gastrocnemius': ['gastrocnemius'],
  'soleus': ['soleus'],
  'brachioradialis': ['brachioradialis'],
  'rectus abdominis': ['abdominals'],
  // One catalogue name, several drawn layers — see the header.
  'quadriceps': ['rectus_femoris', 'vastus_lateralis', 'vastus_medialis'],
  'hamstrings': ['biceps_femoris', 'semimembranosus', 'semitendinosus'],
  'adductors': ['adductor_longus', 'adductor_magnus', 'gracilis'],
  // Several catalogue names, one drawn layer. All three are the same shoulder.
  'anterior deltoid': ['deltoids'],
  'lateral deltoid': ['deltoids'],
  'posterior deltoid': ['deltoids'],
  'forearm flexors': ['palmaris_longus'],
  'forearm extensors': ['extensor_carpi'],
};

const APPROXIMATE: Record<string, { drawn: DrawnMuscle[]; note: string }> = {
  rhomboids: {
    drawn: ['trapezius'],
    note: 'The rhomboids sit under the trapezius and the artwork draws what is visible, so rowing lights the upper back rather than the rhomboids themselves.',
  },
  brachialis: {
    drawn: ['biceps_brachii'],
    note: 'The brachialis sits under the biceps, so it is drawn on the biceps.',
  },
  'transverse abdominis': {
    drawn: ['abdominals'],
    note: 'The transverse abdominis is the deep layer of the abdominal wall and is drawn with the rest of it.',
  },
  'hip flexors': {
    drawn: ['pectineus_sartorius'],
    note: 'The hip flexors are drawn as the pectineus and sartorius, which are the ones visible at the front of the hip.',
  },
  abductors: {
    drawn: ['gluteus_medius'],
    note: 'Hip abduction is drawn on the gluteus medius, the muscle that does most of it.',
  },
};

/**
 * Muscles the catalogue names that this artwork genuinely cannot show.
 *
 * `quadratus lumborum` is deep to the erector spinae and there is no honest
 * muscle to stand in for it — putting it on the lower back would be inventing
 * a picture rather than approximating one. One movement in the catalogue
 * carries it, which is why it is a list of one and not a special case.
 */
const UNDRAWN: readonly string[] = ['quadratus lumborum'];

const norm = (s: string): string => String(s ?? '').trim().toLowerCase();

/** How this trained muscle reaches the body, or null when it cannot. */
export function mapMuscle(trained: string): MuscleMapping | null {
  const k = norm(trained);
  if (!k) return null;
  const exact = EXACT[k];
  if (exact) return { trained: k, drawn: exact, tier: 'exact' };
  const approx = APPROXIMATE[k];
  if (approx) return { trained: k, drawn: approx.drawn, tier: 'approximate', note: approx.note };
  // Both the deliberately-undrawn and anything the catalogue grows later.
  // A name this file has never heard of is not an error and is not drawn: it
  // is reported through `unmapped()` so a screen can say how much of the work
  // is not in the picture, which is the same rule muscleVolume.ts applies to a
  // movement missing from the catalogue.
  return { trained: k, drawn: [], tier: 'exact' };
}

/** Every trained muscle in `names` that reaches no overlay at all. */
export function unmapped(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const m = mapMuscle(n);
    if (m && m.drawn.length === 0) out.add(m.trained);
  }
  return [...out].sort();
}

/** The approximations actually used by `names`, as sentences, deduplicated. */
export function approximations(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    const m = mapMuscle(n);
    if (m?.tier === 'approximate' && m.note && !seen.has(m.trained)) {
      seen.add(m.trained);
      out.push(m.note);
    }
  }
  return out;
}

/** Is this a muscle the artwork deliberately cannot draw? */
export function isUndrawn(trained: string): boolean {
  return UNDRAWN.includes(norm(trained));
}

/**
 * Intensity per DRAWN muscle, from intensity per TRAINED muscle.
 *
 * Two rules, and both come out of the mismatches in the header. A trained
 * muscle spread over several layers gives each layer its whole value rather
 * than a share of it — a thigh is not a third lit because quadriceps is drawn
 * three ways. And several trained muscles landing on one layer take the
 * LARGEST, not the sum: three deltoid heads at 0.5 each is a shoulder trained
 * half as hard as one at 1.0, and adding them to 1.5 would say the opposite.
 */
export function drawnIntensity(byTrained: Readonly<Record<string, number>>): Record<DrawnMuscle, number> {
  const out: Record<string, number> = {};
  for (const [trained, value] of Object.entries(byTrained ?? {})) {
    if (!Number.isFinite(value) || value <= 0) continue;
    const m = mapMuscle(trained);
    if (!m) continue;
    for (const d of m.drawn) out[d] = Math.max(out[d] ?? 0, value);
  }
  return out;
}
