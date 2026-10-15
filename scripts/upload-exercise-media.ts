// Upload the RepDB exercise stills into our own Supabase storage. Idempotent.
//
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=…            \   # from the dashboard, never committed
//   npx tsx scripts/upload-exercise-media.ts [--dry-run]
//
// Optional env:
//   EXERCISE_MEDIA_DIR     local folder holding images/… (default ../repple-media)
//
// Target: the PRIVATE `exercise-demos` bucket (part 78: read by signed-in
// users through signed URLs; the RepDB licence forbids an open bucket). Each
// file goes in at the catalogue's own path, `images/flat/<id>-start.webp`,
// which is exactly the key src/ui/signedMedia.ts signs (`images/` prefix).
//
// What it uploads is decided by the catalogue, not by the folder: every
// `images/…` path referenced in data/repdb-exercises.json. Objects already in
// the bucket are skipped (listed first, and a 409 on upload is also "already
// there"), so a re-run uploads only what is missing and never overwrites.
// A missing local file is reported and fails the run; it is never skipped
// silently.
//
// The service key is read from the environment only and never printed.
// storage-js directly, not supabase-js: the full client also builds a realtime
// socket, which Node 20 cannot open without a WebSocket polyfill. Storage is
// all this needs. (It ships with supabase-js; no new dependency.)
import { StorageClient } from '@supabase/storage-js';
import { readFileSync, existsSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';

const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const bucket = 'exercise-demos';
const root = resolve(process.env.EXERCISE_MEDIA_DIR?.trim() || join(__dirname, '..', '..', 'repple-media'));
const dryRun = process.argv.includes('--dry-run');
const CONCURRENCY = 8;

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

function wantedPaths(): string[] {
  const data = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'repdb-exercises.json'), 'utf8'));
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (/^images\/[\w-]+\/[\w-]+\.(webp|png|jpe?g)$/i.test(v)) out.add(v);
    } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(data);
  return [...out].sort();
}

async function main(): Promise<void> {
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
    process.exit(2);
  }
  const storage = new StorageClient(`${url.replace(/\/+$/, '')}/storage/v1`, { apikey: key, Authorization: `Bearer ${key}` });

  const { data: b, error: be } = await storage.getBucket(bucket);
  if (be || !b) {
    console.error(`Bucket "${bucket}" not found (${be?.message ?? 'no answer'}). Apply its migration first.`);
    process.exit(2);
  }
  if (b.public) {
    console.error(`"${bucket}" is PUBLIC. The RepDB licence forbids an open bucket; make it private (part 78) before uploading.`);
    process.exit(2);
  }

  const wanted = wantedPaths();
  const missingLocal = wanted.filter((p) => !existsSync(join(root, p)));
  if (missingLocal.length) {
    console.error(`${missingLocal.length} referenced file(s) are not in ${root}, e.g. ${missingLocal.slice(0, 3).join(', ')}`);
    process.exit(1);
  }

  // What is already there, folder by folder, paged.
  const present = new Set<string>();
  for (const folder of [...new Set(wanted.map((p) => posix.dirname(p)))]) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.from(bucket).list(folder, { limit: 1000, offset });
      if (error) { console.error(`Could not list ${folder}: ${error.message}`); process.exit(1); }
      for (const o of data ?? []) present.add(`${folder}/${o.name}`);
      if (!data || data.length < 1000) break;
    }
  }

  const todo = wanted.filter((p) => !present.has(p));
  console.log(`${wanted.length} referenced · ${wanted.length - todo.length} already in "${bucket}" · ${todo.length} to upload${dryRun ? ' (dry run)' : ''}`);
  if (dryRun || !todo.length) return;

  let done = 0; let skipped = 0; const failed: string[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const p = todo[next++];
      const ext = p.split('.').pop()!.toLowerCase();
      const { error } = await storage.from(bucket).upload(p, readFileSync(join(root, p)), {
        contentType: TYPES[ext] ?? 'application/octet-stream',
        cacheControl: '31536000',
        upsert: false,
      });
      if (!error) done++;
      else if (/exists|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`)) skipped++;
      else failed.push(`${p}: ${error.message}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`uploaded ${done} · already there ${skipped} · failed ${failed.length}`);
  if (failed.length) { failed.slice(0, 20).forEach((f) => console.error('  ' + f)); process.exit(1); }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
