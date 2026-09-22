#!/usr/bin/env node
// One console, one answer to "whose format is this".
//
// ── What went wrong ───────────────────────────────────────────────────────
//
// `studio-web/components/DataTable.tsx` formats a row count with a bare
// `toLocaleString()` and defends it, correctly, at the line above: "A gym in
// Dubai, one in London and one in Tokyo run this same binary and there is no
// house separator that is not simply wrong for two of them." The reader's
// locale is the right answer for a number.
//
// The same argument applies to every DATE on the same page and was never made
// there. `studio-web/app/accounting/page.tsx` drew payment dates with
// `toLocaleDateString()` — the reader's locale AND the reader's zone — and
// `studio-web/app/orders/page.tsx` went the other way entirely with
// `new Date(t).toISOString().replace('T', ' ').slice(0, 16)`, a raw UTC stamp
// with no locale and no zone at all. Three conventions on three lines of one
// console, and `scripts/check-locale.mjs` passed every one of them because it
// only forbids NAMING a locale — and does not read `studio-web` in the first
// place.
//
// ── What went wrong the SECOND time ───────────────────────────────────────
//
// This file used to be a grep over `studio-web` for `.toLocaleDateString(`,
// and it printed "ok, every date in the console is drawn on the gym's clock"
// while `studio-web/app/coach/page.tsx` drew every date and time on it through
// `fmtDay` and `fmtTime` — which are `toLocaleDateString` and `Intl` calls
// sitting one directory away in `src/lib/format.ts`. The grep looked in
// `studio-web`; the offending call was in `src`; the gate said ok and the
// sentence was quoted as evidence. A gym in Dubai read from a laptop still set
// to London filed every session before 04:00 under the previous day.
//
// A gate that greps for a spelling of the symptom, in one of the two places
// the symptom can live, is worse than no gate, because its "ok" is believed.
// So this no longer only greps. It FOLLOWS THE IMPORT: every module the
// console pulls a name out of is parsed, every function in it is classified,
// and a console file that imports a function which turns an INSTANT into text
// on whatever clock the reader's machine is set to is a failure — however many
// modules away that `toLocale*` call actually is.
//
// ── The rule this enforces ────────────────────────────────────────────────
//
//   A number is written in the READER's locale.
//   A date is written in the READER's locale and the GYM's zone.
//   A calendar date is written in the reader's locale and NO zone.
//   The console's "today" is the GYM's day, never the reader's.
//
// The first is left alone — `toLocaleString()` on a number is correct and is
// why this check is a rule about DATES rather than about `toLocale*`. The rest
// go through `src/lib/gymWhen.ts`, which is the only place in the console where
// an instant becomes text, and `gymDay` from `src/lib/gymZone.ts`, which is the
// only place a "today" comes from.
//
// ── What it flags ─────────────────────────────────────────────────────────
//
// 1. LINES in the console (unchanged from the first version of this gate):
//
//    a. `toLocaleDateString(` / `toLocaleTimeString(` anywhere under
//       `studio-web`. Those two exist only on Date, so there is no number case
//       to spare: every one of them is a date drawn on the reader's clock.
//    b. `.toLocaleString(` where the receiver is a Date — matched as `Date(`
//       earlier on the same line. A bare `n.toLocaleString()` on a number is
//       NOT flagged, and that is deliberate.
//    c. The raw UTC stamp: `toISOString()` followed by `.replace('T', ' ')`.
//       Allowed on a line that says `UTC` out loud.
//
// 2. IMPORTS into the console of a function that renders an instant on the
//    reader's clock — resolved by reading the module the name comes from, not
//    by knowing its name. See `rendersLocally()` and `takesInstant()` below for exactly what makes
//    a function one of those, and `--why` for the chain it found.
//
// 3. `isoDate(new Date())` in the console that is not the fallback arm of
//    `gymDay(...) ?? …` and does not carry a `reader-day-ok:` marker. That is
//    the calendar day on whichever machine has the tab open; the console's
//    today is the gym's. (`scripts/check-utc-day.mjs` cannot cover this: that
//    gate is about UTC's day, and this is the laptop's. Two different wrong
//    answers to the same question.)
//
// 4. The six routes fixed on 3 September no longer asking `gymDay()` at all.
//
// Rules 2, 3 and 4 arrived here from `src/lib/consoleClock.test.ts`, which a
// lane that could not edit `scripts/` wrote as a test instead. Rule 2 is
// strictly stronger here than it was there: that test held a hardcoded list of
// four names (`fmtDay`, `fmtRelativeDay`, `fmtFullDay`, `fmtTime`) and would
// have passed the fifth one somebody adds to `src/lib/format.ts` tomorrow, and
// passed a wrapper in any other module that calls one of the four. This reads
// the module.
//
// ── What it still cannot see ──────────────────────────────────────────────
//
// A formatter reached through a value rather than a name (a function in an
// object literal, a callback passed as a prop), a date formatted by a library
// this repo does not have, and `export * from` re-export chains. Those are
// named here rather than half-matched, because a half-match is how the first
// version of this file came to print "ok".
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const CONSOLE_ROOTS = ['studio-web/app', 'studio-web/components', 'studio-web/lib'];
/** Everything a console file can reach by name. Parsed so that rule 2 can
 *  follow an import out of the console and into the module it lands in. */
const LIB_ROOTS = ['src/lib', 'studio-web/lib', 'studio-web/components', 'studio-web/app'];

const WHY = process.argv.includes('--why');

/** `x.toLocaleDateString(` and `x.toLocaleTimeString(` — Date-only methods. */
const DATE_METHOD = /\.toLocale(?:Date|Time)String\s*\(/;
/** `new Date(…).toLocaleString(` — a Date going through the both-halves form. */
const DATE_TO_STRING = /Date\s*\([^)]*\)\s*\.toLocaleString\s*\(/;
/** `…toISOString().replace('T', ' ')` — the raw UTC stamp. */
const UTC_STAMP = /toISOString\s*\(\s*\)\s*\.replace\s*\(\s*['"]T['"]/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.next') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * The backlog: console imports of a reader's-clock formatter standing on the
 * day this gate learned to follow an import, and why each is still there.
 *
 * EMPTY, and it stays empty. It held two, both real defects and both a module
 * away in `src/lib`:
 *
 *   · `studio-web/app/door/page.tsx rollCallHtml` — `src/lib/rollCall.ts` drew
 *     the printed roll call's "printed at" and every "in since" with a bare
 *     `toLocaleString()` / `toLocaleTimeString()`. That sheet is PRINTED and
 *     pinned to a door: it outlives the browser that drew it and there is
 *     nobody left to ask whose clock it was. `RollCall` now carries `zone` and
 *     both go through `gymDateTimeText` / `gymTimeText`; a gym with no timezone
 *     set gets `NO_ZONE_NOTE` in the sheet's own caveats.
 *   · `studio-web/app/members/page.tsx noteAttribution` — `src/lib/memberNotes.ts`
 *     dated every note on whichever laptop had the tab open, on the one record
 *     an owner opens in a dispute. `noteAttribution` now takes the zone beside
 *     the note.
 *
 * So a hit here is now a regression rather than a backlog, which is the only
 * state a ratchet is worth anything in. Adding an entry to get a run green is
 * how this file would stop being a gate; the fix goes in the module, and the
 * two above are the worked examples of what that costs (a parameter, and a
 * field on a type the console already had to hand).
 */
const KNOWN_IMPORTS = new Map([]);

const HELP = 'Use gymDateText / gymDateTimeText / gymTimeText from src/lib/gymWhen.ts '
  + '(the reader’s locale, the gym’s zone), or calendarDateText for a YYYY-MM-DD '
  + 'that is a calendar day rather than an instant.';

const consoleFiles = [];
for (const root of CONSOLE_ROOTS) consoleFiles.push(...walk(join(ROOT, root)));
consoleFiles.sort();

// ── the empty-set guard ────────────────────────────────────────────────────
//
// The console had 96 source files the day this was written. A run that finds a
// handful of them has been pointed at the wrong place — a moved directory, a
// `cwd` that is not the repository root — and must not be allowed to print
// "ok" over a tree it never opened. Forty is low enough that deleting a third
// of the console does not trip it and high enough that finding nothing does.
if (consoleFiles.length < 40) {
  console.error(`check:console-when — only found ${consoleFiles.length} source files under `
    + `${CONSOLE_ROOTS.join(', ')}, which cannot be right. Run from the repository root. Refusing to pass.`);
  process.exit(1);
}

/* ══ the module reader ═════════════════════════════════════════════════════
 *
 * Enough of a parse to answer one question about one function: does calling it
 * with an INSTANT give you text on the READER's clock?
 */

/** Split an argument list on top-level commas. */
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q && s[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The text between the parens that start at `open`, and the index after. */
function balanced(src, open, pair = '()') {
  let depth = 0, q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === q && src[i - 1] !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === pair[0]) depth++;
    else if (c === pair[1]) { depth--; if (depth === 0) return { text: src.slice(open + 1, i), end: i }; }
  }
  return null;
}

/**
 * Every function in one module, exported or not — a local helper is on the
 * path from a console import to a `toLocale*` call as surely as an exported
 * one is.
 *
 * Recognised shapes: `function f(…) {…}`, `export function f(…) {…}`,
 * `const f = (…) => …`, `const f = function (…) {…}`. Methods on an object
 * literal are not, and that is one of the named blind spots at the top.
 */
function functionsIn(src) {
  const out = [];
  const decl = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g;
  let m;
  while ((m = decl.exec(src))) {
    const open = src.indexOf('(', m.index + m[0].length - 1);
    const params = balanced(src, open);
    if (!params) continue;
    const brace = src.indexOf('{', params.end);
    if (brace < 0) continue;
    const body = balanced(src, brace, '{}');
    if (!body) continue;
    out.push({ name: m[1], params: params.text, body: body.text });
  }
  const arrow = /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:<[^>]*>\s*)?\(/g;
  while ((m = arrow.exec(src))) {
    const open = src.indexOf('(', m.index + m[0].length - 1);
    const params = balanced(src, open);
    if (!params) continue;
    const after = src.slice(params.end + 1, params.end + 200);
    if (!/^\s*(?::[^=]*)?=>/.test(after)) continue;
    const arrowAt = src.indexOf('=>', params.end);
    const brace = src.indexOf('{', arrowAt);
    let body;
    if (brace >= 0 && /^\s*$/.test(src.slice(arrowAt + 2, brace))) {
      body = balanced(src, brace, '{}')?.text ?? '';
    } else {
      // Expression body — to the end of the statement, which is enough to see
      // a call in it.
      const semi = src.indexOf(';', arrowAt);
      body = src.slice(arrowAt + 2, semi < 0 ? src.length : semi);
    }
    out.push({ name: m[1], params: params.text, body });
  }
  return out;
}

/** Parameter names, and which of them are declared `Date`. */
function paramsOf(text) {
  const names = [];
  const dates = new Set();
  for (const p of splitArgs(text)) {
    const m = /^([A-Za-z_$][\w$]*)\s*(\?)?\s*(?::([^=]*))?/.exec(p.trim());
    if (!m) continue;
    names.push(m[1]);
    if (m[3] && /\bDate\b/.test(m[3])) dates.add(m[1]);
  }
  return { names, dates };
}

/** Comments stripped — the prose in this repo quotes every pattern below. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n')
    .map((l) => (/^\s*(\/\/|\*)/.test(l.trim()) ? '' : l.replace(/\/\/.*$/, '')))
    .join('\n');
}

/**
 * Does this body render a date on the reader's clock, in its own right?
 *
 *   · `.toLocaleDateString(` / `.toLocaleTimeString(` — Date-only methods, so
 *     no number case to spare.
 *   · `Intl.DateTimeFormat(` — the same thing said longhand.
 *   · `.toLocaleString(` ONLY when the receiver is a Date this body made or was
 *     handed. `n.toLocaleString()` on a number is the correct answer and is not
 *     matched.
 *
 * A body that names `timeZone` anywhere is exempt: it has been told which clock
 * to draw on, which is the whole of the fix. That is deliberately generous —
 * a false NEGATIVE here costs a missed import, a false POSITIVE costs a gate
 * somebody suppresses.
 */
function rendersLocally(body, dateNames) {
  if (/\btimeZone\b/.test(body)) return null;
  if (DATE_METHOD.test(body)) return 'toLocale(Date|Time)String';
  if (/\bIntl\.DateTimeFormat\s*\(/.test(body)) return 'Intl.DateTimeFormat';
  for (const n of dateNames) {
    if (new RegExp(`\\b${n}\\s*\\.toLocaleString\\s*\\(`).test(body)) return `${n}.toLocaleString`;
  }
  if (DATE_TO_STRING.test(body)) return 'Date(…).toLocaleString';
  return null;
}

/**
 * Does this function take an INSTANT — a moment in time, whose calendar day
 * and wall clock depend on which zone you read it in?
 *
 *   · a parameter declared `Date`;
 *   · `new Date(x)` with ONE argument — a millisecond count or an ISO string,
 *     both instants. `new Date(y, m, d)` with several is wall-clock components
 *     the caller already decided, which is why `fmtAxisDay(y, m, day)` and
 *     `fmtClock(h, m)` are not caught here and are correct as they stand;
 *   · `new Date()` — now, which is an instant like any other;
 *   · `localDate(x)` / `Date.parse(x)` — this repo's two other ways of turning
 *     a stored value into a moment.
 */
function takesInstant(body, params) {
  if (params.dates.size) return `a ${[...params.dates][0]}: Date parameter`;
  for (const m of body.matchAll(/new\s+Date\s*\(/g)) {
    const args = balanced(body, body.indexOf('(', m.index + m[0].length - 1));
    if (!args) continue;
    const parts = splitArgs(args.text);
    if (parts.length <= 1) return `new Date(${parts[0] ?? ''})`;
  }
  const other = /\b(localDate|Date\.parse)\s*\(/.exec(body);
  if (other) return `${other[1]}(…)`;
  return null;
}

/** Names this body calls. */
function callsIn(body) {
  const out = new Set();
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) out.add(m[1]);
  return out;
}

/** Names this body calls WITH one of its own parameters. */
function callsWithParam(body, paramNames) {
  const out = new Set();
  for (const m of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
    const args = balanced(body, body.indexOf('(', m.index + m[0].length - 1));
    if (!args) continue;
    if (paramNames.some((p) => new RegExp(`\\b${p}\\b`).test(args.text))) out.add(m[1]);
  }
  return out;
}

/* ── module resolution ─────────────────────────────────────────────────────
 *
 * The two aliases studio-web/tsconfig.json declares, plus relative paths.
 * Anything else is a package and is not this repo's problem.
 */
function resolveSpec(spec, fromFile) {
  let base = null;
  if (spec.startsWith('@lib/')) base = join(ROOT, 'src/lib', spec.slice(5));
  else if (spec.startsWith('@/')) base = join(ROOT, 'studio-web', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  if (!base) return null;
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return base + ext;
  }
  return existsSync(base) && statSync(base).isFile() ? base : null;
}

/** `import { a, b as c } from 'x'` → [{ local, imported, spec, line }]. */
function importsOf(src) {
  const out = [];
  const re = /import\s+([^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split('\n').length;
    const clause = m[1];
    const braced = /\{([\s\S]*?)\}/.exec(clause);
    if (braced) {
      for (const part of splitArgs(braced[1])) {
        const as = /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part.trim());
        if (as) out.push({ imported: as[1], local: as[2] ?? as[1], spec: m[2], line });
      }
    }
    const def = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause.replace(/\{[\s\S]*?\}/, ''));
    if (def) out.push({ imported: 'default', local: def[1], spec: m[2], line });
  }
  return out;
}

/* ── the function table ────────────────────────────────────────────────────
 *
 * Every function in every module the console can reach, keyed `file#name`.
 * Classification runs to a fixpoint because the answer is transitive: `fmtTime`
 * does not itself call `toLocale*`, it calls `fmtClock`, which does.
 */
const modules = new Map();   // file → { src, fns: Map<name, fn>, imports }
const libFiles = [];
for (const root of LIB_ROOTS) libFiles.push(...walk(join(ROOT, root)));

for (const file of new Set(libFiles)) {
  const raw = readFileSync(file, 'utf8');
  const src = code(raw);
  const fns = new Map();
  for (const f of functionsIn(src)) {
    const params = paramsOf(f.params);
    const dateNames = new Set([...params.dates]);
    // Locals assigned a Date, so `d.toLocaleString()` can be told from
    // `n.toLocaleString()`.
    for (const m of f.body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:new\s+Date|localDate)\s*\(/g)) {
      dateNames.add(m[1]);
    }
    fns.set(f.name, {
      file, name: f.name, body: f.body,
      paramNames: params.names,
      renders: rendersLocally(f.body, dateNames),
      instant: takesInstant(f.body, params),
      calls: callsIn(f.body),
      callsWithParam: callsWithParam(f.body, params.names),
      rendersReader: false, rcif: false, via: null,
    });
  }
  modules.set(file, { src, fns, imports: importsOf(src) });
}

/** Where a name used inside `file` is defined — locally, or across one import. */
function defOf(file, name) {
  const mod = modules.get(file);
  if (!mod) return null;
  if (mod.fns.has(name)) return mod.fns.get(name);
  const imp = mod.imports.find((i) => i.local === name);
  if (!imp) return null;
  const target = resolveSpec(imp.spec, file);
  if (!target || !modules.has(target)) return null;
  return modules.get(target).fns.get(imp.imported) ?? null;
}

// Fixpoint 1: renders on the reader's clock, directly or through a callee.
for (const mod of modules.values()) {
  for (const fn of mod.fns.values()) if (fn.renders) { fn.rendersReader = true; fn.via = fn.renders; }
}
for (let pass = 0; pass < 8; pass++) {
  let changed = false;
  for (const mod of modules.values()) {
    for (const fn of mod.fns.values()) {
      if (fn.rendersReader) continue;
      for (const c of fn.calls) {
        const d = defOf(fn.file, c);
        if (d?.rendersReader) { fn.rendersReader = true; fn.via = `${c} → ${d.via}`; changed = true; break; }
      }
    }
  }
  if (!changed) break;
}

// Fixpoint 2: turns an instant into that text.
for (const mod of modules.values()) {
  for (const fn of mod.fns.values()) {
    if (fn.rendersReader && fn.instant) { fn.rcif = true; fn.why = `${fn.instant}, then ${fn.via}`; }
  }
}
for (let pass = 0; pass < 8; pass++) {
  let changed = false;
  for (const mod of modules.values()) {
    for (const fn of mod.fns.values()) {
      if (fn.rcif) continue;
      for (const c of fn.callsWithParam) {
        const d = defOf(fn.file, c);
        if (d?.rcif) { fn.rcif = true; fn.why = `passes a parameter to ${c}, which ${d.why}`; changed = true; break; }
      }
    }
  }
  if (!changed) break;
}

/* ── the marker, for rule 3 ───────────────────────────────────────────────
 *
 * An unbroken comment RUN directly above, not a window of N lines, so an
 * annotation written for one statement can never drift down and quietly excuse
 * the next one. Same shape as `utc-day-ok:` in scripts/check-utc-day.mjs.
 */
const MARKER = 'reader-day-ok:';
function markedAbove(lines, index) {
  if (lines[index]?.includes(MARKER)) return true;
  for (let i = index - 1; i >= 0; i--) {
    const l = lines[i];
    if (!/\S/.test(l)) continue;
    if (!/^\s*(\/\/|\*|\/\*)/.test(l)) return false;
    if (l.includes(MARKER)) return true;
  }
  return false;
}

const findings = [];
const standing = new Set();
let importsChecked = 0;

for (const file of consoleFiles) {
  const rel = relative(ROOT, file);
  const raw = readFileSync(file, 'utf8');
  const lines = raw.split('\n');

  // ── 1. the lines themselves ──────────────────────────────────────────────
  lines.forEach((line, i) => {
    const c = line.trim();
    if (c.startsWith('//') || c.startsWith('*') || c.startsWith('/*')) return;
    const at = { rel, line: i + 1, text: c.slice(0, 120) };
    if (DATE_METHOD.test(line)) {
      findings.push({ ...at, why: 'a date drawn on the READER’s clock, not the gym’s' });
    } else if (DATE_TO_STRING.test(line)) {
      findings.push({ ...at, why: 'a Date drawn on the READER’s clock, not the gym’s' });
    } else if (UTC_STAMP.test(line) && !/UTC/.test(line)) {
      findings.push({ ...at, why: 'a raw UTC stamp — nobody’s locale and nobody’s clock' });
    }
  });

  // ── 2. the imports ───────────────────────────────────────────────────────
  for (const imp of importsOf(code(raw))) {
    const target = resolveSpec(imp.spec, file);
    if (!target || !modules.has(target)) continue;
    importsChecked++;
    const fn = modules.get(target).fns.get(imp.imported);
    if (!fn?.rcif) continue;
    const key = `${rel} ${imp.imported}`;
    if (KNOWN_IMPORTS.has(key)) { standing.add(key); continue; }
    findings.push({
      rel, line: imp.line,
      text: `import { ${imp.imported} } from '${imp.spec}'`,
      why: `${relative(ROOT, target)} → ${imp.imported}() ${fn.why} — a date drawn on the READER’s clock, `
        + 'one module away from this line',
    });
  }

  // ── 3. the console's today ───────────────────────────────────────────────
  lines.forEach((line, i) => {
    const c = line.trim();
    if (c.startsWith('//') || c.startsWith('*') || c.startsWith('/*')) return;
    if (!/isoDate\s*\(\s*new Date\s*\(\s*\)\s*\)/.test(line)) return;
    if (/gymDay\s*\(/.test(line) || markedAbove(lines, i)) return;
    findings.push({
      rel, line: i + 1, text: c.slice(0, 120),
      why: 'today taken from isoDate(new Date()) — the calendar day on whichever machine has the '
        + `tab open. Write \`gymDay(Date.now(), zone) ?? isoDate(new Date())\`, or say \`${MARKER}\` `
        + 'above it with the reason the reader’s own day is right here',
    });
  });
}

// ── 4. and the fixed screens stay fixed ─────────────────────────────────────
//
// Named explicitly, in addition to the sweep above, because these are the six
// routes the sweep of 3 September actually moved, and a regression on one is
// worth failing with the screen's name rather than with a rule. Two of them are
// not covered by rule 3 at all: `/close` built its whole month without passing
// `CloseOptions.today` and `/export` handed its period presets an instant
// instead of a day. Neither is an `isoDate(new Date())`; both are a gym day
// that was never asked for.
for (const route of ['coach', 'accounting', 'compliance', 'equipment', 'close', 'export']) {
  const file = join(ROOT, 'studio-web/app', route, 'page.tsx');
  if (!existsSync(file)) continue;
  if (readFileSync(file, 'utf8').includes('gymDay(')) continue;
  findings.push({
    rel: `studio-web/app/${route}/page.tsx`, line: 1, text: `(no gymDay( anywhere in the file)`,
    why: 'this screen no longer asks gymDay() for the gym’s day — every date comparison on it is '
      + 'back on the reader’s calendar',
  });
}

if (WHY) {
  const rcif = [];
  for (const mod of modules.values()) for (const fn of mod.fns.values()) if (fn.rcif) rcif.push(fn);
  console.log(`${rcif.length} reader’s-clock instant formatter${rcif.length === 1 ? '' : 's'} in reach of the console:`);
  for (const fn of rcif.sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name))) {
    console.log(`  ${relative(ROOT, fn.file)} → ${fn.name}(): ${fn.why}`);
  }
  console.log('');
}

// A KNOWN_IMPORTS entry whose import is gone. Reported so the backlog comes
// DOWN with the work rather than sitting there as a licence.
const stale = [...KNOWN_IMPORTS.keys()].filter((k) => !standing.has(k));
if (!findings.length && stale.length) {
  console.error('KNOWN_IMPORTS is out of date — the ratchet only counts down if somebody turns it:\n');
  for (const k of stale) console.error(`  ${k} — no longer imported, or no longer a reader’s-clock formatter.`);
  console.error('\nDelete the entry from scripts/check-console-when.mjs.\n');
  process.exit(1);
}

if (findings.length) {
  console.error('The console answers "whose format" more than one way:\n');
  for (const f of findings) {
    console.error(`${f.rel}:${f.line}  ${f.why}`);
    console.error(`  ${f.text}`);
  }
  console.error(`\n${findings.length} problem${findings.length === 1 ? '' : 's'}.`);
  console.error(HELP);
  process.exit(1);
}

console.log(`check:console-when — ok, ${consoleFiles.length} console files, `
  + `${importsChecked} imports followed into the module they name`
  + `${standing.size ? `, ${standing.size} on the ratchet` : ''}: no new date drawn on the reader’s clock.`);
if (standing.size) {
  console.log('Standing offences (ratcheted, they may not grow):');
  for (const k of standing) console.log(`  ${k} — ${KNOWN_IMPORTS.get(k).fix}`);
}
