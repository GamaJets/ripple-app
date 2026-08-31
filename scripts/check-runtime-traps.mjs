// Three bugs that shipped, and none of them could fail a typecheck, a test or a
// bundle. This is the check that would have caught each one.
//
// They are grouped in one script because they share a shape: the code is
// well-formed and correct-looking, the compiler is satisfied, the bundle builds,
// and the thing simply does not work on a device. Nothing in the existing eight
// preflight steps looks at any of them.
//
// ── 1. Two modals visible at once ───────────────────────────────────────────
//
// app/(client)/nutrition.tsx had a recipe sheet `<Modal visible={!!recipe}>` and,
// as a SIBLING, cook mode `<Modal visible={cook && !!recipe}>`. Both true at the
// same time. iOS presents a modal as a native view controller and will not stack
// a second from the same parent, so "Cook mode" was a dead button — no crash, no
// log, nothing to assert on. A tester reported it as "cook mode is not working".
//
// Deciding "can these two expressions be true together" in general is not
// possible. What IS decidable is whether they are talking about the same thing:
// every correct file in this repo gives each modal its own independent flag
// (`addOpen`, `showCal`, `!!sel`), and the broken one had `recipe` in both. So
// the rule is: sibling modals whose `visible` expressions share an identifier.
// That is the shape the bug actually had, it is quiet on all 13 files that use
// more than one modal today, and where it cannot tell it says so.
//
// ── 2. A require of a package that was never installed ──────────────────────
//
// src/lib/exportShare.ts does `try { Print = require('expo-print'); } catch {}`.
// Neither expo-print nor expo-sharing was in package.json at all. Metro treats a
// require inside try/catch as an OPTIONAL dependency: an unresolvable one throws
// at runtime into the catch rather than failing the bundle. So `Print` was null
// and the PDF button was never offered — in every build ever made, to everybody.
// A typecheck does not see an untyped require, and check-native.mjs only listed
// modules somebody had already declared, so one nobody declared could not be
// missed from it. This check is exactly decidable and hedges about nothing.
//
// ── 3. An env var read in a form Expo cannot inline ─────────────────────────
//
// src/lib/spotify.ts read `(process.env as any)?.EXPO_PUBLIC_SPOTIFY_CLIENT_ID`.
// Expo's Babel plugin replaces the LITERAL member expression
// `process.env.EXPO_PUBLIC_X` at build time by matching that exact AST shape. A
// cast plus optional chaining matches nothing, is left alone, and reads
// undefined from a bundle whose process.env is empty. The client id was in .env
// and in all eight eas.json profiles the whole time; the app told users the
// OWNER had not configured it. src/lib/social.ts had the same fault by aliasing
// `const env = process.env`.
//
// A deliberate indirect read can carry `env-indirect-ok: <why>` on the line or
// the line above, the same idiom check-reads.mjs uses for `no-error-ok:`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { builtinModules } from 'node:module';

const ROOT = process.cwd();

/** Where each check looks. Modals and env inlining are React Native concerns;
 *  the console is a Next app where neither applies in the same way. */
const RN_ROOTS = ['app', 'src'];
const ALL_ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/lib', 'studio-web/components', 'scripts'];

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(t|j)sx?$|\.mjs$/.test(full)) out.push(full);
  }
  return out;
}

const files = (roots) => roots.flatMap((r) => walk(join(ROOT, r))).map((f) => relative(ROOT, f));
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/**
 * Comments blanked, newlines kept so line numbers still line up.
 *
 * Not cosmetic: every one of these three bugs now has a paragraph ABOVE the fix
 * explaining what went wrong, and those paragraphs quote the broken code. A
 * check that reads its own explanation as a fresh offence reports the file it
 * just cleared, which is the fastest way to teach somebody to ignore it.
 */
function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

const findings = [];
const undecided = [];

// ── 1. modals ───────────────────────────────────────────────────────────────

/** The text of a JSX opening tag starting at `from`, brace-aware so that a
 *  `visible={a && b}` is not cut short by the brace inside it. */
function openingTag(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(from, i + 1);
  }
  return null;
}

const KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'typeof', 'void', 'new', 'in', 'of',
  'length', 'Boolean', 'String', 'Number', 'Array', 'Object', 'Math',
]);

/** Identifiers an expression depends on — the roots of member chains, so
 *  `recipe.steps.length` contributes `recipe` and nothing else. */
function identifiers(expr) {
  const out = new Set();
  const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(expr))) {
    const id = m[2];
    if (!KEYWORDS.has(id)) out.add(id);
  }
  return out;
}

/** Whether two expressions are visibly incapable of holding together. Only the
 *  cases that are actually certain: a negation of the other, or two equality
 *  tests on one variable against different literals. */
function mutuallyExclusive(a, b) {
  const norm = (s) => s.replace(/\s+/g, '');
  const [x, y] = [norm(a), norm(b)];
  if (x === `!${y}` || y === `!${x}` || x === `!(${y})` || y === `!(${x})`) return true;
  const eq = (s) => s.match(/^([\w$.]+)===?(['"][^'"]*['"]|\d+)$/);
  const ex = eq(x); const ey = eq(y);
  if (ex && ey && ex[1] === ey[1] && ex[2] !== ey[2]) return true;
  return false;
}

for (const file of files(RN_ROOTS)) {
  const src = blankComments(readFileSync(join(ROOT, file), 'utf8'));
  if (!src.includes('<Modal')) continue;
  const modals = [];
  let idx = src.indexOf('<Modal');
  while (idx !== -1) {
    const tag = openingTag(src, idx);
    if (tag) {
      const vis = tag.match(/visible=\{([\s\S]*?)\}\s*(?:[a-zA-Z-]|\/?>)/);
      if (vis) {
        modals.push({ line: lineOf(src, idx), expr: vis[1].trim() });
      } else if (/<Modal\s[^>]*\bvisible\b(?!\s*=)/.test(tag)) {
        // Bare `visible`, i.e. always true. Legitimate and common here: the
        // modal lives inside a component the parent only mounts when it should
        // be up, so the condition is the mount, not the prop. It depends on no
        // identifier, so it can never collide with a sibling under the rule
        // below — recorded as a constant rather than as something unreadable.
        modals.push({ line: lineOf(src, idx), expr: 'true' });
      } else {
        // A shape this cannot read is said out loud rather than skipped: a
        // modal whose condition went unexamined is exactly what hid the bug.
        undecided.push(`${file}:${lineOf(src, idx)}  a <Modal> whose visible prop this check could not read`);
      }
    }
    idx = src.indexOf('<Modal', idx + 6);
  }
  for (let i = 0; i < modals.length; i++) {
    for (let j = i + 1; j < modals.length; j++) {
      const a = modals[i]; const b = modals[j];
      if (mutuallyExclusive(a.expr, b.expr)) continue;
      const shared = [...identifiers(a.expr)].filter((id) => identifiers(b.expr).has(id));
      if (shared.length) {
        findings.push(
          `${file}:${a.line} and :${b.line}  two <Modal>s whose visible props both depend on \`${shared.join(', ')}\` `
          + `— \`${a.expr}\` and \`${b.expr}\`. iOS will not present the second while the first is up; `
          + 'switch the content of one modal instead.',
        );
      }
    }
  }
}

// ── 2. optional requires of undeclared packages ─────────────────────────────

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...builtinModules,
]);
const packageOf = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

for (const file of files(ALL_ROOTS)) {
  const src = blankComments(readFileSync(join(ROOT, file), 'utf8'));
  const re = /(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) continue;
    const name = packageOf(spec);
    if (declared.has(name)) continue;
    findings.push(
      `${file}:${lineOf(src, m.index)}  requires '${spec}', which is in neither dependencies nor devDependencies. `
      + 'Inside a try/catch Metro treats this as OPTIONAL: it throws at runtime into the catch instead of failing the '
      + 'bundle, so the feature behind it is silently absent in every build.',
    );
  }
}

// ── 3. env reads Expo cannot inline ─────────────────────────────────────────

for (const file of files(RN_ROOTS)) {
  const raw = readFileSync(join(ROOT, file), 'utf8');
  const src = blankComments(raw);
  const lines = raw.split('\n');
  const re = /process\.env/g;
  let m;
  while ((m = re.exec(src))) {
    const after = src.slice(m.index + 'process.env'.length);
    if (/^\.[A-Za-z_$][\w$]*/.test(after)) continue;   // the one form that inlines
    const line = lineOf(src, m.index);
    const here = lines[line - 1] ?? '';
    const above = lines[line - 2] ?? '';
    if (/env-indirect-ok:/.test(here) || /env-indirect-ok:/.test(above)) continue;
    findings.push(
      `${file}:${line}  reads process.env in a form Expo's Babel plugin cannot inline. `
      + 'It substitutes the literal member expression `process.env.EXPO_PUBLIC_X` by matching that exact shape; a cast, '
      + 'optional chaining, a computed key, destructuring or an alias all read undefined from the bundle. '
      + 'Mark it `env-indirect-ok: <why>` if it has a fallback that genuinely works.',
    );
  }
}

// ── 4. A hook called after an early return ──────────────────────────────────
//
// studio-web/app/sessions/page.tsx guarded on `me` at line 141 —
//
//     if (me === undefined) return <div>Loading…</div>;
//
// — and then called `const owed = useMemo(…)` at line 226, eighty-five lines
// further down, still at the component's own top level.
//
// React identifies a hook by CALL ORDER and nothing else. The first render
// returns at the guard having called four hooks; the render after `loadMe()`
// resolves reaches the fifth, and React throws "Rendered more hooks than
// during the previous render". Not a warning and not a degraded screen: the
// whole route is a blank page with an error in the console, every time, for
// everybody. /sessions is where a gym marks session outcomes and settles what
// it owes its trainers, and it was unopenable.
//
// It survives review because the guard and the hook are a hundred lines apart
// and each is unremarkable on its own, and it survives `tsc` because both are
// perfectly legal TypeScript. Nothing else in this repo looks at call order.
//
// Structural rather than brace-counted, because brace counting breaks on JSX
// and on `//` inside a string: every component in these trees is a top-level
// `function X(` whose body ends at a lone `}` in column 0 and whose own
// statements are indented exactly two spaces. A hook inside a nested callback,
// a nested component or a conditional block is indented further and is not this
// bug — a hook nested in a CONDITIONAL is a different offence that this does
// not claim to catch.
const HOOK_CALL = /\buse(State|Memo|Callback|Effect|Ref|Reducer|Context|Id|Transition|SyncExternalStore|OptimisticState)\s*[(<]/;
const FN_DECL = /^(?:export\s+default\s+function|export\s+function|function)\s+([A-Za-z0-9_]+)/;
/** A return at the component's own top level, including `if (…) return …`. */
const TOP_RETURN = /^ {2}(?:if\s*\(.*\)\s*return\b|return\b)/;
/** A statement at the component's own top level, where a hook is a hook. */
const TOP_STMT = /^ {2}(?:const|let|var|use[A-Z])/;

for (const file of files(['app', 'studio-web/app', 'studio-web/components']).filter((f) => f.endsWith('.tsx'))) {
  const lines = blankComments(readFileSync(join(ROOT, file), 'utf8')).split('\n');
  const raw = readFileSync(join(ROOT, file), 'utf8').split('\n');
  const starts = lines.map((l, i) => (FN_DECL.test(l) ? i : -1)).filter((i) => i >= 0);
  for (let n = 0; n < starts.length; n++) {
    const from = starts[n];
    let to = n + 1 < starts.length ? starts[n + 1] : lines.length;
    for (let k = from + 1; k < to; k++) if (lines[k] === '}') { to = k; break; }
    const name = FN_DECL.exec(lines[from])[1];
    let returnedAt = null;
    for (let k = from + 1; k < to; k++) {
      const l = lines[k];
      if (returnedAt === null) {
        if (TOP_RETURN.test(l) && /\breturn\b/.test(l)) returnedAt = k + 1;
      } else if (TOP_STMT.test(l) && HOOK_CALL.test(l)) {
        findings.push(
          `${file}:${k + 1}  ${name}() calls a hook after returning early at line ${returnedAt} — `
          + `\`${raw[k].trim().slice(0, 60)}\`. React counts hooks by call order, so the render that gets `
          + 'past that guard calls one more than the render before it and throws "Rendered more hooks than '
          + 'during the previous render". The route is blank, not degraded. Move the hook above every return; '
          + 'a hook may read state that is still loading, it may not be skipped.',
        );
      }
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────

const scanned = files(ALL_ROOTS).length;
if (scanned === 0) {
  // A guard that silently stops guarding is the thing all three of these bugs
  // have in common. An empty walk is an error, never a pass.
  console.error('check-runtime-traps: found no files to check — the source layout must have moved.');
  process.exit(1);
}

if (undecided.length) {
  console.log(`${undecided.length} thing${undecided.length === 1 ? '' : 's'} this check could not decide:\n`);
  for (const u of undecided) console.log('  ' + u);
  console.log('');
}

if (findings.length) {
  console.error(`${findings.length} runtime trap${findings.length === 1 ? '' : 's'}:\n`);
  for (const f of findings) console.error('  ' + f + '\n');
  console.error('Each of these compiles, typechecks and bundles. None of them works on a device.');
  process.exit(1);
}

console.log(
  `runtime traps ok — ${scanned} files: no two modals share a visibility condition, `
  + 'every required package is declared, every env read is in the form Expo inlines, '
  + 'and no component calls a hook after an early return'
  + (undecided.length ? `, with ${undecided.length} left undecided above.` : '.'),
);
