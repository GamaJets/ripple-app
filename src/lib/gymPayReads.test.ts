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
// And one downstream of all four. `stampRunExtras` takes its ids straight off
// the paged read's result and sent every one of them in a single `.in()` inside
// a PATCH — so the same lifted cap that unbounded the lookups unbounded a WRITE
// as well, and that one fails after `recordSettlement` has already recorded the
// run. The gym pays, the lines stay unstamped, and next month's run pays for
// the same classes again.
//
// And one more, which is not about paging at all and is the reason this file
// went red under TZ=Pacific/Kiritimati: `taughtOn` was cut on the READER's
// clock, so which payroll run a class-pay line lands on depended on which
// country the console was open in. See `classDatesFor` in src/lib/gymPay.ts.
// Every assertion about a date in here is now made against a named zone or
// against an independent oracle, never against a hand-written literal that is
// only a UTC slice wearing a date's clothes.
//
// The database is a fake, for the same reason readAll.test.ts and
// idLookup.test.ts use one: what is under test is the loop and the query it
// builds, and a fake is the only way to assert the exact ranges and id lists
// asked for. Compile with tsc, run with node.
import { fetchClassPay, fetchAdjustments, scopedToRun, stampRunExtras } from './gymPay';
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
  /** The patch a write carried, or undefined for a read. */
  update?: Record<string, unknown>;
  /** Whether the write asked PostgREST to count the rows it changed. */
  counted?: boolean;
}

/**
 * A chainable stand-in for the supabase-js query builder.
 *
 * `answer` is handed the finished query and returns what PostgREST would.
 * Everything is recorded so the ordering clauses and the id chunks can be
 * asserted rather than assumed — the ordering is the half of the `readAll`
 * contract a caller can silently break with no visible symptom.
 */
function fakeSb(answer: (q: Asked) => { data: any[] | null; error: unknown; count?: number | null }) {
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
      // Writes, for `stampRunExtras` at the bottom of this file. Recorded
      // rather than ignored so an assertion can say WHICH ids one PATCH
      // carried — the whole question there is how many go in one request.
      update: (patch: Record<string, unknown>, o?: { count?: string }) => {
        q.update = patch; q.counted = o?.count === 'exact'; return chain;
      },
      then: (res: (v: { data: any[] | null; error: unknown; count?: number | null }) => unknown) => res(answer(q)),
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

/**
 * The instant every class in the paging fixture starts at.
 *
 * Six in the evening UTC on the 4th, which is the 4th in London and the 5th in
 * Kiritimati — deliberately, because this assertion used to be the literal
 * '2026-08-04' and that literal is a UTC date slice with a date's clothes on.
 * It passed in every zone from UTC-18 to UTC+6 and went red at UTC+14, which is
 * the suite finding the bug rather than the suite being flaky.
 */
const CLASS_AT = '2026-08-04T18:00:00Z';

/**
 * The calendar day an instant falls on WHERE THIS PROCESS IS, `YYYY-MM-DD`.
 *
 * An oracle for the reader-basis fallback, and deliberately NOT `isoDate` —
 * asserting the code's output against the code's own implementation would pass
 * for any implementation, including the UTC slice this test exists to forbid.
 * `Intl` with no `timeZone` reads the ambient zone through a different code
 * path, so the two agreeing is evidence.
 *
 * No locale literal (scripts/check-locale.mjs forbids one), and the parts are
 * padded by hand for the reason `gymDay` gives.
 */
function readerDay(at: string): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year').padStart(4, '0')}-${get('month').padStart(2, '0')}-${get('day').padStart(2, '0')}`;
}

/** One class-pay line, dated from `starts_at`, read with `zone` as the gym's. */
async function oneLineDated(startsAt: string, zone: string | null) {
  const { sb } = fakeSb((q) => {
    if (q.table === 'gym_class_pay') {
      return {
        data: q.range?.[0] ? [] : [{
          id: 'pay-1', class_id: 'k1', trainer_id: 't1', pay_kind: 'per_class',
          rate_cents: 3000, attendees: null, amount_cents: 3000, currency: 'GBP',
          settlement_id: null, created_at: '2026-09-02T09:00:00Z',
        }],
        error: null,
      };
    }
    if (q.table === 'gym_classes') {
      return { data: (q.in ?? []).map((id) => ({ id, starts_at: startsAt })), error: null };
    }
    return { data: (q.in ?? []).map((id) => ({ id, full_name: 'Ana' })), error: null };
  });
  return (await fetchClassPay(sb, 'gym', zone))[0];
}

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
          data: (q.in ?? []).map((id) => ({ id, starts_at: CLASS_AT })),
          error: null,
        };
      }
      return { data: (q.in ?? []).map((id) => ({ id, full_name: `Coach ${id}` })), error: null };
    });

    const out = await fetchClassPay(sb, 'gym', null);
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
    ok(out.every((r) => r.taughtOn === readerDay(CLASS_AT)),
      'so every line is dated — an undated line is dropped from the run by `scopedToRun`, which is a coach not paid');
    ok(out.every((r) => r.taughtOnBasis === 'reader'),
      'and with no gym zone passed, every line says out loud whose calendar it was cut on');
  }

  /* ── whose calendar a class-pay line is dated on ───────────────────────────── */
  //
  // The month edge, which is the boundary that costs money. 21:00Z on 31 August
  // is still 31 August in London, already 1 September in Dubai, and still 31
  // August in Los Angeles. One row, three gyms, three different answers, and
  // only one of them is the answer for any given gym.
  //
  // This was computed with `isoDate`, which reads the LOCAL getters — so the
  // answer was whichever of the three the READER happened to be standing in,
  // and the gym's own timezone, which `tenants.timezone` has held since
  // supabase/parts/710, was never consulted at all.
  {
    const EDGE = '2026-08-31T21:00:00Z';
    const AUG = { fromDate: '2026-08-01', toDate: '2026-08-31' };

    const london = await oneLineDated(EDGE, 'Europe/London');
    eq(london.taughtOn, '2026-08-31', 'the London gym taught that class on the 31st of August');
    eq(london.taughtOnBasis, 'gym', 'and the line says the gym’s own calendar decided it');

    const dubai = await oneLineDated(EDGE, 'Asia/Dubai');
    eq(dubai.taughtOn, '2026-09-01', 'the Dubai gym taught the same instant on the 1st of September');

    const la = await oneLineDated(EDGE, 'America/Los_Angeles');
    eq(la.taughtOn, '2026-08-31', 'and the Los Angeles gym on the 31st');

    // Whatever zone this process is in, none of the three moved with it. That is
    // the whole fix: a payroll run is not read differently in a different airport.
    ok([london, dubai, la].every((r) => r.taughtOnBasis === 'gym'),
      'none of the three fell back to the machine the console is open on');

    // What the date decides. August's run pays London's class and must not pay
    // Dubai's — Dubai's is September's cost, on September's run, stamped with
    // September's `period_from`, which is what /accounting and the coach's own
    // earnings screen both read back.
    eq(scopedToRun([london], (r) => r.taughtOn, AUG).length, 1,
      'so August’s run pays the London class');
    eq(scopedToRun([dubai], (r) => r.taughtOn, AUG).length, 0,
      'and does not pay the Dubai one, which belongs to September and has September’s run coming');

    // The far-eastern failure in the other direction, which is worse than being
    // paid against the wrong month. Read on a UTC+14 device with no gym zone,
    // this class is dated into September and `runScopeOf` calls it 'later' —
    // off August's run, off September's too once it is settled elsewhere, and
    // nowhere on screen saying a line went missing.
    const kiritimati = await oneLineDated(EDGE, 'Pacific/Kiritimati');
    eq(kiritimati.taughtOn, '2026-09-01', 'a gym that really is at UTC+14 is genuinely into September');
    eq(scopedToRun([kiritimati], (r) => r.taughtOn, AUG).length, 0, 'and is genuinely not on August’s run');

    // A gym with no zone still gets dated lines rather than none. Refusing would
    // leave every line 'undated', and `scopedToRun` drops those — a blank
    // settings field would stop the gym paying anybody at all.
    const blank = await oneLineDated(EDGE, null);
    eq(blank.taughtOn, readerDay(EDGE), 'a gym that has set no zone falls back to the reader’s day');
    eq(blank.taughtOnBasis, 'reader', 'and says so, so the screen can print `whoseClockNote` beside the run');
    const junk = await oneLineDated(EDGE, 'EST');
    eq(junk.taughtOnBasis, 'reader',
      'a stored value this runtime cannot resolve is a gym with no zone, not a crash and not a guess');
  }

  /* ── what a stored line actually says once it is read back ─────────────────
   *
   * Everything above this asserts the SHAPE of the reads — the ranges, the
   * ordering, the id chunks, the date basis — and every fixture in it uses the
   * same row: `per_class`, 3000, 3000, no register. So the mapping from
   * database row to money was pinned by nothing: `pay_kind` could be read
   * inverted, and `rate_cents` and `amount_cents` could fall back to any figure
   * at all when the column came back unreadable, and every assertion in this
   * file would still pass.
   *
   * This is the payroll line a coach is paid from. It is snapshotted at the
   * moment the class is added and never recomputed, precisely so that a rate
   * changed in March cannot rewrite what somebody was paid in January — which
   * means the read is the only thing standing between the stored figure and the
   * screen, and a wrong reading here is not caught anywhere downstream. */
  {
    const readOne = async (row: Record<string, unknown>) => {
      const { sb } = fakeSb((q) => {
        if (q.table === 'gym_class_pay') {
          return {
            data: q.range?.[0] ? [] : [{
              id: 'pay-1', class_id: 'k1', trainer_id: 't1', pay_kind: 'per_class',
              rate_cents: 3000, attendees: null, amount_cents: 3000, currency: 'GBP',
              settlement_id: null, created_at: '2026-09-02T09:00:00Z', ...row,
            }],
            error: null,
          };
        }
        if (q.table === 'gym_classes') return { data: (q.in ?? []).map((id) => ({ id, starts_at: CLASS_AT })), error: null };
        return { data: (q.in ?? []).map((id) => ({ id, full_name: 'Ana' })), error: null };
      });
      return (await fetchClassPay(sb, 'gym', 'Europe/London'))[0];
    };

    // The two kinds, both ways round. "80" flat and "8 a head" are the same
    // digits and completely different money — the distinction `payRateBlocker`
    // refuses to let an owner leave unstated — so reading it back inverted
    // would undo that on the way out.
    const perClass = await readOne({ pay_kind: 'per_class', rate_cents: 8000, amount_cents: 8000, attendees: null });
    eq(perClass.payKind, 'per_class', 'a flat line reads back as a flat line');
    eq(perClass.rateCents, 8000, 'at the rate it was stamped with');
    eq(perClass.amountCents, 8000, 'and for the amount it was stamped with');
    eq(perClass.attendees, null, 'with no headcount, because a flat class does not have one');

    const perHead = await readOne({ pay_kind: 'per_attendee', rate_cents: 800, amount_cents: 9600, attendees: 12 });
    eq(perHead.payKind, 'per_attendee', 'and a per-head line reads back as per-head');
    eq(perHead.rateCents, 800, 'at its own rate');
    eq(perHead.attendees, 12, 'with the register that was taken');
    // The amount is the SNAPSHOT, never rate × register recomputed at read
    // time. A register corrected after the coach was paid must not silently
    // restate what they were paid.
    eq(perHead.amountCents, 9600, 'and for the amount stamped at the time, not for what the numbers beside it would multiply to now');

    // A `pay_kind` the enum does not cover is a flat line, which is the safe
    // reading: it pays the rate once rather than once per person.
    eq((await readOne({ pay_kind: 'per_head' })).payKind, 'per_class',
      'a kind this build does not know is read as flat rather than multiplied by a register');

    // The columns are NOT NULL, so a null here means the read itself brought
    // back something unusable — and the only safe figure for money nobody can
    // read is nothing. Any other fallback is the app inventing a payment.
    const unreadable = await readOne({ rate_cents: null, amount_cents: null });
    eq(unreadable.rateCents, 0, 'a rate that came back unreadable is nought rather than a number this file made up');
    eq(unreadable.amountCents, 0, 'and so is an amount — money nobody can read is not money somebody is owed');
    eq((await readOne({ amount_cents: 'lots' })).amountCents, 0, 'including one that is not a number at all');
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
    try { await fetchClassPay(sb, 'gym', null); } catch { threw = true; }
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
    const out = await fetchClassPay(sb, 'gym', null);
    eq(out.length, 1, 'a name or date that could not be read does not delete the pay line');
    eq(out[0].trainerName, null, 'the coach renders as a dash');
    eq(out[0].taughtOn, null, 'and the line is reported undated rather than dated at the epoch');
    eq(out[0].amountCents, 4200, 'while the amount, which was read, is still the amount');
  }

  /* ── stamping the run is bounded by the same chunk the read is ─────────────
   *
   * The last thing downstream of the paged read, and the most expensive place
   * for it to go wrong.
   *
   * `scopedToRun` puts the period's own lines on the run PLUS everything still
   * unsettled from before it, so the first payroll run at a gym that has been
   * queuing classes on the phone for a season carries that whole backlog on
   * one coach's row. Those ids went into ONE `.in()` inside a PATCH, in the
   * query string, and a uuid costs about 39 bytes there — a couple of hundred
   * of them is past the 8KB request line and the answer is a 414.
   *
   * And it arrives after `recordSettlement` has already written the settlement
   * and stamped the sessions. The run is recorded and paid; the class lines
   * are not stamped, stay unsettled, and join the next run. The gym pays for
   * the same classes twice.
   */
  {
    const N = ID_CHUNK * 3 + 11;
    const lineIds = ids(N, 'c1a55');
    const adjIds = ids(4, 'ad115');
    const { sb, asked } = fakeSb((q) => ({ data: null, error: null, count: (q.in ?? []).length }));

    await stampRunExtras(sb, 'run-1', lineIds, adjIds);

    const writes = asked.filter((q) => q.update);
    ok(writes.every((q) => q.counted),
      'every stamp asks PostgREST to COUNT the rows it changed — RLS filters an update rather than refusing it, so an uncounted stamp reports a settlement over rows it never touched');
    ok(writes.every((q) => (q.in ?? []).length <= ID_CHUNK),
      'and no single PATCH carries more ids than fit in a request line — one `.in()` of 461 uuids is an 18KB query string and a 414 the owner sees as a run that half worked');

    const lines = writes.filter((q) => q.table === 'gym_class_pay');
    eq(lines.length, Math.ceil(N / ID_CHUNK), 'the class lines are stamped in chunks, the last one short');
    eq(new Set(lines.flatMap((q) => q.in ?? [])).size, N, 'and every line is stamped exactly once — a line missed here is paid a second time next month');
    eq(writes.filter((q) => q.table === 'payroll_adjustments').length, 1,
      'four adjustments are one request, because chunking is a ceiling and not a fixed batch size');
  }

  /* ── a chunk that goes missing is reported, never swallowed ────────────── */
  {
    const lineIds = ids(ID_CHUNK + 5, 'c1a55');
    // The second chunk matches nothing — an RLS policy filtering it away, which
    // PostgREST answers with 204 and a null error.
    let seen = 0;
    const { sb } = fakeSb(() => {
      seen += 1;
      return { data: null, error: null, count: seen === 1 ? ID_CHUNK : 0 };
    });
    let said: string | null = null;
    try { await stampRunExtras(sb, 'run-1', lineIds, []); } catch (e: any) { said = e?.message ?? ''; }
    ok(said != null, 'a stamp that changed fewer rows than it was given throws rather than returning');
    ok(!!said && said.includes(`${ID_CHUNK} of ${ID_CHUNK + 5}`),
      `the sentence names how many of how many actually stamped — got ${JSON.stringify(said)}`);
    ok(!!said && /settled twice/.test(said),
      'and says what it costs, because the unstamped remainder is payable again');
  }

  /* ── an id listed twice is one row and not a shortfall ─────────────────── */
  {
    const dup = ['a-1', 'a-1', 'b-2'];
    const { sb } = fakeSb((q) => ({ data: null, error: null, count: (q.in ?? []).length }));
    let threw = false;
    try { await stampRunExtras(sb, 'run-1', dup, []); } catch { threw = true; }
    ok(!threw, 'two mentions of one line are one row changed, not a partial stamp — counting mentions would send an owner chasing a double payment that never happened');
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
