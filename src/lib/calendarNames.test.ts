// The names down the side of a month grid.
// Compile with tsc, run with node.
//
// Three things are worth asserting and nothing else is:
//
//   · the ORDER is Sunday-first and does not move with the locale, because the
//     grids that consume these are built Sunday-first in their own arithmetic
//     and a rotated name row files Monday's session under Sunday's column;
//   · the WORDS do move with the locale, which is the whole point;
//   · every entry is a non-empty string, because a blank cell in a weekday row
//     is worse than an English one.
//
// The actual strings a locale produces are ICU's business and are not asserted
// beyond the one language every Node build carries. An assertion that "février"
// is what fr writes would be a test of the runner's ICU data, and would start
// failing on a build with a small-icu binary for no reason a reader could act
// on.
import { monthNamesLong, weekdayNamesShort, weekdayNamesNarrow } from './calendarNames';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/** Whether this Node has more than English. A small-icu build answers every
 *  locale in English, and the cross-locale assertions below have nothing to say
 *  on one — so they are skipped rather than failed. */
const FULL_ICU = (() => {
  try { return new Intl.DateTimeFormat('de', { month: 'long' }).format(new Date(2026, 1, 15)) !== 'February'; }
  catch { return false; }
})();

/* ── shape ─────────────────────────────────────────────────────────────── */

eq(monthNamesLong('en-GB').length, 12, 'twelve months');
eq(weekdayNamesShort('en-GB').length, 7, 'seven weekdays');
eq(weekdayNamesNarrow('en-GB').length, 7, 'seven narrow weekdays');

for (const [what, arr] of [
  ['months', monthNamesLong('en-GB')],
  ['short weekdays', weekdayNamesShort('en-GB')],
  ['narrow weekdays', weekdayNamesNarrow('en-GB')],
] as const) {
  for (let i = 0; i < arr.length; i++) {
    ok(typeof arr[i] === 'string' && arr[i].trim().length > 0,
      `${what}: entry ${i} is a name, not a blank`);
  }
}

/* ── the order is this app's, and it does not move ─────────────────────── */

// Sunday first. `src/lib/weekStart.ts` is the rule and every grid that consumes
// these is built to it; localising the order would rotate them silently.
eq(weekdayNamesShort('en-GB')[0], 'Sun', 'the week starts on Sunday');
eq(weekdayNamesShort('en-GB')[6], 'Sat', 'and ends on Saturday');
eq(monthNamesLong('en-GB')[0], 'January', 'January is first');
eq(monthNamesLong('en-GB')[11], 'December', 'and December is twelfth');

if (FULL_ICU) {
  // Same positions, different words. This is the assertion that would have
  // caught the hardcoded arrays on the booking screen.
  const de = weekdayNamesShort('de-DE');
  eq(de.length, 7, 'a German week is still seven days');
  ok(de[0] !== 'Sun', 'and Sunday is not written "Sun" in it');
  ok(monthNamesLong('de-DE')[0] !== 'January', 'nor January "January"');
  // The order held even though the words changed — a locale that starts its
  // week on Monday must not be allowed to rotate this array.
  const fr = weekdayNamesShort('fr-FR');
  ok(/^dim/i.test(fr[0]), 'the first French weekday is still Sunday, not Monday');
}

/* ── narrow is asked for, not sliced ───────────────────────────────────── */

// `d[0]` on a short name is wrong wherever a letter is not a character. English
// happens to agree with the slice, which is exactly why the bug survived: the
// assertion that matters is that a non-Latin locale gets its own narrow form
// rather than the first byte of a longer word.
if (FULL_ICU) {
  const ja = weekdayNamesNarrow('ja-JP');
  for (let i = 0; i < 7; i++) {
    ok(ja[i].trim().length > 0, `a Japanese narrow weekday ${i} is a name`);
  }
  ok(ja[0] !== 'S', 'and it is the locale’s own narrow form, not an English initial');
  // Several locales write a narrow weekday in more than one character, which is
  // the case a `.slice(0, 1)` on a short name gets wrong even in Latin script.
  ok(weekdayNamesNarrow('hu-HU').concat(weekdayNamesNarrow('zh-CN')).every((s) => s.trim().length > 0),
    'every narrow weekday in two more locales is a name');
}

/* ── the cache answers per locale, not once for the app ────────────────── */

// Keyed on the tag, so a handset whose locale changes is not answered with the
// names it had at launch.
eq(monthNamesLong('en-GB')[5], monthNamesLong('en-GB')[5], 'the same locale answers the same twice');
if (FULL_ICU) {
  ok(monthNamesLong('es-ES')[0] !== monthNamesLong('en-GB')[0],
    'and a second locale asked after the first is not handed the first one’s names');
}

// One array is shared by every caller for the life of the process, so a caller
// that sorted it in place would rewrite the weekday row for every screen in the
// app. Frozen, that is a throw at the call site rather than a silent rotation.
const a = weekdayNamesShort('en-GB');
const b = weekdayNamesShort('en-GB');
eq(a, b, 'the cache hands back the one array rather than rebuilding it');
ok(Object.isFrozen(a), 'and it is frozen, so nothing downstream can reorder the week');
ok(Object.isFrozen(monthNamesLong('en-GB')), 'the months likewise');
ok(Object.isFrozen(weekdayNamesNarrow('en-GB')), 'and the narrow weekdays');

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('calendarNames.test.ts — ok');
