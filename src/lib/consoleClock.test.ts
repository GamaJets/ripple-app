// The console's clock, checked where the gate cannot see.
//
// ── the blind spot this closes ────────────────────────────────────────────
//
// `scripts/check-console-when.mjs` states the rule the whole console is built
// on — "A number is written in the READER's locale. A date is written in the
// READER's locale and the GYM's zone" — and ends by printing "ok, every date in
// the console is drawn on the gym's clock."
//
// That claim was not true, and the gate is honest about why. Its own header
// lists what it cannot see, and the first item is the one that bit:
//
//     A formatter built in a variable, a date formatted by something other
//     than Intl, and a call split so that `Date(` and `.toLocaleString(` land
//     on different lines.
//
// There is a fourth, unlisted: a call that is not in `studio-web` at all. The
// gate walks `studio-web/app`, `studio-web/components` and `studio-web/lib`,
// and greps for `.toLocaleDateString(` / `.toLocaleTimeString(`. Those two
// calls were happening one directory over, inside `fmtDay` and `fmtTime` in
// `src/lib/format.ts`, reached from the console by name. `grep` over
// `studio-web` found nothing; the console drew a whole route on the reader's
// machine; the gate said ok.
//
// The route was `studio-web/app/coach/page.tsx` — the screen a coach opens at
// six in the morning to see what is on TODAY and which finished sessions still
// need marking. A gym in Dubai read from a laptop still set to London filed
// every session before 04:00 under the previous day: the 06:00 client was not
// under Today at all, and the "Waiting 2 days" on the queue that blocks the
// coach's own pay was a day out.
//
// ── why this is a test and not a line in that gate ────────────────────────
//
// Because the check belongs to the same suite as `consoleRoutes.test.ts`, which
// already reads console source for the four invariants that make the console
// honest, and because a rule about which MODULE a console file may import is a
// rule about the console's shape rather than about a text pattern in it. Both
// run on every `npm test`, under six timezones, which is the harness this
// particular class of bug deserves.
//
// ── the two rules ─────────────────────────────────────────────────────────
//
//   1. No file under `studio-web` may import a date formatter that renders on
//      the READER's clock. `src/lib/gymWhen.ts` is the console's only answer:
//      `gymDateText`, `gymDateTimeText`, `gymTimeText` for an instant, and
//      `calendarDateText` for a `YYYY-MM-DD` that is already a day.
//
//      Only the four that take an INSTANT are forbidden. `fmtClock(h, m)`,
//      `weekdayName(dow)`, `monthNames()` and the four `fmtAxis*`/`fmtPoint*`
//      helpers take numbers a caller has already decided, carry no clock of
//      their own, and are the reader's-locale half of the rule, which is
//      correct. `isoDate(d)` is likewise a formatter over a Date the caller
//      chose, and is rule 2's business rather than rule 1's.
//
//   2. `isoDate(new Date())` is the READER's calendar day, and the console's
//      "today" is the GYM's. Every occurrence must therefore be the fallback
//      arm of `gymDay(...) ?? isoDate(new Date())` — which is what the console
//      does at a gym that has set no timezone, and is the only honest answer
//      there — or carry a `reader-day-ok:` marker saying why the reader's day
//      is the right one on that line.
//
//      This is the half `scripts/check-utc-day.mjs` cannot cover: that gate is
//      about UTC's day, and `isoDate(new Date())` is not UTC's, it is the
//      laptop's. The two are different wrong answers to the same question.
//
// Compile with tsc then run with node, like consoleRoutes.test.ts.
export {};

/**
 * The filesystem, reached through a locally-declared `require` rather than an
 * `import` — for the reason consoleRoutes.test.ts sets out at length: two
 * TypeScript configurations compile this file and only one of them has node
 * types, and adding them to the root config would change the typing surface of
 * the whole React Native app to fix one test.
 */
declare const require: (id: string) => any;

const { readdirSync, readFileSync, existsSync, statSync } = require('node:fs') as {
  readdirSync: (p: string) => string[];
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
  statSync: (p: string) => { isDirectory: () => boolean };
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const CONSOLE = 'studio-web';
const ROOTS = [join(CONSOLE, 'app'), join(CONSOLE, 'components'), join(CONSOLE, 'lib')];

if (!existsSync(ROOTS[0])) {
  // Run from somewhere that is not the repository root. Loud rather than a
  // suite that silently asserts nothing and prints "ok".
  console.error('consoleClock.test.ts — studio-web/app not found; run from the repository root.');
  process.exit(1);
}

/** Every `.ts`/`.tsx` under a console root. Walked rather than listed: a
 *  hardcoded list is a list that stops covering the file added after it. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files: string[] = [];
for (const root of ROOTS) if (existsSync(root)) sources(root, files);
files.sort();

ok(files.length >= 40, `the console has at least forty source files (found ${files.length})`);

/* ── rule 1: no reader's-clock formatter in the console ────────────────────
 *
 * Matched on the IMPORT rather than on the call, because the import is the one
 * line that must exist for any number of calls, is unambiguous about which
 * module the name came from, and names the file the fix belongs in.
 */

/** The four `src/lib/format.ts` helpers that take an instant and render it on
 *  whatever clock the reader's machine is set to. */
const READER_CLOCK = ['fmtDay', 'fmtRelativeDay', 'fmtFullDay', 'fmtTime'];

const FIX = 'use gymDateText / gymDateTimeText / gymTimeText from src/lib/gymWhen.ts '
  + '(the reader’s locale, the GYM’s zone), or calendarDateText for a YYYY-MM-DD '
  + 'that is already a calendar day';

/** The lines of an import statement that names `@lib/format`, joined — an
 *  import list wraps over several lines in this codebase and a per-line grep
 *  would miss the wrapped half. */
function formatImports(src: string): string {
  const out: string[] = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*import\s*\{/.test(lines[i])) continue;
    let block = lines[i];
    for (let j = i + 1; j < lines.length && !block.includes('from'); j++) block += `\n${lines[j]}`;
    if (/from\s+['"](@lib\/format|@\/lib\/format|.*\/format)['"]/.test(block)) out.push(block);
  }
  return out.join('\n');
}

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const imports = formatImports(src);
  if (!imports) continue;
  for (const name of READER_CLOCK) {
    // Word-bounded, so `fmtDay` does not match `fmtDayLabel` if one is ever
    // added, and so the word inside a comment in the same block is not a hit —
    // the block is only the import statement, which carries no prose.
    ok(!new RegExp(`\\b${name}\\b`).test(imports),
      `${file} imports ${name} from src/lib/format.ts — that draws a date on the READER's clock, `
      + `not the gym's, and scripts/check-console-when.mjs cannot see it because the `
      + `toLocale* call is one directory away. To fix: ${FIX}.`);
  }
}

/* ── rule 2: the console's "today" is the gym's ─────────────────────────── */

/** Said on a line, or in the unbroken comment run directly above it, to declare
 *  that the READER's calendar day is deliberately the right answer there. Same
 *  shape as `utc-day-ok:` and `no-error-ok:`. */
const MARKER = 'reader-day-ok:';

/**
 * Whether the line, or the unbroken comment run directly above it, carries the
 * marker.
 *
 * Lifted from `markedAbove` in scripts/check-utc-day.mjs, including its reason:
 * an unbroken RUN and not a fixed window of N lines, so an annotation written
 * for one statement can never drift down and quietly excuse the next one. A
 * marker belongs to the thing directly beneath it, and a line of real code in
 * between means it belongs to something else.
 */
function markedAbove(lines: string[], index: number): boolean {
  if (lines[index]?.includes(MARKER)) return true;
  for (let i = index - 1; i >= 0; i--) {
    const l = lines[i];
    if (!/\S/.test(l)) continue;
    if (!/^\s*(\/\/|\*|\/\*)/.test(l)) return false;
    if (l.includes(MARKER)) return true;
  }
  return false;
}

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.trim();
    // Prose about the rule — including the paragraphs the console's own files
    // carry, which quote the expression this forbids.
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
    if (!/isoDate\s*\(\s*new Date\s*\(\s*\)\s*\)/.test(line)) return;
    ok(/gymDay\s*\(/.test(line) || markedAbove(lines, i),
      `${file}:${i + 1} takes today from isoDate(new Date()), which is the calendar day on `
      + `whichever machine has the tab open. The console's today is the GYM's: write `
      + `\`gymDay(Date.now(), zone) ?? isoDate(new Date())\`, or say \`${MARKER}\` on the line `
      + `with the reason the reader's own day is right here.\n    ${code.slice(0, 120)}`);
  });
}

/* ── and the fixed screens stay fixed ──────────────────────────────────────
 *
 * Named explicitly, in addition to the sweeping rules above, because these are
 * the screens the sweep of 3 September actually moved and a regression on one
 * of them is the thing worth naming in a failure message. Cheap, and it fails
 * with the screen's name rather than with a rule.
 *
 * Two of them are not covered by rule 2 at all, because what was wrong there
 * was not an `isoDate(new Date())` — it was a gym day that was never asked for:
 * `/close` built its whole month without passing `CloseOptions.today`, and
 * `/export` handed its period presets an instant instead of a day. Both now
 * call `gymDay`, and that call is the thing worth holding.
 */
for (const route of ['coach', 'accounting', 'compliance', 'equipment', 'close', 'export']) {
  const file = join(CONSOLE, 'app', route, 'page.tsx');
  if (!existsSync(file)) continue;
  const src = readFileSync(file, 'utf8');
  ok(src.includes('gymDay('),
    `studio-web/app/${route}/page.tsx no longer asks gymDay() for the gym's day — `
    + `every date comparison on that screen is back on the reader's calendar`);
}

if (errors.length) {
  console.error(`consoleClock.test.ts — ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
  for (const e of errors) console.error(`  · ${e}`);
  process.exit(1);
}

console.log(`consoleClock.test.ts — ok, ${files.length} console files draw their dates on the gym's clock.`);
