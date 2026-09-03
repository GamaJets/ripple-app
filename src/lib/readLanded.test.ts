// Did every read on this screen come back? Compile with tsc, run with node.
//
// The stamp under a console screen is dated by this boolean, so the three
// things held here are the three ways a stamp lies:
//
//   1. A FAILED read must withhold the stamp. Otherwise a refresh that lost the
//      payments dates the figures still on screen — which came from the read
//      before — as if they had just arrived.
//   2. A read still IN FLIGHT must withhold it too. It is the one a naive
//      "nothing failed, so we are fine" gets wrong, because 'loading' is not
//      'failed'.
//   3. A TRUNCATED read must NOT withhold it. The server answered and the rows
//      are real; a gym past the row cap is partial on every read it will ever
//      make, and refusing to stamp those would print "has not been read yet"
//      for ever over figures read four seconds ago.
import { sliceLanded, slicesLanded, settledLanded, type StatedRead } from './readLanded';

// The suite is a failure until it reaches the end. A file that throws, hangs or
// exits early would otherwise leave a zero status behind and pass silently.
process.exitCode = 1;

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ready: StatedRead = { state: 'ready' };
const partial: StatedRead = { state: 'partial' };
const loading: StatedRead = { state: 'loading' };
const failed: StatedRead = { state: 'failed' };

/* ── one slice ─────────────────────────────────────────────────────────── */

{
  ok(sliceLanded(ready), 'the server answered and gave everything');
  ok(sliceLanded(partial), 'the server answered and gave a prefix — the rows are real, so it landed');
  ok(!sliceLanded(loading), 'a read still in flight has not landed, and stamping it would date rows that have not arrived');
  ok(!sliceLanded(failed), 'a refused read has not landed');
}

/* ── a screen's worth of them ──────────────────────────────────────────── */

{
  ok(slicesLanded([ready, ready, partial]), 'every read answered, one of them short: the screen was read, and the truncation is the section banner’s sentence, not the stamp’s');
  ok(!slicesLanded([ready, ready, failed]), 'six of seven is not a whole read: the stamp stays where it was');
  ok(!slicesLanded([ready, loading]), 'one read still out means the screen is not read yet');
  ok(slicesLanded([]), 'a screen with nothing to read has nothing outstanding');
}

/* ── the allSettled half ───────────────────────────────────────────────── */

{
  const fine: PromiseSettledResult<number[]> = { status: 'fulfilled', value: [1] };
  const empty: PromiseSettledResult<number[]> = { status: 'fulfilled', value: [] };
  const broke: PromiseSettledResult<number[]> = { status: 'rejected', reason: new Error('nope') };

  ok(settledLanded([fine, empty]), 'a read that came back with no rows still came back — empty is an answer');
  ok(!settledLanded([fine, broke]), 'one rejection withholds the stamp for the whole screen');
  ok(settledLanded([]), 'nothing asked, nothing outstanding');
  eq(settledLanded([broke]), false, 'and a screen whose only read failed is certainly not read');
}

/* ── the mistake this module exists to make unwritable ─────────────────── */

{
  // `!== 'failed'` is the slice-shaped spelling of `!== 'error'`, and it admits
  // a read that has not come back at all. scripts/check-whole.mjs counts
  // fourteen hand-fixes of the same collapse elsewhere in this tree.
  const naive = [ready, loading].every((s) => s.state !== 'failed');
  ok(naive, 'the collapse being guarded against does say "fine" here…');
  ok(!slicesLanded([ready, loading]), '…and this does not, which is the whole point');
}

if (errors.length) {
  console.error(`readLanded: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
process.exitCode = 0;
console.log('readLanded: ok');
