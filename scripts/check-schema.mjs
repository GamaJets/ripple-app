#!/usr/bin/env node
// Does the database have the columns this app writes to?
//
// On 27 Aug 2026 no workout saved for two days, for anybody, from any app.
// `supabase/parts/46-session-duration.sql` adds `workouts.session_mins`; it was
// written, committed, generated into setup.sql, and never run. `entryToRow`
// puts that column in every insert, and PostgREST rejects the whole row for one
// unknown column. It was found by logging a workout in a simulator.
//
// Nothing in this repo could have caught it. tsc passes — the TypeScript is
// right. The assertions pass — the round-trip only checks the code agrees with
// itself. `expo export` passes — it is a runtime rejection, not a build one.
//
// This is the check that would have. It needs no secret: PostgREST answers a
// schema question with the publishable key alone, because the answer arrives
// before any row is read.
//
//     known column          401   the query was valid; RLS refused the ROWS
//     unknown column        400   with 42703 and the column's name
//     unknown table         404
//
// A 401 is therefore a PASS. That reads backwards and is the whole trick.
import { readFileSync } from 'node:fs';

/**
 * What the app writes, and would break without. Not the whole schema — the
 * columns whose absence takes a feature down silently. Add a row here when you
 * add a column the app writes to; the cost of forgetting is what this file
 * exists to describe.
 */
const EXPECTED = [
  ['workouts',        ['user_id', 'performed_at', 'exercise', 'sets', 'feel', 'cardio', 'kcal', 'zones', 'session_mins', 'logged_by', 'amended_at']],
  ['exercise_videos', ['exercise_id', 'trainer_id', 'title', 'name', 'muscle_group', 'video_path', 'visibility']],
  ['coach_exercises', ['coach_id', 'name', 'muscle_group']],
  ['trainers',        ['id', 'tenant_id', 'listed', 'join_code']],
  ['coach_requests',  ['client_id', 'trainer_id', 'mode', 'status']],
  ['program_templates', ['coach_id', 'name', 'program']],
  ['progress_photos', ['client_id', 'taken_at', 'image_path']],
  ['sessions',        ['client_id', 'starts_at', 'outcome']],
  ['gym_visits',      ['tenant_id', 'member_id', 'entered_at']],
  ['check_ins',       ['user_id', 'at']],
];

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* no .env is fine if the vars are exported */ }
  return null;
}

const url = env('EXPO_PUBLIC_SUPABASE_URL');
const key = env('EXPO_PUBLIC_SUPABASE_ANON_KEY');
if (!url || !key) {
  console.error('EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not set, so the schema was NOT checked.');
  process.exit(1);
}

const problems = [];
for (const [table, columns] of EXPECTED) {
  const q = `${url}/rest/v1/${table}?select=${columns.join(',')}&limit=1`;
  let res;
  try {
    res = await fetch(q, { headers: { apikey: key } });
  } catch (e) {
    console.error(`could not reach the database: ${e.message}`);
    process.exit(1);
  }
  // 200 and 401 both mean the STATEMENT was understood — the table is there and
  // every column named exists. 401 is simply RLS declining to hand over rows to
  // an anonymous caller, which is what it should do.
  if (res.status === 200 || res.status === 401) continue;
  if (res.status === 404) { problems.push({ table, what: 'the table does not exist' }); continue; }
  let body = '';
  try { body = await res.text(); } catch { /* the status is enough */ }
  const col = /column \S+?\.(\w+) does not exist/.exec(body);
  problems.push({
    table,
    what: col ? `has no column "${col[1]}"` : `answered ${res.status}: ${body.slice(0, 160)}`,
  });
}

if (problems.length) {
  console.error('The live database does not match what the app writes:\n');
  for (const p of problems) console.error(`  ${p.table.padEnd(20)} ${p.what}`);
  console.error('\nA part in supabase/parts/ has almost certainly not been run.');
  console.error('Being in the repo, and being in setup.sql, is not being in the database.');
  process.exit(1);
}

console.log(`schema ok — ${EXPECTED.length} tables, every column the app writes to is present.`);
