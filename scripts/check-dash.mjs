// No em dash as punctuation in anything a member, coach or owner reads.
//
// A TestFlight tester on member build 45 wrote, in the feedback screen:
//
//     The repetitive use of "—" symbol makes it extremely obvious that the app
//     was built with a significant AI usage.
//
// They were right. On 21 Sep 2026 there were about 2,900 of them inside
// user-facing strings across roughly 590 files, most written while this app
// was being built, and a member reads that as a machine talking. That costs the
// one thing a coaching app sells, which is a person on the other end. They were
// all rewritten by hand, by meaning: a full stop, a colon, a comma, brackets, or
// the middle dot this app already uses between a label and its detail.
//
// This gate keeps it that way. It reads the source with the TypeScript parser,
// not a regex, so it sees exactly what reaches the screen: string literals,
// template text and JSX text. Code comments are not read; nobody sees them.
// A regex pass was tried first and missed paragraphs of JSX text that wrap
// across lines, the `—` escape and the `&mdash;` entity. All three are
// caught here.
//
// ── What is allowed ──────────────────────────────────────────────────────
//
// A LONE dash. When a whole string is nothing but "—", it is not punctuation;
// it is this app's sign for a figure it does not know. `fig()` in
// src/ui/kit.tsx produces it, scripts/check-prose.mjs is built around it, and
// the rule it protects is that an unknown is not a zero. Several screens also
// compare against that exact string, so it is data as much as display.
//
// Anything else needs `dash-ok: <reason>` on the same line or the line above,
// the way `prose-ok:` works in scripts/check-prose.mjs. A bare marker does not
// count. The reason is the point: telemetry text that must match other copies
// of itself, a string code splits on, a label whose dash stands for an unknown
// count. If you are reaching for the marker to keep a sentence as it is, the
// sentence is the thing to change.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = new URL('..', import.meta.url).pathname;
const DASH = /—|\\u2014|&mdash;/;
const LONE = /^(?:—|\\u2014|&mdash;)$/;

const files = execSync('git ls-files app src/ui src/lib', { cwd: ROOT })
  .toString()
  .split('\n')
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'));

const K = ts.SyntaxKind;
const TEXT_KINDS = new Set([
  K.StringLiteral, K.NoSubstitutionTemplateLiteral,
  K.TemplateHead, K.TemplateMiddle, K.TemplateTail, K.JsxText,
]);

function excused(lines, line) {
  const near = [lines[line] ?? '', line > 0 ? lines[line - 1] : ''].join('\n');
  return /dash-ok:\s*\S/.test(near);
}

const hits = [];
for (const f of files) {
  const src = readFileSync(ROOT + f, 'utf8');
  if (!DASH.test(src)) continue;
  const lines = src.split('\n');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true,
    f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    if (TEXT_KINDS.has(n.kind)) {
      const raw = n.getText(sf);
      if (DASH.test(raw)) {
        const body = raw.replace(/^['"`}]|['"`]$|\$\{$/g, '').trim();
        const start = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
        const end = sf.getLineAndCharacterOfPosition(n.getEnd()).line;
        let ok = LONE.test(body);
        for (let l = start; !ok && l <= end; l++) ok = excused(lines, l);
        if (!ok) hits.push(`${f}:${start + 1}  ${raw.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

if (hits.length) {
  console.error(`check-dash — ${hits.length} em dash${hits.length === 1 ? '' : 'es'} used as punctuation in text people read:\n`);
  for (const h of hits) console.error('  ' + h);
  console.error(`
Rewrite the sentence by what the dash meant: a full stop between two thoughts,
a colon before an explanation, commas or brackets around an aside, or " · "
between a label and its detail. A lone "—" standing for an unknown figure is
fine as it is. If the dash genuinely must stay, put "dash-ok: <reason>" on that
line or the one above it. See the header of scripts/check-dash.mjs for why.`);
  process.exit(1);
}
console.log(`check-dash — ok, ${files.length} files; no em dash used as punctuation in user-facing text`);
