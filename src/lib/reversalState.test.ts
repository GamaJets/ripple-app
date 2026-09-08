// Where a payroll run stands after a reversal that threw. Compile with tsc, run
// with node.
//
// The assertion worth having is the negative one, and it is the sentence this
// module was written to delete: a reversal that failed AFTER the sessions came
// loose must never tell the owner they are still stamped against the run. That
// is the one state in which recording another run for the coach is safe, so
// printing it over the state where it is not is how a gym pays for the same
// hours twice.
//
//   UNTOUCHED     every session still stamped — the all-clear, and it is exact
//   LOOSE         any session missing — the double-pay warning, and no retry
//   NO SESSIONS   a run with nothing to unstamp still has two line tables
//   UNKNOWN       a count that did not come back is not a count of zero
import { aftermathOf, reversalFailureText, type ReversalAftermath } from './reversalState';

const errors: string[] = [];
let checks = 0;
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(a === b, `${msg} (got ${String(a)}, wanted ${String(b)})`);

const say = (a: ReversalAftermath) => reversalFailureText('the write was refused', a);

/* ── reading the record ────────────────────────────────────────────────────── */

eq(aftermathOf(5, 5).state, 'untouched', 'every session still stamped is the all-clear');
eq(aftermathOf(1, 1).state, 'untouched', 'and a one-session run is no different');

eq(aftermathOf(5, 0).state, 'loose', 'none stamped after a failure is the warning');
eq(aftermathOf(5, 4).state, 'loose', 'and so is one missing — a partial unstamp is not a pass');

eq(aftermathOf(0, 0).state, 'noSessions', 'a run recording no sessions is its own answer');

// The reassuring reading is the one that costs a coach money, so nothing that
// is not a counted number may reach it.
for (const bad of [null, undefined, -1, 1.5, Number.NaN, '3' as unknown as number]) {
  eq(aftermathOf(5, bad as number | null | undefined).state, 'unknown',
    `a count of ${JSON.stringify(bad)} is unknown, never untouched`);
  eq(aftermathOf(bad as number | null | undefined, 5).state, 'unknown',
    `a claim of ${JSON.stringify(bad)} is unknown, never untouched`);
}

eq(aftermathOf(5, 5, new Error('permission denied')).state, 'unknown',
  'a read that errored is unknown even where a count came with it');
ok(say(aftermathOf(5, 5, new Error('permission denied for table sessions'))).includes('permission denied for table sessions'),
  'and the refusal is quoted rather than swallowed');
eq(aftermathOf(5, 5, {}).state, 'unknown',
  'an error object with no message is still an error');
ok(say(aftermathOf(5, 5, {})).includes('the read was refused'),
  'and says so rather than printing an empty reason');

eq(aftermathOf(3, 4).state, 'unknown',
  'more stamped than the run says it paid for is a disagreement, not an all-clear');

/* ── what the owner reads ──────────────────────────────────────────────────── */

// True at every failure point: the settlement is the last of the four writes,
// so nothing that threw can have marked it reversed.
for (const a of [
  aftermathOf(5, 5), aftermathOf(5, 0), aftermathOf(5, 2), aftermathOf(0, 0), aftermathOf(5, null),
]) {
  ok(say(a).includes('still stands as paid'),
    `every failure says the run still stands as paid (${a.state})`);
  ok(say(a).startsWith('That run was NOT reversed'),
    `and every one of them leads with the fact that it did not happen (${a.state})`);
}

const clear = say(aftermathOf(4, 4));
ok(clear.includes('all 4 sessions it paid for are still stamped against it'),
  'the all-clear says how many are still stamped');
ok(clear.includes('Pressing Reverse again is safe'),
  'and offers the retry, which is safe only here');
ok(!clear.includes('second time'), 'and raises no double-pay alarm, because there is none');

// The claim the old screen printed everywhere. It may appear ONLY where a count
// proved it, because it is the one state in which paying again is safe.
for (const a of [aftermathOf(5, 0), aftermathOf(5, 3), aftermathOf(0, 0), aftermathOf(5, null)]) {
  ok(!say(a).includes('nothing has come loose'),
    `nothing but the all-clear says nothing came loose (${a.state})`);
  ok(!say(a).includes('Pressing Reverse again is safe'),
    `and nothing but the all-clear calls the retry safe (${a.state})`);
}

const none = say(aftermathOf(6, 0));
ok(none.includes('none of the 6 sessions'), 'a wholly unstamped run says none are stamped');
ok(none.includes('a second time'), 'and names the double pay it is warning about');
ok(none.includes('will not finish the job'),
  'and refuses to send the owner back to a button that now refuses for ever');

const part = say(aftermathOf(5, 3));
ok(part.includes('3 of the 5 sessions'), 'a partial unstamp counts both halves');
ok(part.includes('the other 2 are not'), 'and says how many came loose');
ok(part.includes('a second time'), 'and warns about the same double pay');

const one = say(aftermathOf(5, 4));
ok(one.includes('That session is'), 'one loose session is singular');
ok(one.includes('that hour a second time'), 'and stays singular to the end of the sentence');
ok(!one.includes('1 sessions') && !one.includes('those 1'),
  'and never prints a plural over a count of one');

const noneAtAll = say(aftermathOf(0, 0));
ok(noneAtAll.includes('records no sessions'), 'a run with no sessions says so');
ok(noneAtAll.includes('class pay lines'),
  'and does not pretend the two line tables are accounted for');

const unknown = say(aftermathOf(5, null));
ok(unknown.includes('could not be checked'), 'an unread count says it was not read');
ok(!unknown.includes('Pressing Reverse again is safe'),
  'and never offers the all-clear it did not earn');
ok(unknown.includes('reloaded this page'), 'and says what to do instead');

// The reason arrives with or without its own full stop and is printed once.
ok(reversalFailureText('Nothing has been changed.', aftermathOf(5, 5)).includes('Nothing has been changed. It has not'),
  'a reason that ends in a full stop is not given a second one');
ok(reversalFailureText('Nothing has been changed', aftermathOf(5, 5)).includes('Nothing has been changed. It has not'),
  'and one that does not is given one');
ok(reversalFailureText('   ', aftermathOf(5, 5)).includes('the write was refused'),
  'an empty reason becomes a sentence rather than a gap after the colon');

if (errors.length) {
  console.error(`reversalState: ${errors.length} of ${checks} checks failed:`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`reversalState ok — ${checks} checks`);
