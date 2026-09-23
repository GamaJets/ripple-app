#!/usr/bin/env node
// The website's buttons, nav rows and field labels are Title Case, like the
// apps'.
//
// Reported by the owner, 23 Sep 2026, with a screenshot of the signup page:
// "Create account" under a heading, beside pills, one letter away from the
// "Create Account" the app has shown since it was built. The site had drifted
// everywhere at once — 25 pages, 136 strings — and nothing was watching it,
// because scripts/check-caps.mjs walks `app`, `src/ui` and `studio-web` and
// has never walked `web`. A sweep without a gate is a sweep that gets done
// again in a month; this is the half that was missing.
//
// ── the same rule, deliberately ───────────────────────────────────────────
//
// TITLE CASE for a button, a nav row and a field label. Small words stay
// lowercase unless they open the string — "Get the Apps", "Back to the Site",
// "Ask for a Quote". The list below is src/lib/exerciseName.ts's SMALL minus
// the particles that belong to a phrasal verb, because check-caps.mjs's own
// example is "Look It Up on the Web": Up is part of the verb and is
// capitalised, on is a preposition and is not.
//
// SENTENCE CASE stays put for everything else — headings, hero copy, notes,
// placeholders, the password-rule pills. Marketing headlines on this site are
// written as sentences on purpose ("Built for every side of progress."), and
// title-casing them would be a worse regression than the bug this catches. So
// nothing here looks at a heading, a paragraph or an attribute.
//
// ── the escape ────────────────────────────────────────────────────────────
//
// A string that has to break the rule carries `<!-- caps-ok: why -->` on the
// line before it. A bare marker does not count; the reason is the point.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'web';
const SMALL = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as',
  'at', 'by', 'in', 'of', 'on', 'per', 'to', 'via', 'vs', 'with', 'from',
]);

/** A word that is not a word to capitalise: an address, a domain, a URL. */
const isAddress = (w) => w.includes('@') || w.includes('://') || /\w\.\w/.test(w);

function offenders(text) {
  const words = text.trim().split(/\s+/);
  const bad = [];
  words.forEach((w, i) => {
    if (isAddress(w)) return;
    const bare = w.replace(/[^A-Za-z]/g, '');
    if (!bare || bare.toUpperCase() === bare) return;      // acronyms, digits, symbols
    if (i > 0 && SMALL.has(bare.toLowerCase())) return;
    if (!/[A-Z]/.test(bare[0])) bad.push(w);
  });
  return bad;
}

/* The three places the rule applies, and nothing else. `nav-links` and
 * `nav-actions` are the primary nav; `cta`, `btn`, `button*` and `get` are what
 * this site's buttons are called; a `<label>` is a field label by definition. */
const BUTTON = /<a\b[^>]*class="[^"]*\b(?:cta|btn|button|button-light|button-primary|button-ghost|get)\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
const NAV = /<div class="nav-(?:links|actions)"[^>]*>([\s\S]*?)<\/div>/g;
const LABEL = /<label\b[^>]*>([^<]*)<\/label>/g;
const TEXT = />([^<>]+)</g;

const files = readdirSync(DIR).filter((f) => f.endsWith('.html')).sort();
const found = [];

for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8');
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const excused = new Set();
  for (const m of src.matchAll(/<!--\s*caps-ok:[^>]*-->/g)) excused.add(lineOf(m.index) + 1);

  const check = (text, at) => {
    const clean = text.replace(/&[a-z]+;/g, ' ').trim();
    if (!clean || clean.length < 2 || !/[A-Za-z]/.test(clean)) return;
    const bad = offenders(clean);
    if (!bad.length) return;
    const line = lineOf(at);
    if (excused.has(line)) return;
    found.push({ file: f, line, text: clean.slice(0, 60), bad });
  };

  for (const m of src.matchAll(BUTTON)) {
    const inner = m[1];
    if (inner.includes('<')) {
      for (const t of inner.matchAll(TEXT)) check(t[1], m.index);
    } else check(inner, m.index);
  }
  for (const m of src.matchAll(NAV)) {
    for (const t of m[1].matchAll(TEXT)) check(t[1], m.index);
  }
  for (const m of src.matchAll(LABEL)) check(m[1], m.index);
}

if (found.length) {
  console.error(`\n${found.length} label${found.length === 1 ? '' : 's'} on the site that a sibling does not match:\n`);
  for (const f of found) {
    console.error(`  ${DIR}/${f.file}:${f.line}`);
    console.error(`    "${f.text}"`);
    console.error(`    lowercase where the house rule is Title Case: ${f.bad.join(', ')}`);
  }
  console.error('\nA button, a nav row and a field label are Title Case. Small words stay');
  console.error('lowercase unless they open the string. Prose — headings, notes,');
  console.error('placeholders — is sentence case and is not read by this gate.');
  console.error('A string that has to break the rule carries `<!-- caps-ok: why -->` on');
  console.error('the line before it, with the reason.\n');
  process.exit(1);
}
console.log(`check-site-caps — ok, ${files.length} pages; every button, nav row and field label is Title Case`);
