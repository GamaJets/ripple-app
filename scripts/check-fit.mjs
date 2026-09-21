#!/usr/bin/env node
// A shrink-to-fit figure with a fixed line height can draw at 4pt.
//
// TF-23: a member's Progress screen drew body fat, 19.5%, as a smudge the size
// of a full stop: the digits 1, 9 and 5 on top of each other at 4pt, while the
// card under it read "19.5% BF". On iOS in this React Native, a
// `<Text adjustsFontSizeToFit>` ignores `minimumFontScale` (the real floor is
// 4pt) and only accepts a size at which the text fits the box's HEIGHT as well
// as its width. A type step's `lineHeight` is fixed and does not shrink with
// the font, so a box a hair shorter than one line has no size that fits and
// the text falls straight to the floor, letter-spacing intact. The docblock on
// `HERO_FIT` in src/ui/kit.tsx has the source-level detail.
//
// That one site was fixed, and a sweep then found 24 more written the same way,
// because the natural way to write a figure (`{ ...ty.hero, ...numeric }`)
// is the unsafe one. Every `ty.*` step carries a fixed lineHeight.
//
// ── what this checks ──────────────────────────────────────────────────────
//
// Every `<Text ... adjustsFontSizeToFit ...>` in app/ and src/ui/ whose opening
// tag spreads a `ty.*` step or sets `lineHeight:` must also spread `HERO_FIT`
// (or say `lineHeight: undefined`). `value(n)` carries no line height and is
// fine as it is. `fit-ok: <reason>` on the tag or the line above excuses one.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.expo', 'ios', 'android']);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (p.endsWith('.tsx')) yield p;
  }
}

const problems = [];
let sites = 0;
for (const f of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'src/ui'))]) {
  const src = readFileSync(f, 'utf8');
  const re = /<Text\b[^]*?(?:\}\}>|"\s*>|\}\s*>|\/>)/g; // the opening tag, up to where the style closes
  for (const m of src.matchAll(re)) {
    const tag = m[0];
    if (!/\badjustsFontSizeToFit\b/.test(tag)) continue;
    sites++;
    const fixed = /\.\.\.ty\.\w+|\blineHeight\s*:/.test(tag);
    if (!fixed || /HERO_FIT|lineHeight\s*:\s*undefined/.test(tag)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    const above = src.split('\n')[line - 2] ?? '';
    if (/fit-ok:\s*\S/.test(tag) || /fit-ok:\s*\S/.test(above)) continue;
    problems.push(`  ${relative(ROOT, f)}:${line}`);
  }
}

// The empty-set guard: a check that found nothing to look at has not passed.
if (sites < 10) {
  console.error(`check-fit: only found ${sites} shrink-to-fit Text sites, which cannot be right. Refusing to pass.`);
  process.exit(1);
}

if (problems.length) {
  console.error(`\n${problems.length} shrink-to-fit Text with a fixed line height:\n`);
  console.error(problems.join('\n'));
  console.error('\nOn iOS a box a hair shorter than that line makes the text drop to 4pt, digits piled');
  console.error('on each other (TF-23). Spread HERO_FIT from src/ui/kit.tsx after the type step:');
  console.error('  { ...ty.hero, ...numeric, ...HERO_FIT, color }\n');
  process.exit(1);
}

console.log(`check-fit — ok, ${sites} shrink-to-fit Text sites carry no fixed line height`);
