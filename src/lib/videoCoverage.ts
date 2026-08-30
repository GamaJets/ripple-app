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
//
// ── The catalogue illustrates most of this now ────────────────────────────
//
// This file used to know about two kinds of cover, clips and Academy clips,
// and everything else was "no clip at all". That was true when it was written
// and stopped being true the day a bought pack of 483 animations and 601
// stills landed on the catalogue: a coach was being told that 25 of the 25
// movements they programme have nothing, while their clients were watching a
// proper animation of every one.
//
// So there are four states, and the question the screen answers is what the
// CLIENT WILL SEE — because that is the decision a coach is making when they
// look at this list. A movement the catalogue illustrates is not urgent to
// film. A movement with nothing is.
//
// `illustrated` is passed IN rather than looked up here, because knowing it
// requires reading the catalogue, and a read that failed must not be reported
// as "nothing is illustrated" — see the null case in coverageFor.
import { exerciseSlug } from './exerciseId';

export interface CoverageVideo { exerciseId: string | null; name: string; trainerId?: string | null }

export interface Covered {
  /** The exercise as the coach wrote it in the programme. */
  name: string;
  /** Covered by a clip this coach recorded. */
  mine: boolean;
  /** Covered by a platform Academy clip, which they may replace with their own. */
  academy: boolean;
  /** The catalogue has an illustration of the movement. Not somebody's clip —
   *  a client still sees the lift performed correctly, which is the difference
   *  between "worth filming eventually" and "nobody has ever seen this done".
   *  Null when the catalogue could not be read: unknown, not absent. */
  illustrated: boolean | null;
}

export interface CoverageReport {
  /** Every distinct movement across the programmes given, alphabetical. */
  all: Covered[];
  /** Nothing at all: no clip, no Academy clip, and no catalogue illustration.
   *  The list that matters most, and the only one that is urgent.
   *
   *  Under an unreadable catalogue this holds only movements with no clip AND
   *  no illustration KNOWN — which, not knowing, means it stays empty rather
   *  than naming movements that may well be illustrated. `unknownCover` says
   *  so instead. */
  missing: string[];
  /** No clip, but the catalogue illustrates it — a client sees the movement
   *  done correctly, just not by their coach. */
  illustratedOnly: string[];
  /** True when the catalogue could not be read, so nothing here can say
   *  whether a movement without a clip is illustrated or bare. */
  unknownCover: boolean;
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
  /** Slugs the catalogue can illustrate. NULL means the catalogue was not
   *  read — which is not the same as an empty set, and the difference is the
   *  whole reason this is nullable: an empty set says "nothing is
   *  illustrated", and saying that to a coach whose clients are watching
   *  animations is the bug this argument was added to fix. */
  illustratedSlugs: Set<string> | null = null,
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
    .map(([slug, name]) => ({
      name,
      mine: mineSlugs.has(slug),
      academy: academySlugs.has(slug),
      illustrated: illustratedSlugs ? illustratedSlugs.has(slug) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const noClip = all.filter((c) => !c.mine && !c.academy);
  return {
    all,
    // Only what is genuinely bare. With no catalogue read, nothing can be
    // called bare, so this is empty and unknownCover carries the caveat.
    missing: noClip.filter((c) => c.illustrated === false).map((c) => c.name),
    illustratedOnly: noClip.filter((c) => c.illustrated === true).map((c) => c.name),
    unknownCover: illustratedSlugs == null,
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
  const i = r.illustratedOnly.length;

  // Said from the client's side, because that is what a coach is deciding
  // about. "Nobody has seen this done" is urgent; "they see the catalogue
  // animation rather than you" is a preference.
  //
  // The done sentence asks whether every movement IS filmed by this coach —
  // not whether the other three lists came back empty. They are also all empty
  // when the catalogue could not be read, and the first version of this line
  // therefore told a coach who had filmed nothing that they had filmed
  // everything. Emptiness is not completeness.
  if (r.mine.length === r.all.length) {
    return `Every movement you programme has your own clip. ${r.all.length} in all.`;
  }

  const parts: string[] = [];
  if (n > 0) {
    parts.push(`${n} of the ${r.all.length} movements you programme ${n === 1 ? 'has' : 'have'} nothing to show at all`);
  }
  if (i > 0) {
    parts.push(`${i} ${i === 1 ? 'shows' : 'show'} the catalogue animation rather than you`);
  }
  if (a > 0) {
    parts.push(`${a} ${a === 1 ? 'uses' : 'use'} the Academy clip, which you can replace with your own`);
  }
  if (r.unknownCover) {
    // Never let an unreadable catalogue read as "these have nothing". The
    // clips we DID see are still trustworthy; what is unknown is whether the
    // rest are illustrated.
    const bare = r.all.length - r.mine.length - r.academyOnly.length;
    if (bare > 0) {
      parts.push(`${bare} ${bare === 1 ? 'has' : 'have'} no clip of yours — whether the catalogue illustrates ${bare === 1 ? 'it' : 'them'} could not be checked just now`);
    }
  }
  // Nothing to say and not everything filmed: only reachable if a movement is
  // covered by something none of the branches above name, which would be a new
  // state somebody forgot to word. Say nothing rather than guess.
  if (!parts.length) return null;
  return `${parts.join(' · ')}.`;
}
