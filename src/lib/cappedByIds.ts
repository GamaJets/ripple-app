// A `.in()` over a long id list that must stay CAPPED rather than be finished.
//
// ── Why this is not `readByIds` ────────────────────────────────────────────
//
// src/lib/idLookup.ts already solves the request-line half of this: a uuid
// costs about 39 bytes inside a PostgREST `in.("…","…")` list, so a thousand of
// them is a ~39KB query string against an 8KB request-line limit that nginx and
// most CDNs enforce by default. The refusal is a 414, supabase-js does not
// reject on it, and it arrives as `data: null` — which reads exactly like an
// empty result.
//
// `readByIds` chunks the list AND finishes every chunk with `readAll`. That is
// the right answer when the caller genuinely needs the whole set: a name per
// id, a credential per coach, a booking count per class. It is the wrong answer
// for the other shape this codebase has, and src/ui/roster.tsx is the worked
// example of it.
//
// There, three reads decorate a roster: every scan, every workout and every
// check-in belonging to a page of clients. They are deliberately read
// NEWEST-FIRST and deliberately capped, and src/ui/roster.tsx argues the case at
// length — for any client who appears in the page at all, their newest row is in
// it by construction, so "last active" and "latest adherence" are exact, and the
// two figures a cut CAN break are suppressed rather than guessed. Finishing
// those reads would turn one round trip into a walk through every scan two
// hundred clients have ever recorded, to compute a "last active" that the first
// page already answered. It would make a screen that works slowly wrong.
//
// So: chunk the ids, because the request line is a hard limit and being refused
// is not an answer. Keep the cap, because the cap is a product decision that
// the caller has already reasoned about. That combination has no home in
// idLookup.ts, whose whole promise is that the set comes back whole.
//
// ── What a caller gets, and what it must still decide ──────────────────────
//
// Three fields, and the reason they are three rather than a thrown error is
// that all three callers in this codebase treat them differently:
//
//   rows       everything that came back, chunks concatenated in id order.
//   truncated  at least one chunk came back AT its cap, so the set is a prefix
//              and the caller's own suppression rules apply. Chunking makes
//              this STRICTLY less likely than the single `.in()` it replaces —
//              a thousand ids used to share one 1000-row ceiling and now seven
//              chunks have one each — but less likely is not never, and a
//              silently smaller flag would be the defect this file is about.
//   error      the FIRST chunk that failed, with the loop stopped there.
//
// `error` and not a throw, because a failure here is not the same event for
// everyone: the roster's stat reads mark a screen 'partial' and carry on, and
// pretending otherwise would either take a working screen away or swallow a
// refusal into an empty decoration. A caller that wants a throw writes one; a
// caller that cannot get one back out of a Promise rejection cannot un-write it.
//
// The loop STOPS at the first failing chunk rather than trying the rest. A
// partial answer assembled out of some chunks that worked and some that did not
// is a set whose gaps are invisible — precisely the shape of "the read did not
// fail" that this codebase keeps paying for — and `error` is the only honest
// thing to say about it. The rows gathered before the failure are handed back
// anyway, because a caller that has been told the read failed can decide for
// itself whether a partial decoration is worth drawing.
import { ID_CHUNK, chunkIds, uniqueIds } from './idLookup';
import { ROW_CAP, capped } from './rowCap';

export interface CappedByIds<T> {
  /** Every row that came back, across every chunk that was asked. */
  rows: T[];
  /**
   * At least one chunk came back with MORE rows than its cap — the probe row
   * `capLimit()` asks for — so this is a prefix of the set and not the set.
   */
  truncated: boolean;
  /** The first chunk error, or null. Anything after it was not asked. */
  error: unknown | null;
}

/**
 * Rows matching any of `ids`, asked for in request-line-sized chunks, with each
 * chunk's own row cap left in place.
 *
 * `page` is handed ONE chunk of ids and must apply the caller's own
 * `.limit(capLimit())` and ordering. It is not given a `.range()`, because
 * nothing here pages: that is the whole difference from `readByIds`.
 *
 * Chunks are asked in sequence, not in parallel. A caller large enough to need
 * several is a caller whose reads above it were already several, and the
 * sequence is what makes stopping at the first failure possible at all.
 */
export async function readCappedByIds<T>(
  ids: Iterable<string | null | undefined>,
  page: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { chunk?: number; cap?: number } = {},
): Promise<CappedByIds<T>> {
  const unique = uniqueIds(ids);
  if (!unique.length) return { rows: [], truncated: false, error: null };
  const cap = Math.max(1, Math.floor(opts.cap ?? ROW_CAP));
  const out: T[] = [];
  let truncated = false;
  for (const chunk of chunkIds(unique, opts.chunk ?? ID_CHUNK)) {
    const { data, error } = await page(chunk);
    // supabase-js RESOLVES on a database error, so a failed chunk arrives as
    // `data: null` and would otherwise contribute nothing and say nothing —
    // leaving the ids in it looking like people with no scans, no workouts and
    // no check-ins. Which a coach reads as clients who have done nothing.
    if (error) return { rows: out, truncated, error };
    const page1 = capped<T>(data, cap);
    if (page1.truncated) truncated = true;
    for (const r of page1.rows) out.push(r);
  }
  return { rows: out, truncated, error: null };
}
