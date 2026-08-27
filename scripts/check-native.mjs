#!/usr/bin/env node
// Native modules, and the two ways they go missing without saying so.
//
// This exists because the same class of bug has now landed three times, and not
// one of them failed a typecheck, a test, or a bundle:
//
//   expo-video                  native, and the store build predated it, so the
//                               player was absent from the binary while the UI
//                               listed clips happily. Nothing played and there
//                               was no error, because the code that would have
//                               errored was not there.
//   react-native-health         writing needs NSHealthUpdateUsageDescription.
//                               Without it iOS refuses the authorisation, and
//                               the refusal looks like a user declining.
//   expo-local-authentication   both at once.
//
// Two checks, then:
//
//   1. every module that needs an Info.plist usage string has one A HUMAN
//      WROTE. Missing is the obvious failure and the rarer one: several of
//      these libraries autolink a default, so the real defect is shipping
//      "Allow $(PRODUCT_NAME) to use Face ID" — generic, and carrying an
//      unexpanded build variable — to the App Store. A default is not an
//      absence, which is why checking only for absence found nothing when
//      this was genuinely misconfigured.
//
//      Resolved through `expo config --type introspect`, NOT `--type public`,
//      which does not run config plugins and reports correctly-set strings as
//      missing.
//
//   2. the native modules are listed, so "this needs a new binary before it
//      does anything" is a sentence somebody reads rather than discovers.
//
// Exits non-zero on a missing usage string. The listing is informational — a
// native dependency is not a defect, it is a fact about the next release.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Module → the Info.plist keys it cannot work without. */
const NEEDS_PLIST = {
  'expo-local-authentication': ['NSFaceIDUsageDescription'],
  'expo-camera': ['NSCameraUsageDescription'],
  'expo-image-picker': ['NSPhotoLibraryUsageDescription'],
  'react-native-health': ['NSHealthShareUsageDescription', 'NSHealthUpdateUsageDescription'],
};

/**
 * Modules with native code. A JS-only dependency ships in an over-the-air
 * update; these do not, and a build made before one was added does not contain
 * it however current the JavaScript is.
 */
const NATIVE = [
  'expo-camera', 'expo-image-picker', 'expo-video', 'expo-notifications',
  'expo-local-authentication', 'expo-secure-store', 'expo-dev-client',
  'expo-updates', 'react-native-health', 'react-native-svg',
];

const deps = JSON.parse(readFileSync('package.json', 'utf8')).dependencies ?? {};
const installed = (m) => Object.prototype.hasOwnProperty.call(deps, m);

let plist = {};
try {
  const out = execFileSync(
    'npx',
    ['expo', 'config', '--type', 'introspect', '--json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const cfg = JSON.parse(out.slice(out.indexOf('{')));
  plist = cfg?.ios?.infoPlist ?? {};
} catch (e) {
  console.error('could not resolve the app config, so usage strings were NOT checked:', e.message);
  process.exit(1);
}

/** A string the library shipped, not one anybody chose. */
const isDefault = (v) =>
  /\$\(|\bPRODUCT_NAME\b/.test(v) ||               // unexpanded build variable
  /^allow .* to use /i.test(v.trim()) ||             // the Expo default shape
  /^\$?\{?app.?name/i.test(v.trim());

const missing = [];
for (const [mod, keys] of Object.entries(NEEDS_PLIST)) {
  if (!installed(mod)) continue;
  for (const k of keys) {
    const v = plist[k];
    if (typeof v !== 'string' || v.trim().length < 10) {
      missing.push({ mod, key: k, why: 'is not set' });
    } else if (isDefault(v)) {
      missing.push({ mod, key: k, why: `is still the library default — ${JSON.stringify(v)}` });
    }
  }
}

const present = NATIVE.filter(installed);
console.log(`native modules (${present.length}) — none of these reach a phone without a new build:`);
for (const m of present) console.log(`  ${m.padEnd(28)} ${deps[m]}`);

if (missing.length) {
  console.error('\nInfo.plist usage strings that need a person:');
  for (const { mod, key, why } of missing) {
    console.error(`  ${key}`);
    console.error(`    required by ${mod}, and ${why}.`);
  }
  console.error('\nThis is what the permission sheet says to the user. Some of these');
  console.error('libraries refuse the permission outright without one (HealthKit does);');
  console.error('the rest ship a generic default, which reaches the App Store looking');
  console.error('exactly as unconsidered as it is.');
  process.exit(1);
}

console.log('\nevery permission-requiring native module has a usage string somebody wrote.');
