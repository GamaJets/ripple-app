"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalise = normalise;
exports.terms = terms;
exports.matches = matches;
exports.searchRows = searchRows;
exports.searchNote = searchNote;
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
function normalise(s) {
    const raw = (s ?? '').toString();
    const folded = typeof raw.normalize === 'function' ? raw.normalize('NFD') : raw;
    return folded
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}
/** The query, split into the terms that must each be found somewhere. */
function terms(query) {
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
function matches(fields, query) {
    const t = terms(query);
    if (!t.length)
        return true;
    const hay = fields
        .filter((f) => typeof f === 'string' && f.length > 0)
        .map((f) => normalise(f))
        .join(' \u0000 ');
    // Every term, anywhere. Not "the query is a substring of the name": nobody
    // types a person's full name to find them.
    return t.every((term) => hay.includes(term));
}
/** Filter a list. An empty query returns the list unchanged — the same array,
 *  so a caller memoising on identity does no work when nobody has typed. */
function searchRows(rows, query, fields) {
    if (!terms(query).length)
        return rows;
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
function searchNote(query, shown, total) {
    const t = terms(query);
    if (!t.length)
        return null;
    const q = t.join(' ');
    if (total === 0)
        return null;
    if (shown === 0) {
        return `Nothing here matches “${q}”. That is this search box hiding ${total} ${total === 1 ? 'row' : 'rows'}, not an empty gym — clear it to see them again.`;
    }
    if (shown === total)
        return `All ${total} match “${q}”.`;
    return `${shown} of ${total} shown — the other ${total - shown} do not match “${q}”.`;
}
