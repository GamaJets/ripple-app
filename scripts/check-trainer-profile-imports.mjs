// The coach-profile provider must not be reachable from the apps it cannot answer for.
//
// ── The bug this exists to prevent ─────────────────────────────────────────
//
// `useMyTrainerProfile` (once `useCoachProfile`) calls auth.getUser() and loads
// THAT user's own `profiles` and `trainers` rows. On the coach app that is the
// coach and it is right. It is also importable from anywhere, and on the client
// app the signed-in user is the CLIENT — so it silently returned the reader.
//
// That shipped, and by the time it was found it had reached four client screens
// at once: a thread headed with the reader's own name under "Your coach", their
// own face drawn as their coach's avatar, their own name written into an ICS
// export that lands permanently in their real calendar, and their own name
// interpolated into a push notification DELIVERED TO OTHER PEOPLE. Alongside it
// `sessionFee` sat at its initial 0 forever, because a client has no row in
// `trainers` — so the app quoted "Session rate $0" and warned of a "$0 late
// fee" on the screen where somebody decides whether cancelling will cost them.
//
// Every one of those is fixed, and the provider now refuses to answer off the
// coach build. This script is the part that stops the NEXT person finding the
// hook, reading its name, and reasonably assuming it names a client's coach.
//
// To name a client's coach, use `useThreadPeerName` (src/lib/threadPeer.ts),
// which resolves it through `my_coach()` — supabase/parts/67.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/lib', 'studio-web/components'];
const SELF = 'src/ui/coachProfile.tsx';

// The single legitimate importer of the provider: it mounts it for the app that
// is allowed to read it. Everything else is a finding.
const PROVIDER_ALLOWED = ['app/_layout.tsx'];

// The names that were deprecated and then deleted. Listed so that a file
// reintroducing one gets the explanation rather than a bare module error.
const GONE = ['useCoachProfile', 'CoachProfileProvider'];

// Builds where the hook can only ever describe the reader.
const CANNOT_ANSWER = ['app/(client)/', 'app/(owner)/', 'studio-web/'];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(join(ROOT, r))).map((f) => relative(ROOT, f));
if (files.length === 0) {
  // An empty walk means the layout moved and this check silently stopped
  // checking. That is the failure mode every guard in this repo is written to
  // avoid, so it is an error rather than a pass.
  console.error('check-trainer-profile-imports: found no files to check — the source layout must have moved.');
  process.exit(1);
}

const IMPORT = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
const offences = [];

for (const file of files) {
  if (file === SELF) continue;
  const src = readFileSync(join(ROOT, file), 'utf8');
  for (const m of src.matchAll(IMPORT)) {
    const [, clause, spec] = m;
    if (!/(^|\/)ui\/coachProfile$/.test(spec) && spec !== '@ui/coachProfile') continue;

    const line = src.slice(0, m.index).split('\n').length;
    const named = GONE.filter((n) => new RegExp(`\\b${n}\\b`).test(clause));
    if (named.length) {
      offences.push(`${file}:${line}  imports ${named.join(' and ')} — deleted. `
        + 'They load the signed-in user\'s own rows; use useMyTrainerProfile / MyTrainerProfileProvider.');
      continue;
    }
    const wrongApp = CANNOT_ANSWER.find((p) => file.startsWith(p));
    if (wrongApp) {
      offences.push(`${file}:${line}  reads the trainer profile from ${wrongApp} — `
        + 'here it can only describe the reader. To name a client\'s coach use useThreadPeerName (src/lib/threadPeer.ts).');
      continue;
    }
    if (/\bMyTrainerProfileProvider\b/.test(clause) && !PROVIDER_ALLOWED.includes(file)) {
      offences.push(`${file}:${line}  mounts MyTrainerProfileProvider — only ${PROVIDER_ALLOWED.join(', ')} may.`);
    }
  }
}

if (offences.length) {
  console.error(`${offences.length} import${offences.length === 1 ? '' : 's'} of the trainer profile that cannot be answered:\n`);
  for (const o of offences) console.error('  ' + o);
  console.error('\nThis provider describes the SIGNED-IN user. It cannot name somebody else\'s coach.');
  process.exit(1);
}

console.log(`trainer profile imports ok — ${files.length} files, none reads the signed-in user's trainer row where it could only describe the reader.`);
