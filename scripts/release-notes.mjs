#!/usr/bin/env node
// Print the release notes for one app, for pasting into App Store Connect's
// "What to Test" or Play's release notes.
//
// The notes live in src/lib/releaseNotes.ts, which the apps also read for their
// own What's New sheet. One source, so a change described to a tester is the
// same change described in the app — they drifted before because each was
// typed by hand at a different moment.
//
//   node scripts/release-notes.mjs client
//   node scripts/release-notes.mjs trainer 1.1.0
//   node scripts/release-notes.mjs --all
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APPS = { client: 'Repple', trainer: 'Repple Coach', owner: 'Repple Studio' };

const args = process.argv.slice(2);
const all = args.includes('--all');
const audience = args.find((a) => Object.keys(APPS).includes(a));
const wantedVersion = args.find((a) => /^\d+\.\d+/.test(a));

if (!all && !audience) {
  console.error('usage: release-notes.mjs <client|trainer|owner> [version]   |   --all');
  process.exit(1);
}

// The notes module imports ./variant for MY_AUDIENCE, which reaches into
// expo-constants and cannot load under plain node. Compile just the pieces we
// need by stripping that import and the one constant that uses it.
const src = readFileSync('src/lib/releaseNotes.ts', 'utf8')
  .replace(/^import .*from '\.\/variant';$/m, '')
  .replace(/export const MY_AUDIENCE[\s\S]*$/m, '')
  // Audience is an alias for the variant type we just removed the import for.
  // Substituted, not deleted — the rest of the file refers to it throughout.
  .replace(/^export type Audience.*$/m, "export type Audience = 'client' | 'trainer' | 'owner';");

const dir = mkdtempSync(join(tmpdir(), 'relnotes-'));
try {
  writeFileSync(join(dir, 'notes.ts'), src);
  // Run tsc FROM the temp directory: naming files on the command line makes it
  // refuse to load a tsconfig (TS5112), and the repo's own config would be
  // found by walking up from the repo root.
  try {
    execFileSync(process.execPath, [
      join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc'),
      'notes.ts', '--target', 'es2020', '--module', 'es2020',
    ], { stdio: 'pipe', cwd: dir });
  } catch (e) {
    // execFileSync stringifies stdout as a byte array in its message, which is
    // unreadable. tsc reports on stdout.
    console.error('could not compile the notes:\n' + (e.stdout?.toString() || e.message));
    process.exit(1);
  }
  const mod = await import('file://' + join(dir, 'notes.js'));

  const version = wantedVersion || JSON.parse(readFileSync('app.json', 'utf8')).expo.version;
  const targets = all ? Object.keys(APPS) : [audience];

  for (const a of targets) {
    const text = mod.storeNotes(a, version);
    if (targets.length > 1) console.log(`\n${'═'.repeat(66)}\n${APPS[a]} — ${version}\n${'═'.repeat(66)}`);
    if (!text) {
      console.log(`(no notes for ${APPS[a]} at ${version})`);
      continue;
    }
    console.log(text);
    // App Store Connect's What to Test caps at 4000 characters. Say so here
    // rather than letting it truncate in the paste.
    if (text.length > 4000) console.error(`\n! ${APPS[a]}: ${text.length} characters — App Store Connect caps What to Test at 4000.`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
