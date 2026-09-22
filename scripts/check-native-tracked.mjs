#!/usr/bin/env node
// A file the build needs, on disk, invisible to git.
//
// ── the defect ────────────────────────────────────────────────────────────
//
// `.gitignore` held `ios/`, unanchored. In gitignore that matches a directory
// of that name AT ANY DEPTH, so besides the Continuous Native Generation output
// at the repo root it also matched `modules/workout-activity/ios/` — the entire
// native half of the local Expo module that starts and stops the Live Activity.
//
// The module's `expo-module.config.json` and its TypeScript were tracked, so it
// looked complete in every listing, and every local build worked because the
// Swift was sitting on disk. EAS never received it.
//
// Build 47 shipped: `Payload/Repple.app/PlugIns/WorkoutActivity.appex` present
// and correct — right bundle id, right extension point, linking ActivityKit —
// and the host app binary linking WidgetKit and NOT ActivityKit, with no symbol
// from the module anywhere in it. A lock-screen timer that nothing in the app
// could begin. Fifty-eight gates were green, the build succeeded, and the only
// way to see it was to unpack the IPA.
//
// ── what this asserts ─────────────────────────────────────────────────────
//
// Every file under `modules/` and `targets/` is visible to git. Not "compiles",
// not "is correct" — VISIBLE, because those two directories exist for one
// reason: they are the native source that survives `prebuild` deleting `ios/`.
// A file there that git cannot see is a file the build server cannot see, and
// the failure is silent in the only direction that matters.
//
// Both states are reported and both fail:
//
//   ignored    a .gitignore pattern matches it. This is the one that shipped.
//   untracked  nothing ignores it and nobody has added it. Same outcome on a
//              build server, and one `git add` from being fine.
//
// It says nothing about anything else in the tree. A stray file in `src/` is
// caught by the type checker the moment something imports it; a stray Swift
// file is caught by nobody, which is the whole reason this exists.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** The two directories whose entire purpose is to survive prebuild. */
const ROOTS = ['modules', 'targets'];

const git = (args) => execFileSync('git', args, { encoding: 'utf8' });

/** Files git has in the index for a path. The build server gets exactly these. */
function tracked(root) {
  return new Set(git(['ls-files', root]).split('\n').filter(Boolean));
}

/**
 * Everything on disk under a path, as git sees the filesystem.
 *
 * `ls-files --others` lists what is NOT in the index: `--exclude-standard`
 * narrows that to files nothing ignores (untracked), and without it the list
 * also includes ignored ones. Asking twice and subtracting is what separates
 * the two states, and they are worth separating because the remedies differ —
 * one is `git add`, the other is a .gitignore pattern that is wrong.
 */
function invisible(root) {
  if (!existsSync(root)) return { ignored: [], untracked: [] };
  const untracked = git(['ls-files', '--others', '--exclude-standard', root]).split('\n').filter(Boolean);
  const all = git(['ls-files', '--others', root]).split('\n').filter(Boolean);
  const untrackedSet = new Set(untracked);
  return { ignored: all.filter((f) => !untrackedSet.has(f)), untracked };
}

let bad = 0;
let seen = 0;
for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  seen += tracked(root).size;
  const { ignored, untracked } = invisible(root);
  for (const f of ignored) {
    if (!bad) console.error('Native source the build server will never see:\n');
    bad += 1;
    // The pattern is named, because "it is ignored" sends somebody reading a
    // whole .gitignore and the answer is one line of it.
    let why = '';
    try {
      why = git(['check-ignore', '-v', f]).split('\t')[0].trim();
    } catch { /* raced with a delete; the path alone is enough */ }
    console.error(`  IGNORED    ${f}`);
    if (why) console.error(`             by ${why}`);
  }
  for (const f of untracked) {
    if (!bad) console.error('Native source the build server will never see:\n');
    bad += 1;
    console.error(`  UNTRACKED  ${f}`);
    console.error('             nothing ignores it; it has not been added');
  }
}

if (bad) {
  console.error('');
  console.error(`${bad} file${bad === 1 ? '' : 's'} under ${ROOTS.join('/ or ')}/ exist on disk and not in git.`);
  console.error('Every local build will work and the next EAS build will not contain them —');
  console.error('silently, because a missing native module is not a compile error, it is a');
  console.error('feature that never runs. See this file\'s header for the build that shipped');
  console.error('a Live Activity with nothing able to start it.');
  process.exit(1);
}

console.log(`check:native-tracked — ok, ${seen} native source files under ${ROOTS.map((r) => `${r}/`).join(' and ')} are all visible to git.`);
