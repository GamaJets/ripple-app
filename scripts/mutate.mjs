// A test that passes before the fix AND after it has asserted nothing, and
// there is no way to tell one of those from a real test by reading it.
//
// It has happened here more than once. A defect gets found, a test gets written
// alongside the fix, the suite goes green, and the test is filed away as proof.
// Then somebody checks out the commit before the fix, runs that same test, and
// it is green there too. The assertion was aimed slightly to the side of the
// behaviour — it read a field the bug did not touch, or compared a value against
// itself, or asserted a shape rather than a number. Nothing about it looked
// wrong. It was simply incapable of failing, and every later change to that code
// went out with a green tick that meant nothing.
//
// The only reliable way to know is to break the code on purpose and check that
// something screams. That has been done by hand: edit the source to put the bug
// back, run the test, watch it fail, undo the edit. It works, it is tedious, and
// it only ever gets done for the one line somebody happened to think about — the
// other forty lines in the same file are never probed at all.
//
// This does that, mechanically, everywhere. It takes each source file under
// src/lib that a test actually imports, makes one small wrong-but-compilable
// change at a time (a `>` becomes a `>=`, a constant becomes 0, an `&&` becomes
// an `||`, an `if` condition is negated, a `?? fallback` is deleted), and runs
// only the tests that import that file. If a test fails, the mutation was
// KILLED: some assertion really is watching that line. If every test still
// passes, the mutation SURVIVED, and that is the interesting case — it names a
// line whose behaviour nothing in the suite is checking. Survivors are where the
// next silently-passing test is going to come from.
//
// A mutation that does not compile is neither. Counting those as kills would be
// the same self-deception the whole script exists to prevent — tsc rejecting a
// broken edit says nothing about whether a test would have caught a working one
// — so they are reported on their own line and kept out of the kill rate.
//
// The dangerous part of this is obvious: it writes wrong code into the user's
// real source files. Every write is paired with a restore from an in-memory copy
// of the original bytes, in a `finally`, plus a signal handler for Ctrl-C, and
// the restore is verified by reading the file back and comparing. If a restore
// ever fails the run stops immediately and says so rather than continuing to
// mutate a file it can no longer put back. `git status --porcelain` is compared
// against a snapshot taken at the start, and any new dirt is shouted about.
//
// It is deliberately NOT in `preflight`. A full tsc per mutation puts a whole
// run in the minutes, which is fine for a thing you run when you want to know
// how much of the suite is real, and not fine as a pre-commit gate. It exits 0
// by default for the same reason: this is a report. `--fail-under <pct>` turns
// it into a gate for whoever wants one later.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const LIB = join(ROOT, 'src', 'lib');
const TSC = existsSync(join(ROOT, 'node_modules', '.bin', 'tsc'))
  ? join(ROOT, 'node_modules', '.bin', 'tsc')
  : 'npx';
const TSC_ARGS = TSC === 'npx' ? ['tsc', '-p', 'tsconfig.test.json'] : ['-p', 'tsconfig.test.json'];

const QUICK_CAP = 10;
const TEST_TIMEOUT_MS = 30_000;
const TSC_TIMEOUT_MS = 180_000;

// ── argv ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const opts = { file: null, quick: false, failUnder: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--quick') opts.quick = true;
  else if (a === '--file') opts.file = argv[++i];
  else if (a.startsWith('--file=')) opts.file = a.slice(7);
  else if (a === '--fail-under') opts.failUnder = Number(argv[++i]);
  else if (a.startsWith('--fail-under=')) opts.failUnder = Number(a.slice(13));
  else if (a === '--help' || a === '-h') {
    console.log('usage: node scripts/mutate.mjs [--file src/lib/foo.ts] [--quick] [--fail-under <pct>]');
    process.exit(0);
  } else {
    console.error(`mutate: unknown argument ${a}`);
    process.exit(2);
  }
}
if (opts.failUnder !== null && !Number.isFinite(opts.failUnder)) {
  console.error('mutate: --fail-under wants a number');
  process.exit(2);
}

// ── the safety net ──────────────────────────────────────────────────────────
//
// Anything written to disk is registered here first, holding the ORIGINAL bytes.
// Nothing else is allowed to remove an entry: only a verified restore does.

/** @type {Map<string, Buffer>} */
const inFlight = new Map();
let aborted = false;

function restoreAll(why) {
  let allOk = true;
  for (const [path, bytes] of inFlight) {
    try {
      writeFileSync(path, bytes);
      const back = readFileSync(path);
      if (!back.equals(bytes)) allOk = false;
      else inFlight.delete(path);
    } catch (e) {
      allOk = false;
      console.error(`mutate: FAILED to restore ${path} (${why}): ${e.message}`);
    }
  }
  if (!allOk) {
    console.error('');
    console.error('  !!  A source file could not be restored to its original bytes.');
    console.error('  !!  Recover it with: git checkout -- <path>');
    console.error('');
  }
  return allOk;
}

/** Write a mutant, having first recorded the bytes we owe back. */
function writeMutant(path, original, text) {
  inFlight.set(path, original);
  writeFileSync(path, text, 'utf8');
}

/** Put the file back and PROVE it. Anything less and the run stops. */
function restoreVerified(path, original) {
  writeFileSync(path, original);
  const back = readFileSync(path);
  if (!back.equals(original)) {
    aborted = true;
    console.error(`\nmutate: restore of ${path} did not take — aborting the run.`);
    console.error('  the file on disk does not match the bytes read at the start.');
    console.error(`  recover with: git checkout -- ${relative(ROOT, path)}`);
    return false;
  }
  inFlight.delete(path);
  return true;
}

let signalled = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (signalled) process.exit(130);
    signalled = true;
    console.error(`\nmutate: ${sig} — restoring ${inFlight.size} file(s) before exit.`);
    const ok = restoreAll(sig);
    process.exit(ok ? 130 : 3);
  });
}
process.on('uncaughtException', (e) => {
  console.error(`mutate: uncaught ${e && e.stack ? e.stack : e}`);
  restoreAll('uncaughtException');
  process.exit(3);
});
process.on('exit', () => { if (inFlight.size) restoreAll('exit'); });

// ── which files are worth mutating ──────────────────────────────────────────
//
// Derived, not listed: a source file earns a place here by being imported from
// a test file. Anything no test imports has nothing to catch a mutation and
// would be nothing but survivors.

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

// Only the tests tsconfig.test.json actually compiles. A .test.ts sitting on
// disk but missing from that list emits no .js, and `node` on a file that is not
// there exits 1 — which would read as a kill for every mutation ever applied.
// A false kill is worse than no kill: it is the exact thing this script exists
// to stop believing.
const tsconfigFiles = (() => {
  const raw = readFileSync(join(ROOT, 'tsconfig.test.json'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const listed = JSON.parse(raw).files || [];
  return new Set(listed.map((f) => resolve(ROOT, f)));
})();

const allTs = walk(LIB);
const testFiles = allTs.filter((p) => p.endsWith('.test.ts')).sort();
const skippedTests = testFiles.filter((p) => !tsconfigFiles.has(p));
const liveTests = testFiles.filter((p) => tsconfigFiles.has(p));
if (skippedTests.length) {
  console.log('note: these test files are not in tsconfig.test.json "files", so they are not compiled and cannot kill anything:');
  for (const p of skippedTests) console.log(`      ${relative(ROOT, p)}`);
  console.log('');
}

/** Resolve a relative specifier from a test file to a real .ts under src/lib. */
function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(cand) && !cand.endsWith('.test.ts') && cand.startsWith(LIB + '/')) return cand;
  }
  return null;
}

/** source path -> [test paths that import it] */
const targets = new Map();
for (const t of liveTests) {
  const src = readFileSync(t, 'utf8');
  for (const m of src.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    const hit = resolveSpec(t, m[1]);
    if (!hit) continue;
    if (!targets.has(hit)) targets.set(hit, []);
    if (!targets.get(hit).includes(t)) targets.get(hit).push(t);
  }
}

let files = [...targets.keys()].sort();
if (opts.file) {
  const want = resolve(ROOT, opts.file);
  files = files.filter((f) => f === want);
  if (!files.length) {
    console.error(`mutate: ${opts.file} is not a src/lib source file that any test imports.`);
    console.error('  candidates:');
    for (const f of [...targets.keys()].sort()) console.error(`    ${relative(ROOT, f)}`);
    process.exit(2);
  }
}

// ── reading the source without reading its comments or its strings ──────────
//
// Every mutation below asks "is this character actually code?". A `>` inside a
// regex or a `0` inside an error message is not, and rewriting one produces a
// mutant that tests nothing while looking like a real result.

const CODE = 0, SKIP = 1;

function maskOf(text) {
  const mask = new Uint8Array(text.length).fill(CODE);
  let i = 0;
  const n = text.length;
  let lastSig = ''; // last significant code character, for the regex/divide call
  let lastWord = '';
  const mark = (from, to) => { for (let k = from; k < to && k < n; k++) mask[k] = SKIP; };

  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];

    if (c === '/' && c2 === '/') {
      let j = i; while (j < n && text[j] !== '\n') j++;
      mark(i, j); i = j; continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2; while (j < n && !(text[j] === '*' && text[j + 1] === '/')) j++;
      mark(i, Math.min(j + 2, n)); i = j + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && text[j] !== c) { if (text[j] === '\\') j++; if (text[j] === '\n') break; j++; }
      mark(i, j + 1); i = j + 1; lastSig = 'x'; lastWord = ''; continue;
    }
    if (c === '`') {
      // The whole template, interpolations included. Conservative on purpose:
      // a `${a > b}` goes unmutated rather than risk rewriting the literal text.
      let j = i + 1, depth = 0;
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '$' && text[j + 1] === '{') { depth++; j += 2; continue; }
        if (text[j] === '}' && depth > 0) { depth--; j++; continue; }
        if (text[j] === '`' && depth === 0) break;
        j++;
      }
      mark(i, j + 1); i = j + 1; lastSig = 'x'; lastWord = ''; continue;
    }
    if (c === '/') {
      // Regex or division? Decided by what came before, which is how a real
      // lexer does it too.
      const prevIsValue = /[\w$)\]]/.test(lastSig) && !['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'void', 'delete', 'instanceof', 'new'].includes(lastWord);
      if (!prevIsValue) {
        let j = i + 1, cls = false, closed = false;
        while (j < n && text[j] !== '\n') {
          const d = text[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '[') cls = true;
          else if (d === ']') cls = false;
          else if (d === '/' && !cls) { closed = true; break; }
          j++;
        }
        if (closed) {
          let k = j + 1; while (k < n && /[a-z]/.test(text[k])) k++;
          mark(i, k); i = k; lastSig = 'x'; lastWord = ''; continue;
        }
      }
      lastSig = '/'; lastWord = ''; i++; continue;
    }
    if (!/\s/.test(c)) {
      lastSig = c;
      if (/[\w$]/.test(c)) lastWord += c; else lastWord = '';
    }
    i++;
  }
  return mask;
}

const isCode = (mask, from, len) => {
  for (let k = from; k < from + len; k++) if (mask[k] !== CODE) return false;
  return true;
};

// ── the catalogue ───────────────────────────────────────────────────────────

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const lineTextAt = (text, idx) => {
  const s = text.lastIndexOf('\n', idx - 1) + 1;
  let e = text.indexOf('\n', idx); if (e === -1) e = text.length;
  return text.slice(s, e);
};

/** Walk forward from `from` to the end of the expression it starts. */
function endOfExpr(text, mask, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (mask[i] !== CODE) continue;
    const c = text[i];
    if (c === '\n') { if (depth === 0) return i; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return i; depth--; }
    else if (depth === 0 && (c === ';' || c === ',')) return i;
    else if (depth === 0 && (text.startsWith('&&', i) || text.startsWith('||', i) || text.startsWith('??', i))) return i;
  }
  return text.length;
}

/** Match the `(` at `open` to its `)`. */
function matchParen(text, mask, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (mask[i] !== CODE) continue;
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function mutationsFor(text) {
  const mask = maskOf(text);
  /** @type {{at:number,len:number,to:string,kind:string}[]} */
  const out = [];
  const add = (at, len, to, kind) => { if (isCode(mask, at, len)) out.push({ at, len, to, kind }); };

  // comparison operators. `<`/`>` are only touched when spaced, which is how
  // this repo writes a comparison and is not how it writes a generic.
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('===', i)) { add(i, 3, '!==', 'op'); i += 2; continue; }
    if (text.startsWith('!==', i)) { add(i, 3, '===', 'op'); i += 2; continue; }
    if (text.startsWith('>=', i) && text[i + 2] !== '=') { add(i, 2, '>', 'op'); i += 1; continue; }
    if (text.startsWith('<=', i) && text[i + 2] !== '=') { add(i, 2, '<', 'op'); i += 1; continue; }
    if (text.startsWith('&&', i) && text[i + 2] !== '=' && text[i + 2] !== '&') { add(i, 2, '||', 'op'); i += 1; continue; }
    if (text.startsWith('||', i) && text[i + 2] !== '=' && text[i + 2] !== '|') { add(i, 2, '&&', 'op'); i += 1; continue; }
    if (text[i] === '>' && text[i - 1] === ' ' && text[i + 1] === ' ' && text[i - 2] !== '=' && text[i - 2] !== '-') add(i, 1, '>=', 'op');
    if (text[i] === '<' && text[i - 1] === ' ' && text[i + 1] === ' ') add(i, 1, '<=', 'op');
  }

  // numeric literals -> 0 and 1
  for (const m of text.matchAll(/(?<![\w$.])\d+(?:\.\d+)?(?![\w$.])/g)) {
    const at = m.index, lit = m[0];
    if (!isCode(mask, at, lit.length)) continue;
    // parseInt's radix is not a behaviour any test should be asked to defend;
    // 0 means the same thing as 10 and 1 throws.
    const before = text.slice(Math.max(0, at - 40), at);
    if (/parseInt\s*\([^()]*,\s*$/.test(before)) continue;
    const v = Number(lit);
    if (v !== 0) add(at, lit.length, '0', 'num');
    if (v !== 1) add(at, lit.length, '1', 'num');
  }

  // negate an `if` condition
  for (const m of text.matchAll(/\bif\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    if (!isCode(mask, m.index, m[0].length)) continue;
    const close = matchParen(text, mask, open);
    if (close === -1) continue;
    const cond = text.slice(open + 1, close);
    if (!cond.trim() || cond.includes('\n')) continue;
    add(open + 1, cond.length, `!(${cond})`, 'if');
  }

  // `return <expr>` -> `return null`, where the signature permits it.
  //
  // "Permits" is judged from the nearest return-type annotation above the
  // statement. An annotation that cannot hold null (`: number`, `: string`)
  // means tsc would reject the mutant, and a run spends a second and a half of
  // tsc on every one of those. No annotation at all is fine: the return type is
  // inferred, so null simply widens it. Anything this heuristic gets wrong is
  // wrong in the safe direction — a mutation skipped, or one more entry in the
  // "did not compile" column, never a false kill.
  const nullable = /\bnull\b|\bundefined\b|\bany\b|\bunknown\b|\bvoid\b/;
  const permitsNull = (at) => {
    let last = null;
    for (const s of text.slice(0, at).matchAll(/\)\s*:\s*([^{};=]+?)\s*(?:\{|=>)/g)) last = s;
    return !last || nullable.test(last[1]);
  };
  for (const m of text.matchAll(/\breturn\b/g)) {
    const at = m.index;
    if (!isCode(mask, at, 6)) continue;
    let s = at + 6;
    while (s < text.length && (text[s] === ' ' || text[s] === '\t')) s++;
    if (s >= text.length || text[s] === ';' || text[s] === '\n' || text[s] === '}') continue;
    const end = endOfExpr(text, mask, s);
    const expr = text.slice(s, end).trim();
    if (!expr || expr === 'null' || expr === 'undefined' || expr.includes('\n')) continue;
    if (!permitsNull(at)) continue;
    add(at, end - at, 'return null', 'return');
  }

  // delete a `?? fallback`
  for (const m of text.matchAll(/\?\?/g)) {
    const at = m.index;
    if (text[at + 2] === '=' || !isCode(mask, at, 2)) continue;
    let s = at + 2;
    while (s < text.length && (text[s] === ' ' || text[s] === '\t')) s++;
    const end = endOfExpr(text, mask, s);
    if (end <= s) continue;
    add(at, end - at, '', 'nullish');
  }

  out.sort((a, b) => a.at - b.at || a.len - b.len);
  return out;
}

/** Even spread across the file rather than the first N, which would only ever
 *  probe the imports and the first function. */
function sample(list, cap) {
  if (list.length <= cap) return list;
  const step = list.length / cap;
  const picked = [];
  for (let i = 0; i < cap; i++) picked.push(list[Math.floor(i * step)]);
  return picked;
}

// ── running ─────────────────────────────────────────────────────────────────

// A child dying of the same Ctrl-C that is about to reach us. spawnSync blocks
// the event loop, so the signal handler below cannot possibly have run yet; the
// child's death certificate is the earliest evidence we have that the run is
// over, and continuing past it would fill the report with mutations that never
// really got compiled.
let interrupted = false;
const noteSignal = (r) => { if (r.signal === 'SIGINT' || r.signal === 'SIGTERM') interrupted = true; };

function compile() {
  const r = spawnSync(TSC, TSC_ARGS, { cwd: ROOT, encoding: 'utf8', timeout: TSC_TIMEOUT_MS });
  noteSignal(r);
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

function runTest(testPath) {
  const js = join(ROOT, '.tmp', relative(join(ROOT, 'src'), testPath).replace(/\.ts$/, '.js'));
  if (!existsSync(js)) return { failed: false, missing: js };
  const r = spawnSync(process.execPath, [js], { cwd: ROOT, encoding: 'utf8', timeout: TEST_TIMEOUT_MS });
  noteSignal(r);
  // A mutant that makes a test hang has been noticed by that test as surely as
  // one that makes it fail.
  if (r.error && r.error.code === 'ETIMEDOUT') return { failed: true, note: 'timed out' };
  if (r.signal) return { failed: false, note: 'signalled' };
  return { failed: r.status !== 0, note: '' };
}

const gitPorcelain = () => {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  return (r.stdout || '').split('\n').filter(Boolean).sort();
};

const before = gitPorcelain();

const stats = { applied: 0, killed: 0, survived: 0, uncompiled: 0 };
/** Which kinds of mutation tsc rejected, so a big number in that column can be
 *  read rather than merely worried about. */
const uncompiledBy = new Map();
/** @type {Map<string, {line:number, kind:string, from:string, to:string}[]>} */
const survivors = new Map();

console.log(`mutate — ${files.length} source file(s) under src/lib that a test imports${opts.quick ? `, ${QUICK_CAP} mutations each (--quick)` : ''}`);
console.log('');

outer:
for (const path of files) {
  const rel = relative(ROOT, path);
  const originalBytes = readFileSync(path);
  const original = originalBytes.toString('utf8');
  const tests = targets.get(path).slice().sort();
  let muts = mutationsFor(original);
  if (opts.quick) muts = sample(muts, QUICK_CAP);
  if (!muts.length) { console.log(`  ${rel} — nothing to mutate`); continue; }

  process.stdout.write(`  ${rel} — ${muts.length} mutations, ${tests.length} test file(s): `);
  let k = 0, s = 0, u = 0;

  try {
    for (const mut of muts) {
      // Hand the event loop a turn. Everything either side of this is
      // synchronous — spawnSync included — and a signal handler registered in
      // node cannot run while the stack is busy. Without this yield, Ctrl-C is
      // not noticed until the entire run has finished, which is the opposite of
      // what a Ctrl-C is for.
      await new Promise((r) => setImmediate(r));
      if (interrupted) break outer;
      const mutated = original.slice(0, mut.at) + mut.to + original.slice(mut.at + mut.len);
      let verdict;
      try {
        writeMutant(path, originalBytes, mutated);
        if (!compile().ok) {
          verdict = 'uncompiled';
        } else {
          let failed = false;
          for (const t of tests) {
            const r = runTest(t);
            if (r.missing) { console.error(`\nmutate: expected ${relative(ROOT, r.missing)} after a clean compile and it is not there.`); aborted = true; }
            if (r.failed) { failed = true; break; }
          }
          if (aborted) verdict = 'uncompiled';
          else verdict = failed ? 'killed' : 'survived';
        }
      } finally {
        if (!restoreVerified(path, originalBytes)) break outer;
      }
      // Not `stats.applied++` first: a mutation whose compile or test run was
      // cut short by the signal has no verdict, and guessing one would be a
      // number in the report that nothing measured.
      if (aborted || interrupted) break outer;

      stats.applied++;
      if (verdict === 'uncompiled') {
        u++; stats.uncompiled++; process.stdout.write('?');
        uncompiledBy.set(mut.kind, (uncompiledBy.get(mut.kind) || 0) + 1);
      }
      else if (verdict === 'killed') { k++; stats.killed++; process.stdout.write('.'); }
      else {
        s++; stats.survived++; process.stdout.write('S');
        const lineNo = lineOf(original, mut.at);
        const src = lineTextAt(original, mut.at);
        const off = mut.at - (original.lastIndexOf('\n', mut.at - 1) + 1);
        const dst = src.slice(0, off) + mut.to + src.slice(off + mut.len);
        if (!survivors.has(rel)) survivors.set(rel, []);
        survivors.get(rel).push({ line: lineNo, kind: mut.kind, from: src.trim(), to: dst.trim() });
      }
    }
  } finally {
    if (inFlight.has(path)) restoreVerified(path, originalBytes);
  }
  console.log(`  ${k} killed, ${s} survived, ${u} did not compile`);
}

// ── the report ──────────────────────────────────────────────────────────────

const scored = stats.killed + stats.survived;
const rate = scored ? (stats.killed / scored) * 100 : 0;

console.log('');
if (interrupted) console.log('!!  interrupted — the figures below cover only the mutations that finished.');
console.log('── summary ' + '─'.repeat(58));
console.log(`  applied           ${stats.applied}`);
console.log(`  killed            ${stats.killed}`);
console.log(`  survived          ${stats.survived}`);
const byKind = [...uncompiledBy].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`  did not compile   ${stats.uncompiled}   (neither a kill nor a survivor${byKind ? `; ${byKind}` : ''})`);
console.log(`  kill rate         ${scored ? rate.toFixed(1) : '—'}%   (killed / (killed + survived))`);

if (survivors.size) {
  console.log('');
  console.log('── survivors ' + '─'.repeat(56));
  console.log('  Each of these is a change no test noticed. Either the behaviour is');
  console.log('  genuinely unasserted, or the mutation happens not to matter.');
  for (const [rel, list] of [...survivors].sort()) {
    console.log('');
    console.log(`  ${rel}`);
    for (const s of list) {
      console.log(`    line ${String(s.line).padStart(4)}  [${s.kind}]`);
      console.log(`      -  ${s.from}`);
      console.log(`      +  ${s.to}`);
    }
  }
}

// Leave .tmp holding a build of the real sources, not of the last mutant.
compile();

const after = gitPorcelain();
const newDirt = after.filter((l) => !before.includes(l));
// Only dirt on a file this run actually wrote to can be this script's doing.
// Anything else is somebody else's edit landing while the run was going, which
// is worth mentioning and is not a restore failure.
const touched = new Set(files.map((f) => relative(ROOT, f)));
const mine = newDirt.filter((l) => touched.has(l.slice(3).trim()));
const theirs = newDirt.filter((l) => !mine.includes(l));
console.log('');
if (mine.length) {
  console.log('!!  A FILE THIS RUN MUTATED IS DIRTY. The restore did not hold:');
  for (const l of mine) console.log(`      ${l}`);
  console.log('!!  Recover with git checkout -- <path> before doing anything else.');
} else {
  console.log(`git status: every mutated file is byte-identical to how the run found it (${before.length} pre-existing entr${before.length === 1 ? 'y' : 'ies'}, untouched).`);
}
if (theirs.length) {
  console.log('    (git also changed under files this run never wrote to — a concurrent edit, not this script:');
  for (const l of theirs) console.log(`       ${l}`);
  console.log('    )');
}

if (aborted || mine.length) process.exit(3);
if (interrupted) process.exit(130);
if (opts.failUnder !== null && scored && rate < opts.failUnder) {
  console.log(`\nkill rate ${rate.toFixed(1)}% is under --fail-under ${opts.failUnder}.`);
  process.exit(1);
}
process.exit(0);
