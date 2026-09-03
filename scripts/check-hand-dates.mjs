#!/usr/bin/env node
// A date is FORMATTED, not assembled — and the gap in check:locale.
//
// ── Why this is a second gate and not a wider regex in the first ──────────
//
// `scripts/check-locale.mjs` enforces one rule: a `toLocaleString` /
// `toLocaleDateString` / `toLocaleTimeString` call, or an `Intl.*` constructor,
// may not NAME a locale as a string literal. That is the right rule and it is
// green today.
//
// It is also, by construction, blind to the mistake that matters more. Its
// regex begins at the name of an Intl entry point, so a date that never reaches
// Intl at all is invisible to it. `app/(trainer)/chat.tsx` carried
//
//     const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
//     return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
//
// under the stamp on every message in a coach's thread, and check:locale passed
// on that file every single run — there is no `toLocale` in it and no `Intl.`
// in it, so there was nothing for the pattern to start matching at. A gate that
// only inspects the calls you DID make cannot see the call you avoided.
//
// Worse, the avoidance was being justified BY the gate. `app/(client)/scans.tsx`
// built its dates out of a hardcoded English month array under the comment
// "Built from MONTHS rather than `toLocaleDateString`, which names a locale and
// is what scripts/check-locale.mjs refuses" — which reads the rule backwards.
// check:locale refuses a locale named as a LITERAL; passing nothing, or
// `appLocale()`, is exactly what it asks for. So a check written to stop English
// being hardcoded was cited as the reason to hardcode English.
//
// ── The two shapes, and why each is wrong ─────────────────────────────────
//
//  1. A BARE NUMERIC DAY/MONTH — `${d.getDate()}/${d.getMonth() + 1}`.
//
//     This is not a formatting preference, it is an ambiguity. "9/12" is
//     9 December to a reader in London and 12 September to one in New York, and
//     nothing on the screen says which. It has been in the last sentence before
//     a cancellation confirm, in the stamp under every chat message on both
//     sides of the same conversation, and on the chip a member is asked to
//     remember their best week by. `fmtRelativeDay`'s own header says it was
//     removed from five screens; it came back in five more.
//
//  2. A HARDCODED ENGLISH WEEKDAY OR MONTH ARRAY.
//
//     Half of this product's readers are not reading English, and a white-label
//     gym in Dubai, one in London and one in Tokyo run the same binary — the
//     argument check:locale's own header makes about `num()`. An array of
//     literals is also how the fifth, sixth, seventh and eighth copy of a day
//     formatter came to exist in this repo, each one drifting from the others.
//
// ── What to use instead ───────────────────────────────────────────────────
//
//   · a whole date            → `fmtDay` / `fmtRelativeDay` / `fmtFullDay`
//   · a day and a short month → `fmtAxisDay(y, m, day)` — parts, never a string
//   · one weekday name        → `weekdayName` / `weekdayNameShort`
//   · a grid's row of names   → `src/lib/calendarNames.ts`
//   · a picker's twelve       → `monthNames` / `monthNamesShort`
//   · a gym's own date        → `src/lib/gymWhen.ts`, which is a different
//                               question: the reader's locale, the GYM's zone.
//
// ── What this deliberately does NOT flag ──────────────────────────────────
//
//   · The three files that OWN the fallback. `format.ts`, `calendarNames.ts`
//     and `weekStart.ts` each hold an English array on purpose: the first two
//     as the answer of last resort on a Hermes build with no ICU, and the third
//     because `WEEK_STARTS_ON` is a product decision that must NOT come from a
//     locale — a locale-derived week gives two members of the same gym
//     different weeks.
//   · Comments. Every file that has had this defect removed from it explains
//     the defect in prose, quoting the shape, and a gate that failed on the
//     explanation would delete the explanations.
//   · Test files, which state their own strings on purpose.
//
// ── What it cannot see ────────────────────────────────────────────────────
//
// An array built one push at a time, names held in a map or an object literal,
// and a `d/m` assembled through variables two lines apart. It catches the form
// the mistake actually took in this codebase, eighteen times, which is the whole
// of its claim — the same claim check:locale makes about its own regex.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = process.cwd();
/**
 * Every tree that writes a date for a person to read.
 *
 * The console was not in this list, and the console does exactly what this file
 * exists to stop: `studio-web/app/classes/page.tsx` keeps a seven-entry English
 * `DAY_NAMES`, `studio-web/app/analytics/page.tsx` a twelve-entry `MONTHS3`.
 * Both are in KNOWN below. The console is read by gym staff in Dubai and Tokyo
 * on the same binary as the one in London — the argument in this file's header
 * is not about which framework rendered the string.
 */
const ROOTS = ['app', 'src/ui', 'src/lib', 'studio-web/app', 'studio-web/components', 'studio-web/lib'];

/**
 * The files allowed to hold an English list of days or months.
 *
 * Three, and each for a stated reason — see the header. Nothing is added here
 * to make a run go green: a new file that needs day names needs one of the
 * helpers these three export.
 */
const OWNS_THE_FALLBACK = new Set([
  'src/lib/format.ts',
  'src/lib/calendarNames.ts',
  'src/lib/weekStart.ts',
]);

/**
 * The backlog, by file, with the number of offences standing on the day this
 * gate was written and why each is still there.
 *
 * A RATCHET, not an exemption: the count may fall and may never rise. Every one
 * of these is a month name inside a tested module whose test asserts the exact
 * English string, so converting one is not a one-line change — it is that
 * change plus teaching its test to state a locale instead of assuming the
 * runner's. That is mechanical, low-decision work with no judgement in it, and
 * it belongs in a batch rather than smuggled into a change about something
 * else. What must not happen in the meantime is a nineteenth.
 */
const KNOWN = new Map([
  // src/lib/coachCredentials.ts, src/lib/adherence.ts and src/lib/coachInvoice.ts
  // were here with count 1 each and are now clean: lanes removed their English
  // MONTHS on 3 September and the entries came off the ratchet the same day. The
  // number only counts down.
  ['src/lib/monthlyHistory.ts', { count: 1, fix: 'MONTH_LABELS, on a chart axis. fmtAxisMonth or monthNamesShort().' }],
  ['src/lib/ownerAnalytics.ts', { count: 1, fix: 'MONTHS, for "Aug 2026" on the owner console. monthNamesShort().' }],
  ['src/lib/packExpiry.ts', { count: 1, fix: 'MONTHS, for the date a pack runs out — which a member is told and acts on. monthNamesShort().' }],
  ['src/lib/recurring.ts', { count: 1, fix: 'DOW_NAMES, read by `seriesLabel`. `memberSeriesLabel` beside it is the localised twin and its header states, deliberately, that seriesLabel stays English for the coach\'s own screens. Settle that argument before removing this — it is a decision, not an oversight.' }],
  ['src/lib/reminderPlan.ts', { count: 1, fix: 'DAY_LABEL, for the reminder day picker. `WEEK_DAYS` in weekStart.ts is the same seven in the same order, or weekdayNameShort per cell.' }],
  // Added when the console joined ROOTS. Both are read by staff who do not
  // necessarily read English, on a screen that also shows money.
  ['studio-web/app/classes/page.tsx', { count: 1, fix: 'DAY_NAMES, seven English weekdays on the class timetable. weekdayNameShort(dow), or WEEK_DAYS from src/lib/weekStart.ts.' }],
  ['studio-web/app/analytics/page.tsx', { count: 1, fix: 'MONTHS3, twelve English months on the analytics axis and its point labels. monthNamesShort(), or fmtAxisMonth.' }],
]);

/** `${d.getDate()}/${d.getMonth() + 1}` and its mirror — a date assembled out
 *  of two numbers with a slash between them, in either order. */
const NUMERIC_DM = [
  /getDate\(\)\s*\}\s*\/\s*\$\{[^}]*getMonth\(\)/,
  /getMonth\(\)[^}]*\}\s*\/\s*\$\{[^}]*getDate\(\)/,
];

/** Three consecutive English day or month names inside an array literal. Three
 *  rather than seven or twelve so a list that starts with a blank pad — as
 *  `DAY_LABEL` does — is still caught. */
const DAYS = 'Sun|Mon|Tue|Wed|Thu|Fri|Sat|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday';
const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec'
  + '|January|February|March|April|June|July|August|September|October|November|December';
const NAME_LIST = new RegExp(
  `(['"])(?:${DAYS}|${MONTHS})\\1\\s*,\\s*(['"])(?:${DAYS}|${MONTHS})\\2\\s*,\\s*(['"])(?:${DAYS}|${MONTHS})\\3`,
);

/** A line that is prose about the defect rather than the defect. Every file
 *  this has been removed from quotes the old shape in its header. */
function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const hits = [];
let files = 0;
const perRoot = new Map();
for (const root of ROOTS) {
  const inRoot = walk(join(ROOT, root));
  perRoot.set(root, inRoot.length);
  for (const file of inRoot) {
    const rel = relative(ROOT, file);
    if (OWNS_THE_FALLBACK.has(rel) || /\.test\.tsx?$/.test(rel)) continue;
    files++;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      const why = NUMERIC_DM.some((r) => r.test(line))
        ? 'a bare d/m — two different days to two readers'
        : NAME_LIST.test(line)
          ? 'a hardcoded English list of days or months'
          : null;
      if (why) hits.push({ rel, line: i + 1, why, text: line.trim() });
    });
  }
}

/* ── the empty-set guard ───────────────────────────────────────────────────
 *
 * There was none: this gate counted `files` and never asserted it, so a renamed
 * root printed "no new offences" over a tree it never opened. Counted per root —
 * a single total cannot notice one root going missing. */
assertRootFloors('check:hand-dates', perRoot);

const byFile = new Map();
for (const h of hits) byFile.set(h.rel, [...(byFile.get(h.rel) ?? []), h]);

const fresh = [];
const shrunk = [];
for (const [rel, list] of byFile) {
  const known = KNOWN.get(rel);
  if (!known) { fresh.push(...list); continue; }
  if (list.length > known.count) fresh.push(...list.slice(known.count));
}
// A KNOWN entry whose file no longer offends, or offends less. Reported so the
// number comes DOWN with the work rather than sitting there as a licence.
for (const [rel, known] of KNOWN) {
  const now = byFile.get(rel)?.length ?? 0;
  if (now < known.count) shrunk.push({ rel, was: known.count, now });
}

if (fresh.length) {
  console.error('A date is assembled by hand instead of formatted for the reader:\n');
  for (const f of fresh) {
    console.error(`${f.rel}:${f.line}  ${f.why}`);
    console.error(`  ${f.text.slice(0, 140)}`);
  }
  console.error(`\n${fresh.length} new offence${fresh.length === 1 ? '' : 's'}.`);
  console.error('Use src/lib/format.ts (fmtDay, fmtRelativeDay, fmtFullDay, fmtAxisDay,');
  console.error('weekdayName, weekdayNameShort, monthNames, monthNamesShort) or');
  console.error('src/lib/calendarNames.ts for a grid. A gym\'s own date goes through');
  console.error('src/lib/gymWhen.ts. See the header of this file for why check:locale');
  console.error('cannot see any of this.\n');
  process.exit(1);
}

if (shrunk.length) {
  console.error('KNOWN is out of date — the ratchet only counts down if somebody turns it:\n');
  for (const s of shrunk) console.error(`  ${s.rel}: KNOWN says ${s.was}, the file has ${s.now}`);
  console.error('\nLower the count in scripts/check-hand-dates.mjs.\n');
  process.exit(1);
}

const backlog = [...KNOWN.values()].reduce((n, k) => n + k.count, 0);
console.log(`check-hand-dates — ok, ${files} files; no hand-rolled date outside `
  + `src/lib/format.ts and its two siblings, ${backlog} known and ratcheted across ${KNOWN.size} files.`);
