// Putting a visit back on a pass, and the one visit that must not be.
//
// ── What this is protecting ────────────────────────────────────────────────
//
// `redeemPass` has been wired to the desk since the desk existed. Its opposite
// number was not wired to anything at all, so a visit taken off the wrong
// person's card could not be reversed by anybody anywhere in this product: the
// member was told their ten-pass card had nine on it and no screen could say
// otherwise. That is the one mistake a front desk actually makes.
//
// Wiring it introduces a second, quieter hazard, and this file is mostly about
// that one. supabase/parts/370 lets a delivered one-to-one be PAID FOR out of a
// pack, and records it as a redemption carrying `session_id`, with the matching
// half stamped on the session — `pack_drawn_at`, `pack_drawn_pass_id`,
// `pack_drawn_kind`. Those two are kept in step from the SESSION's side and
// only from there: unmarking the outcome deletes the redemption and clears the
// stamp in one trigger.
//
// Delete such a redemption on its own and the credit goes back on the card
// while the session still says it was paid from that card. Nothing in this
// product reports that disagreement, so the member is credited for an hour they
// had, and the first anybody hears of it is a coach's payroll query months
// later.
//
// So: the blocker refuses it BY NAME, and `undoRedemption` re-runs the blocker
// on the way to the database rather than trusting the screen that drew the
// button — the same arrangement `redeemPass` has with `passBlocker`.
//
// Compile with tsc, run with node.
import { redemptionUndoBlocker, undoRedemption, type Redemption } from './gymPasses';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const red = (over: Partial<Redemption> = {}): Redemption => ({
  id: 'r1', passId: 'p1', classId: null, sessionId: null,
  redeemedAt: '2026-08-14T09:12:00.000Z', redeemedBy: 'u1', ...over,
});

/** A stand-in for the supabase-js builder, recording the delete it was asked
 *  for. `error` is RESOLVED rather than thrown, which is how supabase-js
 *  reports a refusal and how this codebase's reads have gone wrong before. */
function fakeSb(error: unknown = null) {
  const deleted: string[] = [];
  return {
    deleted,
    sb: {
      from: (_t: string) => ({
        delete: () => ({
          eq: (_col: string, id: string) => {
            deleted.push(id);
            return Promise.resolve({ data: null, error });
          },
        }),
      }),
    } as any,
  };
}

async function main() {
  /* ── an ordinary door visit goes back ───────────────────────────────────── */
  {
    eq(redemptionUndoBlocker(red()), null, 'a visit taken at the door can be put back');
    eq(redemptionUndoBlocker(red({ classId: 'c1' })), null,
      'and so can one taken against a class — a class is still the door as far as the pass is concerned');

    const f = fakeSb();
    await undoRedemption(f.sb, red());
    eq(f.deleted.length, 1, 'the redemption row is deleted — part 31’s trigger recomputes `uses_spent` from what survives');
    eq(f.deleted[0], 'r1', 'and it is the row that was asked for');
  }

  /* ── a credit that paid for a one-to-one is refused ─────────────────────── */
  {
    const r = red({ sessionId: 's9' });
    const why = redemptionUndoBlocker(r);
    ok(why !== null, 'a credit spent on a one-to-one is NOT put back from the door');
    ok((why ?? '').includes('one-to-one'), 'and the refusal says what the credit actually paid for');
    ok(/Sessions/.test(why ?? ''), 'and names the screen where the undo really lives, rather than only saying no');

    // The guard is at the write, not only at the button. A screen that draws
    // the control from a stale row must not be able to get past it.
    const f = fakeSb();
    let threw: string | null = null;
    try { await undoRedemption(f.sb, r); } catch (e: any) { threw = e?.message ?? ''; }
    eq(threw, why, 'undoRedemption refuses it with the same sentence rather than trusting its caller');
    eq(f.deleted.length, 0, 'and nothing is deleted');
  }

  /* ── a refused delete is not reported as an undo ────────────────────────── */
  {
    const f = fakeSb({ message: 'permission denied for table gym_pass_redemptions' });
    let threw = false;
    try { await undoRedemption(f.sb, red()); } catch { threw = true; }
    ok(threw,
      'supabase-js RESOLVES on a database error, so a refused delete has to be read off the result — otherwise the desk is told a visit went back that is still spent');
  }

  if (errors.length) {
    console.error(`passUndo: ${errors.length} failed\n` + errors.map((e) => '  · ' + e).join('\n'));
    process.exit(1);
  }
  console.log('passUndo ok');
}

main().catch((e) => { console.error('passUndo — threw:', e); process.exit(1); });
