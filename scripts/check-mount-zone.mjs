#!/usr/bin/env node
// A date box seeded from a timezone the page did not have yet.
//
// ── the bug, and why every careful fix in front of it did nothing ─────────
//
// `useState(today)` runs its initialiser ONCE, at mount. That is not news. What
// makes it a defect in this console specifically is WHEN a studio-web page
// learns what day it is.
//
// Every page here learns the gym's timezone asynchronously. The effect does
// `setMe(who)` first and only THEN awaits `readTenant`; studio-web/app/costs/page.tsx
// and studio-web/app/accounting/page.tsx await `fetchGymZone` after that again.
// React has already painted by then, with `zone === null` — and at `zone ===
// null` `gymDay()` returns null (src/lib/gymZone.ts says so in as many words,
// because a gym with no zone has no calendar of its own) and the fallback on
// every one of these pages is `isoDate(new Date())`: the READER's calendar.
//
// So the house line
//
//     const today = gymDay(Date.now(), zone) ?? isoDate(new Date());
//
// is correct, is carefully commented on five pages, and was still landing the
// READER's day in the box — because the box read it once, at mount, in the one
// window where `zone` is always null. The repair had no effect on the value
// anybody saw for any gym that HAD set a zone, which is every gym it was
// written for. The comment above the line said the right thing; the line below
// it took the value before the right thing was knowable.
//
// ── what it cost, at the four sites found ────────────────────────────────
//
//   studio-web/app/accounting/page.tsx  `Register` — the issue date on an
//     invoice. `next_gym_invoice_number` takes the YEAR from it
//     (supabase/parts/180-invoice-numbers.sql), so a day out across a year
//     boundary numbers an invoice into the wrong year's sequence. A London
//     bookkeeper raising an Auckland gym's invoice at 22:00 on 31 December was
//     offered 31 December for a gym already in January.
//
//   the same component's due date — which additionally latched
//     `dueAfter(today, 30)` at mount and then never tracked the issue date, so
//     moving the issue date back to the 1st left the terms at thirty days from
//     whenever the tab was opened: an invoice whose stated term is not the term
//     the code above it claims.
//
//   studio-web/app/equipment/page.tsx  `History` — the day a service or an
//     INCIDENT happened. That row is the gym's accident book, and the day
//     something happened is the whole record.
//
//   studio-web/app/costs/page.tsx  `Record` — the day money went out, onto a
//     permanent ledger row that /accounting and /close bucket by month; and
//     `TemplateForm` — the day a standing arrangement starts.
//
// All five hold the right shape now. This gate is here because the wrong one is
// invisible: `useState(today)` is the obvious way to seed a box, it type-checks,
// it reviews clean, and on the author's machine — in the gym's own timezone, or
// near enough — it produces exactly the right answer every time it is tested.
//
// ── the shape that is right, and why null rather than a string ───────────
//
//     const [picked, setPicked] = useState<string | null>(null);
//     const issuedOn = picked ?? today;
//     const setIssuedOn = setPicked;
//
// `null` means "nobody has chosen", so the box FOLLOWS the gym's day until
// somebody touches it, and it follows it through the zone read landing, through
// midnight, and through the month rolling over.
//
// The empty string is a CHOICE and still works: `'' ?? x` is `''`, so clearing
// the box leaves it cleared. That is the property a `picked || today` would
// quietly take away, which is why the tree writes `??`.
//
// ── what this gate looks for ─────────────────────────────────────────────
//
// In a file that reads a zone asynchronously — one that calls `fetchGymZone(`,
// or `setZone(`, or `readTenant(` while also naming `zone` — a `useState` whose
// initialiser depends on a value derived from the gym's zone or from the clock:
//
//   directly    `useState(gymDay(Date.now(), zone) ?? isoDate(new Date()))`
//   one hop     `const today = gymDay(…) ?? isoDate(new Date()); … useState(today)`
//   two hops    `const initialDay = today >= w.firstDay ? today : w.lastDay;`
//               … `useState(initialDay)` — which is the shape /costs had
//   through a prop written in the same file
//               `<History today={today} …>` marks the PROP NAME `today` as
//               carrying a day, so `function History({ today })` … `useState(today)`
//               is seen. That is how the equipment page's defect was shaped and
//               a gate that could not follow one prop would have missed it.
//
// Names are tracked per FILE, not per scope. Two different locals called
// `today` in one file are treated as the same value. That is an
// over-approximation and it can flag something honest; the cost of being wrong
// is one marker line with a reason, and the cost of being scope-accurate was a
// scope resolver that would itself need a gate.
//
// ── what it deliberately CANNOT see, and does not claim to ───────────────
//
// This is a static check on one file at a time. Be clear about the edges, both
// because a gate that overstates itself gets believed and because the next
// person to widen it should know where to start.
//
//   · A COMPONENT IN ANOTHER FILE. If a form lives in
//     studio-web/components/ and is handed `today` or `zone` as a prop by a
//     page that reads the zone asynchronously, nothing in the component's own
//     file says the value arrives late, and this gate will not fire. It fires
//     on the file that holds the async read. Every instance found so far has
//     been a component declared in the same page file, which is the house
//     pattern here, but that is a fact about today's tree and not a guarantee.
//
//   · WHETHER THE ZONE ACTUALLY ARRIVES LATE. The precondition is that the file
//     reads a zone asynchronously at all — not that THIS component mounts
//     before THAT read resolves. Proving the second needs the render graph and
//     the effect order, which is not a thing to derive from text. A page that
//     awaits its zone before it renders any form at all would be flagged here
//     and is entitled to a marker saying so.
//
//   · A VALUE LATCHED BY SOMETHING OTHER THAN `useState`. `useRef(today)`,
//     `useMemo(() => today, [])` and a module-level `const` are the same defect
//     in different clothing. The memo is scripts/check-frozen-day.mjs's rule 1
//     and is already gated; the ref is deliberately not, for the reason that
//     file gives — nothing about a ref claims the value stays current, so there
//     is no honest rule to write. A module-level `const today = …` would be a
//     worse bug than any of these and is caught by nothing here.
//
//   · WHETHER THE SEED IS A DAY AT ALL. `useState(new Date())` holding an
//     instant for a relative label is flagged by this gate the same as a date
//     box, because the text cannot tell them apart and the file-level
//     precondition says somebody on this page is doing zone-sensitive work.
//     Those take a marker. scripts/check-frozen-day.mjs draws that same line in
//     the other direction and its header explains why a frozen instant is often
//     correct where a frozen DAY never is.
//
//   · ANYTHING IN THE THREE MOBILE APPS BEYOND THE SAME SHAPE. `app/` and
//     `src/` are scanned, and six screens there do read a zone
//     asynchronously (app/(owner)/financials.tsx and app/(owner)/ops.tsx among
//     them), so the rule applies to them identically. It has found nothing
//     there yet. Absence of a hit is not evidence the phones are clean — see
//     the first two bullets for what it cannot look at.
//
// ── the escape hatch ─────────────────────────────────────────────────────
//
// A value that genuinely should be taken once, at mount, says so on the line or
// in the comment run immediately above it, with a reason:
//
//     // mount-zone-ok: this stamps the export with the instant it was STARTED,
//     // and a stamp that moved once the tenant read landed would be a different
//     // claim about when the file was made
//
// The sentence is the point, exactly as with `frozen-day-ok:` in
// scripts/check-frozen-day.mjs and `utc-day-ok:` in scripts/check-utc-day.mjs.
// Writing it means saying which day the box is supposed to hold when the zone
// arrives a beat later — which is the thought that was skipped all five times.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** Everywhere a React component is written and a tenant's zone is read. The
 *  console is where every instance has been found; the phones are here because
 *  six owner screens read a zone the same asynchronous way. */
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/lib', 'studio-web/components'];

/** Somebody may run this on one file to see the rule bite. `node
 *  scripts/check-mount-zone.mjs <path>` checks exactly that file and nothing
 *  else — the roots, the floors and the ratchet are all skipped, because a
 *  single-file run is a demonstration and not a verdict on the tree. */
const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('-'));

/**
 * Does a marker apply to `line` (1-based)?
 *
 * On the line itself, or anywhere in the unbroken run of comment and blank
 * lines immediately above it. It has to be allowed above the line for the
 * reason scripts/check-rtl.mjs gives — a `//` inside JSX renders as two slashes
 * on somebody's screen — but it is a RUN and not a window of N lines, so an
 * annotation can never drift down and excuse the statement after the one it was
 * written for.
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
 * The source with every comment and string body replaced by spaces of the same
 * length, so offsets, line numbers and bracket balance are all unchanged.
 *
 * Taken from scripts/check-frozen-day.mjs, and for the reason its header gives:
 * every file named in the header above quotes the WRONG form in its own comment
 * explaining what it stopped doing — studio-web/app/accounting/page.tsx quotes
 * `useState(today)` twice — so a scanner that reads comments reports the fix as
 * the bug.
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

/** The text of an initialiser from `=` to the end of its statement — the first
 *  `;` or newline at bracket depth zero. Depth matters: a multi-line object or
 *  a ternary spread over four lines is one initialiser. */
function initText(src, eq) {
  let depth = 0;
  for (let j = eq + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return src.slice(eq + 1, j); depth--; }
    else if (depth === 0 && (c === ';' || c === ',')) return src.slice(eq + 1, j);
    else if (depth === 0 && c === '\n') {
      // A statement wrapped onto the next line continues; one that has finished
      // does not. `=` at the end of a line, or an operator, means more is coming.
      const sofar = src.slice(eq + 1, j);
      if (/(\?\?|\?|:|\|\||&&|\+|=|>|<|,|\()\s*$/.test(sofar)) continue;
      return sofar;
    }
  }
  return src.slice(eq + 1);
}

/** Reading the clock, in any form these trees use. */
const CLOCK = /new\s+Date\s*\(|\bDate\.now\s*\(|\bisoDate\s*\(|\bisoDay\s*\(|\btodayKey\s*\(|\bweekStartIso\s*\(|\bmonthKeyOf\s*\(/;

/**
 * Turning an instant into a calendar the GYM keeps — every one of these takes
 * the zone, and every one of them answers differently, or answers null, while
 * the zone is still on its way.
 *
 * A bare mention of `zone` is deliberately NOT here. It was, for one run, and
 * it marked every value on the page: /accounting loads its books with the zone
 * among the arguments, so `books` became a day, then `books.marks`, then the
 * note somebody types about a reconciliation exception. A value that was
 * COMPUTED FROM the gym's calendar is the thing at stake; a value that was
 * merely fetched in the same breath as the zone is not.
 */
const ZONE_CALL = /\bgymDay\s*\(|\bgymNow\s*\(|\bgymWallValue\s*\(|\bgymRecentMonths\s*\(|\bcutAtGym\s*\(|\bgymDayBounds\s*\(|\bgymWeekday\s*\(|\bgymHour\s*\(/;

/** Where a day comes FROM. A declaration whose initialiser contains one of
 *  these holds a day, a month or an instant, and everything downstream of it
 *  inherits the problem. */
const DAY_SOURCE = new RegExp(`${CLOCK.source}|${ZONE_CALL.source}`);

/** A call that takes a day and hands back another one: `dueAfter(today, 30)`,
 *  `monthOf(day)`, `addDays(from, 7)`. Named by shape rather than listed,
 *  because the list would be wrong the week after it was written — and it only
 *  matters at all when one of the ARGUMENTS is already known to be a day. */
const DAY_HELPER = /^(?:[\w$]+\.)*[\w$]*(?:day|date|month|week|iso|gym|after|before|until|since|start|end)[\w$]*$/i;

/** The file learns the zone AFTER the first paint. `readTenant` counts only
 *  where the file also names `zone`, because that read carries the currency for
 *  pages that never ask what day it is. */
function zoneAsync(src) {
  if (/\bfetchGymZone\s*\(/.test(src)) return 'fetchGymZone()';
  if (/\bsetZone\s*\(/.test(src)) return 'setZone()';
  if (/\breadTenant\s*\(/.test(src) && /\bzone\b/.test(src)) return 'readTenant() beside a zone';
  return null;
}

/**
 * The top-level operands of an expression: what is left when `??`, `||`, `&&`,
 * a ternary and a comma are treated as the choices they are. `picked ?? today`
 * has two, `a >= b ? a : b` has three, and anything inside brackets belongs to
 * the operand it is inside.
 */
function operands(text) {
  const out = [];
  let depth = 0, start = 0;
  const push = (end) => { const t = text.slice(start, end).trim(); if (t) out.push(t); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0) {
      if (c === '?' && text[i + 1] === '?') { push(i); start = i + 2; i++; }
      else if (c === '|' && text[i + 1] === '|') { push(i); start = i + 2; i++; }
      else if (c === '&' && text[i + 1] === '&') { push(i); start = i + 2; i++; }
      else if (c === '?' || c === ':' || c === ',') { push(i); start = i + 1; }
    }
  }
  push(text.length);
  return out;
}

/** An operand that IS one of these names — the identifier itself, or a property
 *  read off it (`w.firstDay`, `seed?.paidOn`). The HEAD is what matters:
 *  `seed?.paidOn` is the arrangement's stored day, not the local `paidOn`, and a
 *  check that matched on the last segment would read the /costs repair as the
 *  defect it replaced. */
function isName(operand, names) {
  const bare = operand.replace(/^[!(\s]+/, '').replace(/[)\s]+$/, '');
  const m = /^([A-Za-z_$][\w$]*)((?:\?\.|\.)[A-Za-z_$][\w$]*)*$/.exec(bare);
  return !!m && names.has(m[1]);
}

/** `dueAfter(today, 30)` — a day in, a day out. Only where the callee's name
 *  says it is about calendars, and only where an argument is already a day. */
function helperCarries(operand, names) {
  const m = /^([\w$.?]+)\s*\((.*)\)$/s.exec(operand.trim());
  if (!m || !DAY_HELPER.test(m[1].replace(/\?\./g, '.'))) return false;
  return operands(m[2]).some((a) => isName(a, names) || DAY_SOURCE.test(a));
}

/** Does this expression hand on a day it was given? */
const carries = (text, names) =>
  operands(text).some((op) => isName(op, names) || helperCarries(op, names));

/**
 * Every identifier in this file that carries a day, a month or an instant
 * derived from the zone or the clock — the seeds, then what they are passed
 * into, then the prop names they are handed down under.
 *
 * Three passes rather than a fixed point. The real chains are short — `zone` →
 * `today` → `initialDay` is the longest in this tree — and an unbounded closure
 * over file-scope names drifts towards marking everything, which is exactly
 * what the first draft of this function did.
 */
function dayNames(src) {
  const names = new Set();
  const decls = [];
  const DECL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*)?=/g;
  let m;
  while ((m = DECL.exec(src))) decls.push({ name: m[1], init: initText(src, DECL.lastIndex - 1) });

  for (const d of decls) if (DAY_SOURCE.test(d.init)) names.add(d.name);

  for (let pass = 0; pass < 3; pass++) {
    const before = names.size;
    for (const d of decls) if (!names.has(d.name) && carries(d.init, names)) names.add(d.name);
    // `<History today={today} …>` — the prop NAME now carries a day, so the
    // component's `function History({ today })` is covered. The value has to BE
    // the day, not merely mention one: `existing={mark ?? null}` passes a
    // reconciliation note and must not turn `existing` into a calendar.
    for (const a of src.matchAll(/([A-Za-z_$][\w$]*)=\{([^{}]*)\}/g)) {
      if (DAY_SOURCE.test(a[2]) || carries(a[2], names)) names.add(a[1]);
    }
    if (names.size === before) break;
  }
  return names;
}

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
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * ── this is a ratchet, not an ignore list ─────────────────────────────────
 *
 * Same mechanism, and the same argument, as `KNOWN` in
 * scripts/check-dead-exports.mjs and scripts/check-utc-day.mjs. The count is the
 * point: a file listed at 4 fails the build at 5, so the backlog can shrink and
 * can never grow. A count that has DROPPED fails too, asking for the number to
 * come down with the work, because a list that over-states what is wrong is how
 * a ratchet turns into an ignore list one stale line at a time.
 *
 * Two kinds of entry, and the difference matters when you pick one up:
 *
 *   [fix]      the value is a day somebody reads or files, and it is latched at
 *              mount. Replace it with the `picked ?? today` shape above, or with
 *              the correction-effect shape /money uses — see the note on
 *              studio-web/app/money/page.tsx below, which is the other honest
 *              answer and is already written out in this tree.
 *   [annotate] the value is defensible where it stands and what is missing is
 *              the SENTENCE saying so. The edit is to paste a `mount-zone-ok:`
 *              marker with a reason, and the entry then comes off this list.
 *              It is on the list rather than pre-annotated because this gate was
 *              written in a lane that does not own those files, and a gate
 *              author quietly annotating other people's code is how a rule gets
 *              weakened by the person least placed to judge it.
 *
 * Nine entries on the first run, in six files. Five of them are real and unfixed
 * — this gate was written the night the five sites named in the header above
 * were repaired by hand, and it found four MORE of the same shape that the hand
 * sweep had not reached, plus the retention log's wall-clock box.
 */
const KNOWN = new Map([
  ['studio-web/app/accounting/page.tsx', { count: 4, fix: '[fix] all four are in `Filed` and `Chasing`. `filedOn` and `chasedOn` take `today` — the same `gymDay(Date.now(), zone) ?? isoDate(new Date())` line `Register` twenty lines up has already been repaired for — and `filedOn` is the record of whether a tax deadline was met, which `filingBlockers` then judges against. `periodFrom`/`periodTo` take `w.firstDay`/`w.lastDay`: those day strings do not move with the zone, but the MONTH they come from does — `key` is `gymRecentMonths(2, zone, …).keys[1]`, and with no zone that is the READER\'s month — so on the days either side of a month boundary the period boxes hold a month the gym is not in. Same repair as `Register`: hold `useState<string | null>(null)` and render `picked ?? today`.' }],
  ['studio-web/app/retention/page.tsx', { count: 1, fix: '[fix] `LogForm`\'s `when` is `gymWallValue(Date.now(), zone) ?? localNow()` latched at mount, and the comment above it says in as many words that the reader\'s local parts in this field are the defect it was written to remove. At mount `zone` is null, `gymWallValue` returns null and `localNow()` — the browser\'s wall clock — is what goes in the box, which is then read back by the rest of the console as the gym\'s. Hold null for "nobody has chosen" and render `picked ?? gymWallValue(Date.now(), zone) ?? localNow()`.' }],
  ['studio-web/app/money/page.tsx', { count: 1, fix: '[annotate] `startedOn` is seeded at mount AND corrected by an effect on `[zone]` that only overwrites a value the component itself seeded — `seeded`, a ref sentinel, so a date somebody typed is never clobbered by a late tenant read. That is the second honest answer to this bug and it is already correct. What is missing is the marker: `mount-zone-ok:` saying the effect below corrects it and the sentinel is what makes that safe.' }],
  ['studio-web/app/analytics/page.tsx', { count: 1, fix: '[annotate] `const [now] = useState(() => Date.now())` freezes an INSTANT on purpose, so the month counted as "running" cannot change underneath a table somebody is reading. scripts/check-frozen-day.mjs names this exact line as a deliberate and correct freeze. Mark it `mount-zone-ok:` saying it is a reporting instant and not a day anybody files against.' }],
  ['studio-web/app/invites/page.tsx', { count: 1, fix: '[annotate] the same deliberate frozen instant as /analytics — it keeps a column of "3 days ago" from ticking over mid-read, and scripts/check-frozen-day.mjs names it too. Mark it `mount-zone-ok:` with that reason.' }],
  ['studio-web/app/door/page.tsx', { count: 1, fix: '[annotate] `dayTick` is a REPAINT clock, not a day anybody reads: its only job is to change value when the tablet crosses midnight so an untouched screen re-renders, and the day actually compared against is `gymDay(Date.now(), zone) ?? dayTick` sixty lines below, which asks the gym first. It already carries a `reader-day-ok:` marker saying so for a different gate. Add `mount-zone-ok:` with the same sentence.' }],
]);

let files = [];
if (ONLY.length) {
  files = ONLY.map((f) => (f.startsWith('/') ? f : join(ROOT, f)));
} else {
  /* Counted per ROOT, not just in total. A single total threshold cannot notice
   * a root going missing, because the other roots cover for it — see
   * scripts/gate-floor.mjs. */
  const perRoot = new Map();
  for (const r of ROOTS) {
    const before = files.length;
    walk(join(ROOT, r), files);
    perRoot.set(r, files.length - before);
  }
  assertRootFloors('check:mount-zone', perRoot);

  // The empty-set guard every gate here has. A check that passes because it
  // looked at nothing is worse than no check: it reports "ok" and a count.
  if (files.length < 150) {
    console.error(`check-mount-zone: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
    process.exit(1);
  }
}

const found = [];
let watched = 0;
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = blank(raw);
  const why = zoneAsync(src);
  if (!why) continue;
  watched++;
  // Repo-relative where it is in the repo; as given otherwise, so a
  // single-file run on a scratch reconstruction does not print a path made of
  // `../..`.
  const rel = f.startsWith(ROOT) ? relative(ROOT, f) : f;
  const rawLines = raw.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const names = dayNames(src);

  for (let i = src.indexOf('useState'); i >= 0; i = src.indexOf('useState', i + 1)) {
    // `useState<string | null>(` — the type argument is skipped, so a type that
    // mentions a day-shaped name cannot be mistaken for an initialiser.
    const open = src.indexOf('(', i + 8);
    if (open < 0) continue;
    const between = src.slice(i + 8, open);
    if (/[^\s<>|&,[\]{}()A-Za-z0-9_$.'"]/.test(between.replace(/\s/g, ''))) continue;
    const text = callText(src, open);
    if (!text) continue;
    const arg = text.slice(1, -1);
    if (!arg.trim()) continue;                       // useState() — nothing to latch

    // Held directly: the initialiser reads the clock or asks for the gym's
    // calendar itself — including `useState(zone)`, which latches the very value
    // that is null at mount.
    const direct = DAY_SOURCE.test(arg) || operands(arg).some((op) => isName(op, new Set(['zone'])));
    const via = direct ? null : [...names].find((n) => carries(arg, new Set([n])));
    if (!direct && !via) continue;

    const line = lineOf(i);
    if (markedAbove(rawLines, line, /mount-zone-ok:\s*\S/)) continue;
    found.push({
      rel, line,
      text: rawLines[line - 1].trim().slice(0, 110),
      seed: direct ? 'the clock or the gym\'s zone, read here' : `\`${via}\`, which this file derives from the clock or the gym's zone`,
      why,
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
  const allowed = ONLY.length ? 0 : (KNOWN.get(rel)?.count ?? 0);
  if (hits.length > allowed) fresh.push(...hits.map((h) => ({ ...h, allowed, total: hits.length })));
}

const drifted = [];
if (!ONLY.length) {
  for (const [rel, entry] of KNOWN) {
    const n = byFile.get(rel)?.length ?? 0;
    if (n < entry.count) drifted.push({ rel, was: entry.count, now: n, fix: entry.fix });
  }
}

if (fresh.length) {
  fresh.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1));
  console.error(`\n${fresh.length} value${fresh.length === 1 ? '' : 's'} latched at mount, in a file that does not know the gym's timezone until after the first paint:\n`);
  for (const h of fresh) {
    if (h.allowed) console.error(`  (${h.rel} is on the ratchet at ${h.allowed}; it now has ${h.total})`);
    console.error(`  ${h.rel}:${h.line}`);
    console.error(`    ${h.text}`);
    console.error(`    seeded from: ${h.seed}`);
    console.error(`    this file reads the zone asynchronously — ${h.why} — so at the moment this initialiser runs, \`zone\` is null,`);
    console.error('      gymDay() returns null, and the fallback is the READER\'s calendar. The value never catches up.');
    console.error('    right: hold `useState<string | null>(null)` meaning "nobody has chosen" and render `picked ?? today`.');
    console.error('      The empty string is still a choice — `\'\' ?? x` is `\'\'` — so clearing the box goes on working.\n');
  }
  console.error('An invoice raised at 22:00 in London for an Auckland gym was dated yesterday, and');
  console.error('next_gym_invoice_number takes the YEAR from that date. The comment above the line');
  console.error('said "the GYM\'s day"; the line took it before the gym\'s day was knowable. If this');
  console.error('one really must be taken once, say so: `// mount-zone-ok: <why the value must not');
  console.error('move when the zone lands>`.\n');
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
if (ONLY.length) {
  console.log(`check-mount-zone — ok, ${files.length} file${files.length === 1 ? '' : 's'} named on the command line, ${watched} of them reading a zone asynchronously; nothing latched at mount`);
} else {
  console.log(`check-mount-zone — ok, ${files.length} files, ${watched} of them reading a zone asynchronously; no date seeded from a timezone the page did not have yet${backlog ? `, ${backlog} known and ratcheted` : ''}`);
}
