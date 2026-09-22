// Tests for sessionFinish — finishing a session, and saying honestly which of
// the two writes landed.
//
// The assertions are grouped by the thing that would cost somebody something if
// it were wrong:
//
//   · A REFUSED LOG SPENDS NO CREDIT. supabase/parts/370 draws a session off
//     the client's pack the moment an outcome of 'completed' is written, so an
//     outcome attempted after a refused log would take a client's money for an
//     hour with no record of what was done in it. `not-attempted` is the arm
//     that guarantees it, and it says so out loud.
//   · THE TWO ANSWERS NEVER COLLAPSE. Entries in and outcome refused, and
//     outcome in and entries lost, are different disasters. Every combination
//     produces two distinguishable sentences and a title that is not "done".
//   · A QUEUED WRITE IS NEVER A SAVED ONE. Rule 1 of src/lib/floorQueue.ts,
//     applied to both halves: `logged` and `closed` are false for 'unsent', and
//     the words say the session is still waiting on an outcome to everybody
//     else.
//   · WHAT MAY BE FINISHED. An open slot, an hour still running, and a session
//     somebody has already marked are three different reasons not to offer it,
//     and each has its own sentence.
//   · AN UNREAD COUNT IS NOT A COUNT OF ZERO. "Nothing was logged" said about a
//     read that failed sends a coach to type an hour of somebody's training in
//     for the second time.
//
// The clock-dependent assertions build their fixtures from a fixed `NOW` and
// pass it in, so `npm run test:zones` gets the same answers in Kiritimati and
// Midway.
import {
  DELIVERED_MEANS, NOT_DELIVERED_MEANS,
  canFinish, fetchSessionLogCounts, finishBlockedNote, finishCta, finishReport, loggedAgainstLine,
  loggedExercisesLine,
  type FinishInput, type OutcomeAnswer, type WriteAnswer,
} from './sessionFinish';
import type { LoadStatus } from '../ui/loadStatus';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const NOW = new Date(2026, 8, 2, 12, 0, 0, 0).getTime();   // 2 Sep 2026, local noon
const at = (h: number) => new Date(2026, 8, 2, h, 0, 0, 0).toISOString();

const ANSWERS: WriteAnswer[] = ['stored', 'refused', 'unsent'];
const OUTCOMES: OutcomeAnswer[] = ['stored', 'refused', 'unsent', 'not-asked', 'not-attempted'];

const report = (over: Partial<FinishInput>) => finishReport({
  entries: 'stored', outcome: 'stored', entryCount: 3, first: 'Priya', ...over,
});

/* ── 1 · a refused log spends no credit ─────────────────────────────────────
 *
 * The graded assertion. `not-attempted` must be a state the report can say in
 * words, and the words must state that nothing came off the client. */
{
  const r = report({ entries: 'refused', outcome: 'not-attempted' });
  eq(r.logged, false, 'a refused log is not logged');
  eq(r.closed, false, 'a refused log leaves the session open');
  eq(r.mayLeave, false, 'a refused log must keep the sets on screen');
  const all = r.lines.join(' ');
  ok(/no session credit has been taken off/i.test(all),
    `a refused log must say no credit was spent — got ${JSON.stringify(r.lines)}`);
  ok(/not saved/i.test(r.title), `the title must not read as a success — got ${JSON.stringify(r.title)}`);
  // And it must not claim anything about the session having changed.
  ok(!/marked as delivered\.?$/i.test(all.replace(/NOT been marked as delivered/i, '')),
    `a refused log must not claim the session was marked — got ${JSON.stringify(r.lines)}`);
}

/* ── 2 · the two answers never collapse ─────────────────────────────────────
 *
 * Every combination produces two sentences, and the sentence about the log
 * never doubles as the sentence about the session. */
{
  for (const entries of ANSWERS) {
    for (const outcome of OUTCOMES) {
      // 'not-attempted' is only reachable behind a refused log; the screen
      // never produces the other pairings and the test does not assert them.
      if (outcome === 'not-attempted' && entries !== 'refused') continue;
      const r = report({ entries, outcome });
      const wanted = outcome === 'not-asked' ? 1 : 2;
      eq(r.lines.length, wanted, `${entries}/${outcome} should give ${wanted} sentence(s)`);
      ok(r.lines.every((l) => l.trim().length > 20), `${entries}/${outcome} has an empty sentence`);
      if (r.lines.length === 2) {
        ok(r.lines[0] !== r.lines[1], `${entries}/${outcome} said the same thing twice`);
      }
      // Server-confirmed, never sent-and-hoped.
      eq(r.logged, entries === 'stored', `${entries}/${outcome}: logged must track the server's answer`);
      eq(r.closed, outcome === 'stored', `${entries}/${outcome}: closed must track the server's answer`);
    }
  }
}

/* Entries in, outcome refused — the coach must be told the session is still on
 * the marking queue and must not be told it is finished. */
{
  const r = report({ entries: 'stored', outcome: 'refused' });
  eq(r.logged, true, 'the entries landed');
  eq(r.closed, false, 'the outcome did not');
  ok(/Mark Sessions/.test(r.lines.join(' ')),
    `a refused outcome must point at the queue — got ${JSON.stringify(r.lines)}`);
  ok(!/finished/i.test(r.title), `title must not say finished — got ${JSON.stringify(r.title)}`);
  eq(r.mayLeave, true, 'the typing is on the server, so the screen may close');
}

/* Both in — and only then may the word "finished" be used. */
{
  const r = report({ entries: 'stored', outcome: 'stored' });
  eq(r.title, 'Session finished', 'both confirmed is the only "finished"');
  eq(r.logged, true, 'logged');
  eq(r.closed, true, 'closed');
}

/* A coach who turned the switch off gets one sentence and no complaint. */
{
  const r = report({ entries: 'stored', outcome: 'not-asked' });
  eq(r.lines.length, 1, 'nothing was asked of the session, so nothing is said about it');
  eq(r.title, 'Session logged', 'the old title, for the old act');
  eq(r.closed, false, 'nothing was marked');
}

/* ── 3 · a queued write is never a saved one ───────────────────────────────── */
{
  const r = report({ entries: 'unsent', outcome: 'unsent' });
  eq(r.logged, false, 'a queued log is not logged');
  eq(r.closed, false, 'a queued outcome is not a closed session');
  eq(r.title, 'Kept on this phone', 'the title says where it is');
  const all = r.lines.join(' ');
  ok(/still waiting on an outcome/i.test(all),
    `a queued outcome must say the session still looks unmarked — got ${JSON.stringify(r.lines)}`);
  ok(!/\bis now marked as delivered\b/i.test(all),
    `a queued outcome must never claim the mark landed — got ${JSON.stringify(r.lines)}`);
  eq(r.mayLeave, true, 'the phone is holding it, so the screen may close');
}

/* Entries queued but the outcome got through — a real pairing, because the two
 * writes are two round trips and the signal can come back between them. */
{
  const r = report({ entries: 'unsent', outcome: 'stored' });
  eq(r.logged, false, 'the entries are on the phone');
  eq(r.closed, true, 'the mark reached the server');
  ok(/saved on this phone/i.test(r.lines[0]), 'the first sentence is about the entries');
  ok(/marked as delivered/i.test(r.lines[1]), 'the second is about the session');
}

/* ── 3b · the phone would not keep it, which is a fourth thing ─────────────
 *
 * `attempt` has a fourth answer: nobody answered AND src/lib/floorQueue.ts is
 * already holding FLOOR_CAP acts, so nothing was kept. It must not read as any
 * of the other three. 'unsent' promises a send that will never happen; 'stored'
 * is absurd; 'refused' points the coach at a server that has never seen this,
 * and at nothing they can do about it. */
{
  const r = report({ entries: 'full', entryCount: 4, outcome: 'not-attempted' });
  eq(r.logged, false, 'nothing was kept, so nothing was logged');
  eq(r.title, 'Not saved', 'and the title says so rather than "kept on this phone"');
  const all = r.lines.join(' ');
  ok(/not waiting to send/i.test(all),
    `A REFUSED KEEP MUST NOT PROMISE A SEND — got ${JSON.stringify(r.lines)}`);
  ok(!/server/i.test(r.lines[0]),
    `and must not blame a server that never saw it — got ${JSON.stringify(r.lines[0])}`);
  ok(!/4 exercises/.test(r.lines[0]), 'the count is not evidence here either');
  eq(r.mayLeave, false,
    'THE SETS EXIST ONLY ON THIS SCREEN — the coach may not walk away from them');
  ok(/no session credit/i.test(all),
    'and no credit is spent for an hour whose record was not kept');
}

/* ── 4 · the count is never evidence ────────────────────────────────────────
 *
 * A stored log names how many exercises went in. A queued one must not — the
 * count is what was OFFERED, and counting a write nobody answered reads as a
 * receipt for it. */
{
  const stored = report({ entries: 'stored', entryCount: 4, outcome: 'not-asked' });
  ok(/4 exercises/.test(stored.lines[0]), `a stored log names the count — got ${JSON.stringify(stored.lines[0])}`);
  const one = report({ entries: 'stored', entryCount: 1, outcome: 'not-asked' });
  ok(/1 exercise\b/.test(one.lines[0]) && !/1 exercises/.test(one.lines[0]),
    `one exercise is singular — got ${JSON.stringify(one.lines[0])}`);
  const queued = report({ entries: 'unsent', entryCount: 4, outcome: 'not-asked' });
  ok(!/4 exercises/.test(queued.lines[0]),
    `a queued log must not count what nobody answered — got ${JSON.stringify(queued.lines[0])}`);
}

/* A name that could not be read must not become the subject of a sentence. */
{
  for (const first of [null, '', '   ']) {
    const r = report({ first, outcome: 'not-asked' });
    ok(/your client/.test(r.lines[0]), `an unread name falls back to a description — got ${JSON.stringify(r.lines[0])}`);
    ok(!/^’s|\s’s/.test(r.lines[0]), `a missing name left a hole — got ${JSON.stringify(r.lines[0])}`);
  }
}

/* The refusal cause the screen knows is used; the general one otherwise. */
{
  const named = report({ entries: 'refused', outcome: 'not-attempted', refusalCause: 'Priya is not on your roster.' });
  ok(/Priya is not on your roster\./.test(named.lines[0]), 'the known cause is named');
  const general = report({ entries: 'refused', outcome: 'not-attempted' });
  ok(/roster/i.test(general.lines[0]), 'the general cause still names the one thing a coach can act on');
}

/* ── 5 · what may be finished ───────────────────────────────────────────────
 *
 * Four reasons not to offer it, four different sentences, and none of them may
 * be silence. */
{
  const base = { clientId: 'c1', startsAt: at(9), durationMin: 60, status: 'booked', outcome: null };

  ok(canFinish(base, NOW), 'a booked, finished, unmarked session with a client can be finished');
  eq(finishBlockedNote(base, NOW), null, 'nothing to explain when it is offered');

  const running = { ...base, startsAt: at(11), durationMin: 90 };
  ok(!canFinish(running, NOW), 'an hour still running is not offered');
  ok(/has not finished yet/i.test(finishBlockedNote(running, NOW) ?? ''),
    `a running session says why — got ${JSON.stringify(finishBlockedNote(running, NOW))}`);

  const marked = { ...base, outcome: 'completed' };
  ok(!canFinish(marked, NOW), 'a session with an outcome is not re-finished');
  ok(/already has an outcome/i.test(finishBlockedNote(marked, NOW) ?? ''),
    'a marked session says why');
  // Every outcome value, not just 'completed' — a no-show must not be
  // re-marked as delivered from here either.
  for (const o of ['completed', 'no_show', 'cancelled', 'late_cancelled']) {
    ok(!canFinish({ ...base, outcome: o }, NOW), `${o} is already decided`);
  }

  const nobody = { ...base, clientId: null };
  ok(!canFinish(nobody, NOW), 'an hour with nobody in it is not a session');
  ok(/Nobody is booked/i.test(finishBlockedNote(nobody, NOW) ?? ''), 'an empty hour says why');

  const open = { ...base, status: 'available' };
  ok(!canFinish(open, NOW), 'an open slot that went by is not a delivered session');
  ok((finishBlockedNote(open, NOW) ?? '').length > 20, 'an open slot still gets a sentence');

  const blocked = { ...base, status: 'blocked' };
  ok(!canFinish(blocked, NOW), 'blocked time is not a session');

  // An unparseable start is not "has ended". Offering to finish it would mark
  // an outcome on a row nothing on screen can place in time.
  ok(!canFinish({ ...base, startsAt: 'not a date' }, NOW), 'an unreadable start is not finishable');
}

/* ── 6 · the labels and the warning ─────────────────────────────────────────
 *
 * The credit is the reason this is a labelled control rather than a silent side
 * effect of Save, so the sentence has to name it. */
{
  ok(/pack|pass/i.test(DELIVERED_MEANS), 'the warning names what a credit comes off');
  ok(/comes off/i.test(DELIVERED_MEANS), 'the warning says something is spent');
  ok(/Mark Sessions/.test(DELIVERED_MEANS), 'the warning says where the session goes');
  ok(/nothing comes off/i.test(NOT_DELIVERED_MEANS), 'turning it off says nothing is spent');
  ok(/still saved/i.test(NOT_DELIVERED_MEANS), 'turning it off must not read as losing the log');
  ok(DELIVERED_MEANS !== NOT_DELIVERED_MEANS, 'two states, two sentences');

  eq(finishCta(true, true), 'Save and Finish Session', 'the button says what it does');
  eq(finishCta(false, true), 'Save Without Finishing', 'and says what it does not do');
  eq(finishCta(true, false), 'Save Session', 'with no session in hand it is the plain save');
  eq(finishCta(false, false), 'Save Session', 'and the switch cannot change that');
}

/* ── 7 · an unread count is not a count of zero ─────────────────────────── */
{
  const ALL: LoadStatus[] = ['loading', 'ready', 'partial', 'error'];
  const seen = new Set<string>();
  for (const s of ALL) {
    const line = loggedAgainstLine(s, s === 'ready' ? 0 : 2);
    ok(line.trim().length > 20, `${s} must be a sentence`);
    ok(!seen.has(line), `${s} repeated another status's sentence`);
    seen.add(line);
  }
  ok(/could not be read/i.test(loggedAgainstLine('error', null)),
    'a failed read says so');
  ok(!/Nothing is filed/i.test(loggedAgainstLine('error', null)),
    'a failed read must never state the session is empty');
  ok(/not a session with nothing in it/i.test(loggedAgainstLine('error', null)),
    'and says so in as many words');
  ok(/Nothing is filed/i.test(loggedAgainstLine('ready', 0)),
    'only a whole read may state the session is empty');
  ok(/^2 exercises logged/.test(loggedAgainstLine('ready', 2)), 'a whole read counts');
  ok(/^1 exercise logged/.test(loggedAgainstLine('ready', 1)), 'and counts one singularly');
  ok(/not necessarily all/i.test(loggedAgainstLine('partial', 5)),
    'a truncated read says it is a floor and not a total');
  ok(!/^0 /.test(loggedAgainstLine('loading', null)), 'loading never renders a number');
}

/* ── 8 · the movements, named ───────────────────────────────────────────────
 *
 * A count says whether the hour was written up. The names say what was in it,
 * which is the question a coach opening last Tuesday actually has. The list is
 * capped and the tail SAYS how many more — a phrase that trails off would be
 * read as the whole session. */
{
  eq(loggedExercisesLine([]), null, 'nothing to name gives no phrase');
  eq(loggedExercisesLine(['  ', '']), null, 'blank names are not names');
  eq(loggedExercisesLine(['Back Squat']), 'Back Squat.', 'one movement');
  eq(loggedExercisesLine(['Back Squat', 'Bench Press']), 'Back Squat and Bench Press.', 'two');
  eq(loggedExercisesLine(['A', 'B', 'C']), 'A, B and C.', 'three, the cap');
  eq(loggedExercisesLine(['A', 'B', 'C', 'D']), 'A, B, C and 1 more.', 'four says how many are missing');
  eq(loggedExercisesLine(['A', 'B', 'C', 'D', 'E']), 'A, B, C and 2 more.', 'and counts them');
  ok(!/…|\.\.\./.test(loggedExercisesLine(['A', 'B', 'C', 'D']) ?? ''),
    'the tail is a count, never an ellipsis');
}

/* ── 9 · the read behind the count ──────────────────────────────────────────
 *
 * `fetchSessionLogCounts` is what app/(trainer)/sessions.tsx calls to decide
 * what `loggedAgainstLine` above says about every session on the screen, and
 * until now nothing exercised it at all — the sentences were asserted, the
 * thing that chooses between them was not.
 *
 * The two halves that matter are the two this file already argues about
 * everywhere else. A count has to be a count of rows, because a coach reads it
 * as the number of movements written up and decides from it whether an hour was
 * delivered. And a read that hit its ceiling has to come back `partial`,
 * because `ready` with a short count is the app telling a coach that a session
 * they filled has almost nothing in it — the same "empty list under a failed
 * read" this codebase refuses everywhere else, wearing a cap.
 *
 * The database is a fake, as in gymPayReads.test.ts: what is under test is the
 * counting and the truncation flag, not PostgREST. */

type Row = { id?: string; session_id?: string | null; exercise?: string | null; performed_at?: string };

/** Records the id list a read asked for, and answers with `rows`.
 *
 *  `asked.in` is the LAST chunk asked for and `asked.chunks` is every one of
 *  them, because the read is chunked now and a fake that only remembered one
 *  could not tell a chunked read from an unchunked one. `answer` may be a
 *  function so a test can answer different chunks differently — which is the
 *  only way to assert that a failure in the middle of a set stops the loop. */
function fakeSb(
  rows: Row[] | null | ((chunk: string[], nth: number) => { data: Row[] | null; error: unknown }),
  error: unknown = null,
) {
  const asked: {
    table: string; in: string[] | null; limit: number | null; chunks: string[][];
    /** Every `.order()` of the LAST chunk asked for, in the order it was
     *  applied. Recorded because the direction of these two decides WHICH rows
     *  the cap keeps, and a fake that swallowed the arguments could not tell a
     *  read that keeps this week from one that keeps last spring. */
    orders: { column: string; ascending: boolean | undefined }[];
  } = { table: '', in: null, limit: null, chunks: [], orders: [] };
  const from = (table: string) => {
    asked.table = table;
    asked.orders = [];
    let mine: string[] = [];
    const chain: any = {
      select: () => chain,
      in: (_c: string, ids: string[]) => { mine = ids; asked.in = ids; asked.chunks.push(ids); return chain; },
      order: (column: string, opts?: { ascending?: boolean }) => {
        asked.orders.push({ column, ascending: opts?.ascending });
        return chain;
      },
      limit: (n: number) => { asked.limit = n; return chain; },
      then: (res: (v: { data: Row[] | null; error: unknown }) => unknown) => res(
        typeof rows === 'function' ? rows(mine, asked.chunks.length - 1) : { data: rows, error },
      ),
    };
    return chain;
  };
  return { sb: { from } as any, asked };
}

const log = (session: string, exercise: string | null = 'Back Squat'): Row =>
  ({ session_id: session, exercise, performed_at: '2026-09-01T09:00:00.000Z' });

async function readAssertions(): Promise<void> {
  /* ── counting ─────────────────────────────────────────────────────────── */
  {
    const { sb } = fakeSb([log('s1'), log('s1', 'Bench Press'), log('s1', 'Deadlift'), log('s2')]);
    const out = await fetchSessionLogCounts(sb, ['s1', 's2']);
    eq(out.status, 'ready', 'a read that came back whole is whole');
    // Derived from the fixture rather than written down twice: three rows were
    // filed against s1, so the count is three. A count that started at one
    // would read as four movements to a coach deciding whether the hour
    // happened, and there is nothing on the screen to check it against.
    eq(out.bySession.get('s1'), 3, 'three rows filed against a session is a count of three');
    eq(out.bySession.get('s2'), 1, 'and one is one');
    eq(out.bySession.get('s3'), undefined, 'a session nothing was filed against has no entry rather than a zero it did not earn');
    eq(out.namesBySession.get('s1')!.join(', '), 'Back Squat, Bench Press, Deadlift', 'and the movements are named in the order the read returned them');
  }

  {
    // A session logged three times with the same movement is one movement done
    // three times. The count and the names answer different questions and must
    // not be made to agree.
    const { sb } = fakeSb([log('s1'), log('s1'), log('s1', '  '), log('s1', null), log('s1', 'Row')]);
    const out = await fetchSessionLogCounts(sb, ['s1']);
    eq(out.bySession.get('s1'), 5, 'every row filed is counted, including the ones that carry no movement name');
    eq(out.namesBySession.get('s1')!.join(', '), 'Back Squat, Row', 'but a repeated movement is named once and a blank name is not a name');
  }

  {
    // A row with no session on it belongs to no session and must not be
    // attributed to one.
    const { sb } = fakeSb([log('s1'), { session_id: null, exercise: 'Ghost' }, { exercise: 'Orphan' }]);
    const out = await fetchSessionLogCounts(sb, ['s1']);
    eq(out.bySession.get('s1'), 1, 'only the rows that name a session are counted against it');
    eq(out.bySession.size, 1, 'and the unattached ones land nowhere');
  }

  /* ── the ceiling ──────────────────────────────────────────────────────── */
  //
  // The boundary, from both sides, because `>` and `>=` differ by exactly one
  // row and only the boundary tells them apart. The read asks for one MORE than
  // the cap precisely so that "we hit the ceiling" is distinguishable from "the
  // set is exactly this big" — a distinction that evaporates if the extra row
  // is not asked for, and which decides whether a coach is shown a figure or
  // told the figure is not established.
  {
    const CAP = 4;
    const exactly = Array.from({ length: CAP }, () => log('s1'));
    const { sb, asked } = fakeSb(exactly);
    const out = await fetchSessionLogCounts(sb, ['s1'], CAP);
    eq(out.status, 'ready', 'a set that exactly fills the cap is COMPLETE — the cap was reached, not exceeded');
    eq(out.bySession.get('s1'), CAP, 'and every row of it is counted');
    eq(asked.limit, CAP + 1, 'the read asks for one more than the cap, which is the only way it can tell a full set from a truncated one');
  }

  {
    const CAP = 4;
    const overflowing = Array.from({ length: CAP + 1 }, () => log('s1'));
    const { sb } = fakeSb(overflowing);
    const out = await fetchSessionLogCounts(sb, ['s1'], CAP);
    eq(out.status, 'partial', 'one row past the cap is a truncated read and says so');
    eq(out.bySession.get('s1'), CAP, 'and the count stops at the cap rather than including the row that only proved there were more');
    // The pairing this exists for: `partial` is what stops the screen stating a
    // total it cannot stand behind.
    ok(/not necessarily all of them/.test(loggedAgainstLine(out.status, out.bySession.get('s1') ?? null)),
      'and the sentence a coach reads says the figure is a floor rather than a total');
  }

  /* ── which end the cap cuts ───────────────────────────────────────────────
   *
   * The flag above is honest and it was landing on the wrong rows. Both orders
   * read `ascending: true`, so the cap kept the OLDEST workouts; the id list
   * arrives from app/(trainer)/sessions.tsx as `pastSessions(...)` — newest
   * first — and `readCappedByIds` chunks it in that order, so the cap falls
   * inside the chunk holding the most recent sessions. A coach with 150 past
   * sessions averaging four movements sends 600 rows at a 400 cap and the 200
   * that fell off were THIS WEEK's: their marking screen read "at least 0
   * exercises" under hours they had run and written up two days ago, while
   * sessions from two months back showed real counts.
   *
   * Asserted on the query rather than on the output, because the cut happens in
   * PostgREST and the only thing this side can be right or wrong about is the
   * direction it asks for. */
  {
    const { sb, asked } = fakeSb([log('s1')]);
    await fetchSessionLogCounts(sb, ['s1']);
    eq(asked.orders.length, 2, 'the read is ordered on two columns, so a tie cannot decide which rows the cap keeps');
    eq(asked.orders[0].column, 'performed_at', 'the newest workout is the one a coach is looking at');
    eq(asked.orders[0].ascending, false, 'so the read is newest-first and the cap cuts the oldest rows, not this week\'s');
    eq(asked.orders[1].column, 'id', 'and the tie-break is stable');
    eq(asked.orders[1].ascending, false,
      'in the same direction as the key it breaks ties for — a descending primary with an ascending tie-break is a third order matching neither');
  }

  /* ── a read that did not happen ───────────────────────────────────────── */
  {
    const { sb } = fakeSb(null, { message: 'network' });
    const out = await fetchSessionLogCounts(sb, ['s1']);
    eq(out.status, 'error', 'a refused read is an error');
    eq(out.bySession.size, 0, 'and comes back with no counts at all');
    // The whole reason this returns a status beside the Map: an empty Map is
    // indistinguishable from "nothing was logged", and saying that about a
    // session a coach filled is the defect this shape exists to prevent.
    ok(/could not be read/.test(loggedAgainstLine(out.status, null)),
      'so the screen says the read failed rather than that the session is empty');
  }

  {
    const { sb, asked } = fakeSb([log('s1')]);
    const out = await fetchSessionLogCounts(sb, []);
    eq(out.status, 'ready', 'no sessions to ask about is not a failure');
    eq(out.bySession.size, 0, 'and nothing comes back');
    eq(asked.table, '', 'and no query is sent at all');
  }

  /* ── the request line, which is a different ceiling from the row cap ─────
   *
   * The row cap above is about how many rows come BACK. This is about how many
   * ids go OUT, and the two failures do not look alike from here.
   *
   * app/(trainer)/sessions.tsx hands over one id per row it is drawing, off a
   * `capLimit()` read — so up to a thousand session ids arrive. A uuid costs
   * about 39 bytes inside a PostgREST `in.("…","…")` list, which makes a
   * thousand of them a ~39KB request line against the 8KB nginx and most CDNs
   * enforce by default. The proxy refuses past roughly two hundred, the refusal
   * is a 414, supabase-js does not reject on it, and it arrives as `data: null`
   * with no error.
   *
   * `data: null` and no error is EXACTLY the shape of "nothing was logged
   * against any of these". So the failure a coach saw was not an error screen:
   * it was every session in their marking queue reading "Nothing is filed
   * against this session", about hours they had run and written up, on the
   * screen where they decide whether an hour was delivered and whether it gets
   * paid. Nothing to pull to refresh into working, because nothing was broken
   * as far as the app could tell. */
  {
    const ids = Array.from({ length: 400 }, (_, i) => `s${i}`);
    const { sb, asked } = fakeSb([]);
    await fetchSessionLogCounts(sb, ids);
    ok(asked.chunks.length > 1, `four hundred ids must not travel in one .in() — got ${asked.chunks.length} chunk(s)`);
    // Not "some number bigger than one": every chunk has to be small enough
    // that the request line cannot be the thing that fails, and the boundary is
    // the whole point of chunking at all.
    ok(asked.chunks.every((c) => c.length <= 150),
      `no chunk may exceed the 150 ids a ~5.9KB request line allows — got ${asked.chunks.map((c) => c.length).join(', ')}`);
    // And every id must actually be asked about. A chunking bug that drops the
    // tail is the same lie in a quieter voice.
    eq(asked.chunks.flat().length, ids.length, 'and every id is asked about exactly once, across all the chunks');
    eq([...new Set(asked.chunks.flat())].length, ids.length, 'with none of them asked about twice');
  }

  {
    // The counts have to survive being assembled out of several chunks. A coach
    // reads this number as the movements written up in an hour.
    const ids = Array.from({ length: 300 }, (_, i) => `s${i}`);
    const { sb } = fakeSb((chunk) => ({ data: chunk.map((id) => log(id)), error: null }));
    const out = await fetchSessionLogCounts(sb, ids);
    eq(out.status, 'ready', 'a chunked read that came back whole is whole');
    eq(out.bySession.size, ids.length, 'every session counted, not just the ones in the last chunk');
    eq(out.bySession.get('s0'), 1, 'the first chunk survives being followed by another');
    eq(out.bySession.get('s299'), 1, 'and so does the last');
  }

  {
    // A chunk that FAILS is an error for the whole read, not a set assembled
    // from the chunks that worked. Half the queue reading "nothing logged"
    // because the second request was refused is the original defect with a
    // smaller blast radius, which is not the same as fixed.
    const ids = Array.from({ length: 300 }, (_, i) => `s${i}`);
    const { sb, asked } = fakeSb((chunk, nth) => (
      nth === 0 ? { data: chunk.map((id) => log(id)), error: null } : { data: null, error: { message: 'refused' } }
    ));
    const out = await fetchSessionLogCounts(sb, ids);
    eq(out.status, 'error', 'a chunk that was refused makes the whole read an error');
    eq(out.bySession.size, 0, 'and no partial map is handed back to be read as a count');
    eq(asked.chunks.length, 2, 'and the loop stops at the failure rather than asking the rest');
  }

  {
    // The screen hands over one id per row it is drawing, and the same client
    // can have two sessions on it. Asking for a duplicate id is a longer `.in()`
    // for no extra rows.
    const { sb, asked } = fakeSb([log('s1')]);
    await fetchSessionLogCounts(sb, ['s1', 's1', '', 's2']);
    eq(asked.in!.join(','), 's1,s2', 'the id list is deduplicated and the empty ones dropped before it is sent');
  }
}

void readAssertions().then(() => {
  if (errors.length) {
    console.error(`sessionFinish.test.ts — ${errors.length} failure(s):`);
    for (const e of errors) console.error(`  · ${e}`);
    process.exit(1);
  }
  console.log('sessionFinish.test.ts — all assertions passed');
});
