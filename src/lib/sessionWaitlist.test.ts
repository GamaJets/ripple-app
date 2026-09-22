// Who is on a session's waitlist. Compile with tsc, run with node.
//
// Two properties, and both are about a promise being made to a named person:
//
//   1. The ORDER is the server's — `joined_at` then `seq`, the pair
//      `_promote_session_waitlist` reads. Naming a first-in-line the server will
//      pass over is worse than naming nobody.
//   2. A read that is refused, still in flight, or CUT names nobody. A cut read
//      can lose the head of a queue, and the head is the only name that carries
//      a promise.
import { fetchSessionWaitlists, waitlistWhoLine, WAITLIST_NAMED_MAX, waitlistLine } from './sessionWaitlist';
import { waitlistLine as countedWaitlistLine } from './booking';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── the sentence ─────────────────────────────────────────────────────────── */

eq(waitlistWhoLine(['Priya Raman'], 'ready'), 'First in line: Priya Raman.',
  'one person waiting is named');
eq(waitlistWhoLine(['Priya Raman', 'Sam Okoye'], 'ready'), 'First in line: Priya Raman, then Sam Okoye.',
  'two are named in order, and the wording says which is which');
eq(waitlistWhoLine(['A', 'B', 'C', 'D', 'E'], 'ready'), 'First in line: A, then B, then C, and 2 more.',
  'past the ceiling the head of the queue is still named and the tail becomes a number');
eq(WAITLIST_NAMED_MAX, 3, 'three names is the ceiling the sentence is written for');
eq(waitlistWhoLine([], 'ready'), null, 'an empty queue under a whole read says nothing — the count line already did');

/* ── and what it refuses to say ───────────────────────────────────────────── */

eq(waitlistWhoLine(['Priya Raman'], 'loading'), null, 'nothing is claimed while the read is in flight');
ok((waitlistWhoLine(['Priya Raman'], 'error') ?? '').includes('couldn’t be read'),
  'a refused read says so rather than naming somebody off a partial answer');
ok((waitlistWhoLine(['Priya Raman'], 'partial') ?? '').includes('isn’t known'),
  'a CUT read names nobody: the cut can take the head of the queue, and the head is the only name that promises anything');
ok(!(waitlistWhoLine(['Priya Raman'], 'partial') ?? '').includes('Priya'),
  'and it really does not leak the name it happens to be holding');
eq(waitlistWhoLine([], 'error'), 'Who is waiting couldn’t be read, so they aren’t named here.',
  'an empty list under a failed read is the failure, never an empty queue');

/* ── the queue length nobody counted ───────────────────────────────────────
 *
 * Every reader of the three waitlist RPCs in src/ui/sessions.tsx settled an
 * unread `waiting` to 0 with `toNum(r.waiting) ?? 0`, and 0 is the value
 * src/lib/booking.ts's `waitlistLine` says "Nobody is waiting for this slot
 * yet." about. Three states, not two, and the null is tested FIRST — `null > 0`
 * and `null > 1` are both false, so a null tested after either of them lands in
 * the sentence this exists to prevent.
 */

/* The two counted arms are unchanged, and are still src/lib/booking.ts's. */
eq(waitlistLine(0, 0), countedWaitlistLine(0, 0), 'a counted empty queue still says what it always said');
eq(waitlistLine(0, 3), countedWaitlistLine(0, 3), 'a counted queue is still worded by the module that has always worded it');
eq(waitlistLine(1, 4), countedWaitlistLine(1, 4), 'and so is the head of one');
eq(waitlistLine(3, 4), countedWaitlistLine(3, 4), 'and a place in the middle of one');
ok(waitlistLine(0, 0).includes('Nobody is waiting'), 'a COUNTED zero is still allowed to say nobody is waiting');

/* The third arm. Every one of these fails against `waiting ?? 0`. */
const unreadFree = waitlistLine(0, null);
const unreadHead = waitlistLine(1, null);
const unreadMid = waitlistLine(3, null);

for (const [what, line] of [['not on the queue', unreadFree], ['head of it', unreadHead], ['third in it', unreadMid]] as const) {
  ok(!line.includes('Nobody is waiting'),
    `an unread count never says nobody is waiting (${what}) — that is a claim about other people made from an unknown`);
  ok(!/\bnull\b|NaN|undefined/.test(line), `and never leaks the unknown itself into the sentence (${what})`);
  ok(line.includes('No waitlist count came back'),
    `it says the count did not come back (${what}), in the voice src/lib/reschedule.ts already uses for this`);
  ok(line.includes('open this screen again') || line.includes('Open this screen again'),
    `and tells the reader what to do about it (${what})`);
  ok(!line.includes('0 people') && !line.includes('of 0'), `no fabricated figure reaches the words (${what})`);
}

ok(unreadFree.includes('whether anybody is already in line'),
  'a member not on the queue is told the one thing that is unknown, and not told the queue is empty');
ok(unreadHead.includes('You’re next in line'),
  'the head of the queue still gets the promise, which does not depend on the count');
ok(unreadHead.includes('how many are behind you'),
  'and is told exactly which part of it is missing');
ok(unreadMid.includes('You’re 3rd in line'),
  'a place in the queue is still stated, because the position is known even when the length is not');
ok(!unreadMid.includes('of 3') && !unreadMid.includes('in line of'),
  'and never invents the "of N" that the counted sentence puts after it');
ok(unreadMid.includes('how long the queue is'),
  'the missing half is named rather than left for the reader to notice');

/* The trap, stated as an assertion rather than as a comment: this is what the
 * whole arm hangs on, and it is what the ordering in `waitlistLine` protects. */
ok(!((null as any) > 0), 'null > 0 is false in JavaScript, which is why the null is tested first');
ok(!((null as any) > 1), 'and null > 1 is too, which is the second test it would have fallen past');

/* ── the read ─────────────────────────────────────────────────────────────── */

type Row = { session_id: string; client_id: string; joined_at: string | null; seq: number };

function fakeDb(rows: Row[], opts: { error?: unknown } = {}) {
  return {
    from: () => {
      const state: { ids: string[]; orders: Array<[string, boolean]> } = { ids: [], orders: [] };
      const self: any = {
        select: () => self,
        in: (_c: string, ids: string[]) => { state.ids = ids; return self; },
        order: (col: string, o: { ascending: boolean }) => { state.orders.push([col, o.ascending]); return self; },
        limit: () => self,
        then: (res: (v: { data: any[] | null; error: unknown }) => unknown) => {
          if (opts.error) return Promise.resolve({ data: null, error: opts.error }).then(res);
          // The fake honours the order it was asked for, so that asking for the
          // wrong one is a test failure rather than a coincidence.
          const keys = state.orders.map(([c]) => c);
          const picked = rows.filter((r) => state.ids.includes(r.session_id)).slice().sort((a, b) => {
            for (const k of keys) {
              const av = k === 'seq' ? a.seq : String(a.joined_at ?? '');
              const bv = k === 'seq' ? b.seq : String(b.joined_at ?? '');
              if (av < bv) return -1;
              if (av > bv) return 1;
            }
            return 0;
          });
          return Promise.resolve({ data: picked, error: null }).then(res);
        },
      };
      return self;
    },
  };
}

void (async () => {
  // Two members who joined in the same transaction tie on `joined_at` exactly.
  // `seq` is the only thing that separates them, and the server separates them
  // that way.
  const tie = '2026-09-01T09:00:00.000Z';
  const db = fakeDb([
    { session_id: 's1', client_id: 'c-late', joined_at: tie, seq: 12 },
    { session_id: 's1', client_id: 'c-first', joined_at: tie, seq: 11 },
    { session_id: 's1', client_id: 'c-latest', joined_at: '2026-09-02T09:00:00.000Z', seq: 3 },
    { session_id: 's2', client_id: 'c-other', joined_at: tie, seq: 99 },
  ]);
  const out = await fetchSessionWaitlists(db, ['s1', 's2']);
  eq(out.status, 'ready', 'a whole read is ready');
  eq(out.bySession.get('s1')?.map((e) => e.clientId).join(','), 'c-first,c-late,c-latest',
    'the queue comes back in promotion order — joined_at first, then seq to break the tie');
  eq(out.bySession.get('s2')?.length, 1, 'each session gets its own queue and they do not merge');
  eq(out.bySession.has('s3'), false, 'a session nobody is waiting for is absent rather than an empty array');
  eq(out.bySession.get('s1')?.[0]?.joinedAt, tie, 'the joining instant is carried, unformatted');

  const refused = await fetchSessionWaitlists(fakeDb([], { error: new Error('permission denied') }), ['s1']);
  eq(refused.status, 'error', 'a refused read says so');
  eq(refused.bySession.size, 0, 'and holds no rows that could be read as "nobody is waiting"');

  const none = await fetchSessionWaitlists(fakeDb([]), []);
  eq(none.status, 'ready', 'asking about no sessions is a whole answer about nothing');
  eq(none.bySession.size, 0, 'with nothing in it');

  if (errors.length) {
    console.error(`sessionWaitlist: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors) console.error('  · ' + e);
    process.exit(1);
  }
  console.log('sessionWaitlist: ok');
})();
