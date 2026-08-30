// Which catalogue row each file in a bought pack belongs to.
//
// The pack names its files by RepDB's OWN ids — squat.webp, ohp.webp,
// incline-db-curl.webp — while our catalogue is keyed by the slug of the name
// a client reads: barbell-back-squat, barbell-overhead-press,
// incline-dumbbell-curl. Matching filenames to rows directly finds almost
// nothing.
//
// The bundle's own exercises.json carries both, so the mapping is a lookup and
// never a guess: file name → that record → slug(name_en) → our row. Two
// adjustments on top:
//
//   · `image_alias`, which the README says to build media filenames from when
//     present. A pack where two exercises share artwork names both files after
//     the alias, and ignoring it silently drops the second one.
//   · the fifteen movements our own catalogue supersedes, whose RepDB twin has
//     been deleted — their media belongs on OUR row, not on a row that no
//     longer exists.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const BUNDLE = flag('bundle');
const DIR = flag('dir');
const OUT = flag('out', 'data/demo-map.json');
if (!BUNDLE || !DIR) { console.error('usage: --bundle <bundle dir> --dir <asset dir> [--out <file>]'); process.exit(1); }

/** Mirrors exerciseSlug() in src/lib/exerciseId.ts. */
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '-');

const raw = JSON.parse(readFileSync(join(BUNDLE, 'exercises.json'), 'utf8'));
const recs = Array.isArray(raw) ? raw : (raw.exercises || Object.values(raw));

// A file may be named after the id OR after image_alias; index both.
const byFileKey = new Map();
for (const r of recs) {
  byFileKey.set(r.id, r);
  if (r.image_alias) byFileKey.set(r.image_alias, r);
}

const sup = JSON.parse(readFileSync(join(process.cwd(), 'data/repdb-superseded.json'), 'utf8'));
const theirsToOurs = new Map(
  Object.entries(sup.ours_wins || {}).map(([ours, v]) => [typeof v === 'string' ? v : v.repdb_id, ours]),
);

const files = readdirSync(DIR).filter((f) => /\.(webp|mp4|gif|json)$/i.test(f));
const map = {}; const unmatched = [];
for (const f of files) {
  // Stills carry a variant suffix the record id does not: air-bike-main.webp,
  // arnold-press-start.webp, arnold-press-peak.webp. Animations do not.
  // Strip a KNOWN suffix only — trimming anything after the last hyphen would
  // turn 'bench-press' into 'bench' and quietly mis-file it.
  const stem = basename(f, extname(f));
  const key = stem.replace(/-(start|peak|main)$/, '');
  const rec = byFileKey.get(key) || byFileKey.get(stem);
  if (!rec) { unmatched.push(f); continue; }
  // Our own row wins wherever it supersedes the RepDB one.
  map[f] = theirsToOurs.get(rec.id) ?? slug(rec.name_en);
}

writeFileSync(OUT, JSON.stringify(map, null, 0));
console.log(`${files.length} files · ${Object.keys(map).length} mapped · ${unmatched.length} unmatched`);
if (unmatched.length) for (const u of unmatched.slice(0, 10)) console.log('   unmatched: ' + u);
console.log(`  → ${OUT}`);
