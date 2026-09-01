// Move a bought RepDB pack's media into our bucket, and be safe to run again.
//
//   node scripts/sync-exercise-demos.mjs --pack ~/Downloads/repdb-bundle-standard
//   node scripts/sync-exercise-demos.mjs --pack ~/Downloads/repdb-bundle-standard --upload
//   node scripts/sync-exercise-demos.mjs --pack ~/Downloads/repdb-bundle-standard --animations .demos-12fps --upload
//
// Data: RepDB (https://repdb.co)
//
// ── Why this exists next to import-repdb.mjs ──────────────────────────────
//
// import-repdb.mjs answers "what would change", stages the SQL, and can push
// the bytes in one straight loop. That loop is fine for a first run and wrong
// for every run after it: it re-reads and re-uploads all 1545 objects with
// upsert every time, one at a time, so an interrupted 1.7 GB transfer has to be
// started from the beginning and a routine re-check costs the same as the
// original upload. On a laptop connection that is the difference between forty
// seconds and most of an hour, and the expensive half is paid by somebody who
// only wanted to know whether anything was missing.
//
// So this asks the bucket what it already holds and uploads only the gap. That
// makes resumption free rather than a feature: kill it at object 900 and the
// next run picks up 645 objects later, because the first 900 are now present.
//
// ── Present is decided by NAME, and deliberately not by size ──────────────
//
// The clips in the bucket are NOT the clips in the pack. scripts/transcode-
// demos.mjs halves their frame rate before they go up — 1.69 GB of pack becomes
// 847 MB in storage with no loss of resolution — so every animation in the
// bucket is about half the size of its source and always will be.
//
// A sync that compared sizes would read all 483 of those as corrupt and
// helpfully "repair" them back to the raw originals: 847 MB of deliberate work
// undone, the bucket doubled, and every client on a phone paying twice the data
// for the same diagram. Comparing names cannot make that mistake. `--replace`
// exists for the case where somebody genuinely means it, and says so.
//
// ── The licence is read off the pack, never passed as a flag ──────────────
//
// Same rule as the importer, for the same reason: RepDB's three archives look
// identical from the outside and one of them is CC BY-NC. A --pack argument
// left pointing at the wrong folder in Downloads is the realistic way an
// evaluation asset reaches a product that sells memberships, so the tier comes
// from the LICENSE.md that travels with the files and an unreadable one is
// refused. This script only moves bytes — it writes no rows, so it stamps no
// demo_licence; import-repdb.mjs --write does that, from the same reading.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { packTier, tierMayShip, planRow, slug } from '../src/lib/repdbImport.ts';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const PACK = flag('pack');
const STYLE = flag('style', 'classic');
// Where the animation BYTES come from, which is not necessarily the pack. The
// thinned copy transcode-demos.mjs writes is what belongs in the bucket; the
// pack is still needed for the licence and the mapping either way.
const ANIM_DIR = flag('animations');
const UPLOAD = has('upload');
const REPLACE = has('replace');
const CONCURRENCY = Math.max(1, Math.min(8, Number(flag('concurrency', 4))));
// The bucket every other piece of catalogue media already uses. Private: the
// licence forbids making the image catalog available in bulk, so nothing here
// is ever fetchable without a signature. See src/ui/signedMedia.ts.
const BUCKET = 'exercise-demos';

if (!PACK) {
  console.error('usage: node scripts/sync-exercise-demos.mjs --pack <dir> [--animations <dir>]');
  console.error('               [--style classic|flat] [--concurrency 4] [--upload] [--replace]');
  console.error('  Default is a plan: it reports the gap between the pack and the bucket and moves nothing.');
  process.exit(1);
}
if (!existsSync(PACK)) { console.error(`sync-exercise-demos: no such pack directory: ${PACK}`); process.exit(1); }
if (STYLE !== 'classic' && STYLE !== 'flat') {
  console.error(`sync-exercise-demos: --style must be classic or flat, got "${STYLE}".`);
  process.exit(1);
}

// ── 1 · the licence ────────────────────────────────────────────────────────
const licPath = join(PACK, 'LICENSE.md');
if (!existsSync(licPath)) {
  console.error(`${PACK} has no LICENSE.md. Refusing to move assets whose terms cannot be read.`);
  process.exit(1);
}
const tier = packTier(readFileSync(licPath, 'utf8'));
console.log(`pack:    ${PACK}`);
console.log(`licence: ${tier}${tierMayShip(tier) ? ' — commercial use inside the product is permitted' : ' — NOT shippable'}`);
if (!tierMayShip(tier)) {
  // Refused even for a plan. The bucket exists for content the app may ship,
  // and putting an evaluation asset in it is the first step of forgetting which
  // is which — src/lib/exerciseMedia.ts says the same thing at render time.
  console.error(
    `\nRefusing: this pack is "${tier}", and ${BUCKET} holds content the app is licensed to ship.\n`
    + '  Evaluation assets are served from EVAL_DEMO_BASE on the machine judging the pack\n'
    + '  and never enter our storage at all.',
  );
  process.exit(1);
}

// ── 2 · the catalogue and the bucket, both read before anything is planned ─
const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  // Demanded even for a plan: the whole point of the plan is the GAP, and a gap
  // computed without asking the catalogue and the bucket is just the pack's own
  // file count dressed up as an answer.
  console.error('\nsync-exercise-demos: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  console.error('  Dashboard ▸ Project Settings ▸ API ▸ service_role. Do not commit it.');
  process.exit(1);
}
const { createClient } = await import('@supabase/supabase-js');
const db = createClient(url, key, { auth: { persistSession: false } });

// The LIVE rows, not the seed. import-repdb.mjs deliberately parses the seed so
// that a dry run needs no credentials; this script needs them anyway to see the
// bucket, and the live table is the only thing that can answer the question
// that actually decides an upload — "does this row already have a clip".
const { data: catalogue, error: cErr } = await db.from('exercises').select('id, animation_path');
if (cErr) { console.error(`sync-exercise-demos: could not read the catalogue — ${cErr.message}`); process.exit(1); }
if (!catalogue.length) {
  // Zero rows under a service key is a broken read, not an empty catalogue, and
  // treating it as empty would plan every object as new.
  console.error('sync-exercise-demos: the catalogue came back empty under a service key. Refusing to plan against nothing.');
  process.exit(1);
}
const rowIds = new Set(catalogue.map((r) => r.id));
const animNow = new Map(catalogue.map((r) => [r.id, r.animation_path]));

/** Every object under one prefix. list() caps at 1000 and returns no total, so
 *  a single call silently truncates — which would report 545 objects as absent
 *  and re-upload every one of them. */
async function listAll(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`listing ${prefix || '<root>'}: ${error.message}`);
    for (const o of data) if (o.id) out.push(prefix ? `${prefix}/${o.name}` : o.name);
    if (data.length < 1000) return out;
  }
}

const present = new Set();
for (const prefix of ['', 'stills', 'equipment', 'muscles']) {
  for (const k of await listAll(prefix)) present.add(k);
}

// ── 3 · what the pack wants in the bucket ─────────────────────────────────
const dataFile = join(PACK, 'exercises.json');
if (!existsSync(dataFile)) { console.error(`${PACK} has no exercises.json.`); process.exit(1); }
const records = JSON.parse(readFileSync(dataFile, 'utf8')).exercises || [];
if (!records.length) { console.error(`${dataFile} carries no exercises.`); process.exit(1); }

// ── Which of OUR rows a pack record belongs to ────────────────────────────
//
// An animation object is named after the row it serves, so getting the row
// wrong does not fail — it puts bytes in the bucket under a name nothing points
// at, and no client is ever signed a URL for them. Uploaded, paid for, inert.
// Three rules, in order, and every one of them is checked against the live
// catalogue rather than assumed:
//
//   1. data/repdb-superseded.json — the fifteen movements our own catalogue
//      supersedes, where the RepDB twin has been deleted. "Barbell Back Squat"
//      is `back-squat` here and `squat` there; "Crunches" is `ab-crunch`.
//      build-demo-map.mjs applies the same file, and it lives in data/ so it
//      reads as a list of decisions rather than as JavaScript.
//
//   2. the vendor id, WHEN it names a row we have and the name slug does not.
//      Eleven rows arrived from the free package under RepDB's own id and the
//      paid bundle renamed the movement — `bench-press` here is "Barbell Bench
//      Press" there. upload-exercise-stills.mjs already resolves this pair the
//      same way round, for the same eleven.
//
//   3. the slug of the displayed name, which is the ordinary case and the one
//      every screen in the app resolves through.
//
// Verified, not guessed: a rule only fires if the id it produces is actually in
// the catalogue. That is what turns those eleven from a manual review into an
// exact match, and it costs nothing when the ordinary rule is right.
const superseded = JSON.parse(readFileSync(join(process.cwd(), 'data/repdb-superseded.json'), 'utf8'));
const oursFor = new Map(
  Object.entries(superseded.ours_wins || {}).map(([ours, v]) => [typeof v === 'string' ? v : v.repdb_id, ours]),
);
const unresolved = [];
function rowFor(rec, nameId) {
  const sup = oursFor.get(rec.id);
  if (sup && rowIds.has(sup)) return sup;
  if (rowIds.has(nameId)) return nameId;
  const vendor = slug(rec.id);
  if (rowIds.has(vendor)) return vendor;
  return null;
}

// bucket key → absolute source file. A Map, so twelve movements that borrow
// another's artwork through image_alias resolve to one object rather than to
// the same bytes uploaded twice.
const moves = new Map();
const missing = [];
let linkedAlready = 0;
// Every key the pack accounts for, whether it needs uploading or is already
// linked and in place. Kept apart from `moves` so the "nothing names this"
// report stays true: without it the 483 clips that rows already play would each
// be listed as an object nobody asked for.
const accounted = new Set();
const animSrcDir = ANIM_DIR || join(PACK, 'images', 'animations');
let planned = 0;
for (const rec of records) {
  const p = planRow(rec, STYLE);
  if (!p) continue;
  planned++;
  // The row this pack's record actually belongs to in OUR catalogue.
  const rowId = rowFor(rec, p.id);
  if (!rowId) { unresolved.push(`${rec.id} ("${rec.name_en}")`); continue; }
  for (const s of p.stills) {
    const abs = join(PACK, s);
    // Confirmed on disk, never trusted from the JSON — a key uploaded for a
    // file that is not there is a signed URL to nothing, which the client reads
    // as a broken app rather than as a gap.
    if (!existsSync(abs)) { missing.push(`${rowId}: ${s}`); continue; }
    moves.set(`stills/${basename(s)}`, abs);
  }
  if (p.animation) {
    // ── A row that already plays a clip is finished ──────────────────────
    //
    // Not "an object under this row's own name exists" — "this row points at an
    // object that exists". Six movements borrow a neighbour's artwork through
    // image_alias and the bucket stores it once, under one of the two names, so
    // Overhead Press legitimately plays `paused-overhead-press.webp`. Testing
    // for the tidier name instead would call six working rows a gap, upload a
    // second copy of bytes already in the bucket, and only stop being inert
    // once somebody re-linked rows that were never broken.
    const linked = animNow.get(rowId);
    if (linked && present.has(linked)) { linkedAlready++; accounted.add(linked); continue; }
    // The pack path names the folder; the BYTES may come from --animations.
    // Same filename either way, because transcode-demos.mjs writes its output
    // under the source's own name.
    const abs = join(animSrcDir, basename(p.animation));
    if (!existsSync(abs)) { missing.push(`${rowId}: ${basename(p.animation)}`); continue; }
    // Keyed by the ROW id at the bucket root — the shape the objects in the
    // bucket already have and the one signedMedia.ts recognises without a
    // prefix. Not the pack's filename: that would put 483 objects under names
    // no row points at.
    moves.set(`${rowId}${p.animation.slice(p.animation.lastIndexOf('.'))}`, abs);
  }
}
// Equipment icons and muscle diagrams are catalogue-wide rather than per-row.
for (const sub of ['equipment', 'muscles']) {
  const dir = join(PACK, 'images', sub);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) moves.set(`${sub}/${f}`, join(dir, f));
}

if (!moves.size) { console.error('sync-exercise-demos: the pack resolved to no files at all.'); process.exit(1); }

for (const k of moves.keys()) accounted.add(k);
const todo = [...moves].filter(([k]) => REPLACE || !present.has(k));
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
let bytes = 0;
for (const [, src] of todo) bytes += statSync(src).size;

console.log(`records: ${planned}  ·  style: ${STYLE}  ·  animations from: ${animSrcDir}`);
console.log('');
console.log('── the gap ─────────────────────────────────────────────');
console.log(`  ${moves.size} objects the pack wants in ${BUCKET}`);
console.log(`  ${moves.size - todo.length} already there${REPLACE ? ' (ignored — --replace)' : ' — skipped'}`);
console.log(`  ${linkedAlready} row(s) already play a clip the bucket holds — not re-uploaded under a tidier name`);
console.log(`  ${todo.length} to upload, ${mb(bytes)}`);
if (unresolved.length) {
  // Named rather than counted. A record that resolves to no row is media with
  // nowhere to go, and the answer is a catalogue decision — supersede it, or
  // add the row — not something this script can pick.
  console.log(`  ${unresolved.length} pack record(s) match no row in our catalogue, so their media has nowhere to go:`);
  for (const u of unresolved.slice(0, 8)) console.log(`      ${u}`);
}
if (missing.length) {
  console.log(`  ${missing.length} named in the JSON with no file on disk — these get no key and no row:`);
  for (const m of missing.slice(0, 8)) console.log(`      ${m}`);
}
// Objects in the bucket that this pack does not account for. Reported, never
// deleted: the catalogue carries rows we added ourselves, and a sync that
// tidied away everything it did not recognise would take those with it.
const extra = [...present].filter((k) => !accounted.has(k));
if (extra.length) {
  console.log(`  ${extra.length} object(s) in the bucket this pack does not name (left alone):`);
  for (const e of extra.slice(0, 5)) console.log(`      ${e}`);
}

if (!todo.length) {
  console.log('\nnothing to do — the bucket already holds every object this pack names.');
  process.exit(0);
}
if (!UPLOAD) {
  console.log('\ndefault is a plan: nothing uploaded. Re-run with --upload to move the bytes.');
  process.exit(0);
}

// ── 4 · move the bytes ────────────────────────────────────────────────────
//
// A few at a time rather than all at once. One at a time wastes the connection
// on round trips; all 1545 at once means 1.7 GB of file bodies resident in
// memory and a provider that starts refusing. Four is enough to keep a laptop
// uplink busy and small enough that a failure costs four retries, not 1545.
const TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const contentType = (f) => TYPES[f.slice(f.lastIndexOf('.')).toLowerCase()] || 'application/octet-stream';

console.log(`\nuploading ${todo.length} objects (${mb(bytes)}) to ${BUCKET}, ${CONCURRENCY} at a time…`);
const started = Date.now();
let done = 0, sent = 0;
const failed = [];
let next = 0;

async function worker() {
  for (;;) {
    const i = next++;
    if (i >= todo.length) return;
    const [k, src] = todo[i];
    try {
      const body = readFileSync(src);
      // upsert only under --replace. Without it an object that appeared since
      // the listing is a conflict rather than a silent overwrite, which is the
      // behaviour worth having when two people run this at once.
      const { error } = await db.storage.from(BUCKET).upload(k, body, { contentType: contentType(src), upsert: REPLACE });
      if (error) { failed.push(`${k}: ${error.message}`); continue; }
      sent += body.length;
    } catch (e) {
      failed.push(`${k}: ${String(e?.message || e)}`);
      continue;
    }
    // Progress on the BYTES, not on the file count. The objects range from
    // 30 KB to 11 MB, so "900/1545" moves smoothly while the transfer does not,
    // and somebody watching cannot tell a stall from a big clip.
    if (++done % 25 === 0 || done === todo.length) {
      const secs = (Date.now() - started) / 1000;
      const rate = sent / secs;
      const left = rate > 0 ? Math.round((bytes - sent) / rate) : 0;
      console.log(`  ${done}/${todo.length} · ${mb(sent)} of ${mb(bytes)} · ${(rate / 1024 / 1024).toFixed(1)} MB/s · ~${left}s left`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nuploaded ${done - failed.length}/${todo.length} objects, ${mb(sent)}`);
if (failed.length) {
  console.error(`${failed.length} failed:`);
  for (const f of failed.slice(0, 8)) console.error('  ' + f);
  // Re-running is the fix, and it is cheap: everything that landed is now
  // present and will be skipped, so a second run retries only these.
  console.error('\nRe-run the same command — the objects that landed are skipped, so only these are retried.');
  process.exit(1);
}
console.log('\nBytes only. Rows still point at whatever they pointed at before —');
console.log('run `node scripts/import-repdb.mjs --pack <dir> --write` to link them.');
