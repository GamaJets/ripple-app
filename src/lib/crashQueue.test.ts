// The crash queue's rules. Compile with tsc, run with node.
//
// Five failures are guarded here, and each one is a way the table could go on
// under-reporting the conditions the app is used in while looking full:
//
//   1. AN UNREADABLE QUEUE READ AS AN EMPTY ONE. Same rule, same reason, as
//      src/lib/outbox.ts · readOutbox: bytes nobody could parse are not "no
//      crashes", and writing a fresh list over them loses every report on the
//      phone in one line.
//   2. A CRASH LOOP EVICTING THE CAUSE. A screen that throws on every render
//      calls this on every render. Evicting oldest-first would leave twenty
//      copies of the symptom and none of the first failure.
//   3. A QUEUED CRASH ARRIVING AS A CRASH THAT HAPPENED TODAY. The row's own
//      created_at is written when it lands, so the moment has to travel inside
//      the message or the whole exercise reports the wrong conditions.
//   4. A SIGNED-OUT CRASH REFUSED. A crash during launch or sign-in has no uid,
//      and those are the ones anybody wants; app_errors takes a null user_id.
//   5. A REPORT THE INSERT POLICY REFUSES, KEPT AND RETRIED FOR EVER. The queue
//      is not per account and `app_errors_insert` compares `user_id` against
//      `auth.uid()`, so a shared phone produces refusals as a matter of course.
//      A refused row at the head of an oldest-first pass blocks every crash
//      behind it; `attributableTo` is what stops the row being refused at all.
import {
  CRASH_CAP, CRASH_KEY, MAX_MESSAGE, MAX_STACK,
  addCrash, attributableTo, crashRow, dropCrash, inCrashOrder, newCrash, readCrashQueue, type CrashReport,
} from './crashQueue';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const crash = (n: number, over: Partial<CrashReport> = {}): CrashReport => newCrash({
  id: `c${n}`, at: `2026-09-0${(n % 9) + 1}T10:00:00.000Z`, message: `boom ${n}`,
  stack: 'at Foo (Foo.tsx:1)', platform: 'ios', appVersion: '1.2.3', userId: 'u1', ...over,
});

/* ── 1. an unreadable queue is not an empty one ──────────────────────────── */

{
  eq(readCrashQueue(null), { items: [], read: true }, 'nothing stored is genuinely nothing waiting');
  eq(readCrashQueue(''), { items: [], read: true }, 'and so is an empty string');
  eq(readCrashQueue('{not json').read, false, 'BYTES NOBODY COULD PARSE ARE NOT "NO CRASHES"');
  eq(readCrashQueue('{"a":1}').read, false, 'nor is an object where a list was written');
  eq(readCrashQueue('[]'), { items: [], read: true }, 'an empty list is readable and empty');

  // A row missing what identifies it is skipped, and the rest still come back:
  // one corrupt entry must not take the file with it.
  const mixed = JSON.stringify([crash(1), { id: '', at: 'x', message: 'y' }, crash(2)]);
  const r = readCrashQueue(mixed);
  eq(r.read, true, 'a file with one bad row is still a file that was read');
  eq(r.items.map((c) => c.id), ['c1', 'c2'], 'and the readable rows survive it');
  eq(r.items[0].userId, 'u1', 'fields come back as they went in');
}

/* ── 2. the crash loop ───────────────────────────────────────────────────── */

{
  // The same message over and over is one crash, not fifty.
  let list: CrashReport[] = [];
  let dupes = 0;
  for (let i = 0; i < 50; i++) {
    const out = addCrash(list, newCrash({ id: `loop${i}`, at: '2026-09-01T10:00:00.000Z', message: 'render exploded' }));
    if (out.result === 'duplicate') dupes++;
    list = out.list;
  }
  eq(list.length, 1, 'a render loop leaves ONE report, not fifty');
  eq(dupes, 49, 'and says so every other time');

  // Full refuses rather than evicting, so the FIRST failure survives.
  let full: CrashReport[] = [];
  for (let i = 0; i < CRASH_CAP; i++) full = addCrash(full, crash(i, { id: `f${i}`, message: `distinct ${i}` })).list;
  eq(full.length, CRASH_CAP, 'the cap is the cap');
  const after = addCrash(full, crash(999, { id: 'late', message: 'a consequence' }));
  eq(after.result, 'full', 'past the cap it refuses');
  eq(after.list.length, CRASH_CAP, 'and the list is unchanged');
  eq(after.list[0].message, 'distinct 0',
    'THE FIRST FAILURE IS STILL THERE — evicting oldest-first would keep twenty symptoms and drop the cause');
  ok(!after.list.some((c) => c.id === 'late'), 'and the newest was the one refused');
}

/* ── ordering, and removing what was sent ────────────────────────────────── */

{
  const a = newCrash({ id: 'a', at: '2026-09-03T10:00:00.000Z', message: 'third' });
  const b = newCrash({ id: 'b', at: '2026-09-01T10:00:00.000Z', message: 'first' });
  const c = newCrash({ id: 'c', at: '2026-09-02T10:00:00.000Z', message: 'second' });
  eq(inCrashOrder([a, b, c]).map((x) => x.message), ['first', 'second', 'third'],
    'oldest first, so the reader meets the cause before the consequence');
  eq(dropCrash([a, b, c], 'b').map((x) => x.id), ['a', 'c'], 'a sent report comes out');
  eq(dropCrash([a, b, c], 'nope').length, 3, 'and an id that is not there removes nothing');
}

/* ── 3. the moment travels with the report ───────────────────────────────── */

{
  const row = crashRow(newCrash({
    id: 'x', at: '2026-09-01T22:14:00.000Z', message: 'Cannot read property of undefined',
    stack: 'at Screen', platform: 'android', appVersion: '2.0.0', userId: 'u9',
  }), 'u9');
  ok(row.message.includes('2026-09-01T22:14:00.000Z'),
    `A QUEUED CRASH MUST NOT ARRIVE AS TODAY'S CRASH — got "${row.message}"`);
  ok(row.message.includes('Cannot read property of undefined'), 'and the message itself is still in it');
  eq(row.user_id, 'u9', 'the account it happened to');
  eq(row.platform, 'android', 'the platform it happened on');
  eq(row.app_version, '2.0.0', 'and the build it happened in');
  ok(row.message.length <= MAX_MESSAGE, 'the message fits the column even with the moment prepended');
}

/* ── 4. a crash with nobody signed in is still a crash ───────────────────── */

{
  const anon = newCrash({ id: 'n', at: '2026-09-01T00:00:00.000Z', message: 'crashed on launch' });
  eq(anon.userId, null, 'no uid is null rather than a refusal');
  eq(crashRow(anon, null).user_id, null, 'and the row carries the null through');
  eq(crashRow(anon, 'u1').user_id, null, 'a crash nobody was signed in for is not attributed to whoever signs in later');
  const added = addCrash([], anon);
  eq(added.result, 'added', 'A LAUNCH CRASH IS KEPT — it is the one nobody else can report');
}

/* ── trimming, so the cap counts what is actually stored ─────────────────── */

{
  const big = newCrash({
    id: 'big', at: '2026-09-01T00:00:00.000Z',
    message: 'm'.repeat(MAX_MESSAGE + 500), stack: 's'.repeat(MAX_STACK + 5000),
  });
  eq(big.message.length, MAX_MESSAGE, 'the message is trimmed on the way in');
  eq(big.stack!.length, MAX_STACK, 'and so is the stack');
  eq(newCrash({ id: 'q', at: 'x', message: 'm', stack: '' }).stack, null, 'an empty stack is null, not an empty string');
}

/* ── 5. a report the policy would refuse is unattributed, not lost ───────── */
//
// `app_errors_insert` is `with check (user_id = auth.uid() or user_id is null)`
// and CRASH_KEY is deliberately not per account, so a crash recorded under one
// account and flushed under another names a uid that is not `auth.uid()`. That
// row is refused every time it is offered — and, before this, sat at the head
// of an oldest-first pass blocking every crash behind it until CRASH_CAP was
// reached and the device stopped reporting altogether.

{
  eq(attributableTo('u1', 'u1'), 'u1', 'the ordinary phone keeps its attribution');
  eq(attributableTo('u1', 'u2'), null,
    'A CRASH FLUSHED UNDER ANOTHER ACCOUNT IS UNATTRIBUTED, NOT REFUSED — the policy takes null');
  eq(attributableTo('u1', null), null, 'and so is one flushed with nobody signed in');
  eq(attributableTo(null, 'u2'), null, 'a launch crash is never attributed to whoever signed in afterwards');
  eq(attributableTo(null, null), null, 'and stays the null the table was designed to hold');

  // Everything a person debugs from survives the lost attribution.
  const c = newCrash({
    id: 'z', at: '2026-09-02T06:30:00.000Z', message: 'boom', stack: 'at Basement',
    platform: 'ios', appVersion: '3.1.0', userId: 'u1',
  });
  const row = crashRow(c, 'u2');
  eq(row.user_id, null, 'the uid the policy would refuse is dropped');
  ok(row.message.includes('2026-09-02T06:30:00.000Z'), 'the moment still travels');
  eq(row.stack, 'at Basement', 'and the stack');
  eq(row.app_version, '3.1.0', 'and the build');
}

/* ── the key is not per account, and that is the point ───────────────────── */

{
  ok(!CRASH_KEY.includes('${'), 'the key is a constant, not a template waiting for a uid');
  ok(CRASH_KEY.includes('v1'), 'and it is versioned, so a shape change does not read old bytes as new ones');
}

if (errors.length) {
  console.error(`crashQueue: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('crashQueue: ok — an offline crash survives the network it happened on');
