#!/usr/bin/env node
// The moment every install is orphaned, said out loud.
//
// ── what this cost ────────────────────────────────────────────────────────
//
// On 4 September commit feb454d changed one line of app.json: version 1.1.0 →
// 1.3.0. It was a one-line commit and it read like a label being corrected.
//
// It was not a label. `runtimeVersion` is `{"policy": "appVersion"}`, so the
// version is the address OTA updates are delivered to. The instant it moved,
// every install in existence — every phone in the client's testing group, on
// the coach apps, on the owner app — stopped being eligible for anything this
// repo publishes. Nothing broke. Nothing errored. Those phones simply went on
// running the JavaScript they already had, forever, and no publish afterwards
// could reach them.
//
// The sixteen updates published over the following days all reported success.
// The member holding a 1.0.0 build reported that features had been rolled back
// and the exercise catalogue was missing, which is what nine days of unreceived
// work looks like from the inside. Nine more days went into hunting a
// regression that was never there.
//
// ── what this gate does ───────────────────────────────────────────────────
//
// It compares app.json's version against the runtime of the most recent update
// actually PUBLISHED to the production branch. Those two agreeing means the
// next publish lands where the last one landed. Them differing means the next
// publish is addressed somewhere new, and everybody currently receiving updates
// stops receiving them until they take a new binary.
//
// ── why this warns instead of failing ─────────────────────────────────────
//
// Because bumping the version is legitimate, routine, and the correct thing to
// do before a release. A gate that refused it would be wrong most of the times
// it fired, and a gate that is wrong most of the time gets deleted or, worse,
// worked around — and then it is not there on the day it is right.
//
// What went wrong on 4 September was not the bump. It was that the bump was
// SILENT: no output anywhere said "you have just stranded every install", so
// nobody went and checked whether a build at the new version had reached the
// testers. This gate makes the moment loud and leaves the decision where it
// belongs. `REPPLE_STRICT_RELEASE=1` makes it fatal, so CI — which has no
// judgement to exercise and no person reading its scrollback — can refuse a
// tree whose version has moved ahead of what is actually being served.
//
// ── what this gate CANNOT check ───────────────────────────────────────────
//
// Everything that matters after the bump. Whether a build exists at the new
// version is `check:runtime-reach`. Whether that build was RELEASED TO A
// TESTER GROUP is in App Store Connect, needs an ASC API key this repo does
// not have, and is the step the whole incident turned on: builds 38, 39, 43,
// 44 and 45 were finished, submitted AND APPROVED, and the external group
// still had only 1.0.0 (28) assigned to it. Approved is not released. A tester
// cannot install an approved build; they can install a released one.
//
// So a quiet run from this file means the version has not moved since the last
// publish. It says nothing whatever about whether anybody can install anything.
//
// It reads the `production` branch only — the client app, where the incident
// happened. The coach and owner branches share app.json's version, so a bump
// strands them at the same instant; this gate names the one branch it actually
// looked at rather than implying six.
//
// Network trouble is a SKIP and not a failure, for the same reason as in
// check-runtime-reach: this runs in `check:all`, which runs on a CI worker
// with no Expo credentials at all, and a gate that fails when offline is a
// gate somebody removes from the list.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BRANCH = 'production';
const LIMIT = 20;
const STRICT = process.env.REPPLE_STRICT_RELEASE === '1';

const app = JSON.parse(readFileSync('app.json', 'utf8'));
const version = app?.expo?.version;
const rtv = app?.expo?.runtimeVersion;

const die = (...lines) => {
  console.error(`\ncheck-version-bump — ${lines[0]}\n`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  console.error('');
  process.exit(1);
};

if (typeof version !== 'string' || !version) {
  die('app.json has no expo.version.',
    'That string is the runtime an update is addressed to. There is nothing to',
    'compare, so this gate stops rather than invent one.');
}
if (!rtv || typeof rtv !== 'object' || rtv.policy !== 'appVersion') {
  die('app.json\'s runtimeVersion is not { policy: "appVersion" }.',
    `It is: ${JSON.stringify(rtv)}`,
    '',
    'This gate compares expo.version against a published runtime, which is only',
    'the same question while that policy holds. Under any other policy the',
    'comparison is between two unrelated strings and its warning would be noise —',
    'or worse, its silence would be false comfort. Teach it the new policy first.');
}

let updates;
try {
  const out = execFileSync('npx', [
    'eas', 'update:list',
    '--branch', BRANCH,
    '--limit', String(LIMIT),
    '--json', '--non-interactive',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const start = out.indexOf('{');
  if (start < 0) throw new Error('eas printed no JSON object');
  const parsed = JSON.parse(out.slice(start));
  updates = parsed?.currentPage;
  if (!Array.isArray(updates)) throw new Error('eas returned no currentPage of updates');
} catch (e) {
  console.log(`check-version-bump — SKIPPED, \`eas update:list\` could not answer: ${String(e.message).split('\n')[0]}`);
  console.log('  Nothing was proved. The published runtime was not read.');
  process.exit(0);
}

// The newest runtime that has actually been served on this branch. `eas
// update:list` returns newest first; the first entry with a runtime is the one
// installs are currently being offered.
const published = updates.find((u) => typeof u?.runtimeVersion === 'string' && u.runtimeVersion)?.runtimeVersion;

if (!published) {
  console.log(`check-version-bump — nothing published to \`${BRANCH}\` yet; app.json is ${version} and there is no previous runtime to have moved away from.`);
  process.exit(0);
}

if (published === version) {
  console.log(`check-version-bump — ok, app.json ${version} matches the newest runtime published to \`${BRANCH}\`, so the next publish reaches the same installs the last one did.`);
  console.log('  This says nothing about whether a build at that version was RELEASED to a');
  console.log('  tester group — that lives in App Store Connect, needs an ASC API key this');
  console.log('  repo does not have, and submitted-and-approved is not released.');
  process.exit(0);
}

const label = STRICT ? 'REFUSED' : 'WARNING';
const out = STRICT ? console.error.bind(console) : console.warn.bind(console);

out('');
out(`check-version-bump — ${label}: the version has moved away from what is being served.`);
out('');
out(`    app.json expo.version        ${version}`);
out(`    newest published runtime     ${published}   (branch \`${BRANCH}\`)`);
out('');
out(`  runtimeVersion follows appVersion, so every update from here is addressed to`);
out(`  runtime ${version}. Every install currently running ${published} — which is every`);
out(`  install that has been receiving updates — WILL RECEIVE NOTHING FURTHER. Not an`);
out(`  error, not a prompt, not a stale-version notice. Silence, indefinitely.`);
out('');
out(`  They stay silent until a build at ${version} is RELEASED TO A TESTER GROUP and`);
out('  each person installs it. Being built is not enough. Being submitted is not');
out('  enough. BEING APPROVED IS NOT ENOUGH — on 4 September builds 38, 39, 43, 44');
out('  and 45 were all approved while the external group still had only 1.0.0 (28)');
out('  assigned to it, so the only live install was nine days behind and sixteen');
out('  updates reached zero devices.');
out('');
out('  Someone has to open App Store Connect › TestFlight › the group › Builds and');
out(`  see ${version} listed there. This gate cannot see that screen and neither can`);
out('  any other check in this repo.');
out('');

if (STRICT) {
  out('  REPPLE_STRICT_RELEASE=1 is set, so this is fatal. Unset it to warn instead.');
  out('');
  process.exit(1);
}
out('  Exiting 0: a version bump is a legitimate thing to do. Set REPPLE_STRICT_RELEASE=1');
out('  to make this refusal fatal in CI.');
out('');
