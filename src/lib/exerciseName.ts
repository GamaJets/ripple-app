// How a movement's name is SPELLED when this app writes one down.
//
// ── the two reports this exists for ───────────────────────────────────────
//
// 1. Ten rows in `workouts` held the text a coach typed rather than the name
//    the catalogue already had for that movement. Three of them — "Calf
//    raise", "Hip abduction", "Shoulder press" — slug to ids the catalogue
//    holds, spelled "Calf Raise", "Hip Abduction", "Shoulder Press". So the
//    history screen printed the same lift two ways depending on which handset
//    wrote it, and a member scanning a list saw what looked like two
//    movements.
// 2. A name the catalogue has genuinely never heard of went in exactly as
//    typed — sentence case, all capitals, whatever the keyboard did — and then
//    sat in a shared library beside 615 rows that are all Title Case.
//
// ── why the identity is never at risk ────────────────────────────────────
//
// `exerciseSlug` lowercases and strips punctuation, so re-casing a name can
// NEVER change what it resolves to. "shoulder press", "Shoulder Press" and
// "SHOULDER PRESS" are one id. That is what makes it safe to apply this on a
// write path with no catalogue in hand (a basement, a failed read): the worst
// case is a tidier spelling of the same movement, never a set filed against a
// different one.
//
// ── and why there is no fuzzy match here ─────────────────────────────────
//
// `canonicalExerciseName` resolves by slug, or by an EXACT synonym, or not at
// all. Same rule, same reason, as `videoForExercise` and `synonymAliases` in
// src/lib/exerciseId.ts: a near-miss files somebody's sets against a movement
// they did not do, and the body map, the rankings and the recovery map then
// all state it as fact.
import { exerciseSlug, synonymAliases } from './exerciseId';

/**
 * The short words that stay lowercase in the middle of a name.
 *
 * Articles, conjunctions and prepositions of four letters or fewer, which is
 * the repo's Title Case rule (docs: the caps brief) applied to a movement
 * rather than to a button. Five letters and up — Above, Under, Behind — are
 * capitalised, which is why they are not here.
 */
const SMALL: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as',
  'at', 'by', 'in', 'of', 'on', 'per', 'to', 'via', 'vs', 'with', 'from',
  'into', 'onto', 'over', 'up', 'out',
]);

/**
 * Words the gym writes in capitals, and how.
 *
 * A coach typing "ez-bar row" in lower case means the bar, not a name; leaving
 * it as "Ez-Bar" would be a spelling nobody uses. Kept deliberately short —
 * every entry here is a word this app will now refuse to title-case, so a
 * guess costs more than it saves.
 */
const CAPS: ReadonlyMap<string, string> = new Map([
  ['ez', 'EZ'], ['db', 'DB'], ['kb', 'KB'], ['trx', 'TRX'],
  ['rdl', 'RDL'], ['ghr', 'GHR'], ['amrap', 'AMRAP'], ['hiit', 'HIIT'],
  ['1rm', '1RM'],
]);

/** Upper-case the first LETTER, leaving any leading digit or bracket alone:
 *  "1rm" keeps its 1, "(wide)" keeps its bracket. A segment with no letter at
 *  all comes back untouched, which is what makes "1 Arm" work. */
function upFirst(s: string): string {
  const i = s.search(/[a-z]/i);
  return i < 0 ? s : s.slice(0, i) + s[i].toUpperCase() + s.slice(i + 1);
}

/**
 * Whether a segment already carries a casing somebody chose.
 *
 * Two shapes: an acronym the writer typed in capitals (TRX, GHR), and an
 * internal capital (McGill, DeadLift). Both are left exactly as they are —
 * re-casing them is the one way this function can make a name WORSE, and a
 * coach who typed TRX did not mean Trx.
 */
function hasOwnCase(seg: string): boolean {
  const letters = seg.replace(/[^A-Za-z]/g, '');
  if (!letters) return false;
  if (letters.length > 1 && letters === letters.toUpperCase()) return true;
  return /[A-Z]/.test(seg.slice(1));
}

/** One segment — a whole word, or one side of a hyphen. `forced` means the
 *  position capitalises it whatever it is: the first word, the last word, and
 *  the first element of a hyphenated pair. */
function capSeg(seg: string, forced: boolean): string {
  if (!seg) return seg;
  const lower = seg.toLowerCase();
  const known = CAPS.get(lower);
  if (known) return known;
  if (hasOwnCase(seg)) return seg;
  // A small word stays small behind an opening bracket too: "(with Cinnamon)".
  if (!forced && SMALL.has(lower.replace(/^[^a-z0-9]+/, ''))) return lower;
  return upFirst(lower);
}

/**
 * One word, hyphens and all.
 *
 * The hyphen rule is the repo's: capitalise the first element, and the second
 * unless it is a particle or preposition. So "Warm-up", "Check-in", "Bent-over
 * Row" keep a lowercase tail while "Full-Body", "EZ-Bar" and "In-Person"
 * capitalise both. The tail is NOT exempted by being the last word of the name
 * — "Warm-up" on its own is still "Warm-up".
 */
function capWord(word: string, forced: boolean): string {
  if (!word.includes('-')) return capSeg(word, forced);
  return word.split('-').map((p, i) => capSeg(p, i === 0)).join('-');
}

/**
 * A movement name in the repo's Title Case.
 *
 * "calf raise" → "Calf Raise". "ez-bar lying triceps extension" → "EZ-Bar
 * Lying Triceps Extension". "1 arm plated row" → "1 Arm Plated Row".
 *
 * A name typed ENTIRELY in capitals is lower-cased first and then re-cased: a
 * caps-lock session is not a decision about how the movement is spelled, and
 * "BENCH PRESS" left alone would shout out of every list it appears in. A name
 * with any lower-case letter in it is taken at its word, so TRX, McGill and DB
 * survive untouched.
 *
 * ponytail: words split on whitespace and hyphens only. A slash or a bracket
 * rides along inside its word ("Squat/press" stays half-cased), which is
 * cosmetic and does not touch the slug; split on more separators if a real
 * name turns up wearing one.
 */
export function titleCaseName(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const src = /[a-z]/.test(trimmed) ? trimmed : trimmed.toLowerCase();
  const words = src.split(' ');
  return words
    .map((w, i) => capWord(w, i === 0 || i === words.length - 1))
    .join(' ');
}

/** The least a catalogue row has to carry to answer "what is this called". */
export interface NamedRow {
  id: string;
  name: string;
  synonyms?: readonly string[] | null;
}

/**
 * What to STORE for a name somebody typed.
 *
 * In order, and there is no fourth rule:
 *
 *   1. the catalogue's own `name`, when the typed text slugs to a row's id —
 *      so "Shoulder press" is written down as "Shoulder Press", the spelling
 *      the other 615 rows and every screen that joins to them already use;
 *   2. the catalogue's own `name`, when the typed text slugs to one of that
 *      row's synonyms exactly — "butt kicks" is stored as "Heel Flicks",
 *      because that is the movement and that is its name here;
 *   3. otherwise the typed text, title-cased. A movement the catalogue has
 *      never heard of is a real answer (a coach invents one most weeks) and it
 *      goes in as the coach's own — spelled like everything around it.
 *
 * An empty or unread catalogue lands on rule 3, which is correct rather than
 * merely tolerable: re-casing cannot change the slug, so the row still
 * resolves to the same movement the moment the catalogue is readable again.
 */
export function canonicalExerciseName(raw: string, catalogue: readonly NamedRow[]): string {
  const typed = (raw ?? '').trim();
  const id = exerciseSlug(typed);
  if (!id) return typed;

  const byId = new Map<string, string>();
  for (const r of catalogue) {
    if (!r || typeof r.id !== 'string' || !r.id) continue;
    const nm = typeof r.name === 'string' ? r.name.trim() : '';
    if (nm) byId.set(r.id, nm);
  }

  const direct = byId.get(id);
  if (direct) return direct;

  // `synonymAliases` already drops a synonym that collides with a real row's
  // id and one that two rows both claim — see its note. Nothing is guessed
  // here that it has not already refused to guess.
  const alias = synonymAliases(catalogue).get(id);
  const viaSynonym = alias ? byId.get(alias) : undefined;
  if (viaSynonym) return viaSynonym;

  return titleCaseName(typed);
}
