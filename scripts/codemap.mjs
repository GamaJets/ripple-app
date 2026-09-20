#!/usr/bin/env node
// A line-anchored index of the files that are too big to read.
//
// ── why this exists ───────────────────────────────────────────────────────
//
// Measured on 20 Sep 2026, across 325,650 assistant turns of transcript: this
// repository's sessions averaged 500,000-540,000 tokens of context per turn.
// Every turn re-reads the whole context, so that average IS the bill.
//
// The cause is not the number of files, it is the size of eight of them:
//
//     app/(client)/workouts.tsx     7,356 lines   467 KB   ~117,000 tokens
//     src/lib/coverage.test.ts      5,228 lines   349 KB    ~87,000 tokens
//     app/(trainer)/calendar.tsx    5,153 lines   311 KB    ~78,000 tokens
//     app/(trainer)/builder.tsx     5,103 lines   317 KB    ~79,000 tokens
//     app/(trainer)/dashboard.tsx   4,977 lines   319 KB    ~80,000 tokens
//
// Opening workouts.tsx costs more than half a 200k context window, and once it
// is open it is re-billed on every subsequent turn of that session. A redesign
// session that touches four screens spends ~350,000 tokens on file contents
// before it has thought about anything.
//
// The fix is not to split the files. Splitting a 7,356-line screen is a large
// refactor with real regression risk, and the reason to do it would be human
// legibility, not this. The fix is to stop reading them whole: an index with
// line numbers turns "read 7,356 lines" into "read 3,180-3,340".
//
// ── what counts as an anchor ──────────────────────────────────────────────
//
// Four things, chosen because they are what somebody actually navigates by:
//
//   · `// ── heading ──` banner comments, which this codebase already uses to
//     mark sections, at any indent. These are the best anchors in the file
//     because a person wrote them to mean "a new thing starts here".
//   · function declarations at any indent, including nested helpers — in a
//     5,000-line screen most of the logic is nested inside one component.
//   · `const x = useCallback/useMemo/async/(...)` — the React idiom for what
//     would otherwise be a method.
//   · `export default`, which is where the screen itself begins.
//
// Deliberately NOT a TypeScript parser. A regex over lines cannot be wrong in
// a way that matters here: a missed anchor costs a slightly coarser jump, and
// a spurious one costs a line of noise. Neither is worth a dependency or the
// runtime of a real parse over 1,704 files.
//
// ── staleness ─────────────────────────────────────────────────────────────
//
// Line numbers drift on every edit above them, so this file is generated, not
// maintained. Re-run `npm run codemap` after any large edit. The symbol tables
// sit inside fenced code blocks so that check-doc-paths.mjs skips them, which
// is correct: a drifted line number in a generated index is a stale index, not
// a false claim about the tree, and a gate that failed on it would fire on
// every commit and be switched off by the second week.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/** Below this, just read the file. A 1,400-line file costs ~35k tokens, which is
 *  affordable once; the index only pays for itself on the genuine monsters, and
 *  an index too big to grep cheaply is just another monster. */
const MIN_LINES = 1500;

const BANNER = /^\s*\/\/\s*[─=-]{2,}|^\s*\/\/\s*──/;
const FUNC = /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
const ARROW = /^(\s*)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=][^=]*?(?:useCallback|useMemo|async\s*\(|\([^)]*\)\s*(?::[^=]+)?=>|function)/;
const TYPE = /^(\s*)(?:export\s+)?(?:type|interface|class)\s+([A-Za-z_$][\w$]*)/;
const DEFAULT_EXPORT = /^export\s+default\s+(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))/;

const files = execSync("git ls-files '*.ts' '*.tsx' '*.mjs'", { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const big = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = text.split('\n');
  if (lines.length < MIN_LINES) continue;
  big.push({ file: f, lines, bytes: Buffer.byteLength(text) });
}
big.sort((a, b) => b.lines.length - a.lines.length);

const anchorsFor = (lines) => {
  const out = [];
  lines.forEach((line, i) => {
    const n = i + 1;
    if (BANNER.test(line)) {
      const label = line.replace(/^\s*\/\/\s*/, '').replace(/[─=-]{2,}/g, '').trim();
      if (label) out.push({ n, kind: '§', label });
      return;
    }
    let m = line.match(DEFAULT_EXPORT);
    if (m) { out.push({ n, kind: 'default', label: m[1] || m[2] }); return; }
    m = line.match(FUNC);
    if (m) { out.push({ n, kind: 'fn', label: m[2], depth: m[1].length }); return; }
    m = line.match(ARROW);
    if (m) { out.push({ n, kind: 'fn', label: m[2], depth: m[1].length }); return; }
    m = line.match(TYPE);
    if (m && m[1].length === 0) out.push({ n, kind: 'type', label: m[2] });
  });
  return out;
};

const tok = (bytes) => Math.round(bytes / 4 / 1000);

let md = `# Code map

Generated by \`scripts/codemap.mjs\` — run \`npm run codemap\` to refresh.
Do not edit by hand; line numbers drift on every edit above them.

Every file here is over ${MIN_LINES} lines. Read a range out of one, never the
whole thing: the \`~tok\` column is roughly what opening it costs, and that cost
is paid again on every turn of the session that opened it.

| lines | ~tok | file |
| ----: | ---: | ---- |
`;

for (const b of big) {
  md += `| ${b.lines.length.toLocaleString()} | ${tok(b.bytes)}k | \`${b.file}\` |\n`;
}

md += `\nTotal: ${big.length} files, ${big.reduce((s, b) => s + b.lines.length, 0).toLocaleString()} lines, ~${big.reduce((s, b) => s + tok(b.bytes), 0)}k tokens if every one were read whole.\n`;

for (const b of big) {
  const a = anchorsFor(b.lines);
  md += `\n## \`${b.file}\`\n\n${b.lines.length.toLocaleString()} lines · ~${tok(b.bytes)}k tokens · ${a.length} anchors\n\n\`\`\`\n`;
  if (!a.length) {
    md += '(no anchors matched — read the head of the file to orient)\n';
  } else {
    for (let i = 0; i < a.length; i++) {
      const end = i + 1 < a.length ? a[i + 1].n - 1 : b.lines.length;
      const span = `${a[i].n}-${end}`;
      const indent = a[i].depth ? ' '.repeat(Math.min(a[i].depth, 8)) : '';
      md += `${span.padEnd(13)} ${a[i].kind.padEnd(8)} ${indent}${a[i].label}\n`;
    }
  }
  md += '```\n';
}

writeFileSync('docs/CODEMAP.md', md);
console.log(`docs/CODEMAP.md: ${big.length} files indexed, ${md.length} bytes (~${tok(Buffer.byteLength(md))}k tokens)`);
