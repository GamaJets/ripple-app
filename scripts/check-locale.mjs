#!/usr/bin/env node
// A date or a figure is written in the READER's locale, not in ours.
//
// ── What went wrong ───────────────────────────────────────────────────────
//
// The app wrote every date and every figure two different ways. Twenty-three
// call sites named `'en-GB'` outright and around forty passed `undefined`,
// which is the device's own locale — and both spellings appeared inside the
// same screens, so the same member could read "14 Aug" above a chart and
// "Aug 14" under it.
//
// The one that was not merely inconsistent was `num()`. Every figure in this
// app over three digits goes through it, and it was pinned to en-GB. On a
// German or French handset that made a 2,860 kcal day read "2.860" and
// "2 860" — and in German "2.860" is 2.86. Not a foreign-looking number: a
// number wrong by a factor of a thousand, on the screen whose only job is to
// say how much somebody has eaten.
//
// This is also a white-label product. A gym in Dubai, one in London and one in
// Tokyo run the same binary, so there is no house locale that is not simply
// wrong for two of them.
//
// ── The rule ──────────────────────────────────────────────────────────────
//
// A `toLocaleString`, `toLocaleDateString` or `toLocaleTimeString` call, or an
// `Intl.*` constructor, may not name a locale as a string literal. It passes
// `appLocale()` from src/lib/locale.ts, which resolves the handset's own tag
// once and reports whether it got one.
//
// ── What this deliberately does NOT flag ──────────────────────────────────
//
//   · `undefined` or no argument at all. That IS the device locale and is
//     correct today; `appLocale()` resolves to the same tag. It is preferred
//     because it is a named place with a fallback, not because the bare form
//     is a bug, and a check that failed the build over the difference would be
//     enforcing a preference rather than protecting a reader.
//   · src/lib/locale.ts itself, which is where the one literal lives.
//   · Test files, which state their locale ON PURPOSE — an assertion that
//     reads whatever the runner is set to is a test of the machine.
//
// ── What it cannot see ────────────────────────────────────────────────────
//
// A locale in a variable (`const L = 'en-GB'` two lines up), a tag built by
// concatenation, and any formatting done by a library rather than by Intl.
// It catches the form the mistake actually took in this codebase — a literal
// sitting in the first argument — and that is the whole of its claim.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['app', 'src/ui', 'src/lib'];

/** The one file allowed to name a locale: it is the file that resolves them. */
const ALLOWED = new Set(['src/lib/locale.ts']);

/** `x.toLocaleDateString('en-GB'` / `new Intl.NumberFormat("de-DE"` — a quoted
 *  tag in the locale argument. A BCP-47 tag is 2-3 letters, then subtags. */
const LITERAL = /(?:toLocale(?:String|DateString|TimeString)|Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat|ListFormat|PluralRules|Collator|Segmenter))\s*\(\s*(['"])([A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*)\1/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const findings = [];
for (const root of ROOTS) {
  for (const file of walk(join(ROOT, root))) {
    const rel = relative(ROOT, file);
    if (ALLOWED.has(rel) || /\.test\.tsx?$/.test(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = LITERAL.exec(line);
      if (m) findings.push({ rel, line: i + 1, tag: m[2], text: line.trim() });
    });
  }
}

if (findings.length) {
  console.error('A locale is named in the source instead of read from the reader:\n');
  for (const f of findings) {
    console.error(`${f.rel}:${f.line}  '${f.tag}'`);
    console.error(`  ${f.text.slice(0, 120)}`);
  }
  console.error(`\n${findings.length} problem${findings.length === 1 ? '' : 's'}.`);
  console.error("Pass appLocale() from src/lib/locale.ts, or use the helpers in src/lib/format.ts.");
  process.exit(1);
}

console.log('check:locale — ok, no locale is named in the source.');
