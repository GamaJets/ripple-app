#!/usr/bin/env node
// A changelog two versions ahead of anything that was ever built.
//
// ── what this cost ────────────────────────────────────────────────────────
//
// Release notes were written for 1.2.0 on 31 August and 1.3.0 on 2 September.
// `app.json`'s version was never moved off 1.1.0. Nothing enforced the two,
// so for six days every app said both at once: the What's New sheet opened
// announcing "Version 1.3.0", and Profile › Build — four taps away — said
// "App version 1.1.0". Reported from all four installs: coach on Android,
// coach on iOS, client on Android, client on iOS. The same file, the same
// contradiction, four times.
//
// Two things follow from the drift, and the second is the expensive one:
//
//   No 1.2.0 or 1.3.0 binary ever existed. Not in TestFlight, not on Play,
//   not on a phone. Everything since 27 August shipped as OTA JavaScript, so
//   the notes described work that was genuinely delivered under a version
//   number that had never been minted.
//
//   `runtimeVersion` follows `appVersion`. An OTA update is only offered to
//   installs whose runtime matches, so the version in app.json is not a label
//   — it is the address every update is delivered to. Bumping it strands every
//   existing install until its owner takes a new binary. That is a real cost,
//   paid deliberately or not at all, and it is not something to discover from
//   a changelog line somebody wrote at two in the morning.
//
// ── why a gate ────────────────────────────────────────────────────────────
//
// Because writing the note is the fun part and bumping the version is not,
// and the drift is silent in both directions: nothing failed to build, no
// test went red, and the only witness was a member comparing two screens.
// scripts/release-notes.mjs already ASSUMES they match — line 60 defaults the
// store text's version to app.json's — so a drifted pair also prints the
// wrong "What to Test" into TestFlight.
//
// Three rules, all of them about the same thing: the newest note describes
// the version the app actually is.
import { readFileSync } from 'node:fs';

const errors = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); };

const NOTES = 'src/lib/releaseNotes.ts';
const src = readFileSync(NOTES, 'utf8');
const app = JSON.parse(readFileSync('app.json', 'utf8'));
const appVersion = app?.expo?.version;

ok(typeof appVersion === 'string' && appVersion.length > 0,
  'app.json has no expo.version, which is the one thing this gate compares against.');

// The entries of RELEASES, in file order. Anchored at the two-level indent the
// array's own objects sit at, so a `version:` inside a nested type or a comment
// example cannot be mistaken for a release.
const releases = [];
const re = /^ {4}version: '([^']*)',\n {4}date: '([^']*)',/gm;
for (let m; (m = re.exec(src)) !== null; ) releases.push({ version: m[1], date: m[2] });

ok(releases.length > 0,
  `no releases parsed out of ${NOTES}. Either the file is empty or its shape has moved and this gate can no longer read it — which is worse than a drifted version, because it fails open.`);

const SEMVER = /^\d+\.\d+\.\d+$/;
const parts = (v) => v.split('.').map(Number);
const older = (a, b) => {          // is a strictly older than b?
  const [x, y, z] = parts(a), [p, q, r] = parts(b);
  return x !== p ? x < p : y !== q ? y < q : z < r;
};

for (const r of releases) {
  ok(SEMVER.test(r.version), `release version '${r.version}' is not x.y.z. app.json's version is what iOS shows as CFBundleShortVersionString and what runtimeVersion is derived from; anything it cannot be is not a version.`);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(r.date), `release ${r.version} has date '${r.date}', which is not YYYY-MM-DD.`);
}

// ── rule 1: the newest note IS the app ────────────────────────────────────
const newest = releases[0];
if (newest && appVersion) {
  ok(newest.version === appVersion,
    `the newest release note says ${newest.version}; app.json says ${appVersion}.\n` +
    `    CURRENT_RELEASE is read straight off RELEASES[0], so the What's New sheet will\n` +
    `    announce "Version ${newest.version}" to somebody whose Build screen says "App version\n` +
    `    ${appVersion}". One of the two is a lie and the app is telling both.\n` +
    `      • the notes are right → bump app.json to ${newest.version} and BUILD. Note that\n` +
    `        runtimeVersion follows appVersion, so every install on ${appVersion} stops\n` +
    `        receiving OTA updates until it takes the new binary. That is the decision.\n` +
    `      • the version is right → the work shipped as OTA under ${appVersion}; fold the\n` +
    `        newer entries into the ${appVersion} release rather than minting a number.`);
}

// ── rule 2: newest first, and strictly ────────────────────────────────────
// The file's own house rule. unseenReleases walks this array in order to decide
// what somebody has missed, so an out-of-order entry is not cosmetic — it is a
// release that is silently never shown, or one shown to everybody forever.
for (let i = 1; i < releases.length; i++) {
  const prev = releases[i - 1], cur = releases[i];
  if (!SEMVER.test(prev.version) || !SEMVER.test(cur.version)) continue;
  ok(older(cur.version, prev.version),
    `RELEASES is not newest-first at index ${i}: ${prev.version} is followed by ${cur.version}. ` +
    `unseenReleases reads this array in order to work out what a reader has missed, so an entry ` +
    `out of place is a release nobody is ever shown.`);
}

// ── rule 3: no two releases share a version ───────────────────────────────
const seen = new Map();
for (const r of releases) {
  if (seen.has(r.version)) {
    errors.push(`two releases both claim version ${r.version} (${seen.get(r.version)} and ${r.date}). The seen-stamp is a single version string, so a reader who dismisses one has dismissed both.`);
  }
  seen.set(r.version, r.date);
}

if (errors.length) {
  console.error(`\ncheck-release-version — ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
  for (const e of errors) console.error(`  • ${e}\n`);
  console.error('A version number is an address, not a label: OTA updates are delivered to the');
  console.error('runtime that matches it. The changelog and app.json have to agree before a');
  console.error('build, because after one they disagree on every phone.\n');
  process.exit(1);
}

console.log(`check-release-version — ok, ${releases.length} releases, newest ${newest.version} matches app.json`);
