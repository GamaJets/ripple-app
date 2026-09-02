// Tests for idLookup — the `.in()` that does not quietly go short.
//
// ── What this is protecting ────────────────────────────────────────────────
//
// Half the reads in the console are two queries: fetch a set of rows, then go
// and get the names for the ids on them. The second query was always a single
// `.in('id', unique)`, and it was safe for a reason that has now been taken
// away — the read above it refused past a thousand rows, so it could never be
// handed more than a thousand ids, and PostgREST's thousand-row ceiling was
// therefore out of reach.
//
// src/lib/gymRecord.ts, /accounting and /close now page those reads to the end.
// A bare `.in()` behind a paged read fails twice over and says nothing either
// time: it comes back with the first thousand names of five thousand, and the
// query string carrying five thousand uuids is 200KB, which a gateway rejects
// with an error nowhere near the code that caused it. The first is the worse
// one. A reconciliation with two thirds of its rows unnamed does not look
// broken; it looks like a gym that never recorded who it billed.
//
// So the assertions below are about the three ways a chunked lookup silently
// loses rows:
//
//   · an id is dropped between chunks, or sent twice and counted twice;
//   · a chunk whose answer is longer than its id list is truncated, which is
//     every lookup on a NON-unique key — `gym_payments.gym_order_id` is a
//     foreign key, so one order can be answered by several payments;
//   · a chunk errors and the caller hands back the chunks that did come as
//     though they were the whole set.
//
// The pages are a fake rather than a database, for the same reason
// readAll.test.ts uses one: the thing under test is the chunking and the loop
// around it, and a fake is the only way to assert the exact id lists and ranges
// it asks for.
//
// Compile with tsc then run with node, like readAll.test.ts.
import { readByIds, uniqueIds, chunkIds, ID_CHUNK } from './idLookup';
import { TruncatedRead, ROW_CAP } from './rowCap';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** `n` ids, distinct and shaped like the uuids these lookups really carry. */
const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

/**
 * A fake table keyed by id, served the way PostgREST serves `.in()` + `.range()`.
 *
 * `answers` says how many rows each id is worth, so a lookup on a non-unique
 * key — several payments against one order — can be simulated.
 */
function table(answers: (id: string) => number = () => 1) {
  const asked: Array<{ chunk: string[]; from: number; to: number }> = [];
  return {
    asked,
    /** Every id this fake was ever asked about, in the order it was asked. */
    seen: () => asked.flatMap((a) => a.chunk),
    page: async (chunk: string[], from: number, to: number) => {
      asked.push({ chunk, from, to });
      const rows: Array<{ id: string; n: number }> = [];
      for (const id of chunk) {
        for (let n = 0; n < answers(id); n++) rows.push({ id, n });
      }
      return { data: rows.slice(from, to + 1), error: null as unknown };
    },
  };
}

async function run<T>(p: Promise<T>): Promise<{ value: T | null; threw: unknown }> {
  try { return { value: await p, threw: null }; } catch (e) { return { value: null, threw: e }; }
}

async function main() {
  /* ── uniqueIds: the list the caller meant ───────────────────────────────── */

  {
    const got = uniqueIds(['a', 'b', 'a', null, undefined, '', 'c', 'b']);
    eq(JSON.stringify(got), JSON.stringify(['a', 'b', 'c']),
      'duplicates collapse, blanks and nulls fall out, first-seen order survives');
  }

  {
    // Order is kept rather than sorted, so a caller reasoning about which chunk
    // an id landed in gets the same answer twice running.
    const got = uniqueIds(['z', 'a', 'm']);
    eq(JSON.stringify(got), JSON.stringify(['z', 'a', 'm']), 'the list is not sorted behind the caller');
  }

  eq(uniqueIds([]).length, 0, 'nothing in, nothing out');
  eq(uniqueIds([null, undefined, '']).length, 0, 'a list of blanks is an empty list, not a list of one blank');

  /* ── chunkIds: every id in exactly one chunk ────────────────────────────── */

  {
    const chunks = chunkIds(ids(350), 150);
    eq(chunks.length, 3, '350 ids at 150 is three chunks');
    eq(chunks[0].length, 150, 'the first chunk is full');
    eq(chunks[2].length, 50, 'and the last carries the remainder rather than being padded');
    const flat = chunks.flat();
    eq(flat.length, 350, 'no id is dropped between chunks');
    eq(new Set(flat).size, 350, 'and none is sent twice');
  }

  {
    const chunks = chunkIds(ids(300), 150);
    eq(chunks.length, 2, 'an exact multiple does not produce a trailing empty chunk');
  }

  eq(chunkIds([], 150).length, 0,
    'no ids is no chunks — one empty chunk would send an `in.()` that matches nothing');

  {
    // A size of zero or a negative one would slice forever. Clamped rather than
    // trusted: the caller passing it has already got the arithmetic wrong.
    const chunks = chunkIds(ids(3), 0);
    eq(chunks.length, 3, 'a nonsense chunk size still terminates');
    eq(chunks.flat().length, 3, 'and still carries every id');
  }

  /* ── the chunk size has to fit in a query string ────────────────────────── */

  {
    // A uuid inside `in.("…","…")` costs 39 bytes with its quotes and comma.
    // 8KB is the request-line limit nginx and most CDNs enforce by default, and
    // the table, select list and tenant filter travel beside the ids.
    const bytes = ID_CHUNK * 39;
    ok(bytes < 6000,
      `a full chunk is ${bytes} bytes of query string, which leaves too little room under the 8KB request line`);
    ok(ID_CHUNK <= ROW_CAP,
      'a chunk larger than the row cap could truncate on a unique key before paging ever helped');
  }

  /* ── readByIds: every id asked about exactly once ───────────────────────── */

  {
    const t = table();
    const { value } = await run(readByIds(ids(350), t.page, 'names', { chunk: 150 }));
    eq(value?.length, 350, 'every id that matched a row comes back');
    eq(t.seen().length, 350, 'and each was asked about exactly once');
    eq(new Set(t.seen()).size, 350, 'no id is asked about twice');
    // Three chunks, each a single short page — the fake answers one row per id,
    // so no chunk reaches the page size and none costs a second round trip.
    eq(t.asked.length, 3, 'a chunk that fits is one request, not two');
  }

  {
    const t = table();
    const { value } = await run(readByIds(['a', 'a', null, 'b'], t.page, 'names'));
    eq(value?.length, 2, 'the ids are deduplicated before they are chunked');
    eq(JSON.stringify(t.seen()), JSON.stringify(['a', 'b']), 'and the blank is never sent');
  }

  {
    const t = table();
    const { value } = await run(readByIds([], t.page, 'names'));
    eq(value?.length, 0, 'no ids is an empty answer');
    eq(t.asked.length, 0, 'and costs no round trip at all');
  }

  {
    const t = table();
    const { value } = await run(readByIds([null, undefined, ''], t.page, 'names'));
    eq(value?.length, 0, 'a list of blanks is an empty answer');
    eq(t.asked.length, 0, 'and is not sent as an `in.()` matching everything or nothing');
  }

  /* ── a chunk bigger than its id list is still finished ──────────────────── */

  {
    // The non-unique-key case, and the one a plain `.in()` gets wrong without
    // ever looking wrong. One chunk of 150 ids where the first id is answered
    // by 2500 rows: the chunk is far past PostgREST's ceiling even though the
    // id list is nowhere near it.
    const t = table((id) => (id === ids(1)[0] ? 2500 : 1));
    const { value } = await run(readByIds(ids(150), t.page, 'the ledger entries', { chunk: 150 }));
    eq(value?.length, 2500 + 149, 'a chunk whose answer overruns the page size is paged to the end');
    ok(t.asked.length > 1, 'which took more than one request, as it must have');
    eq(t.asked[0].from, 0, 'the first page starts at 0');
    eq(t.asked[1].from, ROW_CAP, 'and the second picks up exactly where it stopped');
  }

  /* ── a failed chunk is never a short answer ─────────────────────────────── */

  {
    // supabase-js RESOLVES on a database error, so a failed chunk arrives as
    // `data: null`. Handing back the chunks that did come would be the exact
    // silent truncation this file exists to prevent, rebuilt one level up.
    let call = 0;
    const boom = { message: 'permission denied for table profiles' };
    const page = async (chunk: string[], _from: number, _to: number) => {
      call += 1;
      if (call === 2) return { data: null, error: boom as unknown };
      return { data: chunk.map((id) => ({ id })), error: null as unknown };
    };
    const { value, threw } = await run(readByIds(ids(350), page, 'names', { chunk: 150 }));
    eq(value, null, 'a chunk that failed does not come back as a shorter list');
    eq(threw, boom, 'the database error is the one that reaches the caller');
  }

  {
    // And the ceiling still applies per chunk: a predicate that matched far
    // more than the caller imagined must stop rather than walk a table into a
    // browser tab.
    const t = table(() => 3000);
    const { value, threw } = await run(
      readByIds(ids(20), t.page, 'the ledger entries', { chunk: 20 }),
    );
    eq(value, null, 'a runaway chunk does not return a prefix');
    ok(threw instanceof TruncatedRead, 'it refuses, and says which set it refused');
    ok(String((threw as Error)?.message ?? '').includes('the ledger entries'),
      'in the caller’s own words, because this message can reach a gym owner');
  }

  if (errors.length) {
    console.error(`idLookup.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors.slice(0, 20)) console.error('  · ' + e);
    if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
    process.exit(1);
  }
  console.log('idLookup.test.ts — ok');
}

// Awaited rather than floated: an unhandled rejection in here would print a
// warning and exit 0, which is a test file that cannot fail.
main().catch((e) => { console.error('idLookup.test.ts — threw:', e); process.exit(1); });
