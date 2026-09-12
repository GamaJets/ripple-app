#!/usr/bin/env node
// A feature that does something must be called by something.
//
// ── what went wrong ────────────────────────────────────────────────────────
//
// Twice in one day a feature was built, tested, reviewed and shipped, and did
// nothing, because no screen ever called it.
//
//   1. src/lib/calendarSync.ts grew the whole class-sync implementation —
//      `SyncTeaching`, `syncClassEventId` namespaced so a class cannot
//      overwrite a one-to-one, the cancelled-class filter, the not-mine
//      filter — every one of them asserted in calendarSync.test.ts. Both call
//      sites in the coach's own calendar screen passed it nothing. A coach's
//      exported Google calendar showed her one-to-ones and left every hour she
//      was teaching looking free.
//   2. `syncClassesNote` was exported, tested, and rendered by no screen.
//
// Earlier waves found the same shape over and over: `matchPayment` and
// `settleInvoice` imported and never called, `fetchMemberRecords` existing and
// unused, a `refresh` nothing invoked. Every one of them passed the type
// checker, every test, and all 24 gates — because none of those things asks
// whether anybody uses the answer.
//
// tsc will not help here on purpose. `noUnusedLocals` stops at the module
// boundary: the moment a symbol is exported it is, as far as the compiler is
// concerned, part of the public surface and used by definition. A test file
// importing it makes that literally true. So the one signal that says "nobody
// wired this up" is exactly the signal the toolchain is built to ignore.
//
// ── the rule ───────────────────────────────────────────────────────────────
//
// An export from src/lib/** or src/ui/** that DOES SOMETHING and that no
// non-test file imports is a feature that does not happen.
//
// "Does something" is the narrowing, and it is the whole reason this check is
// usable. Three shapes count:
//
//   · an ASYNC FUNCTION, or one whose signature says `: Promise<`. It reaches
//     outside the process — a database read or write, a storage object, a
//     device permission. `exportMyData`, `acceptInvite`, `undoRedemption`.
//   · a REACT COMPONENT: a PascalCase export in a .tsx file under src/ui.
//     Its entire purpose is to be rendered by a screen.
//   · a HOOK: any export named `use[A-Z]…`. Same argument.
//
// Each of those is a feature. When nothing imports it, the write never
// happens, the screen never draws, the data never loads — and everything is
// green.
//
// ── what it deliberately does NOT flag, and why each one ───────────────────
//
//  1. PURE HELPERS AND CONSTANTS. This is the big one and it is deliberate.
//     There are roughly four hundred exported pure functions and constants in
//     src/lib whose only importer is their own .test.ts — `luminance` in
//     a11y.ts, `dayOf` in adherence.ts, `MAX_BLOCK_DAYS` in blockRange.ts. A
//     module exporting its internals so its test can reach them is an
//     established, harmless pattern here, and flagging four hundred of them
//     would make this check the first thing anybody deletes. A dead pure
//     function is dead weight; a dead async function is a feature that silently
//     does not run. Only the second one is the defect this exists for.
//
//     The honest cost: `syncClassesNote` — defect 2 above — is a pure function,
//     and this check as written would not have caught it. It is caught by
//     nothing else either. That is the price of the check being one somebody
//     will keep switched on, and it is written down here rather than implied.
//
//  2. TYPES AND INTERFACES. `export type` / `export interface`. A type that
//     is only ever a type is legitimate and costs nothing at run time, and
//     `SyncTeaching` — a type — was not the bug; the argument that was never
//     passed to it was.
//
//  3. ANYTHING A NON-TEST FILE IMPORTS, from anywhere. app/**, src/**,
//     scripts/**, studio-web/** and supabase/functions/** are all read as
//     consumers, with their own module resolution:
//       · studio-web uses `@lib/*` → src/lib/* (its tsconfig paths), which is
//         how the console reaches gymClose, gymTax, staffRoles, ownedSites and
//         tablePage. Missing that alias makes twenty live modules look dead,
//         which is the false-positive that would have sunk this check.
//       · supabase/functions and scripts/*.mjs import with an explicit `.ts`
//         extension (`'../../../src/lib/adMatch.ts'`), so the extension is
//         stripped before resolving.
//
//  4. A SYMBOL WHOSE MODULE IS NAMESPACE-IMPORTED OR require()d. `import * as
//     apple from './appleHealth'` (src/lib/wearables/glucoseSource.ts) uses
//     members this scan cannot name, and neither can it name the member picked
//     off a `require('./supabase')` — three modules do that to break an import
//     cycle lazily. Either one exempts the whole module.
//
//     That has a cost worth stating: `signUp` in src/lib/supabase.ts is a
//     second, unused sign-up path (app/welcome.tsx signs up through
//     src/ui/auth.tsx, which owns the confirmation-email and session handling),
//     and it is invisible here because three other modules require() the file
//     it lives in. A missed hit, chosen over a wrong one.
//
//  5. A SYMBOL RE-EXPORTED THROUGH A BARREL. `export { x } from './y'` and
//     `export * from './y'` both count as uses of what they forward — the
//     first by name, the second for the whole module.
//
//  6. A DEFAULT EXPORT. `export default Foo` is imported under whatever name
//     the importer picks, which this cannot match, so any name appearing in an
//     `export default` in its own file is skipped.
//
//  7. A SYMBOL REFERENCED ANYWHERE INSIDE ITS OWN MODULE. If `LockScreen` is
//     rendered by `LockGate` in the same file and `LockGate` is imported, the
//     feature happens; only the `export` keyword is redundant, and a redundant
//     export is not what this is for. So a candidate must appear EXACTLY ONCE
//     in its own file — its declaration — with comments stripped first.
//
//  8. A SCREEN REGISTERED BY ROUTE. app/** is a consumer root and never a
//     producer root, so an expo-router screen is never a candidate here.
//     scripts/check-reachable.mjs is the check that asks whether a screen can
//     be got to; this one asks whether a module can be got to.
//
//  9. A NAME THIS COULD NOT RESOLVE. If any non-test file imports a symbol of
//     the same name from a specifier that does not resolve to a file on disk,
//     that name is treated as used everywhere. It is a deliberate belt-and-
//     braces: a resolver bug should cost a missed hit, never a false one.
//
// ── the escape hatch, and why it takes a sentence ──────────────────────────
//
// Mark the declaration, or the comment immediately above it:
//
//     // unused-ok: the console calls this over HTTP, not by importing it
//
// The reason is the point of the marker, exactly as with `currency-ok:` in
// check-currency.mjs and `no-error-ok:` in check-reads.mjs. "Nothing calls
// this" is a claim about the whole product, and the sentence is what a
// reviewer reads when deciding whether that is fine.
//
// ── one house rule about the prose in here ────────────────────────────────
//
// Name screens in words — "the coach's Sessions screen" — and never as
// `app/(group)/name.tsx`. scripts/check-reachable.mjs greps every live line for
// the `(group)/name` shape and asks whether that route exists; it strips
// comments, so a header may say it, and the KNOWN strings below are code. A
// baseline entry describing a screen by its path therefore reads to that gate
// as a link to a screen — and named one that does not exist, which failed
// check:all on a sentence rather than on a bug.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = process.cwd();

/** Where a feature is BUILT. */
const PRODUCER_ROOTS = ['src/lib', 'src/ui'];

/** Everywhere a feature could be CALLED FROM. The three phone apps, the shared
 *  code itself, the web console, the edge functions and the build scripts —
 *  all five, because leaving one out invents dead code that is not dead. */
const CONSUMER_ROOTS = ['app', 'src', 'scripts', 'studio-web', 'supabase/functions'];

/**
 * Offenders that are real, are NOT silenced, and were not fixed in the change
 * that added this check — each with a COUNT and the edit it needs.
 *
 * ── this is a ratchet, not an ignore list ─────────────────────────────────
 *
 * Same mechanism, and the same argument, as KNOWN in check-currency.mjs. The
 * count is the point: a file listed at 5 fails the build at 6, so the backlog
 * can shrink and can never grow — somebody adding a sixth unwired feature to a
 * listed file gets the same red build as somebody adding a first one to a clean
 * file. A count that has DROPPED fails too, asking for the number to come down
 * with the work, because a list that over-states what is wrong is how a ratchet
 * turns into an ignore list one stale line at a time.
 *
 * Every entry is open work with a named fix. The per-symbol `unused-ok:`
 * marker is the other mechanism and means the opposite: that export is
 * CORRECT as it stands and will stay.
 */
const KNOWN = new Map([
  // ── the phone app's own unwired features ────────────────────────────────
  ['src/lib/classAttendance.ts', { count: 1, fix: 'setAttendance writes class_attendance and no screen calls it; the coach-side register reads through src/lib/classRegister.ts instead. Either the register saves through this or it goes.' }],
  ['src/lib/connect.ts', { count: 1, fix: 'packageCurrencies reads which currencies a coach has priced packages in. Nothing asks. It is the check a coach\'s Connect payout screen needs before offering a currency.' }],
  ['src/lib/endCoaching.ts', { count: 1, fix: 'fetchEndRecord loads the permanent record of an ended coaching relationship. The end-coaching flow writes it and no screen reads it back.' }],
  ['src/lib/spotify.ts', { count: 1, fix: 'spotifyPlaylistTracks — the track list of a playlist the member already owns. The screen builds its own list from a search; nothing reads back what is in a saved playlist. (spotifyDevices and spotifyTransfer came off this list when app/(client)/music.tsx grew the device picker.)' }],
  ['src/lib/trainerSessions.ts', { count: 1, fix: 'markMyOutcome records a coach\'s own outcome for a session. The coach Sessions screen is where it belongs; that file is another lane\'s today.' }],

  // ── the console and the shared UI kit ───────────────────────────────────
  ['src/ui/ExerciseVideo.tsx', { count: 1, fix: 'ExerciseVideoBlock. The screens render ExerciseVideo directly; this is the block wrapper nobody adopted. Adopt it or delete it.' }],
  ['src/ui/ZoneBoard.tsx', { count: 1, fix: 'ZoneStrip — the compact HR-zone strip beside ZoneBoard, which IS rendered. Nothing renders the strip.' }],
  ['src/ui/charts.tsx', { count: 2, fix: 'Sparkline and DeltaBadge. HrZoneChart and src/lib/chartAxis.ts are what the screens actually draw with.' }],
  ['src/ui/fetched.tsx', { count: 1, fix: 'useFetchedAt — the "last updated" timestamp hook. Screens print freshness through src/lib/freshness.ts instead.' }],
  ['src/ui/joinCode.ts', { count: 1, fix: 'fetchJoinCodeStats — how many times a join code has been used. The coach Join Code screen is where it belongs; that file is another lane\'s today.' }],
  ['src/ui/seriesPause.ts', { count: 1, fix: 'pauseSeries — the pause-a-DATE-RANGE call (pause_my_session_series, from/to). Pausing itself is wired: app/(client)/standing.tsx:279 pauses through pauseSeriesForDays. Nothing offers the member a range, so the from/to entry point is unreachable. Give the sheet a range or delete this one.' }],
  ['src/ui/useMrrHistory.ts', { count: 1, fix: 'useMrrHistory. The three screens in that module\'s import list take useMonthlyHistory and useSessionsHistory from it; the MRR hook itself is drawn by nothing.' }],
]);

/** A test file. Its imports never count as a use — that is the entire point:
 *  a feature whose only caller is the assertion that it works is a feature
 *  nobody wired. */
const isTest = (f) => /\.test\.[jt]sx?$/.test(f) || f.includes('__tests__');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git' || e === '.expo' || e === '.next' || e === '.tmp') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

/** Source with comments removed, character by character, tracking block state.
 *  Lifted from check-reachable.mjs, and it has the same known hole: a `/*` or
 *  `//` inside a string literal cuts the rest of the line. An import statement
 *  and an export declaration are both one line with no such string in them, so
 *  the hole costs nothing here — and stripping matters, because this repo
 *  argues its decisions in prose and names its own dead functions while doing
 *  it. A symbol mentioned only in a comment must not count as a use. */
function code(src) {
  let block = false;
  return src.split('\n').map((line) => {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      if (block) {
        if (line[i] === '*' && line[i + 1] === '/') { block = false; i++; }
        continue;
      }
      if (line[i] === '/' && line[i + 1] === '*') { block = true; i++; continue; }
      if (line[i] === '/' && line[i + 1] === '/') break;
      out += line[i];
    }
    return out;
  }).join('\n');
}

/**
 * A module specifier, resolved to a repo-relative file, or:
 *   null        — a package (react, expo-router, @supabase/…). Not our problem.
 *   'UNRESOLVED'— looks local and is not on disk. Names imported through one of
 *                 these get a blanket amnesty; see rule 9 in the header.
 *
 * The alias table is the union of the two tsconfigs, and they disagree:
 * root maps `@/*` → ./src/*, studio-web maps `@/*` → ./* (its own root) and
 * `@lib/*` → ../src/lib/*. `@lib/` is the one in real use (185 imports);
 * `@/` is honoured only outside studio-web so the disagreement cannot bite.
 */
function resolveSpec(fromFile, spec) {
  let base;
  if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else if (spec.startsWith('@lib/')) base = resolve(ROOT, 'src/lib', spec.slice(5));
  else if (spec.startsWith('@/') && !fromFile.includes('studio-web')) base = resolve(ROOT, 'src', spec.slice(2));
  else return null;
  // supabase/functions and scripts/*.mjs import with the extension on, because
  // Deno and node need it. tsc's own resolution strips it; so does this.
  base = base.replace(/\.(tsx?|jsx?|mjs)$/, '');
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx']) {
    if (existsSync(base + ext)) return relative(ROOT, base + ext).split('\\').join('/');
  }
  return 'UNRESOLVED';
}

const producers = PRODUCER_ROOTS.flatMap((r) => walk(r)).filter((f) => /\.tsx?$/.test(f) && !isTest(f));
const consumers = CONSUMER_ROOTS.flatMap((r) => walk(r));

// A check that inspects no files passes every time. check-reads.mjs shipped
// once having read nothing and reported success; the same guard, twice, because
// either half going empty turns this into a rubber stamp — an empty producer
// set finds nothing, and an empty consumer set finds EVERYTHING.
if (!producers.length) {
  console.error('found no modules in src/lib or src/ui to check, which is not a pass.');
  process.exit(1);
}
if (!consumers.length) {
  console.error('found no files that could call them, which is not a pass — it would flag every export in the tree.');
  process.exit(1);
}

/** `unused-ok:` on this line, or anywhere in the contiguous run of comment and
 *  blank lines immediately above it. The whole run, not a fixed window, for the
 *  reason check-currency.mjs gives at length: the thing being excused sits under
 *  one explanation, and a fixed window teaches people to paste the marker
 *  rather than write the reason. */
function excused(lines, i) {
  if (/unused-ok:\s*\S/.test(lines[i])) return true;
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim();
    const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.endsWith('*/');
    if (!isComment && t !== '') break;
    if (/unused-ok:\s*\S/.test(lines[j])) return true;
  }
  return false;
}

/**
 * The exports of one producer file that could be a FEATURE.
 *
 * `: Promise<` is looked for in the RETURN POSITION — after the argument list
 * closes — because a signature that wraps reads
 *     export function foo(
 *       a: string,
 *     ): Promise<Bar> {
 * and the `async` keyword is not always there to give it away. The argument
 * list is walked by paren depth rather than by a fixed window of lines: a
 * window found `let running: Promise<number> | null = null` two lines under
 * `export const flusherCount = (): number => flushers.size` and called a
 * one-line accessor an async feature, which is precisely the false positive
 * that gets a check switched off.
 */
/**
 * Everything after the declaration's argument list closes, up to the end of
 * that line — the return annotation and nothing else. '' when the declaration
 * has no argument list within thirty lines, which is what a plain constant
 * looks like.
 */
function returnPosition(lines, i) {
  let depth = 0;
  let started = false;
  for (let j = i; j < Math.min(i + 30, lines.length); j++) {
    const line = lines[j];
    for (let k = (j === i ? line.indexOf('(') : 0); k >= 0 && k < line.length; k++) {
      const c = line[k];
      if (c === '(') { depth++; started = true; }
      else if (c === ')') {
        depth--;
        if (started && depth === 0) return line.slice(k + 1);
      }
    }
    if (!started) return '';
  }
  return '';
}

function candidates(file, raw) {
  const rel = relative(ROOT, file).split('\\').join('/');
  const stripped = code(raw).split('\n');
  const rawLines = raw.split('\n');
  const isTsx = rel.endsWith('.tsx');
  const inUi = rel.startsWith('src/ui/');

  // Names given away by `export default X` — imported under a name of the
  // importer's choosing, which this cannot see. Rule 6.
  const defaulted = new Set(
    [...code(raw).matchAll(/export\s+default\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  );

  const out = [];
  stripped.forEach((line, i) => {
    const m = line.match(/^export\s+(?:declare\s+)?(async\s+)?(function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
    if (!m) return;
    const [, asyncKw, decl, name] = m;
    if (defaulted.has(name)) return;

    const promiseish = !!asyncKw
      || (decl === 'const' && /=\s*async\b/.test(line))
      || /:\s*Promise\s*</.test(returnPosition(stripped, i));

    // PascalCase, not SCREAMING_CASE: `Sparkline` is a component and `SAY_MS`
    // is a number. The second character decides it.
    const component = isTsx && inUi && /^[A-Z][a-z0-9]/.test(name) && decl !== 'let' && decl !== 'var';
    const hook = /^use[A-Z]/.test(name);
    if (!promiseish && !component && !hook) return;

    // Rule 7: referenced anywhere else in its own module means the feature
    // happens and only the `export` is redundant. Counted on the STRIPPED
    // source so a header naming the function is not a reference.
    const refs = (code(raw).match(new RegExp(`(?<![A-Za-z0-9_$.])${name}(?![A-Za-z0-9_$])`, 'g')) || []).length;
    if (refs > 1) return;

    if (excused(rawLines, i)) return;

    out.push({
      rel,
      name,
      line: i + 1,
      kind: promiseish ? 'an async function' : hook ? 'a hook' : 'a component',
    });
  });
  return out;
}

// ── who imports what ────────────────────────────────────────────────────────
const usedFrom = new Map();   // resolved file → Set of names a NON-TEST file imports
const testedFrom = new Map(); // the same, from test files, so the report can say so
const wholeModule = new Set();// namespace-imported or star-re-exported: rules 4 and 5
const amnesty = new Set();    // rule 9

const mark = (map, file, name) => {
  if (!map.has(file)) map.set(file, new Set());
  map.get(file).add(name);
};

for (const f of consumers) {
  const src = code(readFileSync(f, 'utf8'));
  const test = isTest(f);

  // `import { a, b as c } from '…'` and `export { a } from '…'`. The braces may
  // span lines, which is how most of this repo's imports are written.
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveSpec(f, m[2]);
    if (!target) continue;
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      // `type Foo`, `Foo`, `Foo as Bar` — the ORIGINAL name is what the
      // producer exported, so the alias is discarded.
      const mm = t.match(/^(?:type\s+)?([A-Za-z_$][\w$]*)/);
      if (!mm) continue;
      if (target === 'UNRESOLVED') { if (!test) amnesty.add(mm[1]); continue; }
      mark(test ? testedFrom : usedFrom, target, mm[1]);
    }
  }

  // `import * as x from '…'` / `export * from '…'` / `export * as x from '…'`.
  for (const m of src.matchAll(/(?:import|export)\s+\*\s+(?:as\s+[A-Za-z_$][\w$]*\s+)?from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveSpec(f, m[1]);
    if (target && target !== 'UNRESOLVED' && !test) wholeModule.add(target);
  }

  // `const { a } = require('…')`, which is how a couple of the .mjs scripts
  // reach shared code. Cheap to read and expensive to miss.
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const target = resolveSpec(f, m[1]);
    if (target && target !== 'UNRESOLVED' && !test) wholeModule.add(target);
  }
}

// ── the findings ────────────────────────────────────────────────────────────
const findings = [];
for (const file of producers) {
  const raw = readFileSync(file, 'utf8');
  for (const c of candidates(file, raw)) {
    if (wholeModule.has(c.rel)) continue;
    if ((usedFrom.get(c.rel) ?? new Set()).has(c.name)) continue;
    if (amnesty.has(c.name)) continue;
    c.tested = (testedFrom.get(c.rel) ?? new Set()).has(c.name);
    findings.push(c);
  }
}

// ── the ratchet ─────────────────────────────────────────────────────────────
const seen = new Map();
for (const f of findings) seen.set(f.rel, (seen.get(f.rel) ?? 0) + 1);

const fresh = [];
const shrunk = [];
const stale = [];

for (const f of findings) {
  const allowed = KNOWN.get(f.rel)?.count ?? 0;
  if (!allowed) { fresh.push(f); continue; }
  // The whole file is reported when it goes over, not the first N: which of a
  // file's five is "the new one" is not knowable from here.
  if (seen.get(f.rel) > allowed) fresh.push(f);
}
for (const [key, { count }] of KNOWN) {
  const n = seen.get(key) ?? 0;
  if (n === 0) stale.push(key);
  else if (n < count) shrunk.push([key, count, n]);
}

if (fresh.length || shrunk.length || stale.length) {
  if (fresh.length) {
    console.error(`${fresh.length} export${fresh.length === 1 ? '' : 's'} that nothing outside a test calls:\n`);
    for (const f of fresh) {
      console.error(`  ${f.rel}:${f.line}  ${f.name}`);
      console.error(`    ${f.kind}, exported from ${f.rel.startsWith('src/lib') ? 'src/lib' : 'src/ui'} and imported by no non-test file`
        + (f.tested ? ' — its own test suite is its only caller.' : '.'));
      console.error('    \u2192 Wire it to the screen it was written for, or delete it. If it is genuinely\n'
        + '      reached some other way, write `// unused-ok: <why>` above it.\n');
    }
    console.error('A feature nothing calls passes tsc, passes every test and does nothing. That is');
    console.error('the whole failure this check exists for — see the header.');
  }
  for (const [key, was, now] of shrunk) {
    console.error(`\nKNOWN['${key}'] in scripts/check-dead-exports.mjs says ${was}; there are ${now}.`);
    console.error('Some of them have been wired up or deleted. Lower the count so the list still describes the tree.');
  }
  for (const key of stale) {
    console.error(`\nstale exception: KNOWN['${key}'] in scripts/check-dead-exports.mjs matches nothing any more.`);
    console.error('Delete the entry — it was open work, and it looks like it has been done.');
  }
  process.exit(1);
}

const open = [...seen.values()].reduce((a, b) => a + b, 0);
console.log(
  `check:dead-exports — ok, ${producers.length} modules in src/lib and src/ui checked against `
  + `${consumers.length} possible callers; every async function, component and hook is reached by something`
  + (open ? `. ${open} listed offence${open === 1 ? '' : 's'} remain open in KNOWN and cannot grow.` : '.'),
);
