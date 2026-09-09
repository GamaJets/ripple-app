// Finding one session in a quarter of them.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// app/(trainer)/sessions.tsx reads ninety days at a time and can be pushed back
// a quarter further with a tap. Everything it read was drawn: the queue of
// unmarked sessions grouped by day, and under it the whole record of what
// already happened. There was no way to narrow either of them — no client
// picker, no search, no filter on what became of a session. A coach looking for
// what happened with one person in March scrolled past every other client's
// March to find it, and a coach chasing the three sessions a client disputes
// had to read the lot.
//
// ── A FILTER IS NOT A READ, AND THIS MODULE'S JOB IS TO KEEP THEM APART ────
//
// This codebase has one recurring defect and it is an empty list being read as
// a fact. `LoadStatus` exists for it, `fig(null)` exists for it, and the screen
// this module serves already keeps `queue === null` apart from `queue === []`
// for exactly that reason: an unread queue must never render as "nothing
// outstanding — payroll can be settled".
//
// A filter introduces a THIRD empty list, and it is the one most likely to be
// misread, because the coach did it to themselves and will not remember they
// did. Filtered to one client, an empty day looks identical to a day with
// nothing in it. So:
//
//   · every sentence this module produces about an empty result names the
//     filter as the reason, and names how many rows were actually read;
//   · nothing here ever produces a COUNT for a headline figure. The count of
//     what is outstanding is a fact about the coach's book and does not move
//     because somebody typed a name into a box — the caller keeps the Hero on
//     the unfiltered queue and uses `filterLine` to say how much of it is on
//     screen.
//
// Pure — no react, no supabase, no clock — so all of it is assertable.
import type { PastState } from './sessionHistory';
// The reader's own grouping. Safe here because this module is reachable only
// from the phone app — see scripts/check-numbers.mjs for the two trees where a
// latched `appLocale()` belongs to nobody.
import { num } from './format';

/** The minimum a row needs to be filtered. A subset of `PtSession`, so the
 *  screen's own rows satisfy it without conversion. */
export interface FilterRow {
  clientId: string | null;
  clientName: string | null;
}

export interface SessionFilter {
  /** One client's id, or null for everybody. An id rather than a name: two
   *  clients called Sam are two clients, and a coach who picks one of them from
   *  a list must not be shown both. */
  clientId: string | null;
  /** Free text over the client's name, as typed. Compared case-folded and
   *  trimmed; stored verbatim so the box shows what the coach put in it. */
  text: string;
  /** One outcome, or null for every outcome. Only meaningful over the record —
   *  every row in the marking queue is `unmarked` by construction, so a caller
   *  filtering the queue by state would be offering a control with one useful
   *  position and four empty ones. */
  state: PastState | null;
}

/** Nothing narrowed. The state a screen opens in. */
export const NO_FILTER: SessionFilter = { clientId: null, text: '', state: null };

/** Whether anything is actually narrowing the list. Text counts only once it
 *  has a non-space character in it — a box holding a space is not a search, and
 *  telling a coach their list is filtered because of one would send them
 *  hunting for a control they have not touched. */
export function filterActive(f: SessionFilter): boolean {
  return f.clientId !== null || f.state !== null || f.text.trim().length > 0;
}

/** Case-folded, accent-naive substring. Naive on purpose: this is a box a coach
 *  types three letters of a name into, and a smarter matcher that dropped
 *  "Ana" from a search for "ana" would be worse at the only job it has. */
export function matchesText(name: string | null, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  return (name ?? '').toLowerCase().includes(q);
}

/** One entry in the client picker. */
export interface ClientOption {
  clientId: string;
  /** The first non-empty name seen for this id, or 'Client' when every row
   *  carried none — never blank, which would render as an unlabelled chip. */
  name: string;
  /** How many of the rows given are theirs. On the chip, so a coach can see a
   *  client has one session in the window before tapping into an empty list. */
  count: number;
}

/**
 * Who appears in these rows, in name order.
 *
 * A row with NO `clientId` produces no option and can be matched by no client
 * filter. That is the honest behaviour rather than a gap: a slot with no client
 * on it is not a person, and inventing an "Unattributed" pseudo-client would
 * put a name-shaped chip in a row of real names. Such rows are still in the
 * unfiltered list, which is where they can be seen.
 */
export function clientOptions(rows: readonly FilterRow[]): ClientOption[] {
  const byId = new Map<string, { name: string; count: number }>();
  for (const r of rows) {
    const id = r.clientId;
    if (!id) continue;
    const name = (r.clientName ?? '').trim();
    const seen = byId.get(id);
    if (seen) { seen.count += 1; if (!seen.name && name) seen.name = name; }
    else byId.set(id, { name, count: 1 });
  }
  return [...byId.entries()]
    .map(([clientId, v]) => ({ clientId, name: v.name || 'Client', count: v.count }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.clientId.localeCompare(b.clientId));
}

/**
 * The rows that survive the filter.
 *
 * `stateOf` is passed in rather than computed here, because what state a
 * session is in is `pastVerdict`'s answer and there must not be a second one —
 * a module that decided for itself whether a row counted as cancelled would
 * disagree with the label printed on that very row the first time either
 * changed. Omitted, the state clause does not apply at all, which is what the
 * marking queue wants.
 */
export function filterSessions<T extends FilterRow>(
  rows: readonly T[],
  f: SessionFilter,
  stateOf?: (row: T) => PastState,
): T[] {
  return rows.filter((r) => {
    if (f.clientId !== null && r.clientId !== f.clientId) return false;
    if (!matchesText(r.clientName, f.text)) return false;
    if (f.state !== null && stateOf && stateOf(r) !== f.state) return false;
    return true;
  });
}

/**
 * What is on screen, and out of how much.
 *
 * Null when nothing is narrowed, because a permanent "showing 88 of 88" under
 * an unfiltered list is furniture. `total` is the number of rows READ, and the
 * sentence says so in those words — "of the 88 read" rather than "of your 88
 * sessions", which would be a claim about a coach's whole history made from a
 * ninety-day window.
 */
export function filterLine(
  shown: number,
  total: number,
  f: SessionFilter,
  /** The picked client's name, where the caller knows it. Null when the pick
   *  names somebody who is not in the rows any more — which is a real state
   *  after the window moves, and "one client" is then the honest phrase. */
  clientName: string | null = null,
): string | null {
  if (!filterActive(f)) return null;
  const narrowed: string[] = [];
  if (f.clientId !== null) narrowed.push(clientName ? `just ${clientName}` : 'one client');
  if (f.text.trim()) narrowed.push(`a search for “${f.text.trim()}”`);
  if (f.state !== null) narrowed.push('one outcome');
  const by = narrowed.length === 1
    ? narrowed[0]
    : `${narrowed.slice(0, -1).join(', ')} and ${narrowed[narrowed.length - 1]}`;
  // `total` is every session read into the screen, not a page of them — a coach
  // two years into a full book passes a thousand and the sentence is the one
  // place that says how much is being hidden. Both halves grouped, because
  // "Showing 48 of the 1204 read" spells the important figure worst.
  return `Showing ${num(shown)} of the ${num(total)} read, narrowed by ${by}.`;
}

/**
 * What to say where the filtered list would be blank.
 *
 * The sentence a screen must not print here is "you have none". Nothing has
 * been read that was not read a moment ago; the coach hid the rest themselves
 * and may well have forgotten. So this names the filter, names the size of what
 * was read, and says how to get back — and it is only ever called where the
 * unfiltered list is known to have something in it.
 */
export function emptyFilterLine(total: number, f: SessionFilter): string {
  if (!filterActive(f)) {
    // Not reachable from a caller that checks, and written rather than left to
    // an empty string: a blank line here would be a screen saying nothing at
    // the one moment a coach is looking for an explanation.
    return 'Nothing to show.';
  }
  return `None of the ${num(total)} sessions read matches what you have narrowed to. `
    + 'They have not gone anywhere — clear the filters to see them again.';
}

/**
 * How many of these rows are in each state, for the outcome chips.
 *
 * Every state gets a key, including the ones with nothing in them, so a chip
 * can show `0` and be visibly worth not tapping. A state missing from the map
 * would render as an absent chip, and a coach who cannot see "cancelled late"
 * has no way to learn that none of their sessions is.
 */
export function stateCounts<T extends FilterRow>(
  rows: readonly T[],
  stateOf: (row: T) => PastState,
  states: readonly PastState[],
): Record<PastState, number> {
  const out = {} as Record<PastState, number>;
  for (const s of states) out[s] = 0;
  for (const r of rows) {
    const s = stateOf(r);
    if (s in out) out[s] += 1;
  }
  return out;
}
