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

// ── Deno resolves a specifier LITERALLY ────────────────────────────────────
//
// `from './coachMoney'` is a file called `coachMoney`, with no extension, which
// does not exist. The module throws when it is first evaluated — not at deploy,
// not at call, but on the first request, as a 500 nobody sees until a purchase
// fails.
//
// The app cannot write `./coachMoney.ts` instead: `moduleResolution` is
// `bundler` and TypeScript refuses an import path ending in `.ts`. So a module
// an edge function imports has to be a LEAF with no relative imports at all —
// which is why `directCharges.ts` and `refunds.ts` have none.
//
// This walks OUT of the functions into src/lib and fails on the first
// extensionless value import it can reach, because checking only the function's
// own line misses it by one hop. That is exactly how `gym-checkout` shipped
// importing `memberBuy.ts`, whose six extensionless imports the Supabase CLI
// reported as `failed to read file` warnings that scroll past.
//
// `import type` is not flagged: it is erased before Deno ever resolves it.
const VALUE_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)([\s\S]{0,400}?)\s*from\s+['"](\.[^'"]+)['"]/g;

function reachableFrom(entry) {
  const seen = new Set();
  const bad = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of src.matchAll(VALUE_IMPORT)) {
      const spec = m[2];
      const target = resolve(dirname(file), spec);
      if (/\.[a-zA-Z]+$/.test(spec)) {
        if (existsSync(target)) queue.push(target);
        continue;
      }
      // No extension. Deno cannot resolve it.
      bad.push({ file, spec, via: file === entry ? null : entry });
      // Follow it anyway so one miss does not hide the rest.
      for (const ext of ['.ts', '.tsx']) if (existsSync(target + ext)) queue.push(target + ext);
    }
  }
  return bad;
}

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

for (const entry of files) {
  for (const b of reachableFrom(entry)) {
    const where = relative(ROOT, b.file);
    problems.push(
      `  ${where}  imports '${b.spec}' with no file extension`
      + (b.via ? `, and is reached from ${relative(ROOT, b.via)}` : '')
      + ` — Deno cannot resolve that, so the function throws on its first request`);
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
