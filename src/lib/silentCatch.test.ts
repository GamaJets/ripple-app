// No `catch` in the app tree may be empty without saying why.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// docs/ROADMAP.md Phase 8 asks for an audit of the discarded catches, on the
// grounds that a write which silently fails is worse than one that errors. The
// audit itself is judgement — every site had to be read and classified, and
// several were correctly left doing nothing — but the outcome of that judgement
// is a fact about the source that a test can hold:
//
//   an empty catch with a reason in it is a decision;
//   an empty catch without one is indistinguishable from an oversight.
//
// That is the whole difference. Nobody reviewing `} catch {}` can tell whether
// the author decided the failure was ignorable or simply never thought about
// it, and that ambiguity is what let a hundred of them accumulate. Once every
// one of them carries a sentence, a NEW bare one is visible as a new decision
// nobody wrote down — which is exactly the moment to ask about it.
//
// What this does NOT assert: that the reason is a good one, or that the catch
// should be empty at all. `src/lib/reportError.ts` is the path for a swallow
// that should leave a trace, and `src/lib/wroteRows.ts` is the rule for a write
// whose failure the user must be told about. Neither is checkable here. This is
// a tripwire on the one property that is.
//
// Scope is `app/` and `src/`, which is the phone app. `scripts/` and
// `supabase/functions/` are deliberately out: they run on a laptop and on a
// server, where a swallowed failure lands in a log somebody reads rather than
// on a screen somebody trusts.
//
// Compile with tsc then run with node, like consoleRoutes.test.ts.
export {};

/**
 * The filesystem, reached through a locally-declared `require` rather than an
 * `import`, for the reason set out at length in consoleRoutes.test.ts: the root
 * `tsconfig.json` is Expo's, carries no node types, and type-checks `src/**`
 * for the phone app, so `import … from 'node:fs'` fails there with TS2591.
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
const eq = (a: unknown, b: unknown, msg: string) =>
  ok(Object.is(a, b), `${msg} — got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const ROOTS = ['app', 'src'];

/**
 * The shape being looked for, built from a string rather than written as a
 * regex literal.
 *
 * Deliberate: a literal would put the exact character sequence this file exists
 * to forbid into a file that scans itself, and the first thing a reader would
 * have to work out is why the test does not fail on its own source.
 */
const EMPTY_CATCH = 'catch\\s*(?:\\([^)]*\\))?\\s*\\{\\s*\\}';

/**
 * Where a line comment starts, or -1.
 *
 * `://` does not count, so the slashes in a url inside a string do not read as
 * the beginning of a comment.
 */
function commentAt(s: string): number {
  for (let i = 0; i + 1 < s.length; i++) {
    if (s[i] === '/' && s[i + 1] === '/' && s[i - 1] !== ':') return i;
  }
  return -1;
}

/**
 * The lines of `src` carrying a catch whose braces hold nothing at all.
 *
 * The braces are read as they were written. An earlier version of this stripped
 * comments first and then looked for `{}` — which reported eleven catches whose
 * reason is a `/* … *\/` on its own line BETWEEN the braces, the commonest way
 * this codebase writes one. The reason being inside the braces is the whole
 * point; a check that deletes it before looking is asking a different question.
 *
 * What still has to be excluded is prose ABOUT the shape, which the Phase 8
 * fixes left all over the codebase — each names the pattern it replaced. A
 * match is skipped when its line begins a comment (`//`, `*`, `/*`) or when a
 * line comment opens earlier on the same line. That is not a parser: a string
 * literal holding the sequence would be reported. One exists, in this file's
 * own sample below, and this file is the only file skipped.
 */
function bareCatchLines(src: string): number[] {
  const re = new RegExp(EMPTY_CATCH, 'g');
  const out: number[] = [];
  let m: { index: number } | null;
  while ((m = re.exec(src) as { index: number } | null) != null) {
    const before = src.slice(0, m.index);
    const lineStart = before.lastIndexOf('\n') + 1;
    const head = src.slice(lineStart, m.index);
    const trimmed = src.slice(lineStart).split('\n')[0].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (commentAt(head) >= 0) continue;
    out.push(before.split('\n').length);
  }
  return out;
}

const SELF = 'silentCatch.test.ts';

/** Every .ts/.tsx file under `dir`, skipping build output and dot-directories
 *  — `.claude/worktrees` holds copies of this same tree. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === SELF) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Where the empty catches are in one file, as `path:line`. */
function bareCatches(file: string): string[] {
  return bareCatchLines(readFileSync(file, 'utf8')).map((n) => `${file}:${n}`);
}

for (const root of ROOTS) {
  if (existsSync(root)) continue;
  // Run from somewhere that is not the repository root. Loud rather than a
  // suite that silently asserts nothing and prints "ok".
  console.error(`silentCatch.test.ts — ${root}/ not found; run from the repository root.`);
  process.exit(1);
}

/* ── the detector answers on known input ──────────────────────────────────── */
//
// First, because everything below is an assertion that a search found nothing,
// and a search that cannot find anything also finds nothing. Both spellings the
// codebase actually used, plus the two-line form, plus the prose that must NOT
// count.

const REASON = '/* a reason */';
const SAMPLE = [
  'try { a(); } catch {}',                          // 1
  'try { b(); } catch { }',                         // 2
  'try { c(); } catch (e) {}',                      // 3
  'try { d(); } catch {',                           // 4
  '}',                                              // 5
  'try { e(); } catch { ' + REASON + ' }',          // 6
  'try { f(); } catch {',                           // 7
  '  ' + REASON,                                    // 8
  '}',                                              // 9
  '// prose about a catch {} in a comment',         // 10
  ' * prose about a catch {} in a doc block',       // 11
  'const u = "https://example.test/x"; // catch {}', // 12
].join('\n');

const sampleHits = bareCatchLines(SAMPLE);

eq(sampleHits.join(','), '1,2,3,4', 'the detector finds all three spellings and the two-line form, and nothing else');
ok(!sampleHits.includes(6), 'a catch with a reason on the same line is not a hit');
ok(!sampleHits.includes(7), 'a catch with a reason on its own line between the braces is not a hit — the shape most of this codebase uses');
ok(!sampleHits.includes(10), 'a line comment about the shape is not a hit');
ok(!sampleHits.includes(11), 'a doc-block line about the shape is not a hit');
ok(!sampleHits.includes(12), 'a trailing comment about the shape is not a hit, and the url before it is not mistaken for one');

/* ── and the tree is clean ────────────────────────────────────────────────── */

const files = ROOTS.flatMap((r) => sources(r));
ok(files.length >= 300, `the scan covered the app tree (found ${files.length} source files)`);

const found = files.flatMap(bareCatches);
ok(found.length === 0, `every swallowed failure says why it is ignorable — these do not:\n  ${found.join('\n  ')}`);

if (errors.length) {
  console.error('silentCatch.test.ts FAILED');
  for (const e of errors) console.error('  ✗ ' + e);
  process.exit(1);
}
console.log(`silentCatch.test.ts — ok (${files.length} files, no unexplained empty catch)`);
