#!/usr/bin/env node
// A test file that `npm test` never runs.
//
// ── the incident ──────────────────────────────────────────────────────────
//
// 14 Oct 2026. `lastActiveChip` in src/lib/rosterStatReach.ts shipped
// "Added By You" — a blanket capitalise over a house rule that keeps a short
// preposition down. It shipped with a test file beside it that asserted the
// right answer, and the test caught it the moment it was first run, which was
// hours after the OTA.
//
// Two lists have to name a test before it runs here: `files` in
// tsconfig.test.json, which is what compiles it, and the `test` script in
// package.json, which is what executes it. Writing the file does nothing.
// Miss either and the suite stays green, the file sits in the repo looking
// like cover, and `git ls-files '*.test.ts'` counts it.
//
// Six were in that state when this was written. Five passed. The sixth,
// src/lib/listOwner.test.ts, FAILED — and had been failing for as long as it
// had existed, against a module nothing imports.
//
// ── the rule ──────────────────────────────────────────────────────────────
//
// Every `*.test.ts` under src/ is named in BOTH lists, or it is in KNOWN below
// with a reason. A test nobody runs is worse than no test: it is the absence
// of cover, wearing the look of cover.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Tests deliberately not run, each with the reason and what would let it in.
 * A ratchet, like scripts/check-inlined-env.mjs's UNSET: an entry that has
 * stopped being true is itself a failure.
 */
const KNOWN = new Map([
  ['src/lib/listOwner.test.ts',
    'It fails, and registering it would turn the suite red on something no screen runs. src/lib/listOwner.ts is imported by NOTHING — it is a fix for the account-mixing defect its own header traces through src/ui/workoutLog.tsx, written, argued at length, and never wired in. The one failing assertion is a genuine disagreement about intent, not a typo: the test says a list held for "unknown" is not foreign to a real account, and the module says it is, because its `unclaimed` note argues that treating a recorded-but-unusable owner as adoptable is the exact defect it exists to refuse. Deciding that settles how a half-signed-in member\'s queued sets are handled, so it is a product decision and not a sweep. Entry goes when the module is either wired in or deleted.'],
]);

const files = execSync("git ls-files 'src/**/*.test.ts'", { encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean);

if (files.length < 400) {
  console.error(`check-tests-run: found only ${files.length} test files, which is far below what this tree holds. Refusing to pass.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const script = String(pkg.scripts?.test ?? '');
const tsconf = readFileSync('tsconfig.test.json', 'utf8');

const offences = [];
for (const f of files) {
  if (KNOWN.has(f)) continue;
  // Compiled and run as `.tmp/<path under src>.js`, or invoked directly with
  // tsx — a handful are, and naming the source path counts as being run.
  const out = f.replace(/^src\//, '').replace(/\.ts$/, '.js');
  // Two ways to be run, and only one of them needs compiling. Most are
  // `node .tmp/<path>.js`, which exists only if tsconfig.test.json's `files`
  // names the source. A few are `npx tsx src/...`, which compiles on the fly
  // and must NOT be required in that list — src/lib/features.test.ts is one,
  // and treating it as unregistered was this check's own first false positive.
  const viaTsx = script.includes(f);
  const viaNode = script.includes(out);
  if (viaTsx) continue;
  if (!viaNode) {
    offences.push(`  ${f}\n      not in the package.json test script`);
  } else if (!tsconf.includes(`"${f}"`)) {
    offences.push(`  ${f}\n      run as ${out}, but not in tsconfig.test.json files — so it is never compiled and that path does not exist`);
  }
}

// A stale exception is a lie about what is covered, so the list may only shrink
// with the work rather than quietly outlive it.
for (const [f, reason] of KNOWN) {
  if (!files.includes(f)) offences.push(`  ${f}\n      listed in KNOWN but no such test file exists. Take it off the list.`);
  else if (!String(reason).trim()) offences.push(`  ${f}\n      listed in KNOWN with no reason.`);
  else {
    const out = f.replace(/^src\//, '').replace(/\.ts$/, '.js');
    if (script.includes(out) || script.includes(f)) {
      offences.push(`  ${f}\n      listed in KNOWN and in fact runs. Take it off the list — KNOWN is for tests that do NOT run.`);
    }
  }
}

if (offences.length) {
  console.error(`\ncheck-tests-run — ${offences.length} test file${offences.length === 1 ? '' : 's'} the suite does not run:\n`);
  console.error(offences.join('\n'));
  console.error(`
Two lists have to name a test before it runs: "files" in tsconfig.test.json
compiles it, and the "test" script in package.json executes it. Add it to both.

A test nobody runs is worse than no test — it is the absence of cover wearing
the look of cover. If one genuinely must not run, put it in KNOWN at the top of
this file with the reason and what would let it in.`);
  process.exit(1);
}

console.log(`check-tests-run — ok, ${files.length} test files; every one compiled and run, ${KNOWN.size} deliberately not with a reason.`);
