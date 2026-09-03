"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The ids a person has already dealt with. Compile with tsc, run with node.
//
// The failure guarded here is not a wrong sentence on a screen — it is the app
// spinning. `src/ui/invites.tsx` reloaded this set on every read and called
// `setDismissed(new Set(...))` unconditionally, so a reload that learnt nothing
// was still a state change, so the provider re-rendered, so its context value
// and the `reload` function inside it were new objects. The coach dashboard
// collects fourteen such reloads into one `useCallback` and hands it to
// `useRefreshOnFocus`, which re-runs whenever its callback's identity changes:
// focus → reload → new identity → focus effect again, without end.
//
// So three things are held here:
//
//   1. A RELOAD THAT LEARNT NOTHING RETURNS THE OBJECT IT ALREADY HAD.
//      `nextDismissed` must return `prev` ITSELF, not an equal copy — an equal
//      copy is a re-render and the loop is back.
//   2. A CHANGE IS STILL A CHANGE. Added or removed, the new set comes through,
//      or a handled invitation reappears.
//   3. STORED BYTES ARE NOT TRUSTED. Anything that is not a JSON array of
//      strings is an empty set, and a non-string member is dropped rather than
//      coerced — `String(null)` is "null", which would look like an id.
const dismissedSet_1 = require("./dismissedSet");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
const ids = (s) => [...s].sort().join(',');
/* ── 3 · what comes off the device ─────────────────────────────────────── */
{
    eq(ids((0, dismissedSet_1.parseDismissed)('["a","b"]')), 'a,b', 'a stored list reads back');
    eq((0, dismissedSet_1.parseDismissed)(null).size, 0, 'nothing stored is an empty set');
    eq((0, dismissedSet_1.parseDismissed)(undefined).size, 0, 'and so is undefined');
    eq((0, dismissedSet_1.parseDismissed)('{not json').size, 0, 'bytes that are not JSON are an empty set, not a crash');
    eq((0, dismissedSet_1.parseDismissed)('{"a":1}').size, 0, 'JSON that is not an array is an empty set');
    eq((0, dismissedSet_1.parseDismissed)('"a"').size, 0, 'nor is a bare string one id');
    eq(ids((0, dismissedSet_1.parseDismissed)('["a",null,3,"",{"x":1},"b"]')), 'a,b', 'a member that is not a non-empty string is dropped, never coerced: an id of "null" would look like a match');
}
/* ── the comparison ────────────────────────────────────────────────────── */
{
    const s = new Set(['a']);
    ok((0, dismissedSet_1.sameIds)(s, s), 'a set is the same as itself');
    ok((0, dismissedSet_1.sameIds)(new Set(['a', 'b']), new Set(['b', 'a'])), 'order is not part of the answer');
    ok(!(0, dismissedSet_1.sameIds)(new Set(['a']), new Set(['a', 'b'])), 'a set that grew is not the same');
    ok(!(0, dismissedSet_1.sameIds)(new Set(['a', 'b']), new Set(['a'])), 'nor one that shrank');
    ok(!(0, dismissedSet_1.sameIds)(new Set(['a', 'b']), new Set(['a', 'c'])), 'nor the same size with a different member');
    ok((0, dismissedSet_1.sameIds)(new Set(), new Set()), 'two empty sets are the same');
}
/* ── 1 · a reload that learnt nothing ──────────────────────────────────── */
{
    const prev = new Set(['a', 'b']);
    // `Object.is`, deliberately. An equal copy would pass a deep comparison and
    // fail the only thing that matters: React compares state by identity, so an
    // equal copy re-renders every consumer and the loop this file exists for is
    // back.
    eq((0, dismissedSet_1.nextDismissed)(prev, new Set(['b', 'a'])), prev, 'an unchanged reload returns the object already held, not an equal copy');
    const empty = new Set();
    eq((0, dismissedSet_1.nextDismissed)(empty, new Set()), empty, 'and that holds when there is nothing in it — the ordinary case on a fresh install');
    let held = new Set(['a', 'b']);
    const first = held;
    for (let i = 0; i < 50; i += 1)
        held = (0, dismissedSet_1.nextDismissed)(held, new Set(['a', 'b']));
    eq(held, first, 'fifty identical reloads produce one object: fifty is React’s nested-update ceiling, and this is the loop that used to reach it');
}
/* ── 2 · a change is still a change ────────────────────────────────────── */
{
    const prev = new Set(['a']);
    const grown = new Set(['a', 'b']);
    eq((0, dismissedSet_1.nextDismissed)(prev, grown), grown, 'an id added comes through');
    const shrunk = new Set(['a']);
    eq((0, dismissedSet_1.nextDismissed)(new Set(['a', 'b']), shrunk), shrunk, 'and an id removed — another device declined something, and this one has to hear');
}
/* ── one more handled ──────────────────────────────────────────────────── */
{
    const prev = new Set(['a']);
    const out = (0, dismissedSet_1.withDismissed)(prev, 'b');
    eq(ids(out), 'a,b', 'the new id is in');
    ok(out !== prev, 'and it is a new set, because the state genuinely changed');
    eq(ids(prev), 'a', 'the set handed in is left alone');
    eq((0, dismissedSet_1.withDismissed)(prev, 'a'), prev, 'handling the same invitation twice does not produce a second render');
    eq((0, dismissedSet_1.withDismissed)(prev, ''), prev, 'and an empty id is not an id');
}
/* ── the bytes ─────────────────────────────────────────────────────────── */
{
    eq((0, dismissedSet_1.packDismissed)(new Set(['b', 'a', 'c'])), '["a","b","c"]', 'stored sorted');
    eq((0, dismissedSet_1.packDismissed)(new Set(['b', 'a'])), (0, dismissedSet_1.packDismissed)(new Set(['a', 'b'])), 'so the same ids in a different order write identical bytes');
    eq((0, dismissedSet_1.packDismissed)(new Set()), '[]', 'an empty set is a real answer and is written as one');
    const round = new Set(['x', 'y', 'z']);
    ok((0, dismissedSet_1.sameIds)((0, dismissedSet_1.parseDismissed)((0, dismissedSet_1.packDismissed)(round)), round), 'and what goes in comes back');
}
if (errors.length) {
    console.error(`dismissedSet: ${errors.length} failure${errors.length === 1 ? '' : 's'}`);
    for (const e of errors)
        console.error(`  ✗ ${e}`);
    process.exit(1);
}
console.log('dismissedSet: ok');
