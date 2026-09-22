#!/usr/bin/env node
// The test suite, compiled into a directory of its own.
//
// ═══ NOT WIRED IN YET ═══════════════════════════════════════════════════════
//
// Nothing runs this. `npm test` is still the long `tsc && node .tmp/… && …`
// chain in package.json. Wiring it in is one line, and it is written out at the
// bottom of this header — but it must not be done while another lane has an
// `npm test` in flight, because replacing the script under a running suite is
// the very hazard this file exists to remove. Land it when the queue is quiet.
//
// ── What goes wrong today ─────────────────────────────────────────────────
//
// `npm test` is one `tsc -p tsconfig.test.json` into a shared `.tmp/`, followed
// by ~310 `node .tmp/lib/*.test.js` processes over several minutes. Nothing
// serialises two runs. Three lanes running it at once means:
//
//   · Lane A's `tsc` is half-way through writing `.tmp/lib/coachMoney.js` when
//     lane B's `node .tmp/lib/coachMoney.test.js` requires it. B fails on a
//     file that is correct in the tree and correct by the time anyone looks.
//     It passes on rerun, so it is filed as flaky. One lane spent real effort
//     proving that a "flaky" test was exactly this.
//   · Lane A edits a source file and recompiles while lane B is mid-run, so
//     B's remaining 200 suites test a mixture of two trees.
//   · `tsc` never empties `outDir`. `.tmp` currently holds compiled `.js` for
//     `financialAI` and `gymRefundMirror` — four files whose `.ts` sources no
//     longer exist anywhere in `src`. Nothing runs them today, but any suite
//     that `require`s one by name would load code that has been deleted from
//     the repository, and pass.
//
// ── What this does instead ────────────────────────────────────────────────
//
// One directory per run: `.tmp/run-<pid>-<time>`. Two runs cannot see each
// other's output, a half-written compile is never anybody else's input, and a
// deleted source cannot leave a stale `.js` behind because the directory is new
// every time. It is removed when the run passes; it is KEPT when the run fails,
// and the path is printed, because the compiled file is what you want when a
// stack trace points into it.
//
// No lock. A lock makes three lanes wait for each other for several minutes
// apiece and gives them one queue to contend on; separate directories let them
// run at once, which is what they are actually trying to do. The only shared
// thing left is `.tmp` itself as a parent, and creating a sibling directory in
// it is atomic.
//
// ── The suite list ────────────────────────────────────────────────────────
//
// Taken from `tsconfig.test.json`'s own `files` array — every entry ending
// `.test.ts` — in the order it is written there. That is not a change of
// behaviour: the hand-copied list in `package.json`'s `test` script and the
// derived list agree exactly today, 310 suites each, with no file on one side
// and not the other. It IS a change of maintenance. A suite added to
// `tsconfig.test.json` and forgotten in the `&&` chain compiles and never runs,
// which is the same shape as the `check:prose` / `check:decimals` incident that
// the `check:all` comment in package.json describes: a test nobody runs is not
// a test, it is a file.
//
// `src/lib/keyboardLift.test.ts` runs under `tsx`, from source, as it does in
// the current script — it is the one suite that does not go through the
// compile.
//
// ── To wire it in ─────────────────────────────────────────────────────────
//
// Replace the whole value of `"test"` in package.json with:
//
//     "test": "node scripts/run-tests.mjs"
//
// Nothing else changes. `test:zones` (`TZ=… npm run test && …`) keeps working
// unaltered, because TZ is inherited. `test:logic` and `test:coverage` still
// compile into the shared `.tmp` and should move to `node scripts/run-tests.mjs
// --only lib/logic.test.js` and `--only lib/coverage.test.js` in the same edit.
//
// Flags: `--keep` keeps the run directory even on success; `--only <suffix>`
// runs just the suites whose compiled path ends with that string.
import { readFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CONFIG = 'tsconfig.test.json';
const TMP = join(ROOT, '.tmp');

const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

/** JSON with `//` comments — which tsconfig.test.json is full of, deliberately. */
function readJsonc(path) {
  const raw = readFileSync(join(ROOT, path), 'utf8');
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
}

const cfg = readJsonc(CONFIG);
const suites = (cfg.files ?? []).filter((f) => /\.test\.tsx?$/.test(f));
if (suites.length < 200) {
  // The empty-set guard, for the same reason every gate in this directory has
  // one: a run that finds a handful of suites has not found the list, and
  // "310 suites passed" is the sentence people act on.
  console.error(`run-tests: only ${suites.length} suites in ${CONFIG}.files, which cannot be right. Refusing to run.`);
  process.exit(1);
}

/* ── a directory of this run's own ─────────────────────────────────────────
 *
 * Old `run-*` directories from a crashed or killed run are swept at 24 hours.
 * Not sooner: a directory belonging to a run that is still going is exactly
 * what must not be deleted, and several minutes is a normal length for one.
 */
mkdirSync(TMP, { recursive: true });
const DAY = 24 * 60 * 60 * 1000;
for (const e of readdirSync(TMP)) {
  if (!e.startsWith('run-')) continue;
  const p = join(TMP, e);
  try { if (Date.now() - statSync(p).mtimeMs > DAY) rmSync(p, { recursive: true, force: true }); } catch { /* raced with its owner */ }
}

const OUT = join(TMP, `run-${process.pid}-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

const cleanup = (ok) => {
  if (ok && !KEEP) { try { rmSync(OUT, { recursive: true, force: true }); } catch { /* nothing to remove */ } }
  else console.error(`\nCompiled output kept at ${OUT.replace(ROOT, '')}`);
};

const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: process.env }).status ?? 1;

// One compile, into this run's directory. `--outDir` on the command line wins
// over the one in the config, and nothing else about the config changes.
if (run('npx', ['tsc', '-p', CONFIG, '--outDir', OUT]) !== 0) {
  cleanup(false);
  process.exit(1);
}

let ran = 0;
for (const src of suites) {
  // src/lib/x.test.ts → lib/x.test.js, because rootDir is `src`.
  const rel = src.replace(/^src\//, '').replace(/\.tsx?$/, '.js');
  if (ONLY && !rel.endsWith(ONLY)) continue;

  // The one suite that runs from source rather than from the compile, exactly
  // as the current package.json script does.
  const status = src === 'src/lib/keyboardLift.test.ts'
    ? run('npx', ['tsx', src])
    : run('node', [join(OUT, rel)]);
  ran++;
  if (status !== 0) {
    console.error(`\n${src} failed.`);
    cleanup(false);
    process.exit(status);
  }
}

if (ONLY && ran === 0) {
  console.error(`run-tests: --only ${ONLY} matched no suite.`);
  cleanup(false);
  process.exit(1);
}

cleanup(true);
console.log(`\nrun-tests — ${ran} suite${ran === 1 ? '' : 's'} passed in TZ=${process.env.TZ ?? 'the machine’s own zone'}.`);
