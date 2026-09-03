"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
const locale_1 = require("./locale");
const format_1 = require("./format");
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);
/* ── what counts as a tag we may hand to Intl ─────────────────────────────── */
// A malformed tag is not a bad guess, it is a RangeError out of the Intl
// constructor — inside num(), which means a screen that renders no figures at
// all rather than foreign-looking ones.
ok((0, locale_1.isWellFormedLocale)('en'), 'a bare language is a tag');
ok((0, locale_1.isWellFormedLocale)('en-GB'), 'language and region is a tag');
ok((0, locale_1.isWellFormedLocale)('ar-Arab-AE'), 'language, script and region is a tag');
ok((0, locale_1.isWellFormedLocale)('en-US-u-ca-gregory'), 'an extension sequence is still a tag');
ok(!(0, locale_1.isWellFormedLocale)('C'), 'the POSIX C locale is not a tag');
ok(!(0, locale_1.isWellFormedLocale)('POSIX'), 'POSIX is not a tag');
ok(!(0, locale_1.isWellFormedLocale)('en_US.UTF-8'), 'a POSIX locale with a charset on it is not a tag');
ok(!(0, locale_1.isWellFormedLocale)(''), 'an empty string is not a tag');
ok(!(0, locale_1.isWellFormedLocale)(null), 'null is not a tag');
ok(!(0, locale_1.isWellFormedLocale)(undefined), 'undefined is not a tag');
ok(!(0, locale_1.isWellFormedLocale)('e'), 'one letter is not a language');
// Android skins and simulator images hand back the underscore form.
eq((0, locale_1.normaliseLocale)('en_US'), 'en-US', 'an underscore tag is normalised');
eq((0, locale_1.normaliseLocale)('  fr_CA '), 'fr-CA', 'surrounding space is trimmed');
eq((0, locale_1.normaliseLocale)(null), '', 'nothing normalises to nothing');
ok((0, locale_1.isWellFormedLocale)('en_US'), 'the underscore form is accepted once normalised');
/* ── resolution, and saying which of the two happened ─────────────────────── */
eq((0, locale_1.resolveLocale)('de-DE').locale, 'de-DE', 'a readable handset locale is used');
eq((0, locale_1.resolveLocale)('de-DE').source, 'device', 'and is reported as the handset');
eq((0, locale_1.resolveLocale)('en_AU').locale, 'en-AU', 'the underscore form resolves to the hyphen form');
eq((0, locale_1.resolveLocale)(null).locale, locale_1.FALLBACK_LOCALE, 'an unreadable platform falls back');
eq((0, locale_1.resolveLocale)(null).source, 'fallback', 'and the fallback is reported as one');
eq((0, locale_1.resolveLocale)('C').source, 'fallback', 'a POSIX locale is not a reader');
// The fallback is not a default. A screen is entitled to say so, and is
// entitled to say nothing when there is nothing to admit.
eq((0, locale_1.localeNote)('device'), null, 'nothing is said when the handset answered');
ok(((0, locale_1.localeNote)('fallback') || '').length > 0, 'the fallback is admitted to in words');
/* ── the latch ───────────────────────────────────────────────────────────── */
(0, locale_1.setAppLocale)('fr-CA');
eq((0, locale_1.appLocale)(), 'fr-CA', 'the latch holds what it was seeded with');
eq((0, locale_1.localeSource)(), 'device', 'and where it came from');
(0, locale_1.setAppLocale)(null);
eq((0, locale_1.appLocale)(), locale_1.FALLBACK_LOCALE, 're-seeding with nothing falls back');
eq((0, locale_1.localeSource)(), 'fallback', 'and says so');
/* ── figures ─────────────────────────────────────────────────────────────── */
(0, locale_1.setAppLocale)('en-GB');
eq((0, format_1.num)(2860), '2,860', 'a British reader gets a comma');
eq((0, format_1.num1)(73.5), '73.5', 'and a point for the tenth');
(0, locale_1.setAppLocale)('de-DE');
eq((0, format_1.num)(2860), '2.860', 'a German reader gets a full stop as the thousands mark');
eq((0, format_1.num1)(73.5), '73,5', 'and a comma as the decimal mark');
(0, locale_1.setAppLocale)('en-US');
eq((0, format_1.num)(2860), '2,860', 'an American reader gets a comma');
// Unchanged by any of it: nothing is a dash, never a zero and never "NaN".
eq((0, format_1.num)(null), '—', 'a missing figure is a dash in every locale');
eq((0, format_1.num1)(undefined), '—', 'so is a missing tenth');
eq((0, format_1.num)(NaN), '—', 'and so is NaN');
/* ── the clock ───────────────────────────────────────────────────────────── */
// en-GB is a 24-hour locale and en-AU is a 12-hour one. Both are English, which
// is why the question is asked of Intl rather than of a table of countries.
ok(!(0, locale_1.prefers12Hour)('en-GB'), 'the United Kingdom reads a 24-hour clock');
ok((0, locale_1.prefers12Hour)('en-US'), 'the United States reads a 12-hour clock');
ok((0, locale_1.prefers12Hour)('en-AU'), 'Australia reads a 12-hour clock, in the same language as the UK');
(0, locale_1.setAppLocale)('en-US');
// The separator before the day period is the locale's own — en-US writes a
// space there — and only the case of the word itself is the app's choice.
eq((0, format_1.fmtClock)(19, 0), '7 pm', 'a whole hour drops its minutes on a 12-hour clock');
eq((0, format_1.fmtClock)(7, 30), '7:30 am', 'and keeps them when there are any');
eq((0, format_1.fmtClock)(0, 5), '12:05 am', 'midnight is 12, not 0, on a 12-hour clock');
eq((0, format_1.fmtClock)(12, 0), '12 pm', 'and so is noon');
(0, locale_1.setAppLocale)('en-GB');
// "19" on its own is not a time, so the whole-hour trim is 12-hour only.
eq((0, format_1.fmtClock)(19, 0), '19:00', 'a 24-hour clock keeps its minutes on the hour');
eq((0, format_1.fmtClock)(7, 30), '7:30', 'and carries no am/pm');
ok(!/am|pm/i.test((0, format_1.fmtClock)(19, 30)), 'nothing English is glued onto a 24-hour time');
eq((0, format_1.fmtClock)(NaN, 0), '—', 'an unreadable hour is a dash, not a time');
/* ── dates, and the off-by-one this repo has shipped twice ───────────────── */
// The whole point of routing fmtDay through localDate. `new Date('2026-08-01')`
// is UTC midnight, which every getter west of Greenwich reads back as 31 July —
// and `npm run test:zones` runs this file under America/Los_Angeles.
(0, locale_1.setAppLocale)('en-GB');
ok(/\b1\b/.test((0, format_1.fmtDay)('2026-08-01')), `a bare date keeps its day number — got ${(0, format_1.fmtDay)('2026-08-01')}`);
ok(!/\b31\b/.test((0, format_1.fmtDay)('2026-08-01')), `and does not slip to the day before — got ${(0, format_1.fmtDay)('2026-08-01')}`);
ok(/\b1\b/.test((0, format_1.fmtPointDay)(2026, 7, 1)), 'a chart readout keeps its day number');
ok(/2026/.test((0, format_1.fmtPointDay)(2026, 7, 1)), 'and carries the year it was given');
ok(/\b14\b/.test((0, format_1.fmtAxisDay)(2026, 7, 14)), 'an axis label keeps its day number');
eq((0, format_1.fmtDay)('not a date'), '—', 'an unreadable date is a dash, not a guess');
// Ordering, which is the visible half of following the reader. en-GB puts the
// day first and en-US puts the month first, and the spelling of the month is
// left to CLDR.
(0, locale_1.setAppLocale)('en-GB');
const gb = (0, format_1.fmtAxisDay)(2026, 7, 14);
(0, locale_1.setAppLocale)('en-US');
const us = (0, format_1.fmtAxisDay)(2026, 7, 14);
ok(gb.indexOf('14') < gb.search(/[A-Za-z]/), `a British axis label leads with the day — got ${gb}`);
ok(us.search(/[A-Za-z]/) < us.indexOf('14'), `an American one leads with the month — got ${us}`);
/* ── "Today", "Tomorrow", and the four copies that were neither ─────────── */
// Four screens carried a private `dayLabel` ending
// `${DOW[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`, with DOW a hardcoded
// English array. "Wed 9/12" is 9 December to a British reader and 12 September
// to an American one, and that string went into every cancel confirmation on
// those screens.
const NOON = new Date(2026, 8, 2, 12, 0, 0); // Wed 2 Sep 2026, local
const LATE = new Date(2026, 8, 2, 23, 30, 0);
const iso = (y, m, d, h = 9) => new Date(y, m, d, h).toISOString();
(0, locale_1.setAppLocale)('en-GB');
eq((0, format_1.fmtRelativeDay)(iso(2026, 8, 2), NOON), 'Today', 'the day the reader is in is named, not dated');
eq((0, format_1.fmtRelativeDay)(iso(2026, 8, 3), NOON), 'Tomorrow', 'and so is the next one');
// The comparison is on the local calendar date, not on a 24-hour difference.
// 23:30 tonight and 01:00 tomorrow are two hours apart and one day apart, and
// it is the day the reader means.
eq((0, format_1.fmtRelativeDay)(iso(2026, 8, 3, 1), LATE), 'Tomorrow', 'ninety minutes after midnight is tomorrow, not today');
eq((0, format_1.fmtRelativeDay)(iso(2026, 8, 2, 1), LATE), 'Today', 'and twenty-two hours earlier the same date is still today');
// The defect itself: the day number, the month and their ORDER all follow the
// reader. 9 December must not read as 12 September.
(0, locale_1.setAppLocale)('en-GB');
const dGB = (0, format_1.fmtRelativeDay)(iso(2026, 11, 9), NOON);
(0, locale_1.setAppLocale)('en-US');
const dUS = (0, format_1.fmtRelativeDay)(iso(2026, 11, 9), NOON);
ok(!/\d+\/\d+/.test(dGB), `no bare numeric date survives — got ${dGB}`);
ok(!/\d+\/\d+/.test(dUS), `in either locale — got ${dUS}`);
ok(dGB.indexOf('9') < dGB.search(/Dec/), `a British reader gets the day first — got ${dGB}`);
ok(dUS.search(/Dec/) < dUS.indexOf('9'), `an American reader gets the month first — got ${dUS}`);
(0, locale_1.setAppLocale)('fr-FR');
const dFR = (0, format_1.fmtRelativeDay)(iso(2026, 11, 9), NOON);
ok(!/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(dFR), `no English weekday is glued onto a French date — got ${dFR}`);
(0, locale_1.setAppLocale)('en-GB');
eq((0, format_1.fmtRelativeDay)('not a date', NOON), '—', 'an unreadable date is a dash, not "Today"');
// Bare `YYYY-MM-DD` goes through localDate for the same reason fmtDay does:
// `new Date('2026-08-01')` is UTC midnight and reads back as 31 July west of
// Greenwich, and test:zones runs this file under America/Los_Angeles.
ok(/\b1\b/.test((0, format_1.fmtRelativeDay)('2026-08-01', NOON)), `a bare date keeps its day number — got ${(0, format_1.fmtRelativeDay)('2026-08-01', NOON)}`);
/* ── the month names a picker scrolls through ───────────────────────────── */
// Two screens carried their own hardcoded English `MONTHS` array — the
// dashboard's date line and the date-of-birth wheel. The wheel is the one place
// a LIST of month names is still the right shape, so it gets one, in the
// reader's language.
(0, locale_1.setAppLocale)('en-GB');
const mEN = (0, format_1.monthNamesShort)();
eq(mEN.length, 12, 'twelve months, indexed the way Date#getMonth is');
ok(/Jan/.test(mEN[0]), `January is index 0 — got ${mEN[0]}`);
ok(/Dec/.test(mEN[11]), `and December is index 11 — got ${mEN[11]}`);
(0, locale_1.setAppLocale)('fr-FR');
const mFR = (0, format_1.monthNamesShort)();
eq(mFR.length, 12, 'still twelve in another language');
ok(mFR[7] !== mEN[7], `and they are not the English ones — got ${mFR[7]} for August`);
eq(new Set(mFR).size >= 11, true, 'and they are distinct from each other');
/* ── a date of birth, which is a bare date column ───────────────────────── */
(0, locale_1.setAppLocale)('en-GB');
ok(/\b14\b/.test((0, format_1.fmtFullDay)('1990-05-14')), `a bare date keeps its day number — got ${(0, format_1.fmtFullDay)('1990-05-14')}`);
ok(!/\b13\b/.test((0, format_1.fmtFullDay)('1990-05-14')), `and does not slip to the day before west of Greenwich — got ${(0, format_1.fmtFullDay)('1990-05-14')}`);
ok(/1990/.test((0, format_1.fmtFullDay)('1990-05-14')), 'a date of birth carries its year');
eq((0, format_1.fmtFullDay)('not a date'), '—', 'and an unreadable one is a dash');
(0, locale_1.setAppLocale)('en-US');
const bUS = (0, format_1.fmtFullDay)('1990-05-14');
(0, locale_1.setAppLocale)('en-GB');
const bGB = (0, format_1.fmtFullDay)('1990-05-14');
ok(bGB.indexOf('14') < bGB.search(/[A-Za-z]/), `a British reader gets the day first — got ${bGB}`);
ok(bUS.search(/[A-Za-z]/) < bUS.indexOf('14'), `an American one gets the month first — got ${bUS}`);
/* ── the one thing that is NOT the reader's ──────────────────────────────── */
// isoDate writes a storage key, not a sentence: it is the shape of the Postgres
// `date` column and of every lookup in the app that is keyed by a day. A locale
// anywhere near it would be the most destructive change available in that file.
(0, locale_1.setAppLocale)('de-DE');
eq((0, format_1.isoDate)(new Date(2026, 7, 1)), '2026-08-01', 'a storage key is not localised');
(0, locale_1.setAppLocale)('ar-EG');
eq((0, format_1.isoDate)(new Date(2026, 7, 1)), '2026-08-01', 'not even in a locale with its own digits');
// Leave the latch where a later test file would expect nothing in particular.
(0, locale_1.setAppLocale)(null);
if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('locale: ok');
