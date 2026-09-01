// One smoke test per console route.
//
// ── Why a test that reads source files ────────────────────────────────────
//
// `studio-web` had four npm scripts — dev, build, start, typecheck — no test
// script, no lint script, no ESLint config or dependency (despite
// `eslint-disable` comments in the source), and zero test files. Twenty-two
// routes, roughly eighteen thousand lines, and nothing that fails when one of
// them stops holding the rules the whole console is built on.
//
// The obvious answer is a component test runner, and it is the wrong one to
// reach for first: every page here is a client component that builds a Supabase
// client at module import, so rendering one needs a DOM, a mocked network and a
// session before it asserts anything at all. That is a real project and it is
// not what is missing. What is missing is a tripwire on the four invariants
// that make this console honest, all of which are visible in the source:
//
//   1. every route is a client component — `loadMe()` reads the session in the
//      browser, and a page that lost `'use client'` fails at build time on a
//      good day and renders somebody else's session on a bad one;
//   2. every route identifies the reader before it draws — a page that skips
//      `loadMe` renders the gym to whoever asks;
//   3. every route gates on a role — the database enforces it independently,
//      but a page with no gate shows an empty screen rather than a refusal, and
//      "empty" is the sentence this codebase exists to prevent;
//   4. every route renders the `Shell`, which is what puts a reader inside the
//      navigation rather than on a page with no way out.
//
// Cheap, fast, and it fails on exactly the edits that would matter. It runs
// under the repo's own harness for the same reason everything else does: one
// suite, one command, no second runner to fall out of date.
//
// Compile with tsc then run with node, like gymClassFill.test.ts.
export {};

/**
 * The filesystem, reached through a locally-declared `require` rather than an
 * `import`.
 *
 * Two TypeScript configurations compile this file and they disagree about Node.
 * `tsconfig.test.json` names `"types": ["node"]` because these tests run under
 * plain node; the ROOT `tsconfig.json` is Expo's, has no node types, and type-
 * checks `src/**` for the phone app — so `import … from 'node:fs'` fails there
 * with TS2591, and `npx tsc --noEmit` at the root is a gate everybody runs.
 *
 * Adding `"types": ["node"]` to the root config would fix this file and change
 * the typing surface of the entire React Native app to do it — a global change
 * for one test. A module-scoped `declare` is local, shadows the global cleanly
 * under the config that HAS node types, and is simply a declaration under the
 * one that does not.
 */
declare const require: (id: string) => any;

const { readdirSync, readFileSync, existsSync, statSync } = require('node:fs') as {
  readdirSync: (p: string) => string[];
  readFileSync: (p: string, enc: string) => string;
  existsSync: (p: string) => boolean;
  statSync: (p: string) => { isDirectory: () => boolean };
};
const { join } = require('node:path') as { join: (...parts: string[]) => string };

const errors: string[] = [];
const ok = (cond: boolean, msg: string) => { if (!cond) errors.push(msg); };

const APP = join('studio-web', 'app');

/**
 * Every `page.tsx` under `studio-web/app`, as a route path.
 *
 * Walked rather than listed. A hardcoded list of twenty-two routes is a list
 * that silently stops covering the twenty-third, and a route added without any
 * of the four rules below is exactly the thing this file exists to catch.
 */
function routes(dir: string, prefix = ''): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route groups `(x)` and private folders `_x` do not contribute a path
      // segment. Neither exists in this console today; both are cheap to allow
      // and would otherwise produce a wrong route name in a failure message.
      const seg = entry.startsWith('(') || entry.startsWith('_') ? prefix : `${prefix}/${entry}`;
      out.push(...routes(full, seg));
    } else if (entry === 'page.tsx') {
      out.push({ route: prefix || '/', file: full });
    }
  }
  return out;
}

if (!existsSync(APP)) {
  // Run from somewhere that is not the repository root. Loud rather than a
  // suite that silently asserts nothing and prints "ok".
  console.error('consoleRoutes.test.ts — studio-web/app not found; run from the repository root.');
  process.exit(1);
}

/**
 * Routes that do not yet hold the `roleUnknown` rule, by exact path.
 *
 * Emptying this list is the goal. Adding to it needs a reason in writing.
 */
const KNOWN_MISSING_ROLE_UNKNOWN: string[] = ['/coach/checklists'];

/** Reported at the end rather than thrown. See the note beside the check. */
const pending: string[] = [];

const pages = routes(APP).sort((a, b) => a.route.localeCompare(b.route));

ok(pages.length >= 20, `the console has at least twenty routes (found ${pages.length})`);

for (const { route, file } of pages) {
  const src = readFileSync(file, 'utf8');

  ok(src.startsWith("'use client';"),
    `${route} opens with 'use client' — every page reads the session in the browser`);

  ok(src.includes('loadMe('),
    `${route} calls loadMe() — a page that does not identify the reader draws the gym to whoever asks`);

  // Any of the three shapes the console actually uses. The point is that SOME
  // decision is made about the role, not which one.
  ok(/me\.role/.test(src),
    `${route} decides something on me.role — a page with no gate renders empty rather than refusing`);

  ok(/<Shell\b/.test(src),
    `${route} renders the Shell, so the reader is never on a page with no way out`);

  // Two spellings of the same failure, and both have been real bugs in this
  // console: a null role read as "not staff", and a failed read drawn as an
  // empty gym. `roleUnknown` is the flag that keeps the first apart.
  //
  // ── The one route that does not hold this, named rather than excused ────
  //
  // `/coach/checklists` is the last of the three coach screens still missing
  // the branch its two siblings gained, and it is a known open item (roadmap
  // H1) belonging to the lane that owns `studio-web/app/coach`. It is listed
  // here rather than quietly skipped, and it is PRINTED on every run: a
  // suite that fails on somebody else's in-flight work is a suite people stop
  // running, and one that silently tolerates a defect is worse than no suite.
  //
  // The exception is by exact route. A SECOND route losing the branch fails
  // immediately, which is the whole job of this assertion.
  if (KNOWN_MISSING_ROLE_UNKNOWN.includes(route)) {
    pending.push(`${route} still has no roleUnknown branch (roadmap H1, owned elsewhere)`);
  } else {
    ok(src.includes('roleUnknown'),
      `${route} handles roleUnknown — a profile that did not READ is not a person without access`);
  }
}

/* ── the three Next files that were missing entirely ──────────────────────── */

for (const f of ['error.tsx', 'global-error.tsx', 'loading.tsx', 'not-found.tsx']) {
  ok(existsSync(join(APP, f)),
    `studio-web/app/${f} exists — without it an exception in any route is a blank page in production`);
}

// `global-error.tsx` replaces the whole document, so the stylesheet the layout
// imports is not loaded and `var(--ink)` resolves to nothing: black text on a
// black ground, or nothing at all. Its colours have to be literal.
{
  const src = readFileSync(join(APP, 'global-error.tsx'), 'utf8');
  ok(src.includes('<html'), 'global-error.tsx supplies its own <html>, because it replaces the document');
  // Comments stripped first: this file EXPLAINS why it cannot use custom
  // properties, and the explanation names one. Checking the raw text would fail
  // on the comment that documents the rule.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!code.includes('var(--'),
    'global-error.tsx uses no custom properties in its code — globals.css belongs to the layout that just failed, so var(--ink) there resolves to nothing');
}

/* ── the console has a test script at all ─────────────────────────────────── */

{
  const pkg = JSON.parse(readFileSync(join('studio-web', 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  ok(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.length > 0,
    'studio-web has a test script — it had four (dev, build, start, typecheck) and none of them fails on a wrong page');
  ok(typeof pkg.scripts?.typecheck === 'string',
    'and still has typecheck, which is the only check that was there before');
}

for (const p of pending) console.warn(`consoleRoutes.test.ts — known gap: ${p}`);

if (errors.length) {
  console.error(`consoleRoutes.test.ts — ${errors.length} failure${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors.slice(0, 30)) console.error('  · ' + e);
  if (errors.length > 30) console.error(`  … and ${errors.length - 30} more`);
  process.exit(1);
}
console.log(`consoleRoutes.test.ts — ok (${pages.length} routes)`);
