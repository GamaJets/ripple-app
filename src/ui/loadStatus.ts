// One vocabulary for the question every provider in this folder was unable to
// answer: can the thing it is showing you actually be trusted?
//
// All of these providers degrade when the server cannot be reached — to an empty
// list, to an in-memory map, to a cached copy — and that degrading is correct.
// The app is used in gyms with no signal and has to keep working there. The bug
// that kept recurring is not the fallback, it is that the fallback was
// indistinguishable from the real answer: `log: []` was returned identically for
// "you have never logged a workout" and "the row-level-security policy refused
// the read", and every screen downstream stated the first as a fact about the
// user's own history.
//
// So each provider now says which one it is:
//
//   'loading' — the first read is still in flight. Nothing is known yet.
//   'ready'   — the server answered. An empty list under 'ready' is genuinely
//               empty, and a screen may say so.
//   'partial' — the server answered, the rows are real, and there are more of
//               them than came back. See src/lib/rowCap.ts: PostgREST stops at
//               1000 rows and says nothing, so a coach with 1,400 sessions was
//               being handed 1,000 of them under 'ready' and told, by omission,
//               that that was all of them. The list may be shown. A total, a
//               count, a sum or an average over it may NOT — it is a figure
//               computed from an unknown fraction of the set.
//   'error'   — the server did not answer, or refused. An empty list under
//               'error' means UNKNOWN, and a non-empty one is whatever we had
//               before the failure (cached, optimistic, or seeded) and is not
//               confirmed current.
//
// 'partial' is deliberately not 'ready'. Screens gate their figures on
// `status === 'ready'` — `known`, `listable`, `fig(null)` — so a truncated read
// arriving as 'partial' makes those figures render as a dash on its own, which
// is the outcome the house rule already asks for. Had it arrived as 'ready'
// every one of those screens would have printed a subtotal as a total, and
// nothing anywhere would have had cause to doubt it.
//
// 'ready' is a claim about the server, not about the data. When the backend is
// switched off entirely (USE_SUPABASE false) the local store IS the source of
// truth, so that case is 'ready' too — there is no absent server to misreport.
//
// Screens may ignore this and nothing breaks: the data itself is unchanged and
// every existing call signature still means what it meant. But a screen about to
// render "No workouts yet", "Your coach hasn't sent anything", or "0 clients"
// should check first, because under 'error' it is asserting something it does
// not know.
export type LoadStatus = 'loading' | 'ready' | 'partial' | 'error';

/**
 * True when the provider has finished and what it holds is the whole set —
 * the one condition under which a screen may count, sum or average the rows.
 *
 * Written as a function rather than left to each screen's `=== 'ready'` because
 * the check that needs to be right is "is this all of it", and the two statuses
 * that fail it fail it for different reasons a reader has to hold in mind.
 */
export const isWhole = (s: LoadStatus): boolean => s === 'ready';

/**
 * The status of several reads taken together: the least trustworthy of them.
 *
 * A screen fed by three providers is only as complete as its worst one. The
 * order is error, then loading, then partial, then ready — 'loading' outranks
 * 'partial' because a part still in flight is not yet known to be anything,
 * and calling the whole thing 'partial' while it lands would let a screen start
 * drawing a set that is about to change. Once everything has landed, 'loading'
 * is gone and any truncation left in the mix is what the screen hears.
 */
export function worstStatus(...s: LoadStatus[]): LoadStatus {
  if (s.includes('error')) return 'error';
  if (s.includes('loading')) return 'loading';
  if (s.includes('partial')) return 'partial';
  return 'ready';
}
