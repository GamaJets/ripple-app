// A request that never answers, given up on — and the two different sentences.
// Compile with tsc, run with node.
//
// The defect: nothing in this product has a timeout, so a console on a captive
// portal sits on "Loading…" for ever with its "Read again" button disabled by a
// `running` flag whose `finally` never runs.
//
//   THE DEADLINE     a promise that never settles rejects, and one that settles
//                    first is untouched
//   THE ABORT        the work is stopped BEFORE the rejection is reported
//   THE TIMER        cleared on both outcomes, or `node` never exits
//   READ vs WRITE    a read that was given up on changed nothing; a write may
//                    have landed and must not be reported as failed
//   THE BODY         only a file gets the long deadline
//   THE METHOD       anything that is not GET or HEAD is treated as a write
import {
  READ_DEADLINE_MS, UPLOAD_DEADLINE_MS, deadlineMsFor, changesThings, secondsPhrase,
  deadlineNote, DeadlineExceeded, isDeadlineExceeded, withDeadline, type Timers,
} from './deadline';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** A clock the test drives by hand, so nothing here waits on a real timer. */
function fakeTimers() {
  let next = 1;
  const armed = new Map<number, { fn: () => void; ms: number }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => { const id = next++; armed.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { armed.delete(id as number); },
  };
  return {
    timers,
    /** How many timers are still armed. The number that has to be 0 at the end. */
    get pending() { return armed.size; },
    /** Fire everything armed, as if the clock had reached it. */
    fire() { for (const [id, t] of [...armed]) { armed.delete(id); t.fn(); } },
  };
}

(async () => {
  /* ── THE DEADLINE ─────────────────────────────────────────────────────────
   * The whole condition: a promise that is never going to settle. This is the
   * captive portal, and before this module the console waited on it for ever.
   */
  {
    const c = fakeTimers();
    const never = new Promise<string>(() => { /* the portal holds the socket */ });
    const p = withDeadline(never, READ_DEADLINE_MS, false, undefined, c.timers);
    eq(c.pending, 1, 'a deadline is armed as soon as the work starts');
    c.fire();
    let caught: unknown = null;
    await p.then(() => { errors.push('a request that never answered must not resolve'); }, (e) => { caught = e; });
    ok(isDeadlineExceeded(caught), 'the rejection is a DeadlineExceeded, not a generic Error');
    eq((caught as DeadlineExceeded).ms, READ_DEADLINE_MS, 'it carries the deadline it exceeded');
    eq(c.pending, 0, 'and the timer is gone');
  }

  /* A read that comes back in time is not touched by any of this. */
  {
    const c = fakeTimers();
    const p = withDeadline(Promise.resolve(['a row']), READ_DEADLINE_MS, false, undefined, c.timers);
    eq(JSON.stringify(await p), JSON.stringify(['a row']), 'a read that answers resolves with its rows');
    eq(c.pending, 0, 'and disarms the deadline');
  }

  /* A read the DATABASE refused keeps its own message. A deadline that replaced
   * the refusal's sentence would take away the one thing the screen prints. */
  {
    const c = fakeTimers();
    const p = withDeadline(Promise.reject(new Error('permission denied for table gym_payments')), READ_DEADLINE_MS, false, undefined, c.timers);
    let msg = '';
    await p.catch((e) => { msg = (e as Error).message; });
    eq(msg, 'permission denied for table gym_payments', 'a refusal keeps the database’s own sentence');
    eq(c.pending, 0, 'and disarms the deadline too');
  }

  /* ── THE ABORT ────────────────────────────────────────────────────────────
   * The request has to be STOPPED, not merely stopped being waited for. A read
   * given up on at 25 seconds that lands at 40 would overwrite a fresher one.
   *
   * Asserted as "it happened, and it happened by the time the deadline was
   * reported" rather than as a strict ordering of the two lines. Reordering
   * them in the source is not observable from out here — `reject` schedules its
   * handler as a microtask, so a synchronous abort written after it still runs
   * first — and an assertion that cannot fail is worse than no assertion. What
   * IS observable, and what matters, is that the abort ran at all: without it
   * the request stays in flight against a screen that has moved on.
   */
  {
    const c = fakeTimers();
    let abortedAt: number | null = null;
    let step = 0;
    const p = withDeadline(new Promise<void>(() => {}), 25_000, false, () => { abortedAt = ++step; }, c.timers);
    c.fire();
    eq(abortedAt, 1, 'the abort fires inside the timer, not after somebody handles the rejection');
    let reportedAt: number | null = null;
    await p.catch(() => { reportedAt = ++step; });
    eq(reportedAt, 2, 'and the failure is reported after it');
  }

  /* An abort that itself throws must not swallow the report. */
  {
    const c = fakeTimers();
    const p = withDeadline(new Promise<void>(() => {}), 25_000, false, () => { throw new Error('already aborted'); }, c.timers);
    c.fire();
    let name = '';
    await p.catch((e) => { name = (e as Error).name; });
    eq(name, 'DeadlineExceeded', 'a throwing abort still leaves the person with a sentence');
  }

  /* The abort never fires for a request that answered. */
  {
    const c = fakeTimers();
    let aborted = false;
    await withDeadline(Promise.resolve(1), 25_000, false, () => { aborted = true; }, c.timers);
    c.fire();
    eq(aborted, false, 'a request that came back is never aborted afterwards');
  }

  /* ── READ vs WRITE ────────────────────────────────────────────────────────
   * The one that must not be got wrong. A write given up on may have committed
   * and had its answer lost coming back; "it failed" is how a payment gets taken
   * twice.
   */
  {
    const read = deadlineNote(READ_DEADLINE_MS, false);
    const write = deadlineNote(READ_DEADLINE_MS, true);
    ok(read.includes('Nothing has changed'), 'a read that was given up on says nothing changed');
    ok(!write.includes('Nothing has changed'), 'a write must never claim that');
    ok(write.includes('cannot say whether the change was made'), 'a write says the outcome is unknown');
    ok(write.includes('read the screen again before repeating it'), 'and says what to do instead of pressing again');
    ok(read.includes('25 seconds') && write.includes('25 seconds'), 'both say how long was waited');
    eq(new DeadlineExceeded(READ_DEADLINE_MS, true).message, write, 'the error carries the write wording');
    eq(new DeadlineExceeded(READ_DEADLINE_MS, false).message, read, 'and the read wording');
    eq(new DeadlineExceeded(1000, true).wrote, true, 'the flag survives onto the error');
  }

  /* ── THE METHOD ───────────────────────────────────────────────────────────
   * Which of those two sentences a request gets. Anything unrecognised is a
   * write, because erring the other way prints "nothing has changed" over a
   * payment that may well have been recorded.
   */
  {
    eq(changesThings('GET'), false, 'a GET changes nothing');
    eq(changesThings('get'), false, 'whatever case it arrives in');
    eq(changesThings(' HEAD '), false, 'a HEAD changes nothing either');
    eq(changesThings('POST'), true, 'a POST is a write');
    eq(changesThings('PATCH'), true, 'so is a PATCH');
    eq(changesThings('DELETE'), true, 'and a DELETE — PostgREST deletes through one');
    eq(changesThings('PUT'), true, 'and a PUT');
    eq(changesThings(undefined), false, 'fetch defaults to GET when no method is given, and so does this');
    eq(changesThings('QUERY'), true, 'a method this function has never heard of is assumed to change things');
  }

  /* ── THE BODY ─────────────────────────────────────────────────────────────
   * Only a file gets minutes. A JSON write is a read-sized request and must not
   * be allowed three minutes of silence at a desk.
   */
  {
    eq(deadlineMsFor('none'), READ_DEADLINE_MS, 'a read gets the read deadline');
    eq(deadlineMsFor('text'), READ_DEADLINE_MS, 'and so does a JSON write — it is the same size of request');
    eq(deadlineMsFor('file'), UPLOAD_DEADLINE_MS, 'an upload gets minutes, because a policy PDF legitimately takes them');
    ok(UPLOAD_DEADLINE_MS > READ_DEADLINE_MS, 'and the upload deadline is the longer of the two');
    ok(READ_DEADLINE_MS >= 20_000,
      'the read deadline is not a latency budget — it must never fire on a gym with a slow line');
  }

  /* ── THE PHRASE ───────────────────────────────────────────────────────────── */
  {
    eq(secondsPhrase(25_000), '25 seconds', 'the ordinary case');
    eq(secondsPhrase(1_000), '1 second', 'singular, because "1 seconds" is what a machine writes');
    eq(secondsPhrase(180_000), '180 seconds', 'the upload deadline, said in the same unit');
    eq(secondsPhrase(1), '1 second', 'a sub-second deadline still reads as a duration, never "0 seconds"');
  }

  /* ── isDeadlineExceeded ───────────────────────────────────────────────────── */
  {
    eq(isDeadlineExceeded(new DeadlineExceeded(1, false)), true, 'the real thing');
    eq(isDeadlineExceeded(new Error('nope')), false, 'an ordinary error is not one');
    eq(isDeadlineExceeded(null), false, 'and neither is nothing');
    eq(isDeadlineExceeded({ name: 'DeadlineExceeded' }), true,
      'matched on the name, so an error that crossed a bundle boundary still reads as one');
  }

  if (errors.length) {
    console.error(`deadline: ${errors.length} failure(s)`);
    for (const e of errors) console.error('  · ' + e);
    process.exit(1);
  }
  console.log('deadline: all assertions passed');
})();
