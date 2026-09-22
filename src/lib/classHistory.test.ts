// The class ids the server says are the member's, and the sentences that
// follow from having asked.
//
// The point of this module is that attendance.tsx stops GUESSING why a class
// would not open, so most of what is asserted here is that the three answers
// are three different sentences and that the old guess is not one of them.
//
// Compile with tsc, then run under plain node.
import {
  fetchMyClassHistory, classesNotShown, unopenedClassesLine, missingClassesLine,
} from './classHistory';
import { ROW_CAP } from './rowCap';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (got: unknown, want: unknown, msg: string) => {
  if (got !== want) errors.push(`${msg} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

/* ── 1 · which classes are on screen nowhere ──────────────────────────────── */

eq(classesNotShown(['a', 'b', 'c'], ['a', 'b', 'c']).length, 0, 'a timeline holding every class is missing none');
eq(classesNotShown(['a', 'b', 'c'], ['a']).join(','), 'b,c', 'the ones nothing on screen represents');
eq(classesNotShown([], ['a']).length, 0, 'an empty history misses nothing');
// An event drawn as "a class we could not read" is still an event the member
// can see. Counting it as missing as well would report it twice.
eq(classesNotShown(['a'], ['a']).length, 0, 'an unopened but visible class is not also a missing one');
eq(classesNotShown(['a', 'a', 'b'], []).join(','), 'a,b', 'a repeated id is reported once');
eq(classesNotShown(['a', ''], []).join(','), 'a', 'an empty id is not a class');

/* ── 2 · the sentence under the unopened classes ──────────────────────────── */

// The guess this whole module exists to remove. Part 136 made a former gym's
// classes readable, so "a gym you are no longer with" stopped being the usual
// reason and started being a false explanation of somebody's own record.
for (const line of [
  unopenedClassesLine(3, null),
  unopenedClassesLine(3, 3),
  unopenedClassesLine(3, 1),
]) {
  ok(line != null, 'there is a sentence for every case');
  ok(!/no longer with/.test(line ?? ''), 'and none of them repeats the old guess');
  ok(/still (yours|on record)/.test(line ?? ''), 'each one says the attendance itself is still the member\'s');
}

// Three cases, three sentences. If any two of these were equal the check would
// be decorative.
{
  const couldNotAsk = unopenedClassesLine(3, null)!;
  const allMine = unopenedClassesLine(3, 3)!;
  const someNot = unopenedClassesLine(3, 1)!;
  ok(couldNotAsk !== allMine, 'not having asked reads differently from having asked');
  ok(allMine !== someNot, 'and a deleted class reads differently from one out of reach');
  ok(couldNotAsk !== someNot, 'and so do the other two');
  // The one case where the reason genuinely is about access is the only one
  // that says so.
  ok(/not allowed/.test(someNot), 'only the access case mentions permission');
  ok(!/not allowed/.test(allMine), 'a class the server agrees is yours is not described as forbidden');
  ok(/removed/.test(allMine), 'it is described as removed from the timetable');
}

eq(unopenedClassesLine(0, 0), null, 'nothing unopened, nothing to explain');
eq(unopenedClassesLine(-1, 0), null, 'and a nonsense count says nothing');
eq(unopenedClassesLine(NaN, 0), null, 'nor does one we do not have');
// More confirmed than unopened cannot happen, but it must not read as the
// access case if it ever does.
ok(/removed/.test(unopenedClassesLine(2, 5) ?? ''), 'a confirmation that covers them all is the removed case');

/* ── 3 · classes this screen is not showing at all ────────────────────────── */

eq(missingClassesLine(0, false), null, 'nothing missing, nothing said');
eq(missingClassesLine(NaN, false), null, 'and a figure we do not have is not printed');
ok(/4 more classes/.test(missingClassesLine(4, false) ?? ''), 'the count is stated');
ok(/1 more class\b/.test(missingClassesLine(1, false) ?? ''), 'one class is not "1 more classs"');
// A truncated read gives a FLOOR, never a total. This screen refuses to state a
// total it cannot stand behind anywhere else and must refuse here too.
ok(/at least/.test(missingClassesLine(4, true) ?? ''), 'a truncated history is a floor, not a total');
ok(!/at least/.test(missingClassesLine(4, false) ?? ''), 'and a whole one is not hedged');
ok(/missing from your record/.test(missingClassesLine(4, false) ?? ''), 'and it says the record itself is intact');

/* ── 4 · reading the function ─────────────────────────────────────────────── */

/** An `sb.rpc()` double whose builder is thenable, like the real one. */
const rpcStub = (answer: { data?: unknown; error?: unknown }) => {
  const calls: { fn: string; limit: number | null }[] = [];
  return {
    calls,
    sb: {
      rpc: (fn: string) => {
        calls.push({ fn, limit: null });
        const self: any = {
          limit: (n: number) => { calls[calls.length - 1].limit = n; return self; },
          then: (res: (v: unknown) => unknown) => Promise.resolve(answer).then(res),
        };
        return self;
      },
    },
  };
};

(async () => {
  {
    const { sb, calls } = rpcStub({ data: ['a', 'b'], error: null });
    const res = await fetchMyClassHistory(sb);
    eq(res.ok, true, 'a bare array of uuids reads');
    eq(res.ok && res.value.ids.join(','), 'a,b', 'as the ids');
    eq(res.ok && res.value.truncated, false, 'and a short answer is whole');
    eq(calls[0]?.fn, 'my_class_history', 'the function part 136 wrote is the one called');
    eq(calls[0]?.limit, ROW_CAP + 1, 'asked for one row past the cap, so a truncated set can be seen');
  }

  // The wrapped shape. Read as bare strings this would be a list of undefined,
  // and every class on the timeline would look like one the server does not
  // recognise — which is the most alarming thing this screen could say.
  {
    const { sb } = rpcStub({ data: [{ my_class_history: 'a' }, { my_class_history: 'b' }], error: null });
    const res = await fetchMyClassHistory(sb);
    eq(res.ok && res.value.ids.join(','), 'a,b', 'and so does the object-wrapped shape');
  }

  // A refused read is never an empty history. `{ ok: false }` must not be
  // reachable as "the server says none of these are yours".
  {
    const { sb } = rpcStub({ data: null, error: { message: 'refused' } });
    const res = await fetchMyClassHistory(sb);
    eq(res.ok, false, 'a refused read refuses');
    eq(!res.ok && /refused/.test(res.reason), true, 'and carries the reason');
  }
  {
    const { sb } = rpcStub({ data: [], error: null });
    const res = await fetchMyClassHistory(sb);
    eq(res.ok, true, 'a member with no classes is a real answer');
    eq(res.ok && res.value.ids.length, 0, 'and it is empty');
  }

  // Past the ceiling. PostgREST applies its row limit to a set-returning
  // function exactly as it does to a table.
  {
    const many = Array.from({ length: ROW_CAP + 1 }, (_, i) => `id-${i}`);
    const { sb } = rpcStub({ data: many, error: null });
    const res = await fetchMyClassHistory(sb);
    eq(res.ok && res.value.truncated, true, 'a full page is reported as truncated');
    eq(res.ok && res.value.ids.length, ROW_CAP, 'and the extra probe row is not counted');
  }

  if (errors.length) {
    console.error(`classHistory.test.ts — ${errors.length} failure(s):`);
    for (const e of errors) console.error('  · ' + e);
    process.exit(1);
  }
  console.log('classHistory.test.ts — ok');
})();
