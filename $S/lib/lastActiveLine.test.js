"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The client sheet's "last active" sentence — one assertion per shape the
// roster can hand it, because four of the five used to come out as broken
// English and one of those four was a failed read wearing an inactive client's
// clothes.
//
// Starts at exit code 1 and only clears it on the last line, so a hang or an
// early return cannot pass silently.
//
// Compile with tsc, run with node.
process.exitCode = 1;
const lastActiveLine_1 = require("./lastActiveLine");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── every return is a whole sentence ──────────────────────────────────────
 *
 * The caller writes another sentence straight after this one, so a return that
 * does not end in a full stop is two sentences run together on a coach's
 * screen. This is the assertion the original concatenation could never have
 * passed: "Last active no activity yet." is a full stop on a fragment.
 */
const ALL = ['3d ago', '2h ago', '45m ago', 'no activity yet', 'added by you', 'just added', '—', '', null, undefined];
for (const v of ALL) {
    const s = (0, lastActiveLine_1.lastActiveLine)(v);
    ok(s.length > 0, `a sentence is always produced — ${JSON.stringify(v)}`);
    ok(s.trim().endsWith('.'), `it ends in a full stop — ${JSON.stringify(v)} gave ${JSON.stringify(s)}`);
    ok(/^[A-Z]/.test(s), `and starts with a capital — ${JSON.stringify(v)} gave ${JSON.stringify(s)}`);
}
/* ── the one shape the old sentence fitted ─────────────────────────────── */
eq((0, lastActiveLine_1.lastActiveLine)('3d ago'), 'Last active 3d ago.', 'an aged value still reads the way it always did');
eq((0, lastActiveLine_1.lastActiveLine)('45m ago'), 'Last active 45m ago.', 'and minutes as well as days');
/* ── a failed read is never quietness ──────────────────────────────────────
 *
 * The dash is what src/ui/roster.tsx writes when the stats page came back
 * truncated. "Last active —." reads as a client who has gone quiet, which is
 * the recurring bug src/ui/loadStatus.ts exists to name: an unread figure and a
 * zero are different facts and may not share a sentence.
 */
for (const unread of ['—', '', null, undefined]) {
    const s = (0, lastActiveLine_1.lastActiveLine)(unread);
    ok(/could not be read/.test(s), `an unread value says so — ${JSON.stringify(unread)} gave ${JSON.stringify(s)}`);
    ok(!/^Last active/.test(s), `and does not claim a date — ${JSON.stringify(unread)}`);
    ok(/not a statement that they have been quiet/.test(s), `and refuses the inference a coach would otherwise draw — ${JSON.stringify(unread)}`);
}
/* ── nothing recorded, and nothing there to record ──────────────────────────
 *
 * Told apart on purpose. A client with an account and an empty record is a
 * person who has not trained; somebody the coach typed in by hand has no
 * account behind them at all, so there is no activity for them to be missing
 * and "no activity yet" about them would read as a client who had stopped.
 */
eq((0, lastActiveLine_1.lastActiveLine)('no activity yet'), 'Nothing has been recorded for them yet.', 'an empty record says so plainly');
for (const hand of ['added by you', 'just added']) {
    const s = (0, lastActiveLine_1.lastActiveLine)(hand);
    ok(/added them by hand/.test(s), `a hand-added client is described as one — ${hand} gave ${JSON.stringify(s)}`);
    ok(s !== (0, lastActiveLine_1.lastActiveLine)('no activity yet'), `and is NOT collapsed into "nothing recorded" — ${hand}`);
}
/* ── whitespace is not a fifth state ───────────────────────────────────── */
eq((0, lastActiveLine_1.lastActiveLine)('  3d ago  '), 'Last active 3d ago.', 'padding is trimmed rather than printed');
eq((0, lastActiveLine_1.lastActiveLine)('   '), (0, lastActiveLine_1.lastActiveLine)(null), 'a blank string is the unread case, not an aged one');
if (errors.length) {
    console.error(`lastActiveLine: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  · ${e}`);
    process.exit(1);
}
console.log('lastActiveLine: ok — four of the five roster shapes used to read as broken English, and the dash read as a quiet client');
process.exitCode = 0;
