// Put a bought pack's stills in our own storage and point the catalogue at them.
//
// ── Why this is separate from the animation uploader ──────────────────────
//
// An animation is one file on one row: animation_path. A still is one of two —
// a start and a peak — and they land in image_paths as an ORDERED array, since
// the screen cross-fades them in that order and reversing it plays the movement
// backwards. Different shape, different write, different failure if you get it
// wrong.
//
// ── Why the transparent 'classic' style and not 'flat' ────────────────────
//
// flat has a pale background baked in, so every illustration in a dark app sits
// in a light box that reads as a card pasted onto the screen. classic ships
// with an alpha channel and sits directly on our own surface. Same subject,
// same resolution; the only difference is the thing that made it look wrong.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);
const DIR = flag('dir');
const MAP_FILE = flag('map');
const PREFIX = flag('prefix', 'stills');
const DRY = has('dry-run');
const BUCKET = 'exercise-demos';

if (!DIR || !MAP_FILE) { console.error('usage: --dir <stills dir> --map <map.json> [--prefix stills] [--dry-run]'); process.exit(1); }

const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) { console.error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const map = JSON.parse(readFileSync(MAP_FILE, 'utf8'));   // filename -> our row id
const files = readdirSync(DIR).filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f));

const { data: rows, error: rErr } = await db.from('exercises').select('id');
if (rErr) { console.error('could not read the catalogue —', rErr.message); process.exit(1); }
const known = new Set(rows.map((r) => r.id));

// Group by row, and keep the variants in the order the screen plays them.
const ORDER = { start: 0, peak: 1, main: 0 };
const byRow = new Map();
const orphan = [];
for (const f of files) {
  const stem = basename(f, extname(f));
  // The paid bundle renames some movements relative to the free package this
  // catalogue was built from, so the vendor's own name can resolve to a slug we
  // do not have. Where it does, the filename is already exactly our id — the
  // same eleven rows the animation upload hit.
  const fromMap = map[f];
  const fromFile = stem.replace(/-(start|peak|main)$/, '');
  const id = (fromMap && known.has(fromMap)) ? fromMap : (known.has(fromFile) ? fromFile : fromMap);
  if (!id) { orphan.push(f); continue; }
  const variant = (stem.match(/-(start|peak|main)$/) || [, 'main'])[1];
  if (!byRow.has(id)) byRow.set(id, []);
  byRow.get(id).push({ file: f, variant, order: ORDER[variant] ?? 9 });
}
for (const v of byRow.values()) v.sort((a, b) => a.order - b.order);

const usable = [...byRow.entries()].filter(([id]) => known.has(id));
const unknownRows = [...byRow.keys()].filter((id) => !known.has(id));

console.log(`${files.length} files · ${byRow.size} rows · ${usable.length} in the catalogue · ${unknownRows.length} not · ${orphan.length} unmapped`);
if (DRY) {
  const sample = usable.slice(0, 3).map(([id, v]) => `${id}: ${v.map((x) => x.variant).join(' + ')}`);
  console.log('  e.g. ' + sample.join(' | '));
  console.log('\n--dry-run: nothing uploaded, nothing written.');
  process.exit(0);
}

let ok = 0; const failed = [];
for (const [id, variants] of usable) {
  const paths = [];
  let bad = false;
  for (const v of variants) {
    const body = readFileSync(join(DIR, v.file));
    const path = `${PREFIX}/${v.file}`;
    const { error } = await db.storage.from(BUCKET).upload(path, body, { contentType: 'image/webp', upsert: true });
    if (error) { failed.push(`${v.file}: ${error.message}`); bad = true; break; }
    paths.push(path);
  }
  if (bad) continue;
  // Written only after every variant for the row is up. A half-written array is
  // a movement whose peak position is missing, which cross-fades to nothing.
  const { error: wErr } = await db.from('exercises').update({ image_paths: paths }).eq('id', id);
  if (wErr) { failed.push(`${id}: uploaded but not linked — ${wErr.message}`); continue; }
  ok++;
  if (ok % 100 === 0) console.log(`  ${ok}/${usable.length}`);
}
console.log(`\nlinked ${ok}/${usable.length} rows`);
if (failed.length) {
  console.error(`${failed.length} failed:`);
  for (const f of failed.slice(0, 8)) console.error('  ' + f);
  process.exit(1);
}
