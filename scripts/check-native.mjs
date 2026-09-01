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
// Three checks, then:
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
//   3. NO SCREEN IMPORTS A THROWING NATIVE MODULE DIRECTLY. Added after this
//      script passed clean over the defect it was written for — see the long
//      note at THROWING below. The listing in 2 told a reader that
//      expo-clipboard needed a new build; it did not tell them that three
//      screens would not render AT ALL without one, and nothing else did
//      either.
//
// Exits non-zero on a missing usage string and on an unguarded import. The
// listing is informational — a native dependency is not a defect, it is a fact
// about the next release.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

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

// ── 3. and whether a screen imports one where a guard belongs ──────────────
//
// The failure this catches, in the words of the people it happened to: "the
// coach dashboard does not open".
//
// expo-clipboard's whole entry point is
//
//     export default requireNativeModule('ExpoClipboard');
//
// evaluated at MODULE SCOPE. On a binary that predates the dependency that call
// throws while the importing file is being loaded — before any component
// renders, and therefore before any `if (HAS_NATIVE_…)` anybody writes inside
// one can run. `import * as Clipboard from 'expo-clipboard'` at the top of
// app/(trainer)/dashboard.tsx was consequently not "the copy button will not
// work"; it was the coach's home tab failing to mount. expo-document-picker did
// the same to both document screens. An `eas update` would have shipped all
// three to every Android install made before those two dependencies landed.
//
// Every earlier check here passed on that. Section 2 listed both modules
// correctly under "none of these reach a phone without a new build", which is
// true and is not the same sentence as "these three screens are gone".
//
// ── what makes a module dangerous, decided from disk ───────────────────────
//
// Not every native module throws on import, and a rule that assumed so would
// flag expo-video — which is imported directly by four files on purpose,
// because its entry point does NOT reach a requireNativeModule at load time.
// The property that matters is exact and readable: does evaluating this
// package's entry point, following its own relative imports, run a
// requireNativeModule at module scope? expo-clipboard, expo-document-picker and
// expo-audio do. expo-video and expo-notifications do not.
//
// Derived rather than listed, for the reason written above derivedNative: a
// hand-kept list only ever contains modules somebody already thought about, and
// this bug is what happens when somebody does not.
const SRC_ROOTS = ['app', 'src'];

/**
 * Native modules that ARE imported directly, on purpose, and may stay that way.
 *
 * Every one of these was in package.json before any binary now in somebody's
 * pocket was built, so no install has the JavaScript without the native half.
 * Checked with `git log -S '"<name>"' -- package.json` against the commit the
 * preview APKs were built from, not assumed.
 *
 * This is the ONLY escape, it is per-module, and the default for anything not
 * on it is "route it through src/ui/nativeModules.ts". A module added from here
 * on is dangerous until somebody ships a build containing it, and by then the
 * screens are written — so the list does not grow just because a new import is
 * inconvenient to guard. It shrinks.
 */
const SETTLED_IN_EVERY_BINARY = new Set([
  'expo-camera',       // added at d53c9a25, long before the preview builds
  'expo-linking',      // 25b8ef35 — deep links have shipped since the first build
  'expo-updates',      // bc5656a4 — it is what DELIVERS the over-the-air update
  'expo-web-browser',  // f0b0e2fb
]);

/** The file that owns every native handle, and the only place a require of one
 *  of these belongs. It is not exempt from the rule below — it holds no static
 *  imports of them — and is named here for the error message. */
const GUARD = join('src', 'ui', 'nativeModules.ts');

/** A package's entry file on disk, or null. */
function entryOf(name) {
  const dir = join('node_modules', name);
  let pj;
  try { pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')); } catch { return null; }
  for (const cand of [pj.main, pj.module, 'build/index.js', 'index.js']) {
    if (!cand) continue;
    for (const f of [cand, `${cand}.js`, join(cand, 'index.js')]) {
      const p = join(dir, f);
      try { if (statSync(p).isFile()) return p; } catch { /* next candidate */ }
    }
  }
  return null;
}

/**
 * A requireNativeModule that runs when the file is LOADED rather than when
 * something is called. The four shapes every Expo package uses for it, anchored
 * at the start of a line so a call inside an indented function body — which
 * runs only if somebody calls it, and is therefore catchable — is not counted.
 */
const MODULE_SCOPE_REQUIRE =
  /^(?:export\s+default\s+|export\s+const\s+[\w$]+\s*=\s*|const\s+[\w$]+\s*=\s*|let\s+[\w$]+\s*=\s*)requireNativeModule\s*\(/m;

/** The file within `name` that throws, or false. Follows the package's own
 *  relative imports, because the throw is almost never in index.js itself. */
function throwsOnImport(file, seen = new Set()) {
  if (!file || seen.has(file)) return false;
  seen.add(file);
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { return false; }
  if (MODULE_SCOPE_REQUIRE.test(src)) return file;
  const re = /(?:^|\n)\s*(?:import\s[^'"]*from\s*|export\s+\*\s+from\s*|import\s*)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const base = join(dirname(file), m[1]);
    for (const cand of [base, `${base}.js`, join(base, 'index.js'), `${base.replace(/\.js$/, '')}.native.js`]) {
      let isFile = false;
      try { isFile = statSync(cand).isFile(); } catch { /* try the next shape */ }
      if (!isFile) continue;
      const hit = throwsOnImport(cand, seen);
      if (hit) return hit;
      break;
    }
  }
  return false;
}

const THROWING = new Map();
for (const m of present) {
  const hit = throwsOnImport(entryOf(m));
  if (hit) THROWING.set(m, relative(process.cwd(), hit));
}

function walkSrc(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    let dirent;
    try { dirent = statSync(full); } catch { continue; }
    if (dirent.isDirectory()) walkSrc(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Comments blanked, newlines kept so line numbers still line up.
 *
 * Borrowed from check-runtime-traps.mjs and for its reason: each of the three
 * files fixed here now carries a paragraph explaining what the import used to
 * be, and those paragraphs QUOTE the broken line. A check that reads its own
 * post-mortem as a fresh offence reports the file it just cleared.
 */
const blankComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

const sourceFiles = SRC_ROOTS.flatMap((r) => walkSrc(r));
const unguarded = [];
for (const file of sourceFiles) {
  const src = blankComments(readFileSync(file, 'utf8'));
  for (const [mod, thrower] of THROWING) {
    if (SETTLED_IN_EVERY_BINARY.has(mod)) continue;
    // A static import, which is evaluated at module scope. `import type` is
    // erased by the compiler and emits nothing, so it is not this bug — a call
    // site may still name the package's TYPES freely. A require inside a
    // try/catch is not matched either, and is the other correct answer:
    // src/lib/social.ts and src/ui/sounds.ts both do exactly that.
    const re = new RegExp(`(?:^|\\n)[ \\t]*import\\s+(?!type\\s)[^;]*?from\\s*['"]${mod}['"]|(?:^|\\n)[ \\t]*import\\s*['"]${mod}['"]`, 'g');
    let m;
    while ((m = re.exec(src))) {
      unguarded.push({ file, line: src.slice(0, m.index + 1).split('\n').length, mod, thrower });
    }
  }
}

if (sourceFiles.length === 0) {
  // A guard that quietly stops guarding is how all of this got here. An empty
  // walk is an error, never a pass.
  console.error('\ncheck-native: found no source files to scan — the app/ and src/ layout must have moved.');
  process.exit(1);
}

const guardedMods = [...THROWING.keys()].filter((m) => !SETTLED_IN_EVERY_BINARY.has(m));
console.log(
  `\n${THROWING.size} of them throw when imported, ${guardedMods.length} of which must go through ${GUARD}:`,
);
for (const [mod] of THROWING) {
  console.log(`  ${mod.padEnd(30)} ${SETTLED_IN_EVERY_BINARY.has(mod) ? 'in every binary in the field — direct import allowed' : 'guard required'}`);
}

if (unguarded.length) {
  console.error(`\n${unguarded.length} import${unguarded.length === 1 ? '' : 's'} of a native module that THROWS on a binary without it:`);
  for (const { file, line, mod, thrower } of unguarded) {
    console.error(`  ${file}:${line}`);
    console.error(`    imports ${mod} directly. ${thrower} calls requireNativeModule at module scope,`);
    console.error('    so on an install made before that dependency landed this import throws while the');
    console.error('    file is LOADING — the whole screen is gone, not the one feature. No `if` inside a');
    console.error('    component runs early enough to help.');
  }
  console.error(`\nRoute each through ${GUARD}: a HAS_NATIVE_… answer and a wrapper that`);
  console.error('degrades honestly, the way HAS_NATIVE_AUDIO and HAS_NATIVE_CLIPBOARD already do.');
  console.error('An over-the-air update carries the JavaScript and never the native half, so this is');
  console.error('not a hypothetical about old installs — it is what the next `eas update` does.');
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
}

if (missing.length || unguarded.length) process.exit(1);

console.log(
  `\nevery permission-requiring native module has a usage string somebody wrote, and none of the ${sourceFiles.length} files`
  + '\nin app/ and src/ imports a throwing native module without going through the guard.',
);
