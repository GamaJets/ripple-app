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
// errors, and it resolves every relative import to a file that exists.
//
// What that catches is what actually goes wrong in this repo: a file truncated
// by an interrupted write, an edit that loses a brace, and an import pointing at
// a module that moved. All three produce a function that deploys and then throws
// on its first request — which for stripe-webhook means payments silently
// stop being recorded.
//
// ── and, since the audit of 4 Sep, it TYPE CHECKS them too ─────────────────
//
// The line that used to stand here said a full type check "needs the Deno
// standard library and the npm:stripe types, neither of which is installed
// here, and a gate that cannot run is not a gate". That was true of a check
// that tries to type the whole world. It is not true of the check this repo
// actually needs.
//
// The valuable half is not `Deno.env.get`'s signature — it is the boundary
// between a function and the app's own rules that it imports. `stripe-webhook`
// pulls four modules out of src/lib, and those files are edited by every lane.
// A renamed export is already caught above; a CHANGED SIGNATURE is not, and it
// is the same class of failure — a 500 on the first request that touches it.
// `packExpiry.ts` gained a fourth parameter on `strandedNote` this week and
// nothing in this repo would have noticed a caller left on three.
//
// So: three specifiers cannot be resolved from a laptop — `https://esm.sh/...`,
// `jsr:...` and `npm:stripe` — and exactly those are declared `any` in an
// ambient shim written to a temp file below, along with the two pieces of Deno
// this codebase uses. Everything else is checked for real, with strict null
// checks ON because without them a `{ ok: true } | { ok: false }` result union
// does not narrow and the output is seventy lines of noise about properties
// that do exist.
//
// `noImplicitAny` stays OFF. It is the one strict flag that would demand
// annotations on the Supabase row callbacks throughout, which is a different
// job from the one this gate is for.
//
// This is still narrower than `deno check`, and `deno check` remains the right
// thing before a deploy that touches money. It is no longer the floor it was.
import { readdirSync, statSync, readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
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
const REACHED = new Map();
const VALUE_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\s)([\s\S]{0,400}?)\s*from\s+['"](\.[^'"]+)['"]/g;

// And the same specifier written in PROSE.
//
// The Supabase CLI collects a function's dependencies with a scanner that does
// NOT strip comments, so a line of documentation containing `from './x'` is
// read as a real import and reported as `failed to read file: open src/lib/x`.
// It cost a refused stripe-webhook deploy on 2 Sep: the offending text was the
// comment in termDates.ts EXPLAINING the leaf-module rule, quoting the broken
// form it exists to forbid.
//
// The gate above cannot see it — its pattern anchors to the start of a line, so
// a `//` in front hides the match from us and from nobody else. This one scans
// the raw text and subtracts the spans the real-import pattern already claimed;
// whatever is left is a specifier only the CLI can see.
const ANY_SPEC = /from\s+['"](\.[^'"]*)['"]/g;

function prosePecifiers(file, src) {
  const claimed = [];
  for (const m of src.matchAll(VALUE_IMPORT)) claimed.push([m.index, m.index + m[0].length]);
  const out = [];
  for (const m of src.matchAll(ANY_SPEC)) {
    if (claimed.some(([a, b]) => m.index >= a && m.index < b)) continue;
    out.push({ file, spec: m[1], line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

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
    REACHED.set(file, src);
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

for (const [file, src] of REACHED) {
  for (const p of prosePecifiers(file, src)) {
    problems.push(
      `  ${relative(ROOT, file)}:${p.line}  the text \`from '${p.spec}'\` appears outside a real import`
      + ` — the Supabase CLI's dependency scanner does not strip comments, so it will try to read`
      + ` '${p.spec}' and refuse the deploy. Reword it (a specifier of \`${p.spec}\`) rather than quoting the form.`);
  }
}

// ── a hundred is not a currency ────────────────────────────────────────────
//
// `check:currency` and `check:decimals` enforce the house money rule — minor
// units, no default currency, never `* 100` — over ROOTS of `app`, `src` and
// `studio-web`. `supabase/functions` is in none of them, so the one place that
// talks to Stripe directly was the one place the rule was not gated. It happens
// to be clean today; this is what keeps it that way.
//
// A hardcoded hundred is 100× wrong in yen, which has no minor unit at all, and
// 10× wrong in dinar, which has a thousand fils. Both print a plausible number.
//
// The single legitimate shape is a conversion that has ACTUALLY thought about
// it — `owner-metrics` divides by 100, and by 1000, and by nothing, according to
// two named sets of currency codes. So a file that declares both sets is a file
// where the divide is the answer rather than the bug, and is allowed. A file
// that does not is asserting that every currency on earth has two decimals.
// COMMENTS ARE BLANKED FIRST, and that is not a nicety.
//
// This repo documents the broken form on purpose — `connect-checkout` explains
// "This was `pkg.currency || 'usd'`, and a literal here..." and carries the
// worked `/ 100` arithmetic in a comment right above the code that avoids it.
// A gate that reads prose would fail the build on the very sentences written to
// stop the bug, which is the failure mode `check:prose` was built around. The
// spans are replaced with spaces rather than removed so every reported line
// number still points at the real line.
const blankComments = (src, file) => {
  // Parsed, not scanned. `ts.createScanner` on its own cannot tell `/` dividing
  // from `/` opening a regular expression, and one wrong guess swallows the rest
  // of the line — which is how a first attempt at this blanked 224 of
  // connect-checkout's comments and silently missed the one that matters. The
  // PARSER gets that right, so the tokens it produces are taken as the truth and
  // everything between them — whitespace and comments, which is all trivia can
  // be — is blanked.
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const out = src.split('');
  const keep = [];
  const visit = (node) => {
    if (node.getChildCount(sf) === 0) keep.push([node.getStart(sf), node.getEnd()]);
    else node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  keep.sort((a, b) => a[0] - b[0]);
  let at = 0;
  const blank = (from, to) => { for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' '; };
  for (const [from, to] of keep) { if (from > at) blank(at, from); at = Math.max(at, to); }
  blank(at, out.length);
  return out.join('');
};

const MONEY_WORD = /(amount|price|cents|minor|fee|total|cost|revenue|payout|refund|balance|charge|subtotal|unit_amount)/i;
const HUNDRED = /([^\n]{0,48}?)([*/])\s*100(?![0-9])/g;
for (const file of files) {
  const src = blankComments(REACHED.get(file) ?? readFileSync(file, 'utf8'), file);
  const currencyAware = src.includes('ZERO_DECIMAL') && src.includes('THREE_DECIMAL');
  if (currencyAware) continue;
  for (const m of src.matchAll(HUNDRED)) {
    if (!MONEY_WORD.test(m[1])) continue; // a percentage of something is not money
    const line = src.slice(0, m.index).split('\n').length;
    problems.push(
      `  ${relative(ROOT, file)}:${line}  \`${m[2]} 100\` next to \`${m[1].trim().slice(-40)}\``
      + ` — money in this product is minor units and there is no default currency.`
      + ` A hundred is 100× wrong in JPY and 10× wrong in KWD. Convert against the`
      + ` currency (see ZERO_DECIMAL/THREE_DECIMAL in supabase/functions/owner-metrics/index.ts) or leave it in minor units.`);
  }
  for (const m of src.matchAll(/(\|\||\?\?)\s*['"]([a-z]{3})['"]/g)) {
    const before = src.slice(Math.max(0, m.index - 60), m.index);
    if (!/currency/i.test(before)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    problems.push(
      `  ${relative(ROOT, file)}:${line}  a currency falls back to '${m[2]}'`
      + ` — Repple is white-labelled and has no default currency. Refuse the sale instead`
      + ` (supabase/functions/gym-checkout/index.ts does: "priced in a currency your gym has not set").`);
  }
}

// ── and now the types ──────────────────────────────────────────────────────
//
// See the header. One Program over every function, with the three specifiers a
// laptop cannot fetch — and only those — declared `any` in an ambient shim.
//
// The shim is written to a temp directory rather than into the repo, because a
// `.d.ts` under supabase/functions/ would be walked by this very script and a
// `.d.ts` under scripts/ is a file somebody has to work out the purpose of. It
// lives for the length of one run.
//
// `esm.sh` and `jsr:` are wildcarded because the version is in the specifier and
// pinning it here would mean this gate needs editing every time supabase-js
// moves. `npm:stripe` is likewise matched by prefix.
const shimDir = mkdtempSync(join(tmpdir(), 'repple-edge-types-'));
const shimPath = join(shimDir, 'edge-globals.d.ts');
writeFileSync(shimPath, [
  '// Written by scripts/check-functions.mjs. Not a Deno type definition —',
  '// only the surface these functions actually touch, so that a real one',
  '// arriving later is an upgrade rather than a conflict.',
  'declare const Deno: {',
  '  env: { get(name: string): string | undefined };',
  '  serve(handler: (req: Request) => Response | Promise<Response>): unknown;',
  '};',
  // SHORTHAND ambient modules — no body. That is the form that makes every",
  '// binding imported from them `any`, named imports included; a body with',
  "  // `export = x` in it accepts a default import and rejects `{ createClient }`.",
  "declare module 'https://esm.sh/*';",
  "declare module 'jsr:*';",
  "declare module 'npm:*';",
  '',
].join('\n'), 'utf8');

const program = ts.createProgram([shimPath, ...files], {
  noEmit: true,
  skipLibCheck: true,
  // Strict null checks ON. Without them a `{ ok: true; body: T } | { ok: false;
  // error: string }` return — the shape ads-google, ads-tiktok, calendar-sync
  // and instagram-publish all use — does not narrow on `if (!r.ok)`, and the
  // gate reports seventy properties that are plainly there. With them, zero.
  strict: true,
  // OFF, deliberately, and it is the one flag that would turn this gate into a
  // week of annotating Supabase row callbacks. Different job.
  noImplicitAny: false,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: [],
});

// Two kinds of diagnostic are dropped, and only two.
//
// 2307 is "cannot find module". The shim answers it for the three remote
// specifiers; a RELATIVE one reaching here is a real missing file, and the
// resolver above has already said so in plainer words — so it is dropped rather
// than reported twice.
//
// And anything whose complaint names one of the three wildcard specifiers.
// `stripe-webhook` writes `Stripe.Checkout.Session` in type position sixty
// times, and this gate has no copy of Stripe's object model to check those
// against — a shorthand ambient module gives a namespace with no members, so
// every one of them reads as an error about a type that is perfectly real. The
// honest thing is to say the boundary is untyped rather than to hand-write a
// fake Stripe namespace that would accept `Stripe.Chekout` just as happily.
// This is exactly the gap `deno check` closes, and the closing message says so.
const UNTYPED_EDGE = /"(?:npm:\*|jsr:\*|https:\/\/esm\.sh\/\*)"/;
const typeDiags = [
  ...program.getSemanticDiagnostics(),
  ...program.getSyntacticDiagnostics(),
].filter((d) => d.code !== 2307
  && !UNTYPED_EDGE.test(ts.flattenDiagnosticMessageText(d.messageText, ' ')));

for (const d of typeDiags.slice(0, 40)) {
  const f = d.file;
  const where = f
    ? `${relative(ROOT, f.fileName)}:${f.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}`
    : 'supabase/functions';
  problems.push(`  ${where}  ${ts.flattenDiagnosticMessageText(d.messageText, ' ')} (TS${d.code})`);
}
if (typeDiags.length > 40) {
  problems.push(`  ...and ${typeDiags.length - 40} more type error(s), not listed.`);
}

if (problems.length) {
  console.error(`${problems.length} problem(s) in supabase/functions:\n`);
  console.error(problems.join('\n'));
  console.error(`
An edge function that does not parse deploys perfectly well and throws on its
first request. For stripe-webhook that means payments quietly stop being
recorded, with nothing on any screen to say so.

This gate parses, resolves every relative import, type checks against the app's
own modules, and holds the money rule. It still does not type the Deno standard
library or npm:stripe — those three specifiers are typed as any here — so
\`deno check\` remains the last word before a deploy that touches money.`);
  process.exit(1);
}

console.log(
  `check:functions — ${files.length} edge function file(s) parse and type check, every relative import resolves,`
  + ` and no amount is divided by a hardcoded hundred (https:, jsr: and npm: specifiers are typed as any)`);
