"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const calendarNames_1 = require("./calendarNames");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/** Whether this Node has more than English. A small-icu build answers every
 *  locale in English, and the cross-locale assertions below have nothing to say
 *  on one — so they are skipped rather than failed. */
const FULL_ICU = (() => {
    try {
        return new Intl.DateTimeFormat('de', { month: 'long' }).format(new Date(2026, 1, 15)) !== 'February';
    }
    catch {
        return false;
    }
})();
/* ── shape ─────────────────────────────────────────────────────────────── */
eq((0, calendarNames_1.monthNamesLong)('en-GB').length, 12, 'twelve months');
eq((0, calendarNames_1.weekdayNamesShort)('en-GB').length, 7, 'seven weekdays');
eq((0, calendarNames_1.weekdayNamesNarrow)('en-GB').length, 7, 'seven narrow weekdays');
for (const [what, arr] of [
    ['months', (0, calendarNames_1.monthNamesLong)('en-GB')],
    ['short weekdays', (0, calendarNames_1.weekdayNamesShort)('en-GB')],
    ['narrow weekdays', (0, calendarNames_1.weekdayNamesNarrow)('en-GB')],
]) {
    for (let i = 0; i < arr.length; i++) {
        ok(typeof arr[i] === 'string' && arr[i].trim().length > 0, `${what}: entry ${i} is a name, not a blank`);
    }
}
/* ── the order is this app's, and it does not move ─────────────────────── */
// Sunday first. `src/lib/weekStart.ts` is the rule and every grid that consumes
// these is built to it; localising the order would rotate them silently.
eq((0, calendarNames_1.weekdayNamesShort)('en-GB')[0], 'Sun', 'the week starts on Sunday');
eq((0, calendarNames_1.weekdayNamesShort)('en-GB')[6], 'Sat', 'and ends on Saturday');
eq((0, calendarNames_1.monthNamesLong)('en-GB')[0], 'January', 'January is first');
eq((0, calendarNames_1.monthNamesLong)('en-GB')[11], 'December', 'and December is twelfth');
if (FULL_ICU) {
    // Same positions, different words. This is the assertion that would have
    // caught the hardcoded arrays on the booking screen.
    const de = (0, calendarNames_1.weekdayNamesShort)('de-DE');
    eq(de.length, 7, 'a German week is still seven days');
    ok(de[0] !== 'Sun', 'and Sunday is not written "Sun" in it');
    ok((0, calendarNames_1.monthNamesLong)('de-DE')[0] !== 'January', 'nor January "January"');
    // The order held even though the words changed — a locale that starts its
    // week on Monday must not be allowed to rotate this array.
    const fr = (0, calendarNames_1.weekdayNamesShort)('fr-FR');
    ok(/^dim/i.test(fr[0]), 'the first French weekday is still Sunday, not Monday');
}
/* ── narrow is asked for, not sliced ───────────────────────────────────── */
// `d[0]` on a short name is wrong wherever a letter is not a character. English
// happens to agree with the slice, which is exactly why the bug survived: the
// assertion that matters is that a non-Latin locale gets its own narrow form
// rather than the first byte of a longer word.
if (FULL_ICU) {
    const ja = (0, calendarNames_1.weekdayNamesNarrow)('ja-JP');
    for (let i = 0; i < 7; i++) {
        ok(ja[i].trim().length > 0, `a Japanese narrow weekday ${i} is a name`);
    }
    ok(ja[0] !== 'S', 'and it is the locale’s own narrow form, not an English initial');
    // Several locales write a narrow weekday in more than one character, which is
    // the case a `.slice(0, 1)` on a short name gets wrong even in Latin script.
    ok((0, calendarNames_1.weekdayNamesNarrow)('hu-HU').concat((0, calendarNames_1.weekdayNamesNarrow)('zh-CN')).every((s) => s.trim().length > 0), 'every narrow weekday in two more locales is a name');
}
/* ── the cache answers per locale, not once for the app ────────────────── */
// Keyed on the tag, so a handset whose locale changes is not answered with the
// names it had at launch.
// This compared `monthNamesLong('en-GB')[5]` to itself — two calls, but the
// same locale asked twice in a row, which is true of a cache keyed on the tag,
// a cache keyed on nothing, and no cache at all. What has to hold is that the
// tag is the KEY: the locales are interleaved below, so a cache that answers
// from whichever tag it saw first fails here rather than in somebody's hands.
{
    const en = (0, calendarNames_1.monthNamesLong)('en-GB');
    eq((0, calendarNames_1.monthNamesLong)('en-GB'), en, 'the same locale is answered with the one array rather than a rebuilt copy');
    if (FULL_ICU) {
        const es = (0, calendarNames_1.monthNamesLong)('es-ES');
        ok(es[0] !== en[0], 'a second locale asked after the first is not handed the first one’s names');
        ok(es !== en, 'and the two are two arrays, not one shared between every tag');
        eq((0, calendarNames_1.monthNamesLong)('en-GB'), en, 'and asking for the second neither evicts nor overwrites the first');
    }
}
// One array is shared by every caller for the life of the process, so a caller
// that sorted it in place would rewrite the weekday row for every screen in the
// app. Frozen, that is a throw at the call site rather than a silent rotation.
const a = (0, calendarNames_1.weekdayNamesShort)('en-GB');
const b = (0, calendarNames_1.weekdayNamesShort)('en-GB');
eq(a, b, 'the cache hands back the one array rather than rebuilding it');
ok(Object.isFrozen(a), 'and it is frozen, so nothing downstream can reorder the week');
ok(Object.isFrozen((0, calendarNames_1.monthNamesLong)('en-GB')), 'the months likewise');
ok(Object.isFrozen((0, calendarNames_1.weekdayNamesNarrow)('en-GB')), 'and the narrow weekdays');
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('calendarNames.test.ts — ok');
