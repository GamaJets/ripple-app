// Whether anything of this person's can be read from the server at all.
//
// ── The guard that stopped working ─────────────────────────────────────────
//
// app/(trainer)/client.tsx asks eight questions about one named client, and
// every one of them is meaningless for somebody the coach typed into Add
// Client. A `coach_clients` row is a note the coach made; there is no account
// behind it, and every policy the eight reads sit behind resolves through
// `is_my_client()`, which looks in `clients`. So each read comes back with zero
// rows and NO error — the exact shape this codebase renders as "they have
// none".
//
// The screen guarded against that, and the guard was `isQueryableId`: a
// hand-added client, the reasoning went, has an id this app invented on the
// phone ('c900'), Postgres refuses a uuid comparison against it outright, and
// so the two can be told apart by looking at the id.
//
// That was true for about one second per client. `coach_clients.id` is
// `uuid DEFAULT gen_random_uuid()` — confirmed against phgfwzpkkwdysftlgkoq —
// so as soon as the insert comes back (src/ui/roster.tsx swaps the local id for
// the server's), and on every launch after that, a hand-added client carries a
// perfectly well-formed uuid. The guard passed, all eight reads ran, all eight
// returned nothing, and the screen told the coach that a person with no app had
// disclosed no injuries, set no goals, planned no week, never trained and not
// filled in their intake. That last one is an accusation about somebody,
// manufactured out of a read that was never entitled to an answer.
//
// The id cannot answer this question. The roster can, because it knows which of
// its two tables each row came from, and it now carries that on the row — see
// `handAdded` in ./trainerMock. This is the two facts put together in one
// place, so that the screens which ask do not each re-derive it and drift.
import { isQueryableId } from './clientDrift';

/**
 * Can the server be asked about this client?
 *
 * True only when there is an id the database will accept AND the roster has not
 * said this person is a note the coach wrote. `handAdded` is deliberately
 * three-valued: `undefined` is "the roster has not said", which happens on the
 * first render before it has loaded and for a row from an older build, and the
 * honest answer there is to go on asking rather than to withhold a real
 * client's whole screen on a value nobody has supplied yet. Only an explicit
 * `true` withholds, because only an explicit `true` is knowledge.
 */
export function clientIsQueryable(
  id: string | null | undefined,
  handAdded?: boolean | null,
): boolean {
  if (!id || !isQueryableId(id)) return false;
  return handAdded !== true;
}
