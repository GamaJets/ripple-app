// Answering a reconciliation exception, and the write that has to be counted.
//
// `markException` is the one call in this product that takes a row OFF a
// reconciliation. An accepted exception stops being a question: /accounting
// moves it under "Explained" with the owner's typed reason and their name
// beside it, and the next month's close does not ask again. So the only thing
// worse than that write failing is that write failing quietly, which is what it
// did — `if (error) throw error` and nothing else, while the screen's own
// catch arm stood ready with the right sentence and was never reached.
//
// ── why `error` alone looked like enough, and why it is not ───────────────
//
// Because on an UPSERT the usual argument does not apply, and it is worth
// writing down rather than hand-waving. scripts/check-writes.mjs exempts
// inserts and upserts from its count rule on stated grounds: an INSERT refused
// by a WITH CHECK policy raises 42501, and `ON CONFLICT DO UPDATE` raises
// rather than skipping when the UPDATE policy's USING clause fails the
// existing row. Both true, both about RLS, and RLS is not the only way a write
// comes back having touched nothing — a policy later rewritten as a filter, a
// BEFORE trigger returning NULL, a conflict target that stops naming the
// constraint it was written for. Each is a 2xx, a null `error`, and zero rows.
//
// These assertions are therefore about the SHAPE of the answer, not about
// PostgreSQL: they hand `markException` a resolved `{ error: null, count: 0 }`
// and require it to refuse. That is exactly the value supabase-js hands back
// for every one of those cases, and it is the value the old code read as
// success.
import { markException, clearMark, markBlocker, MARK_STATE_LABEL } from './gymReconcile';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/**
 * A supabase-js stand-in that records the chain and resolves with `answer`.
 *
 * Thenable AND chainable, because the write paths here end on different links:
 * `markException` awaits the `.upsert(…)` itself, `clearMark` awaits the last
 * `.eq(…)`. One object that is both serves the two without the test having to
 * know which.
 */
function fake(answer: { data?: unknown; error?: unknown; count?: number | null }) {
  const calls: unknown[][] = [];
  const q: Record<string, unknown> = {};
  const link = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]); return q; };
  for (const n of ['select', 'eq', 'order', 'limit', 'upsert', 'insert', 'update', 'delete']) q[n] = link(n);
  q.then = (res: unknown, rej: unknown) =>
    Promise.resolve(answer).then(res as never, rej as never);
  return {
    sb: { from: (t: string) => { calls.push(['from', t]); return q as never; } },
    calls,
  };
}

const mark = {
  subjectKind: 'invoice' as const,
  subjectId: '11111111-1111-1111-1111-111111111111',
  state: 'accepted' as const,
  note: '  cash banked in a lump at the desk  ',
  markedBy: '22222222-2222-2222-2222-222222222222',
};

const threw = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try { await fn(); return null; } catch (e) { return (e as Error)?.message ?? 'threw'; }
};

(async () => {
 try {
  /* ── what goes on the wire ───────────────────────────────────────────────── */
  {
    const { sb, calls } = fake({ data: null, error: null, count: 1 });
    await markException(sb, 'tenant-1', mark);
    const up = calls.find((c) => c[0] === 'upsert') as [string, Record<string, unknown>, Record<string, unknown>];
    ok(!!up, 'the answer is written with an upsert');
    eq(up[2].onConflict, 'tenant_id,subject_kind,subject_id',
      'the conflict target is NAMED — PostgREST otherwise picks the primary key, which never collides, so every change of mind would become a second contradictory answer');
    eq(up[2].count, 'exact',
      "COUNTED. Without `{ count: 'exact' }` supabase-js reports count null, and a write that touched nothing is then indistinguishable from one that landed — on the screen that takes a row OFF a reconciliation");
    eq(up[1].note, 'cash banked in a lump at the desk', 'the reason is trimmed');
    eq(up[1].tenant_id, 'tenant-1', 'and filed under the gym');
    eq(up[1].state, 'accepted', 'with the state the owner chose');
  }
  {
    const { sb, calls } = fake({ data: null, error: null, count: 1 });
    await markException(sb, 'tenant-1', { ...mark, state: 'flagged', note: '   ' });
    const up = calls.find((c) => c[0] === 'upsert') as [string, Record<string, unknown>, unknown];
    eq(up[1].note, null,
      'a note of nothing but spaces is null, not the empty string — the CHECK in supabase/parts/181 refuses a present-but-blank reason precisely so a field somebody tabbed through cannot render as an answer');
  }

  /* ── the whole point: a resolved refusal is not a saved answer ───────────── */
  {
    const { sb } = fake({ data: null, error: null, count: 0 });
    const why = await threw(() => markException(sb, 'tenant-1', mark));
    ok(why !== null,
      'a 2xx that matched NO row must throw. This is the defect: the call resolves, the dialog closes, and the exception moves to "Explained" with the owner\'s reason beside it while nothing was stored — a row the gym then believes is settled, in the register an auditor reads');
    ok(/was not changed/.test(why ?? ''),
      'and it says the write changed nothing rather than blaming the network');
  }
  {
    const { sb } = fake({ data: null, error: null, count: null });
    const why = await threw(() => markException(sb, 'tenant-1', mark));
    ok(why !== null,
      'a null count is NOT a pass — "nobody counted" is the shape a future call site that drops the option would take, and treating it as fine would silently re-admit the whole class');
    ok(/did not say whether/.test(why ?? ''),
      'and the sentence names the omission rather than claiming zero rows');
  }
  {
    const { sb } = fake({ data: null, error: { code: '42501', message: 'permission denied' }, count: null });
    const why = await threw(() => markException(sb, 'tenant-1', mark));
    ok(why !== null, 'a refused write throws, as it always did');
  }
  {
    const { sb } = fake({ data: null, error: null, count: 1 });
    eq(await threw(() => markException(sb, 'tenant-1', mark)), null,
      'and one matched row is a recorded answer, which is the case that must still pass');
  }

  /* ── the sentence carries which action failed ────────────────────────────── */
  {
    const { sb } = fake({ data: null, error: null, count: 0 });
    const acc = await threw(() => markException(sb, 't', { ...mark, state: 'accepted' }));
    const flg = await threw(() => markException(sb, 't', { ...mark, state: 'flagged', note: 'wrong' }));
    ok(acc !== flg,
      'explaining a row and flagging one are different things to be told did not happen: one hides a row from the reconciliation and the other deliberately does not');
  }

  /* ── the neighbour, so this does not regress in the other direction ──────── */
  {
    const { sb, calls } = fake({ data: null, error: null, count: 1 });
    await clearMark(sb, 'tenant-1', 'invoice', mark.subjectId);
    const del = calls.find((c) => c[0] === 'delete') as [string, Record<string, unknown>];
    eq(del[1].count, 'exact', 'reopening a question is counted too');
  }
  {
    const { sb } = fake({ data: null, error: null, count: 0 });
    ok(await threw(() => clearMark(sb, 'tenant-1', 'invoice', mark.subjectId)) !== null,
      'and a delete that matched nothing must not report the row back on the reconciliation while it is still hidden');
  }

  /* ── the rule that decides whether there is anything to write at all ─────── */
  ok(markBlocker('accepted', '   ') !== null,
    'accepting with no reason is refused before the write — an exception taken off a reconciliation with nothing recorded is exactly the row somebody asks about later');
  eq(markBlocker('flagged', ''), null,
    'flagging with no words is complete: it hides nothing, so demanding a sentence would only teach people to type a full stop');
  eq(markBlocker('accepted', 'x'.repeat(501)) !== null, true, 'and a reason past 500 characters is refused here rather than by the database');
  eq(MARK_STATE_LABEL.accepted, 'Explained', 'the label the owner reads for an accepted row');
 } catch (e) {
  errors.push(`threw outside an assertion: ${(e as Error)?.message ?? String(e)}`);
 }

 if (errors.length) {
   for (const e of errors) console.error(`  ✗ ${e}`);
   console.error(`gymReconcile: ${errors.length} failure(s)`);
   process.exit(1);
 }
 console.log('gymReconcile: all assertions passed');
})();
