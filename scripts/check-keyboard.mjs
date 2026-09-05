#!/usr/bin/env node
// A field you cannot see while you type into it.
//
// ── the bug this exists for ───────────────────────────────────────────────
//
// Reported from the gym floor: "the keyboard covers the field you are typing
// into." On app/(trainer)/log-session.tsx that meant a coach entering reps and
// weight typed into a box hidden behind the keyboard, on the screen whose whole
// purpose is checking the number.
//
// The screen was not missing keyboard handling. It HAD a `KeyboardAvoidingView`
// with `behavior="padding"`, which is the documented thing to do and which did
// nothing at all: `padding` pads the bottom of the KAV's own container, and the
// `ScrollView` inside already filled that container, so there was nothing for
// the padding to push and the focused row never scrolled clear. A reviewer
// grepping for "does this screen handle the keyboard" found a wrapper and moved
// on. That is why this check does not look for keyboard handling in the file —
// it looks for it on the SCROLLER THAT CONTAINS THE FIELD.
//
// The sweep that added this fixed eighteen page scrollers and six bottom
// sheets. This is what stops the twenty-fifth.
//
// ── the rule ──────────────────────────────────────────────────────────────
//
// A `<TextInput>` whose nearest enclosing vertical scroller has no
// `automaticallyAdjustKeyboardInsets`, and no `KeyboardAvoidingView` anywhere
// above it, is a field that can end up under the keyboard.
//
// `automaticallyAdjustKeyboardInsets` is the one that works for a page: iOS
// adds the keyboard height to the scroll insets and brings the focused input
// above it. `KeyboardAvoidingView` is accepted as the answer for a BOTTOM
// SHEET, where the whole sheet has to rise and there is a flex:1 scrim above it
// for the padding to eat — see the sheets in app/(trainer)/invoices.tsx,
// costs.tsx and receipts.tsx, and the picker at the foot of log-session.tsx.
// The check cannot tell a sheet from a page, so it accepts either mechanism and
// leaves which one is right to the person writing the screen. What it will not
// accept is neither.
//
// ── and it will not accept a KeyboardAvoidingView with nothing to push ────
//
// This is the part the first draft of this file got wrong, and it got it wrong
// in exactly the shape of the bug. Stripping `automaticallyAdjustKeyboardInsets`
// back off log-session.tsx passed, because the dead wrapper was still there and
// "is there a KeyboardAvoidingView above this scroller" said yes. A check that
// green-lights the original defect is not a check.
//
// So a KAV only counts when there is a SIBLING BEFORE the scroller inside it —
// a scrim, a sheet, anything with height that the padding can compress. That is
// not a heuristic standing in for the real rule, it IS the real rule: RN's
// `behavior="padding"` adds paddingBottom to the KAV, and if the scroller is
// the KAV's first child and fills it, the scroller simply shrinks by the same
// amount and every child of it stays exactly where it was. Something has to be
// above it for anything to move.
//
// ── what this deliberately does NOT flag ──────────────────────────────────
//
//  1. A `TextInput` with no enclosing scroller at all. That is the docked
//     compose bar — app/(client)/coach.tsx and app/(trainer)/assistant.tsx —
//     which is a different problem with a different, already-built answer:
//     src/ui/keyboardLift.ts measures where the bar actually is in window
//     coordinates and raises it, because RN's own KeyboardAvoidingView mixes
//     two coordinate spaces and under-lifts by the header height. Its header
//     argues that in full. Flagging those here would push people towards the
//     mechanism that is wrong for them.
//
//     Widening rule 1 to every TextInput anywhere would flag every compose
//     bar in the app, and a gate people disable is worse than no gate.
//
// ── rule 2: a sheet that cannot move and cannot scroll ────────────────────
//
// This paragraph used to concede a gap: "a short bottom sheet with no scroller
// in it can sit entirely behind the keyboard and this will not say so." It said
// so because rule 1 walks to the scroller CONTAINING the field, and a sheet
// with no scroller in it has nothing for that walk to find.
//
// It was not hypothetical. app/(client)/scans.tsx's "Correct This Scan" sheet
// was a bottom-anchored `<View>` holding Weight, Body fat and Muscle, with no
// KeyboardAvoidingView and no scroller. A decimal-pad keyboard covered all
// three fields, on the sheet whose entire purpose is checking a digit — the
// same bug as log-session.tsx, in the one shape this file could not see. The
// Add sheet forty lines above it had been written correctly and the two were
// never read against each other.
//
// So: a `<TextInput>` inside a `<Modal>` with NO vertical scroller between the
// two must have a `KeyboardAvoidingView` between the two. A sheet with neither
// cannot move and cannot scroll, and every pixel the keyboard covers is gone.
//
// This stays inside the modal deliberately. Outside one, a field with no
// scroller is the docked compose bar of exclusion 1, which has its own answer;
// the `<Modal>` is what distinguishes "this is a sheet and it is stuck" from
// "this is a bar and it is lifted".
//
// ── what rule 2 does NOT check, and why it says so out loud ───────────────
//
// Whether that KeyboardAvoidingView is a LIVE one. Rule 1 can test this for a
// scroller: the padding needs a sibling with height between the wrapper's first
// child and the scroller, and the offsets make that measurable. For a sheet
// with no scroller there is no second landmark to measure to — the field sits
// somewhere in the middle of the sheet's own markup, and the run of text before
// it is never empty. Measuring to it would return "lifted" for every sheet in
// the tree, which is a check that always passes.
//
// A dead wrapper on a scroller-less sheet is therefore still possible and still
// invisible here. Stated rather than papered over, because the first draft of
// rule 1 shipped a test that green-lit its own defect, and the honest move when
// a rule cannot see something is to write down what it cannot see.
//
//  2. `horizontal` scrollers. A strip of chips is not what a focused field
//     scrolls inside; the enclosing scroller that matters is the vertical one
//     further out, and that is the one this walks to.
//
//  3. A field that is a SIBLING above a scroller rather than inside it — the
//     search box at the top of the country picker in app/phone-signin.tsx, or
//     the meal search in app/(trainer)/client-nutrition.tsx. Both sit at the
//     top of a tall sheet, above the keyboard, with a scrolling list beneath
//     them that the reader can still reach. There is nothing to fix, so there
//     is nothing to report and no marker to paste.
//
//  4. studio-web. The console is Next.js in a browser and has no soft keyboard
//     problem of this shape.
//
// ── the escape hatch, and why it takes a sentence ─────────────────────────
//
// A field that genuinely cannot be covered — one pinned at the top of a short
// screen — needs nothing, and bolting a keyboard's height of padding under it
// would leave a screen that scrolls into empty space for no reason. Mark the
// line, or the comment immediately above it:
//
//     // keyboard-ok: this is the only field on a screen that does not scroll,
//     // so it is above the keyboard before it opens
//
// The sentence is the point, exactly as with `rtl-ok:` in check-rtl.mjs and
// `currency-ok:` in check-currency.mjs. It is what a reviewer reads when
// deciding whether "nothing needed here" is honestly true, and it cannot be
// written by somebody who has not thought about where the field sits.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ROOTS = ['app', 'src/ui'];

/** Vertical scrollers. A focused field scrolls inside one of these or nowhere. */
const SCROLLERS = new Set(['ScrollView', 'FlatList', 'SectionList']);
/** Everything the tag walker tracks. Anything else is invisible to it. */
const TRACKED = new Set([...SCROLLERS, 'KeyboardAvoidingView', 'Modal', 'TextInput']);

/** How far a marker reaches down past itself, in lines. Same reasoning as
 *  check-rtl.mjs: a `<TextInput>` with a style prop and an accessibility label
 *  runs to about this, and the marker cannot go on the offending line because a
 *  `//` inside JSX renders as two slashes on somebody's screen. */
const MARKER_REACH = 6;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(p) && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * The source with every comment blanked to spaces, offsets and newlines kept.
 *
 * Comments have to go before anything counts tags, because this repository
 * argues its decisions in prose and the prose about keyboards is full of
 * sentences naming `<ScrollView>` and `<TextInput>`. Counting those would
 * unbalance the stack in exactly the files that have thought hardest about it.
 *
 * Quote state is tracked so the `//` in an https:// URL survives, and so does a
 * `/*` inside a string. Blanking rather than deleting keeps every byte offset
 * equal to the original, which is what makes the line numbers below true.
 */
function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => { for (let j = from; j < to; j++) if (out[j] !== '\n') out[j] = ' '; };
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? src.length : end + 2;
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return out.join('');
}

/**
 * Where the opening tag starting at `start` ends, and whether it closes itself.
 *
 * Props hold arbitrary JavaScript — arrow functions, generics, ternaries — so
 * the first `>` after the tag name is not the end of the tag. Brace depth and
 * quote state are both tracked; the tag ends at the `>` seen at depth zero
 * outside a string.
 */
function endOfTag(src, start) {
  let i = start, depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; continue; }
    if (depth === 0 && c === '>') {
      return { end: i, selfClosing: src[i - 1] === '/' };
    }
    i++;
  }
  return null;
}

/** The 1-based line a byte offset falls on. */
function lineOf(src, offset) {
  let n = 1;
  for (let i = 0; i < offset; i++) if (src[i] === '\n') n++;
  return n;
}

/**
 * A `keyboard-ok:` marker on this line, in the contiguous run of comment and
 * blank lines above it, or within MARKER_REACH lines above.
 *
 * Read from the bottom of a comment run rather than from the marker, for the
 * reason check-rtl.mjs gives: a five-line explanation puts its marker on the
 * first line and the thing being excused sits below the last one.
 */
function excused(lines, i) {
  const isComment = (j) => /^\s*(\{?\/\/|\{?\/\*|\*)/.test(lines[j] ?? '');

  /**
   * Whether line `j` carries a marker AND a reason.
   *
   * check-rtl.mjs tests this with `/rtl-ok:\s*\S/`, which is enough there
   * because its markers sit in `//` comments. Here they cannot: a marker has to
   * go next to JSX, a `//` inside JSX renders as two slashes on somebody's
   * screen, and so every marker in this tree will be written `{/* keyboard-ok:
   * … *\/}`. Under `\s*\S` the comment's OWN closing star satisfies the test,
   * so `{/* keyboard-ok: *\/}` — a marker with nothing said — silenced a real
   * hit. It did, in the proof run for this file.
   *
   * So the terminator is cut off and what is left has to be four words. Four
   * because that is the shortest thing that can be a reason rather than a
   * label, and because a person who has to write four words about where a field
   * sits has had to look at where the field sits.
   */
  const marked = (j) => {
    const m = /keyboard-ok:(.*)$/.exec(lines[j] ?? '');
    if (!m) return false;
    // The remainder of the marker line, plus the rest of the comment it opens —
    // a reason worth writing often runs past the width of a line.
    let said = m[1];
    for (let k = j + 1; k <= j + 3 && isComment(k); k++) said += ' ' + lines[k];
    said = said.replace(/\*\/\s*\}?/g, ' ').replace(/^\s*[*/]+/gm, ' ');
    return said.split(/\s+/).filter((w) => /[A-Za-z]{2}/.test(w)).length >= 4;
  };

  for (let bottom = i; bottom >= Math.max(0, i - MARKER_REACH); bottom--) {
    if (marked(bottom)) return true;
    if (!isComment(bottom)) continue;
    for (let j = bottom; j >= 0 && (isComment(j) || (lines[j] ?? '').trim() === ''); j--) {
      if (marked(j)) return true;
    }
  }
  return false;
}

const files = [];
for (const r of ROOTS) {
  const abs = join(ROOT, r);
  try { statSync(abs); } catch { continue; }
  walk(abs, files);
}

// The empty-set guard every gate here has. A check that passes because it
// looked at nothing reports "ok" and a count, which is the most convincing
// possible way to be wrong.
if (files.length < 150) {
  console.error(`check-keyboard: only found ${files.length} .tsx files under ${ROOTS.join(', ')}, which cannot be right. Refusing to pass.`);
  process.exit(1);
}

const problems = [];
const unreadable = [];
let inputsSeen = 0;
let inputsInScrollers = 0;

for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const src = stripComments(raw);
  const rel = relative(ROOT, f);
  const lines = raw.split('\n');

  /** Open tags, outermost first. Each carries the text of its opening tag. */
  const stack = [];
  let balanced = true;

  const tagRe = /<(\/?)([A-Z][A-Za-z0-9]*)/g;
  let m;
  while ((m = tagRe.exec(src)) !== null) {
    const [, slash, name] = m;
    if (!TRACKED.has(name)) continue;
    // A TYPE ARGUMENT, not a tag. `useRef<ScrollView>(null)` is how every
    // screen here that programmatically scrolls holds its scroller, and
    // `useRef<TextInput>(null)` is how src/ui/OtpCodeEntry.tsx focuses a box.
    // Counting those as opening tags unbalanced seven files. In JSX the `<` is
    // always preceded by whitespace or by punctuation that opens an expression;
    // in a type argument it is welded to the identifier before it.
    if (m.index > 0 && /[A-Za-z0-9_$]/.test(src[m.index - 1])) continue;

    if (slash) {
      // A close for something the stack does not end with means this walker has
      // lost the thread. Reported rather than swallowed: a file it cannot
      // follow is a file it cannot vouch for, and quietly passing it is how a
      // gate turns into decoration.
      const top = stack[stack.length - 1];
      if (!top || top.name !== name) { balanced = false; break; }
      stack.pop();
      continue;
    }

    const t = endOfTag(src, m.index);
    if (!t) { balanced = false; break; }
    const open = src.slice(m.index, t.end + 1);

    if (name === 'TextInput') {
      inputsSeen++;
      // The nearest enclosing scroller, skipping horizontal strips of chips —
      // a focused field does not scroll inside one of those.
      const scroller = [...stack].reverse().find(
        (s) => SCROLLERS.has(s.name) && !/\bhorizontal\b/.test(s.open),
      );
      if (scroller) {
        inputsInScrollers++;
        const handled = /automaticallyAdjustKeyboardInsets/.test(scroller.open) || scroller.lifted;
        if (!handled) {
          const line = lineOf(src, m.index);
          if (!excused(lines, line - 1)) {
            problems.push({
              rel, line,
              scrollerLine: lineOf(src, scroller.index),
              // Named apart, because the two are different mistakes and the
              // second one looks like a fix. A wrapper that pads a container
              // its own scroller already fills is the defect this file exists
              // for, and "add a KeyboardAvoidingView" is the wrong advice to
              // give somebody who already has one.
              deadWrapper: stack.some((s) => s.name === 'KeyboardAvoidingView'),
            });
          }
        }
      }
      // ── rule 2 ────────────────────────────────────────────────────────
      // No scroller at all. Outside a modal that is the docked compose bar,
      // which is exclusion 1 and is left alone. Inside one it is a sheet that
      // can neither rise nor scroll, so it needs a wrapper that lifts it.
      if (!scroller) {
        const modalAt = stack.map((fr) => fr.name).lastIndexOf('Modal');
        if (modalAt !== -1) {
          const lifter = stack.slice(modalAt + 1).some((fr) => fr.name === 'KeyboardAvoidingView');
          if (!lifter) {
            const line = lineOf(src, m.index);
            if (!excused(lines, line - 1)) {
              problems.push({ rel, line, sheet: true, modalLine: lineOf(src, stack[modalAt].index) });
            }
          }
        }
      }
      if (!t.selfClosing) stack.push({ name, open, index: m.index, contentStart: t.end + 1 });
      continue;
    }

    if (!t.selfClosing) {
      const frame = { name, open, index: m.index, contentStart: t.end + 1 };
      if (SCROLLERS.has(name)) {
        // Whether a KeyboardAvoidingView above this scroller can actually lift
        // what is inside it — see the header. The innermost KAV is the one that
        // would do the lifting, and it can only do it if something with height
        // sits between where its own children start and where this scroller
        // does.
        //
        // Braces are discarded along with the whitespace, and that is load
        // bearing rather than tidying: a JSX comment is `{/* … */}`, the
        // stripper above blanks what is between the slashes and leaves the
        // braces standing, and log-session.tsx puts a twelve-line comment
        // between its wrapper and its ScrollView. Counting those two braces as
        // a sibling with height would have passed the exact file this check
        // exists for — it did, until this line was written.
        const kav = [...stack].reverse().find((s) => s.name === 'KeyboardAvoidingView');
        frame.lifted = !!kav && src.slice(kav.contentStart, m.index).replace(/[{}\s]/g, '') !== '';
      }
      stack.push(frame);
    }
    tagRe.lastIndex = t.end;
  }

  if (!balanced || stack.length) unreadable.push(rel);
}

if (unreadable.length) {
  console.error(`\ncheck-keyboard could not follow the JSX in ${unreadable.length} file${unreadable.length === 1 ? '' : 's'}:\n`);
  for (const r of unreadable) console.error(`  ${r}`);
  console.error('\nThe tag walker tracks ScrollView, FlatList, SectionList, KeyboardAvoidingView,');
  console.error('Modal and TextInput, and expects every one it opens to be closed. A file it');
  console.error('cannot follow is a file it cannot vouch for, so it fails rather than passing it');
  console.error('quietly. Either the JSX is unusual or this walker needs to learn something.\n');
  process.exit(1);
}

// The second half of the empty-set guard, and the more useful half: the roots
// could be right, the files could all parse, and a broken walker could still
// find no inputs at all.
if (inputsSeen < 60 || inputsInScrollers < 20) {
  console.error(`check-keyboard: found ${inputsSeen} TextInputs, ${inputsInScrollers} of them inside a vertical scroller. Both are far below what this tree holds, so the walker is broken. Refusing to pass.`);
  process.exit(1);
}

if (problems.length) {
  console.error(`\n${problems.length} field${problems.length === 1 ? '' : 's'} the keyboard can cover:\n`);
  for (const p of problems) {
    console.error(`  ${p.rel}:${p.line}`);
    if (p.sheet) {
      console.error(`    a TextInput in the Modal opened on line ${p.modalLine}, with no scroller between`);
      console.error('    the two and no KeyboardAvoidingView either — the sheet can neither rise nor\n    scroll, so the keyboard simply covers it\n');
      continue;
    }
    console.error(`    a TextInput inside the scroller opened on line ${p.scrollerLine}, which has no`);
    console.error(p.deadWrapper
      ? '    automaticallyAdjustKeyboardInsets — and the KeyboardAvoidingView above it is the\n    scroller\'s own wrapper, so its padding has nothing to push\n'
      : '    automaticallyAdjustKeyboardInsets and no KeyboardAvoidingView above it\n');
  }
  console.error('For a PAGE scroller: put `automaticallyAdjustKeyboardInsets` on it, add');
  console.error('`keyboardDismissMode="interactive"` so the keyboard can be dragged away, and raise');
  console.error('the contentContainer paddingBottom if the field is near the end of the screen — see');
  console.error('the ScrollView in app/(trainer)/log-session.tsx.\n');
  console.error('For a BOTTOM SHEET: wrap the modal contents in a KeyboardAvoidingView with');
  console.error('behavior="padding" so the sheet itself rises — see app/(trainer)/receipts.tsx.\n');
  console.error('A KeyboardAvoidingView around a ScrollView that already fills it is NOT a fix: that');
  console.error('is what log-session.tsx had while a coach typed reps into a box behind the');
  console.error('keyboard. If the field genuinely cannot be covered, say so in a `keyboard-ok:`');
  console.error('comment and this will believe you.\n');
  process.exit(1);
}

console.log(`check-keyboard — ok, ${inputsSeen} fields seen, ${inputsInScrollers} inside a scroller, every one of them with a way out from under the keyboard`);
