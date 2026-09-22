#!/usr/bin/env node
// A patch for a package that is no longer installed, and two paid builds.
//
// ── what this cost ────────────────────────────────────────────────────────
//
// `patches/react-native-health+1.19.0.patch` outlived the dependency it
// patched. react-native-health came out of package.json; the patch file stayed.
//
// Nothing local noticed, and the reason is structural rather than unlucky.
// package.json runs `patch-package` as its `postinstall`, and postinstall runs
// on `npm install` — not on `npm test`, not on `npm run typecheck`, and not on
// `npm run check:all`. Every gate in this directory reads the source tree of a
// repository whose node_modules were installed BEFORE the dependency was
// removed. There is no arrangement of them that could have seen it. A green
// local run was not a wrong answer to the question; it was the right answer to
// a question nobody had asked.
//
// EAS asks it. A build machine has no node_modules and starts with a clean
// install, so postinstall runs there first and every time. patch-package exits
// non-zero on a patch it cannot apply, npm treats that as a failed install, and
// the build stops in "Install dependencies" — 35 seconds in, twice, reported in
// the dashboard as "Unknown error" with the real sentence buried in the install
// log:
//
//   **ERROR** Patch file found for package react-native-health which is not
//   present at node_modules/react-native-health
//
// Two builds, roughly forty minutes of wall clock waiting on them, and both
// paid. The second one was queued because the first failure said nothing a
// person could act on.
//
// ── why a gate ────────────────────────────────────────────────────────────
//
// Because removing a dependency is a package.json edit and deleting its patch
// is a different directory, and the two are only connected by somebody
// remembering. The failure is silent everywhere it is cheap to find and loud
// only where it is expensive: a patch file costs nothing until an installer in
// a data centre reads it.
//
// So this gate runs patch-package's own precondition against the source tree,
// which is the one place the answer is free. Two rules:
//
//   1. every patch names a package package.json still declares. This is the
//      defect above, exactly, and it is the one that stops a build.
//
//   2. every patch names the version that is actually installed. Cheaper to
//      check and quieter to get wrong: patch-package matches on content, not on
//      the filename's version, so a bumped dependency does not necessarily fail
//      the install — it can apply a patch written for another version, or warn
//      and continue, and the fix the patch existed to make is simply not there
//      any more. §2 is a warning made loud rather than a build that stops.
//
// The parser is the part worth reading twice. patch-package's filenames are
// `<package>+<version>.patch`, and a scoped package is written with its slash
// as a plus: `@react-native-async-storage+async-storage+1.23.1.patch`. A parser
// that splits on `+` and takes the first field reads that as a package called
// `@react-native-async-storage`, finds nothing by that name in package.json,
// and fails a build over a patch that is perfectly correct. That is a gate
// which cries wolf, and a gate which cries wolf gets deleted. It is tested
// below, against a scoped name, on every run — because a parser this gate gets
// wrong in the other direction fails OPEN, and reports clean on a tree that
// cannot install.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const errors = [];

const PATCH_DIR = 'patches';

/**
 * A patch-package filename, split into the package it patches and the version
 * it was written against.
 *
 * `+` is the separator AND the character a scope's `/` is written as, so the
 * leading `@` is what decides whether the first two fields are one name:
 *
 *   lodash+4.17.21.patch                       → lodash            @ 4.17.21
 *   @scope+pkg+1.2.3.patch                     → @scope/pkg        @ 1.2.3
 *   pkg+1.2.3+001+fix-thing.patch              → pkg               @ 1.2.3
 *
 * The third form is patch-package's sequenced patches: everything after the
 * version is a sequence number and a human label, and neither is our business.
 * Returns null when the shape is unreadable, which is reported rather than
 * skipped — an unparsed filename is a patch this gate has not checked.
 */
export function parsePatchName(file) {
  const base = file.replace(/\.patch$/, '');
  if (base === file) return null;                      // not a .patch at all
  const parts = base.split('+');
  let pkg, rest;
  if (parts[0].startsWith('@')) {
    if (parts.length < 3) return null;                 // @scope+name and no version
    pkg = `${parts[0]}/${parts[1]}`;
    rest = parts.slice(2);
  } else {
    if (parts.length < 2) return null;
    pkg = parts[0];
    rest = parts.slice(1);
  }
  const version = rest[0];
  if (!pkg || !version) return null;
  if (!/^\d+\.\d+\.\d+/.test(version)) return null;    // a field where a version belongs
  return { pkg, version };
}

// ── the parser's own test ─────────────────────────────────────────────────
// Unconditional, and its failures are this gate's failures. A gate whose parser
// has quietly stopped working prints "ok" on a tree that cannot install, which
// is the one outcome worse than the defect it was written for.
for (const [file, want] of [
  ['react-native-health+1.19.0.patch', { pkg: 'react-native-health', version: '1.19.0' }],
  ['lodash+4.17.21.patch', { pkg: 'lodash', version: '4.17.21' }],
  ['@react-native-async-storage+async-storage+1.23.1.patch',
    { pkg: '@react-native-async-storage/async-storage', version: '1.23.1' }],
  ['@expo+config-plugins+9.0.17.patch', { pkg: '@expo/config-plugins', version: '9.0.17' }],
  ['expo-camera+16.1.5+001+fix-torch.patch', { pkg: 'expo-camera', version: '16.1.5' }],
  ['react-native+0.79.5-rc.1.patch', { pkg: 'react-native', version: '0.79.5-rc.1' }],
]) {
  const got = parsePatchName(file);
  if (!got || got.pkg !== want.pkg || got.version !== want.version) {
    errors.push(
      `this gate's own filename parser is wrong: '${file}' read as ` +
      `${got ? `${got.pkg} @ ${got.version}` : 'unparseable'}, expected ${want.pkg} @ ${want.version}.\n` +
      `      Fix the parser before anything else. A parser that mis-reads a name fails this gate on a\n` +
      `      correct patch, and a parser that returns null on a real one passes a tree that cannot install.`);
  }
}

// ── the tree ──────────────────────────────────────────────────────────────
const pkgJson = JSON.parse(readFileSync('package.json', 'utf8'));
const declared = new Map();      // name → the range package.json asks for
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const [name, range] of Object.entries(pkgJson[field] ?? {})) declared.set(name, { range, field });
}

const postinstall = String(pkgJson.scripts?.postinstall ?? '');
const runsPatchPackage = /\bpatch-package\b/.test(postinstall);

const files = existsSync(PATCH_DIR)
  ? readdirSync(PATCH_DIR).filter((f) => f.endsWith('.patch')).sort()
  : null;

// A patches/ directory that does not exist is not a problem — patch-package
// exits 0 with nothing to do. It is only worth a word in the summary, so that
// somebody reading a passing run knows this gate checked nothing rather than
// checked something.
if (files && files.length && !runsPatchPackage) {
  errors.push(
    `${PATCH_DIR}/ holds ${files.length} patch file${files.length === 1 ? '' : 's'} and package.json's postinstall does not run patch-package.\n` +
    `      postinstall is: ${postinstall || '(none)'}\n` +
    `      Nothing applies these. Every one of them is a fix somebody wrote, believes is in the build,\n` +
    `      and is not — which is the same class of defect as a patch for a package that has gone, with\n` +
    `      the failure pointed at the app instead of at the installer.`);
}

// ── rule 1: a patch names a package package.json still declares ───────────
for (const file of files ?? []) {
  const parsed = parsePatchName(file);
  if (!parsed) {
    errors.push(
      `${PATCH_DIR}/${file} is not a name this gate can read. patch-package expects ` +
      `<package>+<version>.patch, with a scope written as @scope+name+version.patch.\n` +
      `      Renaming it is not cosmetic: patch-package parses the same filename to decide which ` +
      `directory under node_modules to apply it to.`);
    continue;
  }
  const { pkg, version } = parsed;
  if (!declared.has(pkg)) {
    errors.push(
      `${PATCH_DIR}/${file} patches ${pkg}, which is not in package.json's dependencies, devDependencies or optionalDependencies.\n` +
      `      This is the exact shape that killed two EAS iOS builds. postinstall runs patch-package,\n` +
      `      a clean install has no node_modules/${pkg}, and patch-package stops the install with\n` +
      `      "Patch file found for package ${pkg} which is not present at node_modules/${pkg}".\n` +
      `      EAS reports that as "Unknown error" 35 seconds into "Install dependencies", so the sentence\n` +
      `      naming the cause is in a log nobody opens until the second build has also failed.\n` +
      `      If ${pkg} was removed on purpose, delete this patch file. It patches nothing.`);
    continue;
  }

  // ── rule 2: and the version that is actually installed ──────────────────
  //
  // node_modules is the truth here rather than the range in package.json: `^`
  // and `~` mean the installed version moves without the range changing, and a
  // patch is written against one tree of files, not against a range.
  const installedPath = join('node_modules', pkg, 'package.json');
  if (!existsSync(installedPath)) continue;      // not installed here; rule 1 already asked the question that matters
  let installed;
  try { installed = JSON.parse(readFileSync(installedPath, 'utf8')).version; } catch { continue; }
  if (typeof installed !== 'string' || installed === version) continue;
  errors.push(
    `${PATCH_DIR}/${file} was written against ${pkg} ${version}; node_modules has ${installed} (package.json asks for ${declared.get(pkg).range}).\n` +
    `      patch-package matches on file CONTENT, not on this filename, so a version drift does not\n` +
    `      reliably stop anything — it either applies a patch written for another release or warns and\n` +
    `      carries on. Either way the change the patch exists to make may not be in the build, and the\n` +
    `      only symptom is the original bug coming back in a tree where somebody can point at a patch\n` +
    `      file and say it is fixed.\n` +
    `      Re-cut it: edit node_modules/${pkg}, run npx patch-package ${pkg}, delete the old file.`);
}

if (errors.length) {
  console.error(`\ncheck-patches — ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
  for (const e of errors) console.error(`  • ${e}\n`);
  console.error('postinstall runs patch-package, and postinstall runs on install — which happens on a');
  console.error('build machine and not in check:all. A patch file costs nothing locally and a paid');
  console.error('build in a data centre, so it is checked here, where the answer is free.\n');
  process.exit(1);
}

if (files === null) {
  console.log(`check-patches — ok, no ${PATCH_DIR}/ directory (patch-package has nothing to apply)`);
} else {
  console.log(`check-patches — ok, ${files.length} patch file${files.length === 1 ? '' : 's'}, each naming a declared dependency at its installed version`);
}
