// Which locale the app writes in, and what the formatters do once it knows.
// Compile with tsc, run with node.
//
// The defect these pin: `num()` was hardcoded to en-GB, so a member in Berlin
// read a 2,860 kcal day as "2.860" — which in German is 2.86, not a large
// number with a separator. Their whole day's food, wrong by a factor of a
// thousand, on the screen whose only job is to say how much they have eaten.
// Every assertion about a German or French figure below is that bug.
//
// Two things are deliberately NOT asserted. The exact glyphs a locale uses for
// a month name are CLDR's business and change between ICU versions, so the date
// assertions pin the DAY NUMBER and the ordering rather than the spelling. And
// nothing here asserts what the machine running the test is set to: every case
// states its locale, because a test that reads the runner's own settings passes
// or fails for reasons that have nothing to do with this code.
import {
  FALLBACK_LOCALE, appLocale, isWellFormedLocale, localeNote, localeSource,
  normaliseLocale, prefers12Hour, resolveLocale, setAppLocale,
} from './locale';
import { fmtAxisDay, fmtClock, fmtDay, fmtFullDay, fmtPointDay, fmtRelativeDay, monthNamesShort, isoDate, num, num1, num2, numUpTo } from './format';

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };
const eq = (a: unknown, b: unknown, msg: string) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

/* ── what counts as a tag we may hand to Intl ─────────────────────────────── */

// A malformed tag is not a bad guess, it is a RangeError out of the Intl
// constructor — inside num(), which means a screen that renders no figures at
// all rather than foreign-looking ones.
ok(isWellFormedLocale('en'), 'a bare language is a tag');
ok(isWellFormedLocale('en-GB'), 'language and region is a tag');
ok(isWellFormedLocale('ar-Arab-AE'), 'language, script and region is a tag');
ok(isWellFormedLocale('en-US-u-ca-gregory'), 'an extension sequence is still a tag');
ok(!isWellFormedLocale('C'), 'the POSIX C locale is not a tag');
ok(!isWellFormedLocale('POSIX'), 'POSIX is not a tag');
ok(!isWellFormedLocale('en_US.UTF-8'), 'a POSIX locale with a charset on it is not a tag');
ok(!isWellFormedLocale(''), 'an empty string is not a tag');
ok(!isWellFormedLocale(null), 'null is not a tag');
ok(!isWellFormedLocale(undefined), 'undefined is not a tag');
ok(!isWellFormedLocale('e'), 'one letter is not a language');

// Android skins and simulator images hand back the underscore form.
eq(normaliseLocale('en_US'), 'en-US', 'an underscore tag is normalised');
eq(normaliseLocale('  fr_CA '), 'fr-CA', 'surrounding space is trimmed');
eq(normaliseLocale(null), '', 'nothing normalises to nothing');
ok(isWellFormedLocale('en_US'), 'the underscore form is accepted once normalised');

/* ── resolution, and saying which of the two happened ─────────────────────── */

eq(resolveLocale('de-DE').locale, 'de-DE', 'a readable handset locale is used');
eq(resolveLocale('de-DE').source, 'device', 'and is reported as the handset');
eq(resolveLocale('en_AU').locale, 'en-AU', 'the underscore form resolves to the hyphen form');
eq(resolveLocale(null).locale, FALLBACK_LOCALE, 'an unreadable platform falls back');
eq(resolveLocale(null).source, 'fallback', 'and the fallback is reported as one');
eq(resolveLocale('C').source, 'fallback', 'a POSIX locale is not a reader');

// The fallback is not a default. A screen is entitled to say so, and is
// entitled to say nothing when there is nothing to admit.
eq(localeNote('device'), null, 'nothing is said when the handset answered');
ok((localeNote('fallback') || '').length > 0, 'the fallback is admitted to in words');

/* ── the latch ───────────────────────────────────────────────────────────── */

setAppLocale('fr-CA');
eq(appLocale(), 'fr-CA', 'the latch holds what it was seeded with');
eq(localeSource(), 'device', 'and where it came from');
setAppLocale(null);
eq(appLocale(), FALLBACK_LOCALE, 're-seeding with nothing falls back');
eq(localeSource(), 'fallback', 'and says so');

/* ── figures ─────────────────────────────────────────────────────────────── */

setAppLocale('en-GB');
eq(num(2860), '2,860', 'a British reader gets a comma');
eq(num1(73.5), '73.5', 'and a point for the tenth');

setAppLocale('de-DE');
eq(num(2860), '2.860', 'a German reader gets a full stop as the thousands mark');
eq(num1(73.5), '73,5', 'and a comma as the decimal mark');

setAppLocale('en-US');
eq(num(2860), '2,860', 'an American reader gets a comma');

// Unchanged by any of it: nothing is a dash, never a zero and never "NaN".
eq(num(null), '—', 'a missing figure is a dash in every locale');
eq(num1(undefined), '—', 'so is a missing tenth');
eq(num(NaN), '—', 'and so is NaN');

/* ── the clock ───────────────────────────────────────────────────────────── */

// en-GB is a 24-hour locale and en-AU is a 12-hour one. Both are English, which
// is why the question is asked of Intl rather than of a table of countries.
ok(!prefers12Hour('en-GB'), 'the United Kingdom reads a 24-hour clock');
ok(prefers12Hour('en-US'), 'the United States reads a 12-hour clock');
ok(prefers12Hour('en-AU'), 'Australia reads a 12-hour clock, in the same language as the UK');

setAppLocale('en-US');
// The separator before the day period is the locale's own — en-US writes a
// space there — and only the case of the word itself is the app's choice.
eq(fmtClock(19, 0), '7 pm', 'a whole hour drops its minutes on a 12-hour clock');
eq(fmtClock(7, 30), '7:30 am', 'and keeps them when there are any');
eq(fmtClock(0, 5), '12:05 am', 'midnight is 12, not 0, on a 12-hour clock');
eq(fmtClock(12, 0), '12 pm', 'and so is noon');

setAppLocale('en-GB');
// "19" on its own is not a time, so the whole-hour trim is 12-hour only.
eq(fmtClock(19, 0), '19:00', 'a 24-hour clock keeps its minutes on the hour');
eq(fmtClock(7, 30), '7:30', 'and carries no am/pm');
ok(!/am|pm/i.test(fmtClock(19, 30)), 'nothing English is glued onto a 24-hour time');

eq(fmtClock(NaN, 0), '—', 'an unreadable hour is a dash, not a time');

/* ── dates, and the off-by-one this repo has shipped twice ───────────────── */

// The whole point of routing fmtDay through localDate. `new Date('2026-08-01')`
// is UTC midnight, which every getter west of Greenwich reads back as 31 July —
// and `npm run test:zones` runs this file under America/Los_Angeles.
setAppLocale('en-GB');
ok(/\b1\b/.test(fmtDay('2026-08-01')), `a bare date keeps its day number — got ${fmtDay('2026-08-01')}`);
ok(!/\b31\b/.test(fmtDay('2026-08-01')), `and does not slip to the day before — got ${fmtDay('2026-08-01')}`);
ok(/\b1\b/.test(fmtPointDay(2026, 7, 1)), 'a chart readout keeps its day number');
ok(/2026/.test(fmtPointDay(2026, 7, 1)), 'and carries the year it was given');
ok(/\b14\b/.test(fmtAxisDay(2026, 7, 14)), 'an axis label keeps its day number');
eq(fmtDay('not a date'), '—', 'an unreadable date is a dash, not a guess');

// Ordering, which is the visible half of following the reader. en-GB puts the
// day first and en-US puts the month first, and the spelling of the month is
// left to CLDR.
setAppLocale('en-GB');
const gb = fmtAxisDay(2026, 7, 14);
setAppLocale('en-US');
const us = fmtAxisDay(2026, 7, 14);
ok(gb.indexOf('14') < gb.search(/[A-Za-z]/), `a British axis label leads with the day — got ${gb}`);
ok(us.search(/[A-Za-z]/) < us.indexOf('14'), `an American one leads with the month — got ${us}`);

/* ── "Today", "Tomorrow", and the four copies that were neither ─────────── */

// Four screens carried a private `dayLabel` ending
// `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`, with DOW a hardcoded
// English array. "Wed 9/12" is 9 December to a British reader and 12 September
// to an American one, and that string went into every cancel confirmation on
// those screens.
const NOON = new Date(2026, 8, 2, 12, 0, 0);          // Wed 2 Sep 2026, local
const LATE = new Date(2026, 8, 2, 23, 30, 0);
const iso = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();

setAppLocale('en-GB');
eq(fmtRelativeDay(iso(2026, 8, 2), NOON), 'Today', 'the day the reader is in is named, not dated');
eq(fmtRelativeDay(iso(2026, 8, 3), NOON), 'Tomorrow', 'and so is the next one');

// The comparison is on the local calendar date, not on a 24-hour difference.
// 23:30 tonight and 01:00 tomorrow are two hours apart and one day apart, and
// it is the day the reader means.
eq(fmtRelativeDay(iso(2026, 8, 3, 1), LATE), 'Tomorrow',
  'ninety minutes after midnight is tomorrow, not today');
eq(fmtRelativeDay(iso(2026, 8, 2, 1), LATE), 'Today',
  'and twenty-two hours earlier the same date is still today');

// The defect itself: the day number, the month and their ORDER all follow the
// reader. 9 December must not read as 12 September.
setAppLocale('en-GB');
const dGB = fmtRelativeDay(iso(2026, 11, 9), NOON);
setAppLocale('en-US');
const dUS = fmtRelativeDay(iso(2026, 11, 9), NOON);
ok(!/\d+\/\d+/.test(dGB), `no bare numeric date survives — got ${dGB}`);
ok(!/\d+\/\d+/.test(dUS), `in either locale — got ${dUS}`);
ok(dGB.indexOf('9') < dGB.search(/Dec/), `a British reader gets the day first — got ${dGB}`);
ok(dUS.search(/Dec/) < dUS.indexOf('9'), `an American reader gets the month first — got ${dUS}`);

setAppLocale('fr-FR');
const dFR = fmtRelativeDay(iso(2026, 11, 9), NOON);
ok(!/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(dFR),
  `no English weekday is glued onto a French date — got ${dFR}`);

setAppLocale('en-GB');
eq(fmtRelativeDay('not a date', NOON), '—', 'an unreadable date is a dash, not "Today"');

// Bare `YYYY-MM-DD` goes through localDate for the same reason fmtDay does:
// `new Date('2026-08-01')` is UTC midnight and reads back as 31 July west of
// Greenwich, and test:zones runs this file under America/Los_Angeles.
ok(/\b1\b/.test(fmtRelativeDay('2026-08-01', NOON)),
  `a bare date keeps its day number — got ${fmtRelativeDay('2026-08-01', NOON)}`);

/* ── the month names a picker scrolls through ───────────────────────────── */

// Two screens carried their own hardcoded English `MONTHS` array — the
// dashboard's date line and the date-of-birth wheel. The wheel is the one place
// a LIST of month names is still the right shape, so it gets one, in the
// reader's language.
setAppLocale('en-GB');
const mEN = monthNamesShort();
eq(mEN.length, 12, 'twelve months, indexed the way Date#getMonth is');
ok(/Jan/.test(mEN[0]), `January is index 0 — got ${mEN[0]}`);
ok(/Dec/.test(mEN[11]), `and December is index 11 — got ${mEN[11]}`);

setAppLocale('fr-FR');
const mFR = monthNamesShort();
eq(mFR.length, 12, 'still twelve in another language');
ok(mFR[7] !== mEN[7], `and they are not the English ones — got ${mFR[7]} for August`);
eq(new Set(mFR).size >= 11, true, 'and they are distinct from each other');

/* ── a date of birth, which is a bare date column ───────────────────────── */

setAppLocale('en-GB');
ok(/\b14\b/.test(fmtFullDay('1990-05-14')),
  `a bare date keeps its day number — got ${fmtFullDay('1990-05-14')}`);
ok(!/\b13\b/.test(fmtFullDay('1990-05-14')),
  `and does not slip to the day before west of Greenwich — got ${fmtFullDay('1990-05-14')}`);
ok(/1990/.test(fmtFullDay('1990-05-14')), 'a date of birth carries its year');
eq(fmtFullDay('not a date'), '—', 'and an unreadable one is a dash');

setAppLocale('en-US');
const bUS = fmtFullDay('1990-05-14');
setAppLocale('en-GB');
const bGB = fmtFullDay('1990-05-14');
ok(bGB.indexOf('14') < bGB.search(/[A-Za-z]/), `a British reader gets the day first — got ${bGB}`);
ok(bUS.search(/[A-Za-z]/) < bUS.indexOf('14'), `an American one gets the month first — got ${bUS}`);

/* ── the one thing that is NOT the reader's ──────────────────────────────── */

// isoDate writes a storage key, not a sentence: it is the shape of the Postgres
// `date` column and of every lookup in the app that is keyed by a day. A locale
// anywhere near it would be the most destructive change available in that file.
setAppLocale('de-DE');
eq(isoDate(new Date(2026, 7, 1)), '2026-08-01', 'a storage key is not localised');
setAppLocale('ar-EG');
eq(isoDate(new Date(2026, 7, 1)), '2026-08-01', 'not even in a locale with its own digits');

/* ── the two decimals below `num1`, and the trimmed one ───────────────────
 *
 * The defect these pin is `toFixed`. Thirty-one call sites wrote a fraction
 * with it — a goal pace, a strength ratio, a churn percentage, a file size —
 * and `toFixed` is `Number.prototype`'s own decimal spelling, not a formatter:
 * it writes a FULL STOP in every locale there has ever been and it never
 * groups. So one paragraph printed "1,204.5 kg" from `num1` and "0.25 kg/wk"
 * from `toFixed`, and in German the second of those is not a quarter of a
 * kilogram — a full stop is the thousands mark, so it reads as twenty-five.
 */
setAppLocale('en-GB');
eq(num2(0.25), '0.25', 'a British reader gets a point on a two-decimal rate');
eq(num2(1), '1.00', 'and both places, because a fixed two is the point of num2');
setAppLocale('de-DE');
eq(num2(0.25), '0,25', 'a German reader gets a comma on the same rate');
eq(num2(1204.5), '1.204,50', 'and grouping, which toFixed never did at all');
eq(num2(null), '—', 'a missing rate is a dash, never a zero');
eq(num2(Number.POSITIVE_INFINITY), '—', 'and so is an infinity');

// numUpTo is the other half: at most N places, trailing zeros dropped. Two
// screens wrote this as `.toFixed(2).replace(/0$/, '').replace(/\.$/, '')`,
// which is an English point AND a trim that cannot find a comma — so on a
// German handset the trim silently stopped working too.
setAppLocale('en-GB');
eq(numUpTo(8, 1), '8', 'a whole number of hours does not become 8.0');
eq(numUpTo(7.5, 1), '7.5', 'and a half hour keeps its half');
eq(numUpTo(1.75, 2), '1.75', 'two places where two are wanted');
eq(numUpTo(1.5, 2), '1.5', 'and no trailing zero to pad it out');
setAppLocale('de-DE');
eq(numUpTo(7.5, 1), '7,5', 'the same half hour, in the reader\'s own separator');
eq(numUpTo(1.5, 2), '1,5', 'and the trailing zero still goes, which the hand-rolled trim could not do');
eq(numUpTo(8, 1), '8', 'a whole is a whole in every locale');
// The clamp, which exists because Intl throws a RangeError outside 0-20 and a
// throw inside a formatter takes out whichever screen was drawing a figure.
setAppLocale('en-GB');
eq(numUpTo(1.5, -3), '2', 'a negative place count clamps to none rather than throwing');
eq(numUpTo(1.5, 99), '1.5', 'and an absurd one clamps to Intl\'s ceiling');
eq(numUpTo(null, 2), '—', 'a missing figure is a dash here too');

// Leave the latch where a later test file would expect nothing in particular.
setAppLocale(null);

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('locale: ok');
