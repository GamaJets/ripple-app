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
// ── The second rule: `toFixed` is not a formatter ─────────────────────────
//
// The rule above catches a locale NAMED in the source. It could not see the
// commoner half of the same defect, which names no locale at all:
//
//     `${strain.toFixed(1)} strain`      `${marginPct.toFixed(0)}% margin`
//
// `Number.prototype.toFixed` is a decimal SPELLING, not a formatter. It writes
// a full stop in every locale there has ever been and it never groups. So a
// screen printed "1,204.5 kg" from `num1` and "0.25 kg/wk" from `toFixed` in
// the same paragraph — two decimal separators, both ours — and on a German
// handset the second of those is not a quarter of a kilogram. A full stop is
// the THOUSANDS separator there, so the honest reading of that pace is
// twenty-five kilograms a week.
//
// Thirty-one call sites carried it when this rule was written, across all
// three apps, the shared library and four console pages. The fix is `num`,
// `num1`, `num2` or `numUpTo` from src/lib/format.ts — and, in the console,
// the same four from studio-web/lib/num.ts, which passes `undefined` rather
// than a latched tag because Next.js resolves a module-level locale on the
// server and again in the browser and those are two machines.
//
// ── what the second rule deliberately does NOT flag ───────────────────────
//
//   · `+(a - b).toFixed(1)`. The leading `+` coerces straight back to a
//     NUMBER, so nothing is being spelled — this is rounding to one decimal
//     place, it never reaches a screen as this string, and there are nine of
//     them in this tree. Recognised by the `+` sitting in unary position: at
//     the start of an expression, or straight after `=`, `(`, `[`, `,`, `?`,
//     `:` or `return`. `a + b.toFixed(1)` is addition and is still flagged.
//   · A KNOWN site, listed below with the reason it is right. Two of them, and
//     both are string arithmetic on money rather than display.
//   · A line marked `locale-ok:` with a sentence.
//
// ── What it cannot see ────────────────────────────────────────────────────
//
// A locale in a variable (`const L = 'en-GB'` two lines up), a tag built by
// concatenation, and any formatting done by a library rather than by Intl.
// It catches the form the mistake actually took in this codebase — a literal
// sitting in the first argument — and that is the whole of its claim.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = process.cwd();
/**
 * Every tree that renders a date or a figure for a person to read.
 *
 * It was `['app', 'src/ui', 'src/lib']`, and the header above says the rule is
 * about a white-label product where "a gym in Dubai, one in London and one in
 * Tokyo run the same binary" — which is a sentence about the CONSOLE as much as
 * the handset, and the console was not in the list. `scripts/check-console-when.mjs`
 * happens to forbid `toLocaleDateString(` under `studio-web` for a different
 * reason (whose CLOCK, not whose locale), so a hardcoded `'en-GB'` on a DATE in
 * the console would be caught there by accident. Nothing at all was looking at
 * `new Intl.NumberFormat('en-GB')` in a console file, which is the `num()` bug
 * this gate exists for, in the tree an accountant reads money in.
 *
 * `supabase/functions` is here for the same reason: a receipt or an invite email
 * composed on the server is read by whoever it is addressed to, not by us.
 *
 * Neither tree names a locale today. This closes the hole before it is used, and
 * costs nothing to keep closed.
 */
const ROOTS = [
  'app', 'src/ui', 'src/lib',
  'studio-web/app', 'studio-web/components', 'studio-web/lib',
  'supabase/functions',
];

/** The one file allowed to name a locale: it is the file that resolves them. */
const ALLOWED = new Set(['src/lib/locale.ts']);

/**
 * A `.toFixed(n)` whose result is a STRING somebody reads.
 *
 * `TO_FIXED` finds the call; `ROUNDING` recognises the one shape that is not a
 * spelling — a unary `+` in front of it, which coerces the string straight
 * back to a number. See the header.
 */
const TO_FIXED = /\.toFixed\s*\(/;
const ROUNDING = /(?:^|[=([,?:]|\breturn)\s*\+\s*\(?[A-Za-z0-9_$.\[\]()\s*/+-]*?\.toFixed\s*\(/;

/**
 * Sites where `toFixed` is right, with the reason. A count that GROWS is a new
 * offence; one that shrinks or empties is reported too, so the list cannot
 * quietly stop describing the tree — the same contract as KNOWN in
 * check-prose.mjs and check-deltas.mjs.
 */
const FIXED_KNOWN = new Map([
  ['src/lib/coachStatement.ts', { count: 1, why:
    'Deliberate string arithmetic on money, argued at length in that file: the digits are ' +
    'the ones the database recorded and `dp` comes from the currency\'s own places, never from 2. ' +
    'It is a wire format for a statement line, not a figure on a screen.' }],
  ['src/lib/instagramPublish.ts', { count: 1, why:
    'The aspect ratio in an API payload — "1.91:1" — read by Instagram and by nobody else. ' +
    'A locale-formatted one would be a comma in a machine field.' }],
]);

/** `locale-ok: <why>`. A bare marker with nothing after it does not count. */
const FIXED_EXCUSE = /locale-ok:\s*\S/;

/** Lines that are entirely comment. This file argues its own rule in prose and
 *  the prose is full of the calls it bans. */
function commentedLines(lines) {
  const out = new Array(lines.length).fill(false);
  let inBlock = false;
  lines.forEach((line, i) => {
    if (inBlock) {
      out[i] = true;
      if (line.includes('*/')) inBlock = false;
      return;
    }
    if (/^\s*\/\//.test(line)) { out[i] = true; return; }
    const open = line.indexOf('/*');
    if (open !== -1 && !line.includes('*/', open)) {
      inBlock = true;
      out[i] = /^[\s{]*$/.test(line.slice(0, open));
      return;
    }
    out[i] = /^\s*[{]?\s*\/\*.*\*\/\s*[}]?\s*$/.test(line);
  });
  return out;
}

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
const fixed = [];
const perRoot = new Map();
for (const root of ROOTS) {
  const inRoot = walk(join(ROOT, root));
  perRoot.set(root, inRoot.length);
  for (const file of inRoot) {
    const rel = relative(ROOT, file);
    if (ALLOWED.has(rel) || /\.test\.tsx?$/.test(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    const commented = commentedLines(lines);
    const relKey = rel.split('\\').join('/');
    lines.forEach((line, i) => {
      const m = LITERAL.exec(line);
      if (m) findings.push({ rel, line: i + 1, tag: m[2], text: line.trim() });
      if (commented[i] || FIXED_EXCUSE.test(line)) return;
      if (!TO_FIXED.test(line) || ROUNDING.test(line)) return;
      fixed.push({ key: relKey, where: `${relKey}:${i + 1}`, text: line.trim() });
    });
  }
}

/* ── the empty-set guard ───────────────────────────────────────────────────
 *
 * There was none: `walk` swallows a missing directory and returns `[]`, so a
 * renamed root made this gate print "ok, no locale is named in the source" over
 * a tree it had not opened. Counted per ROOT — see scripts/gate-floor.mjs for
 * why a single total is not a guard.
 */
assertRootFloors('check:locale', perRoot);

/* ── the second rule's ratchet ──────────────────────────────────────────── */
const seen = new Map();
for (const f of fixed) seen.set(f.key, (seen.get(f.key) ?? 0) + 1);
const freshFixed = [];
for (const f of fixed) {
  const allowed = FIXED_KNOWN.get(f.key)?.count ?? 0;
  if (!allowed || seen.get(f.key) > allowed) freshFixed.push(f);
}
const staleFixed = [];
const shrunkFixed = [];
for (const [key, { count }] of FIXED_KNOWN) {
  const n = seen.get(key) ?? 0;
  if (n === 0) staleFixed.push(key);
  else if (n < count) shrunkFixed.push([key, count, n]);
}

if (freshFixed.length || shrunkFixed.length || staleFixed.length) {
  if (freshFixed.length) {
    console.error('A fraction is spelled with toFixed, which writes a full stop in every locale:\n');
    for (const f of freshFixed) {
      console.error(`${f.where}`);
      console.error(`  ${f.text.slice(0, 130)}`);
    }
    console.error(`\n${freshFixed.length} problem${freshFixed.length === 1 ? '' : 's'}.`);
    console.error('Use num(), num1(), num2() or numUpTo() from src/lib/format.ts — or, in the console,');
    console.error('the same four from studio-web/lib/num.ts. If this genuinely must not be formatted');
    console.error('— a wire field, a machine payload — write `locale-ok: <why>` on the line.');
  }
  for (const [key, was, now] of shrunkFixed) {
    console.error(`\nFIXED_KNOWN['${key}'] in scripts/check-locale.mjs says ${was}; there are ${now}.`);
    console.error('Lower the count so the list still describes the tree.');
  }
  for (const key of staleFixed) {
    console.error(`\nstale exception: FIXED_KNOWN['${key}'] in scripts/check-locale.mjs matches nothing.`);
    console.error('Delete the entry — it looks like the work has been done.');
  }
  process.exit(1);
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

const openFixed = [...seen.values()].reduce((a, b) => a + b, 0);
console.log(
  `check:locale — ok, no locale is named in the source and no fraction is spelled by hand `
  + `(${openFixed} known toFixed site${openFixed === 1 ? '' : 's'}, both wire formats).`,
);
