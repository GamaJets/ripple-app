#!/usr/bin/env node
// A source file that greps as binary is invisible to everything that reads it.
//
// ── the bug this exists for, which has now happened twice ─────────────────
//
// `studio-web/app/classes/page.tsx` contained a raw NUL byte, written directly
// into a string literal as a sentinel:
//
//     const NO_PLACE = '\0unlabelled';
//
// The VALUE is right — a separator no real place name can collide with. What
// was wrong is that it was written as a raw byte rather than the escape
// `\u0000` written out, and one NUL anywhere in a file makes every tool that reads it treat
// the whole thing as binary. `file(1)` reported `data`. `grep` printed NOTHING
// from any of its 1,277 lines, silently, with exit status 1 — the same status
// it gives for "I looked and it is not there".
//
// The cost was not hypothetical. A sweep migrated six console pages off their
// own local `function Banner` onto the shared one that announces to a screen
// reader. It listed six because `grep -rn "function Banner"` found six. There
// were seven. The seventh sat in this file for as long as the byte did, and the
// refusal it renders — the sentence naming which read failed — stayed silent
// for a screen reader through every review that thought it had swept the
// console.
//
// `studio-web/components/DataTable.tsx` carries a comment recording this exact
// bug being found and fixed once already. Finding it a second time in a
// different file is what makes it a gate rather than a fix: the failure mode is
// that nothing looks wrong. The file opens correctly in an editor, compiles,
// type-checks, bundles and passes every other check here. It is only invisible
// to the tools that go looking for things.
//
// ── what this checks ──────────────────────────────────────────────────────
//
// Every tracked source file is decodable UTF-8 and contains no C0 control
// character other than tab and newline. That is deliberately narrower than "is
// it valid text": a stray form feed or vertical tab does not make grep give up,
// and flagging it would be noise. NUL is the one that does, and the neighbours
// listed below are flagged with it because they have no business in source and
// are the same kind of accident — a paste from a terminal, an editor writing a
// literal instead of an escape.
//
// The fix is always the same and never "delete the value": write it as an
// escape. `'\u0000'` is the same string as `'\0'` to every JavaScript runtime
// and is seven ASCII characters to every tool that reads the file.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** Where source lives. `scripts/` is included: this file is source too. */
const ROOTS = ['app', 'src', 'studio-web/app', 'studio-web/components', 'studio-web/lib', 'scripts', 'supabase/functions', 'supabase/parts'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sql', '.json', '.md', '.css']);
const SKIP = new Set(['node_modules', '.git', '.next', '.expo', '.tmp', 'dist', 'build', 'ios', 'android']);

/**
 * The control characters that have no place in source.
 *
 * NUL is the one that matters and the rest are its neighbours. Tab (9),
 * newline (10) and carriage return (13) are excluded because they are text.
 * Everything else below 0x20 is here — but note the ASYMMETRY in the reporting
 * below: a NUL is a failure because it hides the file, and the others are
 * failures because they are certainly accidents, not because they hide it.
 */
const isBadControl = (c) => (c < 0x09 || (c > 0x0a && c < 0x0d) || c === 0x0e || (c > 0x0e && c < 0x20));

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXTS.has(extname(e.name))) yield p;
  }
}

const files = [];
for (const r of ROOTS) {
  const abs = join(ROOT, r);
  try { statSync(abs); } catch { continue; }
  for (const f of walk(abs)) files.push(f);
}

// The empty-set guard every gate here has. A check that passes because it
// looked at nothing is worse than no check: it reports "ok" and a count.
if (files.length < 200) {
  console.error(`check-text: only found ${files.length} source files, which cannot be right — the roots are probably wrong. Refusing to pass.`);
  process.exit(1);
}

const problems = [];
for (const f of files) {
  const buf = readFileSync(f);
  const rel = relative(ROOT, f);

  // Decodability first. A file that is not UTF-8 is a different accident with
  // the same consequence, and naming it as such is more use than a byte offset.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    problems.push({ rel, what: 'is not valid UTF-8', fix: 'Re-save it as UTF-8. Something has written bytes from another encoding into it.' });
    continue;
  }

  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (!isBadControl(c)) continue;
    // The line number, counted the way an editor would.
    let line = 1;
    for (let j = 0; j < i; j++) if (buf[j] === 0x0a) line++;
    const hex = '0x' + c.toString(16).padStart(2, '0');
    const esc = '\\u' + c.toString(16).padStart(4, '0');
    problems.push({
      rel,
      what: c === 0
        ? `line ${line} contains a raw NUL byte, so grep, file(1) and every tool that reads source treat this whole file as binary`
        : `line ${line} contains a raw control character (${hex})`,
      fix: `Write it as the escape '${esc}' instead. Same value to the runtime, ordinary text to everything else — do not delete the sentinel, it is doing a job.`,
    });
    break; // one report per file; the fix is the same for every occurrence
  }
}

if (problems.length) {
  console.error(`\n${problems.length} file${problems.length === 1 ? '' : 's'} that tools cannot read as text:\n`);
  for (const p of problems) {
    console.error(`  ${p.rel}`);
    console.error(`    ${p.what}`);
    console.error(`    → ${p.fix}\n`);
  }
  console.error('A source file that greps as binary passes the type checker, the bundler and every');
  console.error('other check here. It is invisible only to the tools that go LOOKING for things —');
  console.error('which is how a console page kept its own silent Banner through a sweep that');
  console.error('migrated the other six, and reported that it had done all of them.\n');
  process.exit(1);
}

console.log(`check-text — ok, ${files.length} source files are readable text`);
