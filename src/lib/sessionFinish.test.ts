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
  canFinish, finishBlockedNote, finishCta, finishReport, loggedAgainstLine,
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

if (errors.length) {
  console.error(`sessionFinish.test.ts — ${errors.length} failure(s):`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}
console.log('sessionFinish.test.ts — all assertions passed');
