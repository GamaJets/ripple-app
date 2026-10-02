// ── .easignore must stay a superset of .gitignore ───────────────────────────
//
// INCIDENT, 2 Oct 2026. A build round uploaded this tree six times at an
// archive size EAS itself complained about, so .easignore was added to trim it.
// Two things went wrong while writing it, and both were silent:
//
//  1. `design/   # 15 MB of mockups`. gitignore syntax has NO trailing
//     comments, so the pattern was that entire string and matched nothing. The
//     file dropped six files out of 2,568 and looked exactly like one that
//     worked. Only measuring the result caught it.
//
//  2. The deeper hazard, which measuring would not have caught: the moment
//     .easignore exists, EAS stops reading .gitignore. Every rule there then
//     applies to git and not to the builder. The load-bearing one is
//     `src/**/*.js` — a `tsc` run without --outDir drops a .js beside every
//     .ts it reads, Metro resolves .js before .ts, and a stale one wins
//     silently. Dropping that single line from .easignore would ship a binary
//     running code nobody edited, with nothing on fire locally.
//
// So .easignore carries a verbatim copy of .gitignore and this gate holds it
// there, rather than the comment in the file asking somebody to remember.
//
// It also checks the other direction: that the files a native build cannot do
// without are still reaching the builder. An over-broad pattern — `app/`, say,
// meant for `app.config.ts` — is the same class of silent failure pointing the
// other way.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const fail = [];

if (!existsSync('.easignore')) {
  // Not a failure. Without the file EAS falls back to .gitignore, which is
  // correct behaviour and how this repo built for months.
  console.log('check-easignore — ok, no .easignore (EAS falls back to .gitignore)');
  process.exit(0);
}

/** Patterns only: comments, blank lines and negations are not rules to copy. */
const rules = (text) => text.split('\n')
  .map((l) => l.replace(/\r$/, ''))
  .filter((l) => l.trim() && !l.trim().startsWith('#'));

const gitRules = rules(readFileSync('.gitignore', 'utf8'));
const easLines = new Set(rules(readFileSync('.easignore', 'utf8')).map((l) => l.trim()));

for (const r of gitRules) {
  if (!easLines.has(r.trim())) {
    fail.push(`.gitignore has \`${r.trim()}\` and .easignore does not. EAS reads only .easignore, so that rule now protects git alone.`);
  }
}

// A trailing comment is not a comment. Catch the first mistake by shape, so the
// next person writing a pattern here is told rather than left to measure.
for (const [i, l] of readFileSync('.easignore', 'utf8').split('\n').entries()) {
  if (!l.trim() || l.trim().startsWith('#')) continue;
  if (/\s#/.test(l)) {
    fail.push(`.easignore:${i + 1} — \`${l.trim()}\` has a trailing comment. gitignore has no such thing: the whole line is the pattern, so this one matches nothing. Put the comment on its own line.`);
  }
}

/**
 * What a native build cannot be built without.
 *
 * Checked by asking git to apply .easignore, which is the same matcher EAS
 * uses. `--no-index` is what makes it answer for tracked files too.
 */
const MUST_REACH_BUILDER = [
  'package.json', 'package-lock.json', 'app.json', 'app.config.ts', 'eas.json',
  'tsconfig.json', 'google-services.json',
  'app/_layout.tsx',
  'src/lib/brands.ts',          // app.config.ts imports this at config time
  'src/lib/supabase.ts',
  'plugins/withNoHealthWrite.js',
];

for (const f of MUST_REACH_BUILDER) {
  if (!existsSync(f)) continue;  // the list outliving a rename is not this gate's business
  let ignored = false;
  try {
    execFileSync('git', ['-c', 'core.excludesFile=.easignore', 'check-ignore', '--no-index', '--quiet', f],
      { stdio: 'ignore' });
    ignored = true;
  } catch { /* non-zero means not ignored, which is what we want */ }
  if (ignored) {
    fail.push(`.easignore excludes \`${f}\`, which the build needs. EAS would upload a tree that cannot be built.`);
  }
}

if (fail.length) {
  console.error(`check-easignore — ${fail.length} problem(s):`);
  for (const f of fail) console.error('  · ' + f);
  process.exit(1);
}
console.log(`check-easignore — ok, ${gitRules.length} .gitignore rules carried over and ${MUST_REACH_BUILDER.length} build inputs still reach the builder`);
