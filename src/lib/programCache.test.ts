// The coach's programme on the device. Compile with tsc, run with node.
//
// Five ways this makes a member's training worse rather than better, and one
// way it is simply not worth having:
//
//   1. A PLAN THAT COMES BACK FROM THE DEAD. A coach takes somebody off a
//      block. The read returns zero rows. If only non-empty answers are cached,
//      the next launch in a basement resurrects the removed plan and the member
//      trains a block their coach ended.
//
//   2. A PREFIX KEPT AS THE ANSWER. The read is capped. A coach with a large
//      book gets a page, and a page written to the device as the whole truth is
//      a member whose row was past the cap being told they have no programme —
//      by their own phone, offline, with nothing left to say otherwise.
//
//   3. A CORRUPT FILE READ AS AN EMPTY ONE. src/lib/readCache.ts's rule 1. If
//      unreadable bytes come back as "no assignments", the screen states as a
//      fact about the coach something it learnt from a damaged file.
//
//   4. THE CACHE BEATING A LIVE READ. It is a floor. A copy that overwrites a
//      read that actually landed is a member looking at last week's block with
//      this week's on the wire.
//
//   5. TWO PEOPLE, ONE PHONE. A shared device must not hand one member the
//      other's programme.
//
//   6. AND: a copy so old that the generic programme is the better answer.
import {
  PROGRAM_HORIZON_MS, mayCache, mayServeCached, packPrograms, programCacheKey,
  readPrograms, toCachedRows,
} from './programCache';
import type { Program } from './programs';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const prog = (title: string): Program => ({ title, focus: ['chest'], note: '', days: [] });
const NOW = Date.parse('2026-09-03T10:00:00.000Z');
const stamp = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/* ── 1 · an empty answer is an answer ─────────────────────────────────── */
{
  const bytes = packPrograms({}, {}, stamp(0));
  const back = readPrograms(bytes, NOW);
  eq(back.found, true, 'a read that returned no assignments is a real answer and is cached as one');
  eq(Object.keys(back.programs).length, 0, 'and it comes back empty');
  // The distinction the whole thing turns on: this is NOT the same as never
  // having written anything.
  eq(readPrograms(null, NOW).found, false, 'against never having written a copy at all');
}

/* ── 2 · a prefix is never kept ───────────────────────────────────────── */
{
  eq(mayCache(false), true, 'a whole page is written to the device');
  eq(mayCache(true), false, "a page that hit the row cap is not — nothing downstream will remember it was a prefix");
}

/* ── 3 · unreadable is not empty ──────────────────────────────────────── */
{
  for (const bad of ['', 'not json', '{}', '{"rows":"nope","at":"x"}', '[]', 'null']) {
    eq(readPrograms(bad, NOW).found, false, `unreadable bytes (${JSON.stringify(bad)}) are not an empty programme list`);
  }
  // A stamp that cannot be parsed is refused too: without one there is no way
  // to age the copy, and an unaged copy is the failure readCache.ts exists for.
  eq(readPrograms(JSON.stringify({ rows: [], at: 'whenever' }), NOW).found, false, 'a copy with no readable stamp cannot be aged, so it is not served');
}

/* ── 4 · never over a live read ───────────────────────────────────────── */
{
  eq(mayServeCached(false, true), true, 'the copy is drawn when no read has landed');
  eq(mayServeCached(true, true), false, 'and never over a read that did land');
  eq(mayServeCached(false, false), false, 'and not at all when there is no copy');
}

/* ── 5 · two people, one phone ────────────────────────────────────────── */
{
  const a = programCacheKey('11111111-1111-1111-1111-111111111111');
  const b = programCacheKey('22222222-2222-2222-2222-222222222222');
  ok(a !== b, 'two accounts on one phone do not share a key');
  ok(a.includes('11111111-1111-1111-1111-111111111111'), 'and the key carries the account it is for');
}

/* ── 6 · the horizon ──────────────────────────────────────────────────── */
{
  const bytes = packPrograms({ c1: prog('Block A') }, {}, stamp(PROGRAM_HORIZON_MS - 60_000));
  eq(readPrograms(bytes, NOW).found, true, 'a copy inside the horizon is served');
  const old = packPrograms({ c1: prog('Block A') }, {}, stamp(PROGRAM_HORIZON_MS + 60_000));
  eq(readPrograms(old, NOW).found, false, 'and one past it is not — after a month the generic programme is the better answer');
  // The number itself, stated: a training block runs weeks, so a week-long
  // horizon would take somebody's plan away in week two of an eight-week block.
  ok(PROGRAM_HORIZON_MS > 21 * 24 * 60 * 60 * 1000, 'the horizon outlasts a normal training block');
}

/* ── the round trip ───────────────────────────────────────────────────── */
{
  const programs = { c2: prog('Second'), c1: prog('First') };
  const startsOn = { c1: '2026-09-07' };
  const back = readPrograms(packPrograms(programs, startsOn, stamp(60_000)), NOW);
  eq(back.programs.c1?.title, 'First', 'the programme survives the round trip');
  eq(back.programs.c2?.title, 'Second', 'for every client on it');
  eq(back.startsOn.c1, '2026-09-07', 'and so does the start date the coach set');
  eq(Object.prototype.hasOwnProperty.call(back.startsOn, 'c2'), false, 'a client with no start date has no entry, which is how "the coach did not say" is spelled');
}

/* ── the shape written ────────────────────────────────────────────────── */
{
  const rows = toCachedRows({ b: prog('B'), a: prog('A') }, { a: '2026-01-01', zz: '2026-02-02' });
  eq(rows.map((r) => r.clientId).join(','), 'a,b', 'rows are ordered by client id, so identical data writes identical bytes');
  eq(rows[0]?.startsOn, '2026-01-01', 'a start date rides with the assignment it belongs to');
  eq(rows[1]?.startsOn, null, 'and is explicitly null rather than absent, because undefined does not survive JSON');
  eq(rows.length, 2, 'a start date for somebody with no programme is not a row — there is no block for it to be week one of');
}

/* ── a row this build cannot read costs only itself ───────────────────── */
{
  const raw = JSON.stringify({
    rows: [
      { clientId: 'good', program: prog('Kept'), startsOn: null },
      { clientId: 'no-program', startsOn: '2026-01-01' },
      { program: prog('No id'), startsOn: null },
      null,
      'nonsense',
    ],
    at: stamp(60_000),
  });
  const back = readPrograms(raw, NOW);
  eq(back.found, true, 'a file with one bad row is still a file');
  eq(Object.keys(back.programs).join(','), 'good', 'and the member keeps the rows that can be read rather than losing all of them');
}

/* ── a clock that has been changed ────────────────────────────────────── */
{
  const future = packPrograms({ c1: prog('Block') }, {}, new Date(NOW + 86_400_000).toISOString());
  eq(readPrograms(future, NOW).found, true, "a stamp in the future is a phone whose clock moved, and must not cost the member their only copy");
}

if (errors.length) {
  console.error(`programCache: ${errors.length} failure(s)`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('programCache: ok');
