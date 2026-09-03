// Finding one person on a coach's book.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// The Clients screen had one search affordance and it was a magnifying glass in
// the header that pushed `/(trainer)/explore` — which searches TRAINER_NAV, the
// list of SCREENS. So a coach with eighty clients tapped the only thing on the
// page shaped like search, typed a person's name, and was told nothing matches:
// the one search in the coach app cannot find a client, and nothing said so.
// The segment chips filter by delivery, by drift and by tag, and none of those
// is "the woman I am about to train in ten minutes".
//
// Everything here is pure — no reads, no writes, no provider — so the two
// screens that need it (the roster, and the client picker on Log a Session)
// share one idea of what typing a name does, and rosterSearch.test.ts can pin
// it under plain node.
//
// ── What it matches on, and what it deliberately does not ──────────────────
//
// The NAME, and nothing else. Goal, mode and tag are all already segments with
// their own chips and their own counts, and folding them in here would put
// people in the list whose names do not contain what was typed while the line
// above says "3 match “fat”" — a caption that disagrees with the rows under it
// is how a coach messages the wrong twelve people. One field, one meaning.
//
// Every term has to land, and order does not matter: "jones sarah" finds Sarah
// Jones, because a coach half-remembering a name types the half they remember
// first. A term lands as a SUBSTRING rather than as a prefix — "ell" finds
// Bell, and a coach who can only remember the middle of a surname is the person
// most in need of a search field.
//
// Accents are folded before matching. "jose" finds José, and — the half that
// matters more — José finds himself when the coach types his name off a
// keyboard that does not do the accent. Nothing is folded on the way OUT: the
// row still draws the name the person gave.
//
// ── An empty result is two different sentences ─────────────────────────────
//
// `rosterSearchLine` is the whole reason this file holds copy at all. A search
// runs over the roster that LOADED, and under 'error' that is not the roster —
// so "nobody matches" said over a failed read tells a coach the client they are
// looking for is not on their book. Under 'partial' the book came back at its
// row cap and the names past it were never searched, which is the same lie one
// row quieter. Both get their own sentence and only 'ready' gets to say a
// person is not there.
import type { LoadStatus } from '../ui/loadStatus';

/** Anything with a name is searchable — the roster row, and the lighter shape
 *  the session picker holds. */
export interface NamedClient { name: string }

/**
 * Lowercase, strip accents, split on anything that is not a letter or a digit.
 *
 * The decomposition has to come first. `split(/[^a-z0-9]+/)` on its own treats
 * an é as a separator, so "José" arrives as ["jos"] and a coach typing his name
 * in full matches nothing — the search would be worst for exactly the names a
 * coach is least likely to spell the same way twice.
 */
const terms = (s: string): string[] =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The name as it is matched against: folded, and with every separator taken
 * out so nothing a coach cannot see can hide a term.
 *
 * Squashed rather than space-joined, and it is a deliberate trade. A name is
 * full of punctuation nobody types the same way twice — O’Neill, Ana-María,
 * van der Berg — and "oneill" has to find O’Neill, because typing the
 * apostrophe is exactly what somebody in a hurry does not do. The cost is a
 * match that straddles two words: "raj" finds Sara Jones. That is a stray row
 * in a filtered list, which a coach discards at a glance; the alternative is a
 * search field that cannot find a name spelled the ordinary way.
 */
const haystack = (name: string): string => terms(name).join('');

/**
 * Does this name answer what was typed?
 *
 * An empty query matches everybody — a field nobody has typed in is not a
 * filter, and the caller renders the whole list.
 */
export function matchesRosterQuery(name: string, query: string): boolean {
  const wanted = terms(query);
  if (!wanted.length) return true;
  const hay = haystack(name);
  return wanted.every((w) => hay.includes(w));
}

/**
 * The people on this list whose names answer the query, in the order they were
 * given.
 *
 * The ORDER is the caller's and is never re-ranked here. On the roster that
 * order is who needs a call first — `compareDrift` decides it — and a search
 * field that quietly re-sorted by how well a name matched would put the client
 * with nothing recorded for three weeks below the one whose surname happened to
 * start with the letters typed.
 */
export function searchRoster<T extends NamedClient>(list: readonly T[], query: string): T[] {
  if (!terms(query).length) return [...list];
  return list.filter((c) => matchesRosterQuery(c.name, query));
}

/**
 * The one sentence a search over an incomplete read owes the coach, or null
 * when there is nothing to say.
 *
 * `matched` is how many are on screen; `searched` is how many rows the query
 * actually ran over, which is what loaded rather than what the coach has.
 */
export function rosterSearchLine(o: {
  status: LoadStatus;
  query: string;
  matched: number;
  searched: number;
}): string | null {
  const q = o.query.trim();
  if (!q) return null;
  switch (o.status) {
    case 'error':
      return `Your roster could not be read, so nothing was searched. Not finding “${q}” here does not mean they are not on your book.`;
    case 'loading':
      return `Still reading your roster — this has searched only the names that have arrived so far, so “${q}” may yet turn up.`;
    case 'partial':
      // Said whether or not there are matches. A coach who finds one Sarah
      // among a book that came back short has no way of knowing there is a
      // second one past the cap.
      return o.matched > 0
        ? `Your roster came back short, so “${q}” was matched against the ${o.searched} names that arrived and not against the rest of your book.`
        : `Your roster came back short, so “${q}” was matched against only the ${o.searched} names that arrived. They may be among the ones that did not.`;
    case 'ready':
      // The only status allowed to state an absence.
      return o.matched > 0 ? null : `Nobody on your roster matches “${q}”.`;
  }
}

/**
 * The line under a picker that shows only the first screenful of a roster.
 *
 * Said when nothing has been typed, so `rosterSearchLine` above is silent, and
 * it is the ONE sentence on that screen a coach acts on: "type a name to find
 * the rest" is an instruction about where the missing people are.
 *
 * `known` is how many names the app actually holds, and that is not the size of
 * the book unless the read was whole. Under 'partial' this used to print the
 * page size as the total — so a coach searching for somebody who did not make
 * the page typed the name, got nothing, and concluded the client is not on
 * their book. Under 'error' it is whatever survived a failure and is not a
 * count of anything.
 */
export function rosterPickerLine(o: { status: LoadStatus; shown: number; known: number }): string {
  const tail = 'Type a name to find the rest.';
  switch (o.status) {
    case 'error':
      return `Showing the ${o.shown} clients this app still had. Your roster could not be read, so this is not a count of your book. ${tail}`;
    case 'loading':
      return `Showing ${o.shown} of the clients read so far — your roster is still arriving. ${tail}`;
    case 'partial':
      return `Showing ${o.shown} of the ${o.known} clients that arrived. Your roster came back short, so that is not all of them and a name you cannot find here may still be on your book.`;
    case 'ready':
      return `Showing ${o.shown} of your ${o.known} clients — ${tail.charAt(0).toLowerCase()}${tail.slice(1)}`;
  }
}
