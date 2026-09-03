#!/usr/bin/env node
// A colour typed as a hex is a colour nothing measures.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
// `#f0c04e` is the amber the console's DARK theme used to carry. It was
// re-measured, moved, and the token definitions in studio-web/app/globals.css
// followed. Fifty-six literal copies of the old value, typed straight into
// `color:` and `style={{ color: … }}` across the console's own pages, did not:
// nothing anywhere connected them to the token they were a snapshot of.
//
// On the daylight console — `--bg: #f4f6fb` — `#f0c04e` measures 1.57:1.
// WCAG AA asks 4.5:1 of body text. That is not "a bit low", it is the far side
// of unreadable, and roughly twenty of the fifty-six were the ink on a BLOCKER
// sentence: "this run cannot be settled", "this month cannot be closed". The
// console rendered the one sentence that stops an owner from paying somebody
// twice in the least readable colour it had, on the theme most gyms use, in an
// office with a window. All fifty-six have now been replaced with the
// `var(--warn)` / `var(--crit)` tokens that globals.css already measures.
//
// ── why a gate, and why THIS gate ─────────────────────────────────────────
//
// `scripts/check-contrast.mjs` is the check that should have caught it and
// structurally could not. Its rule 1 lints `color:` for status TOKENS used as
// ink, and it runs over `app` and `src/ui` only — the React Native tree. Its
// rule 2 measures studio-web/app/globals.css, but only the custom properties
// declared in the two `:root` blocks. So the console's TSX — 44 files of it —
// was read by neither rule, and its own header says the words out loud without
// the console in scope: "It only knows the tokens in STATUS. A raw '#d34646'
// typed into a style passes, and would be just as unreadable."
//
// That is the gap. A token is measured every time this suite runs; a hex is
// measured never, and the moment it is typed it stops tracking the palette it
// was copied from. Re-measure the tokens again next year and the same
// fifty-six-site drift starts over, silently, in the same colour.
//
// Fixing the fifty-six by hand does not stop the fifty-seventh. This does.
//
// ── what this checks ──────────────────────────────────────────────────────
//
// A `color:` property under studio-web whose value contains a literal hex. In
// TSX that is a style object — `style={{ color: '#f0c04e' }}`, or a ternary
// with one in either arm, which is the commoner of the two forms. In
// globals.css it is a rule body: `.blocker { color: #f0c04e; }`.
//
// `color` and nothing else. `background`, `borderColor`, `fill` and the rest
// take a mark's colour by definition and have their own, much lower, floor —
// `color` on a style is text ink and only ever text ink, which is what makes a
// one-property rule possible. It is the same narrowing check-contrast.mjs makes
// and for the same reason.
//
// A CUSTOM PROPERTY DEFINITION is not a violation. `--warn: #956703;` in
// globals.css is the palette itself; hexes have to exist somewhere, and that
// somewhere is the one place check-contrast.mjs already measures every value
// against every ground it can be drawn on. This gate is about the copies.
//
// ── what it CANNOT see, and must not be read as claiming ──────────────────
//
// It is a lint over source text. It renders nothing and resolves nothing.
//
//   · A hex reached through a name is invisible to it. `const AMBER =
//     '#f0c04e'` two files away, a helper returning a colour, a `tone` prop —
//     all pass. So does `color: theme.amber`.
//   · It reads one line at a time. `color:` on one line with its value on the
//     next is a miss, as is a value carrying a comma inside a function call
//     (`rgba(…)`), where the value is cut at the comma.
//   · It says nothing about whether the hex it found is READABLE. The measured
//     ratio in the message is there to make the cost concrete, not to gate on:
//     a hex that happens to clear 4.5:1 today is still a colour that will not
//     move when the palette does, which is the whole defect.
//   · `fill`, `stroke` and `background` are out of scope, deliberately. An SVG
//     mark needs 3:1 and this gate has no way to tell a mark from a glyph.
//
// It catches the form the mistake actually took, fifty-six times, and that is
// the claim it makes.
//
// ── the escape hatch ──────────────────────────────────────────────────────
//
// There are places where a literal is correct rather than lazy, and both of
// them already argue their own case in their own files. Say so on the line, or
// in the unbroken run of comment lines directly above it:
//
//     // ink-hex-ok: globals.css has not loaded at this point, so var(--ink)
//     // resolves to nothing and the page is black on black
//
// The sentence is the point, as with `no-error-ok:` in check-reads.mjs and
// `sql-cap-ok:` in check-sql-caps.mjs. Writing it means saying out loud why
// this colour will not follow the palette, which is the question nobody asked
// the first fifty-six times.
//
// Both files annotated below were annotated rather than ratcheted, which is the
// opposite of the choice check-sql-caps.mjs made and for a stated reason: it
// was written in a lane that did not own the files it was flagging, and there
// the judgement belonged to somebody else. Here the judgement is already
// WRITTEN DOWN in the flagged files themselves — global-error.tsx's header says
// "This is the one file in the console where that is correct rather than lazy",
// and the `@media print` block says a printed dark theme is a page of toner —
// so the marker transcribes an argument that exists rather than inventing one.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

/** The console. Not the React Native tree — check-contrast.mjs owns that. */
const ROOTS = ['studio-web/app', 'studio-web/components', 'studio-web/lib'];
const CSS = 'studio-web/app/globals.css';

/**
 * `color:` — and not `backgroundColor`, `borderColor`, `caretColor`,
 * `accent-color` or `text-decoration-color`. The character before it must be
 * neither a letter nor a hyphen, which excludes every compound property in both
 * spellings while still matching at the start of a line, after `{`, and after
 * `, `.
 */
const COLOR_PROP = /(^|[^A-Za-z-])color\s*:/;

/** A custom property being DEFINED. The palette itself, which is measured. */
const CUSTOM_PROP = /^\s*--[a-z0-9-]+\s*:/i;

/** A literal colour: #rgb, #rrggbb, #rrggbbaa. */
const HEX = /#[0-9a-fA-F]{3,8}\b/;

/** Where a value ends. Cut at the next colour property on the line, or at the
 *  first separator, so `color: '#fff', background: '#000'` reads only its own. */
const VALUE_END = /[,;}]/;
const NEXT_COLOR_PROP = /[A-Za-z]Color\s*:/;

const MARKER = /ink-hex-ok:\s*\S/;

/**
 * Files that still carry an unexcused raw ink hex, with the count in each.
 *
 * A ratchet, not an ignore list, on the same terms as scripts/check-caps.mjs: a
 * file listed at 2 passes at 2 and fails at 3, and a count that has DROPPED
 * fails too — asking for the number to come down with the work, so the list can
 * only ever shrink and can never quietly absorb a new one.
 *
 * It is empty, and that is a statement rather than an omission: on the run that
 * added this gate every site it found was either already a token or genuinely
 * correct as a literal, and the correct ones carry a written `ink-hex-ok:`
 * where a reader will meet them. Nothing was hidden here to make the suite go
 * green. If you are adding an entry, the honest form is `['some/file.tsx', 3]`
 * plus a comment saying what the three are and what the edit is.
 */
const KNOWN = new Map([]);

/* ── the palette, read from the file that is measured ─────────────────────── */

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function expand(hex) {
  const h = String(hex).replace(/^#/, '');
  if (h.length === 3) return h.split('').map((c) => c + c).join('');
  if (h.length >= 6) return h.slice(0, 6);
  return null;
}

/** WCAG 2.x relative luminance and contrast, mirroring check-contrast.mjs,
 *  which mirrors src/lib/a11y.ts. Three copies because none of the three can
 *  import either of the others; the arithmetic is fixed by the spec. */
function luminance(hex) {
  const h = expand(hex);
  if (!h || !/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const x = luminance(a), y = luminance(b);
  if (x == null || y == null) return null;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function distance(a, b) {
  const x = expand(a), y = expand(b);
  if (!x || !y) return Infinity;
  return [0, 2, 4].reduce((acc, i) => {
    const d = parseInt(x.slice(i, i + 2), 16) - parseInt(y.slice(i, i + 2), 16);
    return acc + d * d;
  }, 0);
}

/** The custom properties declared in one selector's block. */
function blockVars(css, selector) {
  const at = css.indexOf(selector);
  if (at < 0) return {};
  const open = css.indexOf('{', at);
  const close = css.indexOf('\n}', open);
  if (open < 0 || close < 0) return {};
  const vars = {};
  for (const m of css.slice(open, close).matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    vars[m[1]] = m[2];
  }
  return vars;
}

const cssPath = join(ROOT, CSS);
if (!existsSync(cssPath)) {
  console.error(`check-console-ink: ${CSS} is not there, so there is no palette to name as the fix. Refusing to pass.`);
  process.exit(1);
}
const cssText = readFileSync(cssPath, 'utf8');
const THEMES = [
  ['daylight', blockVars(cssText, ':root[data-theme="light"]')],
  ['dark', blockVars(cssText, ':root {')],
];

// The second empty-set guard. A gate that cannot name the token to use instead
// is a gate that prints "this is wrong" and stops, and the first thing anybody
// does with one of those is delete the line it flagged.
const tokenCount = new Set(THEMES.flatMap(([, v]) => Object.keys(v))).size;
if (tokenCount < 8) {
  console.error(`check-console-ink: only ${tokenCount} custom properties could be read out of ${CSS}, which cannot be right — the :root blocks have probably moved. Refusing to pass.`);
  process.exit(1);
}

/** Roles a `color:` could honestly have wanted. Grounds are not among them. */
const ROLES = ['ink', 'ink2', 'ink3', 'brand', 'good', 'warn', 'serious', 'crit'];

/** The token nearest this hex, across both themes, and the worst ratio the hex
 *  itself measures against the two page grounds. */
function advise(hex) {
  let best = null;
  for (const [theme, vars] of THEMES) {
    for (const name of ROLES) {
      if (!vars[name]) continue;
      const d = distance(hex, vars[name]);
      if (!best || d < best.d) best = { d, name, theme, value: vars[name] };
    }
  }
  let worst = null;
  for (const [theme, vars] of THEMES) {
    const r = vars.bg ? ratio(hex, vars.bg) : null;
    if (r != null && (!worst || r < worst.r)) worst = { r, theme, bg: vars.bg };
  }
  return { best, worst };
}

/* ── the scan ─────────────────────────────────────────────────────────────── */

/**
 * Which lines are comment, as a flag per line.
 *
 * Not a regex per line, because the reasons this codebase writes are PARAGRAPHS
 * and a paragraph's second line looks like ordinary source: `{/* …` and `/* …`
 * open a run that continues until `*␘/`, and every line of that run is comment
 * whatever it starts with. A per-line prefix test broke the run at line two and
 * made a written reason stop excusing the line it was written above — which is
 * the one failure that teaches people to stop writing the reason.
 *
 * `{/* … *␘/}` is included because that is how you comment above an element in
 * JSX, and half the lines this gate flags are JSX.
 *
 * String literals are not tracked. A `'/*'` inside a string would open a run
 * that is not there; there is none in this tree, and the failure mode is a
 * marker being honoured slightly too widely rather than a violation being
 * missed.
 */
function commentFlags(lines) {
  const flags = new Array(lines.length).fill(false);
  let inBlock = false;
  lines.forEach((l, i) => {
    if (inBlock) {
      flags[i] = true;
      if (l.includes('*/')) inBlock = false;
      return;
    }
    if (!/^\s*(\/\/|\{?\/\*)/.test(l)) return;
    flags[i] = true;
    const open = l.lastIndexOf('/*');
    if (open >= 0 && l.indexOf('*/', open) < 0) inBlock = true;
  });
  return flags;
}

/** Does a marker apply to `line` (1-based)? On the line itself, or anywhere in
 *  the unbroken run of comment and blank lines directly above it. */
function markedAbove(lines, flags, line) {
  if (MARKER.test(lines[line - 1] ?? '')) return true;
  for (let i = line - 2; i >= 0; i--) {
    if (!/\S/.test(lines[i])) continue;
    if (!flags[i]) return false;
    if (MARKER.test(lines[i])) return true;
  }
  return false;
}

const files = [];
/* Counted per ROOT, not just in total. A single total threshold cannot notice a
 * root going missing, because the other roots cover for it — see
 * scripts/gate-floor.mjs for the arithmetic and why 150-of-781 was not a guard. */
const perRoot = new Map();
for (const r of ROOTS) {
  const before = files.length;
  walk(join(ROOT, r), files);
  perRoot.set(r, files.length - before);
}
assertRootFloors('check:console-ink', perRoot);

// The empty-set guard every gate here has, and the reason check-reads.mjs
// carries one: its first version walked from '.' and filtered on a path prefix
// that join() normalises away, and reported success having read nothing.
if (files.length < 30) {
  console.error(`check-console-ink: only found ${files.length} files under ${ROOTS.join(', ')}, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

const found = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  const flags = commentFlags(lines);
  lines.forEach((line, i) => {
    // A comment describing the rule is not a breach of it.
    if (flags[i]) return;
    // The palette itself. Measured by check-contrast.mjs, not copied.
    if (CUSTOM_PROP.test(line)) return;
    const at = line.search(COLOR_PROP);
    if (at < 0) return;
    let val = line.slice(line.indexOf(':', at) + 1);
    const nextProp = val.search(NEXT_COLOR_PROP);
    if (nextProp >= 0) val = val.slice(0, nextProp);
    const end = val.search(VALUE_END);
    if (end >= 0) val = val.slice(0, end);
    const hex = val.match(HEX);
    if (!hex) return;
    if (markedAbove(lines, flags, i + 1)) return;
    found.push({ rel, line: i + 1, hex: hex[0], text: line.trim() });
  });
}

/* ── the ratchet ──────────────────────────────────────────────────────────── */

const counts = new Map();
for (const f of found) counts.set(f.rel, (counts.get(f.rel) ?? 0) + 1);

const fresh = [];
for (const [rel, n] of counts) {
  const allowed = KNOWN.get(rel) ?? 0;
  if (n > allowed) fresh.push(...found.filter((f) => f.rel === rel));
}
const stale = [...KNOWN.entries()].filter(([rel, n]) => (counts.get(rel) ?? 0) < n);

if (fresh.length) {
  fresh.sort((a, b) => (a.rel === b.rel ? a.line - b.line : a.rel < b.rel ? -1 : 1));
  console.error(`\n${fresh.length} raw hex colour${fresh.length === 1 ? '' : 's'} used as text ink in the console:\n`);
  for (const f of fresh) {
    const { best, worst } = advise(f.hex);
    console.error(`  ${f.rel}:${f.line}`);
    console.error(`    ${f.text.slice(0, 110)}`);
    console.error(`    wrong: ${f.hex} is a literal. Nothing measures it, and it stopped tracking the`);
    console.error(`           palette the moment it was typed — which is how ${'#f0c04e'} came to sit at`);
    console.error(`           56 sites in this console after the token it was copied from had moved.`);
    if (worst) {
      console.error(`           As it stands it measures ${worst.r.toFixed(2)}:1 against the ${worst.theme} page ground`);
      console.error(`           (--bg ${worst.bg}) — the ground it sits on unless this element brings`);
      console.error(`           its own. AA asks 4.5:1 of text.`);
    }
    if (best) {
      console.error(`    right: var(--${best.name}) — the nearest measured token (${best.value}, ${best.theme}).`);
      console.error(`           Every token in ${CSS} is checked against every ground it`);
      console.error(`           can be drawn on by scripts/check-contrast.mjs, every run. Read the`);
      console.error(`           line and pick the token by ROLE rather than by hue: a warning is`);
      console.error(`           var(--warn), a refusal is var(--crit), ordinary words are var(--ink).`);
    }
    console.error(`           If the literal is genuinely right here, say why: // ink-hex-ok: <why this`);
    console.error(`           colour cannot follow the palette>\n`);
  }
  console.error('About twenty of the fifty-six were the ink on a sentence that said something could');
  console.error('NOT be done — a run that cannot be settled, a month that cannot be closed. The');
  console.error('console rendered its most important sentence at 1.57:1 on the theme most gyms');
  console.error('use. That is what an unmeasured colour looks like on a screen.\n');
  process.exit(1);
}

if (stale.length) {
  console.error(`\n${stale.length} ratchet entr${stale.length === 1 ? 'y is' : 'ies are'} out of date — the file is cleaner than the list says:\n`);
  for (const [rel, n] of stale) {
    console.error(`  ${rel}: listed at ${n}, now ${counts.get(rel) ?? 0}. Bring the number down, or delete the entry.`);
  }
  console.error('\nA list that over-states what is wrong is how a ratchet turns into an ignore list.\n');
  process.exit(1);
}

const excused = files.reduce((acc, file) => {
  const lines = readFileSync(file, 'utf8').split('\n');
  return acc + lines.filter((l) => MARKER.test(l)).length;
}, 0);
console.log(
  `console ink ok — ${files.length} files under studio-web scanned against ${tokenCount} measured tokens; `
  + `no raw hex is used as text ink${excused ? `, ${excused} literal${excused === 1 ? '' : 's'} excused in writing` : ''}`
  + (KNOWN.size ? `, ${KNOWN.size} file${KNOWN.size === 1 ? '' : 's'} ratcheted` : ''),
);
