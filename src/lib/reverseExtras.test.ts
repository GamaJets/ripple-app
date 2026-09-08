// Taking a payroll run back: the class pay lines and the adjustments.
// Compile with tsc, run with node.
//
// ── The defect ────────────────────────────────────────────────────────────
//
// `reverseSettlement` is four writes. The first asked PostgREST for
// `{ count: 'exact' }` and compared it against the run's own `sessions_count`
// (src/lib/unstampCheck.ts); the fourth asked for a count and ran it through
// `assertWrote`. The two in between — `gym_class_pay` and `payroll_adjustments`
// — ASKED FOR THE COUNT AND NEVER READ IT. Twelve lines apart, in the same
// function, one shape checked and the other bound to nothing.
//
// A syntactic gate cannot see that. `scripts/check-writes.mjs` and
// src/lib/edgeWrites.test.ts both score a write as guarded when `{ count:
// 'exact' }` is in its argument list, because whether a bound number is then
// USED is a dataflow question and a gate that guessed at it would produce the
// false positives that get a gate deleted. Both passed these two writes. This
// file is the other half: it runs the function and asserts on the outcome.
//
// ── Why `assertWrote` is the wrong repair ─────────────────────────────────
//
// Zero rows here is USUALLY correct. `stampRunExtras` writes nothing when the
// id list is empty, so a run of sessions only — a PT gym, or any coach with no
// bonus that month — settles with no class pay lines and no adjustments
// against it, and unstamping those matches nothing because there is nothing to
// unstamp. Refusing on a zero count would make every such run unreversible,
// which is a worse bug than the one being fixed and lands on more gyms.
//
// And there is no recorded number to compare against: `payroll_settlements`
// carries `sessions_count` and nothing equivalent for these two tables.
//
// So what is checked is the POSTCONDITION — after the unstamp, nothing may
// still carry the settlement id — which is exactly true whether the run had
// forty lines or none.
//
//   NOTHING TO UNSTAMP   a sessions-only run reverses cleanly, as it must
//   ONE LEFT BEHIND      a line still stamped stops the reversal
//   THE ORDER            it stops BEFORE the settlement is marked reversed
//   THE ADJUSTMENTS      the same rule on the second of the two tables
//   AN UNANSWERED READ   a read that errors is a refusal, not a pass
//   THE SENTENCE         what it says, and what it does not claim
import { reverseSettlement, strandedLineBlocker } from './gymPay';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the fake ─────────────────────────────────────────────────────────────── */

/** One query as the fake saw it built: the table, and whether it was a write. */
interface Asked { table: string; write: boolean; counted: boolean }

interface Answer { data?: unknown[] | null; error?: unknown; count?: number | null }

/**
 * A chainable stand-in for the supabase-js builder, thenable at every point.
 *
 * `answer` is handed the finished query and returns what PostgREST would. The
 * log of queries is what makes the ORDER assertable — that a refusal happened
 * before the settlement was touched is the half of this that protects a coach's
 * money, and it is invisible in a return value.
 */
function fakeSb(answer: (q: Asked, n: number) => Answer) {
  const asked: Asked[] = [];
  const from = (table: string) => {
    const q: Asked = { table, write: false, counted: false };
    asked.push(q);
    const seq = asked.length - 1;
    const settle = () => {
      const a = answer(q, seq);
      return { data: a.data ?? null, error: a.error ?? null, count: a.count ?? null };
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      limit: () => chain,
      single: () => Promise.resolve(settle()),
      maybeSingle: () => Promise.resolve(settle()),
      update: (_patch: Record<string, unknown>, o?: { count?: string }) => {
        q.write = true; q.counted = o?.count === 'exact'; return chain;
      },
      then: (res: (v: unknown) => unknown) => res(settle()),
    };
    return chain;
  };
  return { sb: { from } as any, asked };
}

/**
 * The happy path, parameterised by the two things this file varies: how many
 * rows are left stamped on each of the two extra tables afterwards.
 *
 * Everything else answers as a clean reversal of a run of three sessions, so
 * any refusal an assertion sees came from the lines under test and not from
 * the sessions check or the settlement write.
 */
function run(opts: { classLeft?: number; adjLeft?: number; readErr?: string } = {}) {
  return fakeSb((q, n) => {
    // 0: the settlement's own sessions_count, read before anything is written.
    if (n === 0) return { data: { sessions_count: 3 } as any };
    if (q.table === 'sessions') return { count: 3 };
    if (q.write) return { count: 1 };
    // The leftover reads. `.limit(1)` means one row is the whole answer.
    if (opts.readErr) return { error: { message: opts.readErr } };
    const left = q.table === 'gym_class_pay' ? (opts.classLeft ?? 0) : (opts.adjLeft ?? 0);
    return { data: left > 0 ? [{ id: 'left-1' }] : [] };
  });
}

async function reversed(f: ReturnType<typeof run>): Promise<string | null> {
  try {
    await reverseSettlement(f.sb, 'run-1', 'paid the wrong coach', 'owner-1');
    return null;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}

async function main(): Promise<void> {
  /* ── NOTHING TO UNSTAMP ───────────────────────────────────────────────────
   * The case an `assertWrote` repair would have broken, and the reason this is
   * the first assertion in the file. Most runs at most gyms look like this.
   */
  {
    const f = run();
    const why = await reversed(f);
    eq(why, null, 'a run with no class pay lines and no adjustments reverses cleanly');
    ok(f.asked.some((q) => q.table === 'payroll_settlements' && q.write),
      'and the settlement is marked reversed at the end of it');
  }

  /* ── ONE LEFT BEHIND ──────────────────────────────────────────────────────
   * A class pay line the UPDATE could not change and the SELECT can still see.
   * Reachable: both tables carry a `trainer_id = auth.uid()` read policy on top
   * of the owner policy that governs the update, so at an owner-operated gym the
   * read genuinely sees further than the write.
   */
  {
    const why = await reversed(run({ classLeft: 1 }));
    ok(!!why, 'a class pay line still stamped against the run stops the reversal');
    ok(!!why && /class pay lines/.test(why), 'and the refusal names the class pay lines');
    ok(!!why && !/undefined|null|NaN|\[object/.test(why), 'and it leaks no values into the sentence');
  }

  /* ── THE ORDER ────────────────────────────────────────────────────────────
   * The whole safety argument of this function is that the settlement is marked
   * reversed LAST. A refusal that arrived after that write would have taken the
   * run back while a line stayed attached to it, which is the outcome being
   * refused.
   */
  {
    const f = run({ classLeft: 1 });
    await reversed(f);
    ok(!f.asked.some((q) => q.table === 'payroll_settlements' && q.write),
      'the settlement is never marked reversed once a line is found still attached');
    ok(!f.asked.some((q) => q.table === 'payroll_adjustments'),
      'and it stops at the table that failed rather than carrying on to the next');
  }

  /* ── THE ADJUSTMENTS ──────────────────────────────────────────────────────
   * The second of the two, which had the identical defect and needs its own
   * assertion: one call site fixed and the other left is how this bug came to be
   * two writes rather than one.
   */
  {
    const f = run({ adjLeft: 1 });
    const why = await reversed(f);
    ok(!!why && /adjustments/.test(why), 'an adjustment still stamped against the run stops the reversal');
    ok(!f.asked.some((q) => q.table === 'payroll_settlements' && q.write),
      'and again before the settlement is marked reversed');
  }

  /* ── COUNTED AT ALL ───────────────────────────────────────────────────────
   * The count is still asked for. It is not what decides the refusal, but it is
   * what the sentence quotes, and a write that stops asking would report "the
   * server did not say".
   */
  {
    const f = run();
    await reversed(f);
    for (const t of ['sessions', 'gym_class_pay', 'payroll_adjustments', 'payroll_settlements']) {
      ok(f.asked.some((q) => q.table === t && q.write && q.counted),
        `the write to ${t} asks PostgREST to count the rows it changed`);
    }
  }

  /* ── AN UNANSWERED READ ───────────────────────────────────────────────────
   * "Is anything stranded?" going unanswered is not a no. Going ahead on it is
   * how a coach stops being paid for work they did.
   */
  {
    const f = run({ readErr: 'permission denied for table gym_class_pay' });
    const why = await reversed(f);
    ok(!!why, 'a leftover read that errors stops the reversal');
    ok(!f.asked.some((q) => q.table === 'payroll_settlements' && q.write),
      'and stops it before the settlement is marked reversed');
  }

  /* ── THE SENTENCE ─────────────────────────────────────────────────────────
   * Read by a gym owner mid-task. It must open with the fact that acts — the run
   * was not taken back — and it must not repeat unstampCheck's claim that nothing
   * has changed, because by this point the sessions HAVE been unstamped and the
   * owner has to know that before they record another run.
   */
  {
    for (const [n, left] of [[3, true], [0, true]] as const) {
      const why = strandedLineBlocker('class pay lines', n, left);
      ok(!!why && /^This run was not taken back\./.test(why),
        `the refusal for (${n}) opens by saying the reversal did not happen`);
      ok(!!why && /still stands/.test(why), `and for (${n}) it says the settlement still stands`);
      ok(!!why && /sessions have already been unstamped/.test(why),
        `and for (${n}) it says the sessions came loose, which is the double-pay warning`);
      ok(!!why && !/sorry|apolog/i.test(why), `and for (${n}) it does not apologise`);
    }
    eq(strandedLineBlocker('adjustments', 4, false), null, 'nothing stranded is not a refusal');
    eq(strandedLineBlocker('adjustments', 0, false), null, 'and neither is nothing stranded and nothing unstamped');
    const noCount = strandedLineBlocker('adjustments', null, true);
    ok(!!noCount && /did not say how many/.test(noCount),
      'a missing count is quoted as a missing count rather than printed as null');
    ok(!!noCount && !/null|undefined|NaN/.test(noCount), 'and the sentence carries no bare null');
  }
}

main().then(() => {
  if (errors.length) {
    console.error(`reverseExtras: ${errors.length} failure(s)`);
    for (const e of errors) console.error('  \u00b7 ' + e);
    process.exit(1);
  }
  console.log('reverseExtras: all assertions passed');
}, (e) => {
  // A throw that escaped `reversed()` is the suite failing, never a pass.
  console.error('reverseExtras: the suite itself threw —', e);
  process.exit(1);
});
