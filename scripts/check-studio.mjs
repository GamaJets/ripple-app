#!/usr/bin/env node
// The owner console is type-checked by nothing.
//
// ── what was actually true ────────────────────────────────────────────────
//
// `npm run typecheck` is `tsc --noEmit -p tsconfig.json`, and that tsconfig's
// `include` is exactly:
//
//     "include": ["src/**/*", "app/**/*"]
//
// `studio-web` is not in it, and cannot be: the console is a Next app compiled
// with `jsx: preserve` against the DOM lib, and the phone app is compiled with
// `jsx: react-native`. They are two programs and they need two configs, which
// is why studio-web has carried its own `tsconfig.json` and its own
// `typecheck` script since it was created.
//
// Nothing ran that script. `preflight` is `typecheck && test:zones &&
// check:all && check:schema`; `check:all` is thirty-seven gates and not one of
// them invokes a compiler over the console; `check:bundle` is `expo export`,
// which builds the phone app. So 41,703 lines across 54 console page and
// component files — every screen a gym owner uses on a desktop, including the
// ones that take payments, settle payroll and close a month — went through
// every gate in this repository without a type-checker ever being pointed at
// them.
//
// The tree happens to be clean today. That is the only reason this is being
// added rather than reported: a gate that finds nothing on its first run is
// worth exactly as much as the next type error it catches, and the next one
// would otherwise have been found by an owner rather than by a build.
//
// ── why this shells into studio-web rather than adding a -p flag ──────────
//
// The two trees are on different compilers. The repository root is on
// TypeScript 6.0.3 and studio-web on 5.9.3, and `tsc -p studio-web/tsconfig
// .json` from the root — which is the obvious one-line version of this — fails
// immediately on `import './globals.css'` with TS2882, because the newer
// compiler will not take a side-effect import it has no declaration for. That
// is a difference between compilers and not a defect in the console, and a
// gate that reports it as one is a gate that gets switched off in a week. So
// the console is checked by the compiler the console is built with, which is
// also the one `next build` uses.
//
// ── the empty-set guard ───────────────────────────────────────────────────
//
// `--listFiles` is passed and the files under the three console roots are
// counted, against the floors in gate-floor.mjs. A compiler invoked on a
// config whose `include` has drifted, or run from the wrong directory, exits 0
// having checked nothing — and prints the same "ok" this would otherwise
// print. Every scanning gate in this directory guards against that; a gate
// that delegates to a compiler needs it more, not less, because there is no
// file list of its own to look wrong.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const CONSOLE_DIR = `${ROOT}studio-web`;

if (!existsSync(`${CONSOLE_DIR}/tsconfig.json`)) {
  console.error('check:studio: studio-web/tsconfig.json is missing, so the console was not checked. '
    + 'Run from the repository root.');
  process.exit(1);
}
if (!existsSync(`${CONSOLE_DIR}/node_modules/typescript/package.json`)) {
  console.error('check:studio: studio-web has no TypeScript installed, so the console cannot be '
    + 'checked. Run `npm --prefix studio-web install` first.\n\n'
    + 'This is deliberately a FAILURE and not a skip. A gate that passes when its tool is '
    + 'absent reports a clean console on any machine that has not installed one.');
  process.exit(1);
}

// The console's own compiler, over the console's own config. `--listFiles` is
// what makes the empty-set guard below possible at all; it costs one line of
// output per file and nothing in time.
const run = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '--noEmit', '--listFiles', '-p', 'tsconfig.json'],
  { cwd: CONSOLE_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);

if (run.error) {
  console.error(`check:studio: could not run the console's TypeScript: ${run.error.message}`);
  process.exit(1);
}

const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const lines = out.split('\n');

/** Files the compiler actually read, per console root. Anything outside
 *  studio-web — src/lib through the `@lib/*` path map, and node_modules — is
 *  not counted here: those roots have their own gates, and counting them would
 *  let the console's own tree go missing behind them. */
const counts = { 'studio-web/app': 0, 'studio-web/lib': 0, 'studio-web/components': 0 };
for (const line of lines) {
  const l = line.trim();
  if (!l || l.includes('node_modules')) continue;
  for (const root of Object.keys(counts)) {
    if (l.includes(`/${root}/`)) { counts[root] += 1; break; }
  }
}
assertRootFloors('check:studio', counts);

/** Compiler diagnostics only. `--listFiles` fills the output with paths, and
 *  an error line is the one that names a file with a `(line,col): error` on it
 *  — or a global one, which tsc prints with a bare `error TS`. */
const problems = lines.filter((l) => /\berror TS\d+/.test(l));

if (run.status !== 0 || problems.length) {
  console.error('check:studio: the owner console does not type-check.\n');
  for (const p of problems.slice(0, 60)) console.error(`  ${p.trim()}`);
  if (problems.length > 60) console.error(`  …and ${problems.length - 60} more`);
  if (!problems.length) console.error(`  (the compiler exited ${run.status} without a diagnostic this gate could parse)`);
  console.error('\nThe console is a separate program from the phone app and has its own tsconfig. '
    + 'Reproduce with `npm --prefix studio-web run typecheck`.');
  process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`check:studio — ok, the owner console type-checks; ${total} files across `
  + `${Object.keys(counts).length} console roots, on the console's own compiler.`);
