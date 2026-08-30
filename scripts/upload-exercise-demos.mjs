// Get a bought animation pack into the app.
//
//   node scripts/upload-exercise-demos.mjs --dir ~/Downloads/pack --licence commercial
//   node scripts/upload-exercise-demos.mjs --dir ~/Downloads/preview --licence evaluation --dry-run
//
// A pack arrives as a folder of clips named after the vendor's own exercise
// names. Three things have to happen to each one, and only the middle one is
// interesting:
//
//   1. match the file to a row in our catalogue;
//   2. upload it to the exercise-demos bucket;
//   3. write the storage key onto that row.
//
// ── The matching is the part that goes wrong ───────────────────────────────
//
// Hevy illustrates its DUMBBELL decline press with the BARBELL decline
// animation, on the page a trainer sent us as the example to follow. Matching
// our 49 originals against a public dataset, similarity paired Back Squat with
// Hack Squat at 0.90 and Hip Abduction with Cable Hip Adduction — the opposite
// movement. Paying for the pack does not make that safer.
//
// So this NEVER matches fuzzily. A file whose slugged name equals a catalogue
// id is uploaded; everything else is written to a review file for a person to
// confirm, and confirmations live in data/exercise-demo-mapping.json where they
// can be read without reading JavaScript. Same discipline as the catalogue
// import, for the same reason: a wrong clip is a client copying the wrong
// movement under load.
//
// ── Why --licence is required and not defaulted ────────────────────────────
//
// A preview bundle is CC BY-NC. It is fine for deciding whether to buy and
// never fine in a product that sells memberships. Nothing here guesses which
// kind of pack it is being handed, and every row records what it was told, so
// the app can refuse to render an evaluation asset in a release build.
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const DIR = flag('dir');
const LICENCE = flag('licence');
const DRY = has('dry-run');
const BUCKET = 'exercise-demos';
const MAPPING = join(process.cwd(), 'data/exercise-demo-mapping.json');
// A pack names its files by the VENDOR's ids, not ours. scripts/build-demo-map.mjs
// turns the vendor's own JSON into filename → our row, which is a lookup rather
// than a guess. Passed in rather than assumed, so a pack that happens to use our
// slugs still works without one.
const MAP_FILE = flag('map');
const REVIEW = join(process.cwd(), 'docs/exercise-demo-review.tsv');
const PLAYABLE = new Set(['.mp4', '.webm', '.webp', '.gif', '.json']);

if (!DIR || !existsSync(DIR)) {
  console.error('upload-exercise-demos: --dir <folder of clips> is required and must exist.');
  process.exit(1);
}
if (LICENCE !== 'commercial' && LICENCE !== 'evaluation') {
  console.error(
    'upload-exercise-demos: --licence must be "commercial" (a pack you have bought) or\n'
    + '"evaluation" (a CC BY-NC preview). There is no default: an evaluation asset that\n'
    + 'reaches a release build is a licence breach, and the way that happens is somebody\n'
    + 'not being asked.',
  );
  process.exit(1);
}

// Service key, because writing to a bucket and to the catalogue are both
// admin actions. Never the anon key — that would silently write nothing under
// RLS and report success.
const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('upload-exercise-demos: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  console.error('  Dashboard ▸ Project Settings ▸ API ▸ service_role. Do not commit it.');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

/** Mirrors exerciseSlug() in src/lib/exerciseId.ts — the one identity rule. */
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');

const files = readdirSync(DIR)
  .filter((f) => PLAYABLE.has(extname(f).toLowerCase()))
  .filter((f) => statSync(join(DIR, f)).isFile());
if (!files.length) {
  console.error(`upload-exercise-demos: no playable files in ${DIR} (looked for ${[...PLAYABLE].join(' ')}).`);
  process.exit(1);
}

const { data: rows, error: rErr } = await db.from('exercises').select('id, name');
if (rErr) { console.error('upload-exercise-demos: could not read the catalogue —', rErr.message); process.exit(1); }
const byId = new Map(rows.map((r) => [r.id, r]));

const confirmed = existsSync(MAPPING)
  ? (JSON.parse(readFileSync(MAPPING, 'utf8')).mappings || {})
  : {};
// filename → our id, built from the vendor's own data. Authoritative: where it
// has an answer, no name matching is attempted at all.
const vendorMap = MAP_FILE && existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, 'utf8')) : {};
// The mapping file is written the human way round — our id → the vendor's file
// name — so it reads as a list of decisions rather than of filenames.
const fileFor = new Map(Object.entries(confirmed).map(([id, f]) => [f, id]));

const matched = [];
const unmatched = [];
for (const f of files) {
  const stem = basename(f, extname(f));
  const byName = byId.has(slug(stem)) ? slug(stem) : null;
  // Vendor map first — it is derived from the pack's own JSON and is the only
  // one of the three that knows 'squat.webp' belongs to Barbell Back Squat.
  //
  // But only when it names a row that EXISTS. The paid bundle renames some
  // movements relative to the free package our catalogue was built from —
  // 'bench-press.webp' is "Barbell Bench Press" there and "Bench Press" here —
  // so the vendor's own name resolves to a slug we do not have, while the
  // filename is already exactly our id. Verifying against the catalogue rather
  // than trusting the map blind is what turns those eleven from "needs a human"
  // into an exact match, and it costs nothing when the map is right.
  const mapped = vendorMap[f];
  const id = (mapped && byId.has(mapped)) ? mapped : (fileFor.get(f) ?? byName);
  if (id && byId.has(id)) matched.push({ file: f, id });
  else unmatched.push(f);
}

if (unmatched.length) {
  const lines = ['vendor_file\tour_id_to_confirm\tnearest_catalogue_names'];
  const names = [...byId.values()];
  const score = (a, b) => {
    const A = new Set(slug(a).split('-')), B = new Set(slug(b).split('-'));
    return [...A].filter((w) => B.has(w)).length / Math.max(A.size, B.size);
  };
  for (const f of unmatched) {
    const stem = basename(f, extname(f));
    const near = names.map((n) => ({ n, s: score(stem, n.name) }))
      .sort((a, b) => b.s - a.s).slice(0, 3)
      .map((c) => `${c.n.id} (${c.s.toFixed(2)})`).join(', ');
    lines.push(`${f}\t\t${near}`);
  }
  writeFileSync(REVIEW, lines.join('\n') + '\n');
}

console.log(
  `${files.length} files · ${matched.length} matched by name or confirmed · ${unmatched.length} need a human`
  + (unmatched.length ? `\n  ${REVIEW} — fill in our_id_to_confirm, copy into ${MAPPING}, re-run` : ''),
);
if (DRY) { console.log('\n--dry-run: nothing uploaded, nothing written.'); process.exit(0); }

let ok = 0; const failed = [];
for (const { file, id } of matched) {
  const body = readFileSync(join(DIR, file));
  const ext = extname(file).toLowerCase();
  const path = `${id}${ext}`;
  const type = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm'
    : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'application/json';
  const { error: uErr } = await db.storage.from(BUCKET).upload(path, body, { contentType: type, upsert: true });
  if (uErr) { failed.push(`${file}: ${uErr.message}`); continue; }
  // Written only after the upload succeeded. A path on a row with no file
  // behind it is worse than no path: the screen would offer a demo and play
  // nothing, which reads as the app being broken rather than as a gap.
  const { error: wErr } = await db.from('exercises')
    .update({ animation_path: path, demo_licence: LICENCE }).eq('id', id);
  if (wErr) { failed.push(`${file}: uploaded but not linked — ${wErr.message}`); continue; }
  ok++;
}

console.log(`\nuploaded and linked: ${ok}/${matched.length}, licence '${LICENCE}'`);
if (failed.length) {
  console.error(`${failed.length} failed:`);
  for (const f of failed) console.error('  ' + f);
  process.exit(1);
}
if (LICENCE === 'evaluation') {
  console.log(
    '\nThese are EVALUATION assets. The app will not render them in a release build,\n'
    + 'and preflight fails if one is present. Re-run with --licence commercial once bought.',
  );
}
