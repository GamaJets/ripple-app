#!/usr/bin/env node
// A clock that stopped when the screen opened.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
//     const today = useMemo(() => todayKey(), []);
//
// An empty dependency array does not fix a value "for the render". It fixes it
// for the life of the MOUNT, and on a phone that is not a short window.
// app/(trainer)/_layout.tsx registers its detail screens with `href: null`,
// which mounts them once; backgrounding the app does not tear them down at all.
// A screen opened on Sunday and returned to on Wednesday is still answering
// Sunday's question.
//
// The worst one found today was app/(trainer)/credentials.tsx, where the frozen
// day was the second argument to every judgement the screen makes —
// `sortCredentials`, `insuranceClaim`, `credentialState`, `expiryLine`. A
// coach's public liability policy that ran out on Monday read as current, in
// the green, on the one screen whose entire job is to say when their cover
// runs out. Whether they could lawfully stand on a gym floor hung off a date
// the screen had quietly stopped updating. Three more were found in the same
// sweep: Analytics, Money and the Assistant are TABS — mounted for as long as
// the app is — and each set both bounds of a month-to-date window from a
// frozen `new Date()`, so a coach who opened Analytics on the 31st and came
// back on the 1st was shown last month's takings under a heading saying this
// month, and a pull-to-refresh re-read the server against the same wrong dates,
// which made the stale figure look freshly confirmed.
//
// ── why a gate and not a fix ──────────────────────────────────────────────
//
// All four were fixed. The fix is a hook — `useToday()` and `useNow()` in
// src/ui/today.ts — and its header argues the whole case. The problem is that
// the WRONG form is the obvious one: a reviewer reading `useMemo(() =>
// todayKey(), [])` sees a memo with no dependencies, which is exactly what a
// memo of a constant should look like, and nothing on the line says the value
// is not constant. It reads as correct. It compiles, type-checks, and behaves
// perfectly for the length of any session anybody tests it in.
//
// So this is not a defect people fail to understand. It is one they cannot see,
// four times in one day, in files that had already been reviewed. That is the
// definition of something that wants a gate.
//
// ── what this checks ──────────────────────────────────────────────────────
//
// Two shapes, both of which mean "computed once, at mount, and never again":
//
//   1. `useMemo(… , [])` — an empty dependency array — whose body reads the
//      clock at all: `todayKey()`, `isoDay(…)`, `gymDay(…)`, `weekStartIso(…)`,
//      `new Date()`, `Date.now()`, `.toISOString().slice(…)`.
//
//   2. `const [x] = useState(…)` with NO setter destructured, where the initial
//      value is a CALENDAR DAY — `todayKey()`, `isoDay(…)`, `gymDay(…)`,
//      `weekStartIso(…)`, `new Date().toISOString().slice(…)`.
//
// The right answers are `useToday()` for a day and `useNow()` for an instant.
// Both live in src/ui/today.ts, both re-settle on the two moments that matter —
// the local day rolling over, and the app coming back to the foreground — and
// neither re-renders on any other tick, so nothing gets slower.
//
// ── why rule 2 is narrower than rule 1, on purpose ────────────────────────
//
// A setter-less `useState` holding an INSTANT is a legitimate and deliberate
// pattern in this tree, and two pages document why they use it: the analytics
// console freezes `Date.now()` so that the month counted as "running" cannot
// change underneath a table somebody is reading, and the invites console
// freezes it so a column of "3 days ago" does not tick over mid-read. Those are
// correct. Flagging them would put a gate in front of a decision that was made
// well, and a gate people argue with is a gate people switch off.
//
// A frozen calendar DAY is different in kind, and that is the whole distinction
// this file turns on. "Now" going stale by ten minutes changes a relative label.
// "Today" going stale by one day changes an ANSWER: expired reads as current,
// overdue reads as due, last month reads as this month. There is no reading of
// a screen for which yesterday's date is the right one to judge against.
//
// `useRef(todayKey())` is also not flagged, for the same reason in reverse:
// this tree's one instance of it (studio-web/app/money/page.tsx) is a sentinel
// recording what the component last SEEDED a date input with, so that a late
// tenant read never overwrites a date somebody typed. It is not being asked
// what day it is. Nothing about a ref says the value is meant to stay current,
// so there is no honest rule to write there — a person reading a ref of a date
// has to think about it, which is the outcome anyway.
//
// ── the escape hatch ──────────────────────────────────────────────────────
//
// A screen that genuinely wants the day it opened on — a receipt, a stamped
// snapshot, anything that is recording a moment rather than judging against
// one — says so on the line or in the comment immediately above it:
//
//     // frozen-day-ok: this stamps the export with the day it was TAKEN, and a
//     // stamp that moved after the fact would be a different claim
//
// The sentence is the point, exactly as with `no-error-ok:` in check-reads.mjs
// and `keyboard-ok:` in check-keyboard.mjs. It is what a reviewer reads when
// deciding whether "this value should not move" is honestly true.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** Everywhere a React component is written. The console is included: its pages
 *  are left open on a front desk for days, which is the same failure. */
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/components', 'studio-web/lib'];

/**
 * Does a marker apply to `line` (1-based)?
 *
 * On the line itself, or anywhere in the unbroken run of comment and blank
 * lines immediately above it. It has to be allowed above the line for the
 * reason check-rtl.mjs gives — a `//` inside JSX renders as two slashes on
 * somebody's screen — but it is a RUN and not a window of N lines, so an
 * annotation can never drift down and excuse the statement after the one it
 * was written for.
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

/** Reading the clock, in any form this tree uses. */
const READS_CLOCK = /\btodayKey\s*\(|\bisoDay\s*\(|\bgymDay\s*\(|\bweekStartIso\s*\(|\bstartOfWeek\s*\(|new\s+Date\s*\(|\bDate\.now\s*\(/;

/** Reading the clock and turning it into a CALENDAR DAY. The narrower set; see
 *  the header on why rule 2 uses it and rule 1 does not. */
const READS_DAY = /\btodayKey\s*\(|\bisoDay\s*\(|\bgymDay\s*\(|\bweekStartIso\s*\(|toISOString\s*\(\)\s*\.\s*slice\s*\(/;

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * A ratchet, not an ignore list, on exactly the terms `KNOWN` sets out in
 * check-dead-exports.mjs: a file listed at 1 fails the build at 2, and a count
 * that has DROPPED fails too, so the list can only shrink. Both entries this
 * gate's first run found are now cleared and the list is empty.
 *
 * `app/(owner)/revenue.tsx` — `forecastLabels` now derives its seven month keys
 * from `useToday()` and carries it in the dependency array. `useNow()` was what
 * this entry asked for and `useToday()` is the narrower right answer: the value
 * that has to stay true is a MONTH, `useToday` compares the day before it sets,
 * so the labels recompute at most once a day and only produce a new array on
 * the days that would produce a different one. Deriving the months FROM the day
 * string also removes the second clock read, so the value and its dependency
 * cannot come from two different instants.
 *
 * `studio-web/app/revenue/page.tsx` — `since` is no longer held at all. The
 * entry proposed a `useNow()` with `load` depending on it; there is no
 * `useNow()` in the console (src/ui/today.ts imports react-native's AppState),
 * and the better shape was available anyway: a window bound belongs to the READ
 * and not to the component, so it is computed inside `load`. There is now no
 * value to go stale and no dependency to forget. The same change wired the page
 * to `useFetched`/`Fetched` from studio-web/components/Fetched.tsx, which is
 * what made the frozen bound urgent rather than theoretical — before it, the
 * page's only refresh was a full document reload, which remounted and hid the
 * defect; now the tab coming back re-reads, and it re-reads a window ending
 * today.
 */
const KNOWN = new Map([]);

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

/**
 * The source with every comment and string body replaced by spaces of the same
 * length, so offsets, line numbers and bracket balance are all unchanged.
 *
 * This is not fastidiousness. Every file named in this header quotes the WRONG
 * form in its own comment explaining what it stopped doing — src/ui/today.ts
 * quotes it three times — so a scanner that reads comments reports the fix as
 * the bug. And blanking comments naively, by looking for `//`, eats the `//` in
 * a URL inside a string and takes the rest of the line's real code with it.
 */
function blank(src) {
  const out = Array.from(src);
  let i = 0;
  const space = (a, b) => { for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { let j = i; while (j < src.length && src[j] !== '\n') j++; space(i, j); i = j; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); const e = j < 0 ? src.length : j + 2; space(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      space(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/** The balanced text of a call starting at `open` (the index of its `(`). */
function callText(src, open) {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(open, j + 1); }
  }
  return null;
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
assertRootFloors('check:frozen-day', perRoot);

// The empty-set guard every gate here has. A check that passes because it
// looked at nothing is worse than no check.
if (files.length < 150) {
  console.error(`check-frozen-day: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

const found = [];
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = blank(raw);
  const rel = relative(ROOT, f);
  const rawLines = raw.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const marked = (line) => markedAbove(rawLines, line, /frozen-day-ok:\s*\S/);

  // ── rule 1: useMemo with an empty dependency array that reads the clock ──
  for (let i = src.indexOf('useMemo'); i >= 0; i = src.indexOf('useMemo', i + 1)) {
    const open = src.indexOf('(', i + 7);
    if (open < 0 || /\S/.test(src.slice(i + 7, open).replace(/<[^>]*>/g, ''))) continue;
    const text = callText(src, open);
    if (!text) continue;
    // An empty dependency array as the second argument. `[]` and nothing else:
    // a memo with real dependencies re-runs when they move and is not this bug.
    // The `,?` allows the trailing comma this tree writes on a multi-line call.
    // Without it `useMemo(() => todayKey(), [],)` matches nothing and is
    // invisible to this gate — the same blind spot that hid two frozen memos
    // from the first draft of scripts/check-frozen-hook.mjs.
    if (!/,\s*\[\s*\]\s*,?\s*\)$/.test(text)) continue;
    if (!READS_CLOCK.test(text)) continue;
    const line = lineOf(i);
    if (marked(line)) continue;
    const day = READS_DAY.test(text);
    found.push({
      rel, line,
      text: rawLines[line - 1].trim().slice(0, 110),
      wrong: `useMemo(…, []) reading the clock — an empty dependency array fixes this for the life of the MOUNT, and nothing in these apps unmounts a screen when the phone is pocketed`,
      right: day
        ? 'useToday() from src/ui/today.ts — the same string, re-settled at the next local midnight and on every foreground'
        : 'useNow() from src/ui/today.ts — the same Date, re-settled at midnight, on foreground, and when the screen is focused',
    });
  }

  // ── rule 2: a setter-less useState holding a calendar day ───────────────
  const STATE = /const\s*\[\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState/g;
  let m;
  while ((m = STATE.exec(src))) {
    const open = src.indexOf('(', m.index + m[0].length - 1);
    if (open < 0) continue;
    const text = callText(src, open);
    if (!text || !READS_DAY.test(text)) continue;
    const line = lineOf(m.index);
    if (marked(line)) continue;
    found.push({
      rel, line,
      text: rawLines[line - 1].trim().slice(0, 110),
      wrong: `useState with no setter, holding a calendar day — \`${m[1]}\` is the day the screen OPENED on and can never become the day it is being read on`,
      right: 'useToday() from src/ui/today.ts. If the day genuinely must not move, keep it and say so: `// frozen-day-ok: <why yesterday is the right day to judge against>`',
    });
  }
}

/* ── the ratchet ──────────────────────────────────────────────────────────── */

const byFile = new Map();
for (const h of found) {
  if (!byFile.has(h.rel)) byFile.set(h.rel, []);
  byFile.get(h.rel).push(h);
}

const fresh = [];
for (const [rel, hits] of byFile) {
  const allowed = KNOWN.get(rel)?.count ?? 0;
  if (hits.length > allowed) fresh.push(...hits.map((h) => ({ ...h, allowed, total: hits.length })));
}

const drifted = [];
for (const [rel, entry] of KNOWN) {
  const n = byFile.get(rel)?.length ?? 0;
  if (n < entry.count) drifted.push({ rel, was: entry.count, now: n, fix: entry.fix });
}

if (fresh.length) {
  const found = fresh;
  found.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1));
  console.error(`\n${found.length} clock${found.length === 1 ? '' : 's'} that stopped when the screen opened:\n`);
  for (const h of found) {
    if (h.allowed) console.error(`  (${h.rel} is on the ratchet at ${h.allowed}; it now has ${h.total})`);
    console.error(`  ${h.rel}:${h.line}`);
    console.error(`    ${h.text}`);
    console.error(`    wrong: ${h.wrong}`);
    console.error(`    right: ${h.right}\n`);
  }
  console.error('A coach whose public liability insurance expired on Monday read as covered, in');
  console.error('the green, on Wednesday, because the screen judging it was still asking Sunday\'s');
  console.error('question. src/ui/today.ts is the answer and its header argues the whole case.\n');
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
console.log(`check-frozen-day — ok, ${files.length} files; no new clock frozen at mount${backlog ? `, ${backlog} known and ratcheted` : ''}`);
