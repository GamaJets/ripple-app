#!/usr/bin/env node
// A layout says "start" and "end", not "left" and "right".
//
// ── what went wrong ───────────────────────────────────────────────────────
//
// Nothing yet, and that is the only reason this check could be added in one
// evening rather than argued over for a month. Repple ships one binary to
// three apps and white-labels it to whoever buys it, and the first gym in
// Dubai or Riyadh that sets a handset to Arabic gets a mirrored layout from
// React Native for free — every `flexDirection: 'row'` swaps ends, every
// `alignItems: 'flex-start'` moves to the other edge — EXCEPT the places that
// named a physical side. Those stay where they were, and the result is not a
// foreign-looking screen, it is a broken one: a coach's roster row whose avatar
// has moved to the right while its 12pt of `marginLeft` stayed on the left, so
// the name now overlaps the face.
//
// The sweep that added this converted 83 of those properties across the three
// app directories and the shared kit. This is what stops the 84th.
//
// ── the rule ──────────────────────────────────────────────────────────────
//
// In `app/**` and `src/ui/**`, a style property that names a physical side
// must use its logical spelling instead:
//
//     marginLeft      → marginStart          left:  → start:
//     marginRight     → marginEnd            right: → end:
//     paddingLeft     → paddingStart
//     paddingRight    → paddingEnd
//     borderLeftWidth → borderStartWidth
//     borderLeftColor → borderStartColor     (and the Right/End pair)
//     textAlign: 'left' | 'right'            → see below
//
// React Native resolves every one of those against the reader's own direction,
// on both platforms, with no branch at the call site — which is the whole
// argument for converting rather than for a `useIsRTL()` hook in 200 screens.
//
// `textAlign` is the one real gap: it takes 'auto' | 'left' | 'right' |
// 'center' | 'justify' and has no 'start' or 'end'. 'auto' IS start, so
// leading-aligned text needs nothing. Trailing-aligned text — the value in a
// label-and-value row — has no spelling and reads END_ALIGN from
// src/ui/direction.ts, which resolves it once for the process.
//
// ── what this deliberately does NOT flag ──────────────────────────────────
//
//  1. `hitSlop`. React Native's Insets type is {top,left,bottom,right}: there
//     is no logical spelling of it and RN does not mirror one, so there is
//     nothing to convert to. Flagging twenty call sites for a fix that does
//     not exist teaches people to paste a marker, which is how a check like
//     this turns into an ignore list. Exempted by name, once, here.
//
//  2. A SYMMETRIC PAIR. `left: 0, right: 0` pins a box to both edges and is
//     the same box in either direction; `borderTopLeftRadius: 20,
//     borderTopRightRadius: 20` is a sheet with a rounded top. There are 77
//     lines of the second shape in this tree and not one of them is a
//     direction decision. A pair counts as symmetric when both halves appear
//     within four lines of each other with the SAME value — an asymmetric one
//     (`borderTopLeftRadius: 20` alone, or with a different number beside it)
//     is a real corner on a real side and is flagged.
//
//     Four lines rather than "the same style object", because finding the
//     object means parsing and this does not parse. The cost is visible and
//     small: two style objects stacked within four lines can lend each other a
//     half, so one side of a genuinely asymmetric pair can be excused by its
//     neighbour. The OTHER side is still flagged and the line still fails the
//     build, which is what the check is for; it is the message that is one
//     hit short, not the verdict. Every one of the 77 pairs in this tree today
//     is written on a single line.
//
//  3. `textAlign: 'center'`, and `alignItems` / `justifyContent`. Centre has
//     no side, and flex-start and flex-end are already logical in Yoga — they
//     mirror on their own, which is the behaviour we want.
//
//  4. Comments — including the TRAILING kind. This repository argues its
//     decisions in prose and the prose for THIS decision is full of the words
//     and the arrows it bans. check-currency.mjs excludes whole comment lines
//     and blocks; this also cuts a `//` off the end of a line of code, because
//     `const seen = new Map(); // lowercased key → the spelling to show` is a
//     comment about a map and not an arrow on a screen. The cut tracks quote
//     state, so the `//` in an https:// URL is not mistaken for one.
//
//  5. `left` and `right` that are not insets. Both words are ordinary
//     identifiers in this tree — `{ left: number | null }` is how many
//     sessions a client has left, and `right` is a prop that takes a
//     ReactNode. An inset only means anything on a positioned node, so the
//     rule asks for a `position:` within four lines and says nothing
//     otherwise. That is a real hole: an absolutely-positioned element whose
//     `position:` sits further from its `left:` than that is missed. It is
//     the trade that keeps the check from flagging a type annotation, which
//     is the failure that makes people stop reading a check's output.
//
//  6. studio-web. The console is Next.js and CSS, with its own logical
//     properties and its own rules. Nothing here applies to it.
//
// ── the escape hatch, and why it takes a sentence ─────────────────────────
//
// Some things must NOT mirror, and a mirrored one is worse than an unmirrored
// layout: a timeline that runs backwards renders perfectly and is false. Mark
// the line, or the comment immediately above it:
//
//     // rtl-ok: this strip labels an <Svg> that cannot mirror, so it must not
//
// The sentence is the point, exactly as with `currency-ok:` in
// check-currency.mjs and `no-error-ok:` in check-reads.mjs. It is what a
// reviewer reads when deciding whether a hardcoded left is honestly right here.
// src/lib/direction.ts holds the list of what does not mirror and argues each
// entry; a new marker that is not an instance of something on that list is a
// new decision and belongs in that header first.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { assertRootFloors } from './gate-floor.mjs';

const ROOT = process.cwd();
const ROOTS = ['app', 'src/ui'];

/**
 * The one module allowed to name a physical side without a marker: it is the
 * module that resolves them. src/lib/direction.ts is pure and names them only
 * in prose and in return values.
 */
const ALLOWED = new Set(['src/ui/direction.ts']);

/** physical → logical, for the box properties that have a logical spelling. */
const BOX = new Map([
  ['marginLeft', 'marginStart'], ['marginRight', 'marginEnd'],
  ['paddingLeft', 'paddingStart'], ['paddingRight', 'paddingEnd'],
  ['borderLeftWidth', 'borderStartWidth'], ['borderRightWidth', 'borderEndWidth'],
  ['borderLeftColor', 'borderStartColor'], ['borderRightColor', 'borderEndColor'],
]);

/** The corner radii, as pairs. Flagged only when a half appears without its
 *  partner — see exclusion 2 in the header. */
const RADII = [
  ['borderTopLeftRadius', 'borderTopRightRadius'],
  ['borderBottomLeftRadius', 'borderBottomRightRadius'],
];

/** Directional glyphs drawn as text. `Icon`'s chevrons are SVG paths and a
 *  character is no more mirrorable than a path, so both go through
 *  src/ui/direction.ts. Prose that happens to contain one is a direction
 *  decision too — "Me › Injuries" is a path read in reading order — so it is
 *  flagged and marked rather than quietly exempted. */
const GLYPH = /[›‹→←»«]/;

/** How far apart the two halves of a pair may sit and still count as one
 *  style object. Four lines covers every multi-line style literal in this
 *  tree; a pair further apart than that is not being read as a pair by a
 *  person either. */
const PAIR_WINDOW = 4;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    // Tests are excluded: src/lib/direction.test.ts asserts what the physical
    // spellings resolve to, so every assertion in it looks exactly like an
    // offence. It is not under these roots today; the guard is for when a
    // .test.tsx lands beside a component.
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Which lines are inside a comment.
 *
 * Lifted from check-currency.mjs, which needs it for the same reason: the
 * block form is what matters, because a JSX `{/* … *\/}` explaining a layout
 * runs to six lines and only the first of them starts with a slash.
 */
function commentedLines(lines) {
  const out = new Array(lines.length).fill(false);
  let inBlock = false;
  lines.forEach((line, i) => {
    if (inBlock) {
      out[i] = true;
      if (line.includes('*/')) inBlock = false;
      return;
    }
    if (/^\s*\/\//.test(line)) { out[i] = true; return; }
    const open = line.lastIndexOf('/*');
    if (open !== -1 && line.indexOf('*/', open) === -1) {
      inBlock = true;
      out[i] = /^[\s{]*$/.test(line.slice(0, open));
      return;
    }
    out[i] = /^\s*[{]?\s*\/\*.*\*\/\s*[}]?\s*$/.test(line);
  });
  return out;
}

/** How far a marker reaches down past itself. See `excused`. */
const MARKER_REACH = 4;

/**
 * An `rtl-ok:` marker on this line, anywhere in the contiguous run of comment
 * and blank lines above it, or within the last MARKER_REACH lines.
 *
 * The whole comment RUN rather than a fixed window, for the reason
 * check-currency.mjs gives: what is being excused is usually a small block
 * under one explanation, and a fixed window excuses the first line of such a
 * block and flags the rest, which teaches people to paste the marker four
 * times rather than write the reason once.
 *
 * The four lines DOWNWARD are the other half of the same problem and this file
 * needed them where check-currency did not. Almost everything excused here is
 * inside a JSX element whose offending glyph is in its TEXT — so the comment
 * sits above `<Text …>` and the arrow is two lines further down, with an
 * opening tag in between that breaks the run. The marker cannot go on the
 * offending line, because a `//` inside JSX text renders as two slashes on
 * somebody's screen.
 *
 * Four is the reach of a JSX element with a style prop and a line of copy,
 * which is the biggest thing anything in this tree excuses in one go. It is
 * deliberately short: a marker that reached further would start silencing
 * offences it was never written about, and the whole value of the mechanism is
 * that the sentence beside a hit is a sentence about that hit.
 */
function excused(lines, commented, i) {
  const marked = (j) => /rtl-ok:\s*\S/.test(lines[j]);
  // Every comment run whose LAST line is within reach, read whole. The run is
  // read from its end rather than from the marker, because a six-line
  // explanation puts its `rtl-ok:` on the first line and the thing being
  // excused sits below the last one.
  for (let bottom = i; bottom >= Math.max(0, i - MARKER_REACH); bottom--) {
    if (marked(bottom)) return true;
    if (!commented[bottom]) continue;
    for (let j = bottom; j >= 0 && (commented[j] || lines[j].trim() === ''); j--) {
      if (marked(j)) return true;
    }
  }
  return false;
}

/**
 * The line with any trailing `//` comment cut off.
 *
 * Quote state is tracked so that the `//` in 'https://…' survives, and so that
 * a `//` inside a string that is genuinely being rendered is not mistaken for
 * a comment. Template literals count as quotes for this purpose; their `${}`
 * holes do not need special handling because a `//` inside one would be a
 * comment in the surrounding expression too and cutting it is still right.
 */
function code(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/** The value written for `prop` on this line, trimmed — or null. */
function valueOf(line, prop) {
  const m = new RegExp(`\\b${prop}\\s*:\\s*([^,}\\]]+)`).exec(line);
  return m ? m[1].trim() : null;
}

/**
 * Does `line` have `prop` paired with `partner` at the same value, within
 * PAIR_WINDOW lines either side? A pair is symmetric and is not a decision.
 */
function pairedSymmetrically(lines, i, prop, partner) {
  const mine = valueOf(lines[i], prop);
  if (mine == null) return false;
  const from = Math.max(0, i - PAIR_WINDOW);
  const to = Math.min(lines.length - 1, i + PAIR_WINDOW);
  for (let j = from; j <= to; j++) {
    const theirs = valueOf(lines[j], partner);
    if (theirs != null && theirs === mine) return true;
  }
  return false;
}

/**
 * Is there a `position:` within PAIR_WINDOW lines of `i`?
 *
 * `left` and `right` are only insets on a positioned node, and both words are
 * ordinary identifiers everywhere else in this tree. See exclusion 5.
 */
function positionedNear(lines, i) {
  const from = Math.max(0, i - PAIR_WINDOW);
  const to = Math.min(lines.length - 1, i + PAIR_WINDOW);
  for (let j = from; j <= to; j++) if (/\bposition\s*:/.test(lines[j])) return true;
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
assertRootFloors('check:rtl', perRoot);

// A check that inspects no files passes every time. check-reads.mjs shipped
// once having read nothing and reported success; the same guard, for the same
// reason.
if (!files.length) {
  console.error('found no source files to check, which is not a pass.');
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (ALLOWED.has(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  const commented = commentedLines(lines);

  const bare = lines.map(code);

  lines.forEach((raw, i) => {
    if (commented[i] || excused(lines, commented, i)) return;
    const line = bare[i];
    if (!line.trim()) return;
    const where = `${rel}:${i + 1}`;
    const say = (what, fix) => findings.push({ where, what, fix, text: line.trim() });

    // hitSlop is {top,left,bottom,right} and has no logical form. Skipped for
    // the whole line, because that is the only thing on it that says left.
    const slop = /\bhitSlop\b/.test(line);

    for (const [from, to] of BOX) {
      if (new RegExp(`\\b${from}\\b`).test(line)) say(from, to);
    }

    if (!slop && positionedNear(bare, i)) {
      for (const side of ['left', 'right']) {
        const other = side === 'left' ? 'right' : 'left';
        if (!new RegExp(`(^|[\\s{,[(])${side}\\s*:`).test(line)) continue;
        if (pairedSymmetrically(bare, i, side, other)) continue;
        say(`${side}:`, side === 'left' ? 'start:' : 'end:');
      }
    }

    for (const [a, b] of RADII) {
      for (const [prop, partner] of [[a, b], [b, a]]) {
        if (!new RegExp(`\\b${prop}\\b`).test(line)) continue;
        if (pairedSymmetrically(bare, i, prop, partner)) continue;
        say(prop, prop.replace('Left', 'Start').replace('Right', 'End'));
      }
    }

    if (/textAlign\s*:\s*'(left|right)'/.test(line)) {
      say("textAlign: 'left' | 'right'", "'auto' for leading text, END_ALIGN from src/ui/direction for trailing");
    }

    if (GLYPH.test(line)) {
      say('a directional glyph', 'FORWARD_CHAR / BACK_CHAR / FORWARD_ARROW from src/ui/direction');
    }
  });
}

if (findings.length) {
  console.error('A layout names a physical side, so it will not mirror for an Arabic reader:\n');
  for (const f of findings) {
    console.error(`${f.where}  ${f.what} → ${f.fix}`);
    console.error(`  ${f.text.slice(0, 130)}`);
  }
  console.error(`\n${findings.length} problem${findings.length === 1 ? '' : 's'}.`);
  console.error('Use the logical property, or — if this genuinely must not mirror — write');
  console.error('`// rtl-ok: <why>` on the line or in the comment above it. src/lib/direction.ts');
  console.error('lists what does not mirror and argues each entry.');
  process.exit(1);
}

console.log(`check:rtl — ok, ${files.length} files name no physical side without a reason.`);
