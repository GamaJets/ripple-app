// ── The edge functions had no gate at all ───────────────────────────────────
//
// On 2 Sep the stripe-webhook could not be deployed. Not because it was wrong —
// because there was no way to find out whether it was right. `check:all` ran
// nineteen gates over the apps and the console and read nothing in
// supabase/functions/, Deno is not installed on the build machine, and the one
// file that had to be correct was the one in front of live payments.
//
// The choice that night was between deploying a payments webhook nobody had
// compiled and leaving a shipped feature switched off. The feature stayed off.
// This exists so that is not the choice next time.
//
// ── What this checks, and what it deliberately does not ────────────────────
//
// It PARSES every function with the TypeScript compiler and reports syntax
// errors, and it resolves every relative import to a file that exists. That is
// narrower than `deno check` and it is chosen rather than settled for: a full
// type check needs the Deno standard library and the npm:stripe types, neither
// of which is installed here, and a gate that cannot run is not a gate.
//
// What it catches is what actually goes wrong in this repo: a file truncated by
// an interrupted write, an edit that loses a brace, and an import pointing at a
// module that moved. All three produce a function that deploys and then throws
// on its first request — which for stripe-webhook means payments silently
// stop being recorded.
//
// What it does NOT catch is a type error, and it says so rather than implying
// the functions are verified. `deno check` remains the thing to run before a
// deploy that matters; this is the floor, not the ceiling.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const DIR = join(ROOT, 'supabase', 'functions');

if (!existsSync(DIR)) {
  console.log('check:functions — no supabase/functions directory, nothing to read');
  process.exit(0);
}

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.ts') ? [p] : []);
});

const files = walk(DIR);
const problems = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);

  // ── syntax ──
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  // `parseDiagnostics` is not on the public type but is the only way to read
  // syntax errors without a full Program, which would need the Deno lib.
  const diags = sf.parseDiagnostics ?? [];
  for (const d of diags.slice(0, 3)) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    problems.push(`  ${rel}:${line + 1}:${character + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }

  // ── relative imports resolve ──
  // These functions import the app's own pure rules — `../../../src/lib/*.ts` —
  // so that a screen and its server cannot drift. That is the right call and it
  // is also a rope: those files are edited by everybody, and a rename is
  // invisible here until a coach taps Refund.
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+['"](\.[^'"]+)['"]/g)) {
    const spec = m[1];
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) {
      problems.push(`  ${rel}  imports '${spec}', which does not exist`);
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} problem(s) in supabase/functions:\n`);
  console.error(problems.join('\n'));
  console.error(`
An edge function that does not parse deploys perfectly well and throws on its
first request. For stripe-webhook that means payments quietly stop being
recorded, with nothing on any screen to say so.

Note this gate parses and resolves imports; it does NOT type check — that needs
Deno and the npm: types, which are not installed here. Run \`deno check\` before
a deploy that touches money.`);
  process.exit(1);
}

console.log(`check:functions — ${files.length} edge function file(s) parse, and every relative import resolves (syntax and imports only, not types)`);
