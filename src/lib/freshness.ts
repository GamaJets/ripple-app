// When a figure on screen was actually read, said out loud.
//
// ── The screen this exists for ────────────────────────────────────────────
//
// An owner stands in a basement gym with no signal and reads yesterday's
// takings in 44pt type. Nothing on the page says when the number was fetched,
// nothing says the phone cannot currently reach us, and there is no gesture
// that would find out: `RefreshControl` appeared in four of the twenty owner
// screens, no screen carried a fetched-at stamp, and `src/lib/reachability.ts`
// — which already knows the answer — was imported by none of them.
//
// The figure is not wrong. It is unlabelled, which is worse, because an
// unlabelled figure is read as current.
//
// ── Why the age is elapsed and not calendar ───────────────────────────────
//
// "Yesterday" and "this morning" are calendar words, and a calendar needs a
// timezone. Elapsed time needs none: eleven minutes ago is eleven minutes ago
// in Kiritimati and in Midway, and it is also the thing an owner actually wants
// to know about a takings figure.
//
// That was written when there was nowhere to keep a gym's zone at all. There is
// now — `tenants.timezone`, supabase/parts/710 — and it does NOT change the
// paragraph above. Elapsed is still the right answer for "is this number
// current", and it is still the only answer available to a gym that has not set
// a zone, which is every gym today. What the zone buys is one extra clause on
// the end of the same sentence: `fetchedNote` can now say what the clock ON THE
// GYM'S OWN WALL said at the moment of the read, which is the thing an owner
// standing at that wall can check. It is added, never substituted, and it is
// omitted entirely when there is no zone rather than filled in from the phone —
// the phone's hour is the hour of whoever is holding it, and on this screen
// that is frequently not the gym.
//
// ── Why 'unknown' is not 'online' ─────────────────────────────────────────
//
// `Reach` has three states and the third is real. A cold launch that has not
// made a request knows nothing, and telling somebody "you are offline" then
// would be an invention — so the copy here says WHEN and stays quiet about
// whether, exactly as `src/lib/reachability.ts` does one level down.
import type { Reach } from './reachability';
import { gymTimeLabel } from './gymZone';

/** One minute, one hour, one day, in ms. Named so the arithmetic below reads. */
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Past this, a figure is old enough that saying so matters more than the
 * figure. Ten minutes: short enough that a stale takings number on a desk is
 * flagged within a coffee, long enough that an owner reading a screen for two
 * minutes is not nagged about it.
 */
export const STALE_MS = 10 * MIN;

/**
 * How long ago, in words, with no calendar in it.
 *
 * Buckets rather than a precise duration, because "read 3 minutes and 41
 * seconds ago" is a precision nobody asked for on a figure whose only question
 * is "is this current". Rounded DOWN throughout: a figure read 119 seconds ago
 * is "1 minute ago", never "2 minutes ago", because the one direction this may
 * not err in is claiming a number is older than it is — that is what sends
 * somebody to refresh a figure that was fine.
 *
 * A negative age — a clock that moved backwards between the read and the render
 * — is 'just now' rather than a negative duration. It is the only honest answer
 * available and it does not put "-3 minutes ago" on an owner's screen.
 */
export function agePhrase(ageMs: number): string {
  if (!Number.isFinite(ageMs) || ageMs < MIN) return 'just now';
  if (ageMs < HOUR) {
    const m = Math.floor(ageMs / MIN);
    return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  }
  if (ageMs < DAY) {
    const h = Math.floor(ageMs / HOUR);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  const d = Math.floor(ageMs / DAY);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

/** Whether what is on screen is old enough to be worth marking. `null` — never
 *  read — is NOT stale: it has its own sentence, and a screen still loading
 *  must not be accused of holding an old figure. */
export function isStale(at: number | null, now: number, ttlMs: number = STALE_MS): boolean {
  if (at == null) return false;
  return now - at >= ttlMs;
}

/**
 * The whole sentence under a screen's figures.
 *
 * Three inputs, and every combination of them has to be a true sentence:
 *
 *   · never read + offline    → the honest one nobody was writing. The screen
 *                               has nothing and cannot get anything.
 *   · never read + online     → still reading; say that, not "0".
 *   · read + offline          → THE sentence this file exists for. The figures
 *                               are real, they are from a moment in the past,
 *                               and they will not change until there is signal.
 *   · read + online/unknown   → when. On 'unknown' it must not claim either
 *                               way about the connection.
 *
 * `zone` is the gym's own IANA zone (`tenants.timezone`) and is OPTIONAL in the
 * strong sense: every caller that passes nothing gets exactly the sentence it
 * got before, and every caller that passes a zone gets the same sentence with
 * the gym's own wall clock appended. Passing the reader's zone here would be a
 * lie in the one place this file exists to stop one — see the header — so the
 * argument is documented as the GYM's and a caller with only a device zone
 * passes null.
 */
export function fetchedNote(at: number | null, now: number, reach: Reach, zone?: string | null): string {
  if (at == null) {
    return reach === 'offline'
      ? 'Not read yet, and this phone cannot reach us — nothing on this screen is your gym’s.'
      : 'Reading…';
  }
  const age = agePhrase(Math.max(0, now - at));
  // Null for no zone, an unresolvable zone and an unreadable instant alike —
  // three nothings that all mean "do not put an hour on screen".
  const clock = gymTimeLabel(at, zone ?? null);
  const at_ = clock ? `, at ${clock} at the gym` : '';
  if (reach === 'offline') {
    return `Offline — read ${age}${at_}. Nothing here will change until there is signal.`;
  }
  return `Read ${age}${at_}`;
}

/**
 * Whether the fetched-at line should carry a mark beside it.
 *
 * Returned as a plain flag rather than a colour, because the caller owns the
 * palette and because `src/theme/scale.ts` forbids a status colour being used
 * as TEXT colour — the mark is a 6pt dot beside ink, which is what `Flag` in
 * src/ui/kit.tsx draws.
 */
export function fetchedNeedsMark(at: number | null, now: number, reach: Reach, ttlMs: number = STALE_MS): boolean {
  if (reach === 'offline') return true;
  return isStale(at, now, ttlMs);
}

/**
 * One stamp for a screen fed by several reads: the OLDEST of them.
 *
 * A screen that shows three providers' figures under one "Read 2 minutes ago"
 * is making a claim about all three, so the claim has to be true of the worst
 * of them. Taking the newest — which is what a single `useEffect` on whichever
 * status happened to be destructured first does — labels a figure read an hour
 * ago with the age of the one read a moment ago, which is the exact defect this
 * file exists to stop: an unlabelled figure read as current, now with a
 * confident wrong label on it instead of none.
 *
 * A source that has never come back contributes `null`, and one null makes the
 * whole thing null: `fetchedNote` then says "Reading…" rather than putting an
 * age on a screen where part of what is displayed has never been read at all.
 * Callers with a source that is genuinely optional should leave it out rather
 * than pass its null.
 *
 * No arguments at all is null for the same reason — there is nothing to be the
 * age of.
 */
export function oldestFetch(...ats: (number | null)[]): number | null {
  if (ats.length === 0) return null;
  let out = Infinity;
  for (const a of ats) {
    if (a == null) return null;
    if (a < out) out = a;
  }
  return out;
}
