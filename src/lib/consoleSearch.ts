// Finding one row in a console built entirely out of long lists.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// There is no search input anywhere in `studio-web`. Not on the members roster,
// not on retention, not on staff, not on classes, not on passes, not on the
// invitations list, and — worst of the seven — not at the front desk, where the
// member picker is a `<select>` of every active membership in the gym.
// `components/DataTable.tsx` offers column sort and nothing else.
//
// The phone app has had `app/(owner)/explore.tsx` over `searchNav(OWNER_NAV)`
// since the owner portal was built. The console, which is where the six-hundred-
// member roster actually lives, has nothing.
//
// ── The rule this file is written around ───────────────────────────────────
//
// FILTERING MUST NEVER LOOK LIKE AN ANSWER ABOUT THE GYM.
//
// Every list in this console distinguishes three states — not read, read and
// empty, read and full — because a failed query drawn as an empty table is how
// an owner concludes they have no members. A search box reintroduces that
// failure by a different door: type four characters that match nothing and the
// table empties, and it now reads exactly like a gym with no members. So
// `searchNote` below exists to be rendered beside every filtered list, and it
// says how many of how many are shown and what would bring the rest back.
//
// ── Why matching is per-term rather than per-substring ─────────────────────
//
// "sara ok" has to find "Sara Okafor", and a single-substring match cannot: the
// query is not a substring of the name. Every whitespace-separated term must
// appear somewhere in the row, in any field and in any order, which is what
// people expect from a search box and what a `<select>`'s type-ahead — the only
// thing the desk has today — conspicuously does not do.

/**
 * A string reduced to what a search should compare.
 *
 * Case is folded, accents are stripped, and runs of whitespace collapse to one
 * space. The accents matter more than they look: a gym in Dubai or Lisbon has
 * "Zoë" and "Gonçalves" on its roster, and an owner typing on an English
 * keyboard types "zoe" and "goncalves" — a search that refuses those is a search
 * that fails exactly on the names its user could not type if they wanted to.
 *
 * NFD splits a letter from its diacritic and the range strips the combining
 * marks, which is the whole of the trick. Guarded, because `normalize` is on
 * String.prototype everywhere this runs but a hand-built test double is not
 * obliged to have one.
 */
export function normalise(s: string | null | undefined): string {
  const raw = (s ?? '').toString();
  const folded = typeof raw.normalize === 'function' ? raw.normalize('NFD') : raw;
  return folded
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The query, split into the terms that must each be found somewhere. */
export function terms(query: string | null | undefined): string[] {
  const n = normalise(query);
  return n ? n.split(' ') : [];
}

/**
 * Whether a row matches, given every field it can be searched on.
 *
 * Nulls in `fields` are dropped rather than stringified: `String(null)` is
 * "null", and a query for "nul" would otherwise match every row with a missing
 * plan name. That is not a hypothetical — half the columns in this console are
 * deliberately nullable so a missing value can render as a dash.
 *
 * An empty query matches everything, which is what makes `searchRows` safe to
 * call unconditionally.
 */
export function matches(fields: (string | null | undefined)[], query: string | null | undefined): boolean {
  const t = terms(query);
  if (!t.length) return true;
  const hay = fields
    .filter((f): f is string => typeof f === 'string' && f.length > 0)
    .map((f) => normalise(f))
    .join(' \u0000 ');
  // Every term, anywhere. Not "the query is a substring of the name": nobody
  // types a person's full name to find them.
  return t.every((term) => hay.includes(term));
}

/** Filter a list. An empty query returns the list unchanged — the same array,
 *  so a caller memoising on identity does no work when nobody has typed. */
export function searchRows<T>(
  rows: T[],
  query: string | null | undefined,
  fields: (row: T) => (string | null | undefined)[],
): T[] {
  if (!terms(query).length) return rows;
  return rows.filter((r) => matches(fields(r), query));
}

/**
 * The sentence that goes beside a filtered list.
 *
 * Null when nothing is being filtered, so a caller can render it
 * unconditionally and get nothing when there is nothing to say.
 *
 * The wording is chosen against one specific misreading. A filtered table that
 * comes back empty is indistinguishable, on screen, from a table whose read
 * failed and from a gym that genuinely has none — three states this console
 * spends real effort keeping apart everywhere else. So a search that hides
 * everything says so in the first clause, and names the control that undoes it.
 */
export function searchNote(
  query: string | null | undefined,
  shown: number,
  total: number,
): string | null {
  const t = terms(query);
  if (!t.length) return null;
  const q = t.join(' ');
  if (total === 0) return null;
  // ── why the three counts below are NOT grouped ────────────────────────────
  //
  // They should be. A members table on a club with four thousand people reads
  // "the other 3952 do not match", and that is exactly what check:numbers is
  // for. There is no formatter this module may call.
  //
  // This file is imported by nine studio-web pages through `@lib/*`, which
  // resolves to `../src/lib/*`. `num()` in src/lib/format.ts spells through
  // `appLocale()` — a module-level latch in src/lib/locale.ts, seeded once —
  // and Next.js resolves that on the SERVER during render and again in the
  // BROWSER during hydration, on two machines with two locales. That is the
  // silent hydration error studio-web/lib/num.ts duplicated the whole formatter
  // to avoid rather than import. Every page calling this is 'use client' and
  // loads its rows in an effect, so nothing reaches the prerendered HTML today
  // — which is a property of those call sites and not of this module, and is
  // precisely the reasoning num.ts refused to lean on. The console's own `num`
  // cannot be taken the other way either: src/lib may not depend on studio-web.
  //
  // The fix is for `searchNote` to be handed a spelling function by its caller,
  // so the phone passes `num` and the console passes its own. That changes a
  // signature nine console pages call, and the console is not this file's tree.
  //
  // numbers-ok: console-shared module — no reader whose locale could be asked.
  if (shown === 0) {
    // numbers-ok: as above, a console-shared module has no locale to spell in.
    return `Nothing here matches “${q}”. That is this search box hiding ${total} ${total === 1 ? 'row' : 'rows'}, not an empty gym — clear it to see them again.`;
  }
  // numbers-ok: as above, a console-shared module has no locale to spell in.
  if (shown === total) return `All ${total} match “${q}”.`;
  // numbers-ok: as above, a console-shared module has no locale to spell in.
  return `${shown} of ${total} shown — the other ${total - shown} do not match “${q}”.`;
}
