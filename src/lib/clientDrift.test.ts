// The two facts a map of client activity cannot carry, and what happens to each.
//
// `readClientActivity` answers three questions — what came back, which ids were
// never put to the database, and whether the answer was cut off at PostgREST's
// row ceiling. `fetchClientActivity` hands back only the first of those, and it
// is the convenience wrapper a screen reaches for.
//
// Losing the two is not one defect, it is two with opposite answers, and these
// assertions are about the difference:
//
//   · `notAsked` is a fact about NAMED IDS. It survives in the map — those ids
//     are keys with `[]` against them — and any caller can recover the list
//     exactly by filtering on `isQueryableId`. Refusing the read over it would
//     take a whole screen away from a coach with one hand-added client, which
//     is the failure `isQueryableId` exists to prevent.
//   · `truncated` is a fact about THE SET. It survives nowhere. A client whose
//     rows fell off the far side of the ceiling comes back with `[]` — the same
//     array as a client who stopped training in March — and with no `.order()`
//     on the four reads, which clients those are is not stable between calls.
//     So the wrapper refuses, per src/lib/rowCap.ts.
//
// Compile with tsc, run with node.
import {
  fetchClientActivity, readClientActivity, isQueryableId,
  assessDrift, DEFAULT_WINDOWS,
} from './clientDrift';
import { ROW_CAP } from './rowCap';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

void (async () => {

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
/** A client added by hand on the coach's phone. Not a uuid, so never asked about. */
const LOCAL = 'c900';

/**
 * A supabase-shaped stub: every builder method returns itself, and awaiting it
 * hands back whatever `rowsFor` says that table holds. Only the table name is
 * consulted, because what is under test is what this module does with the
 * answer, not the filters it wrote.
 */
function stub(rowsFor: (table: string) => any[]): { from: (t: string) => any } {
  return {
    from(table: string) {
      const rows = rowsFor(table);
      const chain: any = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: any) => void) => resolve({ data: rows, error: null });
          }
          return () => chain;
        },
      });
      return chain;
    },
  };
}

/* ── a whole read: the map is the map, and an unaskable id is still a key ──── */
{
  const sb = stub((t) => (t === 'check_ins' ? [{ user_id: ID_A, at: '2026-03-01T09:00:00Z' }] : []));
  const map = await fetchClientActivity(sb as any, [ID_A, ID_B, LOCAL]);

  eq(map[ID_A]?.length, 1, 'the client with a check-in has it');
  eq(map[ID_A]?.[0]?.kind, 'check_in', 'labelled by the table it came from');
  eq(map[ID_B]?.length, 0, 'a client who was asked about and is silent gets an empty array, not a missing key');
  ok(LOCAL in map, 'and so does an id the database was never asked about — its key is the only trace of it');
  ok(!isQueryableId(LOCAL) && isQueryableId(ID_B),
    'which is recoverable exactly, because the test that decided it is exported alongside');
}

/* ── a truncated read is refused rather than handed over short ─────────────── */
{
  // One row past the cap: the probe row `capLimit()` asks for, which is the only
  // way a full page and a cut one stop looking identical.
  const over = Array.from({ length: ROW_CAP + 1 }, () => ({ user_id: ID_A, performed_at: '2026-03-01T09:00:00Z' }));
  const sb = stub((t) => (t === 'workouts' ? over : []));

  let threw: unknown = null;
  try {
    await fetchClientActivity(sb as any, [ID_A, ID_B]);
  } catch (e) { threw = e; }

  ok(threw != null,
    'a map assembled from a prefix would report every client past the ceiling as silent, so there is no map');
  eq((threw as any)?.name, 'TruncatedRead', 'and it refuses as a truncated read, not as a generic failure');
  ok(String((threw as any)?.message ?? '').includes('training record'),
    'naming the set in words a coach could act on');

  // The other half of the contract: the read itself is not broken, and a caller
  // that wants the rows in order to LIST them can still have them — with the
  // fact attached. That is the distinction the wrapper collapses and this does
  // not.
  const read = await readClientActivity(sb as any, [ID_A, ID_B]);
  eq(read.truncated, true, 'the full read reports the ceiling rather than throwing at it');
  ok(read.byClient[ID_A].length > 0, 'and still carries the rows, which are real');
}

/* ── nobody to ask about ───────────────────────────────────────────────────── */
{
  const sb = stub(() => []);
  const read = await readClientActivity(sb as any, [LOCAL]);
  eq(read.notAsked.length, 1, 'a roster of one hand-added client is not a failed read');
  eq(read.truncated, false, 'and nothing was truncated, because nothing was asked');
  eq(read.byClient[LOCAL]?.length, 0, 'their entry is empty, and `notAsked` is what says that emptiness is not an answer');
}

/* ── a silence may not be claimed for longer than the record was read ──────
 *
 * `readClientActivity` reads `historyDays` back and no further. `observedDays`
 * runs from the day the client joined the coach's book and has no ceiling. A
 * client of two years who stopped training in June comes back with no events —
 * and the verdict used to print the SECOND number: "Nothing recorded in 730
 * days on your book", on the Clients list, on their client screen, in the
 * nudge card, and stored verbatim into `client_nudges.observed`. Seven hundred
 * of those days are days nobody looked at, and most of them are days that
 * client trained.
 */
{
  const NOW = Date.parse('2026-09-01T12:00:00Z');
  const old = assessDrift({ clientId: 'c', events: [], since: '2024-09-01T00:00:00Z' }, NOW);
  ok(old.observedDays != null && old.observedDays > DEFAULT_WINDOWS.historyDays,
    'the fixture is the case in question: on the book far longer than the read reaches back');
  ok(!new RegExp(`\\b${old.observedDays}\\b`).test(old.reason),
    'a two-year client silent for a fortnight is not described as two years of nothing');
  ok(new RegExp(`last ${DEFAULT_WINDOWS.historyDays} days`).test(old.reason),
    'the sentence names the window that was actually read');
  eq(old.readSpanDays, DEFAULT_WINDOWS.historyDays,
    'and the verdict carries that window, so a caller writing a message from it cannot exceed it either');

  // The wording this branch was written for survives: a genuinely new client
  // whose whole record IS inside the window.
  const fresh = assessDrift({ clientId: 'c', events: [], since: '2026-08-20T00:00:00Z' }, NOW);
  ok(/12 days on your book/.test(fresh.reason),
    'a client whose whole record fits inside the window is still described from the day they joined');
  const today = assessDrift({ clientId: 'c', events: [], since: '2026-09-01T06:00:00Z' }, NOW);
  ok(/since today/.test(today.reason),
    'and somebody added this morning is not charged with a gap they have not had time to leave');
}

if (errors.length) {
  console.error(`clientDrift: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
  process.exit(1);
}
console.log('clientDrift ok');

})();
