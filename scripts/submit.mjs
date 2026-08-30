#!/usr/bin/env node
// Submit the build the profile MEANS, and prove it before uploading.
//
// ── The trap ──────────────────────────────────────────────────────────────
//
// `eas submit --profile production --latest` reads as "submit the newest
// production build". It does not: --latest picks the newest build for the
// PLATFORM, and --profile only decides which App Store Connect app to aim at.
// One repo builds three apps here, so the newest iOS build is very often not
// the one the profile means.
//
// On 27 Aug 2026 the newest was Repple Studio, and two submits — one aimed at
// the client, one at the coach — both picked up the Studio binary. What saved
// it was Apple routing an upload by the binary's own bundle identifier rather
// than the ascAppId passed with it: all three landed in Repple Studio and the
// duplicates bounced as ITMS-90189. Nothing wrong reached a tester. The real
// cost was that the coach's actual build was never submitted while everyone
// believed it had been.
//
// docs/LAUNCH-CHECKLIST.md item 7 is the process answer: look up the build id
// by hand, read the bundle identifier EAS prints, check it against a table.
// This is the same three steps with a machine doing the reading, because the
// step that failed was a person remembering to.
//
//   node scripts/submit.mjs --profile production-coach --platform ios
//   node scripts/submit.mjs --profile production --platform android --dry-run
//
// It refuses rather than guesses: an unknown profile, a profile whose newest
// finished build carries the wrong identifier, or no finished build at all.
import { execFileSync } from 'node:child_process';

/** The identity each submit profile is allowed to upload. Both platforms use
 *  the same string — app.config.ts sets iOS bundleIdentifier and Android
 *  package from one value, so a mismatch here IS the bug this catches. */
const IDENTITY = {
  'production':       { id: 'com.washateria.repple',        name: 'Repple' },
  'production-coach': { id: 'com.washateria.repple.coach',  name: 'Repple Coach' },
  'production-owner': { id: 'com.washateria.repple.studio', name: 'Repple Studio' },
};

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(`--${n}`);

const profile = flag('profile');
const platform = flag('platform');
const dry = has('dry-run');

if (args.includes('--latest')) {
  console.error(
    '--latest is refused here, and that is the whole point of this script.\n'
    + 'It picks the newest build for the PLATFORM, not for the profile, and this\n'
    + 'repo builds three apps. See docs/LAUNCH-CHECKLIST.md item 7.',
  );
  process.exit(1);
}
if (!profile || !Object.prototype.hasOwnProperty.call(IDENTITY, profile)) {
  console.error(`--profile must be one of: ${Object.keys(IDENTITY).join(', ')}`);
  process.exit(1);
}
if (platform !== 'ios' && platform !== 'android') {
  console.error('--platform must be ios or android');
  process.exit(1);
}

const want = IDENTITY[profile];

let builds;
try {
  const out = execFileSync('npx', [
    'eas', 'build:list', '--json', '--non-interactive',
    '--platform', platform, '--buildProfile', profile, '--status', 'finished', '--limit', '5',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  builds = JSON.parse(out.slice(out.indexOf('[')));
} catch (e) {
  console.error('could not list builds:', e.message);
  process.exit(1);
}

const build = builds[0];
if (!build) {
  console.error(`No finished ${platform} build for profile "${profile}". Build one first.`);
  process.exit(1);
}

// The assertion the checklist asks a person to make by eye. A build whose
// identifier does not match the profile is the 27 Aug failure exactly, and
// submitting it would put one app's binary in another app's listing.
if (build.appIdentifier !== want.id) {
  console.error(
    `REFUSED. The newest finished ${platform} build for "${profile}" is ${build.appIdentifier},\n`
    + `but that profile submits ${want.id} (${want.name}).\n`
    + 'Something is wrong with the build config — this is the mix-up of 27 Aug 2026.',
  );
  process.exit(1);
}

console.log(
  `${want.name}\n`
  + `  profile     ${profile}\n`
  + `  platform    ${platform}\n`
  + `  identifier  ${build.appIdentifier}\n`
  + `  version     ${build.appVersion} (build ${build.appBuildVersion})\n`
  + `  built       ${(build.completedAt || '').slice(0, 16).replace('T', ' ')}\n`
  + `  commit      ${(build.gitCommitHash || '').slice(0, 8)} ${(build.gitCommitMessage || '').split('\n')[0]}\n`
  + `  build id    ${build.id}`,
);

if (dry) { console.log('\n--dry-run: nothing submitted.'); process.exit(0); }

execFileSync('npx', [
  'eas', 'submit', '--platform', platform, '--profile', profile, '--id', build.id, '--non-interactive',
], { stdio: 'inherit' });
