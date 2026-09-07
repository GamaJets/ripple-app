// Bring a bought RepDB pack into the catalogue: metadata, stills, animations.
//
// Data: RepDB (https://repdb.co)
//
// ── What this is for, and why it is not build-repdb-catalogue.mjs ──────────
//
// build-repdb-catalogue.mjs turns the FREE tier into a seed file — 601 rows of
// text that ship in the repo as SQL. This does the other half: it takes a pack
// directory somebody has actually purchased and works out what would change,
// including the media, which is 1.8 GB and cannot live in the repo at all.
//
// The two are deliberately separate. One produces a file that is committed and
// reviewed; the other touches storage and a live database and therefore has to
// be run by a person who has read what it is about to do.
//
// ── --dry-run is the default, and that is the point ───────────────────────
//
// Every destructive direction here is opt-in. `--write` writes rows, `--upload`
// moves bytes, and neither happens by accident. The failure this prevents is
// the ordinary one: somebody runs the importer to SEE the mapping, and it
// silently pushes 1.8 GB into a paid storage bucket while they read the output.
//
// ── The licence is read off the pack, never passed as a flag ──────────────
//
// RepDB ships three archives that look identical from the outside — same
// filenames, same JSON shape, same image folders. One of them is CC BY-NC and
// must never reach a product that sells memberships. The way that goes wrong is
// not a decision anybody makes; it is a --pack argument left pointing at the
// wrong folder in Downloads. So the tier is read from the LICENSE.md that
// travels with the files, and a pack whose licence we cannot read is refused.
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
// One copy of the mapping rules, shared with src/lib/repdbImport.test.ts, via
// Node's type stripping. A second copy inside this script is how the two drift
// apart, and the drift would be invisible: both halves would still run.
//
// Node prints MODULE_TYPELESS_PACKAGE_JSON on this import. It is noise, not a
// fault: package.json declares no "type" — deliberately, because tsconfig.test.json
// emits CommonJS into .tmp and `npm test` runs that with plain `node` — so Node
// re-parses this one file as ESM after finding module syntax in it. Said here
// because the alternative to the warning is a second copy of the mapping rules,
// and an afternoon spent removing it would be an afternoon spent reintroducing
// the drift this import exists to prevent.
import {
  packTier, tierMayShip, demoLicenceFor, planRow, overlap, catalogueId,
  IMPORT_TRANSLATION_LOCALES, planTranslations, translationCoverage,
} from '../src/lib/repdbImport.ts';

const ROOT = process.cwd();
const args = process.argv.slice(2);
/*
 * --only <substring>: upload just the files whose pack path contains it.
 *
 * Added because a point release is seven exercises and nineteen files, and
 * without this the only way to move them was to re-upload all 1,564 — 1.8 GB
 * over the wire to replace 1,640 objects that were already correct. That is
 * slow enough that somebody skips it, and skipping it is how a new movement
 * ends up in the catalogue with no picture.
 *
 * Repeatable: --only ski-erg --only heel-flicks. It narrows the UPLOAD only;
 * the mapping, the staged SQL and --write are unaffected, so a narrowed run
 * still reports the whole picture and cannot quietly half-link the catalogue.
 */
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const PACK = flag('pack');
const STYLE = flag('style', 'classic');
const OUT_DIR = flag('out', '.repdb-staging');
const WRITE = has('write');
const UPLOAD = has('upload');
// --dry-run is not merely the default, it is the state unless a writing flag is
// named. Stated this way round so that adding a future write flag cannot leave
// a path where nothing is declared and something is written anyway.
const DRY = !WRITE && !UPLOAD;

if (!PACK) {
  console.error('usage: node scripts/import-repdb.mjs --pack <dir> [--style classic|flat] [--out .repdb-staging] [--write] [--upload] [--only <substring>]');
  console.error('  default is a dry run: it reports what it would write and writes nothing.');
  process.exit(1);
}
if (STYLE !== 'classic' && STYLE !== 'flat') {
  console.error(`--style must be classic or flat, got "${STYLE}".`);
  process.exit(1);
}
const ONLY = args.reduce((acc, a, i) => (a === '--only' && args[i + 1] ? [...acc, args[i + 1]] : acc), []);
if (!existsSync(PACK)) { console.error(`no such pack directory: ${PACK}`); process.exit(1); }

// ── 1 · the licence ────────────────────────────────────────────────────────
const licPath = join(PACK, 'LICENSE.md');
if (!existsSync(licPath)) {
  // A pack with no licence file is not a pack we can reason about. Refusing is
  // the only safe answer: the alternative is importing assets whose terms
  // nobody has read, which is the exact thing the tier check exists to stop.
  console.error(`${PACK} has no LICENSE.md. Refusing to import a pack whose terms cannot be read.`);
  process.exit(1);
}
const tier = packTier(readFileSync(licPath, 'utf8'));
const demoLicence = demoLicenceFor(tier);
console.log(`pack:    ${PACK}`);
console.log(`licence: ${tier}${tierMayShip(tier) ? ' — commercial use inside the product is permitted' : ' — NOT shippable'}`);

if (!tierMayShip(tier) && !DRY) {
  console.error(
    `\nRefusing to write: this pack is "${tier}".\n`
    + '  The evaluation preview is CC BY-NC. Repple sells coaching through Stripe Connect,\n'
    + '  so putting this content in the product would be commercial use of a\n'
    + '  non-commercially-licensed asset. Dry-run it instead, or point --pack at the\n'
    + '  purchased bundle.',
  );
  process.exit(1);
}

// ── 2 · the pack's records ────────────────────────────────────────────────
// exercises.json in the paid bundle, preview.json in the evaluation pack. Named
// explicitly rather than globbed, because picking up whichever JSON happens to
// sort first is how a manifest gets imported as a catalogue.
const dataFile = ['exercises.json', 'preview.json'].map((f) => join(PACK, f)).find(existsSync);
if (!dataFile) { console.error(`${PACK} has neither exercises.json nor preview.json.`); process.exit(1); }
const pack = JSON.parse(readFileSync(dataFile, 'utf8'));
const records = pack.exercises || [];
if (!records.length) { console.error(`${dataFile} carries no exercises.`); process.exit(1); }

// ── 3 · the catalogue we already have ─────────────────────────────────────
//
// Parsed from the generated seed rather than read from the live database, for
// the reason check-catalogue.mjs gives: the file is in the repo, it needs no
// credentials, and it therefore produces the same overlap number on a laptop
// with no .env as it does in CI. The anon key cannot read `exercises` under RLS
// in any case.
const SEEDS = ['supabase/parts/49-exercise-video-library.sql', 'supabase/parts/74-repdb-catalogue.sql'];
const existing = new Map();
for (const f of SEEDS) {
  let src;
  try { src = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
  for (const block of src.matchAll(/insert into public\.exercises[\s\S]*?\bvalues\b([\s\S]*?)\non conflict/g)) {
    for (const m of block[1].matchAll(/\n\s*\('([a-z0-9-]+)',\s*'((?:[^']|'')*)'/g)) {
      existing.set(m[1], m[2].replace(/''/g, "'"));
    }
  }
}
if (existing.size < 100) {
  // An empty parse is a failure, never a clean run. A silent zero here would
  // report every one of the 601 as a brand-new exercise and turn a media
  // backfill into what looks like a catalogue replacement.
  console.error(`import-repdb: only parsed ${existing.size} rows from the seed files — the format moved.`);
  process.exit(1);
}

// ── 4 · the mapping ────────────────────────────────────────────────────────
const { matched, added } = overlap(records, new Set(existing.keys()));
const plans = [];
const unplannable = [];
for (const rec of records) {
  const p = planRow(rec, STYLE);
  if (!p) { unplannable.push(rec.name_en || rec.id || '(unnamed)'); continue; }
  plans.push({ ...p, rec });
}

// Media is confirmed on disk, never trusted from the JSON: writing
// animation_path for a file that is not there produces a signed URL to nothing
// — the client gets a permanently spinning player instead of falling back to
// the stills it would otherwise have shown.
//
// ── Counted once per BUCKET OBJECT, not once per record ───────────────────
//
// Twelve movements borrow another's artwork via image_alias, so 601 records
// name fewer distinct pack files than they have rows. Pushing a path per record
// made the same bytes appear twice in the upload list and twice in the size
// estimate, which is a wrong number in the one place this script exists to
// produce a right one: the figure somebody reads before deciding to move 1.7 GB
// into a paid bucket.
//
// ── The two key shapes, which are not the same shape ──────────────────────
//
// A STILL is keyed by its own filename under `stills/`, so two rows sharing one
// picture share one object — `image_paths` is an array and both rows simply
// list the same key.
//
// An ANIMATION is keyed by the ROW id at the bucket root, which is what
// upload-exercise-demos.mjs writes and what the 483 objects in the bucket are
// named today. It is emphatically NOT the pack's filename: keyed by the vendor
// stem this script would have uploaded 483 objects under names no row points at
// and then repointed all 489 rows at them, blanking every animation in the
// product on the next `--write`. The cost of the row-id rule is that the twelve
// borrowed clips are stored twice, about 22 MB, in exchange for the invariant
// that every row owns the object it names.
const stillKey = (p) => `stills/${p.split('/').pop()}`;
const animKey = (rowId, p) => `${rowId}${p.slice(p.lastIndexOf('.'))}`;

let bytes = 0;
const missingStills = [];
const missingAnimations = [];
/** bucket key → pack-relative path. A Map, so one object is uploaded once
 *  however many rows asked for it. */
const moves = new Map();
const want = (key, packPath) => {
  if (moves.has(key)) return;
  moves.set(key, packPath);
  bytes += statSync(join(PACK, packPath)).size;
};
for (const p of plans) {
  const confirmed = [];
  for (const s of p.stills) {
    const abs = join(PACK, s);
    if (!existsSync(abs)) { missingStills.push(`${p.id}: ${s}`); continue; }
    confirmed.push(stillKey(s));
    want(stillKey(s), s);
  }
  p.confirmedStills = confirmed;
  p.confirmedAnimation = null;
  if (p.animation) {
    const abs = join(PACK, p.animation);
    if (existsSync(abs)) {
      p.confirmedAnimation = animKey(p.id, p.animation);
      want(p.confirmedAnimation, p.animation);
    } else {
      missingAnimations.push(`${p.id} (${p.mediaKey})`);
    }
  }
}
const uploads = [...moves.keys()];

// Equipment icons and muscle diagrams are catalogue-wide rather than per-row,
// so they are counted separately: they are a fixed cost that does not scale
// with how many exercises are imported.
let sidecarBytes = 0;
let sidecarFiles = 0;
for (const sub of ['equipment', 'muscles']) {
  const dir = join(PACK, 'images', sub);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    sidecarBytes += statSync(join(dir, f)).size;
    sidecarFiles++;
  }
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const rekeyed = plans.filter((p) => p.rekeyed);
const withAnim = plans.filter((p) => p.confirmedAnimation);
const withStills = plans.filter((p) => p.confirmedStills.length);

console.log(`records: ${records.length}  ·  style: ${STYLE}`);
console.log('');
console.log('── mapping ─────────────────────────────────────────────');
console.log(`  ${matched.length} of ${records.length} map onto exercises the app already has`);
console.log(`  ${added.length} would be new rows`);
console.log(`  ${rekeyed.length} have a media stem that differs from the slug of their name`);
console.log(`      (their files are named by the vendor id or by image_alias, their rows by the name —`);
console.log(`       conflating the two loses the pictures for all ${rekeyed.length})`);
if (rekeyed.length) {
  for (const p of rekeyed.slice(0, 3)) console.log(`      e.g. row ${p.id}  ←  files ${p.mediaKey}-*.webp`);
}
if (unplannable.length) console.log(`  ${unplannable.length} could not be planned at all: ${unplannable.slice(0, 5).join(', ')}`);
console.log('');
console.log('── media ───────────────────────────────────────────────');
console.log(`  ${withStills.length} rows with stills   (${uploads.filter((u) => u.startsWith('stills/')).length} files)`);
console.log(`  ${withAnim.length} rows with an animation confirmed on disk`);
if (missingAnimations.length) {
  console.log(`  ${missingAnimations.length} claim an animation with NO FILE in the pack — animation_path stays null for these:`);
  for (const m of missingAnimations) console.log(`      ${m}`);
}
if (missingStills.length) console.log(`  ${missingStills.length} stills named in the JSON are absent from the pack`);
console.log(`  ${uploads.length} files, ${mb(bytes)} for the exercises`);
console.log(`  ${sidecarFiles} files, ${mb(sidecarBytes)} for equipment icons and muscle diagrams`);
console.log(`  TOTAL ${uploads.length + sidecarFiles} files, ${mb(bytes + sidecarBytes)}`);

// ── 5 · what would be written ─────────────────────────────────────────────
//
// Staged as a file rather than printed, so the SQL can be read and diffed
// before anybody runs it. A dry run that only prints a summary is a dry run
// nobody can check.
mkdirSync(join(ROOT, OUT_DIR), { recursive: true });
const q = (v) => (v == null || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (xs) => (!xs || !xs.length ? 'null' : `array[${xs.map(q).join(', ')}]`);

// confirmedStills and confirmedAnimation are already BUCKET KEYS — resolved
// where the file was confirmed on disk, so the key written to the row and the
// key uploaded to are produced by one line of code rather than by two that can
// drift. `images/classic/x-start.webp` inside the pack is `stills/x-start.webp`
// in the bucket, the shape upload-exercise-stills.mjs writes and signedMedia.ts
// recognises; an animation is `<row id>.webp` at the root.
const updates = plans
  .filter((p) => p.confirmedStills.length || p.confirmedAnimation)
  .map((p) => `update public.exercises set\n`
      + `    image_paths   = ${arr(p.confirmedStills)},\n`
      + `    animation_path = ${q(p.confirmedAnimation)},\n`
      + `    demo_licence  = ${q(demoLicence)}\n`
      + `  where id = ${q(p.id)};`);

const sqlPath = join(ROOT, OUT_DIR, 'media-link.sql');
writeFileSync(sqlPath,
  `-- STAGED, NOT APPLIED. Generated by scripts/import-repdb.mjs from ${PACK}.\n`
  + `-- Licence tier read off the pack: ${tier}. demo_licence stamped '${demoLicence}'.\n`
  + `-- Data: RepDB (https://repdb.co)\n`
  + `--\n`
  + `-- ${updates.length} rows would have their media repointed at our own bucket.\n`
  + `-- image_paths is ORDERED: [0] is the start position, [1] the peak. The detail\n`
  + `-- screen cross-fades one into the other, so reversing the array plays the\n`
  + `-- movement backwards while looking entirely correct in a row count.\n\n`
  + updates.join('\n\n') + '\n');

// ── 5b · the languages the pack ships ─────────────────────────────────────
//
// The Standard bundle carries exercises.de.json and exercises.es.json beside
// exercises.json: a translated name and description for each of the 601
// records. Staged as its own file, because it lands in a different table and
// because a translation set is the thing somebody is most likely to want to
// read before applying — a wrong movement name in a programme is a person doing
// the wrong exercise.
//
// Keyed by RepDB's OWN id, which is why planTranslations() joins through the
// English record: for 80 of the 601 the vendor id is not the catalogue id, and
// a row written under the vendor id violates the foreign key half way through
// the language. See the header of src/lib/repdbImport.ts.
const translationStats = {};
const translationSql = [];
for (const locale of IMPORT_TRANSLATION_LOCALES) {
  const file = join(PACK, `exercises.${locale}.json`);
  if (!existsSync(file)) { translationStats[locale] = { present: false }; continue; }
  let localised = [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    localised = parsed.exercises || [];
  } catch (e) {
    console.error(`  ${locale}: ${relative(ROOT, file)} could not be parsed — ${e.message}`);
    translationStats[locale] = { present: true, parsed: false };
    continue;
  }
  const { rows, skipped } = planTranslations(records, localised, locale);
  const cov = translationCoverage(rows, new Set(existing.keys()));
  translationStats[locale] = {
    present: true,
    parsed: true,
    rows: rows.length,
    skipped: skipped.length,
    skipped_reasons: skipped.reduce((m, s) => ({ ...m, [s.reason]: (m[s.reason] || 0) + 1 }), {}),
    // The number a translation run is judged on. "601 rows written" says
    // nothing about how much of the catalogue a member can read in their own
    // language, and the untranslated list is what somebody works through next.
    covers: cov.translated.length,
    of: cov.translated.length + cov.untranslated.length,
    untranslated: cov.untranslated,
  };
  if (!rows.length) continue;
  translationSql.push(
    `-- ${locale}: ${rows.length} rows, covering ${cov.translated.length} of `
    + `${cov.translated.length + cov.untranslated.length} seeded movements.\n`
    + 'insert into public.exercise_translations (exercise_id, locale, name, description, source) values\n'
    + rows.map((r) => `  (${q(r.exerciseId)}, '${locale}', ${q(r.name)}, ${q(r.description)}, 'repdb')`).join(',\n')
    // Upsert on the primary key: this file may be run twice, or run again with
    // twelve names corrected, and either must leave one row per movement per
    // language rather than a second anything.
    + '\non conflict (exercise_id, locale) do update\n'
    + '  set name = excluded.name,\n'
    + '      description = excluded.description,\n'
    + '      source = excluded.source,\n'
    + '      updated_at = now();',
  );
}

let translationPath = null;
if (translationSql.length) {
  translationPath = join(ROOT, OUT_DIR, 'translations.sql');
  writeFileSync(translationPath,
    `-- STAGED, NOT APPLIED. Generated by scripts/import-repdb.mjs from ${PACK}.\n`
    + `-- Licence tier read off the pack: ${tier}.\n`
    + '-- Data: RepDB (https://repdb.co)\n'
    + '--\n'
    + '-- Every exercise_id here is the slug of the movement\'s ENGLISH name, NOT\n'
    + "-- RepDB's own id — they differ for 80 of the 601 records, and a row written\n"
    + '-- under the vendor id is rejected by the foreign key half way through the\n'
    + '-- language, leaving the catalogue partly translated with nothing recording\n'
    + '-- which part.\n\n'
    + translationSql.join('\n\n') + '\n');
}

const manifestPath = join(ROOT, OUT_DIR, 'media-manifest.json');
writeFileSync(manifestPath, JSON.stringify({
  pack: PACK,
  tier,
  style: STYLE,
  demo_licence: demoLicence,
  generated_at: new Date().toISOString(),
  totals: {
    records: records.length,
    matched: matched.length,
    added: added.length,
    rekeyed: rekeyed.length,
    files: uploads.length + sidecarFiles,
    bytes: bytes + sidecarBytes,
  },
  missing_animations: missingAnimations,
  translations: translationStats,
  uploads: [...moves].map(([to, from]) => ({ from, to })),
}, null, 2));

console.log('');
console.log('── staged ──────────────────────────────────────────────');
console.log(`  ${relative(ROOT, sqlPath)}       ${updates.length} row updates`);
console.log(`  ${relative(ROOT, manifestPath)}  ${uploads.length} file moves`);
if (translationPath) {
  const summary = IMPORT_TRANSLATION_LOCALES
    .map((l) => translationStats[l]?.rows ? `${translationStats[l].rows} ${l} (covers ${translationStats[l].covers} of ${translationStats[l].of})` : null)
    .filter(Boolean).join(', ');
  console.log(`  ${relative(ROOT, translationPath)}   ${summary}`);
} else {
  console.log('  no translations staged — this pack ships no exercises.<locale>.json this importer reads.');
}

if (DRY) {
  console.log('');
  console.log('--dry-run (default): nothing uploaded, nothing written to the database.');
  console.log('  Re-run with --write to apply the SQL, --upload to move the media.');
  process.exit(0);
}

// ── 6 · the writing directions, which are opt-in ──────────────────────────
//
// Credentials are demanded here rather than at the top so that a dry run works
// on any laptop with no environment at all. An importer that cannot be run
// without secrets is one nobody runs before deciding.
const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error('\nset SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to write.'); process.exit(1); }
const { createClient } = await import('@supabase/supabase-js');
const db = createClient(url, key, { auth: { persistSession: false } });
const BUCKET = 'exercise-demos';

if (UPLOAD) {
  console.log(`\nuploading ${uploads.length + sidecarFiles} files (${mb(bytes + sidecarBytes)}) to ${BUCKET}…`);
  let done = 0; const failed = []; let skipped = 0;
  for (const [key, packPath] of moves) {
    // Narrowed by --only. Counted and reported rather than silently passed
    // over: "uploaded 19" under a heading that said 1564 is the kind of number
    // somebody reads as a failure.
    if (ONLY.length && !ONLY.some((o) => packPath.includes(o) || key.includes(o))) { skipped += 1; continue; }
    const body = readFileSync(join(PACK, packPath));
    const { error } = await db.storage.from(BUCKET).upload(key, body, { contentType: 'image/webp', upsert: true });
    if (error) { failed.push(`${packPath}: ${error.message}`); continue; }
    if (++done % 100 === 0) console.log(`  ${done}/${uploads.length}`);
  }
  console.log(ONLY.length
    ? `  uploaded ${done}, skipped ${skipped} not matching --only ${ONLY.join(' ')}`
    : `  uploaded ${done}/${uploads.length}`);
  if (failed.length) {
    console.error(`  ${failed.length} failed:`);
    for (const f of failed.slice(0, 8)) console.error('    ' + f);
    process.exit(1);
  }
}

if (WRITE) {
  console.log(`\nlinking ${updates.length} rows…`);
  let ok = 0; const failed = [];
  for (const p of plans) {
    if (!p.confirmedStills.length && !p.confirmedAnimation) continue;
    // The row must already exist. An update that matches nothing is not an
    // error to supabase-js, so a missing row would be reported as a success and
    // the movement would come out with no picture and no complaint.
    if (!existing.has(p.id)) { failed.push(`${p.id}: no such row in the catalogue`); continue; }
    const { error } = await db.from('exercises').update({
      image_paths: p.confirmedStills,
      animation_path: p.confirmedAnimation,
      demo_licence: demoLicence,
    }).eq('id', p.id);
    if (error) { failed.push(`${p.id}: ${error.message}`); continue; }
    ok++;
  }
  console.log(`  linked ${ok}/${updates.length}`);
  if (failed.length) {
    console.error(`  ${failed.length} failed:`);
    for (const f of failed.slice(0, 8)) console.error('    ' + f);
    process.exit(1);
  }
}
console.log('\ndone.');
