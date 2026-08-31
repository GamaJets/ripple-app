// Tests for readAll — the read that finishes rather than stopping at the cliff.
//
// src/lib/rowCap.ts already had the two honest answers to PostgREST's silent
// 1000-row ceiling: ask for one row more than you will accept, and then either
// refuse the figure (`assertWhole`) or keep the rows and carry the fact
// (`capped`). Both leave the SET short. That is the right trade for a
// tenant-wide read with no natural bound, and the wrong one for a read the
// caller has already bounded and genuinely needs all of — the class timetable,
// and the bookings hanging off it.
//
// The bookings read is why this exists. Bookings are counted PER CLASS, so a
// truncated read does not make a figure smaller: every class whose rows fell
// off the end reports `booked: 0` and `attended: 0`, which is a false statement
// about a named class on a named evening, and an owner reading it cancels the
// class. Refusing the whole timetable to avoid that would take a working screen
// away from every gym; reporting the zero is the lie. Finishing the read is the
// only answer that is neither.
//
// So these assertions are about the two ways a paginating loop silently loses
// rows, both of which have shipped in other codebases:
//
//   · it stops early, because it treated something other than a short page as
//     the end — most often a page that came back empty BECAUSE IT ERRORED;
//   · it never stops, because the predicate matches far more than the caller
//     imagined, and a browser tab dies looking like a slow network.
//
// The pages are a fake rather than a database. The thing under test is the loop
// — its bounds, its stop condition and its error handling — and a fake page
// function is the only way to assert the exact ranges it asks for.
//
// Compile with tsc then run with node, like wroteRows.test.ts.
import { readAll, TruncatedRead, ROW_CAP, PAGE_CEILING } from './rowCap';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A set of `total` numbered rows, served the way PostgREST serves `.range()`:
 *  inclusive bounds, and a page past the end is empty rather than an error. */
function table(total: number) {
  const asked: Array<[number, number]> = [];
  const rows = Array.from({ length: total }, (_, i) => i);
  return {
    asked,
    page: async (from: number, to: number) => {
      asked.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null as unknown };
    },
  };
}

/** Everything readAll returned, or the error it threw. */
async function run<T>(p: Promise<T[]>): Promise<{ rows: T[] | null; threw: unknown }> {
  try { return { rows: await p, threw: null }; } catch (e) { return { rows: null, threw: e }; }
}

async function main() {
  /* ── the whole set comes back, whatever its size ────────────────────────── */

  {
    const t = table(0);
    const { rows } = await run(readAll(t.page, 'classes', { pageSize: 10 }));
    eq(rows?.length, 0, 'an empty set reads as an empty set');
    eq(t.asked.length, 1, 'and costs exactly one round trip — the first short page is the end');
  }

  {
    const t = table(7);
    const { rows } = await run(readAll(t.page, 'classes', { pageSize: 10 }));
    eq(rows?.length, 7, 'a set smaller than one page comes back whole');
    eq(t.asked.length, 1, 'in one read');
    eq(JSON.stringify(t.asked[0]), '[0,9]',
      'and the range is INCLUSIVE at both ends, which is what PostgREST .range() means — asking [0,10] would read 11 rows a page and shift every page after it');
  }

  {
    const t = table(25);
    const { rows } = await run(readAll(t.page, 'classes', { pageSize: 10 }));
    eq(rows?.length, 25, 'a set spanning three pages comes back whole');
    eq(JSON.stringify(rows), JSON.stringify([...Array(25).keys()]),
      'IN ORDER AND WITHOUT DUPLICATES — a page that overlapped or skipped would still have the right length');
    eq(JSON.stringify(t.asked), '[[0,9],[10,19],[20,29]]',
      'and each page starts exactly where the last one ended');
  }

  /* ── the boundary that gets guessed wrong ──────────────────────────────── */
  //
  // A set whose size is an exact multiple of the page is the case where "the
  // page was full, so there may be more" and "the page was full, and that was
  // all of them" are indistinguishable without asking. The loop asks. One extra
  // empty round trip is the price of not guessing, and guessing here means
  // silently dropping every row of a set that happens to end on the boundary —
  // or, the other way, reporting a set as short when it was not.
  {
    const t = table(20);
    const { rows } = await run(readAll(t.page, 'classes', { pageSize: 10 }));
    eq(rows?.length, 20, 'a set that ends exactly on a page boundary comes back whole');
    eq(t.asked.length, 3, 'which costs one page past the end, because a full page is not proof of the end');
    eq(JSON.stringify(t.asked[2]), '[20,29]', 'and that page is the one after the last full one');
  }

  /* ── a page that failed is not the end of the set ──────────────────────── */
  //
  // This is the whole reason src/lib/rowCap.ts exists, reintroduced by the fix
  // for it. supabase-js RESOLVES on a database error, so a refused page arrives
  // as `data: null`. Read as "no rows", that is a short page, which is the stop
  // condition — and readAll would hand back the pages that did come as though
  // they were the whole set. Silent truncation, with pagination on top.
  {
    let n = 0;
    const boom = { message: 'statement timeout' };
    const page = async (from: number, to: number) => {
      n += 1;
      if (n === 2) return { data: null as number[] | null, error: boom };
      return { data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null as unknown };
    };
    const { rows, threw } = await run(readAll(page, 'classes', { pageSize: 10 }));
    eq(rows, null, 'A PAGE THAT ERRORED MUST NOT LOOK LIKE THE END OF THE SET');
    eq(threw, boom, 'and the database’s own error is what reaches the caller, so the screen can say what broke');
  }

  /* ── the runaway, which pagination invites ─────────────────────────────── */
  //
  // Removing the cliff removes the thing that used to stop a query nobody
  // bounded. A tenant filter dropped in an edit, or a date bound that parsed to
  // NaN, walks the whole table into a browser tab a page at a time — and it
  // looks like a slow network, not like a wrong query, so nobody goes looking.
  {
    const t = table(1_000_000);
    const { rows, threw } = await run(readAll(t.page, 'the door log', { pageSize: 10, ceiling: 35 }));
    eq(rows, null, 'a read past the ceiling refuses rather than walking the table');
    ok(threw instanceof TruncatedRead, 'and it refuses with the vocabulary the rest of the codebase already reads');
    eq((threw as TruncatedRead).what, 'the door log',
      'named in the owner’s words, because this message reaches a screen');
    eq((threw as TruncatedRead).cap, 35, 'and it says which ceiling was hit, not the row cap it is not');
    ok(t.asked.length <= 5, 'and it stops asking once it has — a ceiling that kept paging would not be one');
  }

  {
    // Exactly the ceiling is not over it. The ceiling says how many rows may be
    // accepted, so refusing a set that is complete at exactly that size would
    // be a false refusal — and the caller could not tell it from a real
    // runaway.
    const t = table(30);
    const { rows, threw } = await run(readAll(t.page, 'classes', { pageSize: 10, ceiling: 30 }));
    eq(threw, null, 'a set that is exactly the ceiling is not a runaway');
    eq(rows?.length, 30, 'and it comes back whole');
  }

  {
    // One row past it is, and this is the shape the guard is easiest to get
    // wrong on: ceiling + 1 rows arrive as full pages followed by a SHORT one,
    // so a ceiling tested after the end-of-set test never sees them.
    const t = table(31);
    const { rows, threw } = await run(readAll(t.page, 'classes', { pageSize: 10, ceiling: 30 }));
    eq(rows, null, 'ONE ROW PAST THE CEILING REFUSES — even though that row arrived on a short page');
    ok(threw instanceof TruncatedRead, 'and refuses in the same vocabulary as a runaway');
  }

  /* ── the defaults are the ones the callers rely on ─────────────────────── */

  {
    const t = table(3);
    await run(readAll(t.page, 'classes'));
    eq(JSON.stringify(t.asked[0]), `[0,${ROW_CAP - 1}]`,
      'the default page is the row cap itself — asking for more than PostgREST will return would make every page short, and every read one page long');
  }

  ok(PAGE_CEILING > ROW_CAP,
    'and the default ceiling is past the cap, or readAll would refuse the first set that needed it');

  {
    // A pageSize of zero or a negative one would make the loop ask for an empty
    // range forever. Clamped rather than trusted: the caller passing it is the
    // one who has already got the arithmetic wrong.
    const t = table(3);
    const { rows } = await run(readAll(t.page, 'classes', { pageSize: 0 }));
    eq(rows?.length, 3, 'a nonsense page size still terminates and still returns the whole set');
  }

  if (errors.length) {
    console.error(`readAll.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
    for (const e of errors.slice(0, 20)) console.error('  · ' + e);
    if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
    process.exit(1);
  }
  console.log('readAll.test.ts — ok');
}

// Awaited rather than floated: an unhandled rejection in here would print a
// warning and exit 0, which is a test file that cannot fail.
main().catch((e) => { console.error('readAll.test.ts — threw:', e); process.exit(1); });
