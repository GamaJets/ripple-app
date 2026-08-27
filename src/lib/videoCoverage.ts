// Which exercises a coach programmes but has no clip for.
//
// The library screen answers "what have I recorded". It cannot answer the more
// useful question, which is "what am I asking people to do that they have never
// seen done". A coach with an empty library gets a blank screen; a coach with
// forty clips has no idea which of them matter. Both want the same list.
//
// Deliberately scoped to what the coach ACTUALLY PROGRAMMES, not the whole
// 56-row catalogue. A list of everything is a chore nobody starts; a list of
// the nine movements in the programmes you have already written is a job.
//
// An Academy clip counts as covered — a client will see the platform
// demonstration — but it is reported separately, because "somebody has filmed
// this" and "I have filmed this" are different facts and a coach may well want
// their own face on the lift.
import { exerciseSlug } from './exerciseId';

export interface CoverageVideo { exerciseId: string | null; name: string; trainerId?: string | null }

export interface Covered {
  /** The exercise as the coach wrote it in the programme. */
  name: string;
  /** Covered by a clip this coach recorded. */
  mine: boolean;
  /** Covered by a platform Academy clip, which they may replace with their own. */
  academy: boolean;
}

export interface CoverageReport {
  /** Every distinct movement across the programmes given, alphabetical. */
  all: Covered[];
  /** Nobody has filmed these at all. The list that matters most. */
  missing: string[];
  /** Only the Academy covers these — a coach can put their own face on them. */
  academyOnly: string[];
  /** Filmed by this coach. */
  mine: string[];
}

/**
 * Compare the movements a coach programmes against the clips available.
 *
 * `exerciseNames` may repeat and may be cased however the coach typed them;
 * they are matched by the same slug the player uses, so what this reports and
 * what a client actually sees cannot disagree.
 */
export function coverageFor(
  exerciseNames: string[],
  videos: CoverageVideo[],
  coachId: string | null,
): CoverageReport {
  const mineSlugs = new Set<string>();
  const academySlugs = new Set<string>();
  for (const v of videos) {
    const slug = v.exerciseId || exerciseSlug(v.name);
    if (!slug) continue;
    if (coachId && v.trainerId === coachId) mineSlugs.add(slug);
    else if (v.trainerId == null) academySlugs.add(slug);
  }

  // One entry per movement, keeping the first spelling the coach used — it is
  // their vocabulary and the list reads back to them, not to the catalogue.
  const seen = new Map<string, string>();
  for (const raw of exerciseNames) {
    const slug = exerciseSlug(raw);
    if (!slug || seen.has(slug)) continue;
    seen.set(slug, raw.trim());
  }

  const all: Covered[] = [...seen.entries()]
    .map(([slug, name]) => ({ name, mine: mineSlugs.has(slug), academy: academySlugs.has(slug) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    all,
    missing: all.filter((c) => !c.mine && !c.academy).map((c) => c.name),
    academyOnly: all.filter((c) => !c.mine && c.academy).map((c) => c.name),
    mine: all.filter((c) => c.mine).map((c) => c.name),
  };
}

/**
 * The one line a coach reads at the top of their library.
 *
 * Null when there is nothing to say — no programmes written yet, so no claim
 * can be made about coverage either way. An empty string would render as a
 * blank row; null lets the caller omit the whole thing.
 */
export function coverageLine(r: CoverageReport): string | null {
  if (!r.all.length) return null;
  const n = r.missing.length;
  const a = r.academyOnly.length;
  if (n === 0 && a === 0) {
    return `Every movement you programme has your own clip. ${r.all.length} in all.`;
  }
  const parts: string[] = [];
  if (n > 0) {
    parts.push(`${n} of the ${r.all.length} movements you programme ${n === 1 ? 'has' : 'have'} no clip at all`);
  }
  if (a > 0) {
    parts.push(`${a} ${a === 1 ? 'uses' : 'use'} the Academy clip, which you can replace with your own`);
  }
  return `${parts.join(' · ')}.`;
}
