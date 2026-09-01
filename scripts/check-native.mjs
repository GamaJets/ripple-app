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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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
const HAND_DECLARED = [
  // Modules Metro cannot see because the require is inside a try/catch, which
  // it treats as optional: an unresolvable one throws at runtime into the catch
  // rather than failing the bundle. src/lib/exportShare.ts does exactly this,
  // and neither was ever in package.json, so `Print` and `Sharing` were always
  // null and the PDF button was never offered in ANY build.
  'expo-print', 'expo-sharing',
];

/**
 * Every dependency that actually ships native code, DERIVED rather than listed.
 *
 * The list used to be written by hand, and the comment above it already named
 * why that fails: "this list only ever contained modules somebody had already
 * declared, so a module nobody declared could not be missed from it."
 *
 * It then failed again in exactly that way. `expo-clipboard` and
 * `expo-document-picker` were added one morning, and neither was in the list —
 * so this check reported a clean bill while the coach app's home tab imported
 * Clipboard at module scope and could not render at all on any build made
 * before they were added. Full preflight passed on an app that would not open.
 *
 * A package is native if it carries a podspec or declares itself an Expo
 * module. That is a property of what is on disk, so a module nobody thought
 * about is caught the moment it is installed.
 */
function derivedNative(names) {
  const out = [];
  for (const name of names) {
    const dir = join('node_modules', name);
    if (!existsSync(dir)) continue;
    let native = existsSync(join(dir, 'expo-module.config.json'));
    if (!native) {
      try {
        native = readdirSync(dir).some((f) => f.endsWith('.podspec'))
          || existsSync(join(dir, 'android', 'build.gradle'));
      } catch { /* unreadable package directory; the podspec test below still applies */ }
    }
    if (native) out.push(name);
  }
  return out;
}

const deps = JSON.parse(readFileSync('package.json', 'utf8')).dependencies ?? {};
const NATIVE = [...new Set([...derivedNative(Object.keys(deps)), ...HAND_DECLARED])].sort();
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
for (const m of present) console.log(`  ${m.padEnd(30)} ${deps[m]}`);

/**
 * Whether a native module has an iOS half at all.
 *
 * `react-native-health-connect` is Android-only — Health Connect is an Android
 * API and the package ships `"platforms": ["android"]` with no podspec. It can
 * therefore NEVER appear in ios/Podfile.lock, so comparing it against that file
 * reported it "absent" every single run, under a paragraph telling the reader
 * their next local build would red-screen. It would not.
 *
 * A check that cries wolf on a module that is working correctly is worse than
 * no check: the next module that really is missing from the pods gets read as
 * more of the same noise. So the comparison below is now scoped to the modules
 * that could be in that file, which is decidable from disk exactly the way
 * `derivedNative` is — a podspec, or an Expo module config that names apple.
 */
function hasIosHalf(name) {
  const dir = join('node_modules', name);
  try {
    if (readdirSync(dir).some((f) => f.endsWith('.podspec'))) return true;
  } catch { /* unreadable package directory; the config test below still applies */ }
  const cfgPath = join(dir, 'expo-module.config.json');
  if (!existsSync(cfgPath)) return false;
  try {
    const platforms = JSON.parse(readFileSync(cfgPath, 'utf8'))?.platforms;
    // No `platforms` key is the older shape and means "all of them". Only an
    // explicit list that omits apple/ios is evidence of an Android-only module.
    if (!Array.isArray(platforms)) return true;
    return platforms.some((p) => p === 'apple' || p === 'ios');
  } catch {
    // An unreadable config is not evidence of absence, and treating it as such
    // would silently drop a module out of the very comparison this exists for.
    return true;
  }
}

// ── and whether THIS machine's build actually contains them ────────────────
//
// The list above says what a build needs. It cannot say what the build on the
// simulator has. `ios/` is gitignored and absent on CI, so this is a warning
// rather than a failure — but it is the check that would have caught a coach
// app red-screening on `Cannot find native module 'ExpoClipboard'` because
// `pod install` had never been re-run after the dependency landed.
const lockPath = join('ios', 'Podfile.lock');
if (existsSync(lockPath)) {
  const lock = readFileSync(lockPath, 'utf8');
  const pod = (m) => m.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const androidOnly = present.filter((m) => !hasIosHalf(m));
  if (androidOnly.length) {
    console.log(`\n${androidOnly.length} of them ${androidOnly.length === 1 ? 'is' : 'are'} Android-only, so not expected in Podfile.lock:`);
    for (const m of androidOnly) console.log(`  ${m}`);
  }
  const absent = present.filter((m) => hasIosHalf(m) && !lock.includes(pod(m)) && !lock.includes(m));
  if (absent.length) {
    console.error(`\nthis machine's ios/Podfile.lock does not mention ${absent.length} of them:`);
    for (const m of absent) console.error(`  ${m}`);
    console.error('\nA local build made from it will red-screen on the first screen that');
    console.error('imports one. Run `npx expo run:ios` (or pod install) before demoing.');
    console.error('EAS builds are unaffected: they install pods fresh from package.json.');
  } else {
    const iosSide = present.filter(hasIosHalf);
    console.log(`\nthis machine's Podfile.lock has all ${iosSide.length} of the iOS-side modules.`);
  }
}

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
