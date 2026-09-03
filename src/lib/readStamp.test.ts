// When a screen last heard from the server. Compile with tsc, run with node.
//
// Four things are held here, and the first two are the ones that put a wrong
// sentence in front of a member:
//
//   1. A FAILED READ DOES NOT MOVE THE STAMP. `src/ui/fetched.tsx` states the
//      rule and this is where it is enforced: the figures on screen still came
//      from the earlier read, and stamping the failure would say they are
//      current.
//   2. A READ IN FLIGHT DOES NOT MOVE IT EITHER. Same reason, and it is the
//      one a naive "stamp whenever the status changes" gets wrong.
//   3. A READ THAT LANDED DOES MOVE IT — including a re-read that never passed
//      through 'loading', which is why the payload identity is watched.
//   4. NOTHING ELSE ALLOCATES. `nextStamp` returns the object it was handed
//      when nothing changed, because this feeds a React setter and an
//      equal-but-new object is a re-render. That is the loop this codebase
//      spent a night finding; see src/lib/dismissedSet.ts.
import { landed, nextStamp, noStamp, stampBusy, type ReadStamp } from './readStamp';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const T0 = 1_700_000_000_000;
const rows = ['a'];

/* ── what counts as an answer ──────────────────────────────────────────── */

{
  ok(landed('ready'), 'the server answered');
  ok(landed('partial'), 'a short answer is still an answer — the rows are real');
  ok(!landed('loading'), 'still in flight is not an answer');
  ok(!landed('error'), 'and a refusal certainly is not');
}

/* ── the first landing ─────────────────────────────────────────────────── */

{
  const start = noStamp('loading', null);
  eq(start.at, null, 'nothing read yet is null, which <Fetched> says as "Reading…" rather than as an age');
  const done = nextStamp(start, 'ready', rows, T0);
  eq(done.at, T0, 'the read landing is the stamp');
}

{
  // Every provider with USE_SUPABASE off, and any read that resolves before the
  // screen mounts. Without rule 2 in nextStamp these sit at "Reading…" for ever
  // over figures that are on screen.
  const start = noStamp('ready', rows);
  eq(nextStamp(start, 'ready', rows, T0).at, T0, 'a provider already landed on the first render is stamped, not left saying "Reading…"');
}

/* ── 1 + 2 · a failure and a retry leave it alone ──────────────────────── */

{
  let s: ReadStamp = nextStamp(noStamp('loading'), 'ready', rows, T0);
  s = nextStamp(s, 'error', rows, T0 + 60_000);
  eq(s.at, T0, 'a failed read leaves the stamp on the read the figures actually came from');
  s = nextStamp(s, 'loading', rows, T0 + 90_000);
  eq(s.at, T0, 'and so does the retry while it is in flight');
  s = nextStamp(s, 'error', rows, T0 + 120_000);
  eq(s.at, T0, 'and the retry failing again');
  s = nextStamp(s, 'ready', rows, T0 + 150_000);
  eq(s.at, T0 + 150_000, 'only the read that lands moves it');
}

{
  // The reconnect path: src/lib/readRefresh.ts re-runs a failed read the moment
  // there is signal, with nobody touching the screen. That is exactly when the
  // difference between "a second ago" and "before you came downstairs" matters.
  let s: ReadStamp = { at: T0, status: 'error', token: rows };
  s = nextStamp(s, 'ready', rows, T0 + 3_600_000);
  eq(s.at, T0 + 3_600_000, 'a silent recovery moves the stamp, which is the whole reason the stamp is worth showing now');
}

/* ── 3 · a re-read that never said 'loading' ───────────────────────────── */

{
  const fresh = ['a', 'b'];
  let s: ReadStamp = { at: T0, status: 'ready', token: rows };
  s = nextStamp(s, 'ready', fresh, T0 + 300_000);
  eq(s.at, T0 + 300_000, 'a new answer under an unchanged status is still a new answer');
  ok(s.token === fresh, 'and the payload it was worked out from is carried');
}

{
  // 'ready' → 'partial' is a different claim about the same read landing.
  let s: ReadStamp = { at: T0, status: 'ready', token: rows };
  s = nextStamp(s, 'partial', rows, T0 + 10_000);
  eq(s.at, T0 + 10_000, 'a read that came back short still came back');
}

/* ── 4 · nothing changed, nothing allocated ────────────────────────────── */

{
  const s: ReadStamp = { at: T0, status: 'ready', token: rows };
  eq(nextStamp(s, 'ready', rows, T0 + 1000), s, 'an unchanged render returns the object already held — an equal copy is a re-render');

  const failed: ReadStamp = { at: T0, status: 'error', token: rows };
  eq(nextStamp(failed, 'error', rows, T0 + 1000), failed, 'and that holds for a screen sitting on a failed read, which is where it is most likely to sit');

  let held: ReadStamp = { at: T0, status: 'ready', token: rows };
  const first = held;
  for (let i = 0; i < 50; i += 1) held = nextStamp(held, 'ready', rows, T0 + i);
  eq(held, first, 'fifty renders with no news produce one object: fifty is React’s nested-update ceiling');
}

/* ── the Refresh control's own label ───────────────────────────────────── */

{
  ok(stampBusy('loading'), 'a read in flight is busy');
  ok(!stampBusy('error'), 'a failed read is finished, not still trying — a button stuck on "Refreshing…" says otherwise');
  ok(!stampBusy('ready'), 'nor is a landed one');
  ok(!stampBusy('partial'), 'nor a short one');
}

if (errors.length) {
  console.error(`readStamp: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('readStamp: ok');
