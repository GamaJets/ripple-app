#!/usr/bin/env node
// Two things a translated catalogue gets wrong, both of them quietly.
//
// ── 1. A translation of a movement that does not exist ────────────────────
//
// `exercise_translations.exercise_id` is a foreign key, so Postgres does catch
// this — but it catches it WHILE APPLYING THE SEED, half way through a 599-row
// insert, on whoever happens to be running setup.sql. The part aborts, the
// transaction takes the rest of the language with it, and what you are left
// with is a catalogue that is partly translated with nothing recording which
// part. The typo that causes it is small and plausible: 'bent-over-row' for
// 'bent-over-barbell-row', or an id copied from a movement part 76 retired.
//
// Checking it here fails on the commit that introduces it instead, before
// anybody has run anything.
//
// ── 2. A locale outside the supported set ─────────────────────────────────
//
// This one breaks nothing at all, which is why it needs a gate. A 'de-DE' row
// is stored happily, is read by nothing — src/lib/catalogueLocale.ts resolves
// a reader's tag down to the language subtag and looks up 'de' — and shows up
// in a row count as though the language were finished. So a language reads as
// done, ships, and every screen shows English.
//
// 'en' is a locale outside the set for the same reason it is not in
// TRANSLATION_LOCALES: English is not a translation of the catalogue, it IS
// the catalogue. It lives in `exercises.name`, `exercises.id` is the slug of
// it, and a second English string here would be a second answer to what a
// movement is called with nothing to say which one wins.
//
// ── And the drift between the three places the set is written down ────────
//
// The supported set is written down three times: TRANSLATION_LOCALES in
// src/lib/catalogueLocale.ts, the check constraint in part 790, and
// IMPORT_TRANSLATION_LOCALES in src/lib/repdbImport.ts — which duplicates it
// because scripts/import-repdb.mjs loads that module through Node's type
// stripping. All three are compared here. The failure when they drift is a
// language that is added to the app, seeds cleanly on a laptop whose database
// predates the constraint, and is rejected on a fresh environment; or an
// importer that stages a language nothing reads.
//
// Read from the SOURCE TREE, never from the live database — same rule, and the
// same reasoning, as scripts/check-catalogue.mjs: it needs no credentials, so
// it runs in CI and on a laptop, and it fails on the commit rather than on
// whoever deploys next.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PARTS = join(ROOT, 'supabase/parts');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const problems = [];
const fail = (msg) => problems.push(msg);

// ── the supported set, from the one place the app reads it ────────────────
const localeSrc = read('src/lib/catalogueLocale.ts');
const localeDecl = /export const TRANSLATION_LOCALES = \[([^\]]*)\] as const;/.exec(localeSrc);
if (!localeDecl) {
  console.error('check-translations: TRANSLATION_LOCALES is not where src/lib/catalogueLocale.ts kept it — the format moved.');
  process.exit(1);
}
const supported = [...localeDecl[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
if (!supported.length) {
  console.error('check-translations: parsed an EMPTY TRANSLATION_LOCALES. A guard that silently stops guarding is not a guard.');
  process.exit(1);
}

// ── and the same set as the database states it ────────────────────────────
const schemaPart = readdirSync(PARTS).find((f) => /^790-/.test(f));
if (!schemaPart) {
  console.error('check-translations: no supabase/parts/790-* — the translations schema part is gone.');
  process.exit(1);
}
const schemaSrc = readFileSync(join(PARTS, schemaPart), 'utf8');
const constraint = /exercise_translations_locale_chk\s*\n?\s*check \(locale in \(([^)]*)\)\)/.exec(schemaSrc);
if (!constraint) {
  console.error(`check-translations: could not find the locale check constraint in ${schemaPart} — the format moved.`);
  process.exit(1);
}
const constrained = [...constraint[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
const setsAgree = supported.length === constrained.length && supported.every((l) => constrained.includes(l));
if (!setsAgree) {
  fail(
    `TRANSLATION_LOCALES is [${supported.join(', ')}] and ${schemaPart} allows [${constrained.join(', ')}]. `
    + 'A language the app reads and the database refuses seeds cleanly on a machine built before the constraint '
    + 'and is rejected on a fresh one.',
  );
}
// ── and the third copy, the one the importer carries ─────────────────────
//
// src/lib/repdbImport.ts duplicates the set rather than importing it, because
// scripts/import-repdb.mjs loads that module through Node's type stripping,
// which resolves only what it is given an explicit path to — the same reason
// `slug` is duplicated there. Duplication is fine; duplication that drifts
// silently is not, and the drift here means the importer writes a language the
// database refuses.
const importSrc = read('src/lib/repdbImport.ts');
const importDecl = /export const IMPORT_TRANSLATION_LOCALES = \[([^\]]*)\] as const;/.exec(importSrc);
if (!importDecl) {
  console.error('check-translations: IMPORT_TRANSLATION_LOCALES is not where src/lib/repdbImport.ts kept it — the format moved.');
  process.exit(1);
}
const importSet = [...importDecl[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
if (importSet.length !== supported.length || !supported.every((l) => importSet.includes(l))) {
  fail(
    `src/lib/repdbImport.ts carries [${importSet.join(', ')}] and src/lib/catalogueLocale.ts carries `
    + `[${supported.join(', ')}]. The importer would stage a language the app never reads, or refuse one it does.`,
  );
}

if (supported.includes('en') || constrained.includes('en') || importSet.includes('en')) {
  fail(
    "'en' is in the supported set. English is not a translation of the catalogue — it is exercises.name, and "
    + 'exercises.id is the slug of it. A second English string is a second answer to what a movement is called.',
  );
}

// ── which exercises exist, after the parts that retire some of them ───────
//
// Same parse as scripts/check-catalogue.mjs — only the INSERT's VALUES block,
// for the reason spelled out there — and then the two retirements applied, so
// a translation pointed at a movement part 76 deleted is caught rather than
// counted.
const SEEDS = ['supabase/parts/49-exercise-video-library.sql', 'supabase/parts/74-repdb-catalogue.sql'];
const seeded = [];
for (const f of SEEDS) {
  let src;
  try { src = read(f); } catch { continue; }
  for (const block of src.matchAll(/insert into public\.exercises[\s\S]*?\bvalues\b([\s\S]*?)\non conflict/g)) {
    for (const m of block[1].matchAll(/\n\s*\('([a-z0-9-]+)',\s*'((?:[^']|'')*)'/g)) {
      seeded.push({ id: m[1], name: m[2].replace(/''/g, "'"), file: f });
    }
  }
}
if (seeded.length < 100) {
  console.error(`check-translations: only parsed ${seeded.length} seeded exercises — the seed format moved.`);
  process.exit(1);
}

// Part 75 keeps a named list of our own original rows and deletes the rest of
// them; part 76 deletes a named list outright. Both are read rather than
// hard-coded, so retiring another movement does not need this file edited.
const protectedIds = new Set(
  [...read('supabase/parts/75-retire-superseded-exercises.sql').matchAll(/\('([a-z0-9-]+)'\)/g)].map((m) => m[1]),
);
const del76 = new Set();
const del76Block = /delete from public\.exercises\nwhere id in \(([\s\S]*?)\);/.exec(
  read('supabase/parts/76-catalogue-dedupe-rekey.sql'),
);
if (del76Block) for (const m of del76Block[1].matchAll(/'([a-z0-9-]+)'/g)) del76.add(m[1]);

// Every LATER part that deletes exercises by an explicit id list.
//
// This is the line that was missing, and it cost three days of a green gate.
// The model above knows parts 49, 74, 75 and 76 by name and stops there, so it
// never heard of part 2260 — which deletes the fifteen movements part 74's
// regeneration had split in two (`bench-press` AND `barbell-bench-press`).
// This file therefore validated the translations against a catalogue of 619 in
// which fifteen were phantoms, and passed 16 rows per language naming exercises
// that production does not have and a fresh database deletes on the way past.
// scripts/check-catalogue.mjs, which replays the table properly, has been
// saying 604 the whole time. Two gates, two different catalogues, and the one
// whose entire job is catching orphaned translations was reading the wrong one.
//
// Read from every part rather than named, so part 2400 doing the same thing
// does not need this file edited — which is the mistake being corrected here.
// Only the `id in (…)` shape: part 75's `source is distinct from` inversion
// needs per-row provenance and is already handled above.
const deletedLater = new Set();
for (const f of readdirSync(PARTS).filter((f) => f.endsWith('.sql')).sort()) {
  const src = read(`supabase/parts/${f}`);
  for (const d of src.matchAll(/delete from public\.exercises\s+where id in \(([\s\S]*?)\);/g)) {
    for (const m of d[1].matchAll(/'([a-z0-9-]+)'/g)) deletedLater.add(m[1]);
  }
}

const live = new Map();
for (const r of seeded) {
  if (del76.has(r.id)) continue;
  if (deletedLater.has(r.id)) continue;
  // A row from part 49 that part 75 does not protect is deleted by part 75.
  if (r.file.includes('/49-') && !protectedIds.has(r.id)) continue;
  if (!live.has(r.id)) live.set(r.id, r.name);
}
if (live.size < 100) {
  console.error(`check-translations: only ${live.size} exercises survive the retirements — the retirement format moved.`);
  process.exit(1);
}

// ── the translation rows, from every part that writes any ─────────────────
const rows = [];
for (const f of readdirSync(PARTS).sort()) {
  if (!f.endsWith('.sql')) continue;
  const src = readFileSync(join(PARTS, f), 'utf8');
  if (!src.includes('insert into public.exercise_translations')) continue;
  for (const block of src.matchAll(/insert into public\.exercise_translations[\s\S]*?\bvalues\b([\s\S]*?)\non conflict/g)) {
    for (const m of block[1].matchAll(/\n?\s*\('([a-z0-9-]*)',\s*'([^']*)',\s*'((?:[^']|'')*)'/g)) {
      rows.push({ file: f, id: m[1], locale: m[2], name: m[3].replace(/''/g, "'") });
    }
  }
}

// A parse that comes back empty is a failure, never a clean run — the fault
// scripts/check-catalogue.mjs already learned twice.
const seedParts = readdirSync(PARTS).filter((f) =>
  readFileSync(join(PARTS, f), 'utf8').includes('insert into public.exercise_translations'));
if (seedParts.length && rows.length < 50) {
  console.error(
    `check-translations: ${seedParts.length} part(s) insert translations and only ${rows.length} rows parsed — the format moved.`,
  );
  process.exit(1);
}

// ── the rules ─────────────────────────────────────────────────────────────
const seen = new Set();
for (const r of rows) {
  if (!supported.includes(r.locale)) {
    fail(
      `${r.file}: "${r.id}" is translated into "${r.locale}", which is not a catalogue language. `
      + `The supported set is ${supported.join(', ')} — a row in any other locale is stored, read by nothing, `
      + 'and looks from a row count like the language is finished.',
    );
  }
  if (!r.id) {
    fail(`${r.file}: a translation row names no exercise at all, so nothing can ever resolve it.`);
    continue;
  }
  if (!live.has(r.id)) {
    fail(
      `${r.file}: "${r.id}" is translated into "${r.locale}" and no such exercise is seeded. `
      + 'The foreign key rejects this half way through applying the part, leaving the language partly loaded.',
    );
  }
  const key = `${r.id} ${r.locale}`;
  if (seen.has(key)) {
    fail(
      `${r.file}: "${r.id}" is translated into "${r.locale}" twice. The upsert applies whichever comes last, `
      + 'so which name ships is decided by the order lines happen to sit in a file.',
    );
  }
  seen.add(key);
  if (!r.name.trim()) {
    fail(
      `${r.file}: "${r.id}" has a "${r.locale}" row with a blank name. `
      + 'A blank is the one outcome worse than English — it is a movement with no name on a screen somebody trains from.',
    );
  }
}

if (problems.length) {
  console.error(`${problems.length} translation problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const p of problems.slice(0, 25)) console.error('  ' + p + '\n');
  if (problems.length > 25) console.error(`  …and ${problems.length - 25} more.\n`);
  process.exit(1);
}

const counts = supported.map((l) => `${rows.filter((r) => r.locale === l).length} ${l}`).join(', ');
console.log(
  `check:translations — ok. ${rows.length} rows (${counts}) against ${live.size} seeded exercises; `
  + `every row names a movement that exists, every locale is one of ${supported.join('/')}, and the check constraint agrees.`,
);
