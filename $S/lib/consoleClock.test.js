"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { readdirSync, readFileSync, existsSync, statSync } = require('node:fs');
const { join } = require('node:path');
const errors = [];
const ok = (cond, msg) => { if (!cond)
    errors.push(msg); };
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
function sources(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === '.next')
            continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory())
            sources(full, out);
        else if (/\.tsx?$/.test(entry))
            out.push(full);
    }
    return out;
}
const files = [];
for (const root of ROOTS)
    if (existsSync(root))
        sources(root, files);
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
function formatImports(src) {
    const out = [];
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*import\s*\{/.test(lines[i]))
            continue;
        let block = lines[i];
        for (let j = i + 1; j < lines.length && !block.includes('from'); j++)
            block += `\n${lines[j]}`;
        if (/from\s+['"](@lib\/format|@\/lib\/format|.*\/format)['"]/.test(block))
            out.push(block);
    }
    return out.join('\n');
}
for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const imports = formatImports(src);
    if (!imports)
        continue;
    for (const name of READER_CLOCK) {
        // Word-bounded, so `fmtDay` does not match `fmtDayLabel` if one is ever
        // added, and so the word inside a comment in the same block is not a hit —
        // the block is only the import statement, which carries no prose.
        ok(!new RegExp(`\\b${name}\\b`).test(imports), `${file} imports ${name} from src/lib/format.ts — that draws a date on the READER's clock, `
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
function markedAbove(lines, index) {
    if (lines[index]?.includes(MARKER))
        return true;
    for (let i = index - 1; i >= 0; i--) {
        const l = lines[i];
        if (!/\S/.test(l))
            continue;
        if (!/^\s*(\/\/|\*|\/\*)/.test(l))
            return false;
        if (l.includes(MARKER))
            return true;
    }
    return false;
}
for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
        const code = line.trim();
        // Prose about the rule — including the paragraphs the console's own files
        // carry, which quote the expression this forbids.
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*'))
            return;
        if (!/isoDate\s*\(\s*new Date\s*\(\s*\)\s*\)/.test(line))
            return;
        ok(/gymDay\s*\(/.test(line) || markedAbove(lines, i), `${file}:${i + 1} takes today from isoDate(new Date()), which is the calendar day on `
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
    if (!existsSync(file))
        continue;
    const src = readFileSync(file, 'utf8');
    ok(src.includes('gymDay('), `studio-web/app/${route}/page.tsx no longer asks gymDay() for the gym's day — `
        + `every date comparison on that screen is back on the reader's calendar`);
}
if (errors.length) {
    console.error(`consoleClock.test.ts — ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
    for (const e of errors)
        console.error(`  · ${e}`);
    process.exit(1);
}
console.log(`consoleClock.test.ts — ok, ${files.length} console files draw their dates on the gym's clock.`);
