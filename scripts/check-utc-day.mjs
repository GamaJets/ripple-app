#!/usr/bin/env node
// UTC's calendar day, handed to somebody who does not live in it.
//
// ── the bug, and what it cost today ───────────────────────────────────────
//
// `new Date(t).toISOString().slice(0, 10)` reads like "the date part of that
// timestamp". It is not. It is the date part of that timestamp AS UTC SEES IT,
// and UTC is nobody's calendar. For everyone west of Greenwich the last hours
// of every evening are already tomorrow to that expression; for everyone far
// enough east the first hours of every morning are still yesterday.
//
// Today it cost a coach a payroll line. A class delivered on the last evening
// of a pay period was stamped with the UTC day, which was the FIRST day of the
// next period, so the run that was supposed to pay for it looked past it and
// the run for the next period had already been closed. The class did not appear
// as underpaid or disputed. It appeared nowhere. The only person who could have
// noticed was the coach who taught it, from memory, against a statement that
// was internally consistent and wrong.
//
// That is the shape of every instance of this: the number is not obviously
// broken, it is off by exactly one day for exactly the readers who are not in
// UTC, and it is right on the machine of whoever wrote it if that machine
// happens to be in London in winter. `src/lib/localDate.ts` records two more —
// a member filed into the previous month's retention cohort, and somebody
// reported a year older the day before their birthday — both shipped, both
// invisible to the gym they were written for, which is UTC+4.
//
// ── why a gate and not a fix ──────────────────────────────────────────────
//
// Because it has been fixed, repeatedly, by hand, and it comes back. Count the
// comments in this tree that name this exact expression as the thing a file
// STOPPED doing: app/(owner)/equipment.tsx, app/(owner)/members.tsx,
// app/(client)/dashboard.tsx, src/lib/training.ts, src/lib/blockRange.ts,
// src/lib/dayPlan.ts, src/lib/dayClasses.ts, src/lib/gymPasses.ts,
// src/lib/photoCompare.ts, src/lib/ownTraining.ts, src/lib/offlineQueue.ts,
// src/lib/bodyFigures.ts, studio-web/app/page.tsx, studio-web/app/close/page.tsx,
// studio-web/app/money/page.tsx, studio-web/app/members/page.tsx,
// studio-web/lib/currency.ts. Seventeen files carry a written account of this
// defect being found and removed. It is not a thing people do not know about.
// It is a thing people write anyway, because it is the shortest way to get a
// `YYYY-MM-DD` out of a Date and the wrongness does not show up on the author's
// screen.
//
// A gate is what stops the eighteenth.
//
// ── the right forms ───────────────────────────────────────────────────────
//
// There are three, and which one is right depends on WHOSE day you mean:
//
//   the reader's own day
//     `isoDay(d)` from src/lib/weekStart.ts — built from `getFullYear()`,
//     `getMonth()`, `getDate()`, which are the local getters, so the string is
//     the day the reader is standing in. `todayKey()` in src/lib/offlineQueue.ts
//     is the same thing for "now".
//
//   the GYM's day
//     `gymDay(ms, zone)` from src/lib/gymZone.ts. It returns null when the
//     tenant has no zone set, and that null is the point: a gym without a zone
//     has no calendar of its own, and the screen must say so (`NO_ZONE_NOTE`)
//     rather than silently substituting UTC's or the reader's. Those are, in
//     that file's own words, the two wrong answers.
//
//   a date-only column, read back
//     Nothing at all. A Postgres `date` arrives as a bare `YYYY-MM-DD` string
//     and is already the answer; put it through a Date and you have invented a
//     midnight that then has to be un-invented. `localDate()` /  `dateParts()`
//     in src/lib/localDate.ts are for when you need the parts.
//
// ── what this checks, and what it deliberately does not ───────────────────
//
// It checks for `.toISOString().slice(0, N)` for any N short of the full
// instant — day, month, minute, year. That expression has exactly one meaning
// and it is "a calendar field of the UTC calendar". There is no reading of it
// that is accidentally local, which is what makes it gateable at all.
//
// It also checks for `new Date('YYYY-MM-DD')` and `Date.parse('YYYY-MM-DD')` on
// a BARE date literal, which resolves to UTC midnight and hands back the
// previous day for every reader west of Greenwich. (There are none in this tree
// today. The rule is here because the shape is exact and costs nothing to hold.)
//
// It does NOT check `String(iso).slice(0, 10)`, and that is a deliberate hole
// with a reason. Whether that expression is wrong depends entirely on what
// column `iso` came from: on a `date` column it is a no-op and completely
// correct, and this tree is FULL of correct ones — src/ui/coachInvoices.ts,
// src/ui/coachCosts.ts, src/ui/coachReceipts.ts and src/ui/coachPayouts.ts do
// nothing else. On a `timestamptz` it is the same UTC-day bug as above.
// Telling those apart needs the schema, not the line, and a gate that guessed
// would be wrong about a dozen honest reads on its first run — at which point
// somebody switches it off and the real ones go with it. If you want that half
// caught, the tool for it is check-schema.mjs, which already knows the column
// types; this file is not it, and pretending otherwise would be worse than the
// admission.
//
// It does NOT look at `supabase/functions`. Those run on Deno Deploy, where the
// process timezone IS UTC, so `toISOString()` and the local getters agree and
// the whole class is moot. The zone question there is a different one — which
// TENANT's day a job is running for — and it belongs to whoever writes the job.
//
// ── the escape hatch ──────────────────────────────────────────────────────
//
// A genuinely UTC-intentional use is fine, and there are real ones: bucketing
// something that is stored in UTC and stays there, or printing UTC's day
// BESIDE a sentence saying that is what it is (see the payroll console's
// `NO_ZONE_NOTE` row). Two ways to say so:
//
//   1. Say UTC out loud in the expression. Anything on the line containing
//      `Date.UTC(`, `startOfWeekUTC(`, `utcDay`, `utcToday` — any identifier
//      with `UTC`/`utc` in it — is taken at its word and passes silently. A
//      reader of that line cannot mistake what it means, which is the whole
//      requirement.
//
//   2. Where the name cannot carry it, mark the line or the comment
//      immediately above it, with a reason:
//
//        // utc-day-ok: this is a filename stamp, not a figure — two exports on
//        // the same UTC day would collide, which is the only property it needs
//
//      The sentence is the point, exactly as with `no-error-ok:` in
//      check-reads.mjs, `rtl-ok:` in check-rtl.mjs and `keyboard-ok:` in
//      check-keyboard.mjs. It is what a reviewer reads when deciding whether
//      "UTC is honestly what I meant" is true, and it cannot be written by
//      somebody who has not thought about whose day they are printing.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** The three apps, the shared code and the web console — everywhere a READER's
 *  calendar day is at stake. `supabase/functions` is excluded on purpose; see
 *  the header. */
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/lib', 'studio-web/components'];

/**
 * Does a marker apply to `line` (1-based)?
 *
 * The marker may sit on the line itself, or anywhere in the unbroken run of
 * comment and blank lines immediately above it. It has to be able to sit above
 * the line at all for the reason check-rtl.mjs and check-keyboard.mjs give: a
 * `//` inside JSX renders as two slashes on somebody's screen. But it is an
 * unbroken RUN and not a fixed window of N lines, so an annotation written for
 * one statement can never drift down and quietly excuse the next one — a marker
 * belongs to the thing directly beneath it, and a line of real code in between
 * means it belongs to something else.
 */
function markedAbove(lines, line, re) {
  if (re.test(lines[line - 1] ?? '')) return true;
  for (let i = line - 2; i >= 0; i--) {
    const l = lines[i];
    if (!/\S/.test(l)) continue;
    if (!/^\s*(\/\/|\*|\/\*)/.test(l)) return false;
    if (re.test(l)) return true;
  }
  return false;
}

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * ── this is a ratchet, not an ignore list ─────────────────────────────────
 *
 * Same mechanism, and the same argument, as `KNOWN` in check-dead-exports.mjs
 * and check-currency.mjs. The count is the point: a file listed at 3 fails the
 * build at 4, so the backlog can shrink and can never grow. A count that has
 * DROPPED fails too, asking for the number to come down with the work, because
 * a list that over-states what is wrong is how a ratchet turns into an ignore
 * list one stale line at a time.
 *
 * Two kinds of entry, and the difference matters when you pick one up:
 *
 *   [fix]      the expression is wrong and the day is somebody's. Replace it
 *              with `isoDay`, `todayKey` or `gymDay` per the header.
 *   [annotate] the expression is defensible where it stands and what is missing
 *              is the SENTENCE saying so. The edit is to paste a `utc-day-ok:`
 *              marker with a reason, and the entry then comes off this list.
 *              It is on the list rather than pre-annotated because this gate
 *              was written in a lane that does not own those files, and a gate
 *              author quietly annotating other people's code is how a rule gets
 *              weakened by the person least placed to judge it.
 *
 * ── what came off, and what the fixes turned out to be ────────────────────
 *
 * Every `src/lib/**` entry is cleared. Six were genuine [fix]es and four were
 * [annotate]s the labels above had called fixes, which is worth recording
 * because the pattern repeated: an expression that puts a bare day string in at
 * UTC midnight, does arithmetic, and takes a bare day string back out is not
 * this bug — UTC is the carrier there and it cancels, and swapping in the local
 * getters would have INTRODUCED the shift. `dueAfter`, `expiring`, `isoDay` the
 * validator and the export-window presets are all that shape, and the repair
 * for them was to say so on the line.
 *
 * Two entries wanted a NAME rather than an edit. `termDates.ts` did not need
 * the local `isoDay` imported — it cannot import anything, being a leaf an edge
 * function pulls in, and it is deliberately UTC throughout. What was wrong was
 * that its export was called `isoDay`, the same as the local one in
 * weekStart.ts, so the tree held two functions with one name, one signature and
 * different answers. It is `utcDay` now. `exportWindow.ts` went the same way.
 */
const KNOWN = new Map([
  // studio-web/app/close/page.tsx — was 1, now 0, and the entry is gone.
  //
  // It was labelled [annotate] and it turned out to be a [fix]. The line was
  // the fallback after `gymDay(...)` returns null, and the argument for
  // annotating it was that UTC's day is "the only clock there is" at a gym with
  // no timezone. That stopped being true in the same change that read it: the
  // month's own figures are built by `buildClose`, which falls back to
  // `isoDay(new Date(now))` — the READER's day — so a zone-less gym had the
  // invoice table's Status column on UTC's calendar and the "Still owed" tile
  // above it counting overdue on the reader's. Two calendars, one sheet,
  // disagreeing for the hours between two midnights. Marking the line
  // `utc-day-ok:` would have written that disagreement down as intended.
  //
  // The line is `gymDay(Date.now(), zone) ?? isoDay(new Date())` now, which is
  // the same expression `buildClose` falls back to, and there is nothing left
  // here to annotate.
  ['studio-web/app/members/page.tsx', { count: 1, fix: '[annotate] a CSV download filename stamp. Mark it `utc-day-ok:` saying it is a filename and not a figure.' }],
  ['studio-web/app/money/page.tsx', { count: 2, fix: '[annotate] both are the seed for a date INPUT that `gymDay` corrects as soon as the tenant read lands, and the surrounding comment says so at length. Mark both `utc-day-ok:` pointing at that correction.' }],
  ['studio-web/app/passes/page.tsx', { count: 1, fix: '[annotate] a CSV download filename stamp. Mark it `utc-day-ok:` saying it is a filename and not a figure.' }],
  ['studio-web/app/payroll/page.tsx', { count: 1, fix: '[annotate] this one prints UTC\'s day and `NO_ZONE_NOTE` in the same span, which is the honest form. Mark it `utc-day-ok:` saying the sentence beside it names the calendar.' }],
]);

/** A test file. A test that pins the difference between the UTC day and the
 *  local one has to be able to write both, and several here do exactly that. */
const isTest = (f) => /\.test\.[jt]sx?$/.test(f) || f.includes('__tests__');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !isTest(p)) out.push(p);
  }
  return out;
}

const files = [];
/* Counted per ROOT, not just in total. A single total threshold cannot notice a
 * root going missing, because the other roots cover for it — see
 * scripts/gate-floor.mjs for the arithmetic and why 150-of-781 was not a guard. */
const perRoot = new Map();
for (const r of ROOTS) {
  const before = files.length;
  walk(join(ROOT, r), files);
  perRoot.set(r, files.length - before);
}
assertRootFloors('check:utc-day', perRoot);

// The empty-set guard every gate here has. A check that passes because it
// looked at nothing is worse than no check: it reports "ok" and a count.
if (files.length < 150) {
  console.error(`check-utc-day: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

/** A line that is prose. Every header in this tree quotes the wrong form. */
const isComment = (l) => /^\s*(\/\/|\*|\/\*)/.test(l);

/** The author said UTC out loud somewhere on the line. Taken at its word. */
const saysUtc = (l) => /UTC/.test(l) || /\butc[A-Z_]/.test(l);

/** `toISOString()` followed by a slice that stops short of the full instant.
 *  N < 20 is every calendar field: 4 year, 7 month, 10 day, 13 hour, 16 minute. */
const UTC_SLICE = /\.toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*(\d+)\s*\)/g;

/** A bare `YYYY-MM-DD` literal put through the parser, which reads it as UTC
 *  midnight. `new Date('2026-08-01').getDate()` is 31 in New York. */
const BARE_LITERAL = /(?:new\s+Date|Date\.parse)\(\s*['"](\d{4}-\d{2}-\d{2})['"]\s*\)/g;

const found = [];
for (const f of files) {
  const rel = relative(ROOT, f);
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    if (markedAbove(lines, i + 1, /utc-day-ok:\s*\S/)) return;

    UTC_SLICE.lastIndex = 0;
    let m;
    while ((m = UTC_SLICE.exec(line))) {
      if (Number(m[1]) >= 20) continue; // the whole instant, sliced for nothing
      if (saysUtc(line)) continue;
      found.push({
        rel, line: i + 1, text: line.trim().slice(0, 110),
        wrong: `.toISOString().slice(0, ${m[1]}) — the ${{ 4: 'year', 7: 'month', 10: 'day', 13: 'hour', 16: 'minute' }[m[1]] ?? 'calendar field'} of the UTC calendar, which is nobody's`,
        right: "isoDay(d) / todayKey() from src/lib/weekStart.ts + src/lib/offlineQueue.ts for the READER's day, or gymDay(ms, zone) from src/lib/gymZone.ts for the GYM's — and NO_ZONE_NOTE where the tenant has no zone",
      });
    }

    BARE_LITERAL.lastIndex = 0;
    while ((m = BARE_LITERAL.exec(line))) {
      if (saysUtc(line)) continue;
      found.push({
        rel, line: i + 1, text: line.trim().slice(0, 110),
        wrong: `new Date('${m[1]}') — a bare date has no offset, so this is UTC midnight and reads back as the PREVIOUS day west of Greenwich`,
        right: "localDate('" + m[1] + "') from src/lib/localDate.ts, which builds the Date from the parts so every getter reads back the day that was written",
      });
    }
  });
}

/* ── the ratchet ──────────────────────────────────────────────────────────── */

const byFile = new Map();
for (const f of found) {
  if (!byFile.has(f.rel)) byFile.set(f.rel, []);
  byFile.get(f.rel).push(f);
}

const fresh = [];
const drifted = [];
for (const [rel, hits] of byFile) {
  const allowed = KNOWN.get(rel)?.count ?? 0;
  if (hits.length > allowed) fresh.push(...hits.map((h) => ({ ...h, allowed })));
}
for (const [rel, entry] of KNOWN) {
  const n = byFile.get(rel)?.length ?? 0;
  if (n < entry.count) drifted.push({ rel, was: entry.count, now: n, fix: entry.fix });
}

if (fresh.length) {
  console.error(`\n${fresh.length} expression${fresh.length === 1 ? '' : 's'} handing UTC's calendar day to somebody who does not live in it:\n`);
  for (const h of fresh) {
    console.error(`  ${h.rel}:${h.line}`);
    console.error(`    ${h.text}`);
    console.error(`    wrong: ${h.wrong}`);
    console.error(`    right: ${h.right}`);
    if (h.allowed) console.error(`    (this file is on the ratchet at ${h.allowed}; it now has ${byFile.get(h.rel).length})`);
    console.error('');
  }
  console.error('A class dated into the next period by this expression did not show up as');
  console.error('underpaid. It showed up nowhere, and the payroll run that should have paid for');
  console.error('it was internally consistent and wrong. If UTC is honestly what you meant, say');
  console.error('so in the name (anything with UTC in it passes) or mark the line');
  console.error('`utc-day-ok: <why UTC is the right calendar here>`.\n');
  process.exit(1);
}

if (drifted.length) {
  console.error(`\n${drifted.length} ratchet entr${drifted.length === 1 ? 'y is' : 'ies are'} out of date — the backlog has shrunk and the list has not:\n`);
  for (const d of drifted) {
    console.error(`  ${d.rel}: listed at ${d.was}, now ${d.now}. ${d.now === 0 ? 'Delete the entry.' : `Lower the count to ${d.now}.`}`);
    console.error(`    ${d.fix}\n`);
  }
  console.error('A list that over-states what is wrong is how a ratchet turns into an ignore');
  console.error('list. The number comes down with the work.\n');
  process.exit(1);
}

const backlog = [...KNOWN.values()].reduce((n, e) => n + e.count, 0);
console.log(`check-utc-day — ok, ${files.length} files; no new UTC calendar days${backlog ? `, ${backlog} known and ratcheted` : ''}`);
