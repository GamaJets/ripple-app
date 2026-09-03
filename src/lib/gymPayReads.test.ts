// The two payroll reads that used to refuse, and the two lookups behind them.
//
// ── What this is protecting ────────────────────────────────────────────────
//
// `fetchClassPay` and `fetchAdjustments` were both `.limit(capLimit())` plus
// `assertWhole`, tenant-wide with no date bound. A settled pay line is stamped,
// never deleted, so twenty classes a week crosses a thousand lines inside a
// year and the read threw from then on — permanently, because no gym can make
// its own history shorter. /payroll reads both inside one `Promise.allSettled`
// that builds every coach's run, so the refusal did not cost the gym one
// figure: it cost the gym the screen. Nobody could be paid from the console at
// all, including the coaches whose own lines were nowhere near the cap.
//
// The assertions below are about the four ways the paged version could
// reintroduce that quietly:
//
//   · it stops at the first page and hands back a prefix as the whole set;
//   · it pages the rows but leaves `classDatesFor` and `namesFor` on a single
//     `.in()`, which was safe only while the read above refused past a thousand
//     — past that a class-pay line comes back UNDATED, and `scopedToRun` drops
//     an undated line out of the run, so a coach silently loses the money;
//   · it orders on `created_at` or `applies_on` alone, which is not a total
//     order and lets pages drop and repeat rows (see src/lib/rowCap.ts);
//   · a page that errors is treated as the end of the set.
//
// The database is a fake, for the same reason readAll.test.ts and
// idLookup.test.ts use one: what is under test is the loop and the query it
// builds, and a fake is the only way to assert the exact ranges and id lists
// asked for. Compile with tsc, run with node.
import { fetchClassPay, fetchAdjustments } from './gymPay';
import { ROW_CAP } from './rowCap';
import { ID_CHUNK } from './idLookup';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** One query as the fake saw it being built. */
interface Asked {
  table: string;
  orders: string[];
  range: [number, number] | null;
  in: string[] | null;
}

/**
 * A chainable stand-in for the supabase-js query builder.
 *
 * `answer` is handed the finished query and returns what PostgREST would.
 * Everything is recorded so the ordering clauses and the id chunks can be
 * asserted rather than assumed — the ordering is the half of the `readAll`
 * contract a caller can silently break with no visible symptom.
 */
function fakeSb(answer: (q: Asked) => { data: any[] | null; error: unknown }) {
  const asked: Asked[] = [];
  const from = (table: string) => {
    const q: Asked = { table, orders: [], range: null, in: null };
    asked.push(q);
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      limit: () => chain,
      order: (col: string, o?: { ascending?: boolean }) => {
        q.orders.push(`${col}:${o?.ascending === false ? 'desc' : 'asc'}`);
        return chain;
      },
      in: (_col: string, ids: string[]) => { q.in = ids; return chain; },
      range: (a: number, b: number) => { q.range = [a, b]; return chain; },
      then: (res: (v: { data: any[] | null; error: unknown }) => unknown) => res(answer(q)),
    };
    // `.in()` without `.range()` is awaited directly by the lookups, so the
    // chain has to be thenable at every point, not only after `.range()`.
    return chain;
  };
  return { sb: { from } as any, asked };
}

/** `n` distinct uuid-shaped ids, as the real rows carry. */
const ids = (n: number, tag: string): string[] =>
  Array.from({ length: n }, (_, i) => `${tag}-0000-4000-8000-${String(i).padStart(12, '0')}`);

async function main() {
  /* ── fetchClassPay pages to the end ────────────────────────────────────────── */
  {
    const N = ROW_CAP * 2 + 7;
    const classIds = ids(N, 'c1a55');
    const rows = Array.from({ length: N }, (_, i) => ({
      id: `pay-${i}`, class_id: classIds[i], trainer_id: i % 2 ? 't1' : 't2',
      pay_kind: 'per_class', rate_cents: 2500, attendees: null, amount_cents: 2500,
      currency: 'GBP', settlement_id: null, created_at: '2026-08-01T09:00:00Z',
    }));

    const { sb, asked } = fakeSb((q) => {
      if (q.table === 'gym_class_pay') {
        const [a, b] = q.range ?? [0, ROW_CAP - 1];
        return { data: rows.slice(a, b + 1), error: null };
      }
      if (q.table === 'gym_classes') {
        return {
          data: (q.in ?? []).map((id) => ({ id, starts_at: '2026-08-04T18:00:00Z' })),
          error: null,
        };
      }
      return { data: (q.in ?? []).map((id) => ({ id, full_name: `Coach ${id}` })), error: null };
    });

    const out = await fetchClassPay(sb, 'gym');
    eq(out.length, N, 'every class-pay line comes back, not the first page of them');
    eq(out[N - 1].id, `pay-${N - 1}`, 'and the last one is the last one, in order');

    const pay = asked.filter((q) => q.table === 'gym_class_pay');
    eq(pay.length, 3, 'a set of 2007 rows is read as three pages, the last one short');
    eq(pay[0].orders.join(','), 'created_at:desc,id:desc',
      'the read is ordered totally — `created_at` alone ties, and tied pages drop and repeat rows silently');
    eq(pay[1].range?.[0], ROW_CAP, 'the second page starts where the first ended');

    const dates = asked.filter((q) => q.table === 'gym_classes');
    eq(dates.length, Math.ceil(N / ID_CHUNK),
      'the class dates are looked up in chunks — one `.in()` of 2007 ids truncates and 414s, both in silence');
    ok(dates.every((q) => (q.in ?? []).length <= ID_CHUNK), 'and no chunk is bigger than the chunk size');
    eq(new Set(dates.flatMap((q) => q.in ?? [])).size, N, 'every class id is asked about exactly once');
    ok(out.every((r) => r.taughtOn === '2026-08-04'),
      'so every line is dated — an undated line is dropped from the run by `scopedToRun`, which is a coach not paid');
  }

  /* ── fetchAdjustments pages to the end ─────────────────────────────────────── */
  {
    const N = ROW_CAP + 1;
    const rows = Array.from({ length: N }, (_, i) => ({
      id: `adj-${i}`, trainer_id: 't1', kind: 'bonus', amount_cents: 1000,
      currency: 'GBP', note: 'cover', applies_on: '2026-08-01', settlement_id: null,
    }));
    const { sb, asked } = fakeSb((q) => {
      if (q.table === 'payroll_adjustments') {
        const [a, b] = q.range ?? [0, ROW_CAP - 1];
        return { data: rows.slice(a, b + 1), error: null };
      }
      return { data: (q.in ?? []).map((id) => ({ id, full_name: 'Ana' })), error: null };
    });

    const out = await fetchAdjustments(sb, 'gym');
    eq(out.length, N, 'one adjustment past the cap no longer takes the whole payroll screen down');
    const adj = asked.filter((q) => q.table === 'payroll_adjustments');
    eq(adj[0].orders.join(','), 'applies_on:desc,id:desc',
      '`applies_on` is a DATE, so a batch filed on the first of the month is entirely tied without `id`');
    eq(out[0].trainerName, 'Ana', 'and the names still arrive');
  }

  /* ── a page that errors is not the end of the set ──────────────────────────── */
  {
    const { sb } = fakeSb((q) => {
      if (q.table !== 'gym_class_pay') return { data: [], error: null };
      const [a] = q.range ?? [0, 0];
      if (a > 0) return { data: null, error: { message: 'refused' } };
      return {
        data: Array.from({ length: ROW_CAP }, (_, i) => ({
          id: `pay-${i}`, class_id: null, trainer_id: 't1', pay_kind: 'per_class',
          rate_cents: 1, attendees: null, amount_cents: 1, currency: 'GBP',
          settlement_id: null, created_at: '2026-08-01T09:00:00Z',
        })),
        error: null,
      };
    });
    let threw = false;
    try { await fetchClassPay(sb, 'gym'); } catch { threw = true; }
    ok(threw, 'a refused second page throws rather than handing back the first as the whole set');
  }

  /* ── a lookup that fails leaves the amount, not an exception ───────────────── */
  {
    const { sb } = fakeSb((q) => {
      if (q.table === 'gym_class_pay') {
        return {
          data: q.range?.[0] ? [] : [{
            id: 'pay-1', class_id: 'k1', trainer_id: 't1', pay_kind: 'per_class',
            rate_cents: 4200, attendees: null, amount_cents: 4200, currency: 'GBP',
            settlement_id: null, created_at: '2026-08-01T09:00:00Z',
          }],
          error: null,
        };
      }
      // Both lookups refuse. supabase-js resolves on a database error, so this is
      // what a refused `.in()` really looks like to the caller.
      return { data: null, error: { message: 'refused' } };
    });
    const out = await fetchClassPay(sb, 'gym');
    eq(out.length, 1, 'a name or date that could not be read does not delete the pay line');
    eq(out[0].trainerName, null, 'the coach renders as a dash');
    eq(out[0].taughtOn, null, 'and the line is reported undated rather than dated at the epoch');
    eq(out[0].amountCents, 4200, 'while the amount, which was read, is still the amount');
  }

  if (errors.length) {
    console.error(`gymPayReads: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
    process.exit(1);
  }
  console.log('gymPayReads ok');
}

// Awaited rather than floated: an unhandled rejection in here would print a
// warning and exit 0, which is a test file that cannot fail.
main().catch((e) => { console.error('gymPayReads — threw:', e); process.exit(1); });
